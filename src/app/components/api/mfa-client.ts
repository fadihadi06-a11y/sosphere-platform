/**
 * mfa-client.ts — typed wrappers around Supabase Auth MFA + recovery codes.
 *
 * Pairs Supabase's built-in `auth.mfa.*` (TOTP enroll / verify) with
 * SOSphere's custom recovery-code RPCs (mfa_generate_recovery_codes,
 * mfa_consume_recovery_code, mfa_recovery_status). Single import, single
 * mental model for any UI that touches MFA.
 *
 * Why a wrapper instead of calling supabase.auth.mfa.* directly:
 *   1. Uniform { data, error } shape across enroll / verify / recovery —
 *      the underlying APIs vary slightly and that hurts the UI code.
 *   2. Recovery-code RPCs go through safeRpc (lock-free direct fetch),
 *      same as our other critical-path RPCs.
 *   3. listFactors() is normalized to a `hasTotp` boolean for the
 *      common "should I prompt for MFA?" check.
 *   4. Friendly error mapping for the common Supabase MFA error codes
 *      (mfa_factor_already_exists, invalid_code, etc).
 */

import { supabase } from "./supabase-client";
import { safeRpc } from "./safe-rpc";

export interface MfaEnrollData {
  factorId: string;
  qrCodeSvg: string;     // SVG <svg>...</svg> — render via dangerouslySetInnerHTML
  secret: string;        // The base32 TOTP secret, in case the user can't scan
  uri: string;           // otpauth:// URI (alternative QR source)
}

export interface MfaResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/**
 * Begin TOTP enrollment. Returns a QR code SVG + secret for the user to
 * scan into Authy / Google Authenticator / 1Password / etc.
 *
 * After the user enters a 6-digit code from the app, call mfaVerifyEnroll
 * with that code to ACTIVATE the factor. Until verification, the factor
 * exists in `unverified` state and won't be required at sign-in.
 */
