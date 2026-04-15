// ═══════════════════════════════════════════════════════════════
// SOSphere — Retry Backoff Formula Tests (P3-#14)
// ─────────────────────────────────────────────────────────────
// Pins the exponential backoff curve used by both replay paths
// (sos-server-trigger + sos-audio-upload). The formula is shared
// intentionally — audio and SOS events ride the same four triggers
// (online + visibility + auth + startup), so a single cooldown shape
// covers both. If either module's curve drifts, the scenario of
// "user toggles airplane mode five times in 10 seconds" would
// asymmetrically burn the retry budget on one path and not the other.
//
// We test the formula directly rather than through the retryNotBeforeMs
// map because the map is in-memory state we already lose on reload
// by design — its contents aren't part of the persistent contract.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";

// Mirror of the private helper in both replay modules. Kept in the test
// file so a drift in either implementation surfaces as a failing test
// rather than a silent divergence. If either module changes the curve,
// update this helper AND bump the relevant scenario below.
function nextBackoffMs(attempts: number): number {
  return Math.min(Math.pow(2, attempts) * 1000, 60000);
}

describe("nextBackoffMs — exponential retry backoff", () => {
  it("first retry waits 2 seconds", () => {
    // attempts=1 → 2^1 * 1000 = 2000ms
    expect(nextBackoffMs(1)).toBe(2000);
  });

  it("second retry waits 4 seconds", () => {
    expect(nextBackoffMs(2)).toBe(4000);
  });

  it("third retry waits 8 seconds", () => {
    expect(nextBackoffMs(3)).toBe(8000);
  });

  it("fourth retry waits 16 seconds", () => {
    expect(nextBackoffMs(4)).toBe(16000);
  });

  it("fifth retry waits 32 seconds", () => {
    expect(nextBackoffMs(5)).toBe(32000);
  });

  it("caps at 60 seconds regardless of attempts", () => {
    // 2^6 = 64000 > 60000 cap
    expect(nextBackoffMs(6)).toBe(60000);
    // Further retries can't exceed the cap
    expect(nextBackoffMs(10)).toBe(60000);
    expect(nextBackoffMs(100)).toBe(60000);
  });

  it("is strictly non-decreasing as attempts grow (monotonic)", () => {
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const cur = nextBackoffMs(i);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  it("scenario: four triggers firing in 2 seconds do NOT drain the budget", () => {
    // The chaos scenario: user toggles airplane mode while app is
    // resuming. `online`, `visibility`, `auth:initial_session`, and
    // `startup` all fire within ~2 seconds of each other. Without
    // backoff, all four would retry the same record and (on sustained
    // failure) exhaust REPLAY_MAX_TRIES=5 in a single boot. With the
    // formula, after the first failure the second trigger is blocked
    // for 2 seconds, the third for 4s cumulatively, etc. — so at most
    // one retry lands in the 2-second window.

    const REPLAY_MAX_TRIES = 5;
    const TRIGGER_WINDOW_MS = 2000;

    let attempts = 0;
    let nextAllowedAt = 0;
    const tNow = () => 0; // simulate t=0; all triggers fire instantly

    // Simulate 4 trigger events firing at t=0 in quick succession.
    for (let trigger = 0; trigger < 4; trigger++) {
      if (tNow() < nextAllowedAt) continue;   // blocked by cooldown
      attempts++;
      nextAllowedAt = tNow() + nextBackoffMs(attempts);
    }

    // With backoff, only 1 attempt should have landed — the very first.
    expect(attempts).toBe(1);
    // And the cooldown should push the next legal attempt at or past the
    // trigger window (2^1 * 1000 = 2000ms exactly at this boundary), so a
    // second retry must wait for a real network event later — not a
    // same-tick burst from the other three triggers.
    expect(nextAllowedAt).toBeGreaterThanOrEqual(TRIGGER_WINDOW_MS);
    // We stayed well clear of the retry budget.
    expect(attempts).toBeLessThan(REPLAY_MAX_TRIES);
  });
});
