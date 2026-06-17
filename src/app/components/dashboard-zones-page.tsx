// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Zones Page
// ─────────────────────────────────────────────────────────────
// Extracted from dashboard-pages.tsx (2026-05-31 Tier A step 3/7).
// Self-contained except for STATUS_CONFIG (one-way import from
// parent — no circular dependency risk).
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useMemo } from "react";
import { motion } from "motion/react";
import { AlertTriangle, ChevronLeft, ChevronRight, MapPin, User, Users, LogIn, LogOut } from "lucide-react";
import { Card as DSCard, Badge, TOKENS } from "./design-system";
import type { ZoneData } from "./dashboard-types";
import { useDashboardStore } from "./stores/dashboard-store";
import { STATUS_CONFIG } from "./dashboard-pages";
import { onSyncEvent } from "./shared-store";

// Phase 2 CRIT-3 (2026-06-01): rolling buffer of geofence transitions
// surfaced from the mobile devices via the event bus. Each ZONE_ENTRY /
// ZONE_EXIT SyncEvent originates in offline-gps-tracker.ts:processPosition
// after geofence-service confirms a hysteresis-debounced boundary crossing.
// We keep the most recent N in component state so admins can see live
// zone activity without manually loading the geofence_events table.
interface ZoneTransition {
  ts: number;
  type: "ZONE_ENTRY" | "ZONE_EXIT";
  employeeId: string;
  employeeName: string;
  zoneId?: string;
  zoneName?: string;
}
const RECENT_TRANSITIONS_MAX = 25;

