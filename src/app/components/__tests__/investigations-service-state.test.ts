// ═══════════════════════════════════════════════════════════════
// SOSphere — investigations-service contract
// ─────────────────────────────────────────────────────────────
// 2026-06-04 fresh-audit #4: lock cache trio + legacy-key cleanup
// for the ISO 27001 §A.16 investigations surface so a shared device
// never leaks tenant-A investigation titles + worker names to
// tenant-B after logout.
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
  return await import("../investigations-service");
}

const inv = (over: any = {}): any => ({
  id: "i1", incidentId: "inc-1", title: "Test incident",
  description: "x", severity: "medium", zone: "A",
  incidentDate: new Date("2026-06-04T10:00:00Z"),
  reportedBy: "Ahmed", investigator: "Sara", status: "open",
  rootCauses: [], actions: [], timeline: [], affectedWorkers: [],
  isoReference: "ISO 45001 §10.2", ...over,
});

describe("investigations-service — fresh-audit #4 contract", () => {
  beforeEach(() => { for (const k of Object.keys(lsStore)) delete lsStore[k]; });

  it("1. cache: empty by default", async () => {
    const { getCachedInvestigations } = await loadFresh();
    expect(getCachedInvestigations()).toEqual([]);
  });

  it("2. cache: set → get returns slice (not same ref)", async () => {
    const { setCachedInvestigations, getCachedInvestigations } = await loadFresh();
    const rows = [inv()];
    setCachedInvestigations(rows);
    const got = getCachedInvestigations();
    expect(got).toHaveLength(1);
    expect(got).not.toBe(rows);
  });

  it("3. cache: writes through to localStorage bootstrap key", async () => {
    const { setCachedInvestigations } = await loadFresh();
    setCachedInvestigations([inv()]);
    expect(lsStore["sosphere_investigations_cache"]).toBeTruthy();
  });

  it("4. clear wipes both in-memory and localStorage", async () => {
    const { setCachedInvestigations, getCachedInvestigations, clearInvestigationsCache } = await loadFresh();
    setCachedInvestigations([inv()]);
    clearInvestigationsCache();
    expect(getCachedInvestigations()).toEqual([]);
    expect(lsStore["sosphere_investigations_cache"]).toBeUndefined();
  });

  it("5. clear also wipes the LEGACY unscoped key (cross-tenant safety)", async () => {
    const { clearInvestigationsCache } = await loadFresh();
    lsStore["sosphere_investigations"] = JSON.stringify([{ id: "legacy" }]);
    clearInvestigationsCache();
    expect(lsStore["sosphere_investigations"]).toBeUndefined();
  });
});
