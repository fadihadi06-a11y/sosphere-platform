// ═══════════════════════════════════════════════════════════════
// SOSphere — Safety Score Service
// ─────────────────────────────────────────────────────────────
// Surfaces the REAL, server-computed company safety score. The score is NOT a
// fabricated gamification number: it is computed in Postgres by the
// `get_safety_score_history` SECURITY DEFINER function from real emergency
// outcomes in `sos_queue` — for each month, score = resolved / total * 100
// (100 when there were no incidents — "no news is good news" baseline).
//
// RLS: the function itself authorizes the caller (company owner OR an active
// company_memberships row), so this is safe to call directly from the client.
//
// IMPORTANT (honesty): the per-worker `employees.safety_score` column is a
// STATIC baseline default (85) — there is no per-worker scoring engine yet.
// This service deliberately exposes only the score the platform actually
// computes (company-level, incident-driven), never an invented per-worker one.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";

export interface SafetyScoreMonth {
  monthLabel: string;   // e.g. "May"
  sosCount: number;     // emergencies recorded that month
  resolvedCount: number;// of those, how many were resolved
  safetyScore: number;  // 0–100, computed server-side
}

export interface SafetyScoreSummary {
  months: SafetyScoreMonth[];
  current: number;        // most recent month's score
  totalIncidents: number; // sum of sosCount across the window
  totalResolved: number;  // sum of resolvedCount across the window
}

/**
 * Fetch the real monthly safety-score history for the active company.
 * Returns null on no-company / error (caller renders an honest empty state).
 */
export async function fetchSafetyScoreHistory(months = 6): Promise<SafetyScoreSummary | null> {
  const companyId = getCompanyId();
  if (!companyId) return null;
  try {
    const { data, error } = await supabase.rpc("get_safety_score_history", {
      p_company_id: companyId,
      p_months: months,
    });
    if (error || !Array.isArray(data)) return null;
    const rows: SafetyScoreMonth[] = data.map((r: {
      month_label: string; sos_count: number; resolved_count: number; safety_score: number;
    }) => ({
      monthLabel: r.month_label,
      sosCount: Number(r.sos_count) || 0,
      resolvedCount: Number(r.resolved_count) || 0,
      safetyScore: Number(r.safety_score) || 0,
    }));
    if (rows.length === 0) return { months: [], current: 0, totalIncidents: 0, totalResolved: 0 };
    return {
      months: rows,
      current: rows[rows.length - 1].safetyScore,
      totalIncidents: rows.reduce((a, b) => a + b.sosCount, 0),
      totalResolved: rows.reduce((a, b) => a + b.resolvedCount, 0),
    };
  } catch {
    return null;
  }
}
