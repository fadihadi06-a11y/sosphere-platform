import { createClient } from "@supabase/supabase-js";
import { setStorageBackend, configureSupabaseStorage } from "./storage-adapter";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Only connect when both env vars are present
const _isConfigured = Boolean(
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_ANON_KEY.length > 20
);

if (!_isConfigured) {
  console.warn(
    "[Supabase] Running in OFFLINE mode — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to enable backend."
  );
}

// Safe fallback: use placeholder values so createClient() never throws
// All queries will fail gracefully when not configured
export const supabase = createClient(
  SUPABASE_URL || "https://placeholder.supabase.co",
  SUPABASE_ANON_KEY || "placeholder-anon-key",
  {
    auth: {
      persistSession: _isConfigured,
      autoRefreshToken: _isConfigured,
      detectSessionInUrl: true,  // ← critical typo fix (audit 2026-05-01)
      // The previous typo `detectSessionFromUrl` caused supabase-js to
      // OVERWRITE its internal default (which IS true) with `undefined`,
      // disabling automatic PKCE/implicit OAuth-callback detection. This
      // is what was causing the "Loading SOSphere" hang after Sign in
      // with Google: the ?code= in the redirect URL was never exchanged
      // for a session, so SIGNED_IN never fired and the auth listener
      // was waiting forever. Verified by reading
      // node_modules/@supabase/auth-js/dist/main/GoTrueClient.js where
      // line `this.detectSessionInUrl = settings.detectSessionInUrl;`
      // overwrites the constructor default of `true`.
      // SECURITY (2026-04-30): switched from "implicit" to "pkce".
      // Implicit places access_token in URL hash where it leaks to
      // extensions, document.referrer, analytics. PKCE is the OAuth
      // 2.1 standard for SPAs — single-use code exchanged for tokens.
      flowType: "pkce",
    },
  }
);

export const SUPABASE_CONFIG = {
  url: SUPABASE_URL || "",
  anonKey: SUPABASE_ANON_KEY || "",
  isConfigured: _isConfigured,
};

/**
 * MISSION-CRITICAL: Validates that Supabase is properly configured.
 * Call this at app startup. Returns a warning object if degraded.
 */
export function validateSupabaseConfig(): { ready: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (!_isConfigured) {
    warnings.push("Supabase backend is NOT configured. SOS signals will only be stored locally.");
    warnings.push("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to enable server sync.");
  }
  if (SUPABASE_URL && !SUPABASE_URL.startsWith("https://")) {
    warnings.push("Supabase URL must use HTTPS for encrypted transit.");
  }
  return { ready: _isConfigured, warnings };
}

// E1.6-PHASE3 (2026-05-04): _acquireLock instrumentation removed after
// root cause identified — see git history for the full diagnostic
// wrapper if it ever needs to be re-introduced for future debugging.

// ── Auto-configure Storage Adapter when Supabase is connected ──
if (_isConfigured) {
  setStorageBackend("supabase");
  configureSupabaseStorage({
    client: supabase,
    bucketName: "evidence",
  });
  console.log("[Supabase] Storage adapter configured — using Supabase backend");
}

export async function testConnection() {
  const { error } = await supabase.from("companies").select("id").limit(1);
  if (error) { console.error("[Supabase] Failed:", error.message); return false; }
  console.log("[Supabase] Connected!");
  return true;
}

export async function signInWithPhone(phone: string) {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  return { error: error?.message || null };
}

