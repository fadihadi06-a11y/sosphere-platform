// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Page Components
// Extracted from company-dashboard.tsx to keep files under Babel's 500KB threshold
// ═══════════════════════════════════════════════════════════════
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, Bell, Users, MapPin, AlertTriangle, Clock,
  ChevronRight, CheckCircle2, XCircle, Radio,
  Phone, User, Plus,
  Activity, AlertCircle,
  ChevronDown, Siren,
  HeartPulse, Navigation, Send,
  Check, ChevronLeft,
  ShieldCheck, Hash,
  MessageSquare,
  Megaphone, Zap, X,
  UserCheck, Search, ArrowUpRight,
  LayoutDashboard, BarChart3, CalendarDays, Download, FileText as FileTextIcon,
  Camera, Layers, ArrowRight,
} from "lucide-react";
import {
  Card as DSCard, SectionHeader, Badge,
  Button as DSButton, AlertItem, Divider, TOKENS, SEVERITY,
} from "./design-system";
import { sortByPriority, getEmergencyStats } from "./priority-engine";
import type { DashPage, Employee, EmergencyItem, ZoneData } from "./dashboard-types";
import { useDashboardStore } from "./stores/dashboard-store";
import { getAttendanceRecords, getActivityLog, getAllEmployeeStatuses, triggerEvacuation, getActiveEvacuation, type AttendanceRecord, type AppActivity, type EmployeeStatusData, type ActiveEvacuation } from "./shared-store";
import { CallTrigger } from "./call-panel";
import { toast } from "sonner";
// FIX J: Risk Scoring Engine
import { calculateRiskScore, getRiskColor, getRiskLabel, type EmployeeRiskScore } from "./risk-scoring-engine";
import { getEvidencePipelineStatus } from "./evidence-store";
import { hapticLight } from "./haptic-feedback";
import { buildReportData, generateEmergencyLifecyclePDF } from "./emergency-lifecycle-report";
import {
  detectClusters, type ZoneCluster,
  CLUSTER_LEVEL_CONFIG,
  activateClusterSAR,
} from "./zone-cluster-engine";
import { Lock, ClipboardList, Skull, Radar } from "lucide-react";

// ── FIX 3: Emergency Watchdog (Auto-escalation after 5min unattended) ──
import { EmergencyWatchdog } from "./emergency-watchdog";

// ── Shared constants ───────────────────────────────────────────
export const SLA_THRESHOLD = 120;
export const fmtElapsed = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
export const timerColor = (s: number) =>
  s < 30 ? "#00C853" : s < SLA_THRESHOLD ? "#FF9500" : "#FF2D55";

// ── Shared configs ─────────────────────────────────────────────
export const SEVERITY_CONFIG = {
  critical: { ...SEVERITY.critical, icon: Siren,         tKey: "sev.critical" },
  high:     { ...SEVERITY.high,     icon: AlertTriangle,  tKey: "sev.high"     },
  medium:   { ...SEVERITY.medium,   icon: AlertCircle,    tKey: "sev.medium"   },
  low:      { ...SEVERITY.low,      icon: Activity,       tKey: "sev.low"      },
};

export const STATUS_CONFIG = {
  "on-shift":    { label: "On Shift",     color: "#00C853",              dot: true,  tKey: "status.onShift"   },
  "off-shift":   { label: "Off Shift",    color: "rgba(255,255,255,0.2)", dot: false, tKey: "status.offShift"  },
  "sos":         { label: "SOS ACTIVE",   color: "#FF2D55",              dot: true,  tKey: "status.sosActive" },
  "late-checkin":{ label: "Late Check-in",color: "#FF9500",              dot: true,  tKey: "status.lateCheckin"},
  "checked-in":  { label: "Checked In",   color: "#00C8E0",              dot: true,  tKey: "status.checkedIn" },
};

// ── Dynamic System Health (uses real employee status data) ────
function getSystemHealth(employeeStatuses: EmployeeStatusData[], t: (key: string) => string) {
  const totalEmployees = employeeStatuses.length;
  const trackingEnabled = employeeStatuses.filter(s => s.gpsEnabled || s.autoGpsEnabled).length;
  const gpsUptimePercent = totalEmployees > 0 ? ((trackingEnabled / totalEmployees) * 100).toFixed(1) : "100.0";

  // Check battery levels
  const lowBattery = employeeStatuses.filter(s => (s.batteryLevel || 100) < 20).length;
  const avgBattery = totalEmployees > 0
    ? (employeeStatuses.reduce((sum, s) => sum + (s.batteryLevel || 100), 0) / totalEmployees).toFixed(1)
    : "100.0";

  // Check signal strength
  const poorSignal = employeeStatuses.filter(s => s.signalStrength === "poor" || s.signalStrength === "none").length;

  return [
    {
      name: t("dc.gpsTracking"),
      status: (trackingEnabled / totalEmployees) > 0.95 ? "operational" as const : "degraded" as const,
      uptime: `${gpsUptimePercent}%`,
      detail: `${trackingEnabled}/${totalEmployees} active`
    },
    {
      name: t("dc.alertEngine"),
      status: "operational" as const,
      uptime: "100%",
      detail: t("dc.allNominal")
    },
    {
      name: t("dc.batteryHealth"),
      status: lowBattery > 3 ? "degraded" as const : "operational" as const,
      uptime: `${avgBattery}%`,
      detail: lowBattery > 0 ? `${lowBattery} devices low` : t("dc.allHealthy")
    },
    {
      name: t("dc.signalStrength"),
      status: poorSignal > 5 ? "degraded" as const : "operational" as const,
      uptime: poorSignal === 0 ? "100%" : `${((totalEmployees - poorSignal) / totalEmployees * 100).toFixed(1)}%`,
      detail: poorSignal > 0 ? `${poorSignal} weak signals` : t("dc.allStrong")
    },
  ];
}

// ── Live Activity (dynamic from shared-store) ─────────────────
function getLiveActivity(): Array<{ time: string; text: string; color: string; icon: any; unread: boolean }> {
  const activities = getActivityLog();
  const iconMap: Record<string, any> = {
    AlertTriangle, Clock, CheckCircle2, Shield, Radio, MapPin
  };
  
  return activities.slice(0, 6).map((act: AppActivity) => {
    const elapsed = Date.now() - act.timestamp;
    const minutes = Math.floor(elapsed / 60000);
    const timeStr = minutes === 0 ? "Just now" : minutes === 1 ? "1m ago" : `${minutes}m ago`;
    
    const severityColors: Record<string, string> = {
      critical: "#FF2D55",
      high: "#FF9500",
      medium: "#FFD60A",
      low: "#00C8E0"
    };
    
    return {
      time: timeStr,
      text: act.action + (act.zone ? ` — ${act.zone}` : ""),
      color: act.severity ? severityColors[act.severity] : "#00C8E0",
      icon: iconMap[act.icon] || Activity,
      unread: elapsed < 120000 // unread if less than 2 minutes old
    };
  });
}

/*
  SUPABASE_MIGRATION_POINT: on_duty_responders
  Replace with:
  const { data } = await supabase
    .from('responders')
    .select('*')
    .eq('company_id', companyId)
    .eq('on_duty', true)
*/
const MOCK_ON_DUTY = [
  { name: "Ahmad R.",   role: "Supervisor", zone: "Zone A", status: "available"  as const },
  { name: "Fatima H.",  role: "Responder",  zone: "Zone B", status: "responding" as const },
  { name: "Sara A.",    role: "Medic",      zone: "Zone C", status: "available"  as const },
  { name: "Khalid M.", role: "Security",   zone: "Zone A", status: "available"  as const },
];

/*
  SUPABASE_MIGRATION_POINT: emergency_timeline
  Replace with:
  const { data } = await supabase
    .from('emergency_events')
    .select('*')
    .eq('emergency_id', emergencyId)
    .order('created_at', { ascending: true })
*/
const MOCK_TIMELINE = [
  { time: "14:23:05", event: "SOS triggered by employee"         },
  { time: "14:23:08", event: "Alert dispatched to operations"    },
  { time: "14:23:12", event: "GPS location acquired"             },
  { time: "14:23:45", event: "Zone flagged as active incident"   },
];

/*
  SUPABASE_MIGRATION_POINT: system_health
  Replace with:
  const { data } = await supabase
    .from('system_health')
    .select('*')
    .eq('company_id', companyId)
*/
// ── Mock System Health (mobile OverviewPage health panel) ─────────
const MOCK_SYSTEM_HEALTH: Array<{ name: string; status: "operational" | "degraded"; uptime: string }> = [
  { name: "GPS Tracking",    status: "operational", uptime: "99.9%" },
  { name: "Alert Engine",    status: "operational", uptime: "100%"  },
  { name: "Battery Health",  status: "operational", uptime: "96.2%" },
  { name: "Signal Strength", status: "degraded",    uptime: "88.5%" },
];



type KpiFilter = "active" | "onDuty" | "slaBreach" | "health" | null;

