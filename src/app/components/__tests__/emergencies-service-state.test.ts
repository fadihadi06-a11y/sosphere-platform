// ═══════════════════════════════════════════════════════════════
// SOSphere — emergencies-service contract (17th pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-04 fresh-audit #4: lock the pure helpers + cache trio so
// admin emergency mutations stay correct under CDC merges + priority
// sort + cancel paths.
//
//  1. cache: empty by default
//  2. cache: set → get returns slice (not same ref)
//  3. cache: clear wipes both in-memory + localStorage bootstrap
//  4. mergeEmergencyRow: new id appends
//  5. mergeEmergencyRow: existing id replaces in place (dedup)
//  6. mergeEmergencyRow: result puts incoming at FRONT (CDC ordering)
//  7. dropEmergencyRow: removes matching id
//  8. dropEmergencyRow: non-existent id is no-op (returns equivalent)
//  9. orderByPriority: manual_priority desc wins over severity
// 10. orderByPriority: severity rank tiebreaks when no manual_priority
// 11. orderByPriority: recorded_at ascending tiebreaks last
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
  return await import("../emergencies-service");
}

const row = (over: Partial<{
  id: string; severity: "critical" | "high" | "medium" | "low";
  manual_priority: number | null; recorded_at: string;
}> = {}): any => ({
  id: "e1", company_id: "c1", employee_id: null, employee_name: null,
  zone: null, lat: null, lng: null,
  severity: "high", type: null, status: "active",
  recorded_at: "2026-06-04T10:00:00Z", resolved_at: null,
  owned_by: null, owned_at: null, manual_priority: null, metadata: null,
  ...over,
});

describe("emergencies-service — fresh-audit #4 contract", () => {
  beforeEach(() => { for (const k of Object.keys(lsStore)) delete lsStore[k]; });

  it("1. cache: empty by default", async () => {
    const { getCachedEmergencies } = await loadFresh();
    expect(getCachedEmergencies()).toEqual([]);
  });

  it("2. cache: set → get returns slice (not same ref)", async () => {
    const { setCachedEmergencies, getCachedEmergencies } = await loadFresh();
    const data = [row({ id: "e1" })];
    setCachedEmergencies(data);
    const got = getCachedEmergencies();
    expect(got).toEqual(data);
    expect(got).not.toBe(data);
  });

  it("3. clear wipes both in-memory + localStorage", async () => {
    const { setCachedEmergencies, getCachedEmergencies, clearEmergenciesCache } = await loadFresh();
    setCachedEmergencies([row({ id: "e1" })]);
    expect(lsStore["sosphere_emergencies_cache"]).toBeTruthy();
    clearEmergenciesCache();
    expect(getCachedEmergencies()).toEqual([]);
    expect(lsStore["sosphere_emergencies_cache"]).toBeUndefined();
  });

  it("4. mergeEmergencyRow: new id appends", async () => {
    const { mergeEmergencyRow } = await loadFresh();
    const out = mergeEmergencyRow([row({ id: "e1" })], row({ id: "e2" }));
    expect(out).toHaveLength(2);
  });

  it("5. mergeEmergencyRow: existing id replaces (dedup)", async () => {
    const { mergeEmergencyRow } = await loadFresh();
    const out = mergeEmergencyRow(
      [row({ id: "e1", severity: "low" })],
      row({ id: "e1", severity: "critical" }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("critical");
  });

  it("6. mergeEmergencyRow: incoming row goes to FRONT (CDC ordering)", async () => {
    const { mergeEmergencyRow } = await loadFresh();
    const out = mergeEmergencyRow([row({ id: "e1" })], row({ id: "e2" }));
    expect(out[0].id).toBe("e2");
    expect(out[1].id).toBe("e1");
  });

  it("7. dropEmergencyRow: removes matching id", async () => {
    const { dropEmergencyRow } = await loadFresh();
    const out = dropEmergencyRow([row({ id: "e1" }), row({ id: "e2" })], "e1");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("e2");
  });

  it("8. dropEmergencyRow: non-existent id is no-op", async () => {
    const { dropEmergencyRow } = await loadFresh();
    const original = [row({ id: "e1" }), row({ id: "e2" })];
    const out = dropEmergencyRow(original, "missing");
    expect(out).toHaveLength(2);
  });

  it("9. orderByPriority: manual_priority desc wins over severity", async () => {
    const { orderByPriority } = await loadFresh();
    const out = orderByPriority([
      row({ id: "e1", severity: "critical", manual_priority: 1 }),
      row({ id: "e2", severity: "low",      manual_priority: 5 }),
    ]);
    expect(out[0].id).toBe("e2");
  });

  it("10. orderByPriority: severity rank tiebreaks when no manual_priority", async () => {
    const { orderByPriority } = await loadFresh();
    const out = orderByPriority([
      row({ id: "low",  severity: "low" }),
      row({ id: "crit", severity: "critical" }),
      row({ id: "med",  severity: "medium" }),
    ]);
    expect(out.map((r: any) => r.id)).toEqual(["crit", "med", "low"]);
  });

  it("11. orderByPriority: recorded_at ascending tiebreaks last", async () => {
    const { orderByPriority } = await loadFresh();
    const out = orderByPriority([
      row({ id: "newer", severity: "high", recorded_at: "2026-06-04T12:00:00Z" }),
      row({ id: "older", severity: "high", recorded_at: "2026-06-04T08:00:00Z" }),
    ]);
    expect(out[0].id).toBe("older"); // oldest unresolved first
  });
});
