// ═══════════════════════════════════════════════════════════════
// SOSphere — buddy_pairs state-architecture contract
// ─────────────────────────────────────────────────────────────
// CRIT-4 part A (2026-05-31): same in-memory-truth + bootstrap-cache
// pattern as CRIT-2 subscription-service, applied to buddy pairs.
//
// These tests lock the contract so a future refactor cannot silently
// regress us back to localStorage-as-truth for buddy data:
//
//   1. setServerBuddyPairs() makes loadBuddyPairs() reflect immediately
//   2. setServerBuddyPairs() also writes localStorage (next-session bootstrap)
//   3. clearServerBuddyPairs() resets in-memory AND localStorage
//   4. With no setServerBuddyPairs(), loadBuddyPairs() falls back to
//      localStorage bootstrap cache
//   5. With nothing set anywhere, returns [] (fail-secure)
//   6. getBuddyFor() respects isActive flag
//   7. getBuddyFor() finds in both employee_a and employee_b positions
//   8. saveBuddyPairs (deprecated) still works via the cache
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

const lsStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => lsStore[k] ?? null,
  setItem: (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
  clear: () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
};
vi.stubGlobal("localStorage", localStorageMock);

// Stub window for safeSetItem inside shared-store
vi.stubGlobal("window", { dispatchEvent: () => {} });

async function loadFresh() {
  vi.resetModules();
  return await import("../shared-store");
}

const PAIR_A_B = {
  id: "p1",
  employee1Id: "EMP-001", employee1Name: "Ahmed",
  employee2Id: "EMP-002", employee2Name: "Fatima",
  isActive: true,
};

describe("buddy_pairs — CRIT-4 server-state contract", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("1. setServerBuddyPairs() makes loadBuddyPairs reflect immediately", async () => {
    const ss = await loadFresh();
    expect(ss.loadBuddyPairs()).toEqual([]);
    ss.setServerBuddyPairs([PAIR_A_B]);
    expect(ss.loadBuddyPairs()).toHaveLength(1);
    expect(ss.loadBuddyPairs()[0].employee1Id).toBe("EMP-001");
  });

  it("2. setServerBuddyPairs() persists to localStorage for next-session bootstrap", async () => {
    const ss = await loadFresh();
    ss.setServerBuddyPairs([PAIR_A_B]);
    const raw = localStorageMock.getItem("sosphere_buddy_pairs");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].employee1Id).toBe("EMP-001");
  });

  it("3. clearServerBuddyPairs() resets in-memory AND localStorage", async () => {
    const ss = await loadFresh();
    ss.setServerBuddyPairs([PAIR_A_B]);
    ss.clearServerBuddyPairs();
    expect(ss.loadBuddyPairs()).toEqual([]);
    expect(localStorageMock.getItem("sosphere_buddy_pairs")).toBeNull();
  });

  it("4. fresh module + localStorage bootstrap → reads from cache", async () => {
    localStorageMock.setItem("sosphere_buddy_pairs", JSON.stringify([PAIR_A_B]));
    const ss = await loadFresh();
    const pairs = ss.loadBuddyPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0].employee2Name).toBe("Fatima");
  });

  it("5. no setServerBuddyPairs + no localStorage → fail-secure []", async () => {
    const ss = await loadFresh();
    expect(ss.loadBuddyPairs()).toEqual([]);
    expect(ss.getBuddyFor("EMP-001")).toBeNull();
  });

  it("6. getBuddyFor() respects isActive flag", async () => {
    const ss = await loadFresh();
    ss.setServerBuddyPairs([{ ...PAIR_A_B, isActive: false }]);
    expect(ss.getBuddyFor("EMP-001")).toBeNull();
    ss.setServerBuddyPairs([{ ...PAIR_A_B, isActive: true }]);
    expect(ss.getBuddyFor("EMP-001")).toEqual({ buddyId: "EMP-002", buddyName: "Fatima" });
  });

  it("7. getBuddyFor() finds in both employee_a and employee_b positions", async () => {
    const ss = await loadFresh();
    ss.setServerBuddyPairs([PAIR_A_B]);
    expect(ss.getBuddyFor("EMP-001")).toEqual({ buddyId: "EMP-002", buddyName: "Fatima" });
    expect(ss.getBuddyFor("EMP-002")).toEqual({ buddyId: "EMP-001", buddyName: "Ahmed" });
  });

  it("8. saveBuddyPairs (deprecated alias) still updates cache", async () => {
    const ss = await loadFresh();
    ss.saveBuddyPairs([PAIR_A_B]);
    expect(ss.loadBuddyPairs()).toHaveLength(1);
    const raw = localStorageMock.getItem("sosphere_buddy_pairs");
    expect(raw && JSON.parse(raw)).toHaveLength(1);
  });

  it("9. invalid localStorage value falls back to [], not throws", async () => {
    localStorageMock.setItem("sosphere_buddy_pairs", "not-json{");
    const ss = await loadFresh();
    expect(() => ss.loadBuddyPairs()).not.toThrow();
    expect(ss.loadBuddyPairs()).toEqual([]);
  });

  it("10. setServerBuddyPairs with empty array clears effective state", async () => {
    const ss = await loadFresh();
    ss.setServerBuddyPairs([PAIR_A_B]);
    expect(ss.loadBuddyPairs()).toHaveLength(1);
    ss.setServerBuddyPairs([]);
    expect(ss.loadBuddyPairs()).toEqual([]);
    expect(ss.getBuddyFor("EMP-001")).toBeNull();
  });
});
