// ═══════════════════════════════════════════════════════════════
// SOSphere — Mission Control (Admin Dashboard Page)
// Create, track & manage field missions in real-time
// Hybrid: works online + offline, proactive alerts
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus, MapPin, Navigation, Clock, AlertTriangle, CheckCircle2,
  ChevronRight, Users, Phone, Eye, Shield, Play, Flag, Route,
  Circle, Timer, X, Zap, BarChart3, Home, User, Wifi, WifiOff,
  Battery, BatteryLow, BatteryWarning, Signal, SignalZero,
  Calendar, Send, Bell, Target, ChevronDown, ChevronUp,
  Locate, ArrowRight, Wrench, XCircle, RefreshCw, Download,
  AlertCircle, Radio, Smartphone, Search, Filter,
} from "lucide-react";
import { toast } from "sonner";
import {
  type Mission, type MissionStatus, type MissionAlert,
  getAllMissions, seedDemoMissions, createMission, cancelMission,
  onMissionEvent, getMissionProgress, MISSION_STATUS_CONFIG,
} from "./mission-store";

// ── Status Color Map ──────────────────────────────────────────
const SC = MISSION_STATUS_CONFIG;

// ── Helper: format duration ───────────────────────────────────
function fmtDur(ms: number): string {
  if (ms < 0) return "—";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXPORT: MissionControlPage
// ═══════════════════════════════════════════════════════════════

export function MissionControlPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "alerts" | "completed">("all");
  const [search, setSearch] = useState("");

  // Seed + Load
  useEffect(() => {
    seedDemoMissions();
    setMissions(getAllMissions());
  }, []);

  // Listen for cross-tab events
  useEffect(() => {
    const unsub = onMissionEvent(() => {
      setMissions(getAllMissions());
    });
    // Also poll every 3s for same-tab updates
    const interval = setInterval(() => setMissions(getAllMissions()), 3000);
    return () => { unsub(); clearInterval(interval); };
  }, []);

  // Filter + Search
  const filtered = useMemo(() => {
    let list = missions;
    if (filter === "active") list = list.filter(m => !["completed", "cancelled", "created"].includes(m.status));
    if (filter === "alerts") list = list.filter(m => m.status === "alert" || m.alerts.some(a => !a.acknowledged));
    if (filter === "completed") list = list.filter(m => m.status === "completed");
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(m => m.employeeName.toLowerCase().includes(s) || m.id.toLowerCase().includes(s) || m.destination.name.toLowerCase().includes(s));
    }
    // Sort: alerts first, then active, then scheduled, then completed
    return list.sort((a, b) => {
      const pri = (s: MissionStatus) => s === "alert" ? 0 : ["en_route_out", "en_route_back", "arrived_site", "working"].includes(s) ? 1 : s === "ready" || s === "notified" ? 2 : s === "created" ? 3 : 4;
      return pri(a.status) - pri(b.status);
    });
  }, [missions, filter, search]);

  const selected = selectedId ? missions.find(m => m.id === selectedId) : null;

  const stats = useMemo(() => {
    const active = missions.filter(m => ["en_route_out", "en_route_back", "arrived_site", "working", "ready"].includes(m.status)).length;
    const alerts = missions.filter(m => m.status === "alert" || m.alerts.some(a => !a.acknowledged)).length;
    const completed = missions.filter(m => m.status === "completed").length;
    const scheduled = missions.filter(m => m.status === "created").length;
    return { active, alerts, completed, scheduled, total: missions.length };
  }, [missions]);

  return (
    <div className="space-y-5">
      {/* ── KPI Strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Active", value: stats.active, color: "#00C8E0", icon: Navigation },
          { label: "Alerts", value: stats.alerts, color: "#FF2D55", icon: AlertTriangle, pulse: stats.alerts > 0 },
          { label: "Scheduled", value: stats.scheduled, color: "#FF9500", icon: Calendar },
          { label: "Completed", value: stats.completed, color: "#00C853", icon: CheckCircle2 },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-2xl px-4 py-3.5 relative overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            {kpi.pulse && (
              <motion.div animate={{ opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${kpi.color}08, transparent)` }} />
            )}
            <div className="flex items-center justify-between relative z-10">
              <div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>{kpi.label}</p>
                <p className="text-white" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.02em" }}>{kpi.value}</p>
              </div>
              <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: `${kpi.color}12`, border: `1px solid ${kpi.color}20` }}>
                <kpi.icon className="size-5" style={{ color: kpi.color }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4" style={{ color: "rgba(255,255,255,0.2)" }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search missions..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl outline-none text-white placeholder:text-white/20"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 13 }}
          />
        </div>
        <div className="flex gap-1.5">
          {(["all", "active", "alerts", "completed"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-2 rounded-lg capitalize"
              style={{
                fontSize: 12, fontWeight: 600,
                background: filter === f ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)",
                color: filter === f ? "#00C8E0" : "rgba(255,255,255,0.35)",
                border: `1px solid ${filter === f ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
              }}
            >{f}{f === "alerts" && stats.alerts > 0 ? ` (${stats.alerts})` : ""}</button>
          ))}
        </div>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
          style={{ background: "linear-gradient(135deg, #00C8E0, #0088A8)", fontSize: 13, fontWeight: 700, color: "#fff" }}
        >
          <Plus className="size-4" /> New Mission
        </motion.button>
      </div>

      {/* ── Mission List + Detail Split ─────────────────────── */}
      <div className="flex gap-4" style={{ minHeight: 500 }}>
        {/* List */}
        <div className="flex-1 space-y-2 overflow-y-auto" style={{ maxHeight: 600 }}>
          <AnimatePresence>
            {filtered.map(m => (
              <MissionCard key={m.id} mission={m} isSelected={selectedId === m.id} onClick={() => setSelectedId(m.id === selectedId ? null : m.id)} />
            ))}
          </AnimatePresence>
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 opacity-30">
              <Route className="size-12 mb-3" />
              <p style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>No missions found</p>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <AnimatePresence mode="wait">
          {selected && (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, x: 20, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 420 }}
              exit={{ opacity: 0, x: 20, width: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="shrink-0 overflow-hidden"
            >
              <MissionDetail mission={selected} onClose={() => setSelectedId(null)} onCancel={(id) => { cancelMission(id); setMissions(getAllMissions()); toast.success("Mission cancelled"); }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Create Mission Drawer ──────────────────────────── */}
      <AnimatePresence>
        {showCreate && <CreateMissionDrawer onClose={() => setShowCreate(false)} onCreated={() => { setMissions(getAllMissions()); setShowCreate(false); }} />}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Mission Card — compact list item
// ═══════════════════════════════════════════════════════════════

function MissionCard({ mission: m, isSelected, onClick }: { mission: Mission; isSelected: boolean; onClick: () => void }) {
  const cfg = SC[m.status];
  const progress = getMissionProgress(m);
  const hasAlerts = m.alerts.filter(a => !a.acknowledged).length;
  const lastHb = m.heartbeats[m.heartbeats.length - 1];
  const isLive = ["en_route_out", "en_route_back", "arrived_site", "working", "alert"].includes(m.status);

  return (
    <motion.button
      layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      onClick={onClick}
      className="w-full text-left rounded-2xl px-4 py-3.5 relative overflow-hidden transition-all"
      style={{
        background: isSelected ? "rgba(0,200,224,0.06)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${isSelected ? "rgba(0,200,224,0.2)" : m.status === "alert" ? "rgba(255,45,85,0.2)" : "rgba(255,255,255,0.05)"}`,
      }}
    >
      {/* Alert pulse */}
      {m.status === "alert" && (
        <motion.div animate={{ opacity: [0.05, 0.12, 0.05] }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-0" style={{ background: "rgba(255,45,85,0.1)" }} />
      )}

      <div className="relative z-10">
        {/* Row 1: Name + Status */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-full flex items-center justify-center" style={{ background: `${cfg.color}15`, border: `1px solid ${cfg.color}25` }}>
              <User className="size-3.5" style={{ color: cfg.color }} />
            </div>
            <div>
              <p className="text-white" style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em" }}>{m.employeeName}</p>
              <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>{m.id} · {m.vehicleType}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasAlerts > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>
                <AlertTriangle className="size-3" style={{ color: "#FF2D55" }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#FF2D55" }}>{hasAlerts}</span>
              </div>
            )}
            <div className="px-2.5 py-1 rounded-full" style={{ background: `${cfg.color}12`, border: `1px solid ${cfg.color}20` }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
            </div>
          </div>
        </div>

        {/* Row 2: Route */}
        <div className="flex items-center gap-2 mb-2.5">
          <MapPin className="size-3 shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
          <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)", fontWeight: 500 }} className="truncate">
            {m.origin.name} <ArrowRight className="inline size-3 mx-0.5" style={{ color: "rgba(255,255,255,0.15)" }} /> {m.destination.name}
          </p>
        </div>

        {/* Row 3: Progress bar + info */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
            <motion.div
              animate={{ width: `${progress}%` }}
              className="h-full rounded-full"
              style={{ background: m.status === "alert" ? "#FF2D55" : `linear-gradient(90deg, ${cfg.color}, ${cfg.color}88)` }}
            />
          </div>
          <div className="flex items-center gap-2">
            {isLive && lastHb && (
              <>
                {lastHb.internetStatus === "offline" ? <WifiOff className="size-3" style={{ color: "#FF9500" }} /> : <Wifi className="size-3" style={{ color: "#00C853" }} />}
                <span style={{ fontSize: 10, color: lastHb.batteryLevel < 30 ? "#FF2D55" : "rgba(255,255,255,0.25)", fontWeight: 600 }}>
                  {lastHb.batteryLevel}%
                </span>
              </>
            )}
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>
              {m.status === "created" ? fmtDate(m.scheduledStart) + " " + fmtTime(m.scheduledStart) :
               m.status === "completed" ? fmtDur((m.completedAt || 0) - (m.departedAt || 0)) :
               isLive ? fmtDur(Date.now() - (m.departedAt || m.createdAt)) : ""}
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

// ═══════════════════════════════════════════════════════════════
// Mission Detail — right panel
// ═══════════════════════════════════════════════════════════════

function MissionDetail({ mission: m, onClose, onCancel }: { mission: Mission; onClose: () => void; onCancel: (id: string) => void }) {
  const cfg = SC[m.status];
  const progress = getMissionProgress(m);
  const lastHb = m.heartbeats[m.heartbeats.length - 1];
  const lastGPS = m.gpsTrack[m.gpsTrack.length - 1] || m.returnTrack[m.returnTrack.length - 1];

  // Phase timeline
  const phases: { label: string; time?: number; active: boolean; done: boolean; color: string }[] = [
    { label: "Mission Created", time: m.createdAt, active: false, done: true, color: "#8090A5" },
    { label: "Accepted", time: m.acceptedAt, active: m.status === "ready", done: !!m.acceptedAt, color: "#34C759" },
    { label: "Departed", time: m.departedAt, active: m.status === "en_route_out", done: !!m.departedAt, color: "#00C8E0" },
    { label: "Arrived at Site", time: m.arrivedSiteAt, active: m.status === "arrived_site", done: !!m.arrivedSiteAt, color: "#00C853" },
    { label: "Working", time: m.workStartedAt, active: m.status === "working", done: !!m.workStartedAt, color: "#7B5EFF" },
    { label: "Left Site", time: m.leftSiteAt, active: m.status === "en_route_back", done: !!m.leftSiteAt, color: "#FF9500" },
    { label: "Arrived Home", time: m.arrivedHomeAt, active: false, done: !!m.arrivedHomeAt, color: "#00C853" },
  ];

  return (
    <div className="rounded-2xl overflow-hidden h-full" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: `${cfg.color}12`, border: `1px solid ${cfg.color}20` }}>
            <Navigation className="size-5" style={{ color: cfg.color }} />
          </div>
          <div>
            <p className="text-white" style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.02em" }}>{m.employeeName}</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{m.id} · {m.vehicleType}</p>
          </div>
        </div>
        <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)" }}>
          <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
        </button>
      </div>

      <div className="overflow-y-auto px-5 py-4 space-y-4" style={{ maxHeight: 520 }}>
        {/* Status + Progress */}
        <div className="rounded-xl px-4 py-3" style={{ background: `${cfg.color}06`, border: `1px solid ${cfg.color}12` }}>
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{progress}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
            <motion.div animate={{ width: `${progress}%` }} transition={{ duration: 0.5 }} className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${cfg.color}, ${cfg.color}88)` }} />
          </div>
        </div>

        {/* Route Info */}
        <div className="rounded-xl px-4 py-3 space-y-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>ROUTE</p>
          {[
            { icon: Circle, label: "From", value: m.origin.name, color: "#00C8E0" },
            { icon: Target, label: "To", value: m.destination.name, color: "#FF9500" },
            { icon: Home, label: "Return", value: m.returnTo.name, color: "#00C853" },
          ].map(r => (
            <div key={r.label} className="flex items-center gap-2.5">
              <r.icon className="size-3.5 shrink-0" style={{ color: r.color }} />
              <div>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{r.label}</p>
                <p className="text-white" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Live Telemetry — only for active missions */}
        {lastHb && ["en_route_out", "en_route_back", "arrived_site", "working", "alert"].includes(m.status) && (
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Radio className="size-3.5" style={{ color: "#00C8E0" }} />
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>LIVE TELEMETRY</p>
              <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="size-2 rounded-full ml-auto" style={{ background: "#00C853" }} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: "Speed", value: `${lastHb.speed} km/h`, icon: Navigation, color: lastHb.speed > 120 ? "#FF2D55" : "#00C8E0" },
                { label: "Battery", value: `${lastHb.batteryLevel}%`, icon: lastHb.batteryLevel < 20 ? BatteryLow : Battery, color: lastHb.batteryLevel < 20 ? "#FF2D55" : lastHb.batteryLevel < 40 ? "#FF9500" : "#00C853" },
                { label: "Signal", value: lastHb.internetStatus === "offline" ? "Offline" : lastHb.internetStatus.toUpperCase(), icon: lastHb.internetStatus === "offline" ? WifiOff : Wifi, color: lastHb.internetStatus === "offline" ? "#FF9500" : "#00C853" },
                { label: "GPS", value: lastHb.gpsEnabled ? "Active" : "DISABLED", icon: Locate, color: lastHb.gpsEnabled ? "#00C853" : "#FF2D55" },
              ].map(t => (
                <div key={t.label} className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: `${t.color}06`, border: `1px solid ${t.color}10` }}>
                  <t.icon className="size-3.5" style={{ color: t.color }} />
                  <div>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{t.label}</p>
                    <p style={{ fontSize: 11.5, fontWeight: 700, color: t.color }}>{t.value}</p>
                  </div>
                </div>
              ))}
            </div>
            {lastGPS && (
              <div className="mt-2.5 flex items-center gap-2">
                <MapPin className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                  {lastGPS.lat.toFixed(4)}, {lastGPS.lng.toFixed(4)} · {lastGPS.isOffline ? "Offline" : "Live"} · {fmtTime(lastGPS.timestamp)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Alerts */}
        {m.alerts.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,45,85,0.15)" }}>
            <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: "rgba(255,45,85,0.06)", borderBottom: "1px solid rgba(255,45,85,0.1)" }}>
              <AlertTriangle className="size-3.5" style={{ color: "#FF2D55" }} />
              <p style={{ fontSize: 11, fontWeight: 700, color: "#FF2D55" }}>ALERTS ({m.alerts.length})</p>
            </div>
            <div className="px-4 py-2 space-y-2">
              {m.alerts.map(a => (
                <div key={a.id} className="flex items-start gap-2 py-1.5">
                  <div className="size-1.5 rounded-full mt-1.5 shrink-0" style={{ background: a.severity === "critical" ? "#FF2D55" : "#FF9500" }} />
                  <div className="flex-1">
                    <p className="text-white" style={{ fontSize: 11.5, fontWeight: 600 }}>{a.message}</p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{fmtTime(a.timestamp)} · {a.type.replace(/_/g, " ")}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Phase Timeline */}
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <p className="mb-3" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>MISSION TIMELINE</p>
          {phases.map((p, i) => (
            <div key={p.label} className="flex gap-3 items-start mb-0 last:mb-0">
              <div className="flex flex-col items-center" style={{ width: 14 }}>
                <motion.div
                  animate={p.active ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="size-3 rounded-full shrink-0 flex items-center justify-center"
                  style={{ background: p.done || p.active ? p.color : "rgba(255,255,255,0.08)", border: `2px solid ${p.done || p.active ? p.color : "rgba(255,255,255,0.1)"}` }}
                >
                  {p.done && <CheckCircle2 className="size-2" style={{ color: "#fff" }} />}
                </motion.div>
                {i < phases.length - 1 && <div className="w-0.5 flex-1 my-1" style={{ background: p.done ? `${p.color}40` : "rgba(255,255,255,0.04)", minHeight: 16 }} />}
              </div>
              <div className="flex-1 pb-3">
                <p style={{ fontSize: 12, fontWeight: p.active ? 700 : 600, color: p.done || p.active ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.2)" }}>{p.label}</p>
                {p.time && <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{fmtTime(p.time)}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* GPS Track Stats */}
        {m.gpsTrack.length > 0 && (
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p className="mb-2" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>TRACKING DATA</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "GPS Points", value: `${m.gpsTrack.length + m.returnTrack.length}` },
                { label: "Offline Points", value: `${m.gpsTrack.filter(p => p.isOffline).length + m.returnTrack.filter(p => p.isOffline).length}` },
                { label: "Heartbeats", value: `${m.heartbeats.length}` },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <p className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>{s.value}</p>
                  <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.25)" }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {m.notes && (
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p className="mb-1" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>NOTES</p>
            <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{m.notes}</p>
          </div>
        )}

        {/* Actions */}
        {!["completed", "cancelled"].includes(m.status) && (
          <button onClick={() => onCancel(m.id)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl"
            style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.15)", fontSize: 12, fontWeight: 700, color: "#FF2D55" }}
          >
            <XCircle className="size-4" /> Cancel Mission
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Create Mission Drawer
// ═══════════════════════════════════════════════════════════════

const EMPLOYEES_LIST = [
  { id: "EMP-001", name: "Ahmed Khalil" },
  { id: "EMP-003", name: "Fatima Hassan" },
  { id: "EMP-005", name: "Sara Al-Mutairi" },
  { id: "EMP-006", name: "Mohammed Ali" },
  { id: "EMP-008", name: "Omar Al-Farsi" },
  { id: "EMP-009", name: "Khalid Rahman" },
];

const LOCATIONS = [
  { name: "HQ Gate A", lat: 24.7136, lng: 46.6753 },
  { name: "HQ Gate B", lat: 24.7150, lng: 46.6770 },
  { name: "Zone C Lab", lat: 24.6500, lng: 46.6000 },
  { name: "Zone D Gate", lat: 24.6300, lng: 46.5800 },
  { name: "Warehouse 7", lat: 24.7000, lng: 46.6800 },
  { name: "Remote Station Delta", lat: 24.8500, lng: 46.8200 },
  { name: "Training Center North", lat: 24.7800, lng: 46.7400 },
  { name: "Zone E Logistics Hub", lat: 24.8000, lng: 46.7800 },
  { name: "Emergency Repair Site", lat: 24.7200, lng: 46.7200 },
  { name: "Pipeline Junction B4", lat: 24.7600, lng: 46.7100 },
];

function CreateMissionDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [empId, setEmpId] = useState("");
  const [destIdx, setDestIdx] = useState(-1);
  const [originIdx, setOriginIdx] = useState(0);
  const [vehicle, setVehicle] = useState("Pickup Truck");
  const [notes, setNotes] = useState("");
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30);
    return d.toISOString().slice(0, 16);
  });
  const [duration, setDuration] = useState(4); // hours

  const canSubmit = empId && destIdx >= 0 && originIdx >= 0 && destIdx !== originIdx;

  const handleCreate = () => {
    if (!canSubmit) return;
    const emp = EMPLOYEES_LIST.find(e => e.id === empId)!;
    const origin = LOCATIONS[originIdx];
    const dest = LOCATIONS[destIdx];
    const start = new Date(startTime).getTime();
    createMission({
      employeeId: emp.id,
      employeeName: emp.name,
      assignedBy: "Admin",
      scheduledStart: start,
      scheduledEnd: start + duration * 3600000,
      origin,
      destination: dest,
      returnTo: origin,
      vehicleType: vehicle,
      notes,
    });
    toast.success("Mission Created", { description: `${emp.name} → ${dest.name} at ${fmtTime(start)}` });
    onCreated();
  };

  const selectStyle = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    fontSize: 13, color: "#fff",
    padding: "10px 12px",
    borderRadius: 12,
    outline: "none",
    width: "100%",
  } as const;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl overflow-hidden"
        style={{ background: "#0A1220", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
              <Plus className="size-5" style={{ color: "#00C8E0" }} />
            </div>
            <div>
              <p className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>New Mission</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Assign a field mission to an employee</p>
            </div>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)" }}>
            <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Employee */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>EMPLOYEE</label>
            <select value={empId} onChange={e => setEmpId(e.target.value)} style={selectStyle}>
              <option value="" style={{ background: "#0A1220" }}>Select employee...</option>
              {EMPLOYEES_LIST.map(e => <option key={e.id} value={e.id} style={{ background: "#0A1220" }}>{e.name}</option>)}
            </select>
          </div>

          {/* Origin + Destination */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>FROM</label>
              <select value={originIdx} onChange={e => setOriginIdx(Number(e.target.value))} style={selectStyle}>
                {LOCATIONS.map((l, i) => <option key={i} value={i} style={{ background: "#0A1220" }}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>TO</label>
              <select value={destIdx} onChange={e => setDestIdx(Number(e.target.value))} style={selectStyle}>
                <option value={-1} style={{ background: "#0A1220" }}>Select destination...</option>
                {LOCATIONS.map((l, i) => <option key={i} value={i} style={{ background: "#0A1220" }}>{l.name}</option>)}
              </select>
            </div>
          </div>

          {/* Schedule */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>START TIME</label>
              <input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} style={selectStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>DURATION (HOURS)</label>
              <input type="number" min={1} max={24} value={duration} onChange={e => setDuration(Number(e.target.value))} style={selectStyle} />
            </div>
          </div>

          {/* Vehicle */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>VEHICLE</label>
            <select value={vehicle} onChange={e => setVehicle(e.target.value)} style={selectStyle}>
              {["Pickup Truck", "Van", "Company Car", "Service Truck", "Motorcycle", "On Foot"].map(v => (
                <option key={v} value={v} style={{ background: "#0A1220" }}>{v}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>NOTES</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Special instructions..."
              className="text-white placeholder:text-white/20 resize-none" style={{ ...selectStyle, padding: "10px 12px" }} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-end gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>
            Cancel
          </button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={handleCreate} disabled={!canSubmit}
            className="px-6 py-2.5 rounded-xl flex items-center gap-2"
            style={{
              background: canSubmit ? "linear-gradient(135deg, #00C8E0, #0088A8)" : "rgba(255,255,255,0.04)",
              fontSize: 13, fontWeight: 700,
              color: canSubmit ? "#fff" : "rgba(255,255,255,0.15)",
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            <Send className="size-4" /> Create Mission
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
