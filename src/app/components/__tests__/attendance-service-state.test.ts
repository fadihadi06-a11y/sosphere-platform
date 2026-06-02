// ═══════════════════════════════════════════════════════════════
// SOSphere — attendance-service contract
// ─────────────────────────────────────────────────────────────
// 2026-06-02 (7th application of the world-class pattern). Tests
// lock the pure helpers + in-memory state contract so a future
// refactor cannot silently break the dashboard attendance view:
//
//   1. classifyAttendanceStatus null/null → off_duty (fail-secure)
//   2. classifyAttendanceStatus checkin within 8h → present
//   3. classifyAttendanceStatus checkin older than 8h → off_duty
//   4. classifyAttendanceStatus warning → late
//   5. classifyAttendanceStatus missed → missed
//   6. groupByEmployee preserves desc order + populates lastCheckin
//   7. groupByEmployee accumulates all events for an employee
//   8. computeAttendanceStats counts present/late/missed/off correctly
//   9. setServerCheckins persists to localStorage AND in-memory
//  10. clearAttendanceCache wipes both in-memory and localStorage
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
  return await import("../attendance-service");
}

const ROW = (over: Partial<{
  id: string; employee_id: string; employee_name: string | null;
  zone: string | null; event_type: "checkin" | "warning" | "missed" | "resumed";
  duration_min: number | null; remaining_sec: number | null; created_at: string;
}> = {}) => ({
  id:            "e1",
  employee_id:   "emp-1",
  employee_name: "Ahmed",
  zone:          "Zone A",
  event_type:    "checkin" as const,
  duration_min:  30,
  remaining_sec: null,
  created_at:    new Date().toISOString(),
  ...over,
});

describe("attendance-service — 7th pattern contract", () => {
  beforeEach(() => {
    for (const k of Object.keys(lsStore)) delete lsStore[k];
  });

  it("1. classifyAttendanceStatus null/null → off_duty", async () => {
    const { classifyAttendanceStatus } = await loadFresh();
    expect(classifyAttendanceStatus(null, null)).toBe("off_duty");
  });

  it("2. classifyAttendanceStatus checkin within 8h → present", async () => {
    const { classifyAttendanceStatus } = await loadFresh();
    const now = Date.now();
    const fiveMinAgo = new Date(now - 5 * 60_000).toISOString();
    expect(classifyAttendanceStatus("checkin", fiveMinAgo, now)).toBe("present");
    expect(classifyAttendanceStatus("resumed", fiveMinAgo, now)).toBe("present");
  });

  it("3. classifyAttendanceStatus checkin older than 8h → off_duty", async () => {
    const { classifyAttendanceStatus } = await loadFresh();
    const now = Date.now();
    const tenHoursAgo = new Date(now - 10 * 60 * 60_000).toISOString();
    expect(classifyAttendanceStatus("checkin", tenHoursAgo, now)).toBe("off_duty");
  });

  it("4. classifyAttendanceStatus warning → late", async () => {
    const { classifyAttendanceStatus } = await loadFresh();
    expect(classifyAttendanceStatus("warning", new Date().toISOString())).toBe("late");
  });

  it("5. classifyAttendanceStatus missed → missed", async () => {
    const { classifyAttendanceStatus } = await loadFresh();
    expect(classifyAttendanceStatus("missed", new Date().toISOString())).toBe("missed");
  });

  it("6. groupByEmployee preserves desc order + sets lastCheckin", async () => {
    const { groupByEmployee } = await loadFresh();
    const t0 = "2026-06-02T10:00:00Z";
    const t1 = "2026-06-02T09:00:00Z";
    const rows = [ROW({ id: "e1", created_at: t0 }), ROW({ id: "e2", created_at: t1 })];
    const grouped = groupByEmployee(rows);
    const sum = grouped.get("emp-1")!;
    expect(sum.events).toHaveLength(2);
    expect(sum.lastCheckin).toBe(t0);
    expect(sum.lastEventType).toBe("checkin");
  });

  it("7. groupByEmployee accumulates events per employee", async () => {
    const { groupByEmployee } = await loadFresh();
    const rows = [
      ROW({ id: "e1", employee_id: "emp-1" }),
      ROW({ id: "e2", employee_id: "emp-2", employee_name: "Sara" }),
      ROW({ id: "e3", employee_id: "emp-1" }),
    ];
    const grouped = groupByEmployee(rows);
    expect(grouped.size).toBe(2);
    expect(grouped.get("emp-1")!.events).toHaveLength(2);
    expect(grouped.get("emp-2")!.events).toHaveLength(1);
    expect(grouped.get("emp-2")!.employeeName).toBe("Sara");
  });

  it("8. computeAttendanceStats counts statuses correctly", async () => {
    const { computeAttendanceStats } = await loadFresh();
    const now = Date.now();
    const recent = new Date(now - 60_000).toISOString();
    const rows = [
      ROW({ id: "e1", employee_id: "emp-A", event_type: "checkin",  created_at: recent }),
      ROW({ id: "e2", employee_id: "emp-B", event_type: "warning",  created_at: recent }),
      ROW({ id: "e3", employee_id: "emp-C", event_type: "missed",   created_at: recent }),
      ROW({ id: "e4", employee_id: "emp-D", event_type: "checkin",
            created_at: new Date(now - 10 * 60 * 60_000).toISOString() }),
    ];
    const stats = computeAttendanceStats(rows, now);
    expect(stats.totalEvents).toBe(4);
    expect(stats.uniqueEmps).toBe(4);
    expect(stats.presentCount).toBe(1);
    expect(stats.lateCount).toBe(1);
    expect(stats.missedCount).toBe(1);
    expect(stats.offDutyCount).toBe(1);
  });

  it("9. setServerCheckins persists to localStorage AND in-memory", async () => {
    const svc = await loadFresh();
    const rows = [ROW({ id: "x1" })];
    svc.setServerCheckins(rows);
    expect(svc.getCachedCheckins()).toHaveLength(1);
    const raw = lsStore["sosphere_checkin_feed"];
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.rows[0].id).toBe("x1");
    expect(typeof parsed.cachedAt).toBe("number");
  });

  it("10. clearAttendanceCache wipes BOTH in-memory and localStorage", async () => {
    const svc = await loadFresh();
    svc.setServerCheckins([ROW()]);
    expect(svc.getCachedCheckins()).toHaveLength(1);
    svc.clearAttendanceCache();
    expect(svc.getCachedCheckins()).toEqual([]);
    expect(lsStore["sosphere_checkin_feed"]).toBeUndefined();
  });
});
