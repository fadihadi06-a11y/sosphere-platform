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
  // Native plugin wins if present
  const native = getNativePlugin();
  if (native) {
    try {
      const { available } = await native.isAvailable();
      if (!available) return "not_available";
      // With native plugin, "enrollment" is implicit (the OS keystore) —
      // we still track our own flag so the UI can prompt on first use.
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

  const native = getNativePlugin();
  if (native) {
    try {
      const { success } = await native.authenticate({ reason: "Verify your identity" });
      if (success) _verifiedThisSession = true;
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
