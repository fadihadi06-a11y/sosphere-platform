import { createClient } from "@supabase/supabase-js";

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
