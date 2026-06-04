// ═══════════════════════════════════════════════════════════════
// SOSphere — Email Schedules Service (21st pattern application)
// ─────────────────────────────────────────────────────────────
// Server-state durable scheduled-report config. Replaces the
// localStorage-only path where batch-email-scheduler.tsx stored
// `sosphere_email_schedules` per browser. Admins setting up a
// quarterly compliance email on one laptop couldn't see / edit /
// disable it from a different device. Cross-tenant leak on shared
// devices. Same CRIT-#4 class as 20 prior pattern apps.
//
// Architecture (matches the 20 prior pattern applications):
//   • DB = source of truth (email_schedules + 3 SECDEF RPCs).
//   • In-memory cache + bootstrap localStorage.
//   • clearEmailSchedulesCache() called by complete-logout.
// ═══════════════════════════════════════════════════════════════

import { getCompanyId } from "./shared-store";

export type ScheduleFrequency = "daily" | "weekly" | "monthly" | "quarterly";
export type ScheduleFormat = "pdf" | "csv" | "both";

export interface EmailScheduleRow {
  id:              string;
  name:            string;
  frequency:       ScheduleFrequency;
  report_types:    string[];
  recipients:      string[];
  enabled:         boolean;
  next_run:        string | null;
  last_run:        string | null;
  include_charts:  boolean;
  include_qr:      boolean;
  format:          ScheduleFormat;
  created_at:      string;
}

// ───────── IN-MEMORY CACHE ─────────

const SCHEDULES_CACHE_KEY = "sosphere_email_schedules_cache";
const LEGACY_SCHEDULES_KEY = "sosphere_email_schedules";
let _serverSchedules: EmailScheduleRow[] | null = null;

export function setCachedEmailSchedules(rows: EmailScheduleRow[]): void {
  _serverSchedules = rows.slice();
  try {
    localStorage.setItem(SCHEDULES_CACHE_KEY, JSON.stringify(rows));
  } catch { /* unavailable */ }
}

export function getCachedEmailSchedules(): EmailScheduleRow[] {
  if (_serverSchedules) return _serverSchedules.slice();
  try {
    // One-shot legacy migration: kill the unscoped `sosphere_email_schedules`
    // key (CRIT-#4 cross-tenant leak class). removeItem is idempotent.
    localStorage.removeItem(LEGACY_SCHEDULES_KEY);
    const raw = localStorage.getItem(SCHEDULES_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EmailScheduleRow[];
      if (Array.isArray(parsed)) {
        _serverSchedules = parsed;
        return parsed.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function clearEmailSchedulesCache(): void {
  _serverSchedules = null;
  try {
    localStorage.removeItem(SCHEDULES_CACHE_KEY);
    localStorage.removeItem(LEGACY_SCHEDULES_KEY);
  } catch { /* unavailable */ }
}

// ───────── RPC WRAPPERS ─────────

export async function loadEmailSchedules(): Promise<EmailScheduleRow[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_email_schedules", {
      p_company_id: companyId,
    });
    if (error || !Array.isArray(data)) return [];
    const rows = data as EmailScheduleRow[];
    setCachedEmailSchedules(rows);
    return rows;
  } catch (err) {
    console.warn("[email-schedules] load threw:", err);
    return [];
  }
}

export interface UpsertScheduleArgs {
  id:              string;
  name:            string;
  frequency:       ScheduleFrequency;
  reportTypes:     string[];
  recipients:      string[];
  enabled:         boolean;
  nextRun?:        string | null;
  includeCharts?:  boolean;
  includeQR?:      boolean;
  format?:         ScheduleFormat;
}

export async function saveEmailSchedule(args: UpsertScheduleArgs): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.rpc("upsert_email_schedule", {
      p_company_id:     companyId,
      p_id:             args.id,
      p_name:           args.name,
      p_frequency:      args.frequency,
      p_report_types:   args.reportTypes,
      p_recipients:     args.recipients,
      p_enabled:        args.enabled,
      p_next_run:       args.nextRun ?? null,
      p_include_charts: args.includeCharts ?? false,
      p_include_qr:     args.includeQR ?? false,
      p_format:         args.format ?? "pdf",
    });
    if (error) {
      console.warn("[email-schedules] save failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[email-schedules] save threw:", err);
    return false;
  }
}

export async function deleteEmailSchedule(id: string): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.rpc("delete_email_schedule", { p_id: id });
    if (error) {
      console.warn("[email-schedules] delete failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[email-schedules] delete threw:", err);
    return false;
  }
}
