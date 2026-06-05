// ═══════════════════════════════════════════════════════════════
// SOSphere — email-schedules-service contract (21st pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-04 fresh-audit #4: lock cache trio for the scheduled-
// reports surface so admin schedule edits never leak between
// tenants and the bootstrap path survives a hot reload.
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
  return await import("../email-schedules-service");
}

const sched = (over: any = {}): any => ({
  id: "sch-1", name: "Weekly Brief", frequency: "weekly",
  report_types: ["incident"], recipients: ["ceo@acme.co"],
  enabled: true, next_run: null, last_run: null,
  include_charts: true, include_qr: false, format: "pdf",
  created_at: "2026-06-04T10:00:00Z", ...over,
});

describe("email-schedules-service — fresh-audit #4 contract", () => {
  beforeEach(() => { for (const k of Object.keys(lsStore)) delete lsStore[k]; });

  it("1. cache: empty by default", async () => {
    const { getCachedEmailSchedules } = await loadFresh();
    expect(getCachedEmailSchedules()).toEqual([]);
  });

  it("2. cache: set → get returns slice (not same ref)", async () => {
    const { setCachedEmailSchedules, getCachedEmailSchedules } = await loadFresh();
    const rows = [sched()];
    setCachedEmailSchedules(rows);
    const got = getCachedEmailSchedules();
    expect(got).toEqual(rows);
    expect(got).not.toBe(rows);
  });

  it("3. cache: writes through to localStorage bootstrap key", async () => {
    const { setCachedEmailSchedules } = await loadFresh();
    setCachedEmailSchedules([sched()]);
    expect(lsStore["sosphere_email_schedules_cache"]).toBeTruthy();
  });

  it("4. clear wipes both in-memory and localStorage", async () => {
    const { setCachedEmailSchedules, getCachedEmailSchedules, clearEmailSchedulesCache } = await loadFresh();
    setCachedEmailSchedules([sched()]);
    clearEmailSchedulesCache();
    expect(getCachedEmailSchedules()).toEqual([]);
    expect(lsStore["sosphere_email_schedules_cache"]).toBeUndefined();
  });

  it("5. clear also wipes the LEGACY pre-pattern-app key (cross-tenant safety)", async () => {
    const { clearEmailSchedulesCache } = await loadFresh();
    lsStore["sosphere_email_schedules"] = JSON.stringify([{ id: "legacy" }]);
    clearEmailSchedulesCache();
    expect(lsStore["sosphere_email_schedules"]).toBeUndefined();
  });
});
