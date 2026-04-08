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
      detectSessionFromUrl: true,
      flowType: "implicit",
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
  await supabase.auth.signOut();
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
