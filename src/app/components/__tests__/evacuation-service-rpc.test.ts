// ═══════════════════════════════════════════════════════════════
// SOSphere — evacuation-service RPC envelope contract (Phase B)
// ─────────────────────────────────────────────────────────────
// 2026-06-02. These tests lock the RPC wrappers' contract so the
// dashboard + mobile page refactors (which dual-write to local +
// server) cannot silently regress:
//
//   1. startEvacuation: returns server uuid string on data success
//   2. startEvacuation: returns null on rpc error (does not throw)
//   3. startEvacuation: returns null on null data (does not throw)
//   4. ackEvacuation:   returns null on rpc error (does not throw)
//   5. ackEvacuation:   returns null when data is not a string
//   6. ackEvacuation:   returns the uuid string on success
//   7. endEvacuation:   returns true on success
//   8. endEvacuation:   returns false on rpc error (does not throw)
//   9. loadActiveEvacuations: caches rows on success
//  10. loadActiveEvacuations: returns ok:false + error on rpc fail
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

const lsStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem:    (k: string) => lsStore[k] ?? null,
  setItem:    (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
  clear:      () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
});

const mockRpc = vi.fn();

vi.mock("../api/supabase-client", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

async function loadFresh() {
  vi.resetModules();
  return await import("../evacuation-service");
}

describe("evacuation-service RPC wrappers — Phase B contract", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    for (const k of Object.keys(lsStore)) delete lsStore[k];
  });

  it("1. startEvacuation returns server uuid on success", async () => {
    mockRpc.mockResolvedValueOnce({ data: "e0000000-0000-0000-0000-000000000001", error: null });
    const { startEvacuation } = await loadFresh();
    const result = await startEvacuation({ companyId: "c1", zoneName: "Zone A" });
    expect(result).toBe("e0000000-0000-0000-0000-000000000001");
  });

  it("2. startEvacuation returns null on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    const { startEvacuation } = await loadFresh();
    expect(await startEvacuation({ companyId: "c1" })).toBeNull();
  });

  it("3. startEvacuation returns null on null data", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const { startEvacuation } = await loadFresh();
    expect(await startEvacuation({ companyId: "c1" })).toBeNull();
  });

  it("4. ackEvacuation returns null on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "not authorized" } });
    const { ackEvacuation } = await loadFresh();
    expect(await ackEvacuation({ evacuationId: "x", phase: "acknowledged" })).toBeNull();
  });

  it("5. ackEvacuation returns null when data is not a string (finished evac)", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const { ackEvacuation } = await loadFresh();
    expect(await ackEvacuation({ evacuationId: "x", phase: "arrived" })).toBeNull();
  });

  it("6. ackEvacuation returns uuid string on success", async () => {
    mockRpc.mockResolvedValueOnce({ data: "a0000000-0000-0000-0000-000000000001", error: null });
    const { ackEvacuation } = await loadFresh();
    expect(await ackEvacuation({ evacuationId: "x", phase: "evacuating" }))
      .toBe("a0000000-0000-0000-0000-000000000001");
  });

  it("7. endEvacuation returns true on success", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    const { endEvacuation } = await loadFresh();
    expect(await endEvacuation({ evacuationId: "x" })).toBe(true);
  });

  it("8. endEvacuation returns false on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "rls" } });
    const { endEvacuation } = await loadFresh();
    expect(await endEvacuation({ evacuationId: "x" })).toBe(false);
  });

  it("9. loadActiveEvacuations caches rows on success", async () => {
    const rows = [{
      id: "e1", zone_id: null, zone_name: "Z", reason: null,
      triggered_by: null, assembly_point_id: null, assembly_point_name: null,
      triggered_at: new Date().toISOString(), ack_count: 0, arrived_count: 0,
    }];
    mockRpc.mockResolvedValueOnce({ data: rows, error: null });
    const { loadActiveEvacuations, getCachedEvacuations } = await loadFresh();
    const res = await loadActiveEvacuations("c1");
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(getCachedEvacuations()).toHaveLength(1);
    expect(lsStore["sosphere_active_evacuations"]).toBeTruthy();
  });

  it("10. loadActiveEvacuations returns ok:false + error on RPC fail", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { loadActiveEvacuations } = await loadFresh();
    const res = await loadActiveEvacuations("c1");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
    expect(res.rows).toEqual([]);
  });
});
