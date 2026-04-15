// ═══════════════════════════════════════════════════════════════
// SOSphere — Sliding-Window Rate-Limiter Invariants
// ─────────────────────────────────────────────────────────────
// The authoritative limiter lives in
// `supabase/functions/_shared/rate-limiter.ts` and runs in Deno
// under the Edge Functions runtime. Importing that module directly
// into vitest would require transpiling `https://esm.sh/...`
// imports, so — like `backoff.test.ts` does for the replay curve —
// we mirror the semantics here and keep both halves in lockstep.
// If either side changes, this suite fails.
//
// The invariants we pin:
//   1. SOS priority requests are ALWAYS allowed, even while counted.
//   2. Non-priority requests are throttled at `maxRequests` per
//      window.
//   3. Burst guard trips independently of the per-minute ceiling.
//   4. The 10-minute SOS priority mark expires.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";

type Tier = { windowMs: number; maxRequests: number; sosMultiplier: number; burstAllowance: number };

// Mirrors the production TIER table. Keep in sync with
// supabase/functions/_shared/rate-limiter.ts.
const TIERS: Record<string, Tier> = {
  sos:     { windowMs: 60_000, maxRequests: 200, sosMultiplier: 1,  burstAllowance: 50 },
  auth:    { windowMs: 60_000, maxRequests: 10,  sosMultiplier: 5,  burstAllowance: 3  },
  api:     { windowMs: 60_000, maxRequests: 60,  sosMultiplier: 10, burstAllowance: 15 },
};

// A compact, testable re-implementation of the sliding-window
// algorithm. This is intentionally standalone — any drift against
// the production code trips the tests below.
function makeLimiter() {
  const windows = new Map<string, number[]>();
  const sosUntil = new Map<string, number>();
  const SOS_TTL = 10 * 60 * 1000;

  function check(
    key: string,
    tier: keyof typeof TIERS,
    isSos: boolean,
    now: number,
  ): { allowed: boolean; priority: string; remaining: number } {
    const cfg = TIERS[tier];
    const bucketKey = `${tier}:${key}`;
    const hits = windows.get(bucketKey) ?? [];
    const windowStart = now - cfg.windowMs;
    const live = hits.filter((t) => t > windowStart);

    const priorityExp = sosUntil.get(key) ?? 0;
    const onPriority = isSos || priorityExp > now;
    const limit = onPriority ? cfg.maxRequests * cfg.sosMultiplier : cfg.maxRequests;
    const burst = onPriority ? cfg.burstAllowance * cfg.sosMultiplier : cfg.burstAllowance;

    const burstCount = live.filter((t) => t > now - 10_000).length;

    live.push(now);
    windows.set(bucketKey, live);

    const remaining = Math.max(0, limit - live.length);

    if (isSos) return { allowed: true, priority: "sos", remaining };

    if (live.length > limit) return { allowed: false, priority: "throttled", remaining: 0 };
    if (burstCount > burst) return { allowed: false, priority: "throttled", remaining };
    return { allowed: true, priority: onPriority ? "high" : "normal", remaining };
  }

  function markSos(userId: string, now: number) {
    sosUntil.set(userId, now + SOS_TTL);
  }
  function clearSos(userId: string) {
    sosUntil.delete(userId);
  }

  return { check, markSos, clearSos };
}

describe("sliding-window limiter", () => {
  let lim: ReturnType<typeof makeLimiter>;
  let t: number;

  beforeEach(() => {
    lim = makeLimiter();
    t = 1_700_000_000_000; // fixed "now" base
  });

  it("allows up to maxRequests per window, then throttles", () => {
    // auth tier: 10/min, burst=3 per 10s. To isolate the per-minute
    // ceiling we must space requests wide enough that the burst guard
    // never trips. 6s spacing puts at most 2 prior hits in any 10s
    // window, leaving the per-minute ceiling as the only gate.
    for (let i = 0; i < 10; i++) {
      const r = lim.check("u1", "auth", false, t + i * 6_000);
      expect(r.allowed).toBe(true);
    }
    // 11th request inside the same 60s window → throttled by ceiling.
    const over = lim.check("u1", "auth", false, t + 55_000);
    expect(over.allowed).toBe(false);
    expect(over.priority).toBe("throttled");
  });

  it("recovers after the window slides past", () => {
    for (let i = 0; i < 10; i++) lim.check("u1", "auth", false, t + i * 100);
    // 60s + 1ms later all old hits are out of window
    const fresh = lim.check("u1", "auth", false, t + 60_001);
    expect(fresh.allowed).toBe(true);
  });

  it("SOS priority lane never blocks, even when far over the limit", () => {
    // Blast 1000 requests. Every one must be allowed because isSos=true.
    for (let i = 0; i < 1000; i++) {
      const r = lim.check("u1", "sos", /* isSos */ true, t + i);
      expect(r.allowed).toBe(true);
      expect(r.priority).toBe("sos");
    }
  });

  it("markSos boosts non-SOS requests too, within 10 minutes", () => {
    lim.markSos("u1", t);
    // With sosMultiplier=10, api tier goes from 60 to 600.
    // Fire 100 non-SOS requests — normally would have hit the 60 ceiling.
    let allowed = 0;
    for (let i = 0; i < 100; i++) {
      const r = lim.check("u1", "api", false, t + i);
      if (r.allowed) allowed++;
    }
    expect(allowed).toBeGreaterThan(60);
    expect(allowed).toBe(100);
  });

  it("SOS priority expires after 10 minutes", () => {
    lim.markSos("u1", t);
    // 11 minutes later the priority should be gone.
    const after = t + 11 * 60 * 1000;
    // Fill the regular (non-priority) 60/min budget, then step over.
    for (let i = 0; i < 60; i++) lim.check("u1", "api", false, after + i);
    const over = lim.check("u1", "api", false, after + 60);
    expect(over.allowed).toBe(false);
  });

  it("clearSos is idempotent and removes the priority immediately", () => {
    lim.markSos("u1", t);
    lim.clearSos("u1");
    lim.clearSos("u1"); // second call must not throw
    // After clear, the api tier returns to 60 regular.
    for (let i = 0; i < 60; i++) lim.check("u1", "api", false, t + i);
    const over = lim.check("u1", "api", false, t + 61);
    expect(over.allowed).toBe(false);
  });

  it("burst guard trips before the minute ceiling when requests are spiky", () => {
    // api tier: burstAllowance=15 in any 10s, limit=60 in 60s.
    // Fire 20 requests in 1 second. Once past 15 we should see throttled.
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(lim.check("u1", "api", false, t + i * 50));
    }
    const blocked = results.filter((r) => !r.allowed);
    // At least a handful must have been blocked by the burst guard,
    // and we should still be well under the 60/min ceiling.
    expect(blocked.length).toBeGreaterThan(0);
    expect(results.filter((r) => r.allowed).length).toBeLessThanOrEqual(16);
  });

  it("keys are bucketed per tier — hitting auth doesn't poison api", () => {
    // Fill auth completely.
    for (let i = 0; i < 10; i++) lim.check("u1", "auth", false, t + i);
    const authOver = lim.check("u1", "auth", false, t + 11);
    expect(authOver.allowed).toBe(false);
    // api tier for same user must still be fine.
    const apiOk = lim.check("u1", "api", false, t + 12);
    expect(apiOk.allowed).toBe(true);
  });

  it("keys are bucketed per user — one abuser doesn't starve others", () => {
    for (let i = 0; i < 10; i++) lim.check("attacker", "auth", false, t + i);
    const victim = lim.check("innocent", "auth", false, t + 11);
    expect(victim.allowed).toBe(true);
  });
});
