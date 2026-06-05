// ═══════════════════════════════════════════════════════════════
// SOSphere — checkin-sessions-service contract (24th pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-05 roots-of-roots M1-#5. Locks the pure helpers + in-memory
// cache trio so a future refactor cannot silently break the admin
// "due in X min" panel or the cross-tenant cache safety.
//
//   1. cache: get-empty -> []
//   2. cache: set -> get returns slice (not same ref)
//   3. clearCheckinSessionsCache wipes in-memory cache
//   4. countOverdue: no overdue at present
//   5. countOverdue: overdue counted correctly
//   6. sortByDeadline: ascending by deadline_ts
//   7. deadlineLabel: positive -> "due in"
//   8. deadlineLabel: zero / negative -> "overdue"
//   9. deadlineLabel: pads seconds with leading zero
//  10. deadlineLabel: sub-minute "due in Ns" form (no leading "0m")
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import {
  setCachedActiveCheckinSessions, getCachedActiveCheckinSessions,
  clearCheckinSessionsCache,
  countOverdue, sortByDeadline, deadlineLabel,
  type CheckinSessionRow,
} from "../checkin-sessions-service";

const row = (over: Partial<CheckinSessionRow> = {}): CheckinSessionRow => ({
  user_id: "u1", employee_name: "Worker", zone: "Zone A",
  deadline_ts: new Date(Date.now() + 600_000).toISOString(),
  total_sec: 1800, warning_cycle: 0,
  started_at: new Date(Date.now() - 600_000).toISOString(),
  updated_at: new Date().toISOString(),
  seconds_until_deadline: 600,
  ...over,
});

describe("checkin-sessions-service — 24th pattern app contract", () => {
  beforeEach(() => { clearCheckinSessionsCache(); });

  it("1. cache: get-empty -> []", () => {
    expect(getCachedActiveCheckinSessions()).toEqual([]);
  });

  it("2. cache: set -> get returns slice (not same ref)", () => {
    const rows = [row()];
    setCachedActiveCheckinSessions(rows);
    const got = getCachedActiveCheckinSessions();
    expect(got).toHaveLength(1);
    expect(got).not.toBe(rows);
  });

  it("3. clearCheckinSessionsCache wipes in-memory cache", () => {
    setCachedActiveCheckinSessions([row()]);
    clearCheckinSessionsCache();
    expect(getCachedActiveCheckinSessions()).toEqual([]);
  });

  it("4. countOverdue: no overdue at present", () => {
    const future = row({ deadline_ts: new Date(Date.now() + 60_000).toISOString() });
    const r = countOverdue([future]);
    expect(r.count).toBe(0);
    expect(r.names).toEqual([]);
  });

  it("5. countOverdue: overdue counted correctly", () => {
    const now = Date.now();
    const past = row({ user_id: "p1", employee_name: "Late",
      deadline_ts: new Date(now - 60_000).toISOString() });
    const future = row({ user_id: "f1", employee_name: "OK",
      deadline_ts: new Date(now + 60_000).toISOString() });
    const r = countOverdue([past, future], now);
    expect(r.count).toBe(1);
    expect(r.names).toEqual(["Late"]);
  });

  it("6. sortByDeadline: ascending by deadline_ts", () => {
    const now = Date.now();
    const a = row({ user_id: "a", deadline_ts: new Date(now + 300_000).toISOString() });
    const b = row({ user_id: "b", deadline_ts: new Date(now + 100_000).toISOString() });
    const c = row({ user_id: "c", deadline_ts: new Date(now + 200_000).toISOString() });
    const sorted = sortByDeadline([a, b, c]);
    expect(sorted.map((r) => r.user_id)).toEqual(["b", "c", "a"]);
  });

  it("7. deadlineLabel: positive -> \"due in\"", () => {
    expect(deadlineLabel(125)).toBe("due in 2m 05s");
  });

  it("8. deadlineLabel: zero / negative -> \"overdue\"", () => {
    expect(deadlineLabel(-65)).toBe("overdue 1m 05s");
  });

  it("9. deadlineLabel: pads seconds with leading zero", () => {
    expect(deadlineLabel(65)).toBe("due in 1m 05s");
    expect(deadlineLabel(120)).toBe("due in 2m 00s");
  });

  it("10. deadlineLabel: sub-minute \"due in Ns\" form (no leading 0m)", () => {
    expect(deadlineLabel(30)).toBe("due in 30s");
    expect(deadlineLabel(5)).toBe("due in 5s");
  });
});
