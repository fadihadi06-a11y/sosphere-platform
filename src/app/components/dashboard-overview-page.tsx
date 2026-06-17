// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Overview Page
// Extracted from dashboard-pages.tsx (Tier A.2 split) to keep
// individual page files well under Babel's 500KB threshold.
// Contains: WebOverviewLayout, OverviewPage, EvidenceIntelBanner,
// and the supporting MOCK_TIMELINE / MOCK_SYSTEM_HEALTH /
// getLiveActivity / getSystemHealth helpers used only by Overview.
// Shared constants (SLA_THRESHOLD, SEVERITY_CONFIG, etc.) remain in
// dashboard-pages.tsx as the single source of truth and are imported
// from there.
// ═══════════════════════════════════════════════════════════════
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, Users, MapPin, AlertTriangle, Clock,
  ChevronRight, CheckCircle2, Radio,
  User, Plus,
  Activity,
  ChevronDown, Siren,
  Send,
  ShieldCheck,
  Megaphone, Zap, X,
  UserCheck, ArrowUpRight,
  LayoutDashboard, BarChart3, CalendarDays,
  Camera, Layers, ArrowRight,
} from "lucide-react";
import {
  Card as DSCard, SectionHeader, Badge,
  AlertItem, Divider, TOKENS,
} from "./design-system";
import { sortByPriority, getEmergencyStats } from "./priority-engine";
import type { DashPage, Employee, EmergencyItem, ZoneData } from "./dashboard-types";
import { useDashboardStore } from "./stores/dashboard-store";
import { getActivityLog, getAllEmployeeStatuses, type AppActivity, type EmployeeStatusData } from "./shared-store";
import { CallTrigger } from "./call-panel";
import { toast } from "sonner";
import { safeTelCall } from "./utils/safe-tel";
import { resolveDispatcherCountry, getEmergencyNumber } from "./utils/emergency-services";
import { countryFromPhone } from "./utils/country-from-phone";
import { auditEmergency } from "./audit-log-store";
import { trackEventSync } from "./smart-timeline-tracker";
import { getEvidencePipelineStatus } from "./evidence-store";
import { hapticLight } from "./haptic-feedback";
import {
  detectClusters,
  CLUSTER_LEVEL_CONFIG,
} from "./zone-cluster-engine";
import { Skull } from "lucide-react";

// ── FIX 3: Emergency Watchdog (Auto-escalation after 5min unattended) ──
import { EmergencyWatchdog } from "./emergency-watchdog";

// Shared constants/configs live in dashboard-pages.tsx — import them so
// Overview stays in lock-step with the other pages (single source of truth).
import {
  SLA_THRESHOLD, fmtElapsed, timerColor,
  SEVERITY_CONFIG,
} from "./dashboard-pages";

// ── Dynamic System Health (uses real employee status data) ────
function getSystemHealth(employeeStatuses: EmployeeStatusData[]) {
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
      name: "GPS Tracking",
      status: (trackingEnabled / totalEmployees) > 0.95 ? "operational" as const : "degraded" as const,
      uptime: `${gpsUptimePercent}%`,
      detail: `${trackingEnabled}/${totalEmployees} active`
    },
    {
      name: "Alert Engine",
      status: "operational" as const,
      uptime: "100%",
      detail: "All systems nominal"
    },
    {
      name: "Battery Health",
      status: lowBattery > 3 ? "degraded" as const : "operational" as const,
      uptime: `${avgBattery}%`,
      detail: lowBattery > 0 ? `${lowBattery} devices low` : "All healthy"
    },
    {
      name: "Signal Strength",
      status: poorSignal > 5 ? "degraded" as const : "operational" as const,
      uptime: poorSignal === 0 ? "100%" : `${((totalEmployees - poorSignal) / totalEmployees * 100).toFixed(1)}%`,
      detail: poorSignal > 0 ? `${poorSignal} weak signals` : "All strong"
    },
  ];
}

