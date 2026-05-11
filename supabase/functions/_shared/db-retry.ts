// ═══════════════════════════════════════════════════════════════
// SOSphere — Layer 4 (L4-A) — DB retry-with-backoff
// ─────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//   L2-A wrapped Twilio (external) in a circuit breaker. Supabase
//   calls in the SOS critical path (sos_sessions UPSERT, atomic
//   claim UPDATE, dispatch ledger writes) had NO retry. A 200ms
//   Postgres reconnect, a transient 503 from PgBouncer, a brief
//   network jitter — any one drops the write and leaves the SOS
//   in an ambiguous state.
//
//   This helper retries ONLY on transient signals:
//     • network errors (TypeError "fetch failed", AbortError)
//     • HTTP 5xx (transient server fault — could recover)
//     • Postgres connection errors (PG codes 08*** family)
//   It does NOT retry on:
//     • HTTP 4xx (programmer error — retrying just amplifies harm)
//     • PG constraint violations (22***, 23*** family — same row
//       would fail again)
//     • Anything else not on the allowlist
//
//   Caps: 2 retries (3 attempts total), 200ms → 800ms exponential
//   backoff, max 1.2s total added latency. Keeps the SOS dispatch
//   p95 inside the 3s budget even in the WORST case.
//
// PURE FUNCTION
//   No Deno globals, no Supabase client coupling — just a generic
//   "try this op, retry on these signals" wrapper. Importable from
//   vitest under Node, so the retry semantics are unit-testable.
// ═══════════════════════════════════════════════════════════════

/** Default retry budget. Tuned to keep the SOS critical-path
 * p95 < 3s even when the FIRST two attempts fail. */
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_INITIAL_BACKOFF_MS = 200;
export const DEFAULT_BACKOFF_CAP_MS = 800;

export interface RetryOptions {
  maxRetries?: number;          // default 2
  initialBackoffMs?: number;    // default 200
  backoffCapMs?: number;        // default 800
  /** Optional hook for telemetry — fired BEFORE each retry attempt. */
  onRetry?: (attempt: number, error: unknown) => void;
}

/** Heuristic: is this error transient + worth retrying?
 *
 * Returns true on:
 *  - Network-level failures (fetch threw, abort signal, ECONNRESET-like)
 *  - HTTP 5xx codes attached to the error
 *  - Postgres connection-family error codes (08***)
 *
 * Returns false on:
 *  - HTTP 4xx (programmer error)
 *  - PG constraint codes (22***, 23***, 25***)
 *  - Anything not on the allowlist
 *
 * Defensive: returns false on null/undefined error (no error => not transient).
 */
export function isTransientError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  const e = err as { message?: string; status?: number; code?: string; name?: string };

  // Network errors — name AbortError, TypeError "fetch failed", DOMException
  if (e.name === "AbortError") return true;
  if (e.name === "TypeError" && typeof e.message === "string" && /fetch failed|network/i.test(e.message)) return true;

  // HTTP 5xx from Supabase SDK errors. Supabase responses surface
  // status either on .status or inside .message; check both.
  if (typeof e.status === "number" && e.status >= 500 && e.status < 600) return true;
  if (typeof e.message === "string" && /\b5\d\d\b/.test(e.message) && /server|gateway|timeout|503|502|504/i.test(e.message)) return true;

  // Postgres connection-family error codes (08***):
  //   08000 connection_exception
  //   08003 connection_does_not_exist
  //   08006 connection_failure
  //   08001 sqlclient_unable_to_establish_sqlconnection
  //   08004 sqlserver_rejected_establishment_of_sqlconnection
  //   08007 transaction_resolution_unknown
  //   08P01 protocol_violation
  if (typeof e.code === "string" && /^08/.test(e.code)) return true;

  return false;
}

/** Sleep helper. Separated so the test can stub it. */
export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wrap a single Supabase / fetch / generic async op with retry-on-
 * transient. Returns the operation's result on first success, or
 * throws the LAST error after retries are exhausted.
 *
 * The op is called WITH a fresh attempt count each time — useful if
 * the op wants to log/distinguish first-vs-retry behavior.
 */
export async function withDbRetry<T>(
  op: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialBackoffMs = opts.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const backoffCapMs = opts.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await op(attempt);
    } catch (err) {
      lastError = err;
      // Last attempt: rethrow without delay.
      if (attempt === maxRetries) break;
      // Non-transient error: rethrow immediately (no point retrying).
      if (!isTransientError(err)) throw err;
      // Backoff before retrying — capped exponential.
      const backoff = Math.min(initialBackoffMs * Math.pow(2, attempt), backoffCapMs);
      try { opts.onRetry?.(attempt + 1, err); } catch { /* telemetry hook must never break the retry */ }
      await sleepMs(backoff);
    }
  }
  throw lastError;
}