// ═══════════════════════════════════════════════════════════════
// Evidence Intelligence Banner — Overview Page
// ═══════════════════════════════════════════════════════════════
function EvidenceIntelBanner({ onNavigate, t }: { onNavigate: (page: DashPage) => void; t: (key: string) => string }) {
  const pipeline = getEvidencePipelineStatus();
  if (pipeline.totalEvidence === 0) return null;

  const hasPending = pipeline.pendingReview > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35, type: "spring", stiffness: 200 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: hasPending
          ? "linear-gradient(135deg, rgba(123,94,255,0.08), rgba(255,45,85,0.04))"
          : "linear-gradient(135deg, rgba(123,94,255,0.06), rgba(0,200,224,0.03))",
        border: `1px solid ${hasPending ? "rgba(123,94,255,0.15)" : "rgba(123,94,255,0.1)"}`,
      }}>
      <div className="flex items-center gap-4 px-5 py-3.5">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(123,94,255,0.12)", border: "1px solid rgba(123,94,255,0.2)" }}>
            <Layers className="size-5" style={{ color: "#7B5EFF" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 13, fontWeight: 800, color: "#7B5EFF", letterSpacing: "-0.02em" }}>
                {t("dc.evidenceIntel")}
              </span>
              {hasPending && (
                <motion.span
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="px-2 py-0.5 rounded-full"
                  style={{ fontSize: 9, fontWeight: 800, background: "#FF2D55", color: "#fff" }}>
                  {pipeline.pendingReview} PENDING
                </motion.span>
              )}
            </div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
              {pipeline.totalEvidence} evidence entries · {pipeline.inRCA} in investigation · {pipeline.linkedToRisk} linked to risk
            </p>
          </div>
        </div>

        {/* Quick Stats Pills */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
            style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.1)" }}>
            <Camera className="size-3" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>
              {pipeline.totalEvidence} Photos
            </span>
          </div>
          {pipeline.suggestions.length > 0 && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                const sug = pipeline.suggestions[0];
                // FIX 4: Navigate to Emergency Hub → Reports tab (Evidence Vault), not root
                const { setHubTab } = useDashboardStore.getState();
                if (sug.navigateTo === "emergencyHub") {
                  setHubTab("emergencyHub", "reports");
                }
                onNavigate(sug.navigateTo as DashPage);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
              style={{ background: "rgba(123,94,255,0.1)", border: "1px solid rgba(123,94,255,0.2)" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#7B5EFF" }}>
                {pipeline.suggestions[0].actionLabel}
              </span>
              <ArrowRight className="size-3" style={{ color: "#7B5EFF" }} />
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Web Overview Layout — Apple SaaS Desktop Layout
// ════════════════════════════════��══════════════════════════════
export function WebOverviewLayout({ employees, zones, onNavigate, onResolve, onTakeOwnership, t, onShift, lateCheckins, safetyScore, slaBreachCount, sorted }: {
  employees: Employee[];
  zones: ZoneData[];
  onNavigate: (page: DashPage) => void;
  onResolve: (id: string) => void;
  onTakeOwnership: (id: string) => void;
  t: (k: string) => string;
  onShift: number;
  lateCheckins: number;
  safetyScore: number;
  slaBreachCount: number;
  sorted: EmergencyItem[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignModalEmgId, setAssignModalEmgId] = useState<string | null>(null);
  const activeCount = sorted.length;

  // Get dynamic data
  const employeeStatuses = getAllEmployeeStatuses();
  const liveActivity = getLiveActivity();
  const systemHealth = getSystemHealth(employeeStatuses, t);

  const KPI_CARDS = [
    { label: t("dc.activeEmergencies"), value: activeCount.toString(), sub: activeCount > 0 ? "Requires attention" : t("dc.allClear"), color: activeCount > 0 ? "#FF2D55" : "#00C853", icon: AlertTriangle, pulse: activeCount > 0, page: "emergencyHub" as DashPage },
    { label: t("dc.employeesOnDuty"),  value: onShift.toString(),     sub: `${lateCheckins} ${t("dc.lateCheckIn")}`,                    color: "#00C8E0",  icon: Users,         pulse: false,          page: "employees"  as DashPage },
    { label: t("dc.safetyScore"),       value: `${safetyScore}%`,      sub: "+3.2% from last week",                             color: "#00C853",  icon: ShieldCheck,   pulse: false,          page: "workforce"  as DashPage },
    { label: t("dc.slaCompliance"),     value: slaBreachCount > 0 ? `${slaBreachCount}` : "100%", sub: slaBreachCount > 0 ? `${slaBreachCount} SLA breach${slaBreachCount > 1 ? "es" : ""}` : `${SLA_THRESHOLD / 60}m response threshold`, color: slaBreachCount > 0 ? "#FF9500" : "#00C853", icon: Clock, pulse: false, page: "emergencyHub" as DashPage },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* KPI CARDS ROW */}
      <div className="grid grid-cols-4 gap-4">
        {KPI_CARDS.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <motion.button
              key={kpi.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, type: "spring", stiffness: 300, damping: 25 }}
              whileHover={{ y: -3, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onNavigate(kpi.page)}
              className="text-left p-5 rounded-2xl relative overflow-hidden group"
              style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 100%)",
                border: "1px solid rgba(255,255,255,0.06)",
                backdropFilter: "blur(24px)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              {/* Hover gradient */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl"
                style={{ background: `radial-gradient(ellipse at 20% 20%, ${kpi.color}0A 0%, transparent 60%)` }} />
              {/* Subtle accent line at top */}
              <div className="absolute top-0 left-4 right-4 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: `linear-gradient(90deg, transparent, ${kpi.color}30, transparent)` }} />
              <div className="flex items-start justify-between mb-5 relative z-10">
                <div className="size-11 rounded-[13px] flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${kpi.color}18 0%, ${kpi.color}08 100%)`,
                    border: `1px solid ${kpi.color}15`,
                    boxShadow: `0 4px 12px ${kpi.color}08`,
                  }}>
                  <Icon className="size-5" style={{ color: kpi.color, strokeWidth: 1.8 }} />
                </div>
                {kpi.pulse && (
                  <motion.div animate={{ scale: [1, 1.5, 1], opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                    className="size-2.5 rounded-full mt-1.5" style={{ background: kpi.color, boxShadow: `0 0 10px ${kpi.color}` }} />
                )}
              </div>
              <p className="relative z-10 truncate" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", color: kpi.color, lineHeight: 1, fontVariantNumeric: "tabular-nums", maxWidth: "100%" }}>{kpi.value}</p>
              <p className="mt-2 relative z-10" style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.75)", letterSpacing: "-0.01em" }}>{kpi.label}</p>
              <p className="mt-1 relative z-10" style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", letterSpacing: "-0.005em" }}>{kpi.sub}</p>
            </motion.button>
          );
        })}
      </div>

      {/* EVIDENCE INTELLIGENCE BANNER */}
      <EvidenceIntelBanner onNavigate={onNavigate} t={t} />

      {/* MAIN CONTENT: 2-column */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 380px" }}>
        {/* LEFT — Emergency Feed + Recent Employees */}
        <div className="space-y-4">
          {/* Emergency Incidents */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
            className="rounded-2xl overflow-hidden"
            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-[11px] flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(255,45,85,0.15), rgba(255,45,85,0.06))", border: "1px solid rgba(255,45,85,0.15)" }}>
                  <Siren className="size-4" style={{ color: "#FF2D55", strokeWidth: 1.8 }} />
                </div>
                <div>
                  <p className="text-white" style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("dc.activeEmergencies")}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", letterSpacing: "-0.005em" }}>{t("dc.priorityEngine")}</p>
                </div>
                {activeCount > 0 && (
                  <motion.span animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }}
                    className="px-2.5 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #FF2D55, #FF1744)", boxShadow: "0 2px 10px rgba(255,45,85,0.35)", letterSpacing: "0.04em" }}>
                    {activeCount} LIVE
                  </motion.span>
                )}
              </div>
              <button onClick={() => onNavigate("emergencyHub")} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all"
                style={{ fontSize: 12, color: "#00C8E0", fontWeight: 600, background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)", letterSpacing: "-0.005em" }}>
                View All <ChevronRight className="size-3.5" />
              </button>
            </div>

            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="size-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)" }}>
                  <ShieldCheck className="size-7" style={{ color: "#00C853" }} />
                </div>
                <p style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>{t("dc.allClear")}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>{t("dc.noActiveEmergencies")}</p>
              </div>
            ) : (
              <div>
                {sorted.map((emg, i) => {
                  const cfg = SEVERITY_CONFIG[emg.severity];
                  const Icon = cfg.icon;
                  const isExpanded = expandedId === emg.id;
                  return (
                    <div key={emg.id}>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : emg.id)}
                        className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors group"
                        style={{ borderBottom: i < sorted.length - 1 || isExpanded ? "1px solid rgba(255,255,255,0.04)" : "none", background: isExpanded ? `${cfg.color}05` : "transparent" }}
                      >
                        <div className="relative">
                          <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: cfg.bg, border: `1px solid ${cfg.color}25` }}>
                            <Icon className="size-5" style={{ color: cfg.color }} />
                          </div>
                          {emg.status === "active" && (
                            <motion.div animate={{ scale: [1, 1.6, 1], opacity: [0.8, 0, 0.8] }} transition={{ duration: 1.5, repeat: Infinity }}
                              className="absolute -top-0.5 -right-0.5 size-3 rounded-full" style={{ background: cfg.color }} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{emg.type}</span>
                            <span className="px-2 py-0.5 rounded-full" style={{ fontSize: 10, fontWeight: 700, color: cfg.color, background: cfg.bg }}>{emg.severity.toUpperCase()}</span>
                            {emg.isOwned && <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 9, fontWeight: 700, color: "#00C853", background: "rgba(0,200,83,0.12)" }}>OWNED</span>}
                          </div>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{emg.employeeName} · {emg.zone}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p style={{ fontSize: 20, fontWeight: 800, color: timerColor(emg.elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(emg.elapsed)}</p>
                          {emg.status === "active" && emg.elapsed > SLA_THRESHOLD && (
                            <span style={{ fontSize: 9, fontWeight: 800, color: "#FF9500", background: "rgba(255,149,0,0.12)", padding: "1px 6px", borderRadius: 4 }}>SLA BREACH</span>
                          )}
                        </div>
                        <div className="shrink-0 ml-2">
                          {emg.status === "responding" ? (
                            <span className="px-3 py-1.5 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: "#00C853", background: "rgba(0,200,83,0.1)" }}>
                              Responding
                            </span>
                          ) : (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); setAssignModalEmgId(emg.id); }}
                              className="px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                              style={{ fontSize: 11, fontWeight: 700, color: "#FF9500", background: "rgba(255,149,0,0.1)", border: "1px solid rgba(255,149,0,0.15)" }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,149,0,0.18)"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,149,0,0.1)"; }}
                            >
                              Unassigned
                            </span>
                          )}
                        </div>
                        <ChevronDown className="size-4 shrink-0 transition-transform" style={{ color: "rgba(255,255,255,0.2)", transform: isExpanded ? "rotate(180deg)" : "none" }} />
                      </button>
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="px-5 py-4 flex items-center gap-3" style={{ background: `${cfg.color}04`, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                              {emg.status !== "responding" ? (
                                <button onClick={() => onTakeOwnership(emg.id)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
                                  style={{ background: "linear-gradient(135deg, #00C853, #009940)", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 4px 16px rgba(0,200,83,0.25)" }}>
                                  <UserCheck className="size-4" /> Take Ownership
                                </button>
                              ) : (
                                <button onClick={() => onResolve(emg.id)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
                                  style={{ background: "linear-gradient(135deg, #00C8E0, #0088A8)", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 4px 16px rgba(0,200,224,0.25)" }}>
                                  <CheckCircle2 className="size-4" /> Mark Resolved
                                </button>
                              )}
                              {[
                                { icon: Megaphone, label: "Broadcast", color: "#FF9500" },
                                { icon: Send,      label: "Dispatch",  color: "#00C8E0" },
                              ].map(a => (
                                <button key={a.label} onClick={(e) => { e.stopPropagation(); hapticLight(); toast(`${a.label} initiated`, { description: `${a.label} for ${emg.employeeName}` }); }} className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl"
                                  style={{ background: `${a.color}10`, border: `1px solid ${a.color}20`, minWidth: 64, cursor: "pointer" }}>
                                  <div className="size-7 rounded-full flex items-center justify-center" style={{ background: `${a.color}18` }}>
                                    <a.icon className="size-3.5" style={{ color: a.color }} />
                                  </div>
                                  <span style={{ fontSize: 10, fontWeight: 600, color: a.color }}>{a.label}</span>
                                </button>
                              ))}
                              <div onClick={e => e.stopPropagation()}>
                                <CallTrigger employeeName={emg.employeeName} employeeRole="Field Worker" phone={employees.find(e => e.name === emg.employeeName)?.phone || "+966 55 XXX"} reason="emergency" size="sm" />
                              </div>
                              <div className="ml-auto text-right">
                                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>ID: {emg.id}</p>
                                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{emg.timestamp.toLocaleTimeString()}</p>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>

          {/* ── FIX 2: Assign Responder Modal ── */}
          <AnimatePresence>
            {assignModalEmgId && (() => {
              const targetEmg = sorted.find(e => e.id === assignModalEmgId);
              const availableResponders = employees.filter(e => e.status === "on-shift" && e.name !== targetEmg?.employeeName);
              return (
                <motion.div
                  key="assign-modal-backdrop"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[200] flex items-center justify-center"
                  style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
                  onClick={() => setAssignModalEmgId(null)}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, y: 20 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    className="rounded-2xl overflow-hidden w-[380px] max-h-[480px] flex flex-col"
                    style={{ background: "linear-gradient(135deg, #1A1A2E, #16162A)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <div>
                        <p className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>Assign Responder</p>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                          {targetEmg?.type} · {targetEmg?.employeeName}
                        </p>
                      </div>
                      <button onClick={() => setAssignModalEmgId(null)} className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                        <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}>
                      {availableResponders.length === 0 ? (
                        <div className="text-center py-8">
                          <Users className="size-8 mx-auto mb-2" style={{ color: "rgba(255,255,255,0.15)" }} />
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>No on-shift responders available</p>
                        </div>
                      ) : availableResponders.slice(0, 10).map(emp => (
                        <button
                          key={emp.id}
                          onClick={() => {
                            onTakeOwnership(assignModalEmgId!);
                            hapticLight();
                            toast.success("Responder Assigned", { description: `${emp.name} assigned to ${targetEmg?.type}` });
                            setAssignModalEmgId(null);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all"
                          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(0,200,224,0.06)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,200,224,0.15)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.04)"; }}
                        >
                          <div className="size-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.05))", border: "1px solid rgba(0,200,224,0.2)" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>
                              {emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                            </span>
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</p>
                            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{emp.role} · {emp.zone}</p>
                          </div>
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg shrink-0" style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.12)" }}>
                            <div className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#00C853" }}>ON SHIFT</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                </motion.div>
              );
            })()}
          </AnimatePresence>

          {/* Recent Employees Table */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, type: "spring", stiffness: 200 }}
            className="rounded-2xl overflow-hidden"
            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-[11px] flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.06))", border: "1px solid rgba(0,200,224,0.12)" }}>
                  <Users className="size-4" style={{ color: "#00C8E0", strokeWidth: 1.8 }} />
                </div>
                <div>
                  <p className="text-white" style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("dc.fieldWorkers")}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{t("dc.connectedFromApp")}</p>
                </div>
              </div>
              <button onClick={() => onNavigate("people")} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl"
                style={{ fontSize: 12, color: "#00C8E0", fontWeight: 600, background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                View All <ChevronRight className="size-3.5" />
              </button>
            </div>
            <div className="grid px-5 py-3" style={{ gridTemplateColumns: "1fr 130px 110px 80px", borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.008)" }}>
              {[t("dc.employee"), t("dc.location"), t("dc.lastCheckIn"), t("dc.status")].map(h => (
                <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{h}</span>
              ))}
            </div>
            {employees.slice(0, 6).map((emp, i) => {
              const statusColor = emp.status === "sos" ? "#FF2D55" : emp.status === "late-checkin" ? "#FF9500" : emp.status === "on-shift" || emp.status === "checked-in" ? "#00C853" : "rgba(255,255,255,0.2)";
              const statusLabel = emp.status === "sos" ? "SOS ACTIVE" : emp.status === "late-checkin" ? "Late" : emp.status === "on-shift" ? "On Shift" : emp.status === "checked-in" ? "Checked In" : "Off Shift";
              return (
                <div key={emp.id} className="grid items-center px-5 py-3.5 transition-colors group"
                  style={{ gridTemplateColumns: "1fr 130px 110px 80px", borderBottom: i < 5 ? "1px solid rgba(255,255,255,0.03)" : "none", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.008)" }}>
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: `linear-gradient(135deg, ${statusColor}15, ${statusColor}08)`, border: `1px solid ${statusColor}18` }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, letterSpacing: "-0.01em" }}>{emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                    </div>
                    <div>
                      <p className="text-white" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>{emp.name}</p>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", letterSpacing: "-0.005em" }}>{emp.role}</p>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", letterSpacing: "-0.005em" }} className="truncate">{emp.location}</p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", fontVariantNumeric: "tabular-nums" }}>{emp.lastCheckin}</p>
                  <span className="px-2.5 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: `${statusColor}0A`, border: `1px solid ${statusColor}15`, display: "inline-block", textAlign: "center", letterSpacing: "0.02em" }}>
                    {statusLabel}
                  </span>
                </div>
              );
            })}
          </motion.div>
        </div>

        {/* RIGHT — Stats panel */}
        <div className="space-y-4">
          {/* Safety Score ring */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35, type: "spring", stiffness: 200 }}
            className="rounded-2xl p-5"
            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-white" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("dc.safetyScore")}</p>
              <span style={{ fontSize: 11, color: "#00C853", fontWeight: 700, background: "rgba(0,200,83,0.08)", padding: "4px 10px", borderRadius: 10, border: "1px solid rgba(0,200,83,0.12)", letterSpacing: "-0.005em" }}>+3.2% ↑</span>
            </div>
            <div className="flex items-center gap-5">
              <div className="relative size-[90px] shrink-0">
                <svg viewBox="0 0 90 90" className="size-full -rotate-90">
                  <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="7" />
                  <motion.circle cx="45" cy="45" r="38" fill="none" stroke="#00C853" strokeWidth="7" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 38}`}
                    initial={{ strokeDashoffset: 2 * Math.PI * 38 }}
                    animate={{ strokeDashoffset: 2 * Math.PI * 38 * (1 - safetyScore / 100) }}
                    transition={{ duration: 1.8, ease: "easeOut" }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-white" style={{ fontSize: 22, fontWeight: 800 }}>{safetyScore}</span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>/ 100</span>
                </div>
              </div>
              <div className="space-y-3 flex-1 min-w-0">
                {[
                  { label: t("dc.checkInRate"),  value: "94%", color: "#00C853" },
                  { label: t("dc.sosResponse"),    value: "98%", color: "#00C8E0" },
                  { label: t("dc.zoneCompliance"), value: "87%", color: "#FF9500" },
                ].map(m => (
                  <div key={m.label}>
                    <div className="flex justify-between mb-1.5 gap-2">
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "-0.005em", whiteSpace: "nowrap" }}>{m.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: m.color, letterSpacing: "-0.01em" }}>{m.value}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: m.value }} transition={{ duration: 1.2, delay: 0.5, ease: "easeOut" }}
                        className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${m.color}, ${m.color}CC)`, boxShadow: `0 0 6px ${m.color}30` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* System Health */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.42, type: "spring", stiffness: 200 }}
            className="rounded-2xl p-5"
            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-white" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("dc.systemHealth")}</p>
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.12)" }}>
                <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 2, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: "#00C853", boxShadow: "0 0 6px rgba(0,200,83,0.5)" }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853", letterSpacing: "-0.005em" }}>99.8% uptime</span>
              </div>
            </div>
            <div className="space-y-2.5">
              {systemHealth.map((s, i) => {
                const c = s.status === "operational" ? "#00C853" : "#FF9500";
                return (
                  <div key={i} className="flex flex-col gap-1 p-3 rounded-xl" style={{ background: `${c}06`, border: `1px solid ${c}12` }}>
                    <div className="flex items-center gap-3">
                      <div className="size-2 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
                      <span style={{ flex: 1, fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{s.name}</span>
                      <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 11, fontWeight: 700, color: c, background: `${c}12` }}>{s.uptime}</span>
                    </div>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", paddingLeft: 20 }}>{s.detail}</p>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Zones */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.48, type: "spring", stiffness: 200 }}
            className="rounded-2xl p-5"
            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-white" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("dc.zoneOverview")}</p>
              <button onClick={() => onNavigate("location")} className="flex items-center gap-1 px-3 py-1.5 rounded-xl" style={{ fontSize: 12, color: "#00C8E0", fontWeight: 600, background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>{t("dc.viewAll")} <ChevronRight className="size-3" /></button>
            </div>
            <div className="space-y-2">
              {zones.map((z, i) => {
                const rc = z.risk === "high" ? "#FF2D55" : z.risk === "medium" ? "#FF9500" : "#00C853";
                return (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: `${rc}04`, border: `1px solid ${rc}0A` }}>
                    <div className="size-2.5 rounded-full" style={{ background: rc, boxShadow: `0 0 6px ${rc}40` }} />
                    <p className="flex-1 text-white truncate" style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em" }}>{z.name}</p>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontVariantNumeric: "tabular-nums" }}>{z.employees} workers</span>
                    {z.activeAlerts > 0 && (
                      <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #FF2D55, #FF1744)", boxShadow: "0 2px 6px rgba(255,45,85,0.3)" }}>{z.activeAlerts}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Live Activity */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.54, type: "spring", stiffness: 200 }}
            className="rounded-2xl overflow-hidden"
            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <p className="text-white" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>Live Activity</p>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>Real-time</span>
                <motion.div animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="size-2 rounded-full" style={{ background: "#FF2D55", boxShadow: "0 0 6px rgba(255,45,85,0.4)" }} />
              </div>
            </div>
            <div>
              {liveActivity.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>No recent activity</p>
                </div>
              ) : (
                liveActivity.map((a, i) => {
                  const Icon = a.icon;
                  return (
                    <div key={i} className="flex items-start gap-3 px-5 py-3.5" style={{ borderBottom: i < liveActivity.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                    <div className="size-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${a.color}12` }}>
                      <Icon className="size-3.5" style={{ color: a.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 12, color: a.unread ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.4)", fontWeight: a.unread ? 600 : 400, lineHeight: 1.45 }}>{a.text}</p>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>{a.time}</p>
                    </div>
                    {a.unread && <div className="size-1.5 rounded-full mt-1.5 shrink-0" style={{ background: a.color }} />}
                  </div>
                );
              })
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Navigation Guide — clarifies each hub for new admins ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.008) 100%)", border: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-[11px] flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.04))", border: "1px solid rgba(0,200,224,0.1)" }}>
              <LayoutDashboard className="size-4" style={{ color: "#00C8E0", strokeWidth: 1.8 }} />
            </div>
            <div>
              <p className="text-white" style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>Quick Navigation</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>Click any section to navigate directly</p>
            </div>
          </div>
          <span className="px-3 py-1.5 rounded-xl" style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.12)", letterSpacing: "0.02em" }}>
            10 sections
          </span>
        </div>

        <div className="grid gap-2.5 p-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {([
            { page: "overview" as DashPage,          icon: LayoutDashboard, label: "Overview",            desc: "Live KPIs, emergencies, team status & system health",       color: "#00C8E0", group: "OPS"  },
            { page: "emergencyHub" as DashPage,      icon: Siren,           label: "Emergency Hub",       desc: "Live alerts, SAR protocol & response playbook",             color: "#FF2D55", group: "OPS",  badge: "Live" },
            { page: "riskMap" as DashPage,           icon: MapPin,          label: "Risk Map",            desc: "Real-time situational map with positions & threats",         color: "#FF9500", group: "OPS"  },
            { page: "safetyIntel" as DashPage,       icon: BarChart3,       label: "Safety Intelligence", desc: "AI-powered predictive risk engine & trend analysis",         color: "#7B5EFF", group: "OPS"  },
            { page: "operations" as DashPage,        icon: CalendarDays,    label: "Operations Hub",      desc: "Missions, journeys, workforce, comms & connectivity",        color: "#00C8E0", group: "OPS"  },
            { page: "people" as DashPage,            icon: Users,           label: "People & Teams",      desc: "Directory, buddy system, pre-shift & safety scores",         color: "#00C853", group: "MGMT" },
            { page: "incidentRisk" as DashPage,      icon: ShieldCheck,     label: "Incident & Risk",     desc: "Investigation, CAPA & risk assessment — ISO 45001",          color: "#FF9500", group: "COMP" },
            { page: "reportsAnalytics" as DashPage,  icon: BarChart3,       label: "Reports & Analytics", desc: "Compliance reports, metrics, leaderboard & scheduler",        color: "#4A90D9", group: "COMP" },
            { page: "governance" as DashPage,        icon: Activity,        label: "Governance",          desc: "Audit trail & roles/access control",                         color: "#8090A5", group: "SYS"  },
            { page: "settings" as DashPage,          icon: Activity,        label: "Settings",            desc: "Company profile, notification rules & integrations",          color: "rgba(255,255,255,0.4)", group: "SYS" },
          ] as const).map((item, i) => {
            const Icon = item.icon;
            return (
              <motion.button
                key={item.page}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.65 + i * 0.04, type: "spring", stiffness: 300, damping: 25 }}
                whileHover={{ y: -2, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onNavigate(item.page)}
                className="text-left p-3.5 rounded-xl relative overflow-hidden group"
                style={{ background: `linear-gradient(135deg, ${item.color}06, transparent)`, border: `1px solid ${item.color}0A` }}
              >
                {/* Hover glow */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: `radial-gradient(ellipse at 20% 30%, ${item.color}0A 0%, transparent 60%)` }} />
                <div className="flex items-start gap-3 relative z-10">
                  <div className="size-9 rounded-[10px] flex items-center justify-center shrink-0"
                    style={{ background: `linear-gradient(135deg, ${item.color}15, ${item.color}06)`, border: `1px solid ${item.color}12` }}>
                    <Icon style={{ width: 16, height: 16, color: item.color, strokeWidth: 1.8 }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>{item.label}</span>
                      {"badge" in item && item.badge && (
                        <span className="px-1.5 py-0.5 rounded-md" style={{ fontSize: 8, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #FF2D55, #FF1744)", boxShadow: "0 2px 6px rgba(255,45,85,0.3)" }}>{item.badge}</span>
                      )}
                      <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 700, color: `${item.color}90`, background: `${item.color}08`, letterSpacing: "0.06em" }}>{item.group}</span>
                    </div>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.45, letterSpacing: "-0.005em" }}>{item.desc}</p>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Overview Page — Mobile Operations Center
// ═══════════════════════════════════════════════════════════════
export function OverviewPage({ emergencies, employees, zones, onNavigate, onResolve, onTakeOwnership, onPinAsActive, onClearPriority, t, webMode = false }: {
  emergencies: EmergencyItem[];
  employees: Employee[];
  zones: ZoneData[];
  onNavigate: (page: DashPage) => void;
  onResolve: (id: string) => void;
  onTakeOwnership: (id: string) => void;
  onPinAsActive?: (id: string, reason: string) => void;
  onClearPriority?: (id: string) => void;
  t: (k: string) => string;
  webMode?: boolean;
}) {
  const onShift = employees.filter(e => e.status !== "off-shift").length;
  const lateCheckins = employees.filter(e => e.status === "late-checkin").length;
  const safetyScore = 87;

  const activeEmergencies = emergencies.filter(e => e.status !== "resolved");
  const sorted = sortByPriority(activeEmergencies);
  const stats = getEmergencyStats(activeEmergencies);
  const activeAlerts = stats.unowned + stats.owned;
  const activeFocus = sorted.find(e => e.status === "active" && e.severity === "critical") || sorted.find(e => e.status === "active");

  const [kpiFilter, setKpiFilter] = useState<KpiFilter>(null);
  const [expandedIncident, setExpandedIncident] = useState<string | null>(null);
  // FIX 1: Canonical SLA formula — same as main dashboard
  const slaBreachCount = emergencies.filter(e => e.status === "active" && e.elapsed > SLA_THRESHOLD).length;

  // Zone cluster detection for overview alerts
  const overviewClusters = React.useMemo(() => detectClusters(emergencies), [emergencies]);

  if (webMode) {
    return <WebOverviewLayout
      employees={employees} zones={zones} onNavigate={onNavigate}
      onResolve={onResolve} onTakeOwnership={onTakeOwnership} t={t}
      onShift={onShift} lateCheckins={lateCheckins} safetyScore={safetyScore}
      slaBreachCount={slaBreachCount} sorted={sorted}
    />;
  }

  return (
    <div className="px-4 pt-4 space-y-4">
      {/* KPI FILTER CHIPS */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {([
          { id: "active" as KpiFilter,   label: t("emg.activeStatus"), value: stats.unowned.toString(), color: stats.unowned > 0 ? "#FF2D55" : "#00C853", icon: AlertTriangle, pulse: stats.unowned > 0 },
          { id: "onDuty" as KpiFilter,   label: t("emp.onShift"),       value: "142",                   color: "#00C8E0", icon: Users,         pulse: false },
          { id: "slaBreach" as KpiFilter,label: t("emg.sla"),           value: slaBreachCount.toString(),color: slaBreachCount > 0 ? "#FF9500" : "#00C853", icon: Clock, pulse: false },
          { id: "health" as KpiFilter,   label: t("emg.health"),        value: "99.8%",                 color: "#00C853", icon: Activity,      pulse: false },
        ]).map(chip => (
          <button key={chip.id} onClick={() => setKpiFilter(prev => prev === chip.id ? null : chip.id)}
            className="flex items-center gap-2 px-3 py-2 rounded-full flex-shrink-0 transition-all"
            style={{
              background: kpiFilter === chip.id ? `${chip.color}15` : "rgba(255,255,255,0.03)",
              border: `1px solid ${kpiFilter === chip.id ? `${chip.color}45` : "rgba(255,255,255,0.06)"}`,
              boxShadow: kpiFilter === chip.id ? `0 0 12px ${chip.color}20` : "none",
            }}>
            <div className="size-6 rounded-full flex items-center justify-center" style={{ background: `${chip.color}18` }}>
              <chip.icon className="size-3" style={{ color: chip.color }} />
            </div>
            <div className="flex flex-col items-start">
              <span style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{chip.label}</span>
              <div className="flex items-center gap-1">
                {chip.pulse && <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: chip.color }} />}
                <span style={{ fontSize: 13, fontWeight: 800, color: chip.color, fontVariantNumeric: "tabular-nums" }}>{chip.value}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* ZONE CLUSTER ALERT — Overview */}
      {overviewClusters.length > 0 && overviewClusters.map(cluster => {
        const cfg = CLUSTER_LEVEL_CONFIG[cluster.level];
        return (
          <motion.button
            key={cluster.id}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => onNavigate("emergencyHub" as DashPage)}
            className="w-full rounded-xl px-3 py-2.5 flex items-center gap-3 text-left"
            style={{ background: cfg.bgColor, border: `1px solid ${cfg.borderColor}` }}
          >
            <motion.div
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="size-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${cfg.color}20` }}
            >
              {cluster.level === "catastrophic" ? <Skull className="size-3.5" style={{ color: cfg.color }} /> :
               cluster.level === "mass_casualty" ? <Siren className="size-3.5" style={{ color: cfg.color }} /> :
               <AlertTriangle className="size-3.5" style={{ color: cfg.color }} />}
            </motion.div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 9, fontWeight: 800, color: cfg.color, letterSpacing: "0.5px" }}>{cfg.label}</span>
                <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 800, color: "#fff", background: cfg.color }}>{cluster.affectedCount} SOS</span>
              </div>
              <p className="truncate" style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 1 }}>{cluster.zone} — tap for unified response</p>
            </div>
            <ChevronRight className="size-3.5 shrink-0" style={{ color: cfg.color }} />
          </motion.button>
        );
      })}

      {/* ON-DUTY PANEL */}
      <AnimatePresence>
        {kpiFilter === "onDuty" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="rounded-2xl overflow-hidden" style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.1)" }}>
            <div className="px-3 py-2.5" style={{ borderBottom: "1px solid rgba(0,200,224,0.08)" }}>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 11, fontWeight: 700, color: "#00C8E0", letterSpacing: "0.5px" }}>{t("ov.onDutyPersonnel")}</span>
                <div className="flex gap-3">
                  {[{ l: t("ov.avail"), c: "#00C853", v: 98 }, { l: t("ov.activeShort"), c: "#FF9500", v: 12 }, { l: t("ov.break"), c: "rgba(255,255,255,0.3)", v: 32 }].map(s => (
                    <div key={s.l} className="text-center">
                      <p style={{ fontSize: 13, fontWeight: 800, color: s.c }}>{s.v}</p>
                      <p style={{ fontSize: 6, color: "rgba(255,255,255,0.25)", fontWeight: 600 }}>{s.l}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-3 py-1">
              {(employees.length > 0 ? employees.filter(e => e.status !== "off-shift").slice(0, 4) : []).map((emp, i) => {
                const empStatus = (emp as any).status || "available";
                const sc = empStatus === "available" || empStatus === "on-shift" ? "#00C853" : empStatus === "responding" ? "#FF9500" : "rgba(255,255,255,0.3)";
                const displayStatus = empStatus === "on-shift" || empStatus === "available" ? t("ov.available") : empStatus === "responding" ? t("ov.responding") : t("ov.break");
                const empRole = (emp as any).role || (emp as any).department || "Worker";
                const empZone = (emp as any).zone || "Site";
                const displayName = (emp as any).name || "";
                return (
                  <div key={i} className="flex items-center gap-2.5 py-2" style={{ borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                    <div className="size-7 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00C8E0 0%, #0088A8 100%)" }}>
                      <User className="size-3.5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>{displayName}</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{empRole} · {empZone}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="size-1.5 rounded-full" style={{ background: sc }} />
                      <span style={{ fontSize: 9, fontWeight: 600, color: sc }}>{displayStatus}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SYSTEM HEALTH PANEL */}
      <AnimatePresence>
        {kpiFilter === "health" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-2xl" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.15)" }}>
            <div className="flex items-center justify-between mb-2.5">
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "1px" }}>{t("emg.health")}</span>
              <div className="flex items-center gap-1.5">
                <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 3, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#00C853" }}>99.8%</span>
              </div>
            </div>
            <div className="space-y-2">
              {MOCK_SYSTEM_HEALTH.map((s, i) => {
                const sc = s.status === "operational" ? "#00C853" : "#FF9500";
                return (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: `${sc}06` }}>
                    <div className="size-1.5 rounded-full" style={{ background: sc }} />
                    <span className="flex-1" style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{s.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: sc }}>{s.uptime}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Safety Score Ring + Stats Row */}
      <div className="flex gap-3">
        <div className="flex-shrink-0 p-3 rounded-2xl flex flex-col items-center justify-center"
          style={{ width: 120, background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.08)", backdropFilter: "blur(12px)" }}>
          <div className="relative size-[72px] mb-1.5">
            <svg viewBox="0 0 72 72" className="size-full -rotate-90">
              <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
              <motion.circle cx="36" cy="36" r="30" fill="none" stroke="#00C853" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 30}`}
                initial={{ strokeDashoffset: 2 * Math.PI * 30 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 30 * (1 - safetyScore / 100) }}
                transition={{ duration: 1.5, ease: "easeOut" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-white" style={{ fontSize: 20, fontWeight: 800 }}>{safetyScore}</span>
              <span style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontWeight: 600, marginTop: -2 }}>{t("safety")}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ArrowUpRight className="size-3" style={{ color: "#00C853" }} />
            <span style={{ fontSize: 9, color: "#00C853", fontWeight: 600 }}>+3.2%</span>
          </div>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-2">
          {[
            { label: t("s.onShift"), value: onShift,           color: "#00C853", icon: UserCheck },
            { label: t("s.late"),    value: lateCheckins,       color: "#FF9500", icon: Clock },
            { label: t("s.alerts"),  value: activeAlerts,       color: "#FF2D55", icon: AlertTriangle },
            { label: t("s.total"),   value: employees.length,   color: "#00C8E0", icon: Users },
          ].map(stat => (
            <div key={stat.label} className="p-2.5 rounded-xl"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center gap-1.5 mb-1">
                <stat.icon className="size-3" style={{ color: stat.color }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>{stat.label}</span>
              </div>
              <span className="text-white" style={{ fontSize: 20, fontWeight: 800 }}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Active Emergency — Docked Panel */}
      {activeFocus && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(255,45,85,0.08) 0%, rgba(255,45,85,0.02) 100%)", border: "1px solid rgba(255,45,85,0.15)" }}>
          <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid rgba(255,45,85,0.1)" }}>
            <motion.div animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }} transition={{ duration: 1, repeat: Infinity }}
              className="size-2 rounded-full" style={{ background: "#FF2D55" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#FF2D55", letterSpacing: "0.5px" }}>{t("l.activeEmg")} — {activeFocus.id}</span>
            <span className="ml-auto px-1.5 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: SEVERITY_CONFIG[activeFocus.severity].color }}>
              {t(SEVERITY_CONFIG[activeFocus.severity].tKey).toUpperCase()}
            </span>
          </div>
          <div className="px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{activeFocus.employeeName}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{activeFocus.zone}</p>
                  {activeFocus.elapsed >= SLA_THRESHOLD && (
                    <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                      className="px-1 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 800, color: "#FF2D55", background: "rgba(255,45,85,0.15)" }}>
                      {t("ov.slaBreach")}
                    </motion.span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p style={{ fontSize: 18, fontWeight: 800, color: timerColor(activeFocus.elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(activeFocus.elapsed)}</p>
                <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>{t("inc.responseTime")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
              style={{ background: activeFocus.status === "responding" ? "rgba(0,200,83,0.06)" : "rgba(255,179,0,0.06)", border: `1px solid ${activeFocus.status === "responding" ? "rgba(0,200,83,0.12)" : "rgba(255,179,0,0.12)"}` }}>
              {activeFocus.status === "responding" ? (
                <ShieldCheck className="size-3.5" style={{ color: "#00C853" }} />
              ) : (
                <Shield className="size-3.5" style={{ color: "#FF9500" }} />
              )}
              <span style={{ fontSize: 10, fontWeight: 700, color: activeFocus.status === "responding" ? "#00C853" : "#FF9500" }}>
                {activeFocus.status === "responding" ? t("ov.ownedAdmin") : t("ov.unassigned")}
              </span>
            </div>
            {activeFocus.status !== "responding" ? (
              <button onClick={() => onTakeOwnership(activeFocus.id)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg"
                style={{ background: "linear-gradient(135deg, #34C759 0%, #28A745 100%)", boxShadow: "0 4px 16px rgba(52,199,89,0.25)" }}>
                <CheckCircle2 className="size-4 text-white" />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{t("emg.takeOwnership")}</span>
              </button>
            ) : (
              <>
                <button onClick={() => onResolve(activeFocus.id)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg"
                  style={{ background: "linear-gradient(135deg, #00C8E0 0%, #0088A8 100%)", boxShadow: "0 4px 16px rgba(0,200,224,0.25)" }}>
                  <CheckCircle2 className="size-4 text-white" />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{t("ov.resolveIncident")}</span>
                </button>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: t("ov.assign"),       icon: UserCheck, color: "#00C8E0" },
                    { label: t("emg.broadcast"),    icon: Megaphone, color: "#FF2D55" },
                    { label: t("emg.dispatch"),     icon: Send,      color: "#FF9500" },
                    { label: t("emg.escalate"),     icon: Zap,       color: "#FF9500" },
                  ].map(a => (
                    <button key={a.label} onClick={() => { hapticLight(); toast(`${a.label}`, { description: "Action initiated" }); }} className="flex flex-col items-center gap-1.5 py-2 rounded-xl"
                      style={{ background: `${a.color}08`, border: `1px solid ${a.color}18`, cursor: "pointer" }}>
                      <div className="size-7 rounded-full flex items-center justify-center" style={{ background: `${a.color}18` }}>
                        <a.icon className="size-3.5" style={{ color: a.color }} />
                      </div>
                      <span style={{ fontSize: 7, fontWeight: 700, color: a.color }}>{a.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <button onClick={() => setExpandedIncident(expandedIncident === activeFocus.id ? null : activeFocus.id)}
              className="w-full flex items-center gap-1.5 pt-1"
              style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>
              <Clock className="size-3" />
              <span>{t("emg.timeline")}</span>
              <ChevronDown className="size-3 ml-auto" style={{ transform: expandedIncident === activeFocus.id ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            </button>
            <AnimatePresence>
              {expandedIncident === activeFocus.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                  {((() => {
                    try {
                      const logs: any[] = JSON.parse(localStorage.getItem("sosphere_audit_log") || "[]");
                      if (logs.length > 0) return logs.slice(0, 4).map(l => ({
                        time: new Date(l.timestamp || Date.now()).toLocaleTimeString("en-SA", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
                        event: l.action || "System event",
                      }));
                    } catch { /* fallback */ }
                    return MOCK_TIMELINE;
                  })()).map((entry, i) => (
                    <div key={i} className="flex gap-2 py-1.5">
                      <div className="flex flex-col items-center" style={{ width: 12 }}>
                        <div className="size-1.5 rounded-full mt-1" style={{ background: i === 0 ? "#00C8E0" : "rgba(255,255,255,0.1)" }} />
                        {i < 3 && <div className="w-px flex-1 mt-1" style={{ background: "rgba(255,255,255,0.04)" }} />}
                      </div>
                      <div className="flex-1 flex items-center justify-between">
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{entry.event}</span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontVariantNumeric: "tabular-nums" }}>{entry.time}</span>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      {/* Emergency Queue */}
      {sorted.filter(e => e.id !== activeFocus?.id).length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{t("l.emgQueue")}</p>
              {stats.withManualOverride > 0 && (
                <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 700, color: "#FF9500", background: "rgba(255,179,0,0.12)" }}>
                  {stats.withManualOverride} {t("ov.pinned")}
                </span>
              )}
            </div>
            <button onClick={() => onNavigate("emergencyHub")} className="flex items-center gap-0.5"
              style={{ fontSize: 10, color: "#00C8E0", fontWeight: 500 }}>
              {t("b.viewAll")} <ChevronRight className="size-3" />
            </button>
          </div>
          <div className="space-y-1.5">
            {sorted.filter(e => e.id !== activeFocus?.id).slice(0, 3).map(emg => {
              const config = SEVERITY_CONFIG[emg.severity];
              return (
                <div key={emg.id} className="flex items-center gap-2.5 p-2.5 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                  <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: config.bg }}>
                    <config.icon className="size-3.5" style={{ color: config.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>{emg.type}</p>
                      {emg.manualPriority !== undefined && <ArrowUpRight className="size-2.5 flex-shrink-0" style={{ color: "#FF9500" }} />}
                      {emg.isOwned && <span className="px-1 py-0.5 rounded flex-shrink-0" style={{ fontSize: 6, fontWeight: 700, color: "#00C853", background: "rgba(0,200,83,0.12)" }}>{t("ov.owned")}</span>}
                    </div>
                    <p className="truncate" style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{emg.employeeName} · {emg.zone}</p>
                  </div>
                  <div className="text-right">
                    <span style={{ fontSize: 11, fontWeight: 700, color: timerColor(emg.elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(emg.elapsed)}</span>
                    <div className="flex items-center gap-1 mt-0.5 justify-end">
                      {emg.elapsed >= SLA_THRESHOLD && <span className="px-1 py-0.5 rounded" style={{ fontSize: 6, fontWeight: 800, color: "#FF2D55", background: "rgba(255,45,85,0.15)" }}>SLA</span>}
                      <p className="px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 600, color: config.color, background: config.bg }}>{emg.status.toUpperCase()}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <SectionHeader title={t("l.quickAct")} icon={Zap} color={TOKENS.accent.primary} />
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Plus,     label: t("b.createEmg"),  color: "#FF2D55", action: () => onNavigate("emergencyHub") },
            { icon: Megaphone,label: t("b.broadcast"),  color: "#FF9500", action: () => onNavigate("comms") },
            { icon: Send,     label: t("b.dispatch"),   color: "#00C8E0", action: () => onNavigate("emergencyHub") },
          ].map(qa => (
            <motion.button key={qa.label} onClick={qa.action} whileTap={{ scale: 0.95 }}
              className="flex flex-col items-center gap-2 py-3 rounded-2xl"
              style={{ background: `${qa.color}08`, border: `1px solid ${qa.color}18` }}>
              <div className="size-11 rounded-full flex items-center justify-center"
                style={{ background: `${qa.color}18`, border: `2px solid ${qa.color}30`, boxShadow: `0 4px 16px ${qa.color}20` }}>
                <qa.icon className="size-5" style={{ color: qa.color }} />
              </div>
              <span className="whitespace-pre-line text-center" style={{ fontSize: 9, color: qa.color, fontWeight: 700, lineHeight: 1.3 }}>{qa.label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Zones Overview */}
      <div>
        <SectionHeader title={t("l.zoneStatus")} icon={MapPin} color={TOKENS.accent.warning}
          action={{ label: `${t("b.viewAll")} →`, onClick: () => onNavigate("location") }} />
        <div className="space-y-1.5">
          {zones.slice(0, 3).map(zone => {
            const riskColor = zone.risk === "high" ? "#FF2D55" : zone.risk === "medium" ? "#FF9500" : "#00C853";
            return (
              <DSCard key={zone.id} padding={10} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: `${riskColor}12` }}>
                  <MapPin className="size-3.5" style={{ color: riskColor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>{zone.name}</p>
                  <p style={{ fontSize: 9, color: TOKENS.text.muted }}>{zone.employees} {t("l.emp")}</p>
                </div>
                <Badge variant={zone.risk === "high" ? "danger" : zone.risk === "medium" ? "warning" : "success"}>{zone.risk} {t("l.risk")}</Badge>
              </DSCard>
            );
          })}
        </div>
      </div>

      {/* Live Activity Feed */}
      <div className="pb-4">
        <SectionHeader title={t("l.liveAct")} icon={Activity} color={TOKENS.accent.success} />
        <DSCard padding={0}>
          {[
            { time: "Just now", text: "Mohammed Ali triggered SOS in Zone D",    color: "#FF2D55", icon: AlertTriangle, unread: true  },
            { time: "2m ago",   text: "Khalid Omar missed scheduled check-in",   color: "#FF9500", icon: Clock,         unread: true  },
            { time: "5m ago",   text: "Fatima Hassan checked in at Zone B",       color: "#00C853", icon: CheckCircle2,  unread: false },
            { time: "12m ago",  text: "Sara Al-Mutairi completed safety drill",   color: "#00C8E0", icon: Shield,        unread: false },
            { time: "18m ago",  text: "Zone D restricted — gas leak detected",    color: "#FF2D55", icon: AlertTriangle, unread: false },
          ].map((activity, i) => (
            <div key={i}>
              <AlertItem title={activity.text} icon={activity.icon} color={activity.color} timestamp={activity.time} unread={activity.unread} />
              {i < 4 && <Divider />}
            </div>
          ))}
        </DSCard>
      </div>

      {/* FIX 3: Emergency Watchdog — Auto-escalation after 5min unattended */}
      <EmergencyWatchdog
        emergencies={sorted}
        onTakeAction={(id) => {
          const emergency = sorted.find(e => e.id === id);
          if (emergency) {
            // Focus on this emergency
            toast.success(`Opening emergency for ${emergency.employeeName}`, {
              description: "Taking immediate action",
            });
            // In real implementation, this would open AI Co-Admin
          }
        }}
        onCall997={(id) => {
          const emergency = sorted.find(e => e.id === id);
          if (emergency) {
            toast.success("📞 Calling 997 Emergency Services", {
              description: `For ${emergency.employeeName} in ${emergency.zone}`,
            });
            // In real implementation with Twilio:
            // twilioCall("997", { emergencyId: id, location: emergency.zone });
          }
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Employee Detail View — 4-Tab Profile
// ═══════════════════════════════════════════════════════════════
function EmpDetailView({ emp, statusCfg, scoreColor, t, onBack }: {
  emp: Employee;
  statusCfg: typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG];
  scoreColor: string;
  t: (k: string) => string;
  onBack: () => void;
}) {
  type EmpTab = "profile" | "medical" | "contacts" | "history";
  const [activeTab, setActiveTab] = useState<EmpTab>("profile");
  const tabs = [
    { id: "profile"  as EmpTab, label: "Profile",   icon: "👤" },
    { id: "medical"  as EmpTab, label: "Medical ID", icon: "🏥" },
    { id: "contacts" as EmpTab, label: "Contacts",   icon: "📱" },
    { id: "history"  as EmpTab, label: "History",    icon: "📋" },
  ];
  const MEDICAL_DATA = {
    bloodType: "A+", allergies: ["Penicillin", "Latex"],
    medications: ["Aspirin 100mg", "Metformin 500mg"],
    conditions: ["Type 2 Diabetes", "Hypertension"],
    emergencyNote: "Patient requires insulin kit on-site. Do NOT administer morphine.",
    lastUpdated: "Feb 12, 2026", organDonor: true,
  };
  const CONTACTS = [
    { name: "Mona Al-Khalil",   relation: "Wife",            phone: "+966 50 111 2233", priority: 1, color: "#FF2D55" },
    { name: "Samir Al-Khalil",  relation: "Brother",         phone: "+966 55 444 5566", priority: 2, color: "#FF9500" },
    { name: "Dr. Tariq Nour",   relation: "Personal Doctor", phone: "+966 12 345 6789", priority: 3, color: "#00C8E0" },
  ];
  const INCIDENTS = [
    { id: "INC-2026-014", type: "Missed Check-in", date: "Mar 3, 2026", severity: "medium"   as const, resolved: true },
    { id: "INC-2026-008", type: "Geofence Breach",  date: "Feb 18, 2026",severity: "low"      as const, resolved: true },
    { id: "INC-2025-091", type: "SOS Activated",    date: "Dec 5, 2025", severity: "critical" as const, resolved: true },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <button onClick={onBack} className="flex items-center gap-1 mb-3" style={{ fontSize: 11, fontWeight: 600, color: TOKENS.accent.primary }}>
          <ChevronLeft className="size-3.5" /> {t("emp.back")}
        </button>
        <div className="flex items-center gap-3 mb-3">
          <div className="relative">
            <div className="size-14 rounded-full flex items-center justify-center" style={{ background: `conic-gradient(${scoreColor} ${emp.safetyScore * 3.6}deg, rgba(255,255,255,0.06) 0deg)`, padding: 2 }}>
              <div className="size-full rounded-full flex items-center justify-center" style={{ background: `${statusCfg.color}15` }}>
                <User className="size-6" style={{ color: statusCfg.color }} />
              </div>
            </div>
            {statusCfg.dot && <div className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2" style={{ background: statusCfg.color, borderColor: "#05070E" }} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>{emp.name}</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{emp.role} · {emp.department}</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge color={statusCfg.color}>{t(statusCfg.tKey)}</Badge>
              <span style={{ fontSize: 10, color: scoreColor, fontWeight: 700 }}>Score: {emp.safetyScore}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <button onClick={() => { hapticLight(); toast(`Calling ${emp.name}`, { description: emp.phone }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(52,199,89,0.12)", border: "1px solid rgba(52,199,89,0.25)", boxShadow: "0 2px 8px rgba(52,199,89,0.15)", cursor: "pointer" }}>
              <Phone className="size-3.5" style={{ color: "#34C759" }} />
            </button>
            <button onClick={() => { hapticLight(); toast(`Message ${emp.name}`, { description: "Opening chat..." }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.25)", boxShadow: "0 2px 8px rgba(0,200,224,0.15)", cursor: "pointer" }}>
              <MessageSquare className="size-3.5" style={{ color: "#00C8E0" }} />
            </button>
          </div>
        </div>
        <div className="flex gap-1">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg transition-all"
              style={{ fontSize: 9, fontWeight: activeTab === tab.id ? 700 : 500, background: activeTab === tab.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)", border: `1px solid ${activeTab === tab.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`, color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>
              <span>{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "none" }}>
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-3">
            {activeTab === "profile" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: t("emp.location"),   value: emp.location,   icon: MapPin, color: "#00C8E0" },
                    { label: t("emp.lastCheckin"), value: emp.lastCheckin,icon: Clock,  color: "#FF9500" },
                    { label: t("emp.phone"),       value: emp.phone,      icon: Phone,  color: "#34C759" },
                    { label: t("emp.empId"),       value: emp.id,         icon: Hash,   color: "#8090A5" },
                  ].map(item => (
                    <DSCard key={item.label} padding={12}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 6 }}>{item.label}</div>
                      <div className="flex items-center gap-1.5">
                        <item.icon className="size-3 flex-shrink-0" style={{ color: item.color }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>{item.value}</span>
                      </div>
                    </DSCard>
                  ))}
                </div>
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>{t("emp.recentActivity")}</div>
                  {[
                    { time: "Today 09:15", event: t("emp.checkedInAt"), color: "#00C853" },
                    { time: "Today 08:30", event: t("emp.briefing"),    color: "#00C8E0" },
                    { time: "Yesterday",   event: t("emp.ppeInspect"),  color: "#8090A5" },
                  ].map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-1.5" style={{ borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                      <div className="size-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: a.color }} />
                      <div className="flex-1">
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{a.event}</p>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{a.time}</p>
                      </div>
                    </div>
                  ))}
                </DSCard>
              </>
            )}
            {activeTab === "medical" && (
              <>
                <div className="p-3 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(255,45,85,0.08), rgba(255,45,85,0.03))", border: "1px solid rgba(255,45,85,0.15)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,45,85,0.12)", border: "1px solid rgba(255,45,85,0.2)" }}>
                        <HeartPulse className="size-4" style={{ color: "#FF2D55" }} />
                      </div>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>Medical ID</p>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Updated {MEDICAL_DATA.lastUpdated}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>
                      <div className="size-1.5 rounded-full" style={{ background: "#FF2D55" }} />
                      <span style={{ fontSize: 9, color: "#FF2D55", fontWeight: 700 }}>Emergency Access</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-2.5 rounded-lg mb-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <div className="size-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,45,85,0.15)", border: "2px solid rgba(255,45,85,0.3)" }}>
                      <span style={{ fontSize: 14, fontWeight: 900, color: "#FF2D55" }}>{MEDICAL_DATA.bloodType}</span>
                    </div>
                    <div>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>BLOOD TYPE</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{MEDICAL_DATA.bloodType} Positive</p>
                    </div>
                    {MEDICAL_DATA.organDonor && (
                      <div className="ml-auto flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.2)" }}>
                        <span style={{ fontSize: 8, color: "#00C853", fontWeight: 700 }}>🫀 Organ Donor</span>
                      </div>
                    )}
                  </div>
                  <div className="p-2.5 rounded-lg" style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)" }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: "#FF9500", marginBottom: 3 }}>⚠️ EMERGENCY NOTE</p>
                    <p style={{ fontSize: 10, color: "rgba(255,150,0,0.8)", lineHeight: 1.5 }}>{MEDICAL_DATA.emergencyNote}</p>
                  </div>
                </div>
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Allergies</div>
                  <div className="flex flex-wrap gap-2">
                    {MEDICAL_DATA.allergies.map(a => (
                      <span key={a} className="px-2 py-1 rounded-full" style={{ fontSize: 10, fontWeight: 600, color: "#FF2D55", background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>⚠ {a}</span>
                    ))}
                  </div>
                </DSCard>
                <div className="grid grid-cols-2 gap-2">
                  <DSCard padding={12}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Conditions</div>
                    {MEDICAL_DATA.conditions.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <div className="size-1.5 rounded-full" style={{ background: "#FF9500" }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>{c}</span>
                      </div>
                    ))}
                  </DSCard>
                  <DSCard padding={12}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Medications</div>
                    {MEDICAL_DATA.medications.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <div className="size-1.5 rounded-full" style={{ background: "#00C8E0" }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>{m}</span>
                      </div>
                    ))}
                  </DSCard>
                </div>
              </>
            )}
            {activeTab === "contacts" && (
              <>
                <div className="flex items-center justify-between mb-1">
                  <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "1px" }}>EMERGENCY CONTACTS</p>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Priority order</span>
                </div>
                {CONTACTS.map((c, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
                    <DSCard padding={14}>
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          <div className="size-11 rounded-full flex items-center justify-center" style={{ background: `${c.color}15`, border: `1px solid ${c.color}25` }}>
                            <span style={{ fontSize: 16, fontWeight: 700, color: c.color }}>{c.name.charAt(0)}</span>
                          </div>
                          <div className="absolute -top-1 -right-1 size-4 rounded-full flex items-center justify-center"
                            style={{ background: c.color, border: "1.5px solid #05070E", fontSize: 8, fontWeight: 800, color: "#fff" }}>{c.priority}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</p>
                          <p style={{ fontSize: 10, color: c.color, fontWeight: 500 }}>{c.relation}</p>
                          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", direction: "ltr" }}>{c.phone}</p>
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => { hapticLight(); toast(`Calling ${c.name}`, { description: c.phone }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: `${c.color}12`, border: `1px solid ${c.color}25`, boxShadow: `0 2px 8px ${c.color}15`, cursor: "pointer" }}>
                            <Phone className="size-3.5" style={{ color: c.color }} />
                          </button>
                          <button onClick={() => { hapticLight(); toast(`Message ${c.name}`, { description: "Opening chat..." }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)", cursor: "pointer" }}>
                            <MessageSquare className="size-3.5" style={{ color: "#00C8E0" }} />
                          </button>
                        </div>
                      </div>
                    </DSCard>
                  </motion.div>
                ))}
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Auto-Notify on SOS</div>
                  {CONTACTS.map((c, i) => (
                    <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: i < CONTACTS.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{c.name}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                        <span style={{ fontSize: 9, color: "#00C853", fontWeight: 600 }}>Enabled</span>
                      </div>
                    </div>
                  ))}
                </DSCard>
              </>
            )}
            {activeTab === "history" && (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: "Total Incidents", value: INCIDENTS.length, color: "#FF2D55" },
                    { label: "SOS Events",       value: 1,               color: "#FF9500" },
                    { label: "Safety Score",     value: emp.safetyScore, color: scoreColor },
                  ].map(k => (
                    <DSCard key={k.label} padding={10} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: k.color }}>{k.value}</div>
                      <div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginTop: 2 }}>{k.label}</div>
                    </DSCard>
                  ))}
                </div>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "1px", marginBottom: 8 }}>INCIDENT HISTORY</p>
                  {INCIDENTS.map((inc, i) => {
                    const cfg = SEVERITY_CONFIG[inc.severity];
                    return (
                      <motion.div key={inc.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
                        <DSCard padding={12} style={{ marginBottom: 8 }}>
                          <div className="flex items-center gap-2.5">
                            <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: cfg.bg }}>
                              <cfg.icon className="size-3.5" style={{ color: cfg.color }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>{inc.type}</p>
                                <Badge color={cfg.color}>{inc.severity}</Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{inc.id}</span>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>·</span>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{inc.date}</span>
                              </div>
                            </div>
                            <Badge variant="success" size="sm">Resolved</Badge>
                          </div>
                        </DSCard>
                      </motion.div>
                    );
                  })}
                </div>
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Check-in Pattern (7 days)</div>
                  <div className="flex items-end gap-1 h-12">
                    {[80, 100, 60, 100, 90, 100, 70].map((h, i) => (
                      <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: h === 100 ? "#00C853" : h >= 80 ? "#FF9500" : "#FF2D55", opacity: 0.7 }} />
                    ))}
                  </div>
                  <div className="flex justify-between mt-1.5">
                    {["M","T","W","T","F","S","S"].map((d, i) => (
                      <span key={i} style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", textAlign: "center", flex: 1 }}>{d}</span>
                    ))}
                  </div>
                </DSCard>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Employees Page
// ═══════════════════════════════════════════════════════════════
export function EmployeesPage({ employees, t, webMode = false, onEmployeeSelect }: { employees: Employee[]; t: (k: string) => string; webMode?: boolean; onEmployeeSelect?: (emp: Employee) => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;
  const departments = ["all", ...Array.from(new Set(employees.map(e => e.department)))];
  const filtered = employees.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) || e.id.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || e.status === filter;
    const matchDept = deptFilter === "all" || e.department === deptFilter;
    return matchSearch && matchFilter && matchDept;
  });
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const avgScore = employees.length > 0 ? Math.round(employees.reduce((s, e) => s + e.safetyScore, 0) / employees.length) : 0;

  if (selectedEmp) {
    const statusCfg = STATUS_CONFIG[selectedEmp.status];
    const scoreColor = selectedEmp.safetyScore >= 90 ? "#00C853" : selectedEmp.safetyScore >= 75 ? "#FF9500" : "#FF2D55";
    return <EmpDetailView emp={selectedEmp} statusCfg={statusCfg} scoreColor={scoreColor} t={t} onBack={() => setSelectedEmp(null)} />;
  }

  if (webMode) {
    const statusColors: Record<string, string> = { "on-shift": "#00C853", "checked-in": "#00C8E0", "late-checkin": "#FF9500", "sos": "#FF2D55", "off-shift": "rgba(255,255,255,0.25)" };
    const statusLabels: Record<string, string> = { "on-shift": "On Shift", "checked-in": "Checked In", "late-checkin": "Late", "sos": "SOS", "off-shift": "Off Shift" };
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>Field Workers</h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{employees.length} total employees · {employees.filter(e => e.status !== "off-shift").length} on duty today</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <Search className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Search employees…" className="bg-transparent outline-none text-white" style={{ fontSize: 13, width: 200, fontFamily: "inherit" }} />
            </div>
            <div className="flex gap-1.5">
              {[{ id: "all", label: "All" }, { id: "on-shift", label: "Active" }, { id: "sos", label: "SOS" }, { id: "late-checkin", label: "Late" }].map(f => (
                <button key={f.id} onClick={() => { setFilter(f.id); setPage(0); }} className="px-3 py-2 rounded-xl"
                  style={{ fontSize: 12, fontWeight: filter === f.id ? 700 : 500, background: filter === f.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", color: filter === f.id ? "#00C8E0" : "rgba(255,255,255,0.4)", border: filter === f.id ? "1px solid rgba(0,200,224,0.25)" : "1px solid rgba(255,255,255,0.06)" }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Workers",     value: employees.length, color: "#00C8E0", icon: Users,       sub: "Registered" },
            { label: "On Duty Now",        value: employees.filter(e => e.status === "on-shift" || e.status === "checked-in").length, color: "#00C853", icon: UserCheck, sub: "Active shift" },
            { label: "SOS Active",         value: employees.filter(e => e.status === "sos").length,      color: "#FF2D55", icon: AlertTriangle, sub: employees.filter(e => e.status === "sos").length > 0 ? "Immediate" : "None" },
            { label: "Avg Safety Score",   value: `${avgScore}%`, color: avgScore >= 85 ? "#00C853" : "#FF9500", icon: ShieldCheck, sub: avgScore >= 85 ? "Excellent" : "Needs attention" },
          ].map((k, i) => {
            const Icon = k.icon;
            return (
              <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: `${k.color}12`, border: `1px solid ${k.color}20` }}>
                    <Icon className="size-5" style={{ color: k.color }} />
                  </div>
                </div>
                <p style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-1px", color: k.color }}>{k.value}</p>
                <p className="text-white mt-1" style={{ fontSize: 13, fontWeight: 600 }}>{k.label}</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{k.sub}</p>
              </motion.div>
            );
          })}
        </div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="grid px-5 py-3" style={{ gridTemplateColumns: "48px 1fr 140px 160px 90px 80px 100px", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {["", "Employee", "Department", "Location", "Last Check", "Score", "Status"].map(h => (
              <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{h}</span>
            ))}
          </div>
          {paginated.map((emp, i) => {
            const sc = statusColors[emp.status] || "rgba(255,255,255,0.25)";
            const sl = statusLabels[emp.status] || emp.status;
            const scoreColor = emp.safetyScore >= 90 ? "#00C853" : emp.safetyScore >= 75 ? "#FF9500" : "#FF2D55";
            
            // FIX J: Calculate risk score for each employee
            const riskScore = calculateRiskScore({
              id: emp.id,
              name: emp.name,
              joinDate: emp.joinDate || Date.now(),
              hasBuddy: !!(emp as any).buddyId,
              checkInInterval: (emp as any).checkInInterval || 120,
              batteryLevel: (() => {
                try {
                  const syncData = JSON.parse(localStorage.getItem("sosphere_sync_data") || "{}");
                  return syncData.batteryLevel ?? 100;
                } catch { return 100; }
              })(), // reads from last sync
              isWorkingAlone: (() => {
                try {
                  const gpsTrail: any[] = JSON.parse(localStorage.getItem("sosphere_gps_trail") || "[]");
                  if (gpsTrail.length < 2) return false;
                  const last = gpsTrail[gpsTrail.length - 1];
                  // Check if any other employee is within 50m of last GPS point
                  return !gpsTrail.slice(-10).some((p, i) => i > 0 && p.employeeId !== last.employeeId &&
                    Math.abs(p.lat - last.lat) < 0.0005 && Math.abs(p.lng - last.lng) < 0.0005);
                } catch { return false; }
              })(), // computed from GPS proximity
              shift: new Date().getHours() >= 20 || new Date().getHours() < 6 ? "night" : "day",
              temperature: undefined,
              isFasting: false,
            });
            
            return (
              <motion.div key={emp.id} layout onClick={() => onEmployeeSelect ? onEmployeeSelect(emp) : setSelectedEmp(emp)}
                className="grid items-center px-5 py-3.5 cursor-pointer transition-colors group"
                style={{ gridTemplateColumns: "48px 1fr 140px 160px 90px 80px 100px", borderBottom: i < paginated.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}
                whileHover={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="size-9 rounded-full flex items-center justify-center" style={{ background: `${sc}18`, border: `1.5px solid ${sc}30` }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: sc }}>{emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{emp.name}</p>
                    {emp.status === "sos" && <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.6, repeat: Infinity }} className="px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 800, color: "#FF2D55", background: "rgba(255,45,85,0.15)" }}>SOS</motion.span>}
                    {/* FIX J: Risk Score Badge */}
                    {riskScore.totalScore >= 41 && (
                      <span className="px-2 py-0.5 rounded-md" style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: getRiskColor(riskScore.level),
                        background: `${getRiskColor(riskScore.level)}15`,
                        border: `1px solid ${getRiskColor(riskScore.level)}30`,
                      }}>
                        {getRiskLabel(riskScore.level)} {riskScore.totalScore}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{emp.role} · {emp.id}</p>
                  {/* FIX J: Show top risk factors */}
                  {riskScore.totalScore >= 61 && riskScore.factors.length > 0 && (
                    <p style={{ fontSize: 10, color: "rgba(255,149,0,0.7)", marginTop: 2 }}>
                      {riskScore.factors.slice(0, 2).map(f => f.label).join(", ")}
                    </p>
                  )}
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{emp.department}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }} className="truncate">{emp.location}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{emp.lastCheckin}</p>
                <div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1 rounded-full flex-1" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="h-full rounded-full" style={{ width: `${emp.safetyScore}%`, background: scoreColor }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor }}>{emp.safetyScore}</span>
                  </div>
                </div>
                <span className="px-2.5 py-1.5 rounded-lg text-center" style={{ fontSize: 10, fontWeight: 700, color: sc, background: `${sc}12`, display: "inline-block" }}>{sl}</span>
              </motion.div>
            );
          })}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", opacity: page === 0 ? 0.3 : 1 }}>← Prev</button>
                <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", opacity: page >= totalPages - 1 ? 0.3 : 1 }}>Next →</button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { label: t("emp.total"),   value: employees.length,                                      color: "#00C8E0" },
          { label: t("emp.onShift"), value: employees.filter(e => e.status === "on-shift").length, color: "#00C853" },
          { label: "SOS",            value: employees.filter(e => e.status === "sos").length,       color: "#FF2D55" },
          { label: t("emp.avgScore"),value: avgScore,                                               color: avgScore >= 85 ? "#00C853" : "#FF9500" },
        ].map(k => (
          <DSCard key={k.label} padding={8} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{k.label}</div>
          </DSCard>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <Search className="size-3.5" style={{ color: "rgba(255,255,255,0.2)" }} />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder={t("emp.search")} className="flex-1 bg-transparent outline-none text-white placeholder:text-white/20" style={{ fontSize: 12 }} />
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {[
          { id: "all",          label: t("l.all"),       count: employees.length },
          { id: "on-shift",     label: t("emp.onShift"), count: employees.filter(e => e.status === "on-shift").length },
          { id: "sos",          label: "SOS",             count: employees.filter(e => e.status === "sos").length },
          { id: "late-checkin", label: t("emp.late"),    count: employees.filter(e => e.status === "late-checkin").length },
          { id: "off-shift",    label: t("emp.offShift"),count: employees.filter(e => e.status === "off-shift").length },
        ].map(f => (
          <button key={f.id} onClick={() => { setFilter(f.id); setPage(0); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg whitespace-nowrap"
            style={{ fontSize: 10, fontWeight: 500, background: filter === f.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)", color: filter === f.id ? "#00C8E0" : "rgba(255,255,255,0.35)", border: `1px solid ${filter === f.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}` }}>
            {f.label}
            <span className="px-1 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 700, background: filter === f.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.05)" }}>{f.count}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {departments.map(d => (
          <button key={d} onClick={() => { setDeptFilter(d); setPage(0); }} className="px-2.5 py-1 rounded-lg whitespace-nowrap"
            style={{ fontSize: 9, fontWeight: 500, background: deptFilter === d ? "rgba(175,82,222,0.1)" : "transparent", color: deptFilter === d ? "#AF52DE" : "rgba(255,255,255,0.25)", border: `1px solid ${deptFilter === d ? "rgba(175,82,222,0.2)" : "rgba(255,255,255,0.03)"}` }}>
            {d === "all" ? t("emp.allDepts") : d}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {paginated.map(emp => {
          const statusCfg = STATUS_CONFIG[emp.status];
          return (
            <motion.div key={emp.id} layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => setSelectedEmp(emp)} className="p-3 rounded-xl cursor-pointer" whileTap={{ scale: 0.98 }}
              style={{ background: emp.status === "sos" ? "rgba(255,45,85,0.05)" : "rgba(255,255,255,0.02)", border: `1px solid ${emp.status === "sos" ? "rgba(255,45,85,0.12)" : "rgba(255,255,255,0.04)"}` }}>
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <div className="size-9 rounded-full flex items-center justify-center" style={{ background: `${statusCfg.color}15` }}>
                    <User className="size-4" style={{ color: statusCfg.color }} />
                  </div>
                  {statusCfg.dot && (
                    <motion.div animate={emp.status === "sos" ? { scale: [1, 1.4, 1] } : {}} transition={{ duration: 0.8, repeat: Infinity }}
                      className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2"
                      style={{ background: statusCfg.color, borderColor: "#05070E" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</p>
                    {emp.status === "sos" && (
                      <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 0.6, repeat: Infinity }} className="px-1 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 800, color: "#FF2D55", background: "rgba(255,45,85,0.15)" }}>SOS</motion.span>
                    )}
                  </div>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{emp.role} · {emp.department}</p>
                </div>
                <div className="text-right">
                  <p style={{ fontSize: 14, fontWeight: 800, color: emp.safetyScore >= 90 ? "#00C853" : emp.safetyScore >= 75 ? "#FF9500" : "#FF2D55" }}>{emp.safetyScore}</p>
                  <p style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>{t("emp.score")}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-1">
                  <MapPin className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{emp.location}</span>
                </div>
                <div className="flex items-center gap-1 ml-auto">
                  <Clock className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{emp.lastCheckin}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 pb-2">
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} {t("emp.of")} {filtered.length}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="size-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", opacity: page === 0 ? 0.3 : 1 }}>
              <ChevronLeft className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="size-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", opacity: page >= totalPages - 1 ? 0.3 : 1 }}>
              <ChevronRight className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Emergencies Page
// ═══════════════════════════════════════════════════════════════
type EmgStatus = "new" | "active" | "responding" | "contained" | "resolved" | "closed";
interface EmgTimelineEvent { time: Date; event: string; actor: string; }
interface EmgOwner { name: string; takenAt: Date; }
interface RichEmergency {
  id: string; title: string; description: string;
  severity: "critical" | "high" | "medium" | "low";
  status: EmgStatus; zone: string; address: string; radius: number;
  createdAt: Date; owner?: EmgOwner;
  affectedCount: number; respondersCount: number;
  timeline: EmgTimelineEvent[];
}

const EMG_STATUS_CONFIG: Record<EmgStatus, { label: string; color: string; bg: string; tKey: string }> = {
  new:        { label: "NEW",        color: "#FFB300", bg: "rgba(255,179,0,0.10)",   tKey: "status.new"       },
  active:     { label: "ACTIVE",     color: "#FF2D55", bg: "rgba(255,45,85,0.10)",   tKey: "status.active"    },
  responding: { label: "RESPONDING", color: "#00C8E0", bg: "rgba(0,200,224,0.10)",   tKey: "status.responding"},
  contained:  { label: "CONTAINED",  color: "#34C759", bg: "rgba(52,199,89,0.10)",   tKey: "status.contained" },
  resolved:   { label: "RESOLVED",   color: "#8090A5", bg: "rgba(128,144,165,0.10)", tKey: "status.resolved"  },
  closed:     { label: "CLOSED",     color: "#8090A5", bg: "rgba(128,144,165,0.10)", tKey: "status.closed"    },
};

const RICH_EMERGENCIES: RichEmergency[] = [
  {
    id: "EMG-2026-001", title: "Chemical Spill — Warehouse B3",
    description: "Hazardous chemical leak detected in storage area B3. Evacuation protocol initiated.",
    severity: "critical", status: "active", zone: "Zone A", address: "Warehouse B3, Sector 7",
    radius: 150, createdAt: new Date(Date.now() - 8 * 60 * 1000),
    affectedCount: 24, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 8 * 60000), event: "Incident Created", actor: "Omar Al-Farsi" },
      { time: new Date(Date.now() - 7.5 * 60000), event: "First Alert Sent", actor: "System" },
    ],
  },
  {
    id: "EMG-2026-002", title: "Fire Alarm — Lab D2",
    description: "Smoke detected in Laboratory D2. Fire suppression system activated.",
    severity: "high", status: "responding", zone: "Zone C", address: "Lab D2, East Wing",
    radius: 80, createdAt: new Date(Date.now() - 22 * 60 * 1000),
    owner: { name: "Ahmed Al-Rashid", takenAt: new Date(Date.now() - 20 * 60000) },
    affectedCount: 15, respondersCount: 5,
    timeline: [
      { time: new Date(Date.now() - 22 * 60000), event: "Incident Created",     actor: "Lina Chen" },
      { time: new Date(Date.now() - 21.5 * 60000), event: "First Alert Sent",   actor: "System" },
      { time: new Date(Date.now() - 20 * 60000), event: "Ownership Taken",       actor: "Ahmed Al-Rashid" },
      { time: new Date(Date.now() - 18 * 60000), event: "Broadcast Alert Sent", actor: "Ahmed Al-Rashid" },
    ],
  },
  {
    id: "EMG-2026-003", title: "Medical Emergency — Floor 5",
    description: "Employee collapsed. Medical team dispatched. Stabilizing patient.",
    severity: "medium", status: "contained", zone: "Zone B", address: "Office Floor 5, Room 502",
    radius: 30, createdAt: new Date(Date.now() - 45 * 60 * 1000),
    owner: { name: "Fatima Hassan", takenAt: new Date(Date.now() - 43 * 60000) },
    affectedCount: 1, respondersCount: 3,
    timeline: [
      { time: new Date(Date.now() - 45 * 60000), event: "Incident Created",   actor: "Sarah Johnson" },
      { time: new Date(Date.now() - 44 * 60000), event: "First Alert Sent",   actor: "System" },
      { time: new Date(Date.now() - 43 * 60000), event: "Ownership Taken",    actor: "Fatima Hassan" },
      { time: new Date(Date.now() - 40 * 60000), event: "Dispatch Team",      actor: "Fatima Hassan" },
      { time: new Date(Date.now() - 35 * 60000), event: "Contained",          actor: "Medical Team" },
    ],
  },
  // ── Zone A Cluster: 2 more SOS in same zone as EMG-001 (demo multi-SOS) ──
  {
    id: "EMG-2026-004", title: "Worker Trapped — Warehouse B3 Collapse",
    description: "Structural collapse near chemical spill area. Worker reported trapped under debris. Same zone as EMG-001.",
    severity: "critical", status: "active", zone: "Zone A", address: "Warehouse B3, Sector 7 — East Wall",
    radius: 150, createdAt: new Date(Date.now() - 6 * 60 * 1000),
    affectedCount: 1, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 6 * 60000), event: "SOS Triggered", actor: "Ali Mansour" },
      { time: new Date(Date.now() - 5.8 * 60000), event: "First Alert Sent", actor: "System" },
      { time: new Date(Date.now() - 5.5 * 60000), event: "Zone Cluster Detected — linked to EMG-2026-001", actor: "System" },
    ],
  },
  {
    id: "EMG-2026-005", title: "Breathing Difficulty — Toxic Fumes",
    description: "Worker reporting difficulty breathing near chemical spill zone. Likely fume exposure from EMG-001 spill.",
    severity: "high", status: "active", zone: "Zone A", address: "Warehouse B3, Sector 7 — Loading Bay",
    radius: 150, createdAt: new Date(Date.now() - 4 * 60 * 1000),
    affectedCount: 1, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 4 * 60000), event: "SOS Triggered", actor: "Hassan Jaber" },
      { time: new Date(Date.now() - 3.8 * 60000), event: "First Alert Sent", actor: "System" },
      { time: new Date(Date.now() - 3.5 * 60000), event: "Zone Cluster Escalated — MASS CASUALTY", actor: "System" },
    ],
  },
  // ── Zone C Cluster: 2 SOS in same zone (demo multi-zone scenario) ──
  {
    id: "EMG-2026-006", title: "Electrical Arc Flash — Lab D2 Panel",
    description: "High-voltage arc flash reported near main electrical panel in Lab D2. Worker received shock, secondary fire risk.",
    severity: "high", status: "active", zone: "Zone C", address: "Lab D2, East Wing — Panel Room",
    radius: 50, createdAt: new Date(Date.now() - 5 * 60 * 1000),
    affectedCount: 2, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 5 * 60000), event: "SOS Triggered", actor: "Khalid Noor" },
      { time: new Date(Date.now() - 4.8 * 60000), event: "First Alert Sent", actor: "System" },
    ],
  },
  {
    id: "EMG-2026-007", title: "Burn Injury — Lab D2 Explosion",
    description: "Worker sustained burns from secondary explosion near arc flash site. Same zone as EMG-006.",
    severity: "critical", status: "active", zone: "Zone C", address: "Lab D2, East Wing — Workstation 3",
    radius: 50, createdAt: new Date(Date.now() - 3 * 60 * 1000),
    affectedCount: 1, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 3 * 60000), event: "SOS Triggered", actor: "Yusuf Adel" },
      { time: new Date(Date.now() - 2.8 * 60000), event: "First Alert Sent", actor: "System" },
      { time: new Date(Date.now() - 2.5 * 60000), event: "Zone Cluster Detected — linked to EMG-2026-006", actor: "System" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// Zone Cluster Banner — Auto-detects multi-SOS in same zone
// ═══════════════════════════════════════════════════════════════
function ZoneClusterBanner({ clusters, onAction, onLaunchSAR }: {
  clusters: ZoneCluster[];
  onAction?: (clusterId: string, actionId: string) => void;
  onLaunchSAR?: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (clusters.length === 0) return null;

  return (
    <div className="space-y-2 mb-3">
      {clusters.map(cluster => {
        const cfg = CLUSTER_LEVEL_CONFIG[cluster.level];
        const isExpanded = expanded === cluster.id;
        const ICON_MAP: Record<string, any> = {
          AlertTriangle, Siren, Skull, Users, Megaphone, Lock,
          HeartPulse, ClipboardList, ArrowUpRight, Phone,
        };

        return (
          <motion.div
            key={cluster.id}
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="rounded-2xl overflow-hidden"
            style={{
              background: cfg.bgColor,
              border: `1px solid ${cfg.borderColor}`,
              boxShadow: `0 0 20px ${cfg.color}15`,
            }}
          >
            {/* Header */}
            <button
              onClick={() => setExpanded(isExpanded ? null : cluster.id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [1, 0.6, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="size-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${cfg.color}20`, border: `1px solid ${cfg.color}40` }}
              >
                {cluster.level === "catastrophic" ? (
                  <Skull className="size-4" style={{ color: cfg.color }} />
                ) : cluster.level === "mass_casualty" ? (
                  <Siren className="size-4" style={{ color: cfg.color }} />
                ) : (
                  <AlertTriangle className="size-4" style={{ color: cfg.color }} />
                )}
              </motion.div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 10, fontWeight: 800, color: cfg.color, letterSpacing: "0.5px" }}>
                    {cfg.label}
                  </span>
                  <motion.span
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="px-1.5 py-0.5 rounded-md"
                    style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: cfg.color }}
                  >
                    {cluster.affectedCount} SOS
                  </motion.span>
                </div>
                <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
                  {cluster.zone} — {cfg.description}
                </p>
              </div>
              <ChevronDown
                className="size-4 shrink-0 transition-transform"
                style={{ color: cfg.color, transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}
              />
            </button>

            {/* Expanded Detail */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${cfg.borderColor}` }}>
                    {/* Workers Involved */}
                    <div className="pt-3">
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        WORKERS INVOLVED
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {cluster.employeeNames.map((name, i) => (
                          <span
                            key={i}
                            className="px-2 py-1 rounded-lg"
                            style={{ fontSize: 10, fontWeight: 600, color: cfg.color, background: `${cfg.color}10`, border: `1px solid ${cfg.color}20` }}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Auto-Executed Actions */}
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        AUTO-EXECUTED
                      </span>
                      <div className="space-y-1.5 mt-2">
                        {cluster.autoActions.map(action => (
                          <div key={action.id} className="flex items-center gap-2">
                            <CheckCircle2
                              className="size-3 shrink-0"
                              style={{ color: action.result === "success" ? "#00C853" : "#FF9500" }}
                            />
                            <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.6)" }}>
                              {action.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Suggested Actions */}
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        RECOMMENDED ACTIONS
                      </span>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {cluster.suggestedActions.slice(0, 4).map(action => {
                          const IconComp = ICON_MAP[action.iconName] || AlertTriangle;
                          return (
                            <button
                              key={action.id}
                              onClick={() => {
                                onAction?.(cluster.id, action.id);
                                toast.success(action.label, { description: action.description });
                              }}
                              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors"
                              style={{
                                background: `${action.color}08`,
                                border: `1px solid ${action.color}20`,
                              }}
                            >
                              <IconComp className="size-3.5 shrink-0" style={{ color: action.color }} />
                              <span style={{ fontSize: 10, fontWeight: 600, color: action.color }}>
                                {action.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Escalation Chain */}
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        ESCALATION CHAIN
                      </span>
                      <div className="flex items-center gap-1 mt-2 flex-wrap">
                        {cluster.escalationChain.map((step, i) => (
                          <span className="contents" key={i}>
                            <span
                              className="px-2 py-1 rounded-lg"
                              style={{
                                fontSize: 9, fontWeight: 600,
                                color: step.acknowledged ? "#00C853" : "rgba(255,255,255,0.5)",
                                background: step.acknowledged ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.03)",
                                border: `1px solid ${step.acknowledged ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.06)"}`,
                              }}
                            >
                              {step.role} ({step.channel})
                            </span>
                            {i < cluster.escalationChain.length - 1 && (
                              <ArrowRight className="size-2.5" style={{ color: "rgba(255,255,255,0.15)" }} />
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* ── SAR Pre-staging — the life-saving bridge ── */}
                    {(cluster.level === "mass_casualty" || cluster.level === "catastrophic") && (
                      <div
                        className="rounded-xl overflow-hidden"
                        style={{
                          background: cluster.level === "catastrophic"
                            ? "linear-gradient(135deg, rgba(255,0,0,0.12), rgba(255,45,85,0.08))"
                            : "linear-gradient(135deg, rgba(255,45,85,0.08), rgba(255,149,0,0.05))",
                          border: `1px solid ${cluster.level === "catastrophic" ? "rgba(255,0,0,0.25)" : "rgba(255,45,85,0.2)"}`,
                        }}
                      >
                        <div className="px-3 py-2.5 flex items-center gap-3">
                          <div
                            className="size-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: "rgba(255,45,85,0.15)", border: "1px solid rgba(255,45,85,0.25)" }}
                          >
                            <Radar className="size-4" style={{ color: "#FF2D55" }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p style={{ fontSize: 10, fontWeight: 800, color: "#FF2D55", letterSpacing: "0.5px" }}>
                              SAR PROTOCOL {cluster.level === "catastrophic" ? "AUTO-ACTIVATED" : "PRE-STAGED"}
                            </p>
                            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>
                              {cluster.level === "catastrophic"
                                ? `Search & Rescue auto-launched — ${cluster.affectedCount} workers, all data pre-filled`
                                : `Mission data ready — search cone, teams, hazards pre-calculated for ${cluster.affectedCount} workers`
                              }
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const result = activateClusterSAR(cluster);
                              toast.success(
                                cluster.level === "catastrophic"
                                  ? "SAR Protocol LIVE — Mission Active"
                                  : "SAR Protocol Activated",
                                {
                                  description: result.clusterContext.preStageReason,
                                  duration: 6000,
                                }
                              );
                              onLaunchSAR?.();
                            }}
                            className="shrink-0 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-transform active:scale-95"
                            style={{
                              background: cluster.level === "catastrophic"
                                ? "linear-gradient(135deg, #FF0000, #FF2D55)"
                                : "linear-gradient(135deg, #FF2D55, #FF6B35)",
                              boxShadow: `0 0 12px ${cluster.level === "catastrophic" ? "rgba(255,0,0,0.4)" : "rgba(255,45,85,0.3)"}`,
                            }}
                          >
                            <Radar className="size-3" style={{ color: "#fff" }} />
                            <span style={{ fontSize: 10, fontWeight: 800, color: "#fff" }}>
                              {cluster.level === "catastrophic" ? "View SAR" : "Activate SAR"}
                            </span>
                          </button>
                        </div>
                        {/* Pre-staged data summary */}
                        <div
                          className="px-3 py-2 flex items-center gap-3 flex-wrap"
                          style={{ borderTop: "1px solid rgba(255,45,85,0.1)" }}
                        >
                          {[
                            { label: "Search Cone", value: "Ready", color: "#FF2D55" },
                            { label: "Teams", value: `${cluster.affectedCount > 3 ? 3 : 2} assigned`, color: "#00C8E0" },
                            { label: "Hazards", value: "Scanned", color: "#FF9500" },
                            { label: "Escalation", value: cluster.level === "catastrophic" ? "MAX" : "Level 4", color: "#FF2D55" },
                          ].map(item => (
                            <div key={item.label} className="flex items-center gap-1">
                              <div className="size-1.5 rounded-full" style={{ background: item.color }} />
                              <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.35)" }}>{item.label}:</span>
                              <span style={{ fontSize: 8, fontWeight: 700, color: item.color }}>{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

export function EmergenciesPage({ emergencies: _parentEmg, onResolve: _onResolveParent, onCreate, t, webMode = false, onLaunchSAR }: {
  emergencies: EmergencyItem[];
  onResolve: (id: string) => void;
  onCreate: () => void;
  t: (k: string) => string;
  webMode?: boolean;
  onLaunchSAR?: () => void;
}) {
  const [emgList, setEmgList] = useState<RichEmergency[]>(RICH_EMERGENCIES);

  // ── GAP FIX: Bridge parent emergencies → cluster engine ──
  // When mobile workers trigger SOS, the parent `emergencies` state gets updated
  // but EmergenciesPage's `emgList` is independent. This effect merges new parent
  // emergencies into emgList so the cluster engine can detect multi-SOS events
  // from real-time mobile triggers, not just mock data.
  const knownParentIdsRef = React.useRef<Set<string>>(new Set(_parentEmg.map(e => e.id)));
  useEffect(() => {
    const newEmgs = _parentEmg.filter(e => !knownParentIdsRef.current.has(e.id));
    if (newEmgs.length === 0) return;
    for (const e of newEmgs) knownParentIdsRef.current.add(e.id);
    // Convert EmergencyItem → RichEmergency and merge into emgList
    const richNew: RichEmergency[] = newEmgs.map(e => ({
      id: e.id,
      title: `${e.type} — ${e.employeeName}`,
      description: `Real-time ${e.type} received from ${e.employeeName} in ${e.zone}.`,
      severity: e.severity as RichEmergency["severity"],
      status: (e.status === "resolved" ? "resolved" : e.status === "responding" ? "responding" : "active") as EmgStatus,
      zone: e.zone.split(" - ")[0] || e.zone, // Normalize "Zone A - East" → "Zone A" for clustering
      address: e.zone,
      radius: 100,
      createdAt: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp),
      affectedCount: 1,
      respondersCount: 0,
      owner: e.isOwned ? { name: e.ownedBy || "Admin", takenAt: new Date() } : undefined,
      timeline: [
        { time: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp), event: "Incident Created", actor: e.employeeName },
        { time: new Date(), event: "Synced from Mobile App", actor: "System" },
      ],
    }));
    setEmgList(prev => [...richNew, ...prev]);
  }, [_parentEmg]);

  // ── GAP FIX: Handle parent status changes → mirror in emgList ──
  // When a parent emergency status changes to "resolved", mirror it in emgList
  // so the cluster engine drops resolved emergencies from active clusters.
  useEffect(() => {
    const parentResolved = new Set(
      _parentEmg.filter(e => e.status === "resolved").map(e => e.id)
    );
    if (parentResolved.size === 0) return;
    setEmgList(prev => prev.map(e => {
      if (!parentResolved.has(e.id) || e.status === "resolved" || e.status === "closed") return e;
      return {
        ...e,
        status: "resolved" as EmgStatus,
        timeline: [...e.timeline, { time: new Date(), event: "Resolved (synced from parent)", actor: "System" }],
      };
    }));
  }, [_parentEmg]);

  // ── Zone Cluster Detection ──
  const clusters = React.useMemo(() => {
    return detectClusters(emgList.map(e => ({
      id: e.id,
      zone: e.zone,
      status: e.status,
      timestamp: e.createdAt,
      employeeName: e.timeline[0]?.actor || "Unknown",
      severity: e.severity,
    }))).sort((a, b) => {
      // Priority sort: catastrophic first, then mass_casualty, then zone_alert
      const levelOrder: Record<string, number> = { catastrophic: 0, mass_casualty: 1, zone_alert: 2 };
      return (levelOrder[a.level] ?? 3) - (levelOrder[b.level] ?? 3);
    });
  }, [emgList]);

  // ── Catastrophic Auto-Activation: auto-save SAR for catastrophic clusters ──
  // This fulfills the promise of "SAR Protocol auto-activated" in the auto-actions list.
  // Without this, catastrophic auto-activation was just a label with no actual effect.
  const clusterAutoActionsRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const cluster of clusters) {
      if (clusterAutoActionsRef.current.has(cluster.id)) continue;

      // Guard: only one evacuation at a time (system limitation — single key)
      const existingEvac = getActiveEvacuation();
      const canEvacuate = !existingEvac || existingEvac.status !== "active";

      // ── Catastrophic: Auto-activate SAR + Auto-trigger evacuation ──
      if (cluster.level === "catastrophic") {
        clusterAutoActionsRef.current.add(cluster.id);
        const result = activateClusterSAR(cluster);
        toast.error("CATASTROPHIC EVENT — SAR AUTO-ACTIVATED", {
          description: result.clusterContext.preStageReason,
          duration: 10000,
        });
        // Catastrophic ALWAYS overrides existing evacuation
        const evac: ActiveEvacuation = {
          id: `EVAC-CLU-${cluster.id.split("-").pop()}`,
          zoneId: cluster.zone.replace(/\s+/g, "-").toUpperCase(),
          zoneName: cluster.zone,
          triggeredAt: Date.now(),
          triggeredBy: "System (Catastrophic Cluster)",
          reason: `Catastrophic event: ${cluster.affectedCount} simultaneous SOS in ${cluster.zone}`,
          expectedDuration: 60,
          status: "active",
        };
        triggerEvacuation(evac);
        toast.error("ZONE EVACUATION TRIGGERED", {
          description: `${cluster.zone} — auto-evacuated due to catastrophic cluster`,
          duration: 8000,
        });
      }

      // ── Mass Casualty: Auto-trigger zone lockdown/evacuation ──
      if (cluster.level === "mass_casualty") {
        clusterAutoActionsRef.current.add(cluster.id);
        if (canEvacuate) {
          const evac: ActiveEvacuation = {
            id: `EVAC-CLU-${cluster.id.split("-").pop()}`,
            zoneId: cluster.zone.replace(/\s+/g, "-").toUpperCase(),
            zoneName: cluster.zone,
            triggeredAt: Date.now(),
            triggeredBy: "System (Mass Casualty Cluster)",
            reason: `Mass casualty: ${cluster.affectedCount} simultaneous SOS in ${cluster.zone}`,
            expectedDuration: 30,
            status: "active",
          };
          triggerEvacuation(evac);
          toast.warning("ZONE LOCKDOWN ACTIVATED", {
            description: `${cluster.zone} — entry restricted, ${cluster.affectedCount} workers affected`,
            duration: 6000,
          });
        } else {
          toast.warning(`${cluster.zone} — Mass Casualty Detected`, {
            description: `Evacuation already active for ${existingEvac?.zoneName || "another zone"}. Manual action required.`,
            duration: 6000,
          });
        }
      }
    }
  }, [clusters]);

  // ── Admin Overload Detection ──
  const ownedClusterCount = clusters.filter(c =>
    c.emergencyIds.some(eid => emgList.find(e => e.id === eid)?.owner?.name === "Current User")
  ).length;

  // Find which cluster an emergency belongs to
  const getClusterForEmg = (emgId: string): ZoneCluster | undefined =>
    clusters.find(c => c.emergencyIds.includes(emgId));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? emgList.find(e => e.id === selectedId) || null : null;
  const [, setTick] = useState(0);
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(iv); }, []);
  const fmtElapsedDate = (d: Date) => { const diff = Math.floor((Date.now() - d.getTime()) / 1000); const m = Math.floor(diff / 60), s = diff % 60; if (m < 60) return `${m}m ${s}s`; const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; };
  const takeOwnership = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id) return e; const owner: EmgOwner = { name: "Current User", takenAt: new Date() }; const newStatus: EmgStatus = e.status === "active" ? "responding" : e.status; return { ...e, owner, status: newStatus, timeline: [...e.timeline, { time: new Date(), event: "Ownership Taken", actor: owner.name }] }; })); };
  const containEmg = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id || e.status !== "responding") return e; return { ...e, status: "contained" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Contained", actor: e.owner?.name || "System" }] }; })); };
  const resolveEmg = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id || e.status !== "contained") return e; return { ...e, status: "resolved" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Resolved", actor: e.owner?.name || "System" }] }; })); _onResolveParent(id); };
  const closeEmg = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id || e.status !== "resolved") return e; return { ...e, status: "closed" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Closed", actor: "Admin" }] }; })); };
  const dispatchTeam = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id) return e; return { ...e, respondersCount: e.respondersCount + 3, timeline: [...e.timeline, { time: new Date(), event: "Dispatch Team", actor: e.owner?.name || "Admin" }] }; })); };

  // ── Cluster Ownership: take ownership of ALL emergencies in a cluster at once ──
  const takeClusterOwnership = (clusterId: string) => {
    const cluster = clusters.find(c => c.id === clusterId);
    if (!cluster) return;
    setEmgList(prev => prev.map(e => {
      if (!cluster.emergencyIds.includes(e.id)) return e;
      if (e.owner) return e; // already owned
      const owner: EmgOwner = { name: "Current User", takenAt: new Date() };
      return { ...e, owner, status: "responding" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Cluster Ownership Taken", actor: owner.name }] };
    }));
    toast.success("Cluster Ownership Taken", { description: `All ${cluster.affectedCount} emergencies in ${cluster.zone} assigned to you` });
  };

  const activeCount = emgList.filter(e => !["resolved", "closed"].includes(e.status)).length;

  if (selected) {
    const sev = SEVERITY_CONFIG[selected.severity];
    const st = EMG_STATUS_CONFIG[selected.status];
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <button onClick={() => setSelectedId(null)} className="flex items-center gap-1 mb-2" style={{ fontSize: 11, fontWeight: 600, color: TOKENS.accent.primary }}>
            <ChevronLeft className="size-3.5" /> {t("emg.back")}
          </button>
          <div className="flex items-center justify-between">
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", fontFamily: "monospace", letterSpacing: 0.5 }}>{selected.id}</span>
              <p className="text-white mt-1" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{selected.title}</p>
            </div>
            <div className="text-right">
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{t("emg.elapsed")}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: sev.color, fontFamily: "monospace" }}>{fmtElapsedDate(selected.createdAt)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge color={sev.color}>{selected.severity.toUpperCase()}</Badge>
            <Badge color={st.color}>{t(st.tKey)}</Badge>
            <Badge variant="muted">{selected.zone}</Badge>
          </div>
          {/* Cluster linkage banner */}
          {(() => {
            const cl = getClusterForEmg(selected.id);
            if (!cl) return null;
            const cfg = CLUSTER_LEVEL_CONFIG[cl.level];
            const others = cl.emergencyIds.filter(id => id !== selected.id);
            return (
              <div className="mt-2 px-3 py-2 rounded-xl flex items-center gap-2" style={{ background: cfg.bgColor, border: `1px solid ${cfg.borderColor}` }}>
                <Siren className="size-3.5 shrink-0" style={{ color: cfg.color }} />
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: 9, fontWeight: 800, color: cfg.color }}>{cfg.label}</span>
                  <p className="truncate" style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
                    Linked with {others.join(", ")} — {cl.affectedCount} total SOS in {cl.zone}
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "none" }}>
          <DSCard padding={12}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{selected.description}</p>
          </DSCard>
          <DSCard padding={0} style={{ height: 140, overflow: "hidden", position: "relative" }}>
            <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0A1220 0%, #0F1B2E 100%)" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundImage: "linear-gradient(rgba(0,200,224,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,224,0.03) 1px, transparent 1px)", backgroundSize: "30px 30px", opacity: 0.4 }} />
              <div className="flex flex-col items-center gap-2 z-10">
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 2, repeat: Infinity }} className="size-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,45,85,0.15)", border: "2px solid #FF2D55" }}>
                  <Navigation className="size-5" style={{ color: "#FF2D55" }} />
                </motion.div>
              </div>
              <div className="absolute top-2 right-2 px-2 py-1 rounded-lg" style={{ background: "#0F1B2E", border: "1px solid rgba(255,255,255,0.06)", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{selected.address}</div>
              <div className="absolute bottom-2 left-2 flex gap-2">
                <span className="px-2 py-1 rounded-lg" style={{ background: "#0F1B2E", border: "1px solid rgba(255,255,255,0.06)", fontSize: 9, fontWeight: 700, color: "#FF2D55" }}>{selected.radius}m {t("emg.radius")}</span>
                <span className="px-2 py-1 rounded-lg" style={{ background: "#0F1B2E", border: "1px solid rgba(255,255,255,0.06)", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}><Users className="size-3 inline mr-1" />{selected.affectedCount} {t("emg.affected")}</span>
              </div>
            </div>
          </DSCard>
          <div className="grid grid-cols-2 gap-2">
            <DSCard padding={12} glow={selected.owner ? TOKENS.accent.primary : TOKENS.accent.warning}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{t("emg.ownership")}</div>
              {!selected.owner ? (
                <>
                  <div className="px-2 py-1.5 rounded-lg mb-2 text-center" style={{ background: "rgba(255,179,0,0.06)", border: "1px solid rgba(255,179,0,0.15)", fontSize: 10, fontWeight: 600, color: "#FFB300" }}>{t("emg.noOwner")}</div>
                  <button onClick={() => takeOwnership(selected.id)} className="w-full flex items-center justify-center gap-1 py-2 rounded-lg" style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.18)", fontSize: 10, fontWeight: 600, color: "#00C8E0" }}>
                    <UserCheck className="size-3" /> {t("emg.take")}
                  </button>
                </>
              ) : (
                <div className="px-2 py-2 rounded-lg" style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                  <p className="text-white" style={{ fontSize: 12, fontWeight: 700 }}>{selected.owner.name}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>Taken {fmtElapsedDate(selected.owner.takenAt)} ago</p>
                </div>
              )}
            </DSCard>
            <DSCard padding={12}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{t("emg.response")}</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{t("emg.affected")}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#FF2D55" }}>{selected.affectedCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{t("emg.responders")}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#00C8E0" }}>{selected.respondersCount}</span>
                </div>
              </div>
            </DSCard>
          </div>
          <DSCard padding={12}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>{t("emg.actions")}</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {[
                { icon: Send, label: t("emg.dispatch"),  color: "#8090A5", onClick: () => dispatchTeam(selected.id) },
                { icon: Bell, label: t("emg.broadcast"), color: "#4A90D9", onClick: () => { toast.success("Broadcasting Alert", { description: `Emergency broadcast sent to all workers in ${selected.zone || "all zones"}` }); } },
                { icon: Zap,  label: t("emg.escalate"),  color: "#FFB300", onClick: () => { toast.success("Escalated to Management", { description: `Emergency ${selected.id} escalated to Zone Admin & Safety Director` }); } },
              ].map(a => (
                <button key={a.label} onClick={a.onClick} className="flex flex-col items-center gap-1 py-2 rounded-lg" style={{ background: `${a.color}0A`, border: `1px solid ${a.color}1F` }}>
                  <a.icon className="size-3.5" style={{ color: a.color }} />
                  <span style={{ fontSize: 8, fontWeight: 600, color: a.color }}>{a.label}</span>
                </button>
              ))}
            </div>
            <Divider spacing={8} />
            <div className="space-y-2">
              {selected.status === "responding" && <button onClick={() => containEmg(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.18)", fontSize: 11, fontWeight: 700, color: "#34C759" }}><Shield className="size-3.5" /> {t("emg.contain")}</button>}
              {selected.status === "contained" && <button onClick={() => resolveEmg(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "linear-gradient(135deg, #00C8E0 0%, #0088A8 100%)", fontSize: 11, fontWeight: 700, color: "#fff", boxShadow: "0 4px 16px rgba(0,200,224,0.25)" }}><CheckCircle2 className="size-3.5" /> {t("emg.resolve")}</button>}
              {selected.status === "resolved" && <button onClick={() => closeEmg(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "rgba(128,144,165,0.08)", border: "1px solid rgba(128,144,165,0.18)", fontSize: 11, fontWeight: 700, color: "#8090A5" }}><XCircle className="size-3.5" /> {t("emg.closePerm")}</button>}
              {selected.status === "active" && !selected.owner && <button onClick={() => takeOwnership(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "linear-gradient(135deg, #34C759 0%, #28A745 100%)", fontSize: 11, fontWeight: 700, color: "#fff", boxShadow: "0 4px 16px rgba(52,199,89,0.25)" }}><UserCheck className="size-3.5" /> {t("emg.takeOwnership")}</button>}
              {(selected.status === "resolved" || selected.status === "closed") && (
                <button onClick={() => {
                  const emgItem: EmergencyItem = { id: selected.id, severity: selected.severity, employeeName: selected.title, zone: selected.zone, type: selected.description?.split(" ")[0] || "Emergency", timestamp: selected.createdAt, status: "resolved", elapsed: Math.floor((Date.now() - selected.createdAt.getTime()) / 1000), isOwned: !!selected.owner, ownedBy: selected.owner?.name };
                  const reportData = buildReportData(emgItem);
                  generateEmergencyLifecyclePDF(reportData);
                }} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)", fontSize: 11, fontWeight: 700, color: "#00C8E0" }}>
                  <Download className="size-3.5" /> Export Lifecycle Report (PDF)
                </button>
              )}
            </div>
          </DSCard>
          <DSCard padding={12}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>{t("emg.timeline")}</div>
            {selected.timeline.map((item, idx) => (
              <div key={idx} className="flex gap-3 items-start">
                <div className="flex flex-col items-center" style={{ width: 10 }}>
                  <div className="size-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: idx === selected.timeline.length - 1 ? "#00C8E0" : "rgba(128,144,165,0.5)" }} />
                  {idx < selected.timeline.length - 1 && <div className="w-px flex-1 mt-1" style={{ background: "rgba(255,255,255,0.04)", minHeight: 20 }} />}
                </div>
                <div className="flex-1 pb-3">
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{item.event}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{item.time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.25)" }}>{item.actor}</span>
                </div>
              </div>
            ))}
          </DSCard>
        </div>
      </div>
    );
  }

  if (webMode) {
    return (
      <div className="flex h-full" style={{ height: "calc(100vh - 56px)" }}>
        <div className="flex flex-col" style={{ width: 420, borderRight: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-3">
              <h2 className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Emergencies</h2>
              {activeCount > 0 && (
                <motion.span animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="px-2 py-0.5 rounded-full" style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "#FF2D55" }}>{activeCount} LIVE</motion.span>
              )}
            </div>
            <button onClick={onCreate} className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #FF2D55, #CC2244)", boxShadow: "0 4px 16px rgba(255,45,85,0.25)" }}>
              <Plus className="size-3.5" /> New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            {/* Zone Cluster Banner */}
            {clusters.length > 0 && (
              <div className="px-4 pt-3">
                <ZoneClusterBanner clusters={clusters} onAction={(cid, aid) => { if (aid === "deploy_team") takeClusterOwnership(cid); }} onLaunchSAR={onLaunchSAR} />
                {/* Admin Overload Warning — triggers when admin owns 2+ clusters */}
                {ownedClusterCount >= 2 && (
                  <div
                    className="mt-2 px-3 py-2.5 rounded-xl flex items-center gap-2.5"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,149,0,0.08), rgba(255,45,85,0.05))",
                      border: "1px solid rgba(255,149,0,0.2)",
                    }}
                  >
                    <div className="size-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(255,149,0,0.12)" }}>
                      <AlertTriangle className="size-3.5" style={{ color: "#FF9500" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 10, fontWeight: 800, color: "#FF9500" }}>COGNITIVE OVERLOAD RISK</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
                        You are managing {ownedClusterCount} clusters simultaneously. Consider delegating to another admin for safer response coordination.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {emgList.map(emg => {
              const sev = SEVERITY_CONFIG[emg.severity];
              const st = EMG_STATUS_CONFIG[emg.status];
              const elapsed = Math.floor((Date.now() - emg.createdAt.getTime()) / 1000);
              const isActive = !["resolved", "closed"].includes(emg.status);
              const isSelected = selectedId === emg.id;
              const clusterInfo = getClusterForEmg(emg.id);
              return (
                <button key={emg.id} onClick={() => setSelectedId(emg.id)} className="w-full text-left px-5 py-4 transition-colors"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: isSelected ? `${sev.color}08` : clusterInfo ? `${CLUSTER_LEVEL_CONFIG[clusterInfo.level].color}04` : "transparent", borderLeft: `3px solid ${isSelected ? sev.color : clusterInfo ? CLUSTER_LEVEL_CONFIG[clusterInfo.level].color : "transparent"}` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isActive && emg.status !== "contained" && <motion.div animate={{ scale: [1, 1.4, 1], opacity: [1, 0.4, 1] }} transition={{ duration: 1.2, repeat: Infinity }} className="size-2 rounded-full shrink-0" style={{ background: st.color }} />}
                        <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 700 }}>{emg.title}</p>
                      </div>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{emg.zone} · {emg.affectedCount} affected</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: sev.color, background: sev.bg }}>{emg.severity.toUpperCase()}</span>
                        <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: st.color, background: st.bg }}>{emg.status.toUpperCase()}</span>
                        {emg.owner && <span style={{ fontSize: 9, fontWeight: 600, color: "#00C853" }}>✓ Owned</span>}
                        {clusterInfo && (
                          <span className="px-2 py-0.5 rounded-md" style={{
                            fontSize: 8, fontWeight: 800,
                            color: CLUSTER_LEVEL_CONFIG[clusterInfo.level].color,
                            background: CLUSTER_LEVEL_CONFIG[clusterInfo.level].bgColor,
                            border: `1px solid ${CLUSTER_LEVEL_CONFIG[clusterInfo.level].borderColor}`,
                            letterSpacing: "0.3px",
                          }}>
                            CLUSTER {clusterInfo.emergencyIds.indexOf(emg.id) + 1}/{clusterInfo.affectedCount}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p style={{ fontSize: 16, fontWeight: 800, color: timerColor(elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>elapsed</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {!selectedId || !emgList.find(e => e.id === selectedId) ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="size-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <AlertTriangle className="size-7" style={{ color: "rgba(255,255,255,0.15)" }} />
              </div>
              <p style={{ fontSize: 15, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>Select an emergency to view details</p>
            </div>
          ) : (() => {
            const sel = emgList.find(e => e.id === selectedId)!;
            const sev = SEVERITY_CONFIG[sel.severity];
            const st = EMG_STATUS_CONFIG[sel.status];
            const elapsed = Math.floor((Date.now() - sel.createdAt.getTime()) / 1000);
            return (
              <div className="p-6 space-y-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2.5 py-1 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: sev.color, background: sev.bg }}>{sel.severity.toUpperCase()}</span>
                      <span className="px-2.5 py-1 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.bg }}>{sel.status.toUpperCase()}</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{sel.id}</span>
                    </div>
                    <h2 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>{sel.title}</h2>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{sel.zone} · {sel.address}</p>
                  </div>
                  <div className="text-right">
                    <p style={{ fontSize: 32, fontWeight: 800, color: timerColor(elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>response time</p>
                  </div>
                </div>
                {/* Cluster Linkage Banner — web detail */}
                {(() => {
                  const cl = getClusterForEmg(sel.id);
                  if (!cl) return null;
                  const cfg = CLUSTER_LEVEL_CONFIG[cl.level];
                  const others = cl.emergencyIds.filter(id => id !== sel.id);
                  return (
                    <div className="px-4 py-3 rounded-xl flex items-center gap-3" style={{ background: cfg.bgColor, border: `1px solid ${cfg.borderColor}` }}>
                      <Siren className="size-5 shrink-0" style={{ color: cfg.color }} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize: 11, fontWeight: 800, color: cfg.color }}>{cfg.label}</span>
                          <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: cfg.color }}>{cl.affectedCount} SOS</span>
                        </div>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                          This emergency is part of a zone cluster with {others.join(", ")} in {cl.zone}. Unified response recommended.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {(cl.level === "mass_casualty" || cl.level === "catastrophic") && (
                          <button
                            onClick={() => {
                              activateClusterSAR(cl);
                              toast.success("SAR Protocol Activated", { description: `Mission pre-staged for ${cl.affectedCount} workers in ${cl.zone}` });
                              onLaunchSAR?.();
                            }}
                            className="px-3 py-2 rounded-lg flex items-center gap-1.5"
                            style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #FF2D55, #FF6B35)", boxShadow: "0 0 10px rgba(255,45,85,0.3)" }}
                          >
                            <Radar className="size-3.5" />
                            SAR
                          </button>
                        )}
                        <button
                          onClick={() => takeClusterOwnership(cl.id)}
                          className="px-3 py-2 rounded-lg"
                          style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: cfg.color }}
                        >
                          Own All ({cl.affectedCount})
                        </button>
                      </div>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Affected",   value: sel.affectedCount,  color: "#FF2D55" },
                    { label: "Responders", value: sel.respondersCount, color: "#00C8E0" },
                    { label: "Radius",     value: `${sel.radius}m`,   color: "#FF9500" },
                    { label: "Owner",      value: sel.owner ? sel.owner.name.split(" ")[0] : "None", color: sel.owner ? "#00C853" : "rgba(255,255,255,0.3)" },
                  ].map(s => (
                    <div key={s.label} className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <p style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.65 }}>{sel.description}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {sel.status === "active" && !sel.owner && <button onClick={() => takeOwnership(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, #34C759, #28A745)", fontSize: 14, fontWeight: 700, color: "#fff", boxShadow: "0 4px 20px rgba(52,199,89,0.3)" }}><UserCheck className="size-4" /> Take Ownership</button>}
                  {sel.status === "responding" && <button onClick={() => containEmg(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, #00C8E0, #0088A8)", fontSize: 14, fontWeight: 700, color: "#fff", boxShadow: "0 4px 20px rgba(0,200,224,0.3)" }}><Shield className="size-4" /> Mark Contained</button>}
                  {sel.status === "contained" && <button onClick={() => resolveEmg(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, #00C853, #009940)", fontSize: 14, fontWeight: 700, color: "#fff", boxShadow: "0 4px 20px rgba(0,200,83,0.3)" }}><CheckCircle2 className="size-4" /> Resolve</button>}
                  {sel.status === "resolved" && <button onClick={() => closeEmg(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "rgba(128,144,165,0.1)", border: "1px solid rgba(128,144,165,0.2)", fontSize: 14, fontWeight: 700, color: "#8090A5" }}><XCircle className="size-4" /> Close Permanently</button>}
                  {(sel.status === "resolved" || sel.status === "closed") && (
                    <button onClick={() => {
                      const emgItem: EmergencyItem = { id: sel.id, severity: sel.severity, employeeName: sel.title, zone: sel.zone, type: sel.description?.split(" — ")[0] || "Emergency", timestamp: sel.createdAt, status: "resolved", elapsed: Math.floor((Date.now() - sel.createdAt.getTime()) / 1000), isOwned: !!sel.owner, ownedBy: sel.owner?.name };
                      generateEmergencyLifecyclePDF(buildReportData(emgItem));
                    }} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.1), rgba(123,94,255,0.06))", border: "1px solid rgba(0,200,224,0.15)", fontSize: 14, fontWeight: 700, color: "#00C8E0", boxShadow: "0 4px 16px rgba(0,200,224,0.08)" }}>
                      <Download className="size-4" /> Export Lifecycle Report
                    </button>
                  )}
                  {[{ icon: Send, label: "Dispatch Team", color: "#FF9500", onClick: () => dispatchTeam(sel.id) }, { icon: Bell, label: "Broadcast", color: "#7B5EFF", onClick: () => { toast.success("Broadcasting Alert", { description: `Emergency broadcast sent to all workers in ${sel.zone || "all zones"}` }); } }, { icon: Zap, label: "Escalate", color: "#FF2D55", onClick: () => { toast.success("Escalated", { description: `Emergency ${sel.id} escalated to Zone Admin & Safety Director` }); } }].map(a => (
                    <button key={a.label} onClick={a.onClick} className="flex items-center gap-2 px-4 py-3 rounded-xl" style={{ background: `${a.color}10`, border: `1px solid ${a.color}20`, fontSize: 13, fontWeight: 600, color: a.color }}>
                      <a.icon className="size-4" /> {a.label}
                    </button>
                  ))}
                </div>
                <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}><p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Incident Timeline</p></div>
                  <div className="px-5 py-4">
                    {sel.timeline.map((item, idx) => (
                      <div key={idx} className="flex gap-4 items-start mb-4 last:mb-0">
                        <div className="flex flex-col items-center" style={{ width: 12 }}>
                          <div className="size-2.5 rounded-full mt-1 shrink-0" style={{ background: idx === sel.timeline.length - 1 ? "#00C8E0" : "rgba(255,255,255,0.15)" }} />
                          {idx < sel.timeline.length - 1 && <div className="w-px flex-1 mt-1.5" style={{ background: "rgba(255,255,255,0.06)", minHeight: 24 }} />}
                        </div>
                        <div className="flex-1 flex items-start justify-between">
                          <div>
                            <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{item.event}</p>
                            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{item.actor}</p>
                          </div>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontVariantNumeric: "tabular-nums" }}>{item.time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="danger" pulse={activeCount > 0}>{activeCount} {t("emg.active")}</Badge>
          {emgList.some(e => !["resolved", "closed"].includes(e.status) && (Date.now() - e.createdAt.getTime()) / 1000 >= SLA_THRESHOLD) && <Badge variant="warning">SLA</Badge>}
        </div>
        <DSButton variant="danger" size="sm" icon={Plus} onClick={onCreate}>{t("b.create")}</DSButton>
      </div>
      {/* Zone Cluster Banner — mobile */}
      <ZoneClusterBanner clusters={clusters} onAction={(cid, aid) => { if (aid === "deploy_team") takeClusterOwnership(cid); }} onLaunchSAR={onLaunchSAR} />
      <div className="space-y-2">
        {emgList.map(emg => {
          const sev = SEVERITY_CONFIG[emg.severity];
          const st = EMG_STATUS_CONFIG[emg.status];
          const elapsed = Math.floor((Date.now() - emg.createdAt.getTime()) / 1000);
          const clusterInfo = getClusterForEmg(emg.id);
          return (
            <motion.div key={emg.id} layout onClick={() => setSelectedId(emg.id)}
              className="rounded-xl overflow-hidden cursor-pointer" whileTap={{ scale: 0.98 }}
              style={{ background: emg.status === "active" ? `${sev.color}06` : "rgba(255,255,255,0.02)", border: `1px solid ${emg.status === "active" ? `${sev.color}15` : "rgba(255,255,255,0.04)"}` }}>
              <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${sev.color}10` }}>
                {(emg.status === "active" || emg.status === "new") && <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1, repeat: Infinity }} className="size-2 rounded-full" style={{ background: st.color }} />}
                <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{emg.id}</span>
                {emg.owner && <Badge variant="success" size="sm">{t("emg.owned")}</Badge>}
                {clusterInfo && (
                  <span className="px-1.5 py-0.5 rounded-md" style={{
                    fontSize: 8, fontWeight: 800,
                    color: CLUSTER_LEVEL_CONFIG[clusterInfo.level].color,
                    background: CLUSTER_LEVEL_CONFIG[clusterInfo.level].bgColor,
                    border: `1px solid ${CLUSTER_LEVEL_CONFIG[clusterInfo.level].borderColor}`,
                  }}>
                    CLUSTER {clusterInfo.emergencyIds.indexOf(emg.id) + 1}/{clusterInfo.affectedCount}
                  </span>
                )}
                <span style={{ marginLeft: "auto" }}><Badge color={st.color}>{t(st.tKey)}</Badge></span>
              </div>
              <div className="px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{emg.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge color={sev.color}>{emg.severity.toUpperCase()}</Badge>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{emg.zone}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>·</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}><Users className="size-2.5 inline mr-0.5" />{emg.affectedCount}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <span style={{ fontSize: 14, fontWeight: 800, color: timerColor(elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-end mt-1.5">
                  <span className="flex items-center gap-0.5" style={{ fontSize: 9, color: "#00C8E0", fontWeight: 500 }}>{t("emg.viewDetails")} <ChevronRight className="size-3" /></span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Zones Page
// ═══════════════════════════════════════════════════════════════
export function ZonesPage({ zones, t, webMode = false }: { zones: ZoneData[]; t: (k: string) => string; webMode?: boolean }) {
  const [selectedZone, setSelectedZone] = useState<ZoneData | null>(null);
  const storeEmployees = useDashboardStore(s => s.employees);
  const totalEmps = zones.reduce((s, z) => s + z.employees, 0);
  const totalAlerts = zones.reduce((s, z) => s + z.activeAlerts, 0);

  if (selectedZone) {
    const riskColor = selectedZone.risk === "high" ? "#FF2D55" : selectedZone.risk === "medium" ? "#FF9500" : "#00C853";
    const statusColor = selectedZone.status === "evacuated" ? "#FF2D55" : selectedZone.status === "restricted" ? "#FF9500" : "#00C853";
    const zoneEmployees = storeEmployees.filter(e => e.location.includes(selectedZone.name.split(" - ")[0]));
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <button onClick={() => setSelectedZone(null)} className="flex items-center gap-1 mb-2" style={{ fontSize: 11, fontWeight: 600, color: TOKENS.accent.primary }}>
            <ChevronLeft className="size-3.5" /> {t("zone.back")}
          </button>
          <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>{selectedZone.name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge color={riskColor}>{selectedZone.risk.toUpperCase()} {t("zone.risk")}</Badge>
            <Badge color={statusColor}>{selectedZone.status.toUpperCase()}</Badge>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "none" }}>
          <DSCard padding={0} style={{ height: 120, overflow: "hidden", position: "relative" }}>
            <div className="w-full h-full" style={{ background: "linear-gradient(135deg, #0A1220 0%, #0F1B2E 100%)" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundImage: "linear-gradient(rgba(0,200,224,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,224,0.03) 1px, transparent 1px)", backgroundSize: "25px 25px", opacity: 0.4 }} />
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 120">
                <polygon points="80,20 320,15 340,100 60,105" fill={`${riskColor}15`} stroke={riskColor} strokeWidth="1.5" strokeDasharray="4 2" />
                <circle cx="200" cy="60" r="4" fill={riskColor}><animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite" /></circle>
              </svg>
              <div className="absolute top-2 right-2 px-2 py-1 rounded-lg" style={{ background: "#0F1B2E", border: "1px solid rgba(255,255,255,0.06)", fontSize: 9, fontWeight: 700, color: riskColor }}>{selectedZone.employees} {t("zone.personnel")}</div>
            </div>
          </DSCard>
          <div className="grid grid-cols-3 gap-2">
            <DSCard padding={10} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#00C8E0" }}>{selectedZone.employees}</div>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", fontWeight: 600 }}>{t("zone.employees")}</div>
            </DSCard>
            <DSCard padding={10} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: selectedZone.activeAlerts > 0 ? "#FF2D55" : "#00C853" }}>{selectedZone.activeAlerts}</div>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", fontWeight: 600 }}>{t("zone.alerts")}</div>
            </DSCard>
            <DSCard padding={10} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: riskColor }}>{selectedZone.risk.toUpperCase()}</div>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", fontWeight: 600 }}>{t("zone.riskLevel")}</div>
            </DSCard>
          </div>
          <DSCard padding={12}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>{t("zone.personnelInZone")}</div>
            {zoneEmployees.length > 0 ? zoneEmployees.map(emp => {
              const sc = STATUS_CONFIG[emp.status];
              return (
                <div key={emp.id} className="flex items-center gap-2.5 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <div className="size-6 rounded-full flex items-center justify-center" style={{ background: `${sc.color}15` }}>
                    <User className="size-3" style={{ color: sc.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white truncate" style={{ fontSize: 11, fontWeight: 600 }}>{emp.name}</p>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>{emp.role}</p>
                  </div>
                  <Badge color={sc.color}>{t(sc.tKey)}</Badge>
                </div>
              );
            }) : <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", padding: "8px 0" }}>{t("zone.noEmployees")}</p>}
          </DSCard>
        </div>
      </div>
    );
  }

  if (webMode) {
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>Zone Management</h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{zones.length} monitored zones · {totalEmps} total personnel</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Zones",      value: zones.length,                                     color: "#00C8E0", sub: "Monitored" },
            { label: "High Risk",         value: zones.filter(z => z.risk === "high").length,      color: "#FF2D55", sub: "Immediate attention" },
            { label: "Total Personnel",   value: totalEmps,                                        color: "#00C853", sub: "Across all zones" },
            { label: "Active Alerts",     value: totalAlerts, color: totalAlerts > 0 ? "#FF9500" : "#00C853", sub: totalAlerts > 0 ? "Unresolved" : "All clear" },
          ].map((k, i) => (
            <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
              className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p style={{ fontSize: 30, fontWeight: 800, color: k.color }}>{k.value}</p>
              <p className="text-white mt-1" style={{ fontSize: 13, fontWeight: 600 }}>{k.label}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{k.sub}</p>
            </motion.div>
          ))}
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {zones.map((zone, i) => {
            const rc = zone.risk === "high" ? "#FF2D55" : zone.risk === "medium" ? "#FF9500" : "#00C853";
            const sc = zone.status === "evacuated" ? "#FF2D55" : zone.status === "restricted" ? "#FF9500" : "#00C853";
            const zoneEmps = storeEmployees.filter(e => e.location.includes(zone.name.split(" - ")[0]));
            return (
              <motion.div key={zone.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.07 }}
                className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${rc}20` }}>
                <div className="relative" style={{ height: 120, background: "linear-gradient(135deg, #0A1220, #0D1829)" }}>
                  <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(0,200,224,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,224,0.03) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 340 120">
                    <polygon points="60,20 280,15 300,100 40,105" fill={`${rc}12`} stroke={rc} strokeWidth="1.5" strokeDasharray="5 3" />
                    <circle cx="170" cy="62" r="5" fill={rc}><animate attributeName="r" values="5;10;5" dur="2s" repeatCount="indefinite" /></circle>
                    {zoneEmps.slice(0, 4).map((e, j) => <circle key={e.id} cx={90 + j * 55} cy={55 + (j % 2 === 0 ? -8 : 8)} r="6" fill={`${rc}30`} stroke={rc} strokeWidth="1" />)}
                  </svg>
                  <div className="absolute top-2.5 left-3 px-2.5 py-1 rounded-lg" style={{ background: "rgba(5,7,14,0.85)", backdropFilter: "blur(8px)", border: `1px solid ${rc}25` }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: rc }}>{zone.name.split(" - ")[0]}</span>
                  </div>
                  {zone.activeAlerts > 0 && <div className="absolute top-2.5 right-3 px-2 py-1 rounded-lg" style={{ background: "rgba(255,45,85,0.15)", border: "1px solid rgba(255,45,85,0.3)" }}><span style={{ fontSize: 10, fontWeight: 800, color: "#FF2D55" }}>⚠ {zone.activeAlerts}</span></div>}
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>{zone.name}</p>
                      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{zone.name.split(" - ")[1] || ""}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="px-2 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 700, color: rc, background: `${rc}12` }}>{zone.risk.toUpperCase()} RISK</span>
                      <span className="px-2 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 700, color: sc, background: `${sc}12` }}>{zone.status.toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12 }}>
                    <div className="flex items-center gap-2">
                      <Users className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{zone.employees} workers</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-3.5" style={{ color: zone.activeAlerts > 0 ? "#FF2D55" : "rgba(255,255,255,0.2)" }} />
                      <span style={{ fontSize: 12, color: zone.activeAlerts > 0 ? "#FF2D55" : "rgba(255,255,255,0.35)" }}>{zone.activeAlerts} alerts</span>
                    </div>
                    {zoneEmps.length > 0 && (
                      <div className="ml-auto flex -space-x-2">
                        {zoneEmps.slice(0, 3).map((e, j) => <div key={j} className="size-6 rounded-full flex items-center justify-center" style={{ background: `${rc}20`, border: "1.5px solid #05070E" }}><span style={{ fontSize: 8, fontWeight: 800, color: rc }}>{e.name[0]}</span></div>)}
                        {zoneEmps.length > 3 && <div className="size-6 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)", border: "1.5px solid #05070E", fontSize: 8, color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>+{zoneEmps.length - 3}</div>}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        <DSCard padding={8} style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: "#00C8E0" }}>{zones.length}</div><div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{t("zone.zones")}</div></DSCard>
        <DSCard padding={8} style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: "#FF2D55" }}>{zones.filter(z => z.risk === "high").length}</div><div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{t("zone.highRisk")}</div></DSCard>
        <DSCard padding={8} style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: "#00C853" }}>{totalEmps}</div><div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{t("zone.personnel")}</div></DSCard>
        <DSCard padding={8} style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: totalAlerts > 0 ? "#FF2D55" : "#00C853" }}>{totalAlerts}</div><div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{t("zone.alerts")}</div></DSCard>
      </div>
      <DSCard padding={0} style={{ height: 100, overflow: "hidden", position: "relative" }}>
        <div className="w-full h-full" style={{ background: "linear-gradient(135deg, #0A1220 0%, #0F1B2E 100%)" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundImage: "linear-gradient(rgba(0,200,224,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,224,0.03) 1px, transparent 1px)", backgroundSize: "20px 20px", opacity: 0.3 }} />
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 100">
            {zones.map((z, i) => { const rc = z.risk === "high" ? "#FF2D55" : z.risk === "medium" ? "#FF9500" : "#00C853"; const cx = 60 + i * 70; const cy = 50; return <g key={z.id}><circle cx={cx} cy={cy} r={16} fill={`${rc}20`} stroke={rc} strokeWidth="1" /><text x={cx} y={cy + 3} textAnchor="middle" fill={rc} fontSize="8" fontWeight="700">{z.name.split(" ")[1]}</text></g>; })}
          </svg>
        </div>
      </DSCard>
      <div className="space-y-2">
        {zones.map(zone => {
          const riskColor = zone.risk === "high" ? "#FF2D55" : zone.risk === "medium" ? "#FF9500" : "#00C853";
          const statusColor = zone.status === "evacuated" ? "#FF2D55" : zone.status === "restricted" ? "#FF9500" : "#00C853";
          return (
            <DSCard key={zone.id} padding={12} onClick={() => setSelectedZone(zone)} glow={zone.risk === "high" ? riskColor : undefined} style={{ cursor: "pointer" }}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: `${riskColor}12` }}><MapPin className="size-4" style={{ color: riskColor }} /></div>
                <div className="flex-1">
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{zone.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge color={riskColor}>{zone.risk.toUpperCase()} {t("zone.risk")}</Badge>
                    <Badge color={statusColor}>{zone.status.toUpperCase()}</Badge>
                  </div>
                </div>
                <ChevronRight className="size-3.5" style={{ color: "rgba(255,255,255,0.15)" }} />
              </div>
              <div className="flex items-center gap-4 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-1"><Users className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} /><span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{zone.employees} {t("zone.employees")}</span></div>
                <div className="flex items-center gap-1"><AlertTriangle className="size-3" style={{ color: zone.activeAlerts > 0 ? "#FF2D55" : "rgba(255,255,255,0.15)" }} /><span style={{ fontSize: 10, color: zone.activeAlerts > 0 ? "#FF2D55" : "rgba(255,255,255,0.3)" }}>{zone.activeAlerts} {t("zone.alerts")}</span></div>
              </div>
            </DSCard>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Incident History Page
// ═══════════════════════════════════════════════════════════════
export function IncidentHistoryPage({ t, webMode = false }: { t: (k: string) => string; webMode?: boolean }) {
  const incidents = [
    { id: "INC-2026-031", type: "SOS Trigger",      employee: "Mohammed Ali", zone: "Zone D", date: "Mar 7, 2026",  severity: "critical" as const, resolved: false, responseTime: "1m 12s", escalations: 2, timeline: [{ time: "09:15", event: "SOS triggered", actor: "Mohammed Ali" }, { time: "09:16", event: "Alert sent to supervisor", actor: "System" }] },
    { id: "INC-2026-030", type: "Geofence Breach",   employee: "Unknown",      zone: "Zone B", date: "Mar 7, 2026",  severity: "medium"   as const, resolved: false, responseTime: "—",      escalations: 0, timeline: [{ time: "08:45", event: "Geofence breach detected", actor: "System" }] },
    { id: "INC-2026-029", type: "Missed Check-in",   employee: "Khalid Omar",  zone: "Zone A", date: "Mar 6, 2026",  severity: "high"     as const, resolved: true,  responseTime: "4m 30s", escalations: 1, timeline: [{ time: "14:00", event: "Check-in missed", actor: "System" }, { time: "14:02", event: "SMS reminder sent", actor: "System" }, { time: "14:04", event: "Employee responded", actor: "Khalid Omar" }] },
    { id: "INC-2026-028", type: "Fall Detection",    employee: "Ahmed Khalil", zone: "Zone C", date: "Mar 5, 2026",  severity: "critical" as const, resolved: true,  responseTime: "0m 45s", escalations: 3, timeline: [{ time: "11:30", event: "Fall detected by wearable", actor: "System" }, { time: "11:30", event: "Emergency alert broadcast", actor: "System" }, { time: "11:31", event: "Medical team dispatched", actor: "Fatima Hassan" }, { time: "11:35", event: "Patient stabilized", actor: "Medical Team" }] },
    { id: "INC-2026-027", type: "Gas Leak Alert",    employee: "System",       zone: "Zone D", date: "Mar 4, 2026",  severity: "high"     as const, resolved: true,  responseTime: "2m 15s", escalations: 2, timeline: [{ time: "16:20", event: "Gas sensor threshold exceeded", actor: "IoT Sensor" }, { time: "16:21", event: "Zone D evacuation initiated", actor: "System" }, { time: "16:25", event: "All personnel cleared", actor: "Omar Al-Farsi" }] },
    { id: "INC-2026-026", type: "Fire Alarm",        employee: "Lina Chen",   zone: "Zone C", date: "Mar 3, 2026",  severity: "critical" as const, resolved: true,  responseTime: "1m 50s", escalations: 3, timeline: [{ time: "10:00", event: "Smoke detector activated", actor: "Fire System" }, { time: "10:01", event: "Fire suppression engaged", actor: "System" }, { time: "10:03", event: "Evacuation complete", actor: "Safety Team" }] },
  ];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const filtered = incidents.filter(inc => {
    const matchSev = sevFilter === "all" || inc.severity === sevFilter;
    const matchStatus = statusFilter === "all" || (statusFilter === "active" ? !inc.resolved : inc.resolved);
    return matchSev && matchStatus;
  });

  if (webMode) {
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>Incident History</h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>All recorded safety incidents and events</p>
          </div>
          <div className="flex items-center gap-2">
            {[{ id: "all", l: "All" }, { id: "critical", l: "Critical" }, { id: "high", l: "High" }, { id: "medium", l: "Medium" }].map(f => (
              <button key={f.id} onClick={() => setSevFilter(f.id)} className="px-3 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: sevFilter === f.id ? 700 : 500, background: sevFilter === f.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", color: sevFilter === f.id ? "#00C8E0" : "rgba(255,255,255,0.4)", border: sevFilter === f.id ? "1px solid rgba(0,200,224,0.25)" : "1px solid rgba(255,255,255,0.06)" }}>{f.l}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[{ label: "This Week", value: "12", color: "#00C8E0", sub: "Total incidents" }, { label: "Resolved", value: "9", color: "#00C853", sub: "75% resolution rate" }, { label: "Avg Response", value: "2.4m", color: "#FF9500", sub: "Time to respond" }, { label: "Escalations", value: "11", color: "#FF2D55", sub: "Escalated to mgmt" }].map((k, i) => (
            <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p style={{ fontSize: 30, fontWeight: 800, color: k.color }}>{k.value}</p>
              <p className="text-white mt-1" style={{ fontSize: 13, fontWeight: 600 }}>{k.label}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{k.sub}</p>
            </motion.div>
          ))}
        </div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="grid px-5 py-3" style={{ gridTemplateColumns: "120px 1fr 140px 120px 100px 90px 80px", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {["ID", "Type", "Employee", "Zone", "Date", "Response", "Status"].map(h => <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{h}</span>)}
          </div>
          {filtered.map((inc, i) => {
            const cfg = SEVERITY_CONFIG[inc.severity];
            const SevIcon = cfg.icon;
            const isExpanded = expandedId === inc.id;
            return (
              <div key={inc.id}>
                <motion.div layout onClick={() => setExpandedId(isExpanded ? null : inc.id)} className="grid items-center px-5 py-4 cursor-pointer group"
                  style={{ gridTemplateColumns: "120px 1fr 140px 120px 100px 90px 80px", borderBottom: "1px solid rgba(255,255,255,0.03)", background: isExpanded ? `${cfg.color}05` : "transparent" }}
                  whileHover={{ background: "rgba(255,255,255,0.025)" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>{inc.id}</span>
                  <div className="flex items-center gap-2"><div className="size-7 rounded-lg flex items-center justify-center" style={{ background: cfg.bg }}><SevIcon className="size-3.5" style={{ color: cfg.color }} /></div><span className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{inc.type}</span></div>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{inc.employee}</span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{inc.zone}</span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{inc.date.split(",")[0]}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#00C8E0" }}>{inc.responseTime}</span>
                  <span className="px-2.5 py-1 rounded-lg text-center" style={{ fontSize: 10, fontWeight: 700, color: inc.resolved ? "#00C853" : "#FF9500", background: inc.resolved ? "rgba(0,200,83,0.1)" : "rgba(255,149,0,0.1)" }}>{inc.resolved ? "Resolved" : "Active"}</span>
                </motion.div>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: `${cfg.color}03` }}>
                      <div className="px-5 py-4 flex gap-6">
                        <div>
                          <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "1px", marginBottom: 8 }}>TIMELINE</p>
                          <div className="space-y-2">
                            {inc.timeline.map((ev, j) => (
                              <div key={j} className="flex items-center gap-3">
                                <span style={{ fontSize: 11, color: "#00C8E0", fontVariantNumeric: "tabular-nums", minWidth: 40 }}>{ev.time}</span>
                                <div className="size-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
                                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{ev.event}</span>
                                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>by {ev.actor}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="ml-auto flex items-start gap-2">
                          <span className="px-3 py-1.5 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: cfg.color, background: cfg.bg }}>{inc.severity.toUpperCase()}</span>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{inc.escalations} escalation{inc.escalations !== 1 ? "s" : ""}</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        {[{ label: t("inc.thisWeek"), value: "12", color: "#00C8E0" }, { label: t("inc.resolved"), value: "9", color: "#00C853" }, { label: t("inc.avgResp"), value: "2.4m", color: "#FF9500" }, { label: t("inc.escalations"), value: "11", color: "#FF2D55" }].map(s => (
          <DSCard key={s.label} padding={8} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{s.label}</div>
          </DSCard>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {[{ id: "all", label: t("inc.all") }, { id: "active", label: t("inc.active") }, { id: "resolved", label: t("inc.resolved") }].map(f => (
          <button key={f.id} onClick={() => setStatusFilter(f.id)} className="px-2.5 py-1 rounded-lg whitespace-nowrap"
            style={{ fontSize: 10, fontWeight: 500, background: statusFilter === f.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)", color: statusFilter === f.id ? "#00C8E0" : "rgba(255,255,255,0.35)", border: `1px solid ${statusFilter === f.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}` }}>{f.label}</button>
        ))}
        <div style={{ width: 1, background: "rgba(255,255,255,0.06)", margin: "2px 4px" }} />
        {(["all", "critical", "high", "medium", "low"] as const).map(s => (
          <button key={s} onClick={() => setSevFilter(s)} className="px-2.5 py-1 rounded-lg whitespace-nowrap"
            style={{ fontSize: 10, fontWeight: 500, background: sevFilter === s ? `${s === "all" ? "#00C8E0" : SEVERITY_CONFIG[s].color}15` : "rgba(255,255,255,0.02)", color: sevFilter === s ? (s === "all" ? "#00C8E0" : SEVERITY_CONFIG[s].color) : "rgba(255,255,255,0.25)", border: `1px solid ${sevFilter === s ? `${s === "all" ? "#00C8E0" : SEVERITY_CONFIG[s].color}25` : "rgba(255,255,255,0.04)"}` }}>
            {s === "all" ? t("inc.allSev") : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {filtered.map(inc => {
          const config = SEVERITY_CONFIG[inc.severity];
          const isExpanded = expandedId === inc.id;
          return (
            <motion.div key={inc.id} layout className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${isExpanded ? `${config.color}15` : "rgba(255,255,255,0.04)"}` }}>
              <div className="p-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : inc.id)}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 10, fontWeight: 700, color: config.color, fontFamily: "monospace" }}>{inc.id}</span>
                    <Badge color={config.color}>{inc.severity.toUpperCase()}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {inc.resolved ? <Badge variant="success" size="sm">Resolved</Badge> : <Badge variant="danger" size="sm" pulse>Active</Badge>}
                    <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}><ChevronDown className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} /></motion.div>
                  </div>
                </div>
                <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{inc.type}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{inc.employee}</span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.1)" }}>·</span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{inc.zone}</span>
                  <span className="ml-auto" style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>{inc.date}</span>
                </div>
              </div>
              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                    <div className="px-3 pb-3 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="px-2 py-1.5 rounded-lg" style={{ background: "rgba(0,200,224,0.04)" }}><span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{t("inc.responseTime")}</span><p style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>{inc.responseTime}</p></div>
                        <div className="px-2 py-1.5 rounded-lg" style={{ background: "rgba(255,45,85,0.04)" }}><span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{t("inc.escalations")}</span><p style={{ fontSize: 12, fontWeight: 700, color: inc.escalations > 1 ? "#FF2D55" : "#FF9500" }}>{inc.escalations}</p></div>
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 6 }}>{t("inc.escalationTimeline")}</div>
                      {inc.timeline.map((tl, idx) => (
                        <div key={idx} className="flex gap-2.5 items-start">
                          <div className="flex flex-col items-center" style={{ width: 8 }}>
                            <div className="size-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: idx === inc.timeline.length - 1 ? "#00C8E0" : "rgba(128,144,165,0.5)" }} />
                            {idx < inc.timeline.length - 1 && <div className="w-px flex-1 mt-0.5" style={{ background: "rgba(255,255,255,0.04)", minHeight: 12 }} />}
                          </div>
                          <div className="flex-1 pb-1.5">
                            <div className="flex items-center justify-between">
                              <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.6)" }}>{tl.event}</span>
                              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{tl.time}</span>
                            </div>
                            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{tl.actor}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Attendance Page
// ═══════════════════════════════════════════════════════════════
export function AttendancePage({ employees, t, webMode = false }: { employees: Employee[]; t: (k: string) => string; webMode?: boolean }) {
  const [viewMode, setViewMode] = useState<"list" | "zone">("list");
  const present = employees.filter(e => e.status === "on-shift" || e.status === "checked-in");
  const late = employees.filter(e => e.status === "late-checkin");
  const offShift = employees.filter(e => e.status === "off-shift");
  const sos = employees.filter(e => e.status === "sos");
  // FIX 2: Attendance = present / scheduled (excludes off-shift from denominator)
  const totalScheduled = employees.length - offShift.length;
  const presentCount = present.length + sos.length;
  const attendanceRate = totalScheduled > 0 ? Math.round((presentCount / totalScheduled) * 100) : 0;
  const zoneMap = new Map<string, { total: number; present: number; late: number }>();
  employees.forEach(e => {
    const zone = e.location === "—" ? t("att.offSite") : e.location.split(" - ")[0];
    const z = zoneMap.get(zone) || { total: 0, present: 0, late: 0 };
    z.total++;
    if (e.status === "on-shift" || e.status === "checked-in" || e.status === "sos") z.present++;
    if (e.status === "late-checkin") z.late++;
    zoneMap.set(zone, z);
  });

  if (webMode) {
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>Attendance</h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>Real-time check-in status · Today, {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}>
            <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 2, repeat: Infinity }} className="size-2 rounded-full" style={{ background: "#00C853" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#00C853" }}>Live Tracking Active</span>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Present",      value: present.length + sos.length, color: "#00C853", sub: `${attendanceRate}% attendance rate`, icon: UserCheck },
            { label: "Late Check-in",value: late.length,                  color: "#FF9500", sub: "Overdue by 30+ min",                icon: Clock },
            { label: "Off Shift",    value: offShift.length,              color: "rgba(255,255,255,0.35)", sub: "Not scheduled today", icon: Users },
            { label: "SOS Active",   value: sos.length, color: sos.length > 0 ? "#FF2D55" : "#00C853", sub: sos.length > 0 ? "Needs immediate response" : "None active", icon: AlertTriangle },
          ].map((k, i) => {
            const Icon = k.icon;
            return (
              <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="size-9 rounded-xl flex items-center justify-center mb-3" style={{ background: `${k.color}12`, border: `1px solid ${k.color}20` }}><Icon className="size-5" style={{ color: k.color }} /></div>
                <p style={{ fontSize: 30, fontWeight: 800, color: k.color }}>{k.value}</p>
                <p className="text-white mt-1" style={{ fontSize: 13, fontWeight: 600 }}>{k.label}</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{k.sub}</p>
              </motion.div>
            );
          })}
        </div>
        <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 320px" }}>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}><p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Check-in Status</p></div>
            <div className="grid px-5 py-3" style={{ gridTemplateColumns: "48px 1fr 140px 160px 80px", background: "rgba(255,255,255,0.015)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {["", "Employee", "Department", "Location", "Status"].map(h => <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.22)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{h}</span>)}
            </div>
            {employees.map((emp, i) => {
              const statusColor = emp.status === "sos" ? "#FF2D55" : emp.status === "late-checkin" ? "#FF9500" : emp.status === "on-shift" || emp.status === "checked-in" ? "#00C853" : "rgba(255,255,255,0.2)";
              const statusLabel = emp.status === "sos" ? "SOS" : emp.status === "late-checkin" ? "Late" : emp.status === "on-shift" ? "On Shift" : emp.status === "checked-in" ? "Checked In" : "Off Shift";
              return (
                <div key={emp.id} className="grid items-center px-5 py-3.5" style={{ gridTemplateColumns: "48px 1fr 140px 160px 80px", borderBottom: i < employees.length - 1 ? "1px solid rgba(255,255,255,0.025)" : "none" }}>
                  <div className="size-8 rounded-full flex items-center justify-center" style={{ background: `${statusColor}18`, border: `1.5px solid ${statusColor}30` }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: statusColor }}>{emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                  </div>
                  <div><p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</p><p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{emp.lastCheckin}</p></div>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{emp.department}</p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }} className="truncate">{emp.location}</p>
                  <span className="px-2 py-1 rounded-lg text-center" style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: `${statusColor}12`, display: "inline-block" }}>{statusLabel}</span>
                </div>
              );
            })}
          </motion.div>
          <div className="space-y-4">
            <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 }} className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-white mb-4" style={{ fontSize: 14, fontWeight: 700 }}>Attendance Rate</p>
              <div className="flex items-center gap-5">
                <div className="relative size-[80px] shrink-0">
                  <svg viewBox="0 0 80 80" className="size-full -rotate-90">
                    <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="7" />
                    <motion.circle cx="40" cy="40" r="32" fill="none" stroke="#00C853" strokeWidth="7" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 32}`}
                      initial={{ strokeDashoffset: 2 * Math.PI * 32 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 32 * (1 - attendanceRate / 100) }}
                      transition={{ duration: 1.5, ease: "easeOut" }} />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center"><span className="text-white" style={{ fontSize: 18, fontWeight: 800 }}>{attendanceRate}%</span></div>
                </div>
                <div className="space-y-2">
                  {[{ label: "Present", count: present.length + sos.length, color: "#00C853" }, { label: "Late", count: late.length, color: "#FF9500" }, { label: "Off Shift", count: offShift.length, color: "rgba(255,255,255,0.25)" }].map(s => (
                    <div key={s.label} className="flex items-center gap-2">
                      <div className="size-2.5 rounded-full" style={{ background: s.color }} />
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{s.label}</span>
                      <span className="ml-auto" style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.42 }} className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}><p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>By Zone</p></div>
              {Array.from(zoneMap.entries()).filter(([z]) => z !== t("att.offSite")).map(([zone, data], i) => {
                const pct = data.total > 0 ? Math.round(data.present / data.total * 100) : 0;
                const color = pct >= 80 ? "#00C853" : pct >= 60 ? "#FF9500" : "#FF2D55";
                return (
                  <div key={zone} className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <div className="flex items-center justify-between mb-2"><p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{zone}</p><span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span></div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, delay: 0.5 + i * 0.1, ease: "easeOut" }} className="h-full rounded-full" style={{ background: color }} />
                      </div>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{data.present}/{data.total}</span>
                      {data.late > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#FF9500", background: "rgba(255,149,0,0.1)", padding: "1px 6px", borderRadius: 4 }}>{data.late} late</span>}
                    </div>
                  </div>
                );
              })}
            </motion.div>
          </div>
        </div>

        {/* Live Zone Arrivals from Mobile App */}
        <LiveZoneArrivals />
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        <DSCard padding={8} glow="#00C853" style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: "#00C853" }}>{present.length + sos.length}</div><div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{t("att.present")}</div></DSCard>
        <DSCard padding={8} style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: "#FF9500" }}>{late.length}</div><div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{t("att.late")}</div></DSCard>
        <DSCard padding={8} style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: "rgba(255,255,255,0.3)" }}>{offShift.length}</div><div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{t("att.offShift")}</div></DSCard>
        <DSCard padding={8} glow={attendanceRate >= 80 ? "#00C853" : "#FF9500"} style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: attendanceRate >= 80 ? "#00C853" : "#FF9500" }}>{attendanceRate}%</div><div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{t("att.rate")}</div></DSCard>
      </div>
      <DSCard padding={10}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="size-2 rounded-full" style={{ background: "#00C853" }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>{t("att.live")} — March 7, 2026</span>
          </div>
          <div className="flex gap-1">
            {(["list", "zone"] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)} className="px-2 py-1 rounded-md"
                style={{ fontSize: 9, fontWeight: 600, background: viewMode === v ? "rgba(0,200,224,0.1)" : "transparent", color: viewMode === v ? "#00C8E0" : "rgba(255,255,255,0.25)" }}>
                {v === "list" ? t("att.list") : t("att.byZone")}
              </button>
            ))}
          </div>
        </div>
      </DSCard>
      {viewMode === "zone" ? (
        <div className="space-y-2">
          {Array.from(zoneMap.entries()).map(([zone, data]) => (
            <DSCard key={zone} padding={12}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><MapPin className="size-3" style={{ color: "#00C8E0" }} /><span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{zone}</span></div>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#00C8E0" }}>{data.present}/{data.total}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div className="h-full rounded-full" style={{ width: `${data.total > 0 ? (data.present / data.total) * 100 : 0}%`, background: data.late > 0 ? "linear-gradient(90deg, #00C853, #FF9500)" : "#00C853" }} />
              </div>
              {data.late > 0 && <div className="flex items-center gap-1 mt-1.5"><AlertTriangle className="size-2.5" style={{ color: "#FF9500" }} /><span style={{ fontSize: 8, color: "#FF9500", fontWeight: 600 }}>{data.late} {t("att.lateCheckin")}</span></div>}
            </DSCard>
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {employees.map(emp => {
            const statusCfg = STATUS_CONFIG[emp.status];
            return (
              <div key={emp.id} className="flex items-center gap-2.5 p-2.5 rounded-xl"
                style={{ background: emp.status === "sos" ? "rgba(255,45,85,0.04)" : "rgba(255,255,255,0.02)", border: `1px solid ${emp.status === "sos" ? "rgba(255,45,85,0.08)" : "rgba(255,255,255,0.04)"}` }}>
                <div className="size-7 rounded-full flex items-center justify-center" style={{ background: `${statusCfg.color}15` }}>
                  <User className="size-3.5" style={{ color: statusCfg.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>{emp.name}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{emp.role} · {emp.location === "—" ? t("att.offSite") : emp.location}</p>
                </div>
                <div className="text-right">
                  <Badge color={statusCfg.color}>{t(statusCfg.tKey)}</Badge>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>{emp.lastCheckin}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Live Zone Arrivals — reads from shared-store attendance records
// ═══════════════════════════════════════════════════════════════
function LiveZoneArrivals() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);

  useEffect(() => {
    const load = () => setRecords(getAttendanceRecords());
    load();
    // Poll every 3s for new records
    const interval = setInterval(load, 3000);
    // Also listen for storage events
    const handler = () => load();
    window.addEventListener("storage", handler);
    return () => { clearInterval(interval); window.removeEventListener("storage", handler); };
  }, []);

  if (records.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
      className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(0,200,83,0.15)" }}>
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,83,0.12)" }}>
            <Navigation className="size-4" style={{ color: "#00C853" }} />
          </div>
          <div>
            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Live Zone Arrivals</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>GPS proximity-based attendance from mobile app</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.12)" }}>
          <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="size-2 rounded-full" style={{ background: "#00C853" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "#00C853" }}>{records.length} arrival{records.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto", scrollbarWidth: "none" }}>
        {records.slice(0, 10).map((rec, i) => {
          const time = new Date(rec.timestamp);
          return (
            <div key={`${rec.employeeId}-${rec.timestamp}`} className="flex items-center gap-3 px-5 py-3"
              style={{ borderBottom: i < Math.min(records.length, 10) - 1 ? "1px solid rgba(255,255,255,0.025)" : "none" }}>
              <div className="size-8 rounded-full flex items-center justify-center"
                style={{ background: rec.type === "enter" ? "rgba(0,200,83,0.15)" : "rgba(255,149,0,0.15)" }}>
                <CheckCircle2 className="size-4" style={{ color: rec.type === "enter" ? "#00C853" : "#FF9500" }} />
              </div>
              <div className="flex-1">
                <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{rec.employeeName}</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                  {rec.type === "enter" ? "Entered" : "Exited"} <span style={{ color: "#00C8E0" }}>{rec.zoneName}</span>
                </p>
              </div>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
                {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Create Emergency Drawer — also lives here (needs SEVERITY_CONFIG + store zones)
// ═══════════════════════════════════════════════════════════════
export function CreateEmergencyDrawer({ onClose, onCreate, t }: {
  onClose: () => void;
  onCreate: (data: { severity: "critical" | "high" | "medium" | "low"; employeeName: string; zone: string; type: string }) => void;
  t: (k: string) => string;
}) {
  const storeZones = useDashboardStore(s => s.zones);
  const [severity, setSeverity] = useState<"critical" | "high" | "medium" | "low">("high");
  const [type, setType] = useState("Manual SOS");
  const [zone, setZone] = useState(storeZones[0]?.name || "Zone A - North Gate");
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 z-50" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 400, damping: 35 }}
        className="absolute bottom-0 left-0 right-0 z-50 rounded-t-2xl"
        style={{ background: "#0A1220", border: "1px solid rgba(255,255,255,0.06)", borderBottom: "none" }}>
        <div className="flex justify-center pt-3 pb-2"><div className="w-8 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} /></div>
        <div className="px-4 pb-8 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>{t("ced.title")}</h3>
            <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>
          </div>
          <div>
            <p className="mb-1.5" style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{t("ced.severity")}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {(["critical", "high", "medium", "low"] as const).map(sev => {
                const cfg = SEVERITY_CONFIG[sev];
                return (
                  <button key={sev} onClick={() => setSeverity(sev)} className="py-2 rounded-lg text-center"
                    style={{ fontSize: 10, fontWeight: 600, color: severity === sev ? "#fff" : cfg.color, background: severity === sev ? cfg.color : cfg.bg, border: `1px solid ${severity === sev ? cfg.color : "transparent"}` }}>
                    {t(cfg.tKey)}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1.5" style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{t("ced.type")}</p>
            <select value={type} onChange={e => setType(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-transparent text-white outline-none" style={{ fontSize: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              <option value="Manual SOS">{t("ced.manualSos")}</option>
              <option value="Missed Check-in">{t("ced.missedCheckin")}</option>
              <option value="Geofence Breach">{t("ced.geofenceBreach")}</option>
              <option value="Fall Detection">{t("ced.fallDetection")}</option>
              <option value="Gas Leak">{t("ced.gasLeak")}</option>
            </select>
          </div>
          <div>
            <p className="mb-1.5" style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{t("ced.zone")}</p>
            <select value={zone} onChange={e => setZone(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-transparent text-white outline-none" style={{ fontSize: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              {storeZones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
            </select>
          </div>
          <button onClick={() => onCreate({ severity, employeeName: "Admin Report", zone, type })}
            className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #FF2D55 0%, #FF1744 100%)" }}>
            <Siren className="size-4 text-white" />
            <span className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{t("ced.submit")}</span>
          </button>
        </div>
      </motion.div>
    </>
  );
}
