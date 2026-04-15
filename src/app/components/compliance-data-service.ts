// ═══════════════════════════════════════════════════════════════
// SOSphere — Compliance Report Data Aggregator (P3-#11d)
// ─────────────────────────────────────────────────────────────
// Pulls real data from the tables other P3-#11 slices built and
// reshapes it into the exact row/bar-chart shapes that the
// `generatePDF` function in compliance-reports.tsx expects.
//
// Every field is independent: if a table is empty, un-migrated, or
// the user is offline, that field resolves to `null` and the PDF
// generator's existing `?? MOCK_*` fallback kicks in. So this
// module is additive — it can only improve the report, never break
// it.
//
// Sources:
//   • sos_queue            → incidents, kpi.totalIncidents/response
//   • risk_register        → zoneRisk.tableRows + charts
//   • investigations       → correctiveActions (flattened actions)
//   • employees + training → employee_roster, training coverage
//   • audit_log            → check-in compliance (category='login'
//                            + 'missed_checkin' events)
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";

// ── Bar chart tuple the PDF generator consumes ────────────────
type RGB = [number, number, number];
interface ChartBar { label: string; value: number; color: RGB; max?: number; suffix?: string }

// ── Field shapes (mirror the MOCK_* constants in compliance-reports.tsx) ──
export interface KpiDataBlock {
  tableRows: string[][];
  chartBars: ChartBar[];
}
export interface ZoneRiskBlock {
  tableRows: string[][];
  incidentChart: ChartBar[];
  workersChart: ChartBar[];
}
export interface CheckinBlock {
  tableRows: string[][];
  chartBars: ChartBar[];
}

export interface CompliancePdfData {
  kpi: KpiDataBlock | null;
  incidents: string[][] | null;
  correctiveActions: string[][] | null;
  zoneRisk: ZoneRiskBlock | null;
  employeeRoster: string[][] | null;
  checkinCompliance: CheckinBlock | null;
  journeyLog: string[][] | null;
  playbookData: string[][] | null;
}

// ── Helpers ───────────────────────────────────────────────────

const GREEN: RGB = [0, 200, 83];
const CYAN: RGB  = [0, 200, 224];
const LIME: RGB  = [52, 199, 89];
const ORANGE: RGB = [255, 150, 0];
const YELLOW: RGB = [255, 214, 10];
const RED: RGB   = [255, 45, 85];
const PURPLE: RGB = [139, 92, 246];

const ROTATING_COLORS: RGB[] = [GREEN, CYAN, LIME, YELLOW, ORANGE, PURPLE, RED];

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function fmtShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function scoreToColor(score: number): RGB {
  if (score >= 95) return GREEN;
  if (score >= 90) return CYAN;
  if (score >= 85) return LIME;
  if (score >= 75) return YELLOW;
  if (score >= 60) return ORANGE;
  return RED;
}

function severityLabel(sev: string | null | undefined): string {
  const s = (sev || "").toLowerCase();
  if (s === "critical") return "Critical";
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  return "Info";
}

function statusLabel(status: string | null | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "resolved") return "Resolved";
  if (s === "active") return "Active";
  if (s === "investigating") return "Investigating";
  if (s === "false_alarm" || s === "false alarm") return "False Alarm";
  return status ?? "—";
}

