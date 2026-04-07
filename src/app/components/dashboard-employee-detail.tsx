// ═══════════════════════════════════════════════════════════════
// SOSphere — Employee Detail Drawer
// Shows full employee profile, app activity, and location history
// ═══════════════════════════════════════════════════════════════
import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X, User, MapPin, Clock, Phone, Shield, Activity,
  AlertTriangle, CheckCircle2, Heart, Send, Radio,
  ChevronRight, Wifi, WifiOff, Smartphone,
  FileText, Calendar, Target, TrendingUp,
} from "lucide-react";
import type { Employee } from "./dashboard-types";
import { toast } from "sonner";
import { hapticLight } from "./haptic-feedback";
import { getRealAuditLog } from "./audit-log-store";

interface EmployeeDetailProps {
  employee: Employee | null;
  onClose: () => void;
  webMode?: boolean;
}

// Mock extended data
const MOCK_ACTIVITY = [
  { time: "08:01", action: "Checked in via mobile app", color: "#00C853", icon: CheckCircle2 },
  { time: "08:15", action: "Entered Zone A - North Gate", color: "#00C8E0", icon: MapPin },
  { time: "09:30", action: "Completed safety briefing", color: "#7B5EFF", icon: Shield },
  { time: "10:45", action: "Reported minor hazard (wet floor)", color: "#FF9500", icon: AlertTriangle },
  { time: "11:00", action: "Hazard acknowledged by supervisor", color: "#00C853", icon: CheckCircle2 },
  { time: "12:00", action: "Break started", color: "rgba(255,255,255,0.3)", icon: Clock },
  { time: "12:30", action: "Break ended, re-entered Zone A", color: "#00C8E0", icon: MapPin },
  { time: "14:02", action: "Last GPS ping received", color: "#00C853", icon: Wifi },
];

const MOCK_INCIDENTS = [
  { date: "Mar 2, 2026", type: "Missed Check-in", severity: "medium", resolved: true },
  { date: "Feb 18, 2026", type: "Geofence Breach", severity: "low", resolved: true },
  { date: "Jan 5, 2026", type: "SOS Triggered (false alarm)", severity: "high", resolved: true },
];

const MOCK_CERTIFICATIONS = [
  { name: "Fire Safety Level 2", expiry: "Jun 2026", status: "valid" },
  { name: "First Aid (CPR/AED)", expiry: "Dec 2026", status: "valid" },
  { name: "Confined Space Entry", expiry: "Apr 2026", status: "expiring" },
  { name: "Working at Heights", expiry: "Jan 2026", status: "expired" },
];

const MOCK_SHIFTS = [
  { date: "Today", shift: "06:00 – 14:00", status: "on-shift" },
  { date: "Tomorrow", shift: "06:00 – 14:00", status: "scheduled" },
  { date: "Mar 10", shift: "14:00 – 22:00", status: "scheduled" },
  { date: "Mar 11", shift: "Day Off", status: "off" },
];

