// ═══════════════════════════════════════════════════════════════
// SOSphere — Shared Rate-Limiter with SOS Priority Lane
// ─────────────────────────────────────────────────────────────
// Purpose:
//   A sliding-window rate limiter shared across all Edge Functions.
//   Used to protect SMS / call endpoints (Twilio is metered — an
//   unprotected anon endpoint is a direct path to bill-drain) without
//   ever blocking a legitimate emergency.
//
// Design:
//   • Sliding window per (key, tier). A key is typically userId, but
//     falls back to "ip:<addr>" for unauthenticated endpoints.
//   • Four tiers with different limits — pick the tier that matches
//     the endpoint's cost / abuse profile, not the call site's
//     convenience.
//   • SOS Priority Lane: any request where isSosRequest=true is
//     ALWAYS allowed. We still record the hit (for observability),
//     we just never return allowed:false. This is the single most
//     important invariant in the module — an SOS is the exact moment
//     we cannot afford to reject a request.
//   • markSosPriority(userId) boosts the user's limit across tiers
//     for the next 10 minutes. Useful when we expect a burst of
//     non-trigger calls during an active emergency (heartbeat,
//     escalate, end — plus retries of each).
//   • Per-instance only: each Edge Function cold-start gets a fresh
//     Map. That's intentional. A truly-distributed limiter needs
//     Redis/Postgres and would 5-10x the p99 of SOS trigger. We
//     accept slightly higher effective limits per region vs. a
//     catastrophic latency tax on the emergency path.
// ═══════════════════════════════════════════════════════════════

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  sosMultiplier: number;
  burstAllowance: number;   // extra requests allowed in any rolling 10s
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  priority: "sos" | "high" | "normal" | "throttled";
  limit: number;
  resetAt: number;          // Unix ms when current window ends
}

// Tier presets — tune here, all callers pick up the change.
// sos:     trigger/heartbeat/escalate/end — the SOS hot path. High
//          ceiling because a single emergency legitimately fires
//          dozens of requests in a minute (heartbeats + retries).
// auth:    OTP send, signup — Supabase itself rate-limits these, but
//          we add a second layer so a burst can't burn OTP budget
//          before Supabase's own limiter kicks in.
// api:     anything generic — default tier.
// webhook: Twilio status callbacks, Stripe webhooks — Twilio sends
//          many callbacks per call (initiated → ringing → answered →
//          completed) so we allow more headroom.
export const TIERS: Record<string, RateLimitConfig> = {
  sos:     { windowMs: 60_000, maxRequests: 200, sosMultiplier: 1,  burstAllowance: 50 },
  auth:    { windowMs: 60_000, maxRequests: 10,  sosMultiplier: 5,  burstAllowance: 3  },
  api:     { windowMs: 60_000, maxRequests: 60,  sosMultiplier: 10, burstAllowance: 15 },
  webhook: { windowMs: 60_000, maxRequests: 30,  sosMultiplier: 5,  burstAllowance: 10 },
};

// ── Internal state ─────────────────────────────────────────────
// key → array of request timestamps (ms). Kept pruned to the current
// window on every access. We store raw timestamps rather than a
// counter because the sliding window needs per-hit ages to decide
// when old entries expire — a counter-with-rollover loses accuracy
// at window boundaries and would double-count during flap.
const windows = new Map<string, number[]>();

// userId → unixMs when SOS priority expires. Users in this set get
// sosMultiplier applied on every lookup — a convenience for endpoints
// that don't know the request itself is SOS-related (e.g. the audio
// upload replay watcher firing while an emergency is still live).
const sosPriorityUntil = new Map<string, number>();
const SOS_PRIORITY_TTL_MS = 10 * 60 * 1000;  // 10 min per the guide

