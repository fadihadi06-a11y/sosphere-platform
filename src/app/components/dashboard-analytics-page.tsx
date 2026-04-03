// ═══════════════════════════════════════════════════════════════
// SOSphere — Analytics & Reports Page
// Enterprise-grade analytics with recharts
// ═══════════════════════════════════════════════════════════════
import React, { useState, useId } from "react";
import { motion } from "motion/react";
import { useDashboardStore } from "./stores/dashboard-store";
import {
  BarChart3, TrendingUp, TrendingDown, Download, Filter,
  Calendar, Users, AlertTriangle, Shield, Clock, Activity,
  ChevronDown, FileText, Zap, Target, Megaphone, Siren, Satellite,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { getBroadcasts, type BroadcastMessage, ZONE_NAMES } from "./shared-store";
import { getRealAuditLog } from "./audit-log-store";
import { getTimelineEntries, getRealResponseTimeSec } from "./smart-timeline-tracker";
import { toast } from "sonner";
import { hapticSuccess } from "./haptic-feedback";
import jsPDF from "jspdf";

interface AnalyticsPageProps {
  t?: (key: string) => string;
  webMode?: boolean;
}

// ── Mock Data ─────���───────────────────────────────────────────
/* SUPABASE_MIGRATION_POINT: analytics_monthly_incidents
   SELECT month, sos_count, hazard_count, geofence_count, checkin_count
   FROM analytics_data WHERE company_id = :id AND time_range = :timeRange */
const MONTHLY_INCIDENTS = [
  { month: "Sep", sos: 12, hazard: 8, geofence: 5, checkin: 15 },
  { month: "Oct", sos: 9, hazard: 11, geofence: 3, checkin: 12 },
  { month: "Nov", sos: 15, hazard: 6, geofence: 7, checkin: 18 },
  { month: "Dec", sos: 7, hazard: 9, geofence: 4, checkin: 10 },
  { month: "Jan", sos: 5, hazard: 7, geofence: 2, checkin: 8 },
  { month: "Feb", sos: 3, hazard: 4, geofence: 1, checkin: 6 },
  { month: "Mar", sos: 2, hazard: 3, geofence: 1, checkin: 4 },
];

/* SUPABASE_MIGRATION_POINT: analytics_response_times
   SELECT month, avg_response_sec, target_response_sec
   FROM analytics_data WHERE company_id = :id AND time_range = :timeRange */
const RESPONSE_TIMES = [
  { month: "Sep", avg: 180, target: 120 },
  { month: "Oct", avg: 156, target: 120 },
  { month: "Nov", avg: 142, target: 120 },
  { month: "Dec", avg: 128, target: 120 },
  { month: "Jan", avg: 115, target: 120 },
  { month: "Feb", avg: 98, target: 120 },
  { month: "Mar", avg: 87, target: 120 },
];

/* SUPABASE_MIGRATION_POINT: analytics_safety_trend
   SELECT week, safety_score FROM analytics_data
   WHERE company_id = :id AND time_range = :timeRange */
const SAFETY_TREND = [
  { week: "W1", score: 78 },
  { week: "W2", score: 81 },
  { week: "W3", score: 79 },
  { week: "W4", score: 84 },
  { week: "W5", score: 82 },
  { week: "W6", score: 86 },
  { week: "W7", score: 85 },
  { week: "W8", score: 87 },
  { week: "W9", score: 89 },
  { week: "W10", score: 88 },
  { week: "W11", score: 91 },
  { week: "W12", score: 87 },
];

/* SUPABASE_MIGRATION_POINT: analytics_incident_by_type
   SELECT incident_type, count(*) as value FROM analytics_data
   WHERE company_id = :id AND time_range = :timeRange GROUP BY incident_type */
const INCIDENT_BY_TYPE = [
  { name: "SOS Button", value: 28, color: "#FF2D55" },
  { name: "Missed Check-in", value: 35, color: "#FF9500" },
  { name: "Geofence Breach", value: 15, color: "#00C8E0" },
  { name: "Hazard Report", value: 22, color: "#7B5EFF" },
];

/* SUPABASE_MIGRATION_POINT: analytics_zone_safety
   SELECT z.name, z.safety_score, count(i.id) as incidents, z.compliance_score
   FROM analytics_data z LEFT JOIN incidents i ON z.id = i.zone_id
   WHERE z.company_id = :id AND time_range = :timeRange GROUP BY z.id */
const ZONE_SAFETY = [
  { zone: ZONE_NAMES.A, safety: 85, incidents: 12, compliance: 92 },
  { zone: ZONE_NAMES.B, safety: 94, incidents: 4, compliance: 98 },
  { zone: ZONE_NAMES.C, safety: 91, incidents: 6, compliance: 95 },
  { zone: ZONE_NAMES.D, safety: 68, incidents: 22, compliance: 74 },
  { zone: ZONE_NAMES.E, safety: 96, incidents: 2, compliance: 99 },
];

/* SUPABASE_MIGRATION_POINT: analytics_radar_data
   SELECT metric_name, score FROM analytics_data
   WHERE company_id = :id AND time_range = :timeRange */
const RADAR_DATA = [
  { metric: "Response Time", A: 92, fullMark: 100 },
  { metric: "Check-in Rate", A: 88, fullMark: 100 },
  { metric: "Zone Compliance", A: 85, fullMark: 100 },
  { metric: "PPE Compliance", A: 91, fullMark: 100 },
  { metric: "Training", A: 78, fullMark: 100 },
  { metric: "Drill Participation", A: 95, fullMark: 100 },
];

/* SUPABASE_MIGRATION_POINT: analytics_dept_performance
   SELECT d.name, d.safety_score, count(i.id) as incidents
   FROM analytics_data d LEFT JOIN incidents i ON d.id = i.dept_id
   WHERE d.company_id = :id AND time_range = :timeRange GROUP BY d.id */
const DEPT_PERFORMANCE = [
  { dept: "Engineering", score: 92, incidents: 3, color: "#00C8E0" },
  { dept: "Safety", score: 98, incidents: 1, color: "#00C853" },
  { dept: "Operations", score: 84, incidents: 8, color: "#FF9500" },
  { dept: "Maintenance", score: 76, incidents: 12, color: "#FF2D55" },
  { dept: "Security", score: 91, incidents: 2, color: "#7B5EFF" },
  { dept: "Logistics", score: 88, incidents: 4, color: "#00C8E0" },
  { dept: "Medical", score: 96, incidents: 1, color: "#00C853" },
];

/* SUPABASE_MIGRATION_POINT: analytics_kpi_summary
   SELECT metric, value, delta_pct, direction FROM analytics_data
   WHERE company_id = :id AND period = :timeRange */
const KPI_SUMMARY = [
  { label: "Total Incidents", value: "127", delta: "-23%", up: false, color: "#00C853", icon: AlertTriangle, desc: "vs last quarter" },
  { label: "Avg Response Time", value: "87s", delta: "-52%", up: false, color: "#00C8E0", icon: Clock, desc: "vs 180s target" },
  { label: "Safety Score", value: "87%", delta: "+9%", up: true, color: "#00C853", icon: Shield, desc: "company average" },
  { label: "SLA Compliance", value: "96.4%", delta: "+4.2%", up: true, color: "#7B5EFF", icon: Target, desc: "2min threshold" },
];

const customTooltipStyle = {
  background: "rgba(10,18,32,0.95)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
  padding: "10px 14px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  backdropFilter: "blur(20px)",
};

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={customTooltipStyle}>
      <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <div className="size-2 rounded-full" style={{ background: p.color }} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{p.name}:</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Real Analytics Builder ────────────────────────────────────
function buildRealAnalytics() {
  try {
    const auditLogs = getRealAuditLog();
    const timelineEntries = getTimelineEntries();

    // Group audit entries by month
    const monthlyMap: Record<string, { sos: number; hazard: number; geofence: number; checkin: number }> = {};
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    auditLogs.forEach(e => {
      const d = new Date(e.timestamp);
      const key = monthNames[d.getMonth()];
      if (!monthlyMap[key]) monthlyMap[key] = { sos: 0, hazard: 0, geofence: 0, checkin: 0 };
      if (e.action?.includes("sos") || e.action?.includes("emergency_triggered")) monthlyMap[key].sos++;
      else if (e.action?.includes("hazard")) monthlyMap[key].hazard++;
      else if (e.action?.includes("geofence")) monthlyMap[key].geofence++;
      else if (e.action?.includes("checkin") || e.action?.includes("check_in")) monthlyMap[key].checkin++;
    });

    // Build monthly incidents array (last 7 months)
    const now = new Date();
    const monthlyIncidents = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (6 - i), 1);
      const key = monthNames[d.getMonth()];
      const entry = monthlyMap[key] || { sos: 0, hazard: 0, geofence: 0, checkin: 0 };
      return { month: key, ...entry };
    });

    // KPI from real data
    const totalIncidents = auditLogs.filter(e => e.action?.includes("emergency")).length;
    const resolvedCount  = auditLogs.filter(e => e.action?.includes("resolved")).length;
    const realResponseSec = getRealResponseTimeSec();
    const avgResponseSec = realResponseSec > 0 ? realResponseSec : null;

    // Incident by type from timeline
    const sosCt   = timelineEntries.filter(e => e.type === "sos_triggered").length;
    const hazCt   = timelineEntries.filter(e => e.type === "sos_triggered" && e.detail?.includes("Hazard")).length;
    const fallCt  = timelineEntries.filter(e => e.type === "sos_triggered" && e.detail?.includes("Fall")).length;
    const checkinCt = auditLogs.filter(e => e.action?.includes("checkin")).length;

    const incidentByType = sosCt + hazCt + fallCt + checkinCt > 0 ? [
      { name: "SOS Button",      value: Math.max(sosCt - hazCt - fallCt, sosCt > 0 ? 1 : 0), color: "#FF2D55" },
      { name: "Hazard Report",   value: hazCt,   color: "#7B5EFF" },
      { name: "Fall Detected",   value: fallCt,  color: "#FF9500" },
      { name: "Missed Check-in", value: checkinCt, color: "#00C8E0" },
    ].filter(t => t.value > 0) : null;

    return { monthlyIncidents: monthlyIncidents.some(m => m.sos + m.hazard + m.geofence + m.checkin > 0) ? monthlyIncidents : null, totalIncidents, resolvedCount, avgResponseSec, incidentByType };
  } catch { return { monthlyIncidents: null, totalIncidents: 0, resolvedCount: 0, avgResponseSec: null, incidentByType: null }; }
}

