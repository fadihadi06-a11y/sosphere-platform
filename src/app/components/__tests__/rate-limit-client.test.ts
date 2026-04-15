// ═══════════════════════════════════════════════════════════════
// SOSphere — Client-side Rate-Limit Helpers (P1 Rate-Limiting)
// ─────────────────────────────────────────────────────────────
// These tests pin the contract between the Edge Functions'
// X-RateLimit-* / Retry-After headers and the consumer code in
// `sos-server-trigger.ts` + `voice-provider-twilio.ts`. If the
// header names drift on either side this suite will fail loudly.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseRateLimit,
  waitForRetry,
  logRateLimit,
  RateLimitExceededError,
} from "../rate-limit-client";

function makeResponse(headers: Record<string, string>, status = 200): Response {
  return new Response("{}", { status, headers });
}

describe("parseRateLimit", () => {
  it("parses a well-formed server response", () => {
    const res = makeResponse({
      "X-RateLimit-Limit": "60",
      "X-RateLimit-Remaining": "42",
      "X-RateLimit-Reset": "1780000000",
      "X-RateLimit-Priority": "normal",
    });
    const info = parseRateLimit(res);
    expect(info.limit).toBe(60);
    expect(info.remaining).toBe(42);
    expect(info.resetAt).toBe(1780000000);
    expect(info.priority).toBe("normal");
    expect(info.retryAfterMs).toBe(0);
  });

  it("converts Retry-After seconds → milliseconds", () => {
    const res = makeResponse({
      "X-RateLimit-Limit": "60",
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": "1780000060",
      "X-RateLimit-Priority": "throttled",
      "Retry-After": "7",
    }, 429);
    const info = parseRateLimit(res);
    expect(info.retryAfterMs).toBe(7000);
    expect(info.priority).toBe("throttled");
  });

  it("reports priority=sos when the server uses the priority lane", () => {
    const res = makeResponse({
      "X-RateLimit-Limit": "2000",
      "X-RateLimit-Remaining": "1998",
      "X-RateLimit-Reset": "1780000060",
      "X-RateLimit-Priority": "sos",
    });
    const info = parseRateLimit(res);
    expect(info.priority).toBe("sos");
    // SOS priority is never throttled — retry budget must be zero.
    expect(info.retryAfterMs).toBe(0);
  });

  it("degrades gracefully when the endpoint doesn't emit headers", () => {
    // Legacy/un-hardened endpoints ship no X-RateLimit-*. We must
    // not throw; instead we surface 'unknown' priority with zeroed
    // numeric fields so the caller can fall through.
    const res = makeResponse({});
    const info = parseRateLimit(res);
    expect(info.priority).toBe("unknown");
    expect(info.limit).toBe(0);
    expect(info.remaining).toBe(0);
    expect(info.retryAfterMs).toBe(0);
  });

  it("ignores malformed numeric headers (NaN → 0)", () => {
    const res = makeResponse({
      "X-RateLimit-Limit": "not-a-number",
      "X-RateLimit-Remaining": "",
      "X-RateLimit-Reset": "abc",
      "Retry-After": "also-not-a-number",
    }, 429);
    const info = parseRateLimit(res);
    expect(info.limit).toBe(0);
    expect(info.remaining).toBe(0);
    expect(info.resetAt).toBe(0);
    expect(info.retryAfterMs).toBe(0);
  });
});

describe("waitForRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when retryAfterMs is 0", async () => {
    const p = waitForRetry({
      limit: 60, remaining: 10, resetAt: 0,
      priority: "normal", retryAfterMs: 0,
    });
    await expect(p).resolves.toBe(true);
  });

  it("waits the full retry-after budget for normal values", async () => {
    const p = waitForRetry({
      limit: 60, remaining: 0, resetAt: 0,
      priority: "throttled", retryAfterMs: 3_000,
    });
    vi.advanceTimersByTime(3_000);
    await expect(p).resolves.toBe(true);
  });

  it("truncates pathological retry-after values at 30s", async () => {
    // Protects the UI from a server bug that returns e.g. 1 hour.
    const p = waitForRetry({
      limit: 60, remaining: 0, resetAt: 0,
      priority: "throttled", retryAfterMs: 3_600_000,
    });
    vi.advanceTimersByTime(30_000);
    // Returning false tells the caller "we gave up early, don't
    // auto-retry". The caller is expected to surface an error.
    await expect(p).resolves.toBe(false);
  });
});

describe("RateLimitExceededError", () => {
  it("carries structured info for logging and retry routing", () => {
    const info = {
      limit: 10, remaining: 0, resetAt: 1780000060,
      priority: "throttled" as const, retryAfterMs: 5_000,
    };
    const err = new RateLimitExceededError("twilio-token", info);
    expect(err.name).toBe("RateLimitExceededError");
    expect(err.endpoint).toBe("twilio-token");
    expect(err.info).toBe(info);
    // The message is what shows up in crash logs; it must name the
    // endpoint and the retry budget.
    expect(err.message).toContain("twilio-token");
    expect(err.message).toContain("5");
  });
});

describe("logRateLimit", () => {
  it("emits a warn-level record, not an error", () => {
    // 429 is expected behaviour under load; escalating to
    // console.error would drown actual bugs.
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      logRateLimit("twilio-sms", {
        limit: 60, remaining: 0, resetAt: 0,
        priority: "throttled", retryAfterMs: 2_000,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const msg = spy.mock.calls[0]?.[0] as string;
      expect(msg).toContain("twilio-sms");
      expect(msg).toContain("throttled");
    } finally {
      spy.mockRestore();
    }
  });
});
