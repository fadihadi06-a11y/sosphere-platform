// ═══════════════════════════════════════════════════════════════
// SOSphere — Shifts Service (16th pattern application, 2026-06-03)
// ─────────────────────────────────────────────────────────────
// Server-state durable shifts. Replaces the localStorage-only path
// in dashboard-shift-scheduling-page.tsx where every admin's planner
// edits lived on their browser tab — a tenant switch on a shared
// device showed the previous tenant's shift assignments.
//
// Architecture (matches the 15 prior pattern applications):
//   • DB = source of truth (shifts table + 2 SECDEF RPCs)
//   • get_shifts (admin reader) + upsert_shifts_batch (admin write,
//     delete+insert semantics so the page is authoritative)
//   • In-memory _serverShifts + bootstrap localStorage cache
//   • clearShiftsCache() called by complete-logout
//   • Pure helpers tested in shifts-service-state.test.ts
// ═══════════════════════════════════════════════════════════════

import { getCompanyId } from "./shared-store";
import { logAuditEvent } from "./audit-log-store";

export type ShiftType = "morning" | "afternoon" | "night" | "custom";

export interface Shift {
  id:          string;
  employeeId:  string;
  day:         number;       // 0-6 (Mon-Sun) — matches dashboard page semantics
  type:        ShiftType;
  startHour:   number;
  endHour:     number;
  zone:        string;
  note?:       string;
  weekOffset?: number;
}

// ───────── IN-MEMORY CACHE ─────────

const SHIFTS_CACHE_KEY = "sosphere_shifts_cache";
const LEGACY_SHIFTS_KEY = "sosphere_shifts";
let _serverShifts: Shift[] | null = null;

export function setCachedShifts(rows: Shift[]): void {
  _serverShifts = rows.slice();
  try {
    localStorage.setItem(SHIFTS_CACHE_KEY, JSON.stringify(rows));
  } catch { /* unavailable */ }
}

export function getCachedShifts(): Shift[] {
  if (_serverShifts) return _serverShifts.slice();
  try {
    // One-shot legacy migration: kill the unscoped `sosphere_shifts`
    // key (CRIT-#4 cross-tenant leak). removeItem is idempotent.
    localStorage.removeItem(LEGACY_SHIFTS_KEY);
    const raw = localStorage.getItem(SHIFTS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Shift[];
      if (Array.isArray(parsed)) {
        _serverShifts = parsed;
        return parsed.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function clearShiftsCache(): void {
  _serverShifts = null;
  try {
    localStorage.removeItem(SHIFTS_CACHE_KEY);
    localStorage.removeItem(LEGACY_SHIFTS_KEY);
  } catch { /* unavailable */ }
}

// ───────── ROW MAPPING ─────────

interface ServerShiftRow {
  id:            string;
  employee_id:   string;
  day_of_week:   number;
  shift_type:    ShiftType;
  start_hour:    number;
  end_hour:      number;
  zone:          string | null;
  note:          string | null;
  week_offset:   number;
}

function rowToShift(row: ServerShiftRow): Shift {
  return {
    id:         row.id,
    employeeId: row.employee_id,
    day:        row.day_of_week,
    type:       row.shift_type,
    startHour:  row.start_hour,
    endHour:    row.end_hour,
    zone:       row.zone ?? "",
    note:       row.note ?? undefined,
    weekOffset: row.week_offset,
  };
}

function shiftToRow(s: Shift): Record<string, unknown> {
  return {
    id:           s.id,
    employee_id:  s.employeeId,
    day_of_week:  s.day,
    shift_type:   s.type,
    start_hour:   s.startHour,
    end_hour:     s.endHour,
    zone:         s.zone || null,
    note:         s.note || null,
    week_offset:  s.weekOffset ?? 0,
  };
}

// ───────── RPC WRAPPERS ─────────

export async function fetchShifts(): Promise<Shift[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_shifts", { p_company_id: companyId });
    if (error || !data) return [];
    const rows = (data as ServerShiftRow[]).map(rowToShift);
    setCachedShifts(rows);
    return rows;
  } catch (err) {
    console.warn("[shifts-service] fetch:", err);
    return [];
  }
}

export async function upsertShiftsBatch(shifts: Shift[]): Promise<number> {
  const companyId = getCompanyId();
  if (!companyId) return 0;
  try {
    const { supabase } = await import("./api/supabase-client");
    const payload = shifts.map(shiftToRow);
    const { data, error } = await supabase.rpc("upsert_shifts_batch", {
      p_company_id: companyId,
      p_shifts:     payload,
    });
    if (error) {
      console.warn("[shifts-service] upsert failed:", error.message);
      return 0;
    }
    const written = typeof data === "number" ? data : 0;
    // fresh-audit #5: shift edits affect attendance + overtime + payroll
    // downstream. Logged at info severity; detail carries the count so
    // compliance review can correlate with sosphere_shifts_history.
    try {
      logAuditEvent("data_modify", "shifts_batch_upserted", {
        detail: `${written}/${shifts.length} shifts upserted`,
        severity: "info",
      });
    } catch { /* audit best-effort */ }
    return written;
  } catch (err) {
    console.warn("[shifts-service] upsert exception:", err);
    return 0;
  }
}