function durationLabel(startedAtIso: string | null | undefined, resolvedAtIso: string | null | undefined): string {
  if (!startedAtIso) return "—";
  const start = new Date(startedAtIso).getTime();
  const end = resolvedAtIso ? new Date(resolvedAtIso).getTime() : NaN;
  if (!Number.isFinite(end)) return "—";
  const diffSec = Math.max(0, Math.round((end - start) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

// ── Field fetchers ────────────────────────────────────────────
// Each returns `null` on empty so the PDF falls back to MOCK. Every
// error is swallowed and logged — nothing in this module should ever
// throw into the compliance page's handler.

async function fetchIncidentsBlock(companyId: string): Promise<{
  incidents: string[][] | null;
  totalIncidents: number;
  resolvedCount: number;
  criticalCount: number;
  avgResponseSec: number;
}> {
  try {
    const { data, error } = await supabase
      .from("sos_queue")
      .select("id, type, employee_name, zone, severity, status, recorded_at, resolved_at")
      .eq("company_id", companyId)
      .order("recorded_at", { ascending: false })
      .limit(50);
    if (error || !data || data.length === 0) {
      return { incidents: null, totalIncidents: 0, resolvedCount: 0, criticalCount: 0, avgResponseSec: 0 };
    }
    const incidents = data.map((row: any) => [
      row.id,
      row.recorded_at ? fmtShortDate(new Date(row.recorded_at)) : "—",
      row.type || "SOS",
      row.employee_name || "Unknown",
      row.zone || "—",
      severityLabel(row.severity),
      statusLabel(row.status),
      durationLabel(row.recorded_at, row.resolved_at),
    ]);
    const resolvedCount = data.filter((r: any) => r.status === "resolved").length;
    const criticalCount = data.filter((r: any) => r.severity === "critical").length;
    const responseMs: number[] = data
      .filter((r: any) => r.recorded_at && r.resolved_at)
      .map((r: any) => new Date(r.resolved_at).getTime() - new Date(r.recorded_at).getTime());
    const avgResponseSec = responseMs.length > 0
      ? Math.round(responseMs.reduce((a, b) => a + b, 0) / responseMs.length / 1000)
      : 0;
    return {
      incidents,
      totalIncidents: data.length,
      resolvedCount,
      criticalCount,
      avgResponseSec,
    };
  } catch (err) {
    console.warn("[compliance-data] incidents:", err);
    return { incidents: null, totalIncidents: 0, resolvedCount: 0, criticalCount: 0, avgResponseSec: 0 };
  }
}

async function fetchZoneRiskBlock(companyId: string, incidentCountByZone: Map<string, number>): Promise<ZoneRiskBlock | null> {
  try {
    const { data, error } = await supabase
      .from("risk_register")
      .select("zone, risk_level, risk_score, responsible_person, review_date")
      .eq("company_id", companyId);
    if (error || !data || data.length === 0) return null;

    // Aggregate by zone: highest risk level wins, count rows, use worst score.
    const byZone = new Map<string, { level: string; worstScore: number; count: number; reviewer: string; reviewDate: string }>();
    for (const r of data as any[]) {
      const key = r.zone || "—";
      const existing = byZone.get(key);
      const level = existing && rankLevel(existing.level) >= rankLevel(r.risk_level) ? existing.level : r.risk_level;
      const worstScore = Math.max(existing?.worstScore ?? 0, r.risk_score ?? 0);
      const count = (existing?.count ?? 0) + 1;
      byZone.set(key, {
        level,
        worstScore,
        count,
        reviewer: r.responsible_person || existing?.reviewer || "Unassigned",
        reviewDate: r.review_date ? fmtShortDate(new Date(r.review_date)) : existing?.reviewDate || "—",
      });
    }

    const tableRows: string[][] = [];
    const incidentChart: ChartBar[] = [];
    const workersChart: ChartBar[] = [];
    let i = 0;
    for (const [zone, v] of byZone) {
      const incCount = incidentCountByZone.get(zone) ?? 0;
      tableRows.push([
        zone,
        titleCase(v.level),
        String(v.count),          // risks
        String(incCount),         // incidents in zone
        v.reviewDate,
        String(v.count),          // placeholder for open risks — same as count until we split
        v.reviewer,
      ]);
      const color = ROTATING_COLORS[i % ROTATING_COLORS.length];
      incidentChart.push({ label: zone, value: incCount, color });
      workersChart.push({ label: zone, value: v.count, color });
      i += 1;
    }
    return { tableRows, incidentChart, workersChart };
  } catch (err) {
    console.warn("[compliance-data] zoneRisk:", err);
    return null;
  }
}

function rankLevel(level: string): number {
  switch ((level || "").toLowerCase()) {
    case "extreme": return 5;
    case "high": return 4;
    case "medium": return 3;
    case "low": return 2;
    case "negligible": return 1;
    default: return 0;
  }
}

function titleCase(s: string): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

async function fetchCorrectiveActionsBlock(companyId: string): Promise<string[][] | null> {
  try {
    const { data, error } = await supabase
      .from("investigations")
      .select("id, incident_id, actions, updated_at")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error || !data || data.length === 0) return null;

    const rows: string[][] = [];
    for (const inv of data as any[]) {
      const actions = Array.isArray(inv.actions) ? inv.actions : [];
      for (const a of actions) {
        rows.push([
          inv.incident_id || inv.id,
          a.description || "—",
          a.assignedTo || "Unassigned",
          a.dueDate ? fmtShortDate(new Date(a.dueDate)) : "—",
          titleCase(a.status || "planned"),
        ]);
      }
      if (rows.length >= 30) break; // hard cap for the PDF page budget
    }
    return rows.length > 0 ? rows : null;
  } catch (err) {
    console.warn("[compliance-data] correctiveActions:", err);
    return null;
  }
}

async function fetchEmployeeRosterBlock(companyId: string): Promise<{
  roster: string[][] | null;
  totalEmployees: number;
  onDutyCount: number;
}> {
  try {
    const { data, error } = await supabase
      .from("employees")
      .select("name, role, zone, status, last_active")
      .eq("company_id", companyId)
      .limit(50);
    if (error || !data || data.length === 0) {
      return { roster: null, totalEmployees: 0, onDutyCount: 0 };
    }
    const roster = (data as any[]).map((e) => [
      e.name || "—",
      e.role || "—",
      e.zone || "—",
      e.status || "—",
      e.last_active ? fmtShortDate(new Date(e.last_active)) : "—",
      "—",           // buddy partner — would require a separate join
      e.status && e.status !== "unknown" ? "[OK] Complete" : "[!] Incomplete",
    ]);
    const onDutyCount = (data as any[]).filter((e) => e.status === "on_duty").length;
    return { roster, totalEmployees: data.length, onDutyCount };
  } catch (err) {
    console.warn("[compliance-data] employees:", err);
    return { roster: null, totalEmployees: 0, onDutyCount: 0 };
  }
}

// ── Playbook catalog (static metadata mirrored from emergency-playbook) ──
// We don't pull this from emergency-playbook.tsx directly to keep heavy
// UI deps (motion, lucide-react, toast, design-system) out of the PDF
// build path. IDs must stay in sync with MOCK_PLAYBOOKS in
// emergency-playbook.tsx so the playbook_usage join lines up.
const PLAYBOOK_CATALOG: { id: string; name: string; triggerType: string; stepCount: number; autoTrigger: boolean }[] = [
  { id: "PB-001", name: "SOS Button Response",        triggerType: "SOS Button",           stepCount: 8, autoTrigger: true  },
  { id: "PB-002", name: "Fall Detection Response",    triggerType: "Fall Detected",        stepCount: 6, autoTrigger: true  },
  { id: "PB-003", name: "Fire / Gas Leak Protocol",   triggerType: "Environmental Hazard", stepCount: 7, autoTrigger: false },
  { id: "PB-004", name: "Security Threat Response",   triggerType: "Security Threat",      stepCount: 6, autoTrigger: false },
  { id: "PB-005", name: "Missed Check-in Escalation", triggerType: "Missed Check-in",      stepCount: 5, autoTrigger: true  },
];

// Rough client-side mapping from playbook triggerType to the sos_type
// values stored on rrp_sessions, so we can compute "avg response time
// the last time this playbook was actually exercised."
const TRIGGER_TO_SOS_TYPE: Record<string, string[]> = {
  "SOS Button":           ["sos_button"],
  "Fall Detected":        ["fall_detected"],
  "Environmental Hazard": ["h2s_gas", "evacuation"],
  "Security Threat":      [],
  "Missed Check-in":      ["missed_checkin"],
};

async function fetchPlaybookDataBlock(companyId: string): Promise<string[][] | null> {
  try {
    // Pull usage counts and last run times in one shot.
    const [usageRes, rrpRes] = await Promise.all([
      supabase
        .from("playbook_usage")
        .select("playbook_id, use_count, last_used_at")
        .eq("company_id", companyId),
      supabase
        .from("rrp_sessions")
        .select("sos_type, total_time_sec")
        .eq("company_id", companyId)
        .limit(500),
    ]);

    const usage = new Map<string, { count: number; lastUsedAt?: string }>();
    if (!usageRes.error && usageRes.data) {
      for (const row of usageRes.data as any[]) {
        usage.set(row.playbook_id, {
          count: typeof row.use_count === "number" ? row.use_count : Number(row.use_count) || 0,
          lastUsedAt: row.last_used_at,
        });
      }
    }

    // Average response seconds keyed by sos_type.
    const avgBySosType = new Map<string, number>();
    if (!rrpRes.error && rrpRes.data) {
      const bucket = new Map<string, { sum: number; n: number }>();
      for (const row of rrpRes.data as any[]) {
        const key = row.sos_type || "";
        if (!key) continue;
        const b = bucket.get(key) ?? { sum: 0, n: 0 };
        b.sum += row.total_time_sec ?? 0;
        b.n += 1;
        bucket.set(key, b);
      }
      for (const [k, b] of bucket) {
        if (b.n > 0) avgBySosType.set(k, Math.round(b.sum / b.n));
      }
    }

    // If we have nothing real for any row, return null so the PDF falls
    // back to MOCK_PLAYBOOK_DATA cleanly instead of showing a half-empty
    // row grid.
    if (usage.size === 0 && avgBySosType.size === 0) return null;

    const rows: string[][] = PLAYBOOK_CATALOG.map((p) => {
      const u = usage.get(p.id);
      const sosTypes = TRIGGER_TO_SOS_TYPE[p.triggerType] ?? [];
      let avgSec: number | null = null;
      for (const t of sosTypes) {
        const v = avgBySosType.get(t);
        if (typeof v === "number") { avgSec = v; break; }
      }
      const avgLabel = avgSec !== null
        ? `${Math.floor(avgSec / 60)}m ${(avgSec % 60).toString().padStart(2, "0")}s`
        : "--";
      return [
        p.name,
        p.triggerType,
        String(p.stepCount),
        p.autoTrigger ? "Yes" : "No",
        String(u?.count ?? 0),
        avgLabel,
      ];
    });
    return rows;
  } catch (err) {
    console.warn("[compliance-data] playbookData:", err);
    return null;
  }
}

async function fetchJourneyLogBlock(companyId: string): Promise<string[][] | null> {
  try {
    const { data, error } = await supabase
      .from("journeys")
      .select("id, employee_name, origin, destination, vehicle_type, status, distance_covered, total_distance, waypoints")
      .eq("company_id", companyId)
      .order("start_time", { ascending: false })
      .limit(30);
    if (error || !data || data.length === 0) return null;
    return (data as any[]).map((j) => {
      const waypoints = Array.isArray(j.waypoints) ? j.waypoints : [];
      const missed = waypoints.filter((w: any) => w.status === "missed").length;
      const covered = typeof j.distance_covered === "number" ? j.distance_covered : Number(j.distance_covered) || 0;
      const total = typeof j.total_distance === "number" ? j.total_distance : Number(j.total_distance) || 0;
      return [
        j.id,
        j.employee_name || "—",
        j.origin || "—",
        j.destination || "—",
        j.vehicle_type || "—",
        titleCase(j.status || "active"),
        `${covered}/${total} km`,
        String(missed),
      ];
    });
  } catch (err) {
    console.warn("[compliance-data] journeyLog:", err);
    return null;
  }
}

async function fetchCheckinComplianceBlock(companyId: string): Promise<CheckinBlock | null> {
  try {
    // Last 30 days of check-in events, grouped by employee.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("checkin_events")
      .select("employee_name, status, created_at")
      .eq("company_id", companyId)
      .gte("created_at", thirtyDaysAgo)
      .limit(2000);
    if (error || !data || data.length === 0) return null;

    type Bucket = { expected: number; onTime: number; late: number; missed: number };
    const byEmp = new Map<string, Bucket>();
    for (const row of data as any[]) {
      const name = row.employee_name || "Unknown";
      const b = byEmp.get(name) ?? { expected: 0, onTime: 0, late: 0, missed: 0 };
      b.expected += 1;
      const status = (row.status || "").toLowerCase();
      if (status === "on_time" || status === "ok") b.onTime += 1;
      else if (status === "late") b.late += 1;
      else if (status === "missed") b.missed += 1;
      else b.onTime += 1;
      byEmp.set(name, b);
    }
    const tableRows: string[][] = [];
    const chartBars: ChartBar[] = [];
    for (const [name, b] of byEmp) {
      const compliancePct = b.expected > 0 ? Math.round(((b.onTime + b.late * 0.5) / b.expected) * 100) : 0;
      tableRows.push([
        name,
        String(b.expected),
        String(b.onTime),
        String(b.late),
        String(b.missed),
        `${compliancePct}%`,
      ]);
      chartBars.push({
        label: name,
        value: compliancePct,
        max: 100,
        color: scoreToColor(compliancePct),
        suffix: "%",
      });
    }
    return tableRows.length > 0 ? { tableRows, chartBars } : null;
  } catch (err) {
    console.warn("[compliance-data] checkinCompliance:", err);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Fetch everything the PDF needs in parallel. Every field is nullable;
 * the PDF generator applies its own MOCK_* fallback per-field, so
 * partial results (e.g. we have incidents but no risks yet) still
 * produce a valid report with a reasonable mix of real + demo data.
 */
export async function buildCompliancePdfData(): Promise<CompliancePdfData | null> {
  const companyId = getCompanyId();
  if (!companyId) return null;

  const [incidentsBlock, employeeBlock, checkin, correctiveActions, journeyLog, playbookData] = await Promise.all([
    fetchIncidentsBlock(companyId),
    fetchEmployeeRosterBlock(companyId),
    fetchCheckinComplianceBlock(companyId),
    fetchCorrectiveActionsBlock(companyId),
    fetchJourneyLogBlock(companyId),
    fetchPlaybookDataBlock(companyId),
  ]);

  // Build a zone → incident count map so the zone risk block can
  // layer real incident counts onto the risk table without another
  // server round-trip.
  const incidentCountByZone = new Map<string, number>();
  if (incidentsBlock.incidents) {
    for (const row of incidentsBlock.incidents) {
      const zone = row[4] || "—";
      incidentCountByZone.set(zone, (incidentCountByZone.get(zone) ?? 0) + 1);
    }
  }
  const zoneRisk = await fetchZoneRiskBlock(companyId, incidentCountByZone);

  // Derive the KPI block from the real numbers we just collected. If
  // everything returned empty we return null for this field too, so
  // the whole PDF falls back to MOCK consistently rather than showing
  // a half-empty dashboard.
  let kpi: KpiDataBlock | null = null;
  if (incidentsBlock.totalIncidents > 0 || employeeBlock.totalEmployees > 0) {
    const resolutionPct = incidentsBlock.totalIncidents > 0
      ? Math.round((incidentsBlock.resolvedCount / incidentsBlock.totalIncidents) * 100)
      : 100;
    const avgMin = Math.floor(incidentsBlock.avgResponseSec / 60);
    const avgSec = incidentsBlock.avgResponseSec % 60;
    const avgResponseLabel = incidentsBlock.avgResponseSec > 0
      ? `${avgMin}m ${avgSec.toString().padStart(2, "0")}s`
      : "—";
    const dutyCoverage = employeeBlock.totalEmployees > 0
      ? Math.round((employeeBlock.onDutyCount / employeeBlock.totalEmployees) * 100)
      : 0;
    const checkinRate = checkin && checkin.tableRows.length > 0
      ? Math.round(
          checkin.tableRows.reduce((s, r) => s + parseInt(r[5].replace("%", ""), 10), 0) /
            checkin.tableRows.length,
        )
      : 0;

    kpi = {
      tableRows: [
        ["Total Incidents (30d)", String(incidentsBlock.totalIncidents), "< 5", incidentsBlock.totalIncidents < 5 ? "[OK] ON TARGET" : "[!] NEEDS REVIEW"],
        ["Resolution Rate", `${resolutionPct}%`, ">= 90%", resolutionPct >= 90 ? "[OK] ON TARGET" : "[!] BELOW TARGET"],
        ["Avg Response Time", avgResponseLabel, "< 3 min", incidentsBlock.avgResponseSec > 0 && incidentsBlock.avgResponseSec < 180 ? "[OK] ON TARGET" : "[!] REVIEW"],
        ["Critical Incidents", String(incidentsBlock.criticalCount), "0", incidentsBlock.criticalCount === 0 ? "[OK] ON TARGET" : "[!] CRITICAL REVIEW"],
        ["On-Duty Coverage", `${dutyCoverage}%`, ">= 80%", dutyCoverage >= 80 ? "[OK] ON TARGET" : "[!] BELOW TARGET"],
        ["Check-in Compliance", `${checkinRate}%`, ">= 90%", checkinRate >= 90 ? "[OK] ON TARGET" : "[!] BELOW TARGET"],
      ],
      chartBars: [
        { label: "Resolved", value: resolutionPct, color: scoreToColor(resolutionPct) },
        { label: "On-Duty", value: dutyCoverage, color: scoreToColor(dutyCoverage) },
        { label: "Check-in", value: checkinRate, color: scoreToColor(checkinRate) },
      ],
    };
  }

  return {
    kpi,
    incidents: incidentsBlock.incidents,
    correctiveActions,
    zoneRisk,
    employeeRoster: employeeBlock.roster,
    checkinCompliance: checkin,
    journeyLog,           // P3-#11f populated this from `journeys`
    playbookData,         // P3-#11g populated this from `playbook_usage` + rrp_sessions
  };
}