export function ZonesPage({ zones: zonesProp, t, webMode = false }: { zones: ZoneData[]; t: (k: string) => string; webMode?: boolean }) {
  const [selectedZone, setSelectedZone] = useState<ZoneData | null>(null);
  const [recentTransitions, setRecentTransitions] = useState<ZoneTransition[]>([]);
  const storeEmployees = useDashboardStore(s => s.employees);
  const storeEmergencies = useDashboardStore(s => s.emergencies);
  // REAL active alerts per zone: unresolved (active/responding) emergencies
  // attributed to a zone by name (best effort). zones[].activeAlerts arrived
  // hardcoded 0 from the data layer, so we recompute it here from live
  // emergencies instead of always showing "All clear".
  const activeAlertsByZone = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of storeEmergencies) {
      if ((e.status === "active" || e.status === "responding") && e.zone) {
        m.set(e.zone, (m.get(e.zone) || 0) + 1);
      }
    }
    return m;
  }, [storeEmergencies]);
  const zones = useMemo(() => zonesProp.map(z => ({
    ...z,
    activeAlerts: activeAlertsByZone.get(z.name) ?? activeAlertsByZone.get(z.name.split(" - ")[0]) ?? 0,
  })), [zonesProp, activeAlertsByZone]);
  const totalEmps = zones.reduce((s, z) => s + z.employees, 0);
  // KPI total counts ALL active emergencies (even ones with no zone attributed),
  // so nothing is silently dropped.
  const totalAlerts = useMemo(
    () => storeEmergencies.filter(e => e.status === "active" || e.status === "responding").length,
    [storeEmergencies],
  );

  // Phase 2 CRIT-3: subscribe to live ZONE_ENTRY/ZONE_EXIT events.
  // Mounted once per dashboard session — onSyncEvent returns the
  // unsubscribe function so the cleanup is exact (no listener leak).
  useEffect(() => {
    const off = onSyncEvent((e) => {
      if (e.type !== "ZONE_ENTRY" && e.type !== "ZONE_EXIT") return;
      // TS narrowing via the early-return guard above works in this
      // scope but does NOT propagate into the setRecentTransitions
      // callback closure (TS conservatively widens captured vars).
      // Pin the narrowed type to a fresh const so the closure sees
      // the precise "ZONE_ENTRY" | "ZONE_EXIT" union, not the full
      // SyncEvent.type union.
      const narrowedType: "ZONE_ENTRY" | "ZONE_EXIT" = e.type;
      const d = (e.data ?? {}) as { zoneId?: string; zoneName?: string };
      setRecentTransitions(prev => {
        const next: ZoneTransition[] = [{
          ts:           e.timestamp,
          type:         narrowedType,
          employeeId:   e.employeeId,
          employeeName: e.employeeName,
          zoneId:       d.zoneId,
          zoneName:     d.zoneName,
        }, ...prev];
        return next.slice(0, RECENT_TRANSITIONS_MAX);
      });
    });
    return () => { off(); };
  }, []);

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
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>{t("zn2.zoneManagement")}</h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{zones.length} {t("zn2.monitoredZones")} · {totalEmps} {t("zn2.totalPersonnelLabel")}</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: t("zn2.totalZones"),      value: zones.length,                                     color: "#00C8E0", sub: t("zn2.monitored") },
            { label: t("zn2.highRiskLabel"),         value: zones.filter(z => z.risk === "high").length,      color: "#FF2D55", sub: t("zn2.immediateAttention") },
            { label: t("zn2.totalPersonnel"),   value: totalEmps,                                        color: "#00C853", sub: t("zn2.acrossAllZones") },
            { label: t("zn2.activeAlerts"),     value: totalAlerts, color: totalAlerts > 0 ? "#FF9500" : "#00C853", sub: totalAlerts > 0 ? t("zn2.unresolved") : t("zn2.allClear") },
          ].map((k, i) => (
            <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
              className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p style={{ fontSize: 30, fontWeight: 800, color: k.color }}>{k.value}</p>
              <p className="text-white mt-1" style={{ fontSize: 13, fontWeight: 600 }}>{k.label}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{k.sub}</p>
            </motion.div>
          ))}
        </div>
        {/* Phase 2 CRIT-3 (2026-06-01): live ZONE_ENTRY/ZONE_EXIT feed.
            Populated by onSyncEvent subscription above - events originate
            on mobile via offline-gps-tracker -> geofence-service after
            hysteresis-confirmed boundary crossing. */}
        {recentTransitions.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
            className="p-5 rounded-2xl" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.12)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MapPin className="size-4" style={{ color: TOKENS.accent.primary }} />
                <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{t("zn2.liveZoneActivity")}</p>
              </div>
              <Badge color={TOKENS.accent.primary}>{recentTransitions.length}</Badge>
            </div>
            <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
              {recentTransitions.map((tr, idx) => {
                const isEntry = tr.type === "ZONE_ENTRY";
                const c = isEntry ? "#00C853" : "#FF9500";
                const Icon = isEntry ? LogIn : LogOut;
                const ago = Math.round((Date.now() - tr.ts) / 1000);
                const agoLabel = ago < 60 ? `${ago}${t("zn2.secAgo")}` : ago < 3600 ? `${Math.round(ago / 60)}${t("zn2.minAgo")}` : `${Math.round(ago / 3600)}${t("zn2.hourAgo")}`;
                return (
                  <div key={`${tr.ts}-${tr.employeeId}-${idx}`} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${c}18` }}>
                    <div className="size-7 rounded-md flex items-center justify-center shrink-0"
                      style={{ background: `${c}14`, border: `1px solid ${c}30` }}>
                      <Icon className="size-3.5" style={{ color: c }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>
                        {tr.employeeName || tr.employeeId}
                      </p>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>
                        {isEntry ? t("zn2.entered") : t("zn2.exited")} {tr.zoneName || tr.zoneId || t("zn2.unknownZone")}
                      </p>
                    </div>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>{agoLabel}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
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
                      <span className="px-2 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 700, color: rc, background: `${rc}12` }}>{zone.risk.toUpperCase()} {t("zn2.risk")}</span>
                      <span className="px-2 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 700, color: sc, background: `${sc}12` }}>{zone.status.toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12 }}>
                    <div className="flex items-center gap-2">
                      <Users className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{zone.employees} {t("zn2.workers")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-3.5" style={{ color: zone.activeAlerts > 0 ? "#FF2D55" : "rgba(255,255,255,0.2)" }} />
                      <span style={{ fontSize: 12, color: zone.activeAlerts > 0 ? "#FF2D55" : "rgba(255,255,255,0.35)" }}>{zone.activeAlerts} {t("zn2.alerts")}</span>
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
