// ═══════════════════════════════════════════════════════════════
// SOSphere — subscription-service state-architecture contract
// ─────────────────────────────────────────────────────────────
// CRIT-2 (2026-05-31): the world-class refactor introduced an
// in-memory `_serverTier` as the authoritative source of truth.
// localStorage is now explicitly a BOOTSTRAP CACHE only.
//
// These tests lock the contract so a future refactor cannot
// silently regress us back to localStorage-as-truth:
//
//   1. setServerTier() makes getSubscription() reflect it immediately
//   2. setServerTier() also writes localStorage (so next session
//      bootstraps to the same tier)
//   3. clearServerTier() resets in-memory AND localStorage (so a
//      shared device does not leak a paid tier between users)
//   4. With no setServerTier() call, getSubscription() falls back
//      to the localStorage bootstrap cache
//   5. With no setServerTier() and no localStorage, getSubscription()
//      returns "free" (fail-secure default)
//   6. Trial state still overrides server tier (existing contract)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage for the Node test environment. We need real
// get/set semantics, not just a stub, since the contract depends on
// round-tripping JSON.
const lsStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => lsStore[k] ?? null,
  setItem: (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
  clear: () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
};
vi.stubGlobal("localStorage", localStorageMock);

// Import AFTER stubbing localStorage so the module's top-level
// (if any) reads see the mock. Module-level _serverTier state is
// reset per test via resetModules + dynamic re-import.
async function loadFresh() {
  vi.resetModules();
  return await import("../subscription-service");
}

describe("subscription-service — CRIT-2 server-state contract", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("1. setServerTier() makes getSubscription reflect the tier immediately", async () => {
    const svc = await loadFresh();
    // Default before any set: free (no localStorage, no _serverTier)
    expect(svc.getSubscription().tier).toBe("free");
    svc.setServerTier("elite");
    expect(svc.getSubscription().tier).toBe("elite");
    expect(svc.hasFeature("aiVoiceCalls")).toBe(true);
  });

  it("2. setServerTier() persists to localStorage for next-session bootstrap", async () => {
    const svc = await loadFresh();
    svc.setServerTier("basic");
    const raw = localStorageMock.getItem("sosphere_subscription");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.tier).toBe("basic");
    expect(typeof parsed.updatedAt).toBe("number");
  });

  it("3. clearServerTier() resets in-memory AND localStorage", async () => {
    const svc = await loadFresh();
    svc.setServerTier("elite");
    svc.clearServerTier();
    expect(svc.getSubscription().tier).toBe("free");
    expect(localStorageMock.getItem("sosphere_subscription")).toBeNull();
  });

  it("4. fresh module + localStorage bootstrap → reads from cache", async () => {
    // Simulate: previous session left "basic" in localStorage
    localStorageMock.setItem(
      "sosphere_subscription",
      JSON.stringify({ tier: "basic", updatedAt: Date.now() }),
    );
    const svc = await loadFresh(); // resets _serverTier
    expect(svc.getSubscription().tier).toBe("basic");
    expect(svc.hasFeature("walkMe")).toBe(true);
    expect(svc.hasFeature("aiVoiceCalls")).toBe(false); // basic ≠ elite
  });

  it("5. no setServerTier + no localStorage → fail-secure 'free'", async () => {
    const svc = await loadFresh();
    expect(svc.getSubscription().tier).toBe("free");
    expect(svc.hasFeature("aiVoiceCalls")).toBe(false);
    expect(svc.hasFeature("walkMe")).toBe(false);
  });

  it("6. active trial overrides server tier (existing contract preserved)", async () => {
    const svc = await loadFresh();
    svc.setServerTier("free"); // user is server-side free
    // Simulate an active Elite trial set by trial-service
    localStorageMock.setItem(
      "sosphere_trial_state",
      JSON.stringify({
        status: "active",
        startedAt: Date.now() - 1000,
        durationMs: 7 * 24 * 60 * 60 * 1000, // 7-day trial active
        tier: "elite",
      }),
    );
    expect(svc.getSubscription().tier).toBe("elite");
    expect(svc.hasFeature("aiVoiceCalls")).toBe(true);
  });

  it("7. expired trial falls through to server tier", async () => {
    const svc = await loadFresh();
    svc.setServerTier("basic");
    localStorageMock.setItem(
      "sosphere_trial_state",
      JSON.stringify({
        status: "active",
        startedAt: Date.now() - 10_000_000,
        durationMs: 1, // trial expired immediately
        tier: "elite",
      }),
    );
    expect(svc.getSubscription().tier).toBe("basic");
  });

  it("8. setSubscription (deprecated alias) still updates server tier", async () => {
    const svc = await loadFresh();
    svc.setSubscription("elite"); // legacy callers still work
    expect(svc.getSubscription().tier).toBe("elite");
    // And localStorage was updated too
    const raw = localStorageMock.getItem("sosphere_subscription");
    expect(raw && JSON.parse(raw).tier).toBe("elite");
  });

  it("9. invalid localStorage value falls back to free, not throws", async () => {
    localStorageMock.setItem("sosphere_subscription", "not-json{");
    const svc = await loadFresh();
    expect(() => svc.getSubscription()).not.toThrow();
    expect(svc.getSubscription().tier).toBe("free");
  });

  it("10. setServerTier with different tiers updates correctly each time", async () => {
    const svc = await loadFresh();
    svc.setServerTier("free");
    expect(svc.getTier()).toBe("free");
    svc.setServerTier("basic");
    expect(svc.getTier()).toBe("basic");
    svc.setServerTier("elite");
    expect(svc.getTier()).toBe("elite");
    svc.setServerTier("free"); // downgrade
    expect(svc.getTier()).toBe("free");
  });
});