// ── Live Activity (dynamic from shared-store) ─────────────────
function getLiveActivity(): Array<{ time: string; text: string; color: string; icon: any; unread: boolean }> {
  const activities = getActivityLog();
  const iconMap: Record<string, any> = {
    AlertTriangle, Clock, CheckCircle2, Shield, Radio, MapPin
  };

  // Declutter: collapse identical repeated entries (e.g. a spammy
  // "Admin Unreachable — Unknown" status logged over and over) so the
  // feed shows each distinct activity once, most-recent first.
  const seen = new Set<string>();
  const deduped = activities.filter((act: AppActivity) => {
    const key = (act.action || "") + "|" + (act.zone || "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, 6).map((act: AppActivity) => {
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
function EvidenceIntelBanner({ onNavigate, t }: { onNavigate: (page: DashPage) => void; t: (k: string) => string }) {
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
                {t("ov2.evidenceIntelligence")}
              </span>
              {hasPending && (
                <motion.span
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="px-2 py-0.5 rounded-full"
                  style={{ fontSize: 9, fontWeight: 800, background: "#FF2D55", color: "#fff" }}>
                  {pipeline.pendingReview} {t("ov2.pending")}
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
  const systemHealth = getSystemHealth(employeeStatuses);

  const KPI_CARDS = [
    { label: t("ov2.activeEmergencies"), value: activeCount.toString(), sub: activeCount > 0 ? t("ov2.requiresAttention") : t("ov2.allClear"), color: activeCount > 0 ? "#FF2D55" : "#00C853", icon: AlertTriangle, pulse: activeCount > 0, page: "emergencyHub" as DashPage },
    { label: t("ov2.employeesOnDuty"),  value: onShift.toString(),     sub: `${lateCheckins} ${t("ov2.lateCheckin")}`,                    color: "#00C8E0",  icon: Users,         pulse: false,          page: "employees"  as DashPage },
    { label: t("ov2.safetyScore"),       value: `${safetyScore}%`,      sub: t("ov2.liveSafetyIndex"),                             color: "#00C853",  icon: ShieldCheck,   pulse: false,          page: "workforce"  as DashPage },
    { label: t("ov2.slaCompliance"),     value: slaBreachCount > 0 ? `${slaBreachCount}` : "100%", sub: slaBreachCount > 0 ? `${slaBreachCount} ${slaBreachCount > 1 ? t("ov2.slaBreaches") : t("ov2.slaBreachSingle")}` : `${SLA_THRESHOLD / 60}${t("ov2.responseThreshold")}`, color: slaBreachCount > 0 ? "#FF9500" : "#00C853", icon: Clock, pulse: false, page: "emergencyHub" as DashPage },
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
                  <p className="text-white" style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("ov2.activeEmergencies")}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", letterSpacing: "-0.005em" }}>{t("ov2.priorityEngineAutoSorted")}</p>
                </div>
                {activeCount > 0 && (
                  <motion.span animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }}
                    className="px-2.5 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #FF2D55, #FF1744)", boxShadow: "0 2px 10px rgba(255,45,85,0.35)", letterSpacing: "0.04em" }}>
                    {activeCount} {t("ov2.live")}
                  </motion.span>
                )}
              </div>
              <button onClick={() => onNavigate("emergencyHub")} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all"
                style={{ fontSize: 12, color: "#00C8E0", fontWeight: 600, background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)", letterSpacing: "-0.005em" }}>
                {t("ov2.viewAll")} <ChevronRight className="size-3.5" />
              </button>
            </div>

            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="size-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)" }}>
                  <ShieldCheck className="size-7" style={{ color: "#00C853" }} />
                </div>
                <p style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>{t("ov2.allClear")}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>{t("ov2.noActiveEmergencies")}</p>
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
                            {emg.isOwned && <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 9, fontWeight: 700, color: "#00C853", background: "rgba(0,200,83,0.12)" }}>{t("ov2.owned")}</span>}
                          </div>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{emg.employeeName} · {emg.zone}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p style={{ fontSize: 20, fontWeight: 800, color: timerColor(emg.elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(emg.elapsed)}</p>
                          {emg.status === "active" && emg.elapsed > SLA_THRESHOLD && (
                            <span style={{ fontSize: 9, fontWeight: 800, color: "#FF9500", background: "rgba(255,149,0,0.12)", padding: "1px 6px", borderRadius: 4 }}>{t("ov2.slaBreachLabel")}</span>
                          )}
                        </div>
                        <div className="shrink-0 ml-2">
                          {emg.status === "responding" ? (
                            <span className="px-3 py-1.5 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: "#00C853", background: "rgba(0,200,83,0.1)" }}>
                              {t("ov2.responding")}
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
                              {t("ov2.unassigned")}
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
                                  <UserCheck className="size-4" /> {t("ov2.takeOwnership")}
                                </button>
                              ) : (
                                <button onClick={() => onResolve(emg.id)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
                                  style={{ background: "linear-gradient(135deg, #00C8E0, #0088A8)", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 4px 16px rgba(0,200,224,0.25)" }}>
                                  <CheckCircle2 className="size-4" /> {t("ov2.markResolved")}
                                </button>
                              )}
                              {[
                                { icon: Megaphone, label: t("ov2.broadcast"), color: "#FF9500" },
                                { icon: Send,      label: t("ov2.dispatch"),  color: "#00C8E0" },
                              ].map(a => (
                                <button key={a.label} onClick={(e) => { e.stopPropagation(); hapticLight(); onNavigate("emergencyHub" as DashPage); }} className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl"
                                  style={{ background: `${a.color}10`, border: `1px solid ${a.color}20`, minWidth: 64, cursor: "pointer" }}>
                                  <div className="size-7 rounded-full flex items-center justify-center" style={{ background: `${a.color}18` }}>
                                    <a.icon className="size-3.5" style={{ color: a.color }} />
                                  </div>
                                  <span style={{ fontSize: 10, fontWeight: 600, color: a.color }}>{a.label}</span>
                                </button>
                              ))}
                              <div onClick={e => e.stopPropagation()}>
                                <CallTrigger employeeName={emg.employeeName} employeeRole={t("ov2.fieldWorker")} phone={employees.find(e => e.name === emg.employeeName)?.phone || "+966 55 XXX"} reason="emergency" size="sm" />
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
                        <p className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>{t("ov2.assignResponder")}</p>
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
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{t("ov2.noRespondersAvailable")}</p>
                        </div>
                      ) : availableResponders.slice(0, 10).map(emp => (
                        <button
                          key={emp.id}
                          onClick={() => {
                            onTakeOwnership(assignModalEmgId!);
                            hapticLight();
                            toast.success(t("ov2.responderAssigned"), { description: `${emp.name} ${t("ov2.assignedTo")} ${targetEmg?.type}` });
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
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#00C853" }}>{t("ov2.onShiftBadge")}</span>
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
                  <p className="text-white" style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("ov2.fieldWorkers")}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{t("ov2.connectedFromMobile")}</p>
                </div>
              </div>
              <button onClick={() => onNavigate("people")} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl"
                style={{ fontSize: 12, color: "#00C8E0", fontWeight: 600, background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                {t("ov2.viewAll")} <ChevronRight className="size-3.5" />
              </button>
            </div>
            <div className="grid px-5 py-3" style={{ gridTemplateColumns: "1fr 130px 110px 80px", borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.008)" }}>
              {[t("ov2.colEmployee"), t("ov2.colLocation"), t("ov2.colLastCheckin"), t("ov2.colStatus")].map(h => (
                <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{h}</span>
              ))}
            </div>
            {employees.slice(0, 6).map((emp, i) => {
              const statusColor = emp.status === "sos" ? "#FF2D55" : emp.status === "late-checkin" ? "#FF9500" : emp.status === "on-shift" || emp.status === "checked-in" ? "#00C853" : "rgba(255,255,255,0.2)";
              const statusLabel = emp.status === "sos" ? t("ov2.statusSosActive") : emp.status === "late-checkin" ? t("ov2.statusLate") : emp.status === "on-shift" ? t("ov2.statusOnShift") : emp.status === "checked-in" ? t("ov2.statusCheckedIn") : t("ov2.statusOffShift");
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
          {/* System Health */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.42, type: "spring", stiffness: 200 }}
            className="rounded-2xl p-5"
            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-white" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("ov2.systemHealth")}</p>
              {(() => {
                const degraded = systemHealth.filter(sh => sh.status === "degraded").length;
                const ok = degraded === 0;
                return (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl" style={{ background: ok ? "rgba(0,200,83,0.06)" : "rgba(255,149,0,0.06)", border: `1px solid ${ok ? "rgba(0,200,83,0.12)" : "rgba(255,149,0,0.12)"}` }}>
                    <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 2, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: ok ? "#00C853" : "#FF9500" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: ok ? "#00C853" : "#FF9500" }}>{ok ? t("ov2.allOperational") : `${degraded} ${t("ov2.degraded")}`}</span>
                  </div>
                );
              })()}
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
              <p className="text-white" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("ov2.zoneOverview")}</p>
              <button onClick={() => onNavigate("location")} className="flex items-center gap-1 px-3 py-1.5 rounded-xl" style={{ fontSize: 12, color: "#00C8E0", fontWeight: 600, background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>{t("ov2.viewAllShort")} <ChevronRight className="size-3" /></button>
            </div>
            <div className="space-y-2">
              {zones.map((z, i) => {
                const rc = z.risk === "high" ? "#FF2D55" : z.risk === "medium" ? "#FF9500" : "#00C853";
                return (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: `${rc}04`, border: `1px solid ${rc}0A` }}>
                    <div className="size-2.5 rounded-full" style={{ background: rc, boxShadow: `0 0 6px ${rc}40` }} />
                    <p className="flex-1 text-white truncate" style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em" }}>{z.name}</p>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontVariantNumeric: "tabular-nums" }}>{z.employees} {t("ov2.workers")}</span>
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
              <p className="text-white" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("ov2.liveActivity")}</p>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>{t("ov2.realTime")}</span>
                <motion.div animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="size-2 rounded-full" style={{ background: "#FF2D55", boxShadow: "0 0 6px rgba(255,45,85,0.4)" }} />
              </div>
            </div>
            <div>
              {liveActivity.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{t("ov2.noRecentActivity")}</p>
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

  const activeEmergencies = emergencies.filter(e => e.status !== "resolved");
  const sorted = sortByPriority(activeEmergencies);
  const stats = getEmergencyStats(activeEmergencies);
  const activeAlerts = stats.unowned + stats.owned;
  const activeFocus = sorted.find(e => e.status === "active" && e.severity === "critical") || sorted.find(e => e.status === "active");

  const [kpiFilter, setKpiFilter] = useState<KpiFilter>(null);
  const [expandedIncident, setExpandedIncident] = useState<string | null>(null);
  // FIX 1: Canonical SLA formula — same as main dashboard
  const slaBreachCount = emergencies.filter(e => e.status === "active" && e.elapsed > SLA_THRESHOLD).length;
  // REAL safety index (was a hardcoded 87). 100 = all clear; each live
  // incident / SLA breach / late check-in deducts. Honest, derived from
  // the same real signals as the rest of the dashboard.
  const safetyScore = Math.max(0, Math.min(100,
    100 - activeEmergencies.length * 15 - slaBreachCount * 10 - lateCheckins * 5));

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
          { id: "onDuty" as KpiFilter,   label: t("emp.onShift"),       value: onShift.toString(),       color: "#00C8E0", icon: Users,         pulse: false },
          { id: "slaBreach" as KpiFilter,label: t("emg.sla"),           value: slaBreachCount.toString(),color: slaBreachCount > 0 ? "#FF9500" : "#00C853", icon: Clock, pulse: false },
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
                  {[{ l: t("ov.avail"), c: "#00C853", v: employees.filter(e => e.status === "on-shift").length }, { l: t("ov.activeShort"), c: "#FF9500", v: employees.filter(e => (e as any).status === "responding").length }, { l: t("ov.break"), c: "rgba(255,255,255,0.3)", v: employees.filter(e => e.status === "off-shift").length }].map(s => (
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
              {(import.meta.env.DEV ? MOCK_SYSTEM_HEALTH : []).map((s, i) => {
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
            <span style={{ fontSize: 9, color: "#00C853", fontWeight: 600 }}>live</span>
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
                    <button key={a.label} onClick={() => { hapticLight(); onNavigate("emergencyHub" as DashPage); }} className="flex flex-col items-center gap-1.5 py-2 rounded-xl"
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
                    } catch { /* localStorage parse failure — fall through */ }
                    // CRIT #164: a brand-new owner has no audit log yet. Showing
                    // MOCK_TIMELINE makes them think SOSphere has invented activity.
                    // In DEV the mock is helpful; in production we render an empty
                    // 'no recent activity' single-line stub the parent JSX picks up.
                    return import.meta.env.DEV ? MOCK_TIMELINE : [{ time: "", event: "No recent activity" }];
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
          {(() => {
            const liveActivity = getLiveActivity();
            if (liveActivity.length === 0) {
              return (
                <div style={{ padding: "20px 16px", textAlign: "center" }}>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{t("l.noRecentActivity") || "No recent activity"}</p>
                </div>
              );
            }
            return liveActivity.map((activity, i) => (
              <div key={i}>
                <AlertItem title={activity.text} icon={activity.icon} color={activity.color} timestamp={activity.time} unread={activity.unread} />
                {i < liveActivity.length - 1 && <Divider />}
              </div>
            ));
          })()}
        </DSCard>
      </div>

      {/* FIX 3: Emergency Watchdog — Auto-escalation after 5min unattended */}
      {/* P0-doctrine-completion (2026-05-25): EmergencyWatchdog defines its own
          Emergency type with required employeeId + number timestamp + narrower
          status union. Convert EmergencyItem[] → Emergency[] at this boundary
          so TS strict can verify the contract end-to-end. */}
      <EmergencyWatchdog
        emergencies={sorted.map(e => ({
          id: e.id,
          employeeName: e.employeeName,
          employeeId: e.employeeId || e.id,
          zone: e.zone,
          severity: e.severity,
          timestamp: e.timestamp.getTime(),
          status: e.status === "responding" ? "active" : e.status,
          actionsLog: [],
        }))}
        onTakeAction={(id) => {
          const emergency = sorted.find(e => e.id === id);
          if (!emergency) return;
          // phase-1/wire-call-997 (2026-05-25, life-safety):
          // Open the AI Co-Admin via the dashboard store so the admin
          // actually sees a triage UI for this emergency (no toast-only stub).
          // Pre-fix the button showed "Taking immediate action" then did NOTHING.
          const ctx = {
            emergencyId: emergency.id,
            employeeName: emergency.employeeName,
            employeePhone: "",
            zone: emergency.zone,
            sosType: "watchdog_unattended",
            severity: emergency.severity,
            timestamp: emergency.timestamp.getTime(),
          };
          useDashboardStore.setState({ aiCoAdminContext: ctx as any, showAICoAdmin: true });
          trackEventSync(emergency.id, "escalation_triggered",
            `Admin opened AI Co-Admin via Watchdog Take Action button`,
            "Admin", "Admin",
            { trigger: "watchdog_take_action" });
          toast.success(`${t("ov2.openingAICoAdmin")} ${emergency.employeeName}`, {
            description: t("ov2.triagePanelActivated"),
          });
        }}
        onCall997={(id) => {
          const emergency = sorted.find(e => e.id === id);
          if (!emergency) return;
          // ═══════════════════════════════════════════════════════════════
          // phase-1/wire-call-997 (2026-05-25, LIFE-SAFETY CRITICAL):
          //
          // Pre-fix: this button showed a "📞 Calling 997 Emergency Services"
          // toast and DID NOTHING ELSE. A trapped/bleeding worker could die
          // while admin waited for the imaginary 997 dispatcher.
          //
          // Post-fix: resolve the user's local emergency number (Saudi=997,
          // US=911, EU=112, etc.) via the SAME pipeline mobile-app uses, then
          // open the OS dialer via safeTelCall (Capacitor CallNumber on native,
          // tel: URI on mobile web, desktop=toast-with-Copy).
          //
          // Why NOT a Twilio call from the dashboard?
          //   - Server-initiated calls to 997/911 expose us to legal liability
          //     (impersonating callers, potential prank-call false reports).
          //   - The admin's real phone is the right caller ID for dispatchers
          //     (so they can identify the company + call back if disconnected).
          //   - tel: dial works OFFLINE; Twilio requires cellular/WiFi.
          //   - Faster: one tap from the admin's existing phone vs an edge
          //     function roundtrip.
          //
          // Audit log is written regardless of whether the OS dialer actually
          // completes the call — the admin's INTENT to dispatch is the legally
          // significant action.
          // ═══════════════════════════════════════════════════════════════
          let adminPhone: string | undefined;
          try { adminPhone = localStorage.getItem("sosphere_admin_phone") || undefined; } catch { /* private mode */ }
          let profileCountry: string | undefined;
          try { profileCountry = localStorage.getItem("sosphere_country_code") || undefined; } catch { /* ignore */ }
          if (!profileCountry && adminPhone) {
            profileCountry = countryFromPhone(adminPhone) || undefined;
          }
          const country = resolveDispatcherCountry({
            profileCountry,
            browserLocale: typeof navigator !== "undefined" ? navigator.language : undefined,
          });
          const svc = getEmergencyNumber(country);
          // Audit BEFORE dialing — if the dial UI fails the intent is still logged.
          auditEmergency(emergency.id, `emergency_dispatch_${svc.number}`, emergency.employeeName);
          trackEventSync(emergency.id, "emergency_services_called",
            `Admin dialed ${svc.label} (${svc.number}) for ${emergency.employeeName} in ${emergency.zone}`,
            "Admin", "Admin",
            { emergencyNumber: svc.number, country: svc.country, label: svc.label });
          // Dial via OS — safeTelCall auto-allows tel: fallback for emergency short codes.
          safeTelCall(svc.number, `${svc.label} for ${emergency.employeeName}`);
          toast.success(`📞 ${t("ov2.dialing")} ${svc.label} — ${svc.number}`, {
            description: `${t("ov2.tellDispatch")}: ${emergency.employeeName} ${t("ov2.inZone")} ${emergency.zone}. ${t("ov2.stayOnLine")}`,
            duration: 10000,
          });
        }}
      />
    </div>
  );
}
