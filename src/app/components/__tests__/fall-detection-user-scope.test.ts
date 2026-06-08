// ═══════════════════════════════════════════════════════════════
// SOSphere — fall-detection user-scoping contract (M3-#22)
// ─────────────────────────────────────────────────────────────
// 2026-06-06 roots-of-roots M3-#22: the M2-#10 user-scoping fix
// keyed sensor events under sosphere_sensor_events_<uid> + drops
// the legacy unscoped key on first authenticated write. This
// test locks that behavior so a refactor cannot silently re-
// introduce the cross-user PII leak on shared devices.
//
// getUserScopedSensorKey is internal; we exercise the behavior
// through saveSensorEvent + observe the localStorage shape.
// supabase.auth.getUser is mocked to a fixed UID so the test is
// deterministic.
//
//   1. saveSensorEvent: writes under sosphere_sensor_events_<uid>
//   2. saveSensorEvent: removes legacy sosphere_sensor_events key
//      on first authenticated write (one-shot migration)
//   3. saveSensorEvent: appends to existing events (newest first)
//   4. saveSensorEvent: caps at 200 entries (ring-buffer guarantee)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

const lsStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem:    (k: string) => lsStore[k] ?? null,
  setItem:    (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
  clear:      () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
});

// Mock supabase client used by fall-detection — we only need
// auth.getUser to return a deterministic UID + the supabase.rpc
// call to be a no-op (return { error: null }).
const PROBE_UID = "11111111-2222-3333-4444-555555555555";
vi.mock("../api/supabase-client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: PROBE_UID } } }) },
    rpc:  async () => ({ error: null }),
  },
  SUPABASE_CONFIG: { isConfigured: false },
}));

async function loadFresh() {
  vi.resetModules();
  return await import("../fall-detection");
}

const SCOPED_KEY = `sosphere_sensor_events_${PROBE_UID}`;
const LEGACY_KEY = "sosphere_sensor_events";

describe("fall-detection user-scoping — M3-#22 contract", () => {
  beforeEach(() => { for (const k of Object.keys(lsStore)) delete lsStore[k]; });

  it("1. saveSensorEvent: writes under user-scoped key", async () => {
    const { saveSensorEvent } = await loadFresh();
    await saveSensorEvent("fall", 12.3);
    expect(lsStore[SCOPED_KEY]).toBeTruthy();
    const events = JSON.parse(lsStore[SCOPED_KEY]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("fall");
    expect(events[0].acceleration).toBe(12.3);
  });

  it("2. saveSensorEvent: removes legacy unscoped key on authenticated write", async () => {
    // Seed the legacy key — represents the previous (cross-user-leaky) state
    lsStore[LEGACY_KEY] = JSON.stringify([{ id: "old", type: "fall", acceleration: 10 }]);
    const { saveSensorEvent } = await loadFresh();
    await saveSensorEvent("shake", 5.5);
    expect(lsStore[LEGACY_KEY]).toBeUndefined();
    expect(lsStore[SCOPED_KEY]).toBeTruthy();
  });

  it("3. saveSensorEvent: appends newest first", async () => {
    const { saveSensorEvent } = await loadFresh();
    await saveSensorEvent("fall", 11);
    await saveSensorEvent("shake", 6);
    const events = JSON.parse(lsStore[SCOPED_KEY]);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("shake");
    expect(events[1].type).toBe("fall");
  });

  it("4. saveSensorEvent: caps at 200 entries (ring-buffer)", async () => {
    // Seed 200 existing — next write must evict the tail.
    const seed = Array.from({ length: 200 }, (_, i) => ({
      id: `SE-${i}`, type: "shake", acceleration: i,
      timestamp: new Date().toISOString(), resolved: false,
    }));
    lsStore[SCOPED_KEY] = JSON.stringify(seed);
    const { saveSensorEvent } = await loadFresh();
    await saveSensorEvent("fall", 99);
    const events = JSON.parse(lsStore[SCOPED_KEY]);
    expect(events).toHaveLength(200);
    expect(events[0].type).toBe("fall");
    expect(events[0].acceleration).toBe(99);
  });
});