export async function verifyOTP(phone: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  return { error: error?.message || null, session: data.session };
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function signOut() {
  // S-H5: delegate to completeLogout() so local caches, localStorage
  // keys, permission cache, and singleton services are all torn down
  // alongside the Supabase-side session revocation. Callers never
  // need to do manual cleanup anymore.
  const { completeLogout } = await import("./complete-logout");
  await completeLogout();
}

/**
 * Sign in with Google using NATIVE account picker (no browser redirect).
 * Uses @codetrix-studio/capacitor-google-auth for native Android picker,
 * then exchanges the idToken with Supabase via signInWithIdToken().
 *
 * Flow: Native picker → idToken → Supabase session (zero browser involvement)
 */
export async function signInWithGoogle(): Promise<{ session: any | null; error: string | null }> {
  if (!_isConfigured) {
    return { session: null, error: "Supabase not configured." };
  }

  try {
    const { GoogleAuth } = await import("@codetrix-studio/capacitor-google-auth");

    await GoogleAuth.initialize({
      clientId: "380367770593-0a65j29596vq3kgc8b53l2b667khgf97.apps.googleusercontent.com",
      scopes: ["profile", "email"],
      // grantOfflineAccess: true → maps to requestServerAuthCode(clientId, true)
      // in the native Java plugin. The 'true' parameter forces Google to show
      // the consent/authentication screen ("Is this you?") every time,
      // even for basic scopes like profile and email.
      grantOfflineAccess: true,
    });

    // The native Java signIn() has been patched to internally call
    // revokeAccess() + signOut() BEFORE launching the Google intent.
    // This forces Google Play Services to show the full account picker
    // and consent screen every time — no JS-side workaround needed.
    const googleUser = await GoogleAuth.signIn();

    const idToken = googleUser?.authentication?.idToken;
    if (!idToken) {
      console.warn("[GoogleAuth] No idToken returned:", googleUser);
      return { session: null, error: "No idToken returned." };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });

    if (error) {
      console.error("[GoogleAuth] Supabase error:", error.message);
      return { session: null, error: error.message };
    }

    // DD-8 (2026-04-27): no email in production logs. Log uid suffix only.
    console.log("[GoogleAuth] Success:", data.user?.id?.slice(0, 8) ? data.user.id.slice(0, 8) + "…" : "(no uid)");
    return { session: data.session, error: null };
  } catch (err: any) {
    const msg = err?.message || err?.toString() || "Unknown error";

    if (msg.includes("cancel") || msg.includes("popup_closed") || msg.includes("12501")) {
      return { session: null, error: null };
    }

    console.error("[GoogleAuth] Error:", msg);
    return { session: null, error: msg };
  }
}

/**
 * Get authenticated user info from the current Supabase session.
 * Navigation decisions (new vs returning) are handled by the caller
 * based on local state (consent flags, saved profile), NOT this function.
 */
export async function getGoogleUserInfo() {
  const session = await getSession();
  if (!session?.user) return null;

  const user = session.user;
  const meta = user.user_metadata || {};

  return {
    id: user.id,
    email: meta.email || user.email || "",
    name: meta.full_name || meta.name || "",
    avatar: meta.avatar_url || meta.picture || "",
    provider: user.app_metadata?.provider || "unknown",
    isNewUser: !meta.profile_completed,
  };
}

/**
 * Mark Google user's profile as completed in Supabase user_metadata.
 */
export async function markProfileCompleted(name: string, phone?: string) {
  const { error } = await supabase.auth.updateUser({
    data: {
      full_name: name,
      phone: phone || undefined,
      profile_completed: true,
    },
  });
  return { error: error?.message || null };
}

// ── Read role + company_id from JWT claims (set by custom_access_token_hook) ──
function decodeJWTPayload(token: string): Record<string, any> {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return {};
  }
}

export function getRoleFromSession(session: any): string {
  if (!session?.access_token) return "employee";
  // Primary: custom JWT claim injected by custom_access_token_hook
  const payload = decodeJWTPayload(session.access_token);
  if (payload.user_role) return payload.user_role as string;
  // Fallback: user_metadata (set at registration time)
  return session?.user?.user_metadata?.role || "employee";
}

export function getCompanyIdFromSession(session: any): string | null {
  if (!session?.access_token) return null;
  const payload = decodeJWTPayload(session.access_token);
  // Primary: JWT claim from custom_access_token_hook
  if (payload.company_id) return payload.company_id as string;
  // Fallback: user_metadata
  return session?.user?.user_metadata?.company_id || null;
}

// =================================================================
// Rate Limiter — prevents abuse on critical actions
// =================================================================
const _rateBuckets = new Map<string, number[]>();

/**
 * Client-side rate limiter for critical actions.
 * @param key   Unique action key (e.g. "invite_send", "emergency_resolve")
 * @param max   Maximum calls allowed within the window
 * @param windowMs  Time window in milliseconds (default: 60 000 = 1 min)
 * @returns true if action is allowed, false if rate-limited
 */
