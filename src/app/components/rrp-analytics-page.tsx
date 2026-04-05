// ═══════════════════════════════════════════════════════════════
// SOSphere — Response Analytics Dashboard Page
// ─────────────────────────────────────────────────────────────
// Tracks and visualizes admin emergency response performance:
// avg time, completion rates, streaks, heatmaps, admin
// comparisons, and per-emergency-type breakdowns with recharts.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Zap, Clock, Target, TrendingUp, TrendingDown, Activity, Brain, Shield, Flame, CheckCircle2, AlertTriangle, ChartBar, Timer, Users, Minus, Star, Crown, Download, FileText } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { getRRPAnalytics, seedMockRRPData, type RRPAnalytics } from "./rrp-analytics-store";
import { MOCK_ADMINS as LEADERBOARD_ADMINS } from "./training-center";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const SOS_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  sos_button:     { label: "SOS Button", color: "#FF2D55" },
  fall_detected:  { label: "Fall Detection", color: "#FF9500" },
  shake_sos:      { label: "Shake SOS", color: "#AF52DE" },
  missed_checkin: { label: "Missed Check-In", color: "#FF9500" },
  journey_sos:    { label: "Journey SOS", color: "#00C8E0" },
  medical:        { label: "Medical", color: "#00C853" },
  evacuation:     { label: "Evacuation", color: "#FF6B00" },
  h2s_gas:        { label: "H2S Gas", color: "#FF2D55" },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#FF2D55",
  high: "#FF9500",
  medium: "#00C8E0",
  low: "#00C853",
};

// ── Map Leaderboard data → Comparison format ──────────────────

const SPEED_RATINGS: Record<string, string> = {
  PLATINUM: "ELITE", GOLD: "FAST", SILVER: "GOOD", BRONZE: "AVG", ROOKIE: "NEW",
};

const TIER_COLOR_MAP: Record<string, string> = {
  PLATINUM: "#E5E4E2", GOLD: "#FFD700", SILVER: "#C0C0C0", BRONZE: "#CD7F32", ROOKIE: "#00C8E0",
};

interface ComparisonAdmin {
  name: string;
  role: string;
  avatar: string;
  avgTime: number;
  sessions: number;
  completion: number;
  streak: number;
  rating: string;
  color: string;
  tier: string;
  avgScore: number;
  trend: string;
}

function buildComparisonAdmins(): ComparisonAdmin[] {
  return LEADERBOARD_ADMINS.filter(a => a.totalIncidents > 0).map(a => ({
    name: a.name,
    role: a.role,
    avatar: a.avatar,
    avgTime: a.avgResponseTime,
    sessions: a.totalIncidents,
    completion: Math.min(100, Math.round(a.avgScore * 1.02)),
    streak: a.streak,
    rating: SPEED_RATINGS[a.tier] || "NEW",
    color: TIER_COLOR_MAP[a.tier] || "#00C8E0",
    tier: a.tier,
    avgScore: a.avgScore,
    trend: a.trend,
  }));
}

const COMPARISON_ADMINS = buildComparisonAdmins();

// ── PDF Helpers ────────────────────────────────────────��──────

const safe = (v: any): string => String(v ?? "");

function addPDFHeader(doc: jsPDF, title: string, subtitle: string) {
  // Dark header bar
  doc.setFillColor(5, 7, 14);
  doc.rect(0, 0, 210, 42, "F");
  // Accent line
  doc.setFillColor(0, 200, 224);
  doc.rect(0, 42, 210, 1.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(0, 200, 224);
  doc.text(safe("SOSphere"), 14, 16);

  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text(safe(title), 14, 26);

  doc.setFontSize(8);
  doc.setTextColor(160, 160, 180);
  doc.text(safe(subtitle), 14, 34);

  // Timestamp
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 140);
  doc.text(safe(`Generated: ${new Date().toLocaleString()}`), 196, 34, { align: "right" });
}

function addPDFWatermark(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(50);
    doc.setTextColor(0, 200, 224);
    doc.setGState(new (doc as any).GState({ opacity: 0.03 }));
    doc.text("SOSphere", 105, 160, { align: "center", angle: 35 });
    doc.setGState(new (doc as any).GState({ opacity: 1 }));
    // Footer
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 140);
    doc.text(safe(`SOSphere Response Analytics — Page ${i}/${pages}`), 105, 290, { align: "center" });
  }
}

// ═══════════════════════════════════════════════════════════════
// Stat Card
// ═══════════════════════════════════════════════════════════════

function StatCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string; color: string; icon: any;
}) {
  return (
    <div className="p-4 rounded-2xl" style={{ background: `${color}04`, border: `1px solid ${color}10` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: `${color}12` }}>
          <Icon className="size-4" style={{ color }} />
        </div>
        <span style={{ fontSize: 7, fontWeight: 800, color: `${color}80`, letterSpacing: "0.5px" }}>{label}</span>
      </div>
      <p style={{ fontSize: 24, fontWeight: 900, color }}>{value}</p>
      {sub && <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Custom Tooltip
// ═══════════════════════════════════════════════════════════════

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-xl" style={{ background: "rgba(10,18,32,0.95)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 4 }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ fontSize: 12, fontWeight: 700, color: p.color || "#00C8E0" }}>
          {p.name}: {p.value}{typeof p.value === "number" && p.name?.includes("Time") ? "s" : ""}
        </p>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Session History Row
// ═══════════════════════════════════════════════════════════════

function SessionRow({ session }: { session: any }) {
  const typeInfo = SOS_TYPE_LABELS[session.sosType] || { label: session.sosType, color: "#00C8E0" };
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const complete = session.actionsCompleted === session.actionsTotal;

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)" }}>
      <div className="size-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${typeInfo.color}10` }}>
        <Zap className="size-4" style={{ color: typeInfo.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{session.employeeName}</span>
          <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 800, color: typeInfo.color, background: `${typeInfo.color}10` }}>
            {typeInfo.label}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{session.zone}</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
            {new Date(session.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
      </div>
      <div className="text-right">
        <p style={{ fontSize: 14, fontWeight: 900, color: session.totalTimeSec < 45 ? "#00C853" : session.totalTimeSec < 90 ? "#00C8E0" : "#FF9500", fontVariantNumeric: "tabular-nums" }}>
          {fmtTime(session.totalTimeSec)}
        </p>
        <div className="flex items-center gap-1 justify-end">
          {complete ? (
            <CheckCircle2 className="size-3" style={{ color: "#00C853" }} />
          ) : (
            <AlertTriangle className="size-3" style={{ color: "#FF9500" }} />
          )}
          <span style={{ fontSize: 8, color: complete ? "#00C853" : "#FF9500" }}>
            {session.actionsCompleted}/{session.actionsTotal}
          </span>
          {session.autoEscalated && (
            <span className="px-1 py-0.5 rounded" style={{ fontSize: 6, fontWeight: 800, color: "#FF2D55", background: "rgba(255,45,85,0.1)", marginLeft: 2 }}>
              ESC
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Response Time Heatmap — hour of day × day of week
// ═══════════════════════════════════════════════════════════════

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function generateHeatmapData(): { day: string; hour: number; value: number; count: number }[] {
  // Mock heatmap data — response times by hour/day
  const data: { day: string; hour: number; value: number; count: number }[] = [];
  DAYS.forEach(day => {
    HOURS.forEach(hour => {
      // Simulate patterns: slower at night, faster during work hours
      const isWorkHour = hour >= 7 && hour <= 18;
      const isNight = hour >= 22 || hour <= 5;
      const isWeekend = day === "Sat" || day === "Sun";

      const base = isNight ? 75 : isWorkHour && !isWeekend ? 32 : 50;
      const variance = Math.floor(Math.random() * 25);
      const count = isNight ? Math.floor(Math.random() * 2) : isWorkHour ? 2 + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 2);

      data.push({ day, hour, value: count > 0 ? base + variance : 0, count });
    });
  });
  return data;
}

function getHeatColor(value: number): string {
  if (value === 0) return "rgba(255,255,255,0.015)";
  if (value <= 30) return "rgba(0,200,83,0.6)";   // Elite
  if (value <= 45) return "rgba(0,200,224,0.5)";   // Fast
  if (value <= 60) return "rgba(255,215,0,0.4)";   // Good
  if (value <= 80) return "rgba(255,149,0,0.5)";   // Average
  return "rgba(255,45,85,0.5)";                     // Slow
}

function ResponseHeatmap() {
  const [data] = useState(generateHeatmapData);
  const [exporting, setExporting] = useState(false);

  const exportHeatmapPDF = useCallback(() => {
    setExporting(true);
    try {
      const doc = new jsPDF();
      addPDFHeader(doc, "Response Time Heatmap Report", "Hour-by-day response time analysis for vulnerability identification");

      let y = 52;
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 80);
      doc.text(safe("This heatmap identifies peak slow-response periods to help schedule staffing and training."), 14, y);
      y += 12;

      // Legend
      const legend = [
        { label: "Elite (<30s)", rgb: [0, 200, 83] },
        { label: "Fast (30-45s)", rgb: [0, 200, 224] },
        { label: "Good (45-60s)", rgb: [255, 215, 0] },
        { label: "Average (60-80s)", rgb: [255, 149, 0] },
        { label: "Slow (>80s)", rgb: [255, 45, 85] },
      ];
      legend.forEach((l, i) => {
        doc.setFillColor(l.rgb[0], l.rgb[1], l.rgb[2]);
        doc.rect(14 + i * 38, y, 6, 4, "F");
        doc.setFontSize(6);
        doc.setTextColor(100, 100, 120);
        doc.text(safe(l.label), 22 + i * 38, y + 3);
      });
      y += 12;

      // Build table: Day as row header, hours as columns (grouped by 3h blocks)
      const hourBlocks = [
        { label: "00-02", hours: [0, 1, 2] }, { label: "03-05", hours: [3, 4, 5] },
        { label: "06-08", hours: [6, 7, 8] }, { label: "09-11", hours: [9, 10, 11] },
        { label: "12-14", hours: [12, 13, 14] }, { label: "15-17", hours: [15, 16, 17] },
        { label: "18-20", hours: [18, 19, 20] }, { label: "21-23", hours: [21, 22, 23] },
      ];

      const tableHead = ["Day", ...hourBlocks.map(b => b.label)];
      const tableBody = DAYS.map(day => {
        const row = [day];
        hourBlocks.forEach(block => {
          const cells = block.hours.map(h => data.find(d => d.day === day && d.hour === h));
          const vals = cells.filter(c => c && c.count > 0).map(c => c!.value);
          row.push(vals.length > 0 ? `${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)}s` : "-");
        });
        return row;
      });

      autoTable(doc, {
        startY: y,
        head: [tableHead],
        body: tableBody,
        theme: "grid",
        headStyles: { fillColor: [0, 200, 224], textColor: [5, 7, 14], fontSize: 7, fontStyle: "bold" },
        bodyStyles: { fontSize: 7, textColor: [40, 40, 60] },
        alternateRowStyles: { fillColor: [245, 247, 252] },
        didParseCell: (hookData: any) => {
          if (hookData.section === "body" && hookData.column.index > 0) {
            const val = parseInt(hookData.cell.text?.[0] || "0");
            if (val > 0 && val <= 30) hookData.cell.styles.fillColor = [220, 255, 230];
            else if (val > 30 && val <= 45) hookData.cell.styles.fillColor = [220, 245, 255];
            else if (val > 45 && val <= 60) hookData.cell.styles.fillColor = [255, 250, 220];
            else if (val > 60 && val <= 80) hookData.cell.styles.fillColor = [255, 240, 220];
            else if (val > 80) hookData.cell.styles.fillColor = [255, 225, 230];
          }
        },
        margin: { left: 14, right: 14 },
      });

      // Worst periods summary
      const worstCells = [...data].filter(d => d.count > 0).sort((a, b) => b.value - a.value).slice(0, 5);
      const finalY = (doc as any).lastAutoTable?.finalY || 200;
      let sy = finalY + 12;
      doc.setFontSize(10);
      doc.setTextColor(255, 45, 85);
      doc.text(safe("Top 5 Slowest Response Periods"), 14, sy);
      sy += 8;
      worstCells.forEach((c, i) => {
        doc.setFontSize(8);
        doc.setTextColor(60, 60, 80);
        doc.text(safe(`${i + 1}. ${c.day} ${c.hour.toString().padStart(2, "0")}:00 — avg ${c.value}s (${c.count} sessions)`), 18, sy);
        sy += 6;
      });

      addPDFWatermark(doc);
      doc.save("SOSphere_Response_Heatmap.pdf");
    } catch (err) {
      console.error("Heatmap PDF export error:", err);
    } finally {
      setExporting(false);
    }
  }, [data]);

  return (
    <div className="p-5 rounded-2xl" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Activity className="size-4" style={{ color: "#FF9500" }} />
          <h4 style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>Response Time Heatmap</h4>
        </div>
        <div className="flex items-center gap-3">
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Average seconds by hour × day</p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={exportHeatmapPDF}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{
              background: "rgba(255,149,0,0.08)",
              border: "1px solid rgba(255,149,0,0.2)",
              opacity: exporting ? 0.5 : 1,
            }}
          >
            <Download className="size-3" style={{ color: "#FF9500" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "#FF9500" }}>{exporting ? "Exporting..." : "Export PDF"}</span>
          </motion.button>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: 600 }}>
          {/* Hour labels top */}
          <div className="flex mb-1" style={{ paddingLeft: 36 }}>
            {HOURS.filter(h => h % 3 === 0).map(h => (
              <div key={h} style={{ width: `${(3 / 24) * 100}%`, fontSize: 8, color: "rgba(255,255,255,0.15)", textAlign: "center" }}>
                {h.toString().padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Rows */}
          {DAYS.map(day => (
            <div key={day} className="flex items-center gap-1 mb-0.5">
              <span style={{ width: 30, fontSize: 9, color: "rgba(255,255,255,0.25)", textAlign: "right", paddingRight: 4 }}>{day}</span>
              <div className="flex flex-1 gap-px">
                {HOURS.map(hour => {
                  const cell = data.find(d => d.day === day && d.hour === hour);
                  const val = cell?.value || 0;
                  const cnt = cell?.count || 0;
                  return (
                    <div
                      key={hour}
                      className="flex-1 rounded-sm relative group"
                      style={{
                        height: 18,
                        background: getHeatColor(val),
                        minWidth: 4,
                        transition: "transform 0.15s",
                        cursor: cnt > 0 ? "pointer" : "default",
                      }}
                      title={cnt > 0 ? `${day} ${hour}:00 — avg ${val}s (${cnt} sessions)` : `${day} ${hour}:00 — no data`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 justify-center">
        {[
          { label: "Elite <30s", color: "rgba(0,200,83,0.6)" },
          { label: "Fast 30-45s", color: "rgba(0,200,224,0.5)" },
          { label: "Good 45-60s", color: "rgba(255,215,0,0.4)" },
          { label: "Avg 60-80s", color: "rgba(255,149,0,0.5)" },
          { label: "Slow >80s", color: "rgba(255,45,85,0.5)" },
          { label: "No data", color: "rgba(255,255,255,0.015)" },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-sm" style={{ background: l.color, border: "1px solid rgba(255,255,255,0.06)" }} />
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Admin Comparison Panel — side-by-side multi-admin comparison
// ═══════════════════════════════════════════════════════════════

const TIER_ICONS: Record<string, string> = {
  PLATINUM: "crown", GOLD: "star", SILVER: "medal", BRONZE: "shield", ROOKIE: "zap",
};

function AdminComparisonPanel() {
  const [selectedAdmins, setSelectedAdmins] = useState<number[]>([0, 1]);
  const [exporting, setExporting] = useState(false);

  const toggle = (idx: number) => {
    setSelectedAdmins(prev => {
      if (prev.includes(idx)) return prev.filter(i => i !== idx);
      if (prev.length >= 4) return prev;
      return [...prev, idx];
    });
  };

  const selected = selectedAdmins.map(i => COMPARISON_ADMINS[i]).filter(Boolean);
  const maxTime = Math.max(...selected.map(a => a.avgTime), 1);
  const maxSessions = Math.max(...selected.map(a => a.sessions), 1);

  const exportComparisonPDF = useCallback(() => {
    if (selected.length < 2) return;
    setExporting(true);
    try {
      const doc = new jsPDF();
      addPDFHeader(doc, "Admin Performance Comparison Report", `Comparing ${selected.length} admins — side-by-side analysis`);

      let y = 52;

      // Summary cards
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 60);
      doc.text(safe("Selected Admins"), 14, y);
      y += 8;

      selected.forEach((admin, i) => {
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 80);
        doc.text(safe(`${i + 1}. ${admin.name} — ${admin.role} — Tier: ${admin.tier} — Rating: ${admin.rating}`), 18, y);
        y += 6;
      });
      y += 6;

      // Comparison table
      const metrics = [
        { label: "Avg Response Time", key: "avgTime" as const, fmt: (v: number) => `${v}s`, lower: true },
        { label: "Total Sessions", key: "sessions" as const, fmt: (v: number) => `${v}`, lower: false },
        { label: "Completion Rate", key: "completion" as const, fmt: (v: number) => `${v}%`, lower: false },
        { label: "Best Streak", key: "streak" as const, fmt: (v: number) => `${v}`, lower: false },
        { label: "Avg Score", key: "avgScore" as const, fmt: (v: number) => `${v}`, lower: false },
        { label: "Trend", key: "trend" as const, fmt: (v: any) => String(v), lower: false },
      ];

      const tableHead = ["Metric", ...selected.map(a => a.name.split(" ")[0])];
      const tableBody = metrics.map(m => {
        const vals = selected.map(a => (a as any)[m.key]);
        const numVals = vals.filter(v => typeof v === "number") as number[];
        const bestVal = m.lower ? Math.min(...numVals) : Math.max(...numVals);
        return [m.label, ...selected.map(a => {
          const val = (a as any)[m.key];
          const isBest = typeof val === "number" && val === bestVal;
          return `${m.fmt(val)}${isBest ? " ★" : ""}`;
        })];
      });

      autoTable(doc, {
        startY: y,
        head: [tableHead],
        body: tableBody,
        theme: "striped",
        headStyles: { fillColor: [139, 92, 246], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
        bodyStyles: { fontSize: 8, textColor: [40, 40, 60] },
        alternateRowStyles: { fillColor: [245, 242, 255] },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
        margin: { left: 14, right: 14 },
      });

      // Winner summary
      const finalY = (doc as any).lastAutoTable?.finalY || 200;
      let sy = finalY + 12;
      doc.setFontSize(11);
      doc.setTextColor(0, 200, 224);
      doc.text(safe("Performance Verdict"), 14, sy);
      sy += 8;

      const fastest = [...selected].sort((a, b) => a.avgTime - b.avgTime)[0];
      const mostExp = [...selected].sort((a, b) => b.sessions - a.sessions)[0];
      const highestScore = [...selected].sort((a, b) => b.avgScore - a.avgScore)[0];

      const verdicts = [
        `Fastest Responder: ${fastest.name} (${fastest.avgTime}s avg)`,
        `Most Experienced: ${mostExp.name} (${mostExp.sessions} sessions)`,
        `Highest Score: ${highestScore.name} (${highestScore.avgScore} avg score)`,
      ];
      verdicts.forEach(v => {
        doc.setFontSize(8);
        doc.setTextColor(60, 60, 80);
        doc.text(safe(v), 18, sy);
        sy += 6;
      });

      addPDFWatermark(doc);
      doc.save("SOSphere_Admin_Comparison.pdf");
    } catch (err) {
      console.error("Comparison PDF export error:", err);
    } finally {
      setExporting(false);
    }
  }, [selected]);

  return (
    <div className="p-5 rounded-2xl" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Users className="size-4" style={{ color: "#8B5CF6" }} />
          <h4 style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>Admin Comparison</h4>
          <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 7, fontWeight: 800, color: "#8B5CF6", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.15)" }}>
            LIVE from Leaderboard
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Select up to 4 admins</span>
          {selected.length >= 2 && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={exportComparisonPDF}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
              style={{
                background: "rgba(139,92,246,0.08)",
                border: "1px solid rgba(139,92,246,0.2)",
                opacity: exporting ? 0.5 : 1,
              }}
            >
              <FileText className="size-3" style={{ color: "#8B5CF6" }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: "#8B5CF6" }}>{exporting ? "Exporting..." : "Export PDF"}</span>
            </motion.button>
          )}
        </div>
      </div>

      {/* Admin Selector */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {COMPARISON_ADMINS.map((admin, i) => {
          const isSelected = selectedAdmins.includes(i);
          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
              style={{
                background: isSelected ? `${admin.color}12` : "rgba(255,255,255,0.02)",
                border: `1px solid ${isSelected ? `${admin.color}30` : "rgba(255,255,255,0.05)"}`,
              }}
            >
              <div className="size-6 rounded-full flex items-center justify-center" style={{
                background: isSelected ? `${admin.color}20` : "rgba(255,255,255,0.04)",
              }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: isSelected ? admin.color : "rgba(255,255,255,0.25)" }}>
                  {admin.avatar}
                </span>
              </div>
              <div className="text-left">
                <p style={{ fontSize: 10, fontWeight: 700, color: isSelected ? admin.color : "rgba(255,255,255,0.3)" }}>
                  {admin.name.split(" ")[0]}
                </p>
                <div className="flex items-center gap-1">
                  <p style={{ fontSize: 7, color: "rgba(255,255,255,0.15)" }}>{admin.role}</p>
                  <span style={{ fontSize: 7, color: admin.color, fontWeight: 800 }}>{admin.tier}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Comparison Cards */}
      {selected.length >= 2 ? (
        <div className="space-y-4">
          {/* Header row */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${selected.length}, 1fr)` }}>
            {selected.map((admin, i) => (
              <div key={i} className="p-3 rounded-xl text-center" style={{
                background: `${admin.color}06`,
                border: `1px solid ${admin.color}15`,
              }}>
                <div className="flex items-center justify-center gap-1 mb-1">
                  <span style={{ fontSize: 11, fontWeight: 800, color: admin.color }}>{admin.name.split(" ")[0]}</span>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className="px-2 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 800, color: admin.color, background: `${admin.color}10` }}>
                    {admin.rating}
                  </span>
                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>Score: {admin.avgScore}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Metric rows */}
          {[
            { label: "AVG RESPONSE TIME", key: "avgTime" as const, fmt: (v: number) => `${v}s`, lower: true },
            { label: "TOTAL SESSIONS", key: "sessions" as const, fmt: (v: number) => `${v}`, lower: false },
            { label: "COMPLETION RATE", key: "completion" as const, fmt: (v: number) => `${v}%`, lower: false },
            { label: "BEST STREAK", key: "streak" as const, fmt: (v: number) => `${v}`, lower: false },
          ].map(metric => {
            const vals = selected.map(a => a[metric.key]);
            const bestVal = metric.lower ? Math.min(...vals) : Math.max(...vals);
            return (
              <div key={metric.label}>
                <p style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", marginBottom: 6 }}>
                  {metric.label}
                </p>
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${selected.length}, 1fr)` }}>
                  {selected.map((admin, i) => {
                    const val = admin[metric.key];
                    const isBest = val === bestVal;
                    const barMax = metric.key === "avgTime" ? maxTime : metric.key === "sessions" ? maxSessions : 100;
                    const barPct = metric.key === "avgTime"
                      ? ((maxTime - val) / maxTime) * 100 // inverse for time
                      : (val / barMax) * 100;
                    return (
                      <div key={i} className="p-2.5 rounded-lg" style={{
                        background: isBest ? `${admin.color}06` : "rgba(255,255,255,0.01)",
                        border: `1px solid ${isBest ? `${admin.color}15` : "rgba(255,255,255,0.03)"}`,
                      }}>
                        <div className="flex items-center justify-between mb-2">
                          <span style={{ fontSize: 16, fontWeight: 900, color: isBest ? admin.color : "rgba(255,255,255,0.4)" }}>
                            {metric.fmt(val)}
                          </span>
                          {isBest && (
                            <Crown className="size-3" style={{ color: "#FFD700" }} />
                          )}
                        </div>
                        <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
                          <motion.div
                            className="h-full rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max(barPct, 5)}%` }}
                            transition={{ duration: 0.8, delay: i * 0.1 }}
                            style={{ background: admin.color, opacity: isBest ? 0.8 : 0.3 }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8">
          <Users className="size-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.06)" }} />
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)" }}>Select at least 2 admins to compare</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════

export function RRPAnalyticsPage({ t, webMode }: { t: (k: string) => string; webMode?: boolean }) {
  const [analytics, setAnalytics] = useState<RRPAnalytics | null>(null);

  useEffect(() => {
    seedMockRRPData(); // ensure demo data exists
    setAnalytics(getRRPAnalytics());
  }, []);

  if (!analytics) return null;

  const fmtTime = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // Chart data
  const typeData = Object.entries(analytics.sessionsByType).map(([key, value]) => ({
    name: SOS_TYPE_LABELS[key]?.label || key,
    value,
    color: SOS_TYPE_LABELS[key]?.color || "#00C8E0",
  }));

  const sevData = Object.entries(analytics.sessionsBySeverity).map(([key, value]) => ({
    name: key.charAt(0).toUpperCase() + key.slice(1),
    value,
    color: SEVERITY_COLORS[key] || "#00C8E0",
  }));

  const TrendIcon = analytics.speedTrend === "improving" ? TrendingUp
    : analytics.speedTrend === "declining" ? TrendingDown
    : Minus;
  const trendColor = analytics.speedTrend === "improving" ? "#00C853"
    : analytics.speedTrend === "declining" ? "#FF2D55"
    : "#FF9500";

  return (
    <div className="space-y-6">
      {/* Hero Card */}
      <div className="relative rounded-2xl overflow-hidden" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at 30% 20%, ${analytics.speedRatingColor}06, transparent 60%)` }} />
        <div className="relative p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="size-12 rounded-xl flex items-center justify-center"
                  style={{ background: `${analytics.speedRatingColor}15`, border: `1.5px solid ${analytics.speedRatingColor}30` }}>
                  <Zap className="size-6" style={{ color: analytics.speedRatingColor }} fill={analytics.speedRatingColor} />
                </div>
                <div>
                  <h3 style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>Response Analytics</h3>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                    Emergency response performance tracking
                  </p>
                </div>
              </div>
            </div>

            {/* Speed Rating Badge */}
            <div className="px-4 py-3 rounded-2xl text-center" style={{
              background: `${analytics.speedRatingColor}08`,
              border: `1.5px solid ${analytics.speedRatingColor}20`,
              boxShadow: `0 0 30px ${analytics.speedRatingColor}08`,
            }}>
              <p style={{ fontSize: 24, fontWeight: 900, color: analytics.speedRatingColor }}>
                {analytics.speedRating}
              </p>
              <p style={{ fontSize: 8, color: `${analytics.speedRatingColor}60`, letterSpacing: "0.5px" }}>SPEED RATING</p>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="AVG RESPONSE" value={fmtTime(analytics.avgResponseTime)} sub={`Fastest: ${fmtTime(analytics.fastestResponse)}`} color="#00C8E0" icon={Timer} />
            <StatCard label="TOTAL SESSIONS" value={analytics.totalSessions.toString()} sub={`${analytics.completionRate}% completion rate`} color="#FF2D55" icon={Zap} />
            <StatCard label="CURRENT STREAK" value={analytics.currentStreak.toString()} sub={`Best: ${analytics.bestStreak}`} color="#FFD700" icon={Flame} />
            <StatCard label="AVG PER ACTION" value={`${analytics.avgPerAction}s`} sub={`${analytics.avgActionsCompleted} actions avg`} color="#00C853" icon={Target} />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Timeline Chart */}
        <div className="p-5 rounded-2xl" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="size-4" style={{ color: "#00C8E0" }} />
              <h4 style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>Response Time Trend</h4>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: `${trendColor}08` }}>
              <TrendIcon className="size-3" style={{ color: trendColor }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: trendColor }}>{analytics.speedTrend.toUpperCase()}</span>
            </div>
          </div>
          {analytics.timelineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={analytics.timelineData}>
                <defs>
                  <linearGradient id="rrpAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00C8E0" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#00C8E0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.15)", fontSize: 8 }} axisLine={false} tickLine={false}
                  tickFormatter={v => new Date(v).toLocaleDateString("en", { month: "short", day: "numeric" })} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.12)", fontSize: 8 }} axisLine={false} tickLine={false} width={30}
                  tickFormatter={v => `${v}s`} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="avgTime" name="Avg Time" stroke="#00C8E0" strokeWidth={2} fill="url(#rrpAreaGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px]">
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.15)" }}>No timeline data yet</p>
            </div>
          )}
        </div>

        {/* Emergency Type Breakdown */}
        <div className="p-5 rounded-2xl" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-2 mb-4">
            <ChartBar className="size-4" style={{ color: "#FF2D55" }} />
            <h4 style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>By Emergency Type</h4>
          </div>
          {typeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={typeData} layout="vertical" barSize={14}>
                <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.12)", fontSize: 8 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} width={90} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" name="Sessions" radius={[0, 6, 6, 0]}>
                  {typeData.map((entry, i) => <Cell key={i} fill={entry.color} fillOpacity={0.7} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px]">
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.15)" }}>No data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl" style={{ background: "rgba(10,18,32,0.4)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <p style={{ fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>AUTO-ESCALATION RATE</p>
          <p style={{ fontSize: 20, fontWeight: 900, color: analytics.autoEscalationRate < 10 ? "#00C853" : "#FF9500" }}>
            {analytics.autoEscalationRate}%
          </p>
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
            {analytics.autoEscalationRate < 10 ? "Excellent — admin always acts first" : "Consider faster initial response"}
          </p>
        </div>
        <div className="p-4 rounded-2xl" style={{ background: "rgba(10,18,32,0.4)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <p style={{ fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>IRE UPGRADE RATE</p>
          <p style={{ fontSize: 20, fontWeight: 900, color: "#8B5CF6" }}>{analytics.ireUpgradeRate}%</p>
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Sessions upgraded to full IRE guide</p>
        </div>
        <div className="p-4 rounded-2xl" style={{ background: "rgba(10,18,32,0.4)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <p style={{ fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>SLOWEST RESPONSE</p>
          <p style={{ fontSize: 20, fontWeight: 900, color: "#FF2D55" }}>{fmtTime(analytics.slowestResponse)}</p>
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Worst session time recorded</p>
        </div>
        <div className="p-4 rounded-2xl" style={{ background: "rgba(10,18,32,0.4)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <p style={{ fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>COMPLETION RATE</p>
          <p style={{ fontSize: 20, fontWeight: 900, color: analytics.completionRate >= 90 ? "#00C853" : "#FF9500" }}>
            {analytics.completionRate}%
          </p>
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Actions completed per session</p>
        </div>
      </div>

      {/* Severity Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl md:col-span-1" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-2 mb-4">
            <Shield className="size-4" style={{ color: "#FF9500" }} />
            <h4 style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>By Severity</h4>
          </div>
          <div className="space-y-3">
            {sevData.map(s => {
              const maxVal = Math.max(...sevData.map(d => d.value), 1);
              return (
                <div key={s.name}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="size-2 rounded-full" style={{ background: s.color }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{s.name}</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 800, color: s.color }}>{s.value}</span>
                  </div>
                  <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <motion.div className="h-full rounded-full" animate={{ width: `${(s.value / maxVal) * 100}%` }}
                      style={{ background: s.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Insights */}
        <div className="p-5 rounded-2xl md:col-span-2" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-2 mb-4">
            <Brain className="size-4" style={{ color: "#8B5CF6" }} />
            <h4 style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>AI Insights</h4>
          </div>
          <div className="space-y-3">
            {[
              analytics.avgResponseTime <= 30
                ? { text: "Your average response time is in the ELITE range. You consistently act within 30 seconds of protocol activation.", color: "#00C853", icon: Star }
                : analytics.avgResponseTime <= 60
                ? { text: `Average response time is ${analytics.avgResponseTime}s. Push for under 30s to reach ELITE rating.`, color: "#00C8E0", icon: Target }
                : { text: `Response time averaging ${analytics.avgResponseTime}s. Critical emergencies need sub-60s response. Practice with Training Center drills.`, color: "#FF9500", icon: AlertTriangle },
              analytics.autoEscalationRate > 15
                ? { text: `Auto-escalation triggered in ${analytics.autoEscalationRate}% of sessions. Consider faster first-action engagement.`, color: "#FF9500", icon: AlertTriangle }
                : { text: `Only ${analytics.autoEscalationRate}% auto-escalation rate — you consistently act before the system needs to escalate.`, color: "#00C853", icon: CheckCircle2 },
              analytics.currentStreak >= 5
                ? { text: `Active streak of ${analytics.currentStreak} fast responses! Your best is ${analytics.bestStreak}. Keep the momentum.`, color: "#FFD700", icon: Flame }
                : analytics.bestStreak > 0
                ? { text: `Best streak was ${analytics.bestStreak} consecutive fast responses. Current: ${analytics.currentStreak}. Build it back up!`, color: "#00C8E0", icon: TrendingUp }
                : { text: "Complete more RRP sessions under 60s to start building a streak.", color: "#FF9500", icon: Target },
              analytics.speedTrend === "improving"
                ? { text: "Your response speed is improving over recent sessions. The training is paying off.", color: "#00C853", icon: TrendingUp }
                : analytics.speedTrend === "declining"
                ? { text: "Response times are trending slower recently. Consider a refresher drill session.", color: "#FF2D55", icon: TrendingDown }
                : { text: "Response times are stable. Try Multiplayer Drill mode to push your limits.", color: "#00C8E0", icon: Activity },
            ].map((insight, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl"
                style={{ background: `${insight.color}04`, border: `1px solid ${insight.color}08` }}>
                <insight.icon className="size-4 flex-shrink-0 mt-0.5" style={{ color: insight.color }} />
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>{insight.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Response Time Heatmap — hour × day ═══ */}
      <ResponseHeatmap />

      {/* ═══ Admin Comparison Mode ═══ */}
      <AdminComparisonPanel />

      {/* Recent Sessions */}
      <div className="p-5 rounded-2xl" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="size-4" style={{ color: "#00C8E0" }} />
            <h4 style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>Recent Sessions</h4>
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
            Last {analytics.recentSessions.length} sessions
          </span>
        </div>
        <div className="space-y-2">
          {analytics.recentSessions.length > 0 ? (
            analytics.recentSessions.slice(0, 10).map(session => (
              <SessionRow key={session.id} session={session} />
            ))
          ) : (
            <div className="text-center py-12">
              <Zap className="size-12 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.06)" }} />
              <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.2)" }}>No RRP sessions yet</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.1)", marginTop: 4 }}>
                Activate Rapid Response during an emergency to start tracking
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}