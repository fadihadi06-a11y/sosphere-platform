// ═══════════════════════════════════════════════════════════════
// SOSphere — DDoS & API Guard with SOS Priority Lane
// Shared rate limiter for all Supabase Edge Functions.
// SOS-tagged requests get 10x higher limits and are never rate-limited during active emergencies.
// ═══════════════════════════════════════════════════════════════

export interface RateLimitConfig {
  windowMs: number;        // Time window in milliseconds
  maxRequests: number;     // Max requests per window for normal traffic
  sosMultiplier: number;   // SOS requests get this multiplier on the limit
  burstAllowance: number;  // Short burst allowance (per 10s)
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  priority: "sos" | "high" | "normal" | "throttled";
}

// In-memory sliding window rate limiter
// Key: userId or IP → timestamps array
const _windows = new Map<string, number[]>();
const _sosPrioritySet = new Set<string>(); // Users currently in active SOS get priority

// Rate limit tiers for different endpoints
export const TIERS: Record<string, RateLimitConfig> = {
  sos: {
    windowMs: 60_000,
    maxRequests: 200,
    sosMultiplier: 1,
    burstAllowance: 50
  },
  auth: {
    windowMs: 60_000,
    maxRequests: 10,
    sosMultiplier: 5,
    burstAllowance: 3
  },
  api: {
    windowMs: 60_000,
    maxRequests: 60,
    sosMultiplier: 10,
    burstAllowance: 15
  },
  webhook: {
    windowMs: 60_000,
    maxRequests: 30,
    sosMultiplier: 5,
    burstAllowance: 10
  },
};

/**
 * Check rate limit using sliding window algorithm.
 * SOS requests NEVER get blocked - they always return allowed: true.
 *
 * @param key - User ID or IP address to rate limit
 * @param tier - Which tier configuration to use (sos, auth, api, webhook)
 * @param isSosRequest - Whether this is marked as an SOS emergency request
 * @returns Rate limit result with allowed status and metadata
 */
export function checkRateLimit(
  key: string,
  tier: string = "api",
  isSosRequest: boolean = false
): RateLimitResult {
  const now = Date.now();
  const config = TIERS[tier] || TIERS.api;

  // SOS requests are NEVER blocked, but still tracked
  if (isSosRequest) {
    const timestamps = (_windows.get(key) || []).filter(t => t > now - config.windowMs);
    timestamps.push(now);
    _windows.set(key, timestamps);
    _sosPrioritySet.add(key);

    return {
      allowed: true,
      remaining: config.maxRequests * config.sosMultiplier,
      retryAfterMs: 0,
      priority: "sos",
    };
  }

  // For normal requests: apply sliding window algorithm
  const timestamps = (_windows.get(key) || []).filter(t => t > now - config.windowMs);

  // Check if user is in active SOS - give them high priority
  const inActiveSos = _sosPrioritySet.has(key);
  const limit = inActiveSos
    ? Math.floor(config.maxRequests * config.sosMultiplier)
    : config.maxRequests;

  const allowed = timestamps.length < limit;

  if (allowed) {
    timestamps.push(now);
    _windows.set(key, timestamps);
  } else {
    _windows.set(key, timestamps);
  }

  const remaining = Math.max(0, limit - timestamps.length);
  const oldestTimestamp = timestamps[0];
  const retryAfterMs = oldestTimestamp ? oldestTimestamp + config.windowMs - now : 0;

  const priority = inActiveSos
    ? "high"
    : !allowed
    ? "throttled"
    : "normal";

  return {
    allowed,
    remaining,
    retryAfterMs: Math.max(0, retryAfterMs),
    priority,
  };
}

/**
 * Mark a user as being in an active SOS emergency.
 * Their subsequent requests get higher rate limits.
 */
export function markSosPriority(userId: string): void {
  _sosPrioritySet.add(userId);
}

/**
 * Clear SOS priority status for a user.
 * Called when emergency is resolved or times out.
 */
export function clearSosPriority(userId: string): void {
  _sosPrioritySet.delete(userId);
}

/**
 * Get standard rate limit headers to send in response.
 * Includes: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Priority
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
  return {
    "X-RateLimit-Limit": String(result.remaining + 1), // Include current request
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(Math.ceil((Date.now() + result.retryAfterMs) / 1000)),
    "X-RateLimit-Priority": result.priority,
    ...(result.retryAfterMs > 0 && { "Retry-After": String(retryAfterSeconds) }),
  };
}

/**
 * Get current rate limit statistics (for monitoring/health checks).
 */
export function getRateLimitStats(): {
  activeWindows: number;
  sosPriorityUsers: number;
} {
  return {
    activeWindows: _windows.size,
    sosPriorityUsers: _sosPrioritySet.size,
  };
}

/**
 * Clear all rate limit state (useful for testing or maintenance).
 */
export function clearAllLimits(): void {
  _windows.clear();
  _sosPrioritySet.clear();
}