export function EmployeeDetailDrawer({ employee, onClose, webMode = false }: EmployeeDetailProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "activity" | "incidents" | "schedule">("overview");

  if (!employee) return null;

  // ── Real activity from audit log, filtered by employee name ───────────────
  const realActivity = useMemo(() => {
    if (!employee) return MOCK_ACTIVITY;
    try {
      const logs = getRealAuditLog();
      const empLogs = logs.filter(e =>
        e.actor?.toLowerCase().includes(employee.name.toLowerCase()) ||
        e.detail?.toLowerCase().includes(employee.name.toLowerCase())
      );
      if (empLogs.length === 0) return MOCK_ACTIVITY; // fall back to demo data
      return empLogs.slice(0, 12).map(e => {
        const d = new Date(e.timestamp);
        const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
        const isEmergency = e.action?.includes("emergency") || e.action?.includes("sos");
        const isCheckin   = e.action?.includes("checkin") || e.action?.includes("check");
        return {
          time,
          action: e.detail || e.action || "Activity recorded",
          color: isEmergency ? "#FF2D55" : isCheckin ? "#00C853" : "#00C8E0",
          icon: isEmergency ? AlertTriangle : isCheckin ? CheckCircle2 : Activity,
        };
      });
    } catch { return MOCK_ACTIVITY; }
  }, [employee?.id]);

  // ── Real incidents from audit log ───────────────────────────
  const realIncidents = useMemo(() => {
    if (!employee) return MOCK_INCIDENTS;
    try {
      const logs = getRealAuditLog();
      const emergencyLogs = logs.filter(e =>
        (e.action?.includes("emergency") || e.action?.includes("sos") || e.action?.includes("fall")) &&
        (e.actor?.toLowerCase().includes(employee.name.toLowerCase()) ||
         e.detail?.toLowerCase().includes(employee.name.toLowerCase()))
      );
      if (emergencyLogs.length === 0) return MOCK_INCIDENTS;
      return emergencyLogs.slice(0, 8).map(e => {
        const d = new Date(e.timestamp);
        const isResolved = e.action?.includes("resolved") || e.action?.includes("closed");
        const isSOS = e.action?.includes("sos") || e.detail?.toLowerCase().includes("sos");
        return {
          date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          type: isSOS ? "SOS Triggered" : e.action?.includes("fall") ? "Fall Detected" : e.action?.includes("hazard") ? "Hazard Reported" : "Incident",
          severity: isSOS ? "high" : "medium",
          resolved: isResolved,
        };
      });
    } catch { return MOCK_INCIDENTS; }
  }, [employee?.id]);

  const statusColor = employee.status === "sos" ? "#FF2D55"
    : employee.status === "late-checkin" ? "#FF9500"
    : employee.status === "on-shift" || employee.status === "checked-in" ? "#00C853"
    : "rgba(255,255,255,0.2)";

  const statusLabel = employee.status === "sos" ? "SOS ACTIVE"
    : employee.status === "late-checkin" ? "Late Check-in"
    : employee.status === "on-shift" ? "On Shift"
    : employee.status === "checked-in" ? "Checked In"
    : "Off Shift";

  const initials = (employee.name || "??").split(" ").map(n => n?.[0] || "").join("").slice(0, 2) || "??";
  const scoreColor = employee.safetyScore >= 90 ? "#00C853" : employee.safetyScore >= 75 ? "#FF9500" : "#FF2D55";

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "activity" as const, label: "Activity" },
    { id: "incidents" as const, label: "Incidents" },
    { id: "schedule" as const, label: "Schedule" },
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-stretch justify-end"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="h-full overflow-y-auto"
          style={{
            width: webMode ? 520 : 380,
            background: "#0A1220",
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
            scrollbarWidth: "none",
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-5 relative" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {/* Ambient glow */}
            <div className="absolute top-0 left-0 right-0 h-32 pointer-events-none"
              style={{ background: `radial-gradient(ellipse at top, ${statusColor}08 0%, transparent 70%)` }} />

            <div className="flex items-start justify-between relative z-10">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="size-16 rounded-2xl flex items-center justify-center"
                    style={{ background: `${statusColor}15`, border: `2px solid ${statusColor}30` }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: statusColor }}>{initials}</span>
                  </div>
                  {/* App connected indicator */}
                  <div className="absolute -bottom-1 -right-1 size-5 rounded-full flex items-center justify-center"
                    style={{ background: "#0A1220", border: `2px solid ${employee.status !== "off-shift" ? "#00C853" : "rgba(255,255,255,0.15)"}` }}>
                    <Smartphone className="size-2.5" style={{ color: employee.status !== "off-shift" ? "#00C853" : "rgba(255,255,255,0.15)" }} />
                  </div>
                </div>
                <div>
                  <h3 className="text-white" style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.3px" }}>{employee.name}</h3>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{employee.nameAr}</p>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{employee.role}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                      style={{ background: `${statusColor}12`, border: `1px solid ${statusColor}25` }}>
                      <motion.div
                        animate={employee.status === "sos" || employee.status === "late-checkin" ? { scale: [1, 1.4, 1] } : {}}
                        transition={{ duration: 1, repeat: Infinity }}
                        className="size-1.5 rounded-full" style={{ background: statusColor }} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
                    </div>
                    <span className="px-2 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.04)" }}>
                      {employee.id}
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
              </button>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2 mt-4 relative z-10">
              {[
                { icon: Phone, label: "Call", color: "#00C853" },
                { icon: Send, label: "Message", color: "#00C8E0" },
                { icon: Radio, label: "Broadcast", color: "#FF9500" },
                { icon: MapPin, label: "Locate", color: "#7B5EFF" },
              ].map(a => (
                <button key={a.label} onClick={() => { hapticLight(); toast(`${a.label} ${employee.name}`, { description: `${a.label} action initiated` }); }} className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl transition-all"
                  style={{ background: `${a.color}08`, border: `1px solid ${a.color}15`, cursor: "pointer" }}>
                  <a.icon className="size-4" style={{ color: a.color }} />
                  <span style={{ fontSize: 9, fontWeight: 600, color: a.color }}>{a.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="flex-1 py-2 rounded-lg transition-all"
                style={{
                  fontSize: 12, fontWeight: 600,
                  color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,0.3)",
                  background: activeTab === tab.id ? "rgba(0,200,224,0.12)" : "transparent",
                  border: activeTab === tab.id ? "1px solid rgba(0,200,224,0.2)" : "1px solid transparent",
                }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-4 space-y-4">
            {activeTab === "overview" && (
              <>
                {/* Safety Score Card */}
                <div className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Safety Score</p>
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.2)" }}>
                      <TrendingUp className="size-3" style={{ color: "#00C853" }} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853" }}>+5</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="relative size-20 shrink-0">
                      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="6" />
                        <motion.circle cx="40" cy="40" r="34" fill="none" stroke={scoreColor} strokeWidth="6" strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * 34}`}
                          initial={{ strokeDashoffset: 2 * Math.PI * 34 }}
                          animate={{ strokeDashoffset: 2 * Math.PI * 34 * (1 - employee.safetyScore / 100) }}
                          transition={{ duration: 1.5, ease: "easeOut" }} />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span style={{ fontSize: 20, fontWeight: 800, color: scoreColor }}>{employee.safetyScore}</span>
                        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>/ 100</span>
                      </div>
                    </div>
                    <div className="flex-1 space-y-2">
                      {[
                        { label: "Check-in Rate", value: "96%", color: "#00C853" },
                        { label: "PPE Compliance", value: "100%", color: "#00C8E0" },
                        { label: "Zone Compliance", value: "92%", color: "#FF9500" },
                      ].map(m => (
                        <div key={m.label}>
                          <div className="flex justify-between mb-0.5">
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{m.label}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: m.color }}>{m.value}</span>
                          </div>
                          <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
                            <motion.div initial={{ width: 0 }} animate={{ width: m.value }} transition={{ duration: 1, delay: 0.5 }}
                              className="h-full rounded-full" style={{ background: m.color }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: MapPin, label: "Location", value: employee.location, color: "#00C8E0" },
                    { icon: Clock, label: "Last Check-in", value: employee.lastCheckin, color: "#FF9500" },
                    { icon: Phone, label: "Phone", value: employee.phone, color: "#00C853" },
                    { icon: Shield, label: "Department", value: employee.department, color: "#7B5EFF" },
                  ].map(info => (
                    <div key={info.label} className="p-3 rounded-xl"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <info.icon className="size-3.5" style={{ color: info.color }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{info.label}</span>
                      </div>
                      <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{info.value}</p>
                    </div>
                  ))}
                </div>

                {/* Certifications */}
                <div className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="text-white mb-3" style={{ fontSize: 13, fontWeight: 700 }}>Certifications</p>
                  <div className="space-y-2">
                    {MOCK_CERTIFICATIONS.map((cert, i) => {
                      const c = cert.status === "valid" ? "#00C853" : cert.status === "expiring" ? "#FF9500" : "#FF2D55";
                      return (
                        <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl"
                          style={{ background: `${c}06`, border: `1px solid ${c}12` }}>
                          <FileText className="size-4 shrink-0" style={{ color: c }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>{cert.name}</p>
                            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Expires: {cert.expiry}</p>
                          </div>
                          <span className="px-2 py-0.5 rounded-md shrink-0"
                            style={{ fontSize: 9, fontWeight: 700, color: c, background: `${c}15`, textTransform: "uppercase" }}>
                            {cert.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {activeTab === "activity" && (
              <div className="space-y-1">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Today's Activity</p>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                    <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 2, repeat: Infinity }}
                      className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#00C8E0" }}>App Connected</span>
                  </div>
                </div>
                {realActivity.map((act, i) => {
                  const Icon = act.icon;
                  return (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-xl"
                      style={{ background: i === 0 ? "rgba(0,200,83,0.04)" : "transparent" }}>
                      <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                        <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", fontVariantNumeric: "tabular-nums" }}>{act.time}</span>
                        {i < realActivity.length - 1 && (
                          <div className="w-px flex-1" style={{ background: "rgba(255,255,255,0.06)", minHeight: 16 }} />
                        )}
                      </div>
                      <div className="size-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `${act.color}12` }}>
                        <Icon className="size-3.5" style={{ color: act.color }} />
                      </div>
                      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: 500, lineHeight: 1.5 }}>{act.action}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === "incidents" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Incident History</p>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{realIncidents.length} total</span>
                </div>
                {realIncidents.map((inc, i) => {
                  const c = inc.severity === "high" ? "#FF2D55" : inc.severity === "medium" ? "#FF9500" : "#00C8E0";
                  return (
                    <div key={i} className="p-4 rounded-xl"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{inc.type}</p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{inc.date}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md"
                            style={{ fontSize: 10, fontWeight: 700, color: c, background: `${c}12` }}>
                            {inc.severity.toUpperCase()}
                          </span>
                          {inc.resolved && (
                            <span className="px-2 py-0.5 rounded-md"
                              style={{ fontSize: 10, fontWeight: 700, color: "#00C853", background: "rgba(0,200,83,0.12)" }}>
                              RESOLVED
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {realIncidents.length === 0 && (
                  <div className="text-center py-12">
                    <Shield className="size-10 mx-auto mb-3" style={{ color: "rgba(0,200,83,0.2)" }} />
                    <p style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>Clean Record</p>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)" }}>No incidents reported</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "schedule" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Shift Schedule</p>
                  <Calendar className="size-4" style={{ color: "rgba(255,255,255,0.2)" }} />
                </div>
                {MOCK_SHIFTS.map((shift, i) => {
                  const c = shift.status === "on-shift" ? "#00C853" : shift.status === "scheduled" ? "#00C8E0" : "rgba(255,255,255,0.2)";
                  return (
                    <div key={i} className="flex items-center gap-3 p-4 rounded-xl"
                      style={{ background: shift.status === "on-shift" ? "rgba(0,200,83,0.04)" : "rgba(255,255,255,0.02)", border: `1px solid ${shift.status === "on-shift" ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.04)"}` }}>
                      <div className="size-2 rounded-full shrink-0" style={{ background: c }} />
                      <div className="flex-1">
                        <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{shift.date}</p>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>{shift.shift}</p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg"
                        style={{ fontSize: 10, fontWeight: 700, color: c, background: `${c}12` }}>
                        {shift.status === "on-shift" ? "ACTIVE" : shift.status === "scheduled" ? "Scheduled" : "Off"}
                      </span>
                    </div>
                  );
                })}

                {/* Weekly Summary */}
                <div className="p-4 rounded-2xl mt-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="text-white mb-3" style={{ fontSize: 13, fontWeight: 700 }}>This Week Summary</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Hours Worked", value: "32h", color: "#00C8E0" },
                      { label: "Check-ins", value: "12", color: "#00C853" },
                      { label: "Overtime", value: "2h", color: "#FF9500" },
                    ].map(s => (
                      <div key={s.label} className="text-center p-2.5 rounded-xl"
                        style={{ background: `${s.color}06`, border: `1px solid ${s.color}12` }}>
                        <p style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</p>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}