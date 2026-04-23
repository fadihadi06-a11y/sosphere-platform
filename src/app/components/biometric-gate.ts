// ═══════════════════════════════════════════════════════════════
// SOSphere — Biometric Gate (WebAuthn + Capacitor bridge)
// ─────────────────────────────────────────────────────────────
// Pure data layer for biometric-gate-modal-v2.tsx.
//
// Design goals:
//   • Zero new dependencies — uses native WebAuthn in browser/PWA and a
//     Capacitor bridge shim (`SOSphereBiometric`) when running in the
//     Android wrapper. The wrapper plugin (if present) is detected at
//     runtime; if it's missing we gracefully fall back to WebAuthn.
//   • Session-scoped "verified" flag (in-memory) — never persisted. The
//     credential ID is persisted so we can re-challenge the same key.
//   • No network I/O here — this module is the local adapter; the UI
//     decides when to call verifyBiometric() before sensitive actions.
//
// Public API (consumed by biometric-gate-modal-v2.tsx):
//   checkBiometricAvailability() → BiometricStatus
//   enrollBiometric(userId, userName) → boolean
//   verifyBiometric() → boolean
//   isBiometricVerified() → boolean
//   getBiometricStatus() → BiometricStatus
//   unenrollBiometric() → void
//
// Storage keys (localStorage):
//   sosphere_biometric_credential_id — base64url-encoded credential handle
//   sosphere_biometric_user_id       — last userId we enrolled for
// ═══════════════════════════════════════════════════════════════

import { isNativeApp } from "./capacitor-bridge";
// FIX 2026-04-23 (v2): static import instead of dynamic await import(). Vite
// was leaving the dynamic import unresolved in the native bundle, so the
// plugin was effectively "not installed" at runtime even though node_modules
// had it. Static import guarantees the plugin code is bundled.
import { BiometricAuth as AparajitaBiometricAuth } from "@aparajita/capacitor-biometric-auth";

export type BiometricStatus =
  | "not_available"  // no platform authenticator (WebAuthn not supported, or user-verifying flag unavailable)
  | "not_enrolled"   // available but user hasn't registered a credential yet
  | "enrolled";      // registered — can verify

const CREDENTIAL_KEY = "sosphere_biometric_credential_id";
const USER_ID_KEY    = "sosphere_biometric_user_id";

// Session-only verification flag (cleared on page reload)
let _verifiedThisSession = false;