export function checkRateLimit(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = _rateBuckets.get(key) ?? [];
  // Prune expired entries
  const valid = bucket.filter(t => t > now - windowMs);
  if (valid.length >= max) {
    _rateBuckets.set(key, valid);
    return false; // rate-limited
  }
  valid.push(now);
  _rateBuckets.set(key, valid);
  return true; // allowed
}

/**
 * Form submission debounce — prevents double-clicks and rapid re-submissions.
 * Returns a wrapped async function that ignores calls within cooldownMs of last call.
 */
export function debounceSubmit<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  cooldownMs = 2000
): (...args: Parameters<T>) => Promise<ReturnType<T> | undefined> {
  let lastCall = 0;
  return async (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall < cooldownMs) {
      console.warn("[RateLimit] Submission blocked — too fast (cooldown " + cooldownMs + "ms)");
      return undefined;
    }
    lastCall = now;
    return fn(...args) as ReturnType<T>;
  };
}

/**
 * Server-enforced rate limiter via Supabase RPC.
 * Falls back to client-side check if Edge Function unavailable.
 */
export async function checkServerRateLimit(
  action: string,
  userId: string,
  maxPerMinute: number
): Promise<boolean> {
  if (!_isConfigured) return checkRateLimit(action, maxPerMinute);
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_action: action,
      p_user_id: userId,
      p_max_per_minute: maxPerMinute,
    });
    if (error) {
      console.warn("[RateLimit] Server check failed, using client fallback:", error.message);
      return checkRateLimit(action, maxPerMinute);
    }
    return data === true;
  } catch {
    return checkRateLimit(action, maxPerMinute);
  }
}

// ═══════════════════════════════════════════════════════════════
// SESSION FINGERPRINTING — Anti-Hijack Defense
// Binds session to device characteristics. If fingerprint changes,
// forces re-authentication to prevent token theft via XSS.
// ═══════════════════════════════════════════════════════════════

const FINGERPRINT_KEY = "sosphere_device_fp";

/** Generate a stable device fingerprint from browser characteristics */
async function generateDeviceFingerprint(): Promise<string> {
  const components = [
    // HARDENING: Removed navigator.userAgent — changes on every Chrome update
    // Using stable components only to prevent false-positive logout during emergencies
    navigator.language,
    navigator.hardwareConcurrency?.toString() || "0",
    screen.width + "x" + screen.height,
    screen.colorDepth?.toString() || "24",
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.maxTouchPoints?.toString() || "0",
    navigator.platform || "unknown",
    // Canvas fingerprint (stable across sessions and browser updates)
    await getCanvasFingerprint(),
  ];
  const raw = components.join("|");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Canvas-based fingerprint component */
function getCanvasFingerprint(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 50;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve("no-canvas"); return; }
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillStyle = "#f60";
      ctx.fillRect(0, 0, 200, 50);
      ctx.fillStyle = "#069";
      ctx.fillText("SOSphere-FP", 2, 15);
      resolve(canvas.toDataURL().slice(-32));
    } catch {
      resolve("canvas-error");
    }
  });
}

/** Validate current session against stored fingerprint.
 *  @param skipDuringEmergency If true, always returns valid (prevents logout during active SOS)
 */