export function AnalyticsPage({ t, webMode = false }: AnalyticsPageProps) {
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d" | "1y">("90d");
  const uid = useId().replace(/:/g, "-");
  const realAnalytics = React.useMemo(buildRealAnalytics, []);
  // Pull live KPI data from Zustand store (fetched via Supabase in initDashboard)
  const storeKpis = useDashboardStore(s => s.kpis);
  const storeEmergencies = useDashboardStore(s => s.emergencies);
  const storeEmployees = useDashboardStore(s => s.employees);

  // REAL DATA: use audit log if available, fall back to demo data
  const filteredIncidents = React.useMemo(() => {
    const source = realAnalytics.monthlyIncidents || MONTHLY_INCIDENTS;
    const sliceMap: Record<string, number> = { "7d": 1, "30d": 2, "90d": 4, "1y": 7 };
    const count = sliceMap[timeRange] ?? source.length;
    return source.slice(-count);
  }, [timeRange, realAnalytics.monthlyIncidents]);

  const filteredResponseTimes = React.useMemo(() => {
    const sliceMap: Record<string, number> = { "7d": 1, "30d": 2, "90d": 4, "1y": 7 };
    const count = sliceMap[timeRange] ?? RESPONSE_TIMES.length;
    return RESPONSE_TIMES.slice(-count);
  }, [timeRange]);

  // Real KPI override — uses store KPIs (from Supabase) first, then audit-log fallback
  const realKPI = React.useMemo(() => {
    const base = [...KPI_SUMMARY];
    // Use store KPIs (Supabase) when available
    if (storeKpis?.totalEmployees != null) {
      const totalInc = storeKpis.activeEmergencies + storeKpis.resolvedToday;
      if (totalInc > 0) base[0] = { ...base[0], value: String(totalInc), delta: storeKpis.resolvedToday > 0 ? `${storeKpis.resolvedToday} resolved` : "", desc: "actual incidents (Supabase)" };
      if (storeKpis.avgResponseTime != null) base[1] = { ...base[1], value: `${storeKpis.avgResponseTime}s`, delta: storeKpis.avgResponseTime < 120 ? "✓ Under 2min" : "⚠ Over 2min", desc: "real avg response time" };
      const safetyScore = storeKpis.safetyScore ?? (storeEmployees.length > 0 ? Math.round(100 - (storeKpis.activeEmergencies / Math.max(storeEmployees.length, 1)) * 100) : null);
      if (safetyScore != null) base[2] = { ...base[2], value: `${Math.max(0, Math.min(100, safetyScore))}%`, delta: safetyScore >= 90 ? "+Good" : safetyScore >= 70 ? "Moderate" : "⚠ Low", desc: "live safety score" };
      const slaCompliance = storeKpis.slaCompliance ?? (storeKpis.avgResponseTime != null ? (storeKpis.avgResponseTime < 120 ? 96.4 : 82.1) : null);
      if (slaCompliance != null) base[3] = { ...base[3], value: `${slaCompliance}%`, delta: slaCompliance >= 95 ? "+Good" : "Needs work", desc: "2min SLA threshold" };
    } else {
      // Fallback to audit-log analytics
      if (realAnalytics.totalIncidents > 0) base[0] = { ...base[0], value: String(realAnalytics.totalIncidents), delta: "", desc: "actual incidents logged" };
      if (realAnalytics.avgResponseSec) base[1] = { ...base[1], value: `${realAnalytics.avgResponseSec}s`, delta: realAnalytics.avgResponseSec < 120 ? "✓ Under 2min" : "⚠ Over 2min", desc: "real average response" };
    }
    return base;
  }, [realAnalytics, storeKpis, storeEmergencies, storeEmployees]);

  const realIncidentByType = realAnalytics.incidentByType || INCIDENT_BY_TYPE;

  return (
    <div className={webMode ? "p-6 space-y-6" : "px-4 pt-4 space-y-4"}>
      {/* Hidden SVG gradient definitions — kept outside recharts to avoid key collisions */}
      <svg style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden>
        <defs>
          <linearGradient id={`${uid}-gradSos`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#FF2D55" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#FF2D55" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`${uid}-gradHaz`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#7B5EFF" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#7B5EFF" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`${uid}-gradSafety`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00C853" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#00C853" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(123,94,255,0.12)", border: "1px solid rgba(123,94,255,0.25)" }}>
            <BarChart3 className="size-5" style={{ color: "#7B5EFF" }} />
          </div>
          <div>
            <h2 className="text-white" style={{ fontSize: webMode ? 22 : 18, fontWeight: 800, letterSpacing: "-0.5px" }}>
              Analytics & Reports
            </h2>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
              Safety performance insights & trend analysis
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <div className="flex items-center gap-1 p-1 rounded-xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            {(["7d", "30d", "90d", "1y"] as const).map(r => (
              <button key={r} onClick={() => {
                setTimeRange(r);
                console.log("[SUPABASE_READY] analytics_timerange_changed: " + r);
              }}
                className="px-3 py-1.5 rounded-lg transition-all"
                style={{
                  fontSize: 12, fontWeight: 600,
                  color: timeRange === r ? "#fff" : "rgba(255,255,255,0.3)",
                  background: timeRange === r ? "rgba(123,94,255,0.2)" : "transparent",
                  border: timeRange === r ? "1px solid rgba(123,94,255,0.3)" : "1px solid transparent",
                }}>
                {r}
              </button>
            ))}
          </div>
          {/* Export */}
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl"
            onClick={async () => {
              hapticSuccess();
              console.log("[SUPABASE_READY] analytics_pdf_export", { timeRange });
              toast.loading("Generating analytics PDF...", { id: "analytics-pdf" });
              try {
                await import("jspdf-autotable");
                const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
                const pw = doc.internal.pageSize.getWidth();
                const safe = (s: string) => s.replace(/[^\x00-\x7F]/g, "");
                // Background
                doc.setFillColor(5, 7, 14);
                doc.rect(0, 0, pw, doc.internal.pageSize.getHeight(), "F");
                // Header
                doc.setFontSize(22);
                doc.setTextColor(0, 200, 224);
                doc.text("SOSphere Analytics Report", pw / 2, 22, { align: "center" });
                doc.setFontSize(9);
                doc.setTextColor(150);
                doc.text(`Generated: ${new Date().toLocaleString()} | Period: ${timeRange}`, pw / 2, 30, { align: "center" });
                let y = 42;
                // KPIs
                doc.setFontSize(12);
                doc.setTextColor(255);
                doc.text("Key Performance Indicators", 14, y); y += 8;
                KPI_SUMMARY.forEach(kpi => {
                  doc.setFontSize(10);
                  doc.setTextColor(200);
                  doc.text(safe(kpi.label), 16, y);
                  doc.setTextColor(0, 200, 224);
                  doc.text(safe(kpi.value), 120, y);
                  y += 7;
                });
                y += 6;
                // Monthly incidents table
                doc.setFontSize(12);
                doc.setTextColor(255);
                doc.text("Monthly Incident Breakdown", 14, y); y += 4;
                (doc as any).autoTable({
                  startY: y,
                  head: [["Month", "SOS", "Hazard", "Geofence", "Check-in"]],
                  body: filteredIncidents.map(m => [m.month, m.sos, m.hazard, m.geofence, m.checkin]),
                  theme: "grid",
                  headStyles: { fillColor: [10, 18, 32], textColor: [0, 200, 224], fontSize: 9 },
                  bodyStyles: { fillColor: [8, 12, 22], textColor: [180, 180, 180], fontSize: 8 },
                  alternateRowStyles: { fillColor: [12, 16, 28] },
                  margin: { left: 14 },
                });
                y = (doc as any).lastAutoTable.finalY + 10;
                // Zone Safety
                doc.setFontSize(12);
                doc.setTextColor(255);
                doc.text("Zone Safety Scores", 14, y); y += 4;
                (doc as any).autoTable({
                  startY: y,
                  head: [["Zone", "Safety Score", "Incidents", "Status"]],
                  body: ZONE_SAFETY.map(z => [z.zone, z.safety + "/100", z.incidents.toString(), z.safety >= 85 ? "SAFE" : z.safety >= 70 ? "MODERATE" : "AT RISK"]),
                  theme: "grid",
                  headStyles: { fillColor: [10, 18, 32], textColor: [0, 200, 224], fontSize: 9 },
                  bodyStyles: { fillColor: [8, 12, 22], textColor: [180, 180, 180], fontSize: 8 },
                  alternateRowStyles: { fillColor: [12, 16, 28] },
                  margin: { left: 14 },
                });
                // Footer
                const ph = doc.internal.pageSize.getHeight();
                doc.setFontSize(7);
                doc.setTextColor(80);
                doc.text("SOSphere Analytics | Confidential | " + new Date().toISOString().split("T")[0], pw / 2, ph - 6, { align: "center" });
                doc.save(`SOSphere_Analytics_${timeRange}_${new Date().toISOString().split("T")[0]}.pdf`);
                toast.success("Analytics PDF Generated", { id: "analytics-pdf", description: `${timeRange} analytics report downloaded` });
                console.log("[SUPABASE_READY] analytics_pdf_generated", { timeRange });
              } catch (err) {
                console.error("Analytics PDF error:", err);
                toast.error("PDF Generation Failed", { id: "analytics-pdf" });
              }
            }}
            style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.2)", fontSize: 12, fontWeight: 600, color: "#00C8E0", cursor: "pointer" }}>
            <Download className="size-4" /> Export PDF
          </button>
        </div>
      </div>

      {/* KPI Summary Row */}
      <div className={`grid gap-4 ${webMode ? "grid-cols-4" : "grid-cols-2"}`}>
        {realKPI.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <motion.div key={kpi.label}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="p-4 rounded-2xl relative overflow-hidden group"
              style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: `radial-gradient(circle at 30% 50%, ${kpi.color}08 0%, transparent 70%)` }} />
              <div className="flex items-start justify-between mb-3 relative z-10">
                <div className="size-9 rounded-xl flex items-center justify-center"
                  style={{ background: `${kpi.color}12`, border: `1px solid ${kpi.color}20` }}>
                  <Icon className="size-4" style={{ color: kpi.color }} />
                </div>
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full"
                  style={{ background: kpi.up ? "rgba(0,200,83,0.1)" : "rgba(0,200,83,0.1)", border: `1px solid ${kpi.up ? "rgba(0,200,83,0.2)" : "rgba(0,200,83,0.2)"}` }}>
                  {kpi.up ? <TrendingUp className="size-3" style={{ color: "#00C853" }} /> : <TrendingDown className="size-3" style={{ color: "#00C853" }} />}
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853" }}>{kpi.delta}</span>
                </div>
              </div>
              <p className="relative z-10" style={{ fontSize: webMode ? 28 : 22, fontWeight: 800, letterSpacing: "-1px", color: kpi.color, lineHeight: 1 }}>{kpi.value}</p>
              <p className="mt-1 relative z-10" style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{kpi.label}</p>
              <p className="mt-0.5 relative z-10" style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{kpi.desc}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Charts Grid */}
      <div className={`grid gap-4 ${webMode ? "grid-cols-2" : "grid-cols-1"}`}>
        {/* Incident Trends */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Incident Trends</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Monthly breakdown by type</p>
            </div>
            <div className="flex items-center gap-3">
              {[
                { label: "SOS", color: "#FF2D55" },
                { label: "Hazard", color: "#7B5EFF" },
                { label: "Geofence", color: "#00C8E0" },
                { label: "Check-in", color: "#FF9500" },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <div className="size-2 rounded-full" style={{ background: l.color }} />
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{l.label}</span>
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={filteredIncidents}>
              <CartesianGrid key="cg" strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis key="xa" dataKey="month" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis key="ya" tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip key="tt" content={<CustomTooltip />} />
              <Area key="a-sos" type="monotone" dataKey="sos" stroke="#FF2D55" fill={`url(#${uid}-gradSos)`} strokeWidth={2} name="SOS" />
              <Area key="a-hazard" type="monotone" dataKey="hazard" stroke="#7B5EFF" fill={`url(#${uid}-gradHaz)`} strokeWidth={2} name="Hazard" />
              <Area key="a-geofence" type="monotone" dataKey="geofence" stroke="#00C8E0" fill="transparent" strokeWidth={2} strokeDasharray="4 4" name="Geofence" />
              <Area key="a-checkin" type="monotone" dataKey="checkin" stroke="#FF9500" fill="transparent" strokeWidth={2} strokeDasharray="4 4" name="Check-in" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Response Time Trend */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Response Time</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Average vs 2min SLA target</p>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full"
              style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.18)" }}>
              <TrendingDown className="size-3" style={{ color: "#00C853" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853" }}>-52% improvement</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={filteredResponseTimes}>
              <CartesianGrid key="cg" strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis key="xa" dataKey="month" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis key="ya" tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} axisLine={false} tickLine={false} unit="s" />
              <Tooltip key="tt" content={<CustomTooltip />} />
              <Line key="l-avg" type="monotone" dataKey="avg" stroke="#00C8E0" strokeWidth={3} dot={{ fill: "#00C8E0", r: 4 }} name="Average" />
              <Line key="l-target" type="monotone" dataKey="target" stroke="#FF9500" strokeWidth={2} strokeDasharray="6 3" dot={false} name="SLA Target" />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Safety Score Trend */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Safety Score Trend</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>12-week company average</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={SAFETY_TREND}>
              <CartesianGrid key="cg" strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis key="xa" dataKey="week" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis key="ya" domain={[70, 100]} tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip key="tt" content={<CustomTooltip />} />
              <Area key="a-score" type="monotone" dataKey="score" stroke="#00C853" fill={`url(#${uid}-gradSafety)`} strokeWidth={3} name="Safety Score" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Incident Distribution Pie */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="mb-4">
            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Incident Distribution</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>By incident type this quarter</p>
          </div>
          <div className="flex items-center gap-6">
            <div style={{ width: 160, height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie key="pie" data={INCIDENT_BY_TYPE} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                    paddingAngle={3} dataKey="value" stroke="none">
                  {realIncidentByType.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip key="tt" content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-3">
              {realIncidentByType.map(item => (
                <div key={item.name} className="flex items-center gap-3">
                  <div className="size-3 rounded" style={{ background: item.color }} />
                  <div className="flex-1">
                    <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{item.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
                        <div className="h-full rounded-full" style={{ background: item.color, width: `${item.value}%` }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: item.color }}>{item.value}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom Row */}
      <div className={`grid gap-4 ${webMode ? "grid-cols-3" : "grid-cols-1"}`}>
        {/* Zone Safety Comparison */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-white mb-4" style={{ fontSize: 14, fontWeight: 700 }}>Zone Safety Comparison</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={ZONE_SAFETY} barGap={4}>
              <CartesianGrid key="cg" strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis key="xa" dataKey="zone" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis key="ya" tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip key="tt" content={<CustomTooltip />} />
              <Bar key="b-safety" dataKey="safety" fill="#00C853" radius={[4, 4, 0, 0]} name="Safety" />
              <Bar key="b-compliance" dataKey="compliance" fill="#00C8E0" radius={[4, 4, 0, 0]} name="Compliance" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Safety Radar */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-white mb-4" style={{ fontSize: 14, fontWeight: 700 }}>Safety Radar</p>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={RADAR_DATA}>
              <PolarGrid key="pg" stroke="rgba(255,255,255,0.08)" />
              <PolarAngleAxis key="paa" dataKey="metric" tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 9 }} />
              <PolarRadiusAxis key="pra" angle={30} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar key="r-score" name="Score" dataKey="A" stroke="#00C8E0" fill="#00C8E0" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Department Leaderboard */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-white mb-4" style={{ fontSize: 14, fontWeight: 700 }}>Department Leaderboard</p>
          <div className="space-y-2.5">
            {DEPT_PERFORMANCE.sort((a, b) => b.score - a.score).map((dept, i) => (
              <div key={dept.dept} className="flex items-center gap-3 p-2.5 rounded-xl"
                style={{ background: i === 0 ? "rgba(0,200,83,0.06)" : "rgba(255,255,255,0.015)", border: `1px solid ${i === 0 ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.04)"}` }}>
                <span className="size-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: i < 3 ? `${dept.color}18` : "rgba(255,255,255,0.04)", fontSize: 10, fontWeight: 800, color: i < 3 ? dept.color : "rgba(255,255,255,0.3)" }}>
                  {i + 1}
                </span>
                <span className="flex-1 text-white" style={{ fontSize: 12, fontWeight: 600 }}>{dept.dept}</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div className="h-full rounded-full" style={{ background: dept.color, width: `${dept.score}%` }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 800, color: dept.color, minWidth: 32, textAlign: "right" }}>{dept.score}%</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* ── Broadcast Analytics Section ── */}
      <BroadcastAnalyticsSection webMode={webMode} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Broadcast Analytics — Live data from shared-store
// ══════════════════════════════════════════════════════════════
function BroadcastAnalyticsSection({ webMode }: { webMode: boolean }) {
  const broadcasts = getBroadcasts();

  // Compute stats
  const total = broadcasts.length;
  const manual = broadcasts.filter(b => b.source === "manual").length;
  const autoGps = broadcasts.filter(b => b.source === "auto_gps").length;
  const autoSos = broadcasts.filter(b => b.source === "auto_sos").length;
  const autoHazard = broadcasts.filter(b => b.source === "auto_hazard").length;
  const autoGeofence = broadcasts.filter(b => b.source === "auto_geofence").length;
  const emergency = broadcasts.filter(b => b.priority === "emergency").length;
  const urgent = broadcasts.filter(b => b.priority === "urgent").length;
  const normal = broadcasts.filter(b => b.priority === "normal").length;
  const info = broadcasts.filter(b => b.priority === "info").length;
  const totalRead = broadcasts.reduce((acc, b) => acc + b.readBy.length, 0);

  // SUPABASE_MIGRATION_POINT: analytics_broadcast_by_source
  // SELECT source, count(*) FROM broadcasts WHERE company_id = :id GROUP BY source
  // TODO: replace with real Supabase broadcast counts
  const BROADCAST_BY_SOURCE = [
    { name: "Manual", value: manual, color: "#00C8E0" },
    { name: "GPS Alert", value: autoGps, color: "#FF9500" },
    { name: "SOS Alert", value: autoSos, color: "#FF2D55" },
    { name: "Hazard Alert", value: autoHazard, color: "#7B5EFF" },
    { name: "Geofence", value: autoGeofence, color: "#00C853" },
  ];

  // SUPABASE_MIGRATION_POINT: analytics_broadcast_trend
  // SELECT week, count(*) as sent, sum(read_count) as read
  // FROM broadcasts WHERE company_id = :id GROUP BY week
  // TODO: replace with real Supabase broadcast counts
  const BROADCAST_TREND = [
    { week: "W1", sent: 12, read: 45 },
    { week: "W2", sent: 8, read: 32 },
    { week: "W3", sent: 15, read: 62 },
    { week: "W4", sent: 22, read: 88 },
    { week: "W5", sent: total, read: totalRead },
  ];

  // SUPABASE_MIGRATION_POINT: cost_comparison — static config, no migration needed
  const COST_COMPARISON = [
    { method: "SMS (Twilio)", cost: 1440, color: "#FF2D55" },
    { method: "WhatsApp API", cost: 960, color: "#FF9500" },
    { method: "Email", cost: 0, color: "#00C853" },
    { method: "SOSphere Broadcast", cost: 0, color: "#00C8E0" },
  ];

  if (total === 0 && !webMode) return null;

  return (
    <>
      <div className="flex items-center gap-3 mt-2">
        <div className="size-8 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.25)" }}>
          <Megaphone className="size-4" style={{ color: "#00C8E0" }} />
        </div>
        <div>
          <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>Broadcast Analytics</p>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
            In-app messaging performance — {total} broadcasts sent (live data)
          </p>
        </div>
      </div>

      {/* Broadcast KPIs */}
      <div className={`grid gap-3 ${webMode ? "grid-cols-5" : "grid-cols-3"}`}>
        {[
          { label: "Total Sent", value: total, icon: Megaphone, color: "#00C8E0" },
          { label: "Auto Alerts", value: autoGps + autoSos + autoHazard + autoGeofence, icon: Zap, color: "#FF9500" },
          { label: "Emergency", value: emergency, icon: Siren, color: "#FF2D55" },
          { label: "Read Rate", value: total > 0 ? `${Math.round((totalRead / Math.max(total, 1)) * 100)}%` : "—", icon: Target, color: "#00C853" },
          { label: "Cost Saved", value: "$1,440", icon: Shield, color: "#00C853" },
        ].map(stat => {
          const SIcon = stat.icon;
          return (
            <div key={stat.label} className="flex items-center gap-2.5 px-3 py-3 rounded-xl"
              style={{ background: `${stat.color}05`, border: `1px solid ${stat.color}10` }}>
              <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: `${stat.color}10` }}>
                <SIcon className="size-3.5" style={{ color: stat.color }} />
              </div>
              <div>
                <p style={{ fontSize: 16, fontWeight: 900, color: stat.color, letterSpacing: "-0.5px" }}>{stat.value}</p>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontWeight: 600 }}>{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className={`grid gap-4 ${webMode ? "grid-cols-2" : "grid-cols-1"}`}>
        {/* Broadcast by Source */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="mb-4">
            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Broadcasts by Source</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Manual vs automated alerts</p>
          </div>
          <div className="flex items-center gap-6">
            <div style={{ width: 140, height: 140 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie key="pie" data={BROADCAST_BY_SOURCE} cx="50%" cy="50%" innerRadius={40} outerRadius={65}
                    paddingAngle={3} dataKey="value" stroke="none">
                  {BROADCAST_BY_SOURCE.map((entry, i) => (
                    <Cell key={`source-${i}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip key="tt" content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2.5">
              {BROADCAST_BY_SOURCE.map(item => (
                <div key={item.name} className="flex items-center gap-2">
                  <div className="size-2.5 rounded" style={{ background: item.color }} />
                  <span className="flex-1" style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{item.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Cost Savings */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75 }}
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="mb-4">
            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Monthly Cost Comparison</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>SOSphere Broadcast vs traditional methods</p>
          </div>
          <div className="space-y-3">
            {COST_COMPARISON.map(item => (
              <div key={item.method} className="flex items-center gap-3">
                <span className="w-32 shrink-0" style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{item.method}</span>
                <div className="flex-1 h-2 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="h-full rounded-full" style={{
                    background: item.color,
                    width: item.cost === 0 ? "2%" : `${(item.cost / 1440) * 100}%`,
                    opacity: item.cost === 0 ? 1 : 0.7,
                  }} />
                </div>
                <span style={{
                  fontSize: 13, fontWeight: 800, minWidth: 55, textAlign: "right",
                  color: item.cost === 0 ? "#00C853" : "#FF2D55",
                }}>
                  {item.cost === 0 ? "$0" : `$${item.cost}`}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg flex items-center gap-2"
            style={{ background: "rgba(0,200,83,0.05)", border: "1px solid rgba(0,200,83,0.1)" }}>
            <Shield className="size-4 shrink-0" style={{ color: "#00C853" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#00C853" }}>
              Saving $1,440/month vs SMS — $17,280/year
            </span>
          </div>
        </motion.div>
      </div>
    </>
  );
}