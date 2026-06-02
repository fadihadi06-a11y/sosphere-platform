// ═══════════════════════════════════════════════════════════════
// SOSphere — evacuation-service contract
// ─────────────────────────────────────────────────────────────
// 2026-06-02 (10th application of the world-class pattern).
//
//   1. classifyAckProgress 0/0 → none
//   2. classifyAckProgress 0/10 → none
//   3. classifyAckProgress 4/10 (<50%) → partial
//   4. classifyAckProgress 5/10 (50%, <100%) → most
//   5. classifyAckProgress 10/10 → complete
//   6. classifyAckProgress 15/10 (over-arrival) → complete
//   7. formatTriggeredAge seconds
//   8. formatTriggeredAge minutes
//   9. formatTriggeredAge hours
//  10. setCachedEvacuations + getCached + clear contract
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
  return await import("../evacuation-service");
}

const ROW = (over: Partial<{
  id: string; zone_id: string | null; zone_name: string | null;
  reason: string | null; triggered_by: string | null;
  assembly_point_id: string | null; assembly_point_name: string | null;
  triggered_at: string; ack_count: number; arrived_count: number;
}> = {}) => ({
  id: "e1", zone_id: null, zone_name: "Zone A", reason: "drill",
  triggered_by: "u1", assembly_point_id: "AP1", assembly_point_name: "Assembly A",
  triggered_at: new Date().toISOString(),
  ack_count: 0, arrived_count: 0,
  ...over,
});

describe("evacuation-service — 10th pattern contract", () => {
  beforeEach(() => {
    for (const k of Object.keys(lsStore)) delete lsStore[k];
  });

  it("1. classifyAckProgress 0/0 → none", async () => {
    const { classifyAckProgress } = await loadFresh();
    expect(classifyAckProgress(0, 0)).toBe("none");
  });

  it("2. classifyAckProgress 0/10 → none", async () => {
    const { classifyAckProgress } = await loadFresh();
    expect(classifyAckProgress(0, 10)).toBe("none");
  });

  it("3. classifyAckProgress 4/10 (<50%) → partial", async () => {
    const { classifyAckProgress } = await loadFresh();
    expect(classifyAckProgress(1, 10)).toBe("partial");
    expect(classifyAckProgress(4, 10)).toBe("partial");
  });

  it("4. classifyAckProgress 5/10..9/10 → most", async () => {
    const { classifyAckProgress } = await loadFresh();
    expect(classifyAckProgress(5, 10)).toBe("most");
    expect(classifyAckProgress(9, 10)).toBe("most");
  });

  it("5. classifyAckProgress 10/10 → complete", async () => {
    const { classifyAckProgress } = await loadFresh();
    expect(classifyAckProgress(10, 10)).toBe("complete");
  });

  it("6. classifyAckProgress over-arrival (15/10) → complete", async () => {
    const { classifyAckProgress } = await loadFresh();
    expect(classifyAckProgress(15, 10)).toBe("complete");
  });

  it("7. formatTriggeredAge seconds", async () => {
    const { formatTriggeredAge } = await loadFresh();
    const now = Date.now();
    expect(formatTriggeredAge(new Date(now - 30_000).toISOString(), now)).toMatch(/^\d+s ago$/);
  });

  it("8. formatTriggeredAge minutes", async () => {
    const { formatTriggeredAge } = await loadFresh();
    const now = Date.now();
    expect(formatTriggeredAge(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5m ago");
  });

  it("9. formatTriggeredAge hours", async () => {
    const { formatTriggeredAge } = await loadFresh();
    const now = Date.now();
    expect(formatTriggeredAge(new Date(now - 2 * 60 * 60_000).toISOString(), now)).toBe("2h ago");
  });

  it("10. setCachedEvacuations + getCached + clear contract", async () => {
    const svc = await loadFresh();
    expect(svc.getCachedEvacuations()).toEqual([]);
    svc.setCachedEvacuations([ROW({ id: "x" })]);
    expect(svc.getCachedEvacuations()).toHaveLength(1);
    expect(lsStore["sosphere_active_evacuations"]).toBeTruthy();
    svc.clearEvacuationCache();
    expect(svc.getCachedEvacuations()).toEqual([]);
    expect(lsStore["sosphere_active_evacuations"]).toBeUndefined();
  });
});