export async function validateSessionFingerprint(skipDuringEmergency: boolean = false): Promise<{
  valid: boolean;
  reason?: string;
  fingerprint: string;
}> {
  // HARDENING: Never invalidate session during active emergency
  // A forced re-auth during SOS could kill the emergency signal
  if (skipDuringEmergency) {
    const currentFP = await generateDeviceFingerprint();
    return { valid: true, fingerprint: currentFP };
  }

  const currentFP = await generateDeviceFingerprint();
  const storedFP = localStorage.getItem(FINGERPRINT_KEY);

  if (!storedFP) {
    // First login on this device — store fingerprint
    localStorage.setItem(FINGERPRINT_KEY, currentFP);
    return { valid: true, fingerprint: currentFP };
  }

  if (storedFP !== currentFP) {
    // ── S-H1: bounded grace window ──────────────────────────────
    // Fingerprint mismatches legitimately happen for a few reasons:
    //   • Browser auto-update bumped the UA string
    //   • Chrome's canvas fingerprint randomisation toggled
    //   • User cleared one cookie / changed display resolution
    //
    // A hard logout on every such event is hostile UX. BUT a
    // fingerprint change IS also the signature we'd expect from a
    // stolen-JWT attack — same token, different device. The
    // grace-window compromise:
    //
    //   1. First mismatch → stamp sosphere_fp_grace_until =
    //      Date.now() + 10min. Return valid=false BUT signal
    //      grace_active=true so the caller can show a soft
    //      "re-confirm identity" prompt instead of a logout.
    //
    //   2. Within the grace window, bindSessionToDevice() (called
    //      on a successful re-auth) updates the stored fingerprint
    //      and clears the grace marker — legitimate user is saved.
    //
    //   3. After the window expires, the session is fully
    //      invalidated. An attacker who can't satisfy the
    //      re-auth challenge within 10 minutes gets kicked.
    const GRACE_KEY = "sosphere_fp_grace_until";
    const GRACE_WINDOW_MS = 10 * 60 * 1000;
    const now = Date.now();
    let graceUntil = 0;
    try {
      const raw = localStorage.getItem(GRACE_KEY);
      graceUntil = raw ? parseInt(raw, 10) || 0 : 0;
    } catch { /* ignore */ }

    // First mismatch this session — open the window.
    if (graceUntil === 0 || graceUntil < now - GRACE_WINDOW_MS) {
      try { localStorage.setItem(GRACE_KEY, String(now + GRACE_WINDOW_MS)); } catch { /* ignore */ }
      graceUntil = now + GRACE_WINDOW_MS;
    }

    const graceActive = graceUntil > now;
    return {
      valid: false,
      reason: graceActive
        ? "Device signature changed — please re-confirm your identity."
        : "Device signature changed and grace window expired — signed out.",
      fingerprint: currentFP,
      graceActive,
      graceExpiresAt: graceUntil,
    } as any;
  }

  // Matching fingerprint — clear any lingering grace marker.
  try { localStorage.removeItem("sosphere_fp_grace_until"); } catch { /* ignore */ }
  return { valid: true, fingerprint: currentFP };
}

/** Bind a new session to the current device.
 *  S-H1: clears the grace marker so a subsequent fingerprint match
 *  is treated as fully-validated rather than still in-grace. */
export async function bindSessionToDevice(): Promise<void> {
  const fp = await generateDeviceFingerprint();
  localStorage.setItem(FINGERPRINT_KEY, fp);
  try { localStorage.removeItem("sosphere_fp_grace_until"); } catch { /* ignore */ }
}

/** Clear device fingerprint (on logout) */
export function clearDeviceFingerprint(): void {
  localStorage.removeItem(FINGERPRINT_KEY);
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTION ENVIRONMENT GUARD
// Validates ALL required environment variables on app startup.
// In production builds, missing critical vars trigger visible error.
// ═══════════════════════════════════════════════════════════════

interface EnvValidation {
  ready: boolean;
  missing: string[];
  warnings: string[];
}

/** Validate production environment. Call from main.tsx on startup. */
export function validateProductionEnvironment(): EnvValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const isProd = import.meta.env.PROD;

  // Critical: Supabase (required for any backend functionality)
  if (!_isConfigured) {
    if (isProd) {
      missing.push("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY — Backend is OFFLINE. SOS signals will NOT reach administrators.");
    } else {
      warnings.push("Supabase not configured — running in offline/demo mode.");
    }
  }

  // Critical: Sentry (required for production error monitoring)
  if (!import.meta.env.VITE_SENTRY_DSN) {
    if (isProd) {
      missing.push("VITE_SENTRY_DSN — Error tracking is DISABLED. Production crashes will be invisible. This is a life-safety system — you MUST configure Sentry.");
    } else {
      warnings.push("Sentry DSN not configured — errors will only log to console.");
    }
  }

  // Important: Firebase for push notifications
  if (!import.meta.env.VITE_FIREBASE_API_KEY) {
    warnings.push("Firebase not configured — push notifications disabled. Workers won't receive background SOS alerts.");
  }

  // Important: Twilio for voice calls
  if (!import.meta.env.VITE_TWILIO_ENABLED) {
    warnings.push("Twilio not configured — voice calls will use browser-only WebRTC (no PSTN).");
  }

  return {
    ready: missing.length === 0,
    missing,
    warnings,
  };
}
