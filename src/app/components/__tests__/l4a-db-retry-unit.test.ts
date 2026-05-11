// ═══════════════════════════════════════════════════════════════
// SOSphere — L4-A: withDbRetry behavior unit test
// ─────────────────────────────────────────────────────────────
// TRUE unit test — exercises the retry function with simulated
// errors and asserts: which errors retry, which don't, how many
// attempts, what the backoff looks like, what happens on final
// failure.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withDbRetry,
  isTransientError,
  sleepMs,
  DEFAULT_MAX_RETRIES,
  DEFAULT_INITIAL_BACKOFF_MS,
  DEFAULT_BACKOFF_CAP_MS,
} from "../../../../supabase/functions/_shared/db-retry";

beforeEach(() => {
  // Fake timers so we don't actually wait for backoffs.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("L4-A: isTransientError — transient/non-transient classification", () => {
  it("returns false on null/undefined (no error → no retry)", () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });

  it("treats AbortError as transient (network abort)", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isTransientError(err)).toBe(true);
  });

  it("treats TypeError 'fetch failed' as transient (network)", () => {
    const err = new TypeError("fetch failed");
    expect(isTransientError(err)).toBe(true);
  });

  it("treats HTTP 503 as transient (server fault)", () => {
    expect(isTransientError({ status: 503, message: "Service Unavailable" })).toBe(true);
    expect(isTransientError({ status: 502 })).toBe(true);
    expect(isTransientError({ status: 504 })).toBe(true);
    expect(isTransientError({ status: 500 })).toBe(true);
  });

  it("does NOT retry HTTP 4xx (programmer error)", () => {
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError({ status: 403 })).toBe(false);
    expect(isTransientError({ status: 404 })).toBe(false);
    expect(isTransientError({ status: 409 })).toBe(false);
    expect(isTransientError({ status: 422 })).toBe(false);
  });

  it("treats PG connection codes (08***) as transient", () => {
    expect(isTransientError({ code: "08000" })).toBe(true);
    expect(isTransientError({ code: "08003" })).toBe(true);
    expect(isTransientError({ code: "08006" })).toBe(true);
    expect(isTransientError({ code: "08P01" })).toBe(true);
  });

  it("does NOT retry PG constraint codes (22***, 23***)", () => {
    expect(isTransientError({ code: "23505" })).toBe(false); // unique_violation
    expect(isTransientError({ code: "23502" })).toBe(false); // not_null
    expect(isTransientError({ code: "22P02" })).toBe(false); // invalid_text_representation
  });

  it("does NOT retry generic Error without transient signals", () => {
    expect(isTransientError(new Error("something weird"))).toBe(false);
  });
});

describe("L4-A: withDbRetry — successful first attempt", () => {
  it("returns the op's result without retrying", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    const result = await withDbRetry(op);
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledWith(0); // attempt 0
  });
});

describe("L4-A: withDbRetry — transient error retries", () => {
  it("retries on transient error, succeeds on second attempt", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return "ok";
    });
    const promise = withDbRetry(op);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("retries up to maxRetries times, then throws the last error", async () => {
    const op = vi.fn(async () => { throw { status: 503, message: "always fails" }; });
    const promise = withDbRetry(op).catch(e => e);
    await vi.runAllTimersAsync();
    const caught = await promise;
    // 1 initial attempt + DEFAULT_MAX_RETRIES retries = 3 total calls.
    expect(op).toHaveBeenCalledTimes(DEFAULT_MAX_RETRIES + 1);
    expect(caught).toMatchObject({ status: 503 });
  });

  it("backoff is exponential capped at backoffCapMs", async () => {
    // Spy on setTimeout to capture the sleep durations the retry
    // loop requests, then let the fake-timer queue advance them.
    const sleeps: number[] = [];
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, ms: number) => {
      sleeps.push(ms);
      // Fire the callback immediately (synchronously) so withDbRetry
      // proceeds to the next attempt without real waiting.
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    try {
      const op = vi.fn(async () => { throw { status: 503 }; });
      await withDbRetry(op, {
        maxRetries: 4,
        initialBackoffMs: 100,
        backoffCapMs: 400,
      }).catch(() => {});
      // Expected backoffs: 100, 200, 400, 400 (capped) — 4 retries.
      expect(sleeps).toEqual([100, 200, 400, 400]);
    } finally {
      spy.mockRestore();
    }
  });

  it("calls the onRetry hook with attempt count + error", async () => {
    const onRetry = vi.fn();
    const op = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const promise = withDbRetry(op, { onRetry, maxRetries: 2 }).catch(() => {});
    await vi.runAllTimersAsync();
    await promise;
    expect(onRetry).toHaveBeenCalledTimes(2); // 2 retries between 3 attempts
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(TypeError));
    expect(onRetry).toHaveBeenCalledWith(2, expect.any(TypeError));
  });

  it("onRetry hook errors do NOT break the retry (telemetry hook safety)", async () => {
    const onRetry = vi.fn(() => { throw new Error("telemetry failed"); });
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return "ok";
    });
    const promise = withDbRetry(op, { onRetry });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("ok");
  });
});

describe("L4-A: withDbRetry — non-transient errors throw immediately", () => {
  it("does NOT retry on HTTP 400 (programmer error)", async () => {
    const op = vi.fn(async () => { throw { status: 400, message: "bad input" }; });
    const promise = withDbRetry(op).catch(e => e);
    await vi.runAllTimersAsync();
    const caught = await promise;
    expect(op).toHaveBeenCalledTimes(1); // no retries
    expect(caught).toMatchObject({ status: 400 });
  });

  it("does NOT retry on PG unique-violation (23505)", async () => {
    const op = vi.fn(async () => { throw { code: "23505", message: "duplicate key" }; });
    const promise = withDbRetry(op).catch(e => e);
    await vi.runAllTimersAsync();
    const caught = await promise;
    expect(op).toHaveBeenCalledTimes(1);
    expect(caught).toMatchObject({ code: "23505" });
  });
});

describe("L4-A: defaults sanity", () => {
  it("DEFAULT_MAX_RETRIES is exactly 2 (3 attempts total)", () => {
    expect(DEFAULT_MAX_RETRIES).toBe(2);
  });

  it("DEFAULT_INITIAL_BACKOFF_MS is 200ms (sub-second first retry)", () => {
    expect(DEFAULT_INITIAL_BACKOFF_MS).toBe(200);
  });

  it("DEFAULT_BACKOFF_CAP_MS is 800ms (worst-case <1.2s total added latency)", () => {
    expect(DEFAULT_BACKOFF_CAP_MS).toBe(800);
  });
});

describe("L4-A: sleepMs is async + actually waits (smoke check)", () => {
  it("returns a promise that resolves after the given delay", async () => {
    vi.useRealTimers();
    const start = Date.now();
    await sleepMs(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});
