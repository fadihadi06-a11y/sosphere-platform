// ═══════════════════════════════════════════════════════════════
// SOSphere — Client-side Rate-Limit Helpers
// ─────────────────────────────────────────────────────────────
// Server-side rate limiting is defined in
// `supabase/functions/_shared/rate-limiter.ts`. That module is the
// source of truth — it returns 429 with `Retry-After` when clients
// exceed per-tier budgets. Every hardened endpoint also returns
// `X-RateLimit-*` headers on the happy path so clients can
// self-throttle before hitting a wall.
//
// This module is the client-side half: parse the headers, expose
// the budget to caller code, and (optionally) wait out a 429 before
// retrying. Kept small and dependency-free so it can be imported
// from both the SOS hot path and the Twilio voice provider without
// pulling in any React state.
//
// Design invariant: we NEVER swallow a 429. If the caller decides
// not to use `waitForRetry`, they still get an explicit
// `RateLimitExceededError` so the request is visible as a failure
// rather than a silent drop.
// ═══════════════════════════════════════════════════════════════

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number;            // Unix seconds (matches server header)
  priority: "sos" | "high" | "normal" | "throttled" | "unknown";
  retryAfterMs: number;       // 0 unless the response was 429
}

/**
 * Parse X-RateLimit-* headers into a structured budget snapshot.
 *
 * Missing or malformed headers fall back to "unknown" rather than
 * throwing — endpoints that aren't yet hardened simply won't emit
 * them, and the client must degrade gracefully until they catch up.
 */
export function parseRateLimit(response: Response): RateLimitInfo {
  const hdr = (k: string) => response.headers.get(k);

  const limit = num(hdr("X-RateLimit-Limit"));
  const remaining = num(hdr("X-RateLimit-Remaining"));
  const resetAt = num(hdr("X-RateLimit-Reset"));
  const priority = (hdr("X-RateLimit-Priority") as RateLimitInfo["priority"]) || "unknown";

  // Retry-After is only present on 429 responses and is in seconds.
  const retryAfterSec = num(hdr("Retry-After"));
  const retryAfterMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 0;

  return {
    limit: Number.isFinite(limit) ? limit : 0,
    remaining: Number.isFinite(remaining) ? remaining : 0,
    resetAt: Number.isFinite(resetAt) ? resetAt : 0,
    priority: priority || "unknown",
    retryAfterMs,
  };
}

function num(v: string | null): number {
  if (v === null || v === undefined) return Number.NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Thrown when a request is rejected with HTTP 429. Carries the
 * parsed rate-limit info so callers can decide between retrying,
 * failing fast, or routing to the user.
 */
export class RateLimitExceededError extends Error {
  public readonly info: RateLimitInfo;
  public readonly endpoint: string;

  constructor(endpoint: string, info: RateLimitInfo) {
    // Keep the message self-explanatory in crash logs.
    super(
      `Rate limit exceeded for ${endpoint}. ` +
      `Retry after ${Math.ceil(info.retryAfterMs / 1000)}s ` +
      `(limit=${info.limit}, priority=${info.priority}).`,
    );
    this.name = "RateLimitExceededError";
    this.info = info;
    this.endpoint = endpoint;
  }
}

/**
 * Cap on how long we'll sleep inside `waitForRetry` before giving
 * up. Without this, a pathological `Retry-After` (e.g. a server bug
 * returning 3600) would pin the UI for an hour. Real server limits
 * are always well under a minute.
 */
const MAX_WAIT_MS = 30_000;

/**
 * Sleep out the server-provided `Retry-After` budget. Returns
 * true if the wait completed normally, false if we truncated at
 * MAX_WAIT_MS (caller should give up in that case).
 */
export async function waitForRetry(info: RateLimitInfo): Promise<boolean> {
  if (info.retryAfterMs <= 0) return true;
  const capped = Math.min(info.retryAfterMs, MAX_WAIT_MS);
  await new Promise((r) => setTimeout(r, capped));
  return capped === info.retryAfterMs;
}

/**
 * Small structured log of a 429 for ops dashboards. Kept as a
 * standalone helper so we can swap the target (console, Sentry,
 * audit log) without editing every call site.
 */
export function logRateLimit(endpoint: string, info: RateLimitInfo): void {
  // We prefer `warn` over `error` because a 429 is expected behavior
  // under load — promoting it to `error` would drown real bugs in
  // Sentry. Ops dashboards still pick it up via structured search.
  console.warn(
    `[rate-limit] ${endpoint} throttled — retry in ${Math.ceil(
      info.retryAfterMs / 1000,
    )}s (priority=${info.priority}, limit=${info.limit}).`,
  );
}
