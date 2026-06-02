// ═══════════════════════════════════════════════════════════════
// SOSphere — compliance-summary-service (8th pattern application)
// ─────────────────────────────────────────────────────────────
// Server-state aggregator for compliance PDF generation. Replaces a
// 7-round-trip waterfall in compliance-data-service.ts with a single
// SECDEF RPC call that also FILLS the previously-missing training
// section.
//
// Architecture (mirrors CRIT-2/3/4/4-B/8/9 + attendance pattern):
//   • DB = source of truth (get_compliance_summary RPC consolidates
//     reads from 6 tables in one transaction; auth.uid()-gated)
//   • In-memory _cachedSummary + bootstrap cache for instant repaint
//     when the PDF is re-opened within the same session
//   • clearComplianceSummaryCache() called from complete-logout to
//     prevent cross-tenant leaks on shared devices
//   • Pure helpers (classifyComplianceHealth, formatPercent) for
//     Vitest tests + UI badge logic
//
// This file contains:
//   1. Pure helpers (Vitest-testable)
//   2. RPC wrapper: loadComplianceSummary
//   3. In-memory cache
// ═══════════════════════════════════════════════════════════════

export interface ComplianceSummary {
  company_id:    string;
  since:         string;
  generated_at:  string;
  employees:     EmployeeStats;
  sos:           SosStats;
  risk:          RiskStats;
  investigations: InvestigationStats;
  training:      TrainingStats;
  checkins:      CheckinStats;
}

export interface EmployeeStats {
  total:     number;
  on_shift:  number;
  off_shift: number;
}
export interface SosStats {
  total_30d:    number;
  resolved_30d: number;
  last_7d:      number;
}
export interface RiskStats {
  total:         number;
  high_count:    number;
  medium_count:  number;
  low_count:     number;
}
export interface InvestigationStats {
  total:        number;
  open_count:   number;
  closed_count: number;
  with_report:  number;
}
export interface TrainingStats {
  total:         number;
  valid_count:   number;
  expired_count: number;
  expiring_soon: number;
}
export interface CheckinStats {
  total_30d:     number;
  checkins_30d:  number;
  missed_30d:    number;
  warnings_30d:  number;
}

// ───────── PURE HELPERS ─────────

export type ComplianceHealth = "green" | "amber" | "red" | "unknown";

/** Quick at-a-glance health classification. Pure — testable.
 *
 *  Rules (intentionally simple; PDF can show fine-grained breakdown):
 *  - red:    any open investigation OR >5 missed checkins in window
 *            OR any expired training
 *  - amber:  any high-risk register entry OR training expiring soon
 *  - green:  none of the above
 *  - unknown: summary missing / null
 */
export function classifyComplianceHealth(s: ComplianceSummary | null): ComplianceHealth {
  if (!s) return "unknown";
  const redTriggers =
    (s.investigations?.open_count ?? 0) > 0 ||
    (s.checkins?.missed_30d ?? 0) > 5 ||
    (s.training?.expired_count ?? 0) > 0;
  if (redTriggers) return "red";
  const amberTriggers =
    (s.risk?.high_count ?? 0) > 0 ||
    (s.training?.expiring_soon ?? 0) > 0;
  if (amberTriggers) return "amber";
  return "green";
}

/** Stable %-of-total formatter. Returns "0%" for divide-by-zero. */
export function formatPercent(part: number, total: number): string {
  if (!total || total <= 0) return "0%";
  return Math.round((part / total) * 100) + "%";
}

/** Number of checkin events as a daily average across the window.
 *  Default window length 30 days. Pure — testable. */
export function dailyCheckinAverage(stats: CheckinStats | null, windowDays = 30): number {
  if (!stats) return 0;
  const days = Math.max(1, windowDays);
  return Math.round((stats.checkins_30d ?? 0) / days * 10) / 10;
}

// ───────── IN-MEMORY CACHE ─────────

let _cachedSummary: ComplianceSummary | null = null;

export function setCachedSummary(s: ComplianceSummary | null): void {
  _cachedSummary = s;
  try {
    if (s) localStorage.setItem("sosphere_compliance_summary", JSON.stringify(s));
    else   localStorage.removeItem("sosphere_compliance_summary");
  } catch { /* unavailable */ }
}

export function getCachedSummary(): ComplianceSummary | null {
  if (_cachedSummary) return _cachedSummary;
  try {
    const raw = localStorage.getItem("sosphere_compliance_summary");
    if (raw) {
      const parsed = JSON.parse(raw) as ComplianceSummary;
      _cachedSummary = parsed;
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

export function clearComplianceSummaryCache(): void {
  _cachedSummary = null;
  try { localStorage.removeItem("sosphere_compliance_summary"); } catch { /* unavailable */ }
}

// ───────── RPC WRAPPER ─────────

export async function loadComplianceSummary(args: {
  companyId: string;
  since?:    Date | string | null;
}): Promise<{ ok: boolean; summary: ComplianceSummary | null; error?: string }> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const sinceIso =
      args.since instanceof Date ? args.since.toISOString() :
      typeof args.since === "string" ? args.since : null;
    const { data, error } = await supabase.rpc("get_compliance_summary", {
      p_company_id: args.companyId,
      p_since:      sinceIso,
    });
    if (error) return { ok: false, summary: null, error: error.message };
    if (!data || typeof data !== "object") {
      return { ok: false, summary: null, error: "no_data" };
    }
    const summary = data as ComplianceSummary;
    setCachedSummary(summary);
    return { ok: true, summary };
  } catch (err) {
    return {
      ok: false, summary: null,
      error: err instanceof Error ? err.message : "Unexpected error",
    };
  }
}