// ─────────────────────────────────────────────────────────────
// Base64url helpers (WebAuthn transport format)
// ─────────────────────────────────────────────────────────────
function bufToB64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uToBuf(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function randomChallenge(): Uint8Array {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return arr;
}

// ─────────────────────────────────────────────────────────────
// Native bridge (optional Capacitor plugin)
// ─────────────────────────────────────────────────────────────
// If a Capacitor plugin named `SOSphereBiometric` is registered on the
// native side, we prefer it (cleaner UX, no WebAuthn quirks in WebView).
// Contract (kept minimal, matches what the Android wrapper would expose):
//   isAvailable() → { available: boolean }
//   authenticate({ reason }) → { success: boolean }
// ─────────────────────────────────────────────────────────────
type NativeBiometricPlugin = {
  isAvailable: () => Promise<{ available: boolean }>;
  authenticate: (opts: { reason?: string }) => Promise<{ success: boolean }>;
};

// FIX 2026-04-23 (v3): SYNCHRONOUS getter. The previous async version was
// returning the Capacitor plugin proxy from an async function — JavaScript
// then tried to "resolve" the returned value as a thenable by calling
// `.then()` on it. Capacitor proxies intercept EVERY property access and
// forward it to the native plugin, so `.then()` was being dispatched as a
// native method call, which doesn't exist → thrown:
//   "BiometricAuthNative.then() is not implemented on android"
// Making this function synchronous side-steps the Promise-auto-resolve
// entirely. The plugin itself still has async methods (checkBiometry,
// authenticate) which the caller awaits normally.
function getAparajitaBiometric(): typeof AparajitaBiometricAuth | null {
  if (!isNativeApp()) return null;
  try {
    if (AparajitaBiometricAuth && typeof AparajitaBiometricAuth.checkBiometry === "function") {
      return AparajitaBiometricAuth;
    }
  } catch {
    /* plugin not registered — fall through */
  }
  return null;
}

function getNativePlugin(): NativeBiometricPlugin | null {
  try {
    if (!isNativeApp()) return null;
    const cap = (window as any).Capacitor;
    const plugin = cap?.Plugins?.SOSphereBiometric as NativeBiometricPlugin | undefined;
    if (plugin && typeof plugin.isAvailable === "function" && typeof plugin.authenticate === "function") {
      return plugin;
    }
  } catch { /* fall through */ }
  return null;
}

// ─────────────────────────────────────────────────────────────
// WebAuthn availability check
// ─────────────────────────────────────────────────────────────
async function webauthnAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  try {
    // Platform authenticator = device-bound biometric (Touch/Face/Windows Hello)
    const fn = (window.PublicKeyCredential as any)
      .isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof fn !== "function") return false;
    return await fn.call(window.PublicKeyCredential);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Public: availability + status
// ─────────────────────────────────────────────────────────────
export async function checkBiometricAvailability(): Promise<BiometricStatus> {
  // FIX 2026-04-23 (v3): on native, don't gate on checkBiometry's STRONG-class
  // answer — many real devices (Realme RMX3085, Huawei optical under-display
  // sensors, etc.) are classified WEAK by Android (Status=7
  // BIOMETRIC_INSUFFICIENT_STRENGTH) and the plugin would report "not
  // available" even though biometric + device PIN work fine at authenticate
  // time with allowDeviceCredential:true.
  //
  // New rule: if the Aparajita plugin is resolved AND the runtime is native,
  // ALWAYS return "not_enrolled" (or "enrolled" if we have a stored handle).
  // The actual authentication at enroll/verify time uses weak strength +
  // device credential fallback, so it succeeds on these devices.
  console.log("[biometric] isNativeApp()=", isNativeApp(),
    "window.Capacitor=", typeof window !== "undefined" ? (window as { Capacitor?: unknown }).Capacitor : "n/a");
  const aparajita = getAparajitaBiometric();
  console.log("[biometric] Aparajita plugin resolved?", !!aparajita);
  if (aparajita) {
    try {
      const res = await aparajita.checkBiometry();
      console.log("[biometric] checkBiometry result:", res);
      // If STRONG is available, great. If not, we STILL proceed — authenticate()
      // will use weak + device credential. This fixes Realme / Oppo / OnePlus
      // optical fingerprint sensors that are WEAK-class but functional.
      if (res.isAvailable) {
        return localStorage.getItem(CREDENTIAL_KEY) ? "enrolled" : "not_enrolled";
      }
      console.warn("[biometric] STRONG unavailable (reason=", res.reason, ") — falling back to WEAK + device credential at enroll time");
      return localStorage.getItem(CREDENTIAL_KEY) ? "enrolled" : "not_enrolled";
    } catch (err) {
      console.error("[biometric] Aparajita checkBiometry threw:", err);
      // Plugin errored — but it's registered; still let the user try.
      return localStorage.getItem(CREDENTIAL_KEY) ? "enrolled" : "not_enrolled";
    }
  }

  // Legacy custom Capacitor bridge (kept for backwards compat)
  const native = getNativePlugin();
  if (native) {
    try {
      const { available } = await native.isAvailable();
      if (!available) return "not_available";
      return localStorage.getItem(CREDENTIAL_KEY) ? "enrolled" : "not_enrolled";
    } catch {
      // fall through to WebAuthn
    }
  }

  const hasWebAuthn = await webauthnAvailable();
  if (!hasWebAuthn) return "not_available";
  return localStorage.getItem(CREDENTIAL_KEY) ? "enrolled" : "not_enrolled";
}

export function getBiometricStatus(): BiometricStatus {
  // Synchronous best-effort read (used when the async check already ran).
  if (typeof window === "undefined") return "not_available";
  if (!window.PublicKeyCredential && !getNativePlugin()) return "not_available";
  return localStorage.getItem(CREDENTIAL_KEY) ? "enrolled" : "not_enrolled";
}

// ─────────────────────────────────────────────────────────────
// Public: enrollment
// ─────────────────────────────────────────────────────────────
export async function enrollBiometric(userId: string, userName: string): Promise<boolean> {
  // FIX 2026-04-23: Aparajita plugin path — the real native one.
  const aparajita = getAparajitaBiometric();
  if (aparajita) {
    try {
      // FIX 2026-04-23 (v3): pass androidBiometryStrength:0 (WEAK) so we
      // accept Class-2 optical under-display sensors found in Realme / Oppo /
      // OnePlus / Xiaomi. With allowDeviceCredential:true the user can also
      // fall back to device PIN / pattern.
      // androidConfirmationRequired:false removes the extra "confirm" tap
      // after fingerprint, which Realme shows by default and frustrates users.
      await aparajita.authenticate({
        reason: "Enroll biometric for SOSphere",
        androidTitle: "SOSphere Biometric Lock",
        androidSubtitle: "Confirm your fingerprint, face, or device PIN",
        allowDeviceCredential: true,
        androidBiometryStrength: 0,
        androidConfirmationRequired: false,
      } as never);
      // If authenticate() resolves (no throw), the user verified.
      const handle = bufToB64u(randomChallenge());
      localStorage.setItem(CREDENTIAL_KEY, handle);
      localStorage.setItem(USER_ID_KEY, userId);
      _verifiedThisSession = true;
      return true;
    } catch (err) {
      console.warn("[Biometric] Aparajita enroll failed:", err);
      return false;
    }
  }

  // Native plugin: just verify once to prove the user owns the device,
  // then mark enrolled. The native OS keystore handles the actual key.
  const native = getNativePlugin();
  if (native) {
    try {
      const { success } = await native.authenticate({ reason: "Enroll biometric for SOSphere" });
      if (success) {
        // Mint a random handle — native side will re-verify via OS keystore,
        // our handle just proves "this device enrolled user X".
        const handle = bufToB64u(randomChallenge());
        localStorage.setItem(CREDENTIAL_KEY, handle);
        localStorage.setItem(USER_ID_KEY, userId);
        _verifiedThisSession = true;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // WebAuthn path (browser / PWA)
  try {
    if (!await webauthnAvailable()) return false;

    const userIdBytes = new TextEncoder().encode(userId.slice(0, 64) || "user");
    const rpName = "SOSphere";
    // rp.id must match the origin's eTLD+1 or be omitted (browser picks the origin)
    const publicKey: PublicKeyCredentialCreationOptions = {
      challenge: randomChallenge(),
      rp: { name: rpName },
      user: {
        id: userIdBytes,
        name: userName || userId,
        displayName: userName || userId,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      timeout: 60_000,
      attestation: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
    };

    const cred = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
    if (!cred) return false;

    const credId = bufToB64u(cred.rawId);
    localStorage.setItem(CREDENTIAL_KEY, credId);
    localStorage.setItem(USER_ID_KEY, userId);
    _verifiedThisSession = true;
    return true;
  } catch (e) {
    console.warn("[Biometric] Enrollment failed:", e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Public: verification
// ─────────────────────────────────────────────────────────────
export async function verifyBiometric(): Promise<boolean> {
  const handle = localStorage.getItem(CREDENTIAL_KEY);
  if (!handle) return false;

  // FIX 2026-04-23: Aparajita plugin verify path — the real native one.
  const aparajita = getAparajitaBiometric();
  if (aparajita) {
    try {
      // FIX 2026-04-23 (v3): same WEAK + device-credential pattern as enroll
      // so the verify step doesn't fail on Realme / Oppo / Xiaomi optical
      // under-display sensors that are Class-2 biometry.
      await aparajita.authenticate({
        reason: "Verify your identity to open SOSphere",
        androidTitle: "SOSphere",
        androidSubtitle: "Scan fingerprint, face, or use device PIN",
        allowDeviceCredential: true,
        androidBiometryStrength: 0,
        androidConfirmationRequired: false,
      } as never);
      _verifiedThisSession = true;
      return true;
    } catch (err) {
      console.warn("[Biometric] Aparajita verify failed:", err);
      return false;
    }
  }

  const native = getNativePlugin();
  if (native) {
    try {
      const { success } = await native.authenticate({ reason: "Verify your identity" });
      if (success) {
        _verifiedThisSession = true;
        // S-H2: record server-side audit breadcrumb. Fire-and-forget —
        // a failed server write must NOT prevent the user's verified
        // state from being accepted locally.
        void (async () => {
          try {
            const { recordBiometricVerification } = await import("./api/biometric-server");
            await recordBiometricVerification("fingerprint");
          } catch { /* silent */ }
        })();
      }
      return success;
    } catch {
      return false;
    }
  }

  try {
    if (!await webauthnAvailable()) return false;

    const publicKey: PublicKeyCredentialRequestOptions = {
      challenge: randomChallenge(),
      timeout: 60_000,
      userVerification: "required",
      allowCredentials: [
        { type: "public-key", id: b64uToBuf(handle) },
      ],
    };

    const assertion = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
    if (!assertion) return false;

    // We treat a successful user-verifying assertion as verification.
    // For server-side replay protection you would round-trip the challenge
    // through a backend — SOSphere keeps this local-only by design.
    _verifiedThisSession = true;
    // S-H2: record server-side audit breadcrumb. Fire-and-forget —
    // a failed server write must NOT prevent the user's verified
    // state from being accepted locally.
    void (async () => {
      try {
        const { recordBiometricVerification } = await import("./api/biometric-server");
        await recordBiometricVerification("webauthn");
      } catch { /* silent */ }
    })();
    return true;
  } catch (e) {
    console.warn("[Biometric] Verification failed:", e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Public: session flag + teardown
// ─────────────────────────────────────────────────────────────
export function isBiometricVerified(): boolean {
  return _verifiedThisSession;
}

/** Clears the session "verified" flag — call after sensitive action completes. */
export function clearBiometricSession(): void {
  _verifiedThisSession = false;
}

export function unenrollBiometric(): void {
  localStorage.removeItem(CREDENTIAL_KEY);
  localStorage.removeItem(USER_ID_KEY);
  _verifiedThisSession = false;
}
