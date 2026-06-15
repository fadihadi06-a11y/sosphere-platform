// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Attendance Page + LiveZoneArrivals helper
// ─────────────────────────────────────────────────────────────
// Extracted from dashboard-pages.tsx (2026-05-31 Tier A step 4/7).
// LiveZoneArrivals moves with AttendancePage because it's only
// used inside it. STATUS_CONFIG imported one-way from parent.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Clock, MapPin, Navigation, User, UserCheck, Users } from "lucide-react";
import { Card as DSCard, Badge } from "./design-system";
import type { Employee } from "./dashboard-types";
import { getAttendanceRecords, type AttendanceRecord } from "./shared-store";
import { STATUS_CONFIG } from "./dashboard-pages";

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
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>{t("att.live")} — {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
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