export async function mfaEnrollTotp(): Promise<MfaResult<MfaEnrollData>> {
  try {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `SOSphere · ${new Date().toISOString().slice(0, 10)}`,
    });
    if (error) {
      return { data: null, error: { message: friendly(error.message), code: error.code } };
    }
    if (!data?.id || !data.totp) {
      return { data: null, error: { message: "Enroll returned no factor data" } };
    }
    return {
      data: {
        factorId:  data.id,
        qrCodeSvg: data.totp.qr_code,
        secret:    data.totp.secret,
        uri:       data.totp.uri,
      },
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Verify the 6-digit code shown by the authenticator app. On success the
 * factor moves to `verified` state and Supabase will require it at
 * future sign-ins (subject to the AAL policy).
 */
export async function mfaVerifyEnroll(
  factorId: string,
  code: string,
): Promise<MfaResult<{ activated: true }>> {
  try {
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data?.id) {
      return { data: null, error: { message: friendly(challenge.error?.message || "Could not start MFA challenge") } };
    }
    const verify = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    if (verify.error) {
      return { data: null, error: { message: friendly(verify.error.message), code: verify.error.code } };
    }
    return { data: { activated: true }, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Used at sign-in: same shape as mfaVerifyEnroll, but for an already
 * verified factor. Returns an upgraded session with AAL2.
 */
export async function mfaChallengeAndVerify(
  factorId: string,
  code: string,
): Promise<MfaResult<{ aal: string }>> {
  try {
    const r = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.trim(),
    });
    if (r.error) {
      return { data: null, error: { message: friendly(r.error.message), code: r.error.code } };
    }
    return { data: { aal: "aal2" }, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Returns the user's MFA factors and a convenience boolean for the most
 * common "does this user need to be prompted?" check.
 */
export async function mfaListFactors(): Promise<MfaResult<{
  factors: { id: string; type: string; status: string }[];
  hasTotp: boolean;
}>> {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      return { data: null, error: { message: friendly(error.message) } };
    }
    const factors = (data?.totp || []).map(f => ({ id: f.id, type: "totp", status: f.status }));
    return {
      data: {
        factors,
        hasTotp: factors.some(f => f.status === "verified"),
      },
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Removes a TOTP factor. After this, the user's account drops back to
 * password-only sign-in. Recovery codes for the user are intentionally
 * NOT auto-wiped — the user might immediately re-enroll, and stale
 * recovery codes from the previous factor are still hashed-only DB rows
 * (rotating them is a separate user choice via mfaGenerateRecoveryCodes).
 */
export async function mfaUnenroll(factorId: string): Promise<MfaResult<{ removed: true }>> {
  try {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      return { data: null, error: { message: friendly(error.message) } };
    }
    return { data: { removed: true }, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Generates 8 single-use recovery codes. Plaintext is returned ONCE — the
 * UI must persuade the user to print or save them. Calling again invalidates
 * the previous set.
 */
export async function mfaGenerateRecoveryCodes(): Promise<MfaResult<{ codes: string[] }>> {
  const { data, error } = await safeRpc<{ ok?: boolean; codes?: string[] }>(
    "mfa_generate_recovery_codes",
    {},
    { timeoutMs: 8000 },
  );
  if (error) return { data: null, error: { message: friendly(error.message) } };
  if (!data?.ok || !Array.isArray(data.codes)) {
    return { data: null, error: { message: "Could not generate recovery codes" } };
  }
  return { data: { codes: data.codes }, error: null };
}

/**
 * Burns one recovery code. Returns the remaining count so the UI can
 * nudge the user to regenerate when only 1-2 are left.
 */
export async function mfaConsumeRecoveryCode(
  code: string,
): Promise<MfaResult<{ remaining: number }>> {
  const { data, error } = await safeRpc<{ ok?: boolean; reason?: string; remaining?: number }>(
    "mfa_consume_recovery_code",
    { p_code: code },
    { timeoutMs: 8000 },
  );
  if (error) return { data: null, error: { message: friendly(error.message) } };
  if (!data?.ok) {
    return { data: null, error: { message: data?.reason === "invalid_or_used"
      ? "Invalid or already-used recovery code."
      : "Recovery code rejected." } };
  }
  return { data: { remaining: data.remaining ?? 0 }, error: null };
}

/**
 * Settings-page status — does the user have any unused recovery codes,
 * and when was the last set generated?
 */
export async function mfaRecoveryStatus(): Promise<MfaResult<{
  hasCodes: boolean;
  remaining: number;
  lastGeneratedAt: string | null;
}>> {
  const { data, error } = await safeRpc<{
    has_codes?: boolean; remaining?: number; last_generated_at?: string | null;
  }>("mfa_recovery_status", {}, { timeoutMs: 6000 });
  if (error) return { data: null, error: { message: friendly(error.message) } };
  return {
    data: {
      hasCodes:        !!data?.has_codes,
      remaining:       data?.remaining ?? 0,
      lastGeneratedAt: data?.last_generated_at ?? null,
    },
    error: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function friendly(msg: string): string {
  if (!msg) return "Unknown error";
  const m = msg.toLowerCase();
  if (m.includes("invalid") && m.includes("code")) return "Invalid code. Try again.";
  if (m.includes("expired"))                       return "Code expired. Open your authenticator app for a fresh one.";
  if (m.includes("rate"))                          return "Too many attempts. Try again in a minute.";
  if (m.includes("already") && m.includes("exists")) return "An MFA factor is already enrolled. Disable it first to re-enroll.";
  return msg;
}

/**
 * AUTH-4 Part 2 (#208) — lock-free factors listing for the login gate.
 *
 * supabase.auth.mfa.listFactors() goes through the SDK's _acquireLock,
 * which we have proven can wedge mid-OAuth callback. That meant the
 * MFA gate silently fell through to pin-verify, defeating the whole
 * point of the second factor.
 *
 * This implementation goes directly to /auth/v1/factors with the
 * bearer token from localStorage and a hard 6 s timeout. It returns
 * the same shape as mfaListFactors so callers can swap in.
 */
export async function mfaListFactorsLockFree(): Promise<MfaResult<{
  factors: { id: string; type: string; status: string }[];
  hasTotp: boolean;
}>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SUPABASE_URL: string = ((import.meta as any).env?.VITE_SUPABASE_URL as string | undefined) || "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ANON_KEY: string = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined) || "";
  if (!SUPABASE_URL || !ANON_KEY) {
    return { data: null, error: { message: "Supabase not configured" } };
  }
  const { getStoredBearerToken } = await import("./safe-rpc");
  const token = getStoredBearerToken();
  if (!token) return { data: null, error: { message: "no-session" } };

  const ctrl = new AbortController();
  const tmId = setTimeout(() => ctrl.abort(), 6000);
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/factors`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      return { data: null, error: { message: `HTTP ${resp.status}` } };
    }
    const body = await resp.json();
    // The endpoint returns { all: [...], totp: [...] } in supabase-js v2.39+
    // and just an array in older versions. Normalize.
    const totpRaw = (body && (body.totp || (Array.isArray(body) ? body.filter((f: { factor_type?: string; status?: string }) => f.factor_type === "totp") : []))) || [];
    const factors = (totpRaw as { id: string; status: string }[]).map(f => ({ id: f.id, type: "totp", status: f.status }));
    return {
      data: {
        factors,
        hasTotp: factors.some(f => f.status === "verified"),
      },
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  } finally {
    clearTimeout(tmId);
  }
}
