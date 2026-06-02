// ═══════════════════════════════════════════════════════════════
// SOSphere — attendance-service (7th application of world-class pattern)
// ─────────────────────────────────────────────────────────────
// Server-state architecture for check-in events. Replaces a tangled
// mix of localStorage polling, hardcoded "EMP-APP" writes (that
// silently failed under RLS), and Math.random() fabrications that
// the audit revealed.
//
// Architecture (mirrors CRIT-2/3/4/4-B/8/9 pattern):
//   • DB = source of truth (checkin_events + new company_id column +
//     2 SECDEF RPCs: record_checkin_event, get_checkin_feed)
//   • record_checkin_event resolves employee_id + company_id from
//     auth.uid() server-side — clients cannot forge identity
//   • get_checkin_feed admin-only reader; returns recent events ordered
//     by created_at desc; cheap thanks to the new (company_id, created_at)
//     index added in the companion migration
//   • In-memory _serverEvents + bootstrap cache for instant repaint
//   • clearAttendanceCache() called from complete-logout to prevent
//     cross-tenant leaks on shared devices
//
// This file contains:
//   1. Pure helpers (Vitest-testable): classifyAttendanceStatus,
//      groupByEmployee, computeAttendanceStats
//   2. RPC wrappers: recordCheckin (replaces all 11 EMP-APP callsites),
//      loadCheckinFeed (admin reader)
//   3. In-memory cache: setServerCheckins / getCachedCheckins /
//      clearAttendanceCache
// ═══════════════════════════════════════════════════════════════

export type CheckinEventType = "checkin" | "warning" | "missed" | "resumed";

export interface CheckinFeedRow {
  id:             string;
  employee_id:    string;
  employee_name:  string | null;
  zone:           string | null;
  event_type:     CheckinEventType;
  duration_min:   number | null;
  remaining_sec:  number | null;
  created_at:     string;
}

export interface EmployeeAttendanceSummary {
  employeeId:    string;
  employeeName:  string;
  lastCheckin:   string | null;   // ISO
  lastEventType: CheckinEventType | null;
  lastZone:      string | null;
  events:        CheckinFeedRow[];
}

// ───────── PURE HELPERS ─────────

/** Heuristic status from the most recent event for an employee. */
export type AttendanceStatus = "present" | "late" | "missed" | "off_duty";

export function classifyAttendanceStatus(
  lastEventType: CheckinEventType | null,
  lastCheckinAt: string | null,
  nowMs: number = Date.now(),
): AttendanceStatus {
  if (lastEventType == null || lastCheckinAt == null) return "off_duty";
  const ageMs = nowMs - new Date(lastCheckinAt).getTime();
  if (lastEventType === "missed") return "missed";
  if (lastEventType === "warning") return "late";
  if (lastEventType === "checkin" || lastEventType === "resumed") {
    // Present if we got a check-in within the last 8 hours, off_duty after
    return ageMs < 8 * 60 * 60_000 ? "present" : "off_duty";
  }
  return "off_duty";
}

/** Group a feed of rows by employee, sorted with most-recent first.
 *  Pure. Returns a Map keyed by employee_id. */
export function groupByEmployee(
  rows: CheckinFeedRow[],
): Map<string, EmployeeAttendanceSummary> {
  const out = new Map<string, EmployeeAttendanceSummary>();
  // The feed is already ordered desc by created_at; preserve that.
  for (const r of rows) {
    const existing = out.get(r.employee_id);
    if (existing) {
      existing.events.push(r);
      continue;
    }
    out.set(r.employee_id, {
      employeeId:    r.employee_id,
      employeeName:  r.employee_name ?? r.employee_id,
      lastCheckin:   r.created_at,
      lastEventType: r.event_type,
      lastZone:      r.zone,
      events:        [r],
    });
  }
  return out;
}

/** Roll-up stats across a feed. Pure. */
export interface AttendanceStats {
  totalEvents:   number;
  uniqueEmps:    number;
  presentCount:  number;
  lateCount:     number;
  missedCount:   number;
  offDutyCount:  number;
}

export function computeAttendanceStats(
  rows: CheckinFeedRow[],
  nowMs: number = Date.now(),
): AttendanceStats {
  const grouped = groupByEmployee(rows);
  let present = 0, late = 0, missed = 0, off = 0;
  for (const summary of grouped.values()) {
    const s = classifyAttendanceStatus(summary.lastEventType, summary.lastCheckin, nowMs);
    if      (s === "present") present++;
    else if (s === "late")    late++;
    else if (s === "missed")  missed++;
    else                      off++;
  }
  return {
    totalEvents:  rows.length,
    uniqueEmps:   grouped.size,
    presentCount: present,
    lateCount:    late,
    missedCount:  missed,
    offDutyCount: off,
  };
}

// ───────── IN-MEMORY CACHE ─────────

let _serverEvents: CheckinFeedRow[] | null = null;

export function setServerCheckins(rows: CheckinFeedRow[]): void {
  _serverEvents = rows.slice();
  try {
    // Cap localStorage to 200 most-recent rows to avoid quota issues
    const slim = rows.slice(0, 200);
    localStorage.setItem("sosphere_checkin_feed", JSON.stringify({
      rows: slim, cachedAt: Date.now(),
    }));
  } catch { /* localStorage unavailable */ }
}

export function getCachedCheckins(): CheckinFeedRow[] {
  if (_serverEvents) return _serverEvents.slice();
  try {
    const raw = localStorage.getItem("sosphere_checkin_feed");
    if (raw) {
      const parsed = JSON.parse(raw) as { rows?: CheckinFeedRow[]; cachedAt?: number };
      if (Array.isArray(parsed.rows)) {
        _serverEvents = parsed.rows;
        return parsed.rows.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function clearAttendanceCache(): void {
  _serverEvents = null;
  try { localStorage.removeItem("sosphere_checkin_feed"); } catch { /* ignore */ }
}

// ───────── RPC WRAPPERS ─────────

/** Server-resolved check-in. Replaces all the EMP-APP hardcoded writes.
 *  Returns the new event id (uuid) or null on failure. */
export async function recordCheckin(args: {
  eventType:    CheckinEventType;
  zone?:        string | null;
  durationMin?: number | null;
  remainingSec?: number | null;
}): Promise<string | null> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("record_checkin_event", {
      p_event_type:    args.eventType,
      p_zone:          args.zone          ?? null,
      p_duration_min:  args.durationMin   ?? null,
      p_remaining_sec: args.remainingSec  ?? null,
    });
    if (error || !data) {
      console.warn("[Attendance] record_checkin_event failed:", error?.message);
      return null;
    }
    return String(data);
  } catch (err) {
    console.warn("[Attendance] record_checkin_event threw:", err);
    return null;
  }
}

/** Admin-only reader. Returns last-N rows ordered by created_at desc. */
export async function loadCheckinFeed(args: {
  companyId: string;
  since?:    Date | string | null;
  limit?:    number;
}): Promise<{ ok: boolean; rows: CheckinFeedRow[]; error?: string }> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const sinceIso =
      args.since instanceof Date ? args.since.toISOString() :
      typeof args.since === "string" ? args.since : null;
    const { data, error } = await supabase.rpc("get_checkin_feed", {
      p_company_id: args.companyId,
      p_since:      sinceIso,
      p_limit:      args.limit ?? 200,
    });
    if (error) return { ok: false, rows: [], error: error.message };
    const rows = Array.isArray(data) ? (data as CheckinFeedRow[]) : [];
    setServerCheckins(rows);
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, rows: [], error: err instanceof Error ? err.message : "Unexpected" };
  }
}