// Periodic cleanup — capped at once per minute to avoid wasting CPU
// on hot paths. This is best-effort: a Map that grows unbounded for
// a few extra seconds does not hurt.
let lastSweepAt = 0;
function maybeSweep(now: number): void {
  if (now - lastSweepAt < 60_000) return;
  lastSweepAt = now;
  for (const [key, hits] of windows) {
    // If every hit is older than the longest possible window (60s)
    // the key is dead. We use max windowMs across tiers.
    const cutoff = now - 60_000;
    const live = hits.filter(t => t > cutoff);
    if (live.length === 0) windows.delete(key);
    else windows.set(key, live);
  }
  for (const [user, expiresAt] of sosPriorityUntil) {
    if (expiresAt <= now) sosPriorityUntil.delete(user);
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Check whether a request is allowed under the current rate limit.
 *
 * @param key Identity for the limit — userId if authenticated, else
 *            "ip:<addr>" so anonymous traffic is still bucketed.
 * @param tier One of the TIER keys above.
 * @param isSosRequest If true, the request is SERVED regardless of
 *            the count. Set this for any endpoint that's on the
 *            emergency critical path (trigger, heartbeat, escalate,
 *            end, and audio upload during an active emergency).
 *
 * The hit is recorded in every case so we still get accurate stats.
 */
export function checkRateLimit(
  key: string,
  tier: keyof typeof TIERS | string,
  isSosRequest: boolean,
): RateLimitResult {
  const cfg = TIERS[tier] ?? TIERS.api;
  const now = Date.now();
  maybeSweep(now);

  const bucketKey = `${tier}:${key}`;
  const hits = windows.get(bucketKey) ?? [];
  const windowStart = now - cfg.windowMs;
  const live = hits.filter(t => t > windowStart);

  // SOS priority multiplier — either the current request is SOS, OR
  // the user has been recently marked as in-an-active-emergency.
  const userOnPriority = isSosRequest || isUserOnSosPriority(key, now);
  const effectiveLimit = userOnPriority
    ? cfg.maxRequests * cfg.sosMultiplier
    : cfg.maxRequests;

  // Burst guard — short windows (10s) cap how fast you can spike
  // regardless of your minute budget. Still respects SOS multiplier.
  const burstCutoff = now - 10_000;
  const burstCount = live.filter(t => t > burstCutoff).length;
  const effectiveBurst = userOnPriority
    ? cfg.burstAllowance * cfg.sosMultiplier
    : cfg.burstAllowance;

  // CRITICAL INVARIANT: SOS requests are always allowed.
  // We still record the hit so operators can see the load.
  live.push(now);
  windows.set(bucketKey, live);

  const remaining = Math.max(0, effectiveLimit - live.length);
  const resetAt = (live[0] ?? now) + cfg.windowMs;

  if (isSosRequest) {
    return {
      allowed: true,
      remaining,
      retryAfterMs: 0,
      priority: "sos",
      limit: effectiveLimit,
      resetAt,
    };
  }

  // Window ceiling
  if (live.length > effectiveLimit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(1000, resetAt - now),
      priority: "throttled",
      limit: effectiveLimit,
      resetAt,
    };
  }

  // Burst ceiling
  if (burstCount > effectiveBurst) {
    // retry after the oldest burst hit ages out of the 10s window
    const burstHits = live.filter(t => t > burstCutoff);
    const oldest = burstHits[0] ?? now;
    return {
      allowed: false,
      remaining,
      retryAfterMs: Math.max(1000, 10_000 - (now - oldest)),
      priority: "throttled",
      limit: effectiveLimit,
      resetAt,
    };
  }

  return {
    allowed: true,
    remaining,
    retryAfterMs: 0,
    priority: userOnPriority ? "high" : "normal",
    limit: effectiveLimit,
    resetAt,
  };
}

/**
 * Mark a user as being in an active SOS. For the next 10 minutes
 * every rate-limit check for this user is treated as SOS-priority —
 * useful for correlated requests that don't carry an emergencyId
 * themselves (audio upload replay during an emergency, for example).
 */
export function markSosPriority(userId: string): void {
  if (!userId) return;
  sosPriorityUntil.set(userId, Date.now() + SOS_PRIORITY_TTL_MS);
}

/**
 * Clear SOS priority for a user — called when the emergency is
 * ended, declined, or resolved. Idempotent: no-op if the user
 * isn't currently on priority.
 */
export function clearSosPriority(userId: string): void {
  if (!userId) return;
  sosPriorityUntil.delete(userId);
}

function isUserOnSosPriority(key: string, now: number): boolean {
  // We bucket by tier prefix, so strip it to look up the user id.
  // If the key is an IP ("ip:1.2.3.4") or a composite, this won't
  // match a mark — which is the safe default.
  const expiresAt = sosPriorityUntil.get(key);
  return expiresAt !== undefined && expiresAt > now;
}

/**
 * Build the standard set of X-RateLimit-* response headers. Always
 * include these on rate-limit-sensitive responses so clients can
 * self-throttle rather than hammering us into 429 walls.
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    "X-RateLimit-Priority": result.priority,
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(Math.ceil(result.retryAfterMs / 1000));
  }
  return headers;
}

/**
 * Stats for /api-health style observability endpoints. Cheap to call.
 */
export function getRateLimitStats(): {
  activeWindows: number;
  sosPriorityUsers: number;
} {
  return {
    activeWindows: windows.size,
    sosPriorityUsers: sosPriorityUntil.size,
  };
}

/**
 * TEST-ONLY. Drops all in-memory state. Never call from production
 * code paths — use clearSosPriority for lifecycle events.
 */
export function _resetForTests(): void {
  windows.clear();
  sosPriorityUntil.clear();
  lastSweepAt = 0;
}
