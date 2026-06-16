// ===================================================================
// SOSphere — Workforce Management (Hybrid Page)
// Merges: Attendance Tracking + Shift Scheduling + Check-in Monitor
// FIX FATAL-3: Added Check-in Status tab so admin sees overdue workers
// ===================================================================
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CalendarDays, Clock, UserCheck, Timer, AlertTriangle, MapPin, CheckCircle2 } from "lucide-react";
import { AttendancePage } from "./dashboard-pages";
import { ShiftSchedulingPage } from "./dashboard-shift-scheduling-page";
import { useDashboardStore } from "./stores/dashboard-store";
// 2026-06-02 Attendance Phase C (5th pattern app, complete-the-loop):
// CheckinMonitorPanel was fabricating lastCheckin / nextDue with Math.random()
// — a real bug that showed admins fake "last seen" timestamps. Switch to the
// real checkin_events table via loadCheckinFeed (the same RPC the attendance
// page already uses). Without this, the admin's check-in monitor was lying.
import { loadCheckinFeed, type CheckinFeedRow } from "./attendance-service";
import { getCompanyId } from "./shared-store";

// Check-in cycle: how long after a check-in before the next one is "due"
// (matches the mobile checkin-timer default, 90 minutes).
const CHECKIN_CYCLE_MS = 90 * 60_000;

// ── Check-in Warning Type ─────────────────────────────────────────
export interface CheckinWarningData {
  employeeId: string;
  employeeName: string;
  zone: string;
  warningCycle: number;
  timestamp: number;
  deadlineAt: number;
}

// ── Tab Bar ──────────────────────────────────────────────────────
type Tab = { id: string; labelKey: string; icon: React.ElementType; descKey: string };

const TABS: Tab[] = [
  { id: "attendance", labelKey: "wf.tab.attendance",   icon: UserCheck,   descKey: "wf.tab.attendance.desc" },
  { id: "checkins",   labelKey: "wf.tab.checkins", icon: Timer, descKey: "wf.tab.checkins.desc" },
  { id: "shifts",     labelKey: "wf.tab.shifts", icon: Clock,     descKey: "wf.tab.shifts.desc" },
];

