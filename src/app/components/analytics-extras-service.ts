// ═══════════════════════════════════════════════════════════════
// SOSphere — Analytics Extras Service
// ─────────────────────────────────────────────────────────────
// Real data for the analytics charts that previously rendered demo-only:
//   • fetchSafetyTrend       → monthly company safety score (reuses the real
//                              get_safety_score_history engine).
//   • fetchResponseTimeTrend → monthly average emergency response time, computed
//                              from real sos_queue timestamps (acknowledged − recorded,
//                              falling back to resolved − recorded). Months with no
//                              incidents are null (a gap), never a fabricated value.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";
import { fetchSafetyScoreHistory } from "./safety-score-service";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function fetchSafetyTrend(months = 6): Promise<{ week: string; score: number }[]> {
  const summary = await fetchSafetyScoreHistory(months);
  if (!summary) return [];
  return summary.months.map(m => ({ week: m.monthLabel, score: m.safetyScore }));
}

export async function fetchResponseTimeTrend(
  months = 6,
): Promise<{ month: string; avg: number | null; target: number }[]> {
  const cid = getCompanyId();
  if (!cid) return [];
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  since.setDate(1); since.setHours(0, 0, 0, 0);
  try {
    const { data, error } = await supabase
      .from("sos_queue")
      .select("recorded_at, acknowledged_at, resolved_at")
      .eq("company_id", cid)
      .gte("recorded_at", since.toISOString());
    if (error || !Array.isArray(data)) return [];
    const buckets = new Map<string, { sum: number; n: number }>();
    for (const r of data as Array<{ recorded_at?: string; acknowledged_at?: string; resolved_at?: string }>) {
      const rec = r.recorded_at ? new Date(r.recorded_at).getTime() : NaN;
      const ackRaw = r.acknowledged_at || r.resolved_at;
      const ack = ackRaw ? new Date(ackRaw).getTime() : NaN;
      if (!Number.isFinite(rec) || !Number.isFinite(ack) || ack < rec) continue;
      const key = MONTHS[new Date(rec).getMonth()];
      const b = buckets.get(key) || { sum: 0, n: 0 };
      b.sum += Math.round((ack - rec) / 1000);
      b.n += 1;
      buckets.set(key, b);
    }
    const out: { month: string; avg: number | null; target: number }[] = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = MONTHS[d.getMonth()];
      const b = buckets.get(key);
      out.push({ month: key, avg: b ? Math.round(b.sum / b.n) : null, target: 120 });
    }
    return out;
  } catch {
    return [];
  }
}
