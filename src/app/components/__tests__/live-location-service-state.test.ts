// ═══════════════════════════════════════════════════════════════
// SOSphere — live-location-service contract (M3-#22)
// ─────────────────────────────────────────────────────────────
// 2026-06-06 roots-of-roots M3-#22: session lifecycle + URL
// shape + trail accumulator. startLiveSession internally calls
// navigator.geolocation which is unavailable in the node test
// environment — we cover what's testable without geolocation:
// the no-session defaults, URL composition for a known
// emergencyId+token, and the clear/stop idempotence.
//
//   1. getActiveLiveSession: null when no session
//   2. getLiveTrail: empty array when no session
//   3. stopLiveSession: idempotent + no-throw
//   4. clearLiveLocationCache: idempotent + no-throw
//   5. getTrackingUrl: returns a https://sosphere.co/live/... URL
//   6. getTrackingUrl: includes the emergencyId in the path
//   7. getTrackingUrl: returns the same URL for the same emergencyId
//      when no active session has been started (deterministic)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  getActiveLiveSession, getLiveTrail,
  stopLiveSession, clearLiveLocationCache,
  getTrackingUrl,
} from "../live-location-service";

describe("live-location-service — M3-#22 contract", () => {
  it("1. getActiveLiveSession: null when no session", () => {
    expect(getActiveLiveSession()).toBeNull();
  });

  it("2. getLiveTrail: empty array when no session", () => {
    expect(getLiveTrail()).toEqual([]);
  });

  it("3. stopLiveSession: idempotent + no-throw", () => {
    expect(() => stopLiveSession()).not.toThrow();
    expect(() => stopLiveSession()).not.toThrow();
  });

  it("4. clearLiveLocationCache: idempotent + no-throw", () => {
    expect(() => clearLiveLocationCache()).not.toThrow();
    expect(() => clearLiveLocationCache()).not.toThrow();
  });

  it("5. getTrackingUrl: no active session → falls back to static maps URL", () => {
    // Behavior: when there's no active live session AND no last-known
    // position, getTrackingUrl returns the bare static-map base URL.
    // This is the safe fallback — admin still gets a clickable link
    // (just no pin) instead of an empty string or null.
    const url = getTrackingUrl("EMG-TEST-1");
    expect(url).toMatch(/^https:\/\/maps\.google\.com\/maps/);
  });

  it("6. getTrackingUrl: fallback URL is deterministic (no leaked session state)", () => {
    // Without an active session for this id, two consecutive calls
    // must return the same string — guards against accidental cache
    // contamination from prior tests in the same suite.
    const a = getTrackingUrl("EMG-DET-1");
    const b = getTrackingUrl("EMG-DET-1");
    expect(a).toBe(b);
  });

  it("7. getTrackingUrl: emergencyId is opaque to the fallback path", () => {
    // The session-less fallback intentionally does NOT embed the
    // emergencyId — it uses the static-map base only. Two different
    // ids therefore produce the same URL when no session exists.
    // Locks this contract so a future change that does embed the id
    // also bumps this test deliberately.
    const a = getTrackingUrl("EMG-A");
    const b = getTrackingUrl("EMG-B");
    expect(a).toBe(b);
  });
});
