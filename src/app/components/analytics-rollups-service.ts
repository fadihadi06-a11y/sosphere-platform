// ═══════════════════════════════════════════════════════════════
// SOSphere — Analytics Rollups Service (23rd pattern application)
// ─────────────────────────────────────────────────────────────
// Server-side aggregations for the last 2 fabricated content
// blocks in the compliance PDF:
//   • get_admin_performance — ranks admins by incidents handled +
//     avg response time + current streak (from sos_queue).
//   • get_safety_score_history — N-month rollup of sos count +
//     resolved count + computed safety_score per month.
//
// Both are read-only aggregations; no localStorage state.
// Caches are in-memory only (no bootstrap key) because the data
// is recomputable on every login and not tenant-state per-se.
// ═══════════════════════════════════════════════════════════════

import { getCompanyId } from "./shared-store";

export interface AdminPerformanceRow {
  user_id:           string;
  display_name:      string;
  role:              string;
  incidents_handled: number;
  avg_response_sec:  number;
  current_streak:    number;
}

export interface SafetyScoreMonthRow {
  month_label:    string;
  sos_count:      number;
  resolved_count: number;
  safety_score:   number;
}

// ───────── IN-MEMORY CACHES ─────────

let _cachedAdminPerformance: AdminPerformanceRow[] | null = null;
let _cachedSafetyScoreHistory: SafetyScoreMonthRow[] | null = null;

export function setCachedAdminPerformance(rows: AdminPerformanceRow[]): void {
  _cachedAdminPerformance = rows.slice();
}
export function getCachedAdminPerformance(): AdminPerformanceRow[] {
  return _cachedAdminPerformance ? _cachedAdminPerformance.slice() : [];
}

export function setCachedSafetyScoreHistory(rows: SafetyScoreMonthRow[]): void {
  _cachedSafetyScoreHistory = rows.slice();
}
export function getCachedSafetyScoreHistory(): SafetyScoreMonthRow[] {
  return _cachedSafetyScoreHistory ? _cachedSafetyScoreHistory.slice() : [];
}

export function clearAnalyticsRollupsCache(): void {
  _cachedAdminPerformance = null;
  _cachedSafetyScoreHistory = null;
}

// ───────── PURE HELPERS ─────────

/** Format seconds as "Nm Ss" or "Ns". Pure. */
export function formatResponseTime(sec: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Map a numeric score to a tier label. Pure. */
export function scoreTier(score: number): "PLATINUM" | "GOLD" | "SILVER" | "BRONZE" {
  if (score >= 90) return "PLATINUM";
  if (score >= 80) return "GOLD";
  if (score >= 70) return "SILVER";
  return "BRONZE";
}

// ───────── RPC WRAPPERS ─────────

export async function loadAdminPerformance(days: number = 30): Promise<AdminPerformanceRow[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_admin_performance", {
      p_company_id: companyId,
      p_days:       days,
    });
    if (error || !Array.isArray(data)) return [];
    const rows = data as AdminPerformanceRow[];
    setCachedAdminPerformance(rows);
    return rows;
  } catch (err) {
    console.warn("[analytics-rollups] admin perf threw:", err);
    return [];
  }
}

export async function loadSafetyScoreHistory(months: number = 6): Promise<SafetyScoreMonthRow[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_safety_score_history", {
      p_company_id: companyId,
      p_months:     months,
    });
    if (error || !Array.isArray(data)) return [];
    const rows = data as SafetyScoreMonthRow[];
    setCachedSafetyScoreHistory(rows);
    return rows;
  } catch (err) {
    console.warn("[analytics-rollups] safety score threw:", err);
    return [];
  }
}