function WorkforceTabBar({ active, onSelect, warningCount, t }: { active: string; onSelect: (id: string) => void; warningCount: number; t: (k: string) => string }) {
  return (
    <div
      className="flex items-center gap-1 mx-4 mt-4 p-1 rounded-2xl"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        const showBadge = tab.id === "checkins" && warningCount > 0 && !isActive;
        return (
          <motion.button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className="relative flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
          >
            {isActive && (
              <motion.div
                layoutId="wf-tab-pill"
                className="absolute inset-0 rounded-xl"
                style={{ background: tab.id === "checkins" && warningCount > 0 ? "rgba(255,150,0,0.1)" : "rgba(0,200,224,0.1)", border: `1px solid ${tab.id === "checkins" && warningCount > 0 ? "rgba(255,150,0,0.18)" : "rgba(0,200,224,0.18)"}` }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            <Icon
              className="relative z-10 shrink-0"
              style={{ width: 13, height: 13, color: isActive ? (tab.id === "checkins" && warningCount > 0 ? "#FF9500" : "#00C8E0") : "rgba(255,255,255,0.3)" }}
            />
            <span
              className="relative z-10"
              style={{
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? (tab.id === "checkins" && warningCount > 0 ? "#FF9500" : "#00C8E0") : "rgba(255,255,255,0.35)",
                letterSpacing: "-0.1px",
              }}
            >
              {t(tab.labelKey)}
            </span>
            {showBadge && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1 z-20 flex items-center justify-center"
                style={{
                  width: 16, height: 16, borderRadius: 8,
                  background: "#FF9500",
                  boxShadow: "0 0 8px rgba(255,150,0,0.4)",
                }}
              >
                <span style={{ fontSize: 9, fontWeight: 800, color: "#fff" }}>{warningCount}</span>
              </motion.div>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

function ContextBanner({ tabId, warningCount, t }: { tabId: string; warningCount: number; t: (k: string) => string }) {
  const tab = TABS.find(t => t.id === tabId);
  if (!tab) return null;
  const Icon = tab.icon;
  const isWarning = tabId === "checkins" && warningCount > 0;
  return (
    <motion.div
      key={tabId}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-2 mb-0 px-3 py-2 rounded-xl flex items-center gap-2"
      style={{
        background: isWarning ? "rgba(255,150,0,0.05)" : "rgba(0,200,224,0.05)",
        border: `1px solid ${isWarning ? "rgba(255,150,0,0.10)" : "rgba(0,200,224,0.10)"}`,
      }}
    >
      <Icon style={{ width: 12, height: 12, color: isWarning ? "#FF9500" : "#00C8E0", flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: isWarning ? "rgba(255,150,0,0.7)" : "rgba(0,200,224,0.7)", fontWeight: 500 }}>{t(tab.descKey)}</span>
    </motion.div>
  );
}

// ── Check-in Monitor Panel ─────────────────────────────────────────
// FIX FATAL-3: This panel shows admin all employee check-in timer statuses
// Before this fix, admin had a 30+ minute blind spot

function CheckinMonitorPanel({ warnings, employees: storeEmployees, t }: { warnings: CheckinWarningData[]; employees: Array<{ id: string; name: string; zone?: string; status?: string }>; t: (k: string) => string }) {
  // 2026-06-02 Attendance Phase C: load REAL check-in feed instead of
  // Math.random-fabricating lastCheckin / nextDue. The previous code was
  // a real production bug — admins saw fake "last seen" timestamps that
  // had nothing to do with the worker's actual GPS / heartbeat activity.
  const [checkinFeed, setCheckinFeed] = useState<CheckinFeedRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const companyId = getCompanyId();
        if (!companyId) return;
        const env = await loadCheckinFeed({ companyId, limit: 500 });
        if (!cancelled && env.ok) setCheckinFeed(env.rows);
      } catch { /* feed best-effort; empty array still drives a safe UI */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Build a per-employee map of the most-recent checkin/resumed event.
  // Warnings (missed events) are intentionally excluded — we want the most
  // recent CONFIRMED activity, not the alert about missing one.
  const latestByEmployee = new Map<string, CheckinFeedRow>();
  for (const row of checkinFeed) {
    if (row.event_type !== "checkin" && row.event_type !== "resumed") continue;
    const prev = latestByEmployee.get(row.employee_id);
    if (!prev || new Date(row.created_at).getTime() > new Date(prev.created_at).getTime()) {
      latestByEmployee.set(row.employee_id, row);
    }
  }

  // Build check-in employee list from real store employees + overlay with warnings.
  // lastCheckin = ms timestamp of latest checkin event, or 0 (rendered as "Never").
  // nextDue     = lastCheckin + CHECKIN_CYCLE_MS, or 0 if no prior check-in.
  const baseEmployees = storeEmployees.map(emp => {
    const last = latestByEmployee.get(emp.id);
    const lastMs = last ? new Date(last.created_at).getTime() : 0;
    return {
      id: emp.id,
      name: emp.name,
      zone: emp.zone || t("wf.unknownZone"),
      status: "ok" as const,
      lastCheckin: lastMs,
      nextDue: lastMs > 0 ? lastMs + CHECKIN_CYCLE_MS : 0,
    };
  });

  const allEmployees = baseEmployees.map(emp => {
    const warning = warnings.find(w => w.employeeId === emp.id);
    if (warning) {
      return {
        ...emp,
        status: warning.warningCycle >= 2 ? "overdue" as const : "due_soon" as const,
        warningCycle: warning.warningCycle,
        warningTimestamp: warning.timestamp,
        zone: warning.zone,
      };
    }
    // Check if next due is within 10 min
    const minutesTilDue = (emp.nextDue - Date.now()) / 60000;
    if (minutesTilDue <= 10 && minutesTilDue > 0) {
      return { ...emp, status: "due_soon" as const };
    }
    return emp;
  });

  // Add any warnings for employees not in store
  // P0-doctrine-completion (2026-05-25): the warning-only branch lacks
  // warningCycle / warningTimestamp fields that the inferred array element
  // type carries from the conditional branch above. They're optional at
  // runtime so we make them explicit nullable here.
  warnings.forEach(w => {
    if (!baseEmployees.find(e => e.id === w.employeeId)) {
      allEmployees.push({
        id: w.employeeId,
        name: w.employeeName,
        zone: w.zone,
        status: w.warningCycle >= 2 ? "overdue" as const : "due_soon" as const,
        lastCheckin: w.timestamp - 30 * 60000,
        nextDue: w.deadlineAt,
        warningCycle: w.warningCycle,
        warningTimestamp: w.timestamp,
      });
    }
  });

  // Sort: overdue first, then due_soon, then ok
  const sorted = [...allEmployees].sort((a, b) => {
    const order = { overdue: 0, due_soon: 1, ok: 2 };
    return (order[a.status] ?? 2) - (order[b.status] ?? 2);
  });

  const overdueCount = sorted.filter(e => e.status === "overdue").length;
  const dueSoonCount = sorted.filter(e => e.status === "due_soon").length;
  const okCount = sorted.filter(e => e.status === "ok").length;

  const statusConfig = {
    ok: { label: t("wf.status.ok"), color: "#00C853", bg: "rgba(0,200,83,0.06)", border: "rgba(0,200,83,0.12)", icon: CheckCircle2 },
    due_soon: { label: t("wf.status.dueSoon"), color: "#FF9500", bg: "rgba(255,150,0,0.06)", border: "rgba(255,150,0,0.15)", icon: Clock },
    overdue: { label: t("wf.status.overdue"), color: "#FF2D55", bg: "rgba(255,45,85,0.08)", border: "rgba(255,45,85,0.18)", icon: AlertTriangle },
  };

  function fmtAgo(ms: number): string {
    // 2026-06-02 Attendance Phase C: explicit "Never" state when no real
    // check-in exists (replaces silent garbage time from Math.random).
    if (!ms || ms <= 0) return t("wf.never");
    const mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 1) return t("wf.justNow");
    if (mins < 60) return `${mins}${t("wf.minAgo")}`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}${t("wf.hr")} ${mins % 60}${t("wf.minAgo")}`;
  }

  function fmtUntil(ms: number): string {
    const mins = Math.floor((ms - Date.now()) / 60000);
    if (mins < 0) return t("wf.overdueShort");
    if (mins < 1) return t("wf.lessThanMin");
    if (mins < 60) return `${mins}${t("wf.minShort")}`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}${t("wf.hr")} ${mins % 60}${t("wf.minShort")}`;
  }

  return (
    <div className="p-4 space-y-3">
      {/* Summary row */}
      <div className="flex gap-2">
        {[
          { label: t("wf.summary.overdue"), count: overdueCount, color: "#FF2D55", bg: "rgba(255,45,85,0.06)" },
          { label: t("wf.summary.dueSoon"), count: dueSoonCount, color: "#FF9500", bg: "rgba(255,150,0,0.06)" },
          { label: t("wf.summary.onTrack"), count: okCount, color: "#00C853", bg: "rgba(0,200,83,0.06)" },
        ].map(s => (
          <div
            key={s.label}
            className="flex-1 flex flex-col items-center py-2.5 rounded-xl"
            style={{ background: s.bg, border: `1px solid ${s.color}20` }}
          >
            <span style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.count}</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: `${s.color}90`, letterSpacing: "0.3px", marginTop: 2 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Employee list */}
      <div className="space-y-2">
        {sorted.map((emp, i) => {
          const cfg = statusConfig[emp.status];
          const StatusIcon = cfg.icon;
          return (
            <motion.div
              key={emp.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 px-3.5 py-3 rounded-xl"
              style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
            >
              {/* Status icon */}
              <div
                className="shrink-0 flex items-center justify-center rounded-lg"
                style={{ width: 32, height: 32, background: `${cfg.color}15`, border: `1px solid ${cfg.color}25` }}
              >
                {emp.status === "overdue" ? (
                  <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                    <StatusIcon style={{ width: 14, height: 14, color: cfg.color }} />
                  </motion.div>
                ) : (
                  <StatusIcon style={{ width: 14, height: 14, color: cfg.color }} />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 12, fontWeight: 700, color: emp.status === "overdue" ? "#FF2D55" : "#fff" }}>{emp.name}</span>
                  <span
                    className="px-1.5 py-0.5 rounded"
                    style={{
                      fontSize: 8, fontWeight: 800, letterSpacing: "0.5px",
                      background: `${cfg.color}18`, color: cfg.color,
                      border: `1px solid ${cfg.color}25`,
                    }}
                  >
                    {cfg.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <MapPin style={{ width: 9, height: 9, color: "rgba(255,255,255,0.2)" }} />
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{emp.zone}</span>
                </div>
              </div>

              {/* Timing */}
              <div className="text-right shrink-0">
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{t("wf.lastCheckin")}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>{fmtAgo(emp.lastCheckin)}</div>
                <div style={{ fontSize: 9, color: cfg.color, fontWeight: 600, marginTop: 2 }}>
                  {emp.status === "overdue" ? t("wf.sosImminent") : emp.status === "due_soon" ? `${t("wf.due")} ${fmtUntil(emp.nextDue)}` : `${t("wf.next")} ${fmtUntil(emp.nextDue)}`}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {sorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12">
          <Timer style={{ width: 32, height: 32, color: "rgba(255,255,255,0.06)", marginBottom: 12 }} />
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.15)" }}>{t("wf.empty.title")}</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.08)", marginTop: 4 }}>{t("wf.empty.subtitle")}</span>
        </div>
      )}
    </div>
  );
}

// ── Main Export ──────────────────────────────────────────────────
interface WorkforcePageProps {
  t: (k: string) => string;
  webMode?: boolean;
  checkinWarnings?: CheckinWarningData[];
}

export function WorkforcePage({ t, webMode = false, checkinWarnings = [] }: WorkforcePageProps) {
  const employees = useDashboardStore(s => s.employees);
  const [activeTab, setActiveTab] = useState("attendance");

  return (
    <div className="flex flex-col h-full">
      <WorkforceTabBar active={activeTab} onSelect={setActiveTab} warningCount={checkinWarnings.length} t={t} />
      <ContextBanner tabId={activeTab} warningCount={checkinWarnings.length} t={t} />

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {activeTab === "attendance" && (
            <AttendancePage employees={employees} t={t} webMode={webMode} />
          )}
          {activeTab === "checkins" && (
            <CheckinMonitorPanel warnings={checkinWarnings} employees={employees} t={t} />
          )}
          {activeTab === "shifts" && (
            <ShiftSchedulingPage t={t} webMode={webMode} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
