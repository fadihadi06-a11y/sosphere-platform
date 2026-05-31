// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Incident History Page
// ─────────────────────────────────────────────────────────────
// Extracted from dashboard-pages.tsx (2026-05-31 Tier A.1 refactor)
// to begin breaking the 259KB monolith into per-page modules.
// Pure component — depends only on SEVERITY_CONFIG from the parent
// module (one-way import, no circular risk).
// ═══════════════════════════════════════════════════════════════

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { Card as DSCard, Badge } from "./design-system";
import { SEVERITY_CONFIG } from "./dashboard-pages";

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
          {filtered.map((inc) => {
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
