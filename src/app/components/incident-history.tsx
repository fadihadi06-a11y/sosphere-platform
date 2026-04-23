import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, Shield, Clock, MapPin, Phone, PhoneMissed,
  CheckCircle, AlertTriangle, FileText, Download, Lock,
  Filter, Search, Calendar, ChevronRight, ChevronDown,
  Mic, Zap, Timer, X, Eye, Trash2, Share2,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
type IncidentType = "sos" | "checkin_expired" | "dms_auto";
type IncidentSeverity = "critical" | "high" | "medium" | "resolved";

interface IncidentEvent {
  time: string;
  title: string;
  detail?: string;
  type: "sos_start" | "call_out" | "answered" | "no_answer" | "sms_sent" | "recording" | "sos_end" | "dms_trigger";
}

interface Incident {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  date: Date;
  duration: number; // seconds
  triggerMethod: string;
  location: { address: string; lat: number; lng: number };
  contactsCalled: number;
  contactsAnswered: number;
  hasRecording: boolean;
  recordingDuration?: number;
  resolved: boolean;
  events: IncidentEvent[];
}

// ─── Real record converter ────────────────────────────────────────────────────
function loadRealIncidents(): Incident[] {
  try {
    const raw = JSON.parse(localStorage.getItem("sosphere_incident_history") || "[]");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return raw.map((r: any): Incident => {
      const start = new Date(r.startTime);
      const end   = r.endTime ? new Date(r.endTime) : new Date(start.getTime() + (r.cyclesCompleted || 1) * 30000);
      const duration = Math.round((end.getTime() - start.getTime()) / 1000);
      const contactsAnswered = (r.contacts || []).filter((c: any) => c.status === "answered").length;
      const contactsCalled   = (r.contacts || []).length;
      const events: IncidentEvent[] = (r.events || []).map((e: any): IncidentEvent => {
        const typeMap: Record<string, IncidentEvent["type"]> = {
          sos_triggered: "sos_start", call_out: "call_out", answered: "answered",
          no_answer: "no_answer", sms_sent: "sms_sent", recording_start: "recording",
          sos_ended: "sos_end", dms_trigger: "dms_trigger",
        };
        return {
          time: new Date(e.timestamp || start).toLocaleTimeString("en-US", { hour12: false }),
          title: e.label || e.type,
          detail: e.detail,
          type: typeMap[e.type] || "sos_start",
        };
      });
      // Ensure at minimum a start event
      if (events.length === 0) {
        events.push({ time: start.toLocaleTimeString("en-US", { hour12: false }), title: "SOS Activated", detail: `Trigger: ${r.triggerMethod || "Hold 3s"}`, type: "sos_start" });
        events.push({ time: end.toLocaleTimeString("en-US", { hour12: false }), title: "SOS Ended", type: "sos_end" });
      }
      return {
        id: r.id || `ERR-${start.getTime().toString(36).toUpperCase()}`,
        type: "sos" as IncidentType,
        severity: contactsAnswered > 0 ? "resolved" : "critical",
        date: start,
        duration,
        triggerMethod: r.triggerMethod === "hold" ? "Hold 3s" : r.triggerMethod === "shake" ? "Shake ×3" : r.triggerMethod === "volume" ? "Volume btn" : "Hold 3s",
        location: r.location || { address: "Unknown location", lat: 0, lng: 0 },
        contactsCalled,
        contactsAnswered,
        hasRecording: !!r.photos?.length || !!r.recordingSeconds,
        recordingDuration: r.recordingSeconds || undefined,
        resolved: contactsAnswered > 0,
        events,
      };
    });
  } catch { return []; }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullDate(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function relativeDate(d: Date) {
  const now = new Date(); // real current date
  const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  return `${Math.floor(diff / 30)}mo ago`;
}

const typeConfig: Record<IncidentType, { label: string; color: string; icon: typeof Zap }> = {
  sos: { label: "SOS Alert", color: "#FF2D55", icon: Zap },
  checkin_expired: { label: "Timer Expired", color: "#FF9500", icon: Timer },
  dms_auto: { label: "Auto-SOS", color: "#FF9500", icon: AlertTriangle },
};

const severityConfig: Record<IncidentSeverity, { label: string; color: string; bg: string }> = {
  critical: { label: "Critical", color: "#FF2D55", bg: "rgba(255,45,85,0.08)" },
  high: { label: "High", color: "#FF9500", bg: "rgba(255,150,0,0.08)" },
  medium: { label: "Medium", color: "#FFD700", bg: "rgba(255,215,0,0.08)" },
  resolved: { label: "Resolved", color: "#00C853", bg: "rgba(0,200,83,0.08)" },
};

const eventIconMap: Record<string, { Icon: typeof Zap; color: string }> = {
  sos_start: { Icon: Zap, color: "#FF2D55" },
  call_out: { Icon: Phone, color: "#00C8E0" },
  answered: { Icon: CheckCircle, color: "#00C853" },
  no_answer: { Icon: PhoneMissed, color: "#FF9500" },
  sms_sent: { Icon: FileText, color: "#00C853" },
  recording: { Icon: Mic, color: "#FF2D55" },
  sos_end: { Icon: Shield, color: "#00C8E0" },
  dms_trigger: { Icon: Timer, color: "#FF9500" },
};

// ─── Props ─────────────────────────────────────────────────────────────────────
interface IncidentHistoryProps {
  onBack: () => void;
  userPlan: "free" | "pro" | "employee";
  onUpgrade?: () => void;
}

type FilterType = "all" | "sos" | "checkin_expired" | "dms_auto";

// ─── Component ─────────────────────────────────────────────────────────────────
export function IncidentHistory({ onBack, userPlan, onUpgrade }: IncidentHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [realIncidents, setRealIncidents] = useState<Incident[]>(() => loadRealIncidents());

  // Re-load when localStorage changes (new SOS just ended in same session)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "sosphere_incident_history") setRealIncidents(loadRealIncidents());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Real incidents only — no demo/mock fallback (cleaned 2026-04-23)
  const allIncidents: Incident[] = realIncidents;

  const isPro = userPlan === "pro" || userPlan === "employee";

  // Free users: 7 days
  const visibleIncidents = allIncidents
    .filter(inc => !deletedIds.includes(inc.id))
    .filter(inc => {
      if (!isPro) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return inc.date >= sevenDaysAgo;
      }
      return true;
    })
    .filter(inc => filter === "all" || inc.type === filter)
    .filter(inc => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        inc.id.toLowerCase().includes(q) ||
        inc.location.address.toLowerCase().includes(q) ||
        inc.triggerMethod.toLowerCase().includes(q)
      );
    });

  const hiddenCount = allIncidents.filter(inc => {
    if (isPro) return false;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return inc.date < sevenDaysAgo;
  }).length;

  const totalStats = {
    total: allIncidents.filter(inc => !deletedIds.includes(inc.id)).length,
    resolved: allIncidents.filter(inc => !deletedIds.includes(inc.id) && inc.resolved).length,
    avgDuration: allIncidents.length > 0 ? Math.round(allIncidents.reduce((a, b) => a + b.duration, 0) / allIncidents.length) : 0,
    avgResponse: allIncidents.length > 0 ? Math.round(allIncidents.filter(inc => inc.contactsAnswered > 0).length / allIncidents.length * 100) : 0,
  };

  const filters: { id: FilterType; label: string; count: number }[] = [
    { id: "all", label: "All", count: allIncidents.filter(i => !deletedIds.includes(i.id)).length },
    { id: "sos", label: "SOS", count: allIncidents.filter(i => !deletedIds.includes(i.id) && i.type === "sos").length },
    { id: "checkin_expired", label: "Timer", count: allIncidents.filter(i => !deletedIds.includes(i.id) && i.type === "checkin_expired").length },
    { id: "dms_auto", label: "Auto", count: allIncidents.filter(i => !deletedIds.includes(i.id) && i.type === "dms_auto").length },
  ];

  const handleDelete = (id: string) => {
    setDeletedIds(prev => [...prev, id]);
    setShowDeleteConfirm(null);
    if (expandedId === id) setExpandedId(null);
  };

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      {/* Ambient */}
      <div
        data-ambient-glow
        className="absolute top-[-80px] left-1/2 -translate-x-1/2 pointer-events-none"
        style={{ width: 500, height: 350, background: "radial-gradient(ellipse, rgba(0,200,224,0.03) 0%, transparent 60%)" }}
      />

      {/* Header */}
      <div className="shrink-0 pt-[58px] px-5 pb-2">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="flex items-center gap-1 -ml-1 p-1">
            <ChevronLeft style={{ width: 20, height: 20, color: "#00C8E0" }} />
            <span style={{ fontSize: 15, color: "#00C8E0", fontWeight: 500 }}>Back</span>
          </button>
          <div className="flex items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowSearch(v => !v)}
              className="p-2 rounded-xl"
              style={{
                background: showSearch ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${showSearch ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.05)"}`,
              }}
            >
              <Search style={{ width: 16, height: 16, color: showSearch ? "#00C8E0" : "rgba(255,255,255,0.3)" }} />
            </motion.button>
          </div>
        </div>

        {/* Title */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-3">
          <div className="flex items-center gap-2.5 mb-1">
            <Clock style={{ width: 18, height: 18, color: "#00C8E0" }} />
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.4px" }}>Incident History</h1>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
            {isPro ? "Complete incident archive" : `Last 7 days · ${hiddenCount > 0 ? `${hiddenCount} older hidden` : "All visible"}`}
          </p>
        </motion.div>

        {/* Search Bar */}
        <AnimatePresence>
          {showSearch && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-3 overflow-hidden"
            >
              <div
                className="flex items-center gap-2.5 px-3.5 py-2.5"
                style={{
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <Search style={{ width: 14, height: 14, color: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by ID, location..."
                  className="flex-1 bg-transparent text-white outline-none"
                  style={{ fontSize: 13, caretColor: "#00C8E0" }}
                  autoFocus
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")}>
                    <X style={{ width: 14, height: 14, color: "rgba(255,255,255,0.2)" }} />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex gap-2 mb-3"
        >
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="flex items-center gap-1.5 px-3 py-1.5"
              style={{
                borderRadius: 10,
                fontSize: 12,
                fontWeight: filter === f.id ? 700 : 500,
                background: filter === f.id ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${filter === f.id ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}`,
                color: filter === f.id ? "#00C8E0" : "rgba(255,255,255,0.25)",
              }}
            >
              {f.label}
              <span style={{
                fontSize: 9, fontWeight: 700,
                color: filter === f.id ? "rgba(0,200,224,0.6)" : "rgba(255,255,255,0.12)",
              }}>
                {f.count}
              </span>
            </button>
          ))}
        </motion.div>

        {/* Stats Bar */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="grid grid-cols-4 gap-1.5 mb-2"
        >
          {[
            { label: "Total", value: totalStats.total, color: "#00C8E0" },
            { label: "Resolved", value: `${totalStats.resolved}/${totalStats.total}`, color: "#00C853" },
            { label: "Avg Time", value: formatDuration(totalStats.avgDuration), color: "#FF9500" },
            { label: "Response", value: `${totalStats.avgResponse}%`, color: "#00C8E0" },
          ].map(s => (
            <div
              key={s.label}
              className="py-2 text-center"
              style={{ borderRadius: 10, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
            >
              <p style={{ fontSize: 14, fontWeight: 800, color: s.color }}>{s.value}</p>
              <p style={{ fontSize: 8, fontWeight: 500, color: "rgba(255,255,255,0.15)", letterSpacing: "0.3px" }}>{s.label}</p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Incident List */}
      <div className="flex-1 overflow-y-auto px-5 pb-10" style={{ scrollbarWidth: "none" }}>
        {visibleIncidents.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16">
            <Shield style={{ width: 36, height: 36, color: "rgba(255,255,255,0.06)", marginBottom: 12 }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.15)" }}>No incidents found</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.08)", marginTop: 4 }}>
              {searchQuery ? "Try a different search" : "You're safe!"}
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2.5">
            <AnimatePresence>
              {visibleIncidents.map((inc, i) => {
                const tc = typeConfig[inc.type];
                const sc = severityConfig[inc.severity];
                const isExpanded = expandedId === inc.id;
                const TypeIcon = tc.icon;
                const ei = eventIconMap;

                return (
                  <motion.div
                    key={inc.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -80, height: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.3 }}
                  >
                    {/* Card */}
                    <div
                      style={{
                        borderRadius: 18,
                        background: isExpanded ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.015)",
                        border: `1px solid ${isExpanded ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.04)"}`,
                        overflow: "hidden",
                      }}
                    >
                      {/* Main Row */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : inc.id)}
                        className="w-full flex items-center gap-3 p-4 text-left"
                      >
                        {/* Type Icon */}
                        <div
                          className="size-10 rounded-[12px] flex items-center justify-center shrink-0"
                          style={{ background: `${tc.color}10`, border: `1px solid ${tc.color}18` }}
                        >
                          <TypeIcon style={{ width: 16, height: 16, color: tc.color }} />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-white truncate" style={{ fontSize: 14, fontWeight: 600 }}>{tc.label}</p>
                            <div
                              className="px-1.5 py-[1px] shrink-0"
                              style={{ borderRadius: 5, background: sc.bg, border: `1px solid ${sc.color}20` }}
                            >
                              <span style={{ fontSize: 8, fontWeight: 700, color: sc.color, letterSpacing: "0.3px" }}>
                                {sc.label.toUpperCase()}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                              {formatDate(inc.date)} · {formatTime(inc.date)}
                            </span>
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.1)" }}>
                              {relativeDate(inc.date)}
                            </span>
                          </div>
                        </div>

                        {/* Duration + Chevron */}
                        <div className="flex items-center gap-2 shrink-0">
                          <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>
                            {formatDuration(inc.duration)}
                          </span>
                          <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                            <ChevronDown style={{ width: 14, height: 14, color: "rgba(255,255,255,0.12)" }} />
                          </motion.div>
                        </div>
                      </button>

                      {/* Expanded Content */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 space-y-3" style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)", paddingTop: 12 }}>
                              {/* Quick Info Cards */}
                              <div className="grid grid-cols-3 gap-2 pt-3">
                                <div className="py-2 text-center" style={{ borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                                  <div className="flex items-center justify-center gap-1 mb-1">
                                    <Phone style={{ width: 10, height: 10, color: "#00C8E0" }} />
                                    <span style={{ fontSize: 14, fontWeight: 800, color: "#00C8E0" }}>{inc.contactsCalled}</span>
                                  </div>
                                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>Calls Made</span>
                                </div>
                                <div className="py-2 text-center" style={{ borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                                  <div className="flex items-center justify-center gap-1 mb-1">
                                    <CheckCircle style={{ width: 10, height: 10, color: "#00C853" }} />
                                    <span style={{ fontSize: 14, fontWeight: 800, color: "#00C853" }}>{inc.contactsAnswered}</span>
                                  </div>
                                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>Answered</span>
                                </div>
                                <div className="py-2 text-center" style={{ borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                                  <div className="flex items-center justify-center gap-1 mb-1">
                                    <Mic style={{ width: 10, height: 10, color: inc.hasRecording ? "#FF2D55" : "rgba(255,255,255,0.1)" }} />
                                    <span style={{ fontSize: 14, fontWeight: 800, color: inc.hasRecording ? "#FF2D55" : "rgba(255,255,255,0.1)" }}>
                                      {inc.hasRecording ? `${inc.recordingDuration}s` : "—"}
                                    </span>
                                  </div>
                                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>Recording</span>
                                </div>
                              </div>

                              {/* Location */}
                              <div
                                className="flex items-center gap-2.5 px-3 py-2.5"
                                style={{ borderRadius: 12, background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.06)" }}
                              >
                                <MapPin style={{ width: 13, height: 13, color: "#00C8E0", flexShrink: 0 }} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 500 }}>{inc.location.address}</p>
                                  <p style={{ fontSize: 9, color: "rgba(0,200,224,0.4)" }}>{inc.location.lat}°N, {inc.location.lng}°E</p>
                                </div>
                              </div>

                              {/* Mini Timeline */}
                              <div>
                                <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", marginBottom: 6, textTransform: "uppercase" }}>
                                  Timeline · {inc.events.length} events
                                </p>
                                <div className="space-y-1 relative">
                                  {/* Timeline line */}
                                  <div
                                    className="absolute left-[9px] top-2 bottom-2"
                                    style={{ width: 1, background: "rgba(255,255,255,0.04)" }}
                                  />
                                  {inc.events.map((ev, ei_idx) => {
                                    const em = ei[ev.type] || { Icon: Clock, color: "rgba(255,255,255,0.2)" };
                                    const EvIcon = em.Icon;
                                    return (
                                      <div key={ei_idx} className="flex items-start gap-2.5">
                                        <div
                                          className="size-[18px] rounded-full flex items-center justify-center shrink-0 z-10"
                                          style={{ background: `${em.color}15`, border: `1px solid ${em.color}25` }}
                                        >
                                          <EvIcon style={{ width: 8, height: 8, color: em.color }} />
                                        </div>
                                        <div className="flex-1 min-w-0 py-0.5">
                                          <div className="flex items-center justify-between gap-2">
                                            <p className="truncate" style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.5)" }}>
                                              {ev.title}
                                            </p>
                                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", flexShrink: 0 }}>{ev.time}</span>
                                          </div>
                                          {ev.detail && (
                                            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", marginTop: 1 }}>{ev.detail}</p>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex gap-2 pt-1">
                                {isPro && (
                                  <motion.button
                                    whileTap={{ scale: 0.97 }}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5"
                                    style={{
                                      borderRadius: 12,
                                      background: "rgba(0,200,224,0.06)",
                                      border: "1px solid rgba(0,200,224,0.12)",
                                      fontSize: 11, fontWeight: 600, color: "#00C8E0",
                                    }}
                                  >
                                    <Download style={{ width: 12, height: 12 }} />
                                    Export PDF
                                  </motion.button>
                                )}
                                {!isPro && (
                                  <motion.button
                                    whileTap={{ scale: 0.97 }}
                                    onClick={onUpgrade}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5"
                                    style={{
                                      borderRadius: 12,
                                      background: "rgba(255,150,0,0.06)",
                                      border: "1px solid rgba(255,150,0,0.12)",
                                      fontSize: 11, fontWeight: 600, color: "#FF9500",
                                    }}
                                  >
                                    <Lock style={{ width: 12, height: 12 }} />
                                    Export (Pro)
                                  </motion.button>
                                )}
                                <motion.button
                                  whileTap={{ scale: 0.97 }}
                                  className="flex items-center justify-center gap-1.5 px-4 py-2.5"
                                  style={{
                                    borderRadius: 12,
                                    background: "rgba(255,255,255,0.02)",
                                    border: "1px solid rgba(255,255,255,0.05)",
                                    fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.25)",
                                  }}
                                >
                                  <Share2 style={{ width: 12, height: 12 }} />
                                </motion.button>
                                <motion.button
                                  whileTap={{ scale: 0.97 }}
                                  onClick={() => setShowDeleteConfirm(inc.id)}
                                  className="flex items-center justify-center px-3 py-2.5"
                                  style={{
                                    borderRadius: 12,
                                    background: "rgba(255,45,85,0.04)",
                                    border: "1px solid rgba(255,45,85,0.08)",
                                  }}
                                >
                                  <Trash2 style={{ width: 12, height: 12, color: "rgba(255,45,85,0.4)" }} />
                                </motion.button>
                              </div>

                              {/* ID */}
                              <div className="flex items-center justify-between pt-1">
                                <span style={{ fontSize: 9, color: "rgba(0,200,224,0.25)", fontWeight: 600, letterSpacing: "0.5px" }}>
                                  {inc.id}
                                </span>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.08)" }}>
                                  {inc.triggerMethod}
                                </span>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* Pro Unlock Banner for Free users */}
        {!isPro && hiddenCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-4"
          >
            <button
              onClick={onUpgrade}
              className="w-full p-4 text-left relative overflow-hidden"
              style={{
                borderRadius: 18,
                background: "linear-gradient(135deg, rgba(0,200,224,0.04) 0%, rgba(0,200,224,0.01) 100%)",
                border: "1px solid rgba(0,200,224,0.08)",
              }}
            >
              <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(0,200,224,0.08), transparent 70%)" }}
              />
              <div className="flex items-center gap-3 relative z-10">
                <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.12)" }}>
                  <Lock style={{ width: 16, height: 16, color: "#00C8E0" }} />
                </div>
                <div className="flex-1">
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>
                    {hiddenCount} older incidents hidden
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                    Upgrade to Pro for unlimited history + PDF export
                  </p>
                </div>
                <ChevronRight style={{ width: 16, height: 16, color: "rgba(0,200,224,0.3)" }} />
              </div>
            </button>
          </motion.div>
        )}

        {/* Integrity Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-6 flex items-center justify-center gap-2"
        >
          <Shield style={{ width: 10, height: 10, color: "rgba(0,200,224,0.15)" }} />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.08)" }}>
            All records have audit trails
          </span>
        </motion.div>
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <>
            <motion.div
              key="del-bg"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.85)" }}
              onClick={() => setShowDeleteConfirm(null)}
            />
            <motion.div
              key="del-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="absolute inset-x-10 z-50 p-5"
              style={{
                top: "50%", transform: "translateY(-50%)",
                borderRadius: 22, background: "rgba(10,18,32,0.98)",
                border: "1px solid rgba(255,45,85,0.12)",
              }}
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)" }}>
                  <AlertTriangle style={{ width: 16, height: 16, color: "#FF2D55" }} />
                </div>
                <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>Delete Record?</p>
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", lineHeight: 1.6, marginBottom: 16 }}>
                This incident record will be permanently deleted. This action cannot be undone and may affect legal documentation.
              </p>
              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="flex-1 py-3"
                  style={{
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.4)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(showDeleteConfirm)}
                  className="flex-1 py-3"
                  style={{
                    borderRadius: 14,
                    background: "rgba(255,45,85,0.1)",
                    border: "1px solid rgba(255,45,85,0.2)",
                    fontSize: 14, fontWeight: 600, color: "#FF2D55",
                  }}
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}