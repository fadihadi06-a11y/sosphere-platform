// ═══════════════════════════════════════════════════════════════
// SOSphere — shifts-service contract (16th pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-04 fresh-audit #4: lock cache trio so admin shift edits
// don't silently leak between tenants on a shared device.
//
//  1. cache: empty by default
//  2. cache: set → get returns slice (not same ref)
//  3. cache: writes through to localStorage bootstrap key
//  4. clear wipes both in-memory and localStorage
//  5. clear also wipes the LEGACY pre-pattern-app key
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

const lsStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem:    (k: string) => lsStore[k] ?? null,
  setItem:    (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
  clear:      () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
});

async function loadFresh() {
  vi.resetModules();
  return await import("../shifts-service");
}

const shift = (over: any = {}): any => ({
  id: "s1", employeeId: "e1", day: 1, type: "morning",
  startHour: 8, endHour: 16, zone: "Zone A", ...over,
});

describe("shifts-service — fresh-audit #4 contract", () => {
  beforeEach(() => { for (const k of Object.keys(lsStore)) delete lsStore[k]; });

  it("1. cache: empty by default", async () => {
    const { getCachedShifts } = await loadFresh();
    expect(getCachedShifts()).toEqual([]);
  });

  it("2. cache: set → get returns slice (not same ref)", async () => {
    const { setCachedShifts, getCachedShifts } = await loadFresh();
    const data = [shift()];
    setCachedShifts(data);
    const got = getCachedShifts();
    expect(got).toEqual(data);
    expect(got).not.toBe(data);
  });

  it("3. cache: writes through to localStorage bootstrap key", async () => {
    const { setCachedShifts } = await loadFresh();
    setCachedShifts([shift()]);
    expect(lsStore["sosphere_shifts_cache"]).toBeTruthy();
  });

  it("4. clear wipes both in-memory and localStorage", async () => {
    const { setCachedShifts, getCachedShifts, clearShiftsCache } = await loadFresh();
    setCachedShifts([shift()]);
    clearShiftsCache();
    expect(getCachedShifts()).toEqual([]);
    expect(lsStore["sosphere_shifts_cache"]).toBeUndefined();
  });

  it("5. clear also wipes the LEGACY pre-pattern-app key (cross-tenant safety)", async () => {
    const { clearShiftsCache } = await loadFresh();
    lsStore["sosphere_shifts"] = JSON.stringify([{ id: "legacy" }]);
    clearShiftsCache();
    expect(lsStore["sosphere_shifts"]).toBeUndefined();
  });
});
