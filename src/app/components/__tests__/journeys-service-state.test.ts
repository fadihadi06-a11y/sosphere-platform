// ═══════════════════════════════════════════════════════════════
// SOSphere — journeys-service contract
// ─────────────────────────────────────────────────────────────
// 2026-06-04 fresh-audit #4: lock cache trio + legacy-key cleanup
// for the active-journey surface. A leaked tenant-B journey could
// mis-route a SAR mission, so the cross-tenant clear is life-safety.
//
//  1. cache: empty by default
//  2. cache: set → get returns slice (not same ref)
//  3. cache: writes through to localStorage bootstrap key
//  4. clear wipes both in-memory and localStorage
//  5. clear also wipes the LEGACY unscoped key
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
  return await import("../journeys-service");
}

const j = (over: any = {}): any => ({
  id: "j1", employeeName: "Ahmed", employeeId: "e1",
  origin: "Site A", destination: "Site B",
  startTime: new Date("2026-06-04T08:00:00Z"),
  estimatedEnd: new Date("2026-06-04T10:00:00Z"),
  waypoints: [], status: "active",
  currentLocation: undefined, distanceCovered: 0, totalDistance: 50,
  vehicleType: "truck", ...over,
});

describe("journeys-service — fresh-audit #4 contract", () => {
  beforeEach(() => { for (const k of Object.keys(lsStore)) delete lsStore[k]; });

  it("1. cache: empty by default", async () => {
    const { getCachedJourneys } = await loadFresh();
    expect(getCachedJourneys()).toEqual([]);
  });

  it("2. cache: set → get returns slice (not same ref)", async () => {
    const { setCachedJourneys, getCachedJourneys } = await loadFresh();
    const rows = [j()];
    setCachedJourneys(rows);
    const got = getCachedJourneys();
    expect(got).toHaveLength(1);
    expect(got).not.toBe(rows);
  });

  it("3. cache: writes through to localStorage bootstrap key", async () => {
    const { setCachedJourneys } = await loadFresh();
    setCachedJourneys([j()]);
    expect(lsStore["sosphere_journeys_cache"]).toBeTruthy();
  });

  it("4. clear wipes both in-memory and localStorage", async () => {
    const { setCachedJourneys, getCachedJourneys, clearJourneysCache } = await loadFresh();
    setCachedJourneys([j()]);
    clearJourneysCache();
    expect(getCachedJourneys()).toEqual([]);
    expect(lsStore["sosphere_journeys_cache"]).toBeUndefined();
  });

  it("5. clear also wipes the LEGACY unscoped key (cross-tenant safety)", async () => {
    const { clearJourneysCache } = await loadFresh();
    lsStore["sosphere_journeys"] = JSON.stringify([{ id: "legacy" }]);
    clearJourneysCache();
    expect(lsStore["sosphere_journeys"]).toBeUndefined();
  });
});
