// ═══════════════════════════════════════════════════════════════════════════
// utils/age-verification — fail-secure helper for the is_age_verified RPC
// ─────────────────────────────────────────────────────────────────────────
// 2026-04-25 (F-B): the prior call site in mobile-app.tsx defaulted
//   `ageVerified = true` and let the user proceed whenever the RPC errored
//   or threw. That fail-OPEN policy was identical to the bug fixed in
//   B-10 for sos-alert. An attacker could DNS-poison or MITM the
//   Supabase host long enough to force the catch branch and bypass
//   COPPA / GDPR Art. 8 entirely.
//
// New contract:
//   - Default verified = FALSE (fail-secure).
//   - Up to N attempts (default 2) with backoff between them, so a
//     transient blip doesn't bounce a legitimate user to the register
//     screen on every session restore.
//   - The result is a discriminated union — the call site can decide
//     whether to display a banner, retry manually, or route to the
//     register flow. We do NOT silently navigate; that's the caller's
//     responsibility (UX policy belongs at the call site).
//
// The helper is decoupled from supabase-js so it's easy to unit-test:
//   the caller passes the RPC invocation as `rpcFn`. Tests can stub
//   any failure / timeout / shape.
// ═══════════════════════════════════════════════════════════════════════════

export type AgeVerifyResult =
  | { verified: true;  reason: "verified" }
  | { verified: false; reason: "not_verified" }   // RPC returned data === false
  | { verified: false; reason: "no_profile" }     // RPC returned null/undefined
  | { verified: false; reason: "rpc_error" };     // all attempts errored

export interface AgeVerifyRpcResponse {
  data: unknown;
  error: unknown;
}

export interface CheckAgeOpts {
  /** The RPC invocation. Must resolve to {data, error}. Tests can stub. */
  rpcFn: () => Promise<AgeVerifyRpcResponse>;
  /** Total attempts including the first. Defaults to 2. Min 1. */
  maxAttempts?: number;
  /** Delay between attempts in ms. Defaults to 500. */
  retryDelayMs?: number;
  /**
   * Hard ceiling for the entire operation in ms. Defaults to 5000.
   * If exceeded, returns rpc_error so the UI can show a retry banner.
   */
  totalTimeoutMs?: number;
}

const DEFAULT_MAX = 2;
const DEFAULT_DELAY = 500;
const DEFAULT_TIMEOUT = 5000;

/**
 * Fail-secure age-verification check. NEVER returns verified:true unless
 * the RPC explicitly responded with `data === true` and no error.
 */
export async function checkAgeVerifiedFailSecure(opts: CheckAgeOpts): Promise<AgeVerifyResult> {
  const max = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX);
  const delay = Math.max(0, opts.retryDelayMs ?? DEFAULT_DELAY);
  const ceiling = Math.max(100, opts.totalTimeoutMs ?? DEFAULT_TIMEOUT);
  const startedAt = Date.now();

  for (let attempt = 0; attempt < max; attempt++) {
    if (Date.now() - startedAt >= ceiling) {
      return { verified: false, reason: "rpc_error" };
    }

    try {
      const remaining = ceiling - (Date.now() - startedAt);
      const res = await Promise.race<AgeVerifyRpcResponse>([
        opts.rpcFn(),
        new Promise<AgeVerifyRpcResponse>((_, rej) =>
          setTimeout(() => rej(new Error("age_verify_timeout")), Math.max(50, remaining))),
      ]);

      // Successful RPC call (server responded). Branch on shape.
      if (res && !res.error) {
        if (res.data === true)  return { verified: true, reason: "verified" };
        if (res.data === false) return { verified: false, reason: "not_verified" };
        // null/undefined or anything else → no profile yet (or RPC missing).
        return { verified: false, reason: "no_profile" };
      }
      // RPC returned an error object — retry.
    } catch {
      // Network error / timeout / RPC threw — retry.
    }

    if (attempt < max - 1) {
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }

  // All attempts exhausted → fail-secure.
  return { verified: false, reason: "rpc_error" };
}
