import { useState, useEffect, useCallback, forwardRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Send, Megaphone, Users, MapPin, Shield, Clock, Trash2,
  AlertTriangle, Siren, Info, Bell, ChevronDown, Check,
  X, Eye, Radio, Zap, Building2, Filter, Target,
  DollarSign, Satellite, MessageSquare, UserCheck,
  ArrowUpRight, Calendar, Ban, TrendingUp,
} from "lucide-react";
import {
  sendBroadcast, getBroadcasts, deleteBroadcast, onBroadcastReceived,
  ZONE_OPTIONS, ROLE_OPTIONS, DEPT_OPTIONS,
  type BroadcastMessage, type BroadcastAudience, type BroadcastPriority,
  checkEscalations, getEscalationLog, type EscalationEntry,
  ESCALATION_TIMEOUT_DEMO_MS,
  scheduleBroadcast, getScheduledBroadcasts, cancelScheduledBroadcast,
  processScheduledBroadcasts, type ScheduledBroadcast,
} from "./shared-store";

// ═══════════════════════════════════════════════════════════════
// Broadcast & Alert Center — Hybrid Chat + Emergency Notifications
// Zero-cost in-app messaging system replacing SMS ($0/month)
// ═══════════════════════════════════════════════════════════════

const PRIORITY_CONFIG: Record<BroadcastPriority, { label: string; color: string; bg: string; border: string; icon: any }> = {
  emergency: { label: "EMERGENCY", color: "#FF2D55", bg: "rgba(255,45,85,0.06)", border: "rgba(255,45,85,0.12)", icon: Siren },
  urgent: { label: "URGENT", color: "#FF9500", bg: "rgba(255,150,0,0.06)", border: "rgba(255,150,0,0.12)", icon: AlertTriangle },
  normal: { label: "NORMAL", color: "#00C8E0", bg: "rgba(0,200,224,0.06)", border: "rgba(0,200,224,0.12)", icon: Bell },
  info: { label: "INFO", color: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.06)", icon: Info },
};

const SOURCE_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  manual: { label: "Manual", color: "#00C8E0", icon: UserCheck },
  auto_gps: { label: "GPS System", color: "#FF9500", icon: Satellite },
  auto_sos: { label: "SOS System", color: "#FF2D55", icon: Siren },
  auto_hazard: { label: "Hazard System", color: "#FF9500", icon: AlertTriangle },
  auto_geofence: { label: "Geofence", color: "#FF2D55", icon: Shield },
  auto_checkin: { label: "Check-in", color: "#00C853", icon: Check },
};

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "Just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Quick templates ───────────────────────────────────────────
const TEMPLATES = [
  { title: "Team Meeting", body: "Meeting at {time} in {location}. Attendance required.", priority: "normal" as const, icon: "📋" },
  { title: "Safety Briefing", body: "Mandatory safety briefing at {time}. All field workers must attend.", priority: "urgent" as const, icon: "🦺" },
  { title: "Zone Evacuation", body: "Immediately evacuate {zone}. Follow emergency exit routes.", priority: "emergency" as const, icon: "🚨" },
  { title: "Weather Alert", body: "Severe weather warning. Secure equipment and proceed to sheltered areas.", priority: "urgent" as const, icon: "⛈️" },
  { title: "Shift Change", body: "Shift change in 15 minutes. Handover reports due.", priority: "info" as const, icon: "🔄" },
  { title: "Equipment Notice", body: "Equipment {id} requires maintenance. Do not operate until cleared.", priority: "normal" as const, icon: "🔧" },
];

// ── Compose Drawer ────────────────────────────────────────────
function ComposeDrawer({ onClose, onSend }: {
  onClose: () => void;
  onSend: (msg: Omit<BroadcastMessage, "id" | "readBy">) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<BroadcastPriority>("normal");
  const [audienceType, setAudienceType] = useState<"all" | "role" | "zone" | "department">("all");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  const toggleItem = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item]);
  };

  const getAudience = (): BroadcastAudience => {
    if (audienceType === "role") return { type: "role", roles: selectedRoles as any[] };
    if (audienceType === "zone") return { type: "zone", zoneIds: selectedZones };
    if (audienceType === "department") return { type: "department", departments: selectedDepts };
    return { type: "all" };
  };

  const getAudienceLabel = (): string => {
    if (audienceType === "role") return selectedRoles.map(r => ROLE_OPTIONS.find(o => o.id === r)?.label).join(", ") || "Select roles";
    if (audienceType === "zone") return selectedZones.map(z => ZONE_OPTIONS.find(o => o.id === z)?.name).join(", ") || "Select zones";
    if (audienceType === "department") return selectedDepts.join(", ") || "Select departments";
    return "All Company";
  };

  const canSend = title.trim() && body.trim() && (
    audienceType === "all" ||
    (audienceType === "role" && selectedRoles.length > 0) ||
    (audienceType === "zone" && selectedZones.length > 0) ||
    (audienceType === "department" && selectedDepts.length > 0)
  );

  const handleSend = () => {
    if (!canSend) return;
    onSend({
      title: title.trim(),
      body: body.trim(),
      priority,
      audience: getAudience(),
      audienceLabel: getAudienceLabel(),
      source: "manual",
      senderName: "Admin",
      senderRole: "Company Admin",
      timestamp: Date.now(),
    });
    onClose();
  };

  const applyTemplate = (tpl: typeof TEMPLATES[0]) => {
    setTitle(tpl.title);
    setBody(tpl.body);
    setPriority(tpl.priority);
    setShowTemplates(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto"
        style={{
          borderRadius: 20,
          background: "linear-gradient(135deg, #0A1220 0%, #080E1A 100%)",
          border: "1px solid rgba(0,200,224,0.1)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 60px rgba(0,200,224,0.05)",
          scrollbarWidth: "none",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
              <Megaphone style={{ width: 18, height: 18, color: "#00C8E0" }} />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>New Broadcast</h2>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>Send to employees in-app (free)</p>
            </div>
          </div>
          <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)" }}>
            <X style={{ width: 14, height: 14, color: "rgba(255,255,255,0.3)" }} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Templates */}
          <div>
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg w-full"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}
            >
              <Zap style={{ width: 12, height: 12 }} />
              Quick Templates
              <ChevronDown style={{ width: 12, height: 12, marginLeft: "auto", transform: showTemplates ? "rotate(180deg)" : "none", transition: "0.2s" }} />
            </button>
            <AnimatePresence>
              {showTemplates && (
                <motion.div
                  key="compose-templates"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {TEMPLATES.map((tpl, i) => (
                      <button
                        key={`BC-${tpl.title.replace(/\s+/g,'')}-${i}`}
                        onClick={() => applyTemplate(tpl)}
                        className="p-2.5 rounded-lg text-left transition-all hover:scale-[1.02]"
                        style={{ background: PRIORITY_CONFIG[tpl.priority].bg, border: `1px solid ${PRIORITY_CONFIG[tpl.priority].border}` }}
                      >
                        <span style={{ fontSize: 16 }}>{tpl.icon}</span>
                        <p className="mt-1" style={{ fontSize: 10, fontWeight: 700, color: PRIORITY_CONFIG[tpl.priority].color }}>{tpl.title}</p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Priority */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>PRIORITY</label>
            <div className="flex gap-2">
              {(["emergency", "urgent", "normal", "info"] as const).map(p => {
                const cfg = PRIORITY_CONFIG[p];
                const active = priority === p;
                const PIcon = cfg.icon;
                return (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all"
                    style={{
                      background: active ? cfg.bg : "rgba(255,255,255,0.02)",
                      border: `1px solid ${active ? cfg.border : "rgba(255,255,255,0.04)"}`,
                      boxShadow: active ? `0 0 12px ${cfg.color}15` : "none",
                    }}
                  >
                    <PIcon style={{ width: 12, height: 12, color: active ? cfg.color : "rgba(255,255,255,0.15)" }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: active ? cfg.color : "rgba(255,255,255,0.15)", letterSpacing: "0.3px" }}>
                      {cfg.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audience selector */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>AUDIENCE</label>
            <div className="flex gap-2 mb-3">
              {([
                { id: "all", label: "All Company", icon: Building2 },
                { id: "role", label: "By Role", icon: Shield },
                { id: "zone", label: "By Zone", icon: MapPin },
                { id: "department", label: "By Dept", icon: Users },
              ] as const).map(a => {
                const active = audienceType === a.id;
                const AIcon = a.icon;
                return (
                  <button
                    key={a.id}
                    onClick={() => setAudienceType(a.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all"
                    style={{
                      background: active ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${active ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
                    }}
                  >
                    <AIcon style={{ width: 12, height: 12, color: active ? "#00C8E0" : "rgba(255,255,255,0.15)" }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: active ? "#00C8E0" : "rgba(255,255,255,0.15)" }}>
                      {a.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Sub-selectors */}
            {audienceType === "role" && (
              <div className="flex gap-2 flex-wrap">
                {ROLE_OPTIONS.map(r => {
                  const sel = selectedRoles.includes(r.id);
                  return (
                    <button key={r.id} onClick={() => toggleItem(selectedRoles, r.id, setSelectedRoles)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
                      style={{ background: sel ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.06)"}` }}>
                      {sel && <Check style={{ width: 10, height: 10, color: "#00C8E0" }} />}
                      <span style={{ fontSize: 11, fontWeight: sel ? 700 : 500, color: sel ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>{r.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {audienceType === "zone" && (
              <div className="flex gap-2 flex-wrap">
                {ZONE_OPTIONS.map(z => {
                  const sel = selectedZones.includes(z.id);
                  return (
                    <button key={z.id} onClick={() => toggleItem(selectedZones, z.id, setSelectedZones)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
                      style={{ background: sel ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.06)"}` }}>
                      {sel && <Check style={{ width: 10, height: 10, color: "#00C8E0" }} />}
                      <span style={{ fontSize: 10, fontWeight: sel ? 700 : 500, color: sel ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>{z.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {audienceType === "department" && (
              <div className="flex gap-2 flex-wrap">
                {DEPT_OPTIONS.map(d => {
                  const sel = selectedDepts.includes(d);
                  return (
                    <button key={d} onClick={() => toggleItem(selectedDepts, d, setSelectedDepts)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
                      style={{ background: sel ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.06)"}` }}>
                      {sel && <Check style={{ width: 10, height: 10, color: "#00C8E0" }} />}
                      <span style={{ fontSize: 10, fontWeight: sel ? 700 : 500, color: sel ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>{d}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {audienceType === "all" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.1)" }}>
                <Building2 style={{ width: 14, height: 14, color: "#00C853" }} />
                <span style={{ fontSize: 11, color: "#00C853", fontWeight: 600 }}>Everyone in the company will receive this</span>
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>TITLE</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g., Team Meeting at 2 PM"
              maxLength={150}
              className="w-full px-4 py-2.5 rounded-xl outline-none"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#fff", fontSize: 13, fontWeight: 600,
              }}
            />
          </div>

          {/* Body */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>MESSAGE</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Type your message here..."
              rows={3}
              maxLength={500}
              className="w-full px-4 py-2.5 rounded-xl outline-none resize-none"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#fff", fontSize: 12,
                scrollbarWidth: "none",
              }}
            />
          </div>

          {/* Send button */}
          <div className="flex items-center gap-3 pt-2">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleSend}
              disabled={!canSend}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
              style={{
                background: canSend
                  ? `linear-gradient(135deg, ${PRIORITY_CONFIG[priority].color}, ${PRIORITY_CONFIG[priority].color}AA)`
                  : "rgba(255,255,255,0.04)",
                color: canSend ? "#fff" : "rgba(255,255,255,0.15)",
                fontSize: 13, fontWeight: 800,
                boxShadow: canSend ? `0 4px 20px ${PRIORITY_CONFIG[priority].color}30` : "none",
                opacity: canSend ? 1 : 0.5,
              }}
            >
              <Send style={{ width: 14, height: 14 }} />
              Send Broadcast
            </motion.button>

            {/* Cost indicator */}
            <div className="flex items-center gap-1 px-3 py-2 rounded-lg" style={{ background: "rgba(0,200,83,0.05)", border: "1px solid rgba(0,200,83,0.1)" }}>
              <DollarSign style={{ width: 12, height: 12, color: "#00C853" }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: "#00C853" }}>$0</span>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Message Card ──────────────────────────────────────────────
const MessageCard = forwardRef<HTMLDivElement, { msg: BroadcastMessage; onDelete: () => void }>(
  ({ msg, onDelete }, ref) => {
    const pCfg = PRIORITY_CONFIG[msg.priority];
    const PIcon = pCfg.icon;
    const src = SOURCE_LABELS[msg.source] || SOURCE_LABELS.manual;
    const SrcIcon = src.icon;
    const isAuto = msg.source !== "manual";

    return (
      <motion.div
        ref={ref}
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className="group"
        style={{
          borderRadius: 14,
          background: pCfg.bg,
          border: `1px solid ${pCfg.border}`,
          marginBottom: 8,
          overflow: "hidden",
        }}
      >
      <div className="px-4 py-3">
        {/* Top row */}
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${pCfg.color}12`, border: `1px solid ${pCfg.color}20` }}>
            <PIcon style={{ width: 16, height: 16, color: pCfg.color }} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{msg.title}</span>
              <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 800, color: pCfg.color, background: `${pCfg.color}12`, letterSpacing: "0.3px" }}>
                {pCfg.label}
              </span>
            </div>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>{msg.body}</p>
          </div>

          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity size-7 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.1)" }}
          >
            <Trash2 style={{ width: 12, height: 12, color: "#FF2D55" }} />
          </button>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 mt-3 pt-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
          {/* Source */}
          <div className="flex items-center gap-1">
            <SrcIcon style={{ width: 10, height: 10, color: src.color }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: src.color }}>
              {isAuto ? "Auto" : msg.senderName}
            </span>
          </div>

          {/* Audience */}
          <div className="flex items-center gap-1">
            <Target style={{ width: 10, height: 10, color: "rgba(255,255,255,0.15)" }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.2)" }}>{msg.audienceLabel}</span>
          </div>

          {/* Time */}
          <div className="flex items-center gap-1">
            <Clock style={{ width: 10, height: 10, color: "rgba(255,255,255,0.1)" }} />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>{timeAgo(msg.timestamp)}</span>
          </div>

          {/* Read count */}
          <div className="flex items-center gap-1 ml-auto">
            <Eye style={{ width: 10, height: 10, color: "rgba(255,255,255,0.1)" }} />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
              {msg.readBy.length} read
            </span>
          </div>
        </div>
      </div>
    </motion.div>
    );
  }
);
MessageCard.displayName = "MessageCard";

// ── Smart Escalation Panel ────────────────────────────────────
function EscalationPanel({ log, totalEscalations }: { log: EscalationEntry[]; totalEscalations: number }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-4 rounded-xl"
      style={{ background: "rgba(255,45,85,0.05)", border: "1px solid rgba(255,45,85,0.1)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle style={{ width: 14, height: 14, color: "#FF2D55" }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#FF2D55" }}>Smart Escalation</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="size-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#FF2D5512", border: "1px solid #FF2D5520" }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#FF2D55" }}>!</span>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>Total Escalations</p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, marginTop: 2 }}>{totalEscalations}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="size-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#FF2D5512", border: "1px solid #FF2D5520" }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#FF2D55" }}>!</span>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>Recent Escalations</p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, marginTop: 2 }}>
              {log.length > 0 ? log.map(e => e.reason).join(", ") : "None"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Scheduled Broadcasts Panel ────────────────────────────────
function ScheduledPanel({ scheduled, onCancel, onShowForm }: { scheduled: ScheduledBroadcast[]; onCancel: (id: string) => void; onShowForm: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-4 rounded-xl"
      style={{ background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.1)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Clock style={{ width: 14, height: 14, color: "#00C8E0" }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>Scheduled Broadcasts</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="size-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#00C8E012", border: "1px solid #00C8E020" }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#00C8E0" }}>!</span>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>Total Scheduled</p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, marginTop: 2 }}>{scheduled.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="size-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#00C8E012", border: "1px solid #00C8E020" }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#00C8E0" }}>!</span>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>Pending Broadcasts</p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, marginTop: 2 }}>
              {scheduled.filter(s => s.status === "pending").length}
            </p>
          </div>
        </div>
      </div>
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={onShowForm}
        className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg"
        style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", fontSize: 12, fontWeight: 600, color: "#00C8E0" }}
      >
        <Send style={{ width: 12, height: 12 }} />
        Schedule
      </motion.button>
    </div>
  );
}

// ── Schedule Broadcast Drawer ────────────────────────────────
function ScheduleDrawer({ onClose, onSchedule }: {
  onClose: () => void;
  onSchedule: (scheduledFor: number, msg: Omit<BroadcastMessage, "id" | "readBy">) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<BroadcastPriority>("normal");
  const [audienceType, setAudienceType] = useState<"all" | "role" | "zone" | "department">("all");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<number>(Date.now() + 3600000); // 1 hour from now

  const toggleItem = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item]);
  };

  const getAudience = (): BroadcastAudience => {
    if (audienceType === "role") return { type: "role", roles: selectedRoles as any[] };
    if (audienceType === "zone") return { type: "zone", zoneIds: selectedZones };
    if (audienceType === "department") return { type: "department", departments: selectedDepts };
    return { type: "all" };
  };

  const getAudienceLabel = (): string => {
    if (audienceType === "role") return selectedRoles.map(r => ROLE_OPTIONS.find(o => o.id === r)?.label).join(", ") || "Select roles";
    if (audienceType === "zone") return selectedZones.map(z => ZONE_OPTIONS.find(o => o.id === z)?.name).join(", ") || "Select zones";
    if (audienceType === "department") return selectedDepts.join(", ") || "Select departments";
    return "All Company";
  };

  const canSend = title.trim() && body.trim() && (
    audienceType === "all" ||
    (audienceType === "role" && selectedRoles.length > 0) ||
    (audienceType === "zone" && selectedZones.length > 0) ||
    (audienceType === "department" && selectedDepts.length > 0)
  );

  const handleSend = () => {
    if (!canSend) return;
    onSchedule(scheduledFor, {
      title: title.trim(),
      body: body.trim(),
      priority,
      audience: getAudience(),
      audienceLabel: getAudienceLabel(),
      source: "manual",
      senderName: "Admin",
      senderRole: "Company Admin",
      timestamp: Date.now(),
    });
    onClose();
  };

  const applyTemplate = (tpl: typeof TEMPLATES[0]) => {
    setTitle(tpl.title);
    setBody(tpl.body);
    setPriority(tpl.priority);
    setShowTemplates(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto"
        style={{
          borderRadius: 20,
          background: "linear-gradient(135deg, #0A1220 0%, #080E1A 100%)",
          border: "1px solid rgba(0,200,224,0.1)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 60px rgba(0,200,224,0.05)",
          scrollbarWidth: "none",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
              <Megaphone style={{ width: 18, height: 18, color: "#00C8E0" }} />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>Schedule Broadcast</h2>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>Send to employees in-app (free)</p>
            </div>
          </div>
          <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)" }}>
            <X style={{ width: 14, height: 14, color: "rgba(255,255,255,0.3)" }} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Templates */}
          <div>
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg w-full"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}
            >
              <Zap style={{ width: 12, height: 12 }} />
              Quick Templates
              <ChevronDown style={{ width: 12, height: 12, marginLeft: "auto", transform: showTemplates ? "rotate(180deg)" : "none", transition: "0.2s" }} />
            </button>
            <AnimatePresence>
              {showTemplates && (
                <motion.div
                  key="schedule-templates"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {TEMPLATES.map((tpl, i) => (
                      <button
                        key={`BC-SCHEDULE-${tpl.title.replace(/\s+/g,'')}-${i}`}
                        onClick={() => applyTemplate(tpl)}
                        className="p-2.5 rounded-lg text-left transition-all hover:scale-[1.02]"
                        style={{ background: PRIORITY_CONFIG[tpl.priority].bg, border: `1px solid ${PRIORITY_CONFIG[tpl.priority].border}` }}
                      >
                        <span style={{ fontSize: 16 }}>{tpl.icon}</span>
                        <p className="mt-1" style={{ fontSize: 10, fontWeight: 700, color: PRIORITY_CONFIG[tpl.priority].color }}>{tpl.title}</p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Priority */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>PRIORITY</label>
            <div className="flex gap-2">
              {(["emergency", "urgent", "normal", "info"] as const).map(p => {
                const cfg = PRIORITY_CONFIG[p];
                const active = priority === p;
                const PIcon = cfg.icon;
                return (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all"
                    style={{
                      background: active ? cfg.bg : "rgba(255,255,255,0.02)",
                      border: `1px solid ${active ? cfg.border : "rgba(255,255,255,0.04)"}`,
                      boxShadow: active ? `0 0 12px ${cfg.color}15` : "none",
                    }}
                  >
                    <PIcon style={{ width: 12, height: 12, color: active ? cfg.color : "rgba(255,255,255,0.15)" }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: active ? cfg.color : "rgba(255,255,255,0.15)", letterSpacing: "0.3px" }}>
                      {cfg.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audience selector */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>AUDIENCE</label>
            <div className="flex gap-2 mb-3">
              {([
                { id: "all", label: "All Company", icon: Building2 },
                { id: "role", label: "By Role", icon: Shield },
                { id: "zone", label: "By Zone", icon: MapPin },
                { id: "department", label: "By Dept", icon: Users },
              ] as const).map(a => {
                const active = audienceType === a.id;
                const AIcon = a.icon;
                return (
                  <button
                    key={a.id}
                    onClick={() => setAudienceType(a.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all"
                    style={{
                      background: active ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${active ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
                    }}
                  >
                    <AIcon style={{ width: 12, height: 12, color: active ? "#00C8E0" : "rgba(255,255,255,0.15)" }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: active ? "#00C8E0" : "rgba(255,255,255,0.15)" }}>
                      {a.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Sub-selectors */}
            {audienceType === "role" && (
              <div className="flex gap-2 flex-wrap">
                {ROLE_OPTIONS.map(r => {
                  const sel = selectedRoles.includes(r.id);
                  return (
                    <button key={r.id} onClick={() => toggleItem(selectedRoles, r.id, setSelectedRoles)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
                      style={{ background: sel ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.06)"}` }}>
                      {sel && <Check style={{ width: 10, height: 10, color: "#00C8E0" }} />}
                      <span style={{ fontSize: 11, fontWeight: sel ? 700 : 500, color: sel ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>{r.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {audienceType === "zone" && (
              <div className="flex gap-2 flex-wrap">
                {ZONE_OPTIONS.map(z => {
                  const sel = selectedZones.includes(z.id);
                  return (
                    <button key={z.id} onClick={() => toggleItem(selectedZones, z.id, setSelectedZones)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
                      style={{ background: sel ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.06)"}` }}>
                      {sel && <Check style={{ width: 10, height: 10, color: "#00C8E0" }} />}
                      <span style={{ fontSize: 10, fontWeight: sel ? 700 : 500, color: sel ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>{z.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {audienceType === "department" && (
              <div className="flex gap-2 flex-wrap">
                {DEPT_OPTIONS.map(d => {
                  const sel = selectedDepts.includes(d);
                  return (
                    <button key={d} onClick={() => toggleItem(selectedDepts, d, setSelectedDepts)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
                      style={{ background: sel ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.06)"}` }}>
                      {sel && <Check style={{ width: 10, height: 10, color: "#00C8E0" }} />}
                      <span style={{ fontSize: 10, fontWeight: sel ? 700 : 500, color: sel ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>{d}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {audienceType === "all" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.1)" }}>
                <Building2 style={{ width: 14, height: 14, color: "#00C853" }} />
                <span style={{ fontSize: 11, color: "#00C853", fontWeight: 600 }}>Everyone in the company will receive this</span>
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>TITLE</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g., Team Meeting at 2 PM"
              maxLength={150}
              className="w-full px-4 py-2.5 rounded-xl outline-none"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#fff", fontSize: 13, fontWeight: 600,
              }}
            />
          </div>

          {/* Body */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>MESSAGE</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Type your message here..."
              rows={3}
              maxLength={500}
              className="w-full px-4 py-2.5 rounded-xl outline-none resize-none"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#fff", fontSize: 12,
                scrollbarWidth: "none",
              }}
            />
          </div>

          {/* Schedule time */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>SCHEDULE FOR</label>
            <input
              type="datetime-local"
              value={new Date(scheduledFor).toISOString().slice(0, 16)}
              onChange={e => setScheduledFor(new Date(e.target.value).getTime())}
              className="w-full px-4 py-2.5 rounded-xl outline-none"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#fff", fontSize: 13, fontWeight: 600,
              }}
            />
          </div>

          {/* Send button */}
          <div className="flex items-center gap-3 pt-2">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleSend}
              disabled={!canSend}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
              style={{
                background: canSend
                  ? `linear-gradient(135deg, ${PRIORITY_CONFIG[priority].color}, ${PRIORITY_CONFIG[priority].color}AA)`
                  : "rgba(255,255,255,0.04)",
                color: canSend ? "#fff" : "rgba(255,255,255,0.15)",
                fontSize: 13, fontWeight: 800,
                boxShadow: canSend ? `0 4px 20px ${PRIORITY_CONFIG[priority].color}30` : "none",
                opacity: canSend ? 1 : 0.5,
              }}
            >
              <Send style={{ width: 14, height: 14 }} />
              Schedule Broadcast
            </motion.button>

            {/* Cost indicator */}
            <div className="flex items-center gap-1 px-3 py-2 rounded-lg" style={{ background: "rgba(0,200,83,0.05)", border: "1px solid rgba(0,200,83,0.1)" }}>
              <DollarSign style={{ width: 12, height: 12, color: "#00C853" }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: "#00C853" }}>$0</span>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Broadcast Page
// ═══════════════════════════════════════════════════════════════
export function BroadcastPage({ t, webMode = false }: { t?: (k: string) => string; webMode?: boolean }) {
  const [messages, setMessages] = useState<BroadcastMessage[]>(getBroadcasts);
  const [showCompose, setShowCompose] = useState(false);
  const [filterSource, setFilterSource] = useState<"all" | "manual" | "auto">("all");
  const [filterPriority, setFilterPriority] = useState<"all" | BroadcastPriority>("all");
  const [escalationCount, setEscalationCount] = useState(0);
  const [escalationLog, setEscalationLog] = useState<EscalationEntry[]>(getEscalationLog);
  const [scheduled, setScheduled] = useState<ScheduledBroadcast[]>(getScheduledBroadcasts);
  const [showScheduleForm, setShowScheduleForm] = useState(false);

  // Live update listener
  useEffect(() => {
    return onBroadcastReceived(() => {
      setMessages(getBroadcasts());
    });
  }, []);

  // Refresh periodically + run escalation & schedule engines
  useEffect(() => {
    const id = setInterval(() => {
      setMessages(getBroadcasts());
      // Run escalation engine every tick
      const esc = checkEscalations(true);
      if (esc > 0) setEscalationCount(prev => prev + esc);
      setEscalationLog(getEscalationLog());
      // Process scheduled broadcasts
      processScheduledBroadcasts();
      setScheduled(getScheduledBroadcasts());
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const handleSend = useCallback((msg: Omit<BroadcastMessage, "id" | "readBy">) => {
    sendBroadcast(msg);
    setMessages(getBroadcasts());
  }, []);

  const handleDelete = useCallback((id: string) => {
    deleteBroadcast(id);
    setMessages(getBroadcasts());
  }, []);

  const filtered = messages.filter(m => {
    if (filterSource === "manual" && m.source !== "manual") return false;
    if (filterSource === "auto" && m.source === "manual") return false;
    if (filterPriority !== "all" && m.priority !== filterPriority) return false;
    return true;
  });

  const autoCount = messages.filter(m => m.source !== "manual").length;
  const manualCount = messages.filter(m => m.source === "manual").length;
  const emergencyCount = messages.filter(m => m.priority === "emergency").length;
  const pendingScheduled = scheduled.filter(s => s.status === "pending").length;

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: "none" }}>
      <div className="p-6 max-w-[1000px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Megaphone style={{ width: 22, height: 22, color: "#00C8E0" }} />
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>
                Broadcast Center
              </h1>
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>
              In-app messaging + auto emergency alerts — replaces SMS ($0 cost)
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.12)" }}>
              <DollarSign style={{ width: 12, height: 12, color: "#00C853" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#00C853" }}>$0 vs $48/day SMS</span>
            </div>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowCompose(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
              style={{
                background: "linear-gradient(135deg, #00C8E0, #0088A0)",
                color: "#fff", fontSize: 13, fontWeight: 800,
                boxShadow: "0 4px 16px rgba(0,200,224,0.25)",
              }}
            >
              <Send style={{ width: 14, height: 14 }} />
              New Broadcast
            </motion.button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Messages", value: messages.length, icon: MessageSquare, color: "#00C8E0" },
            { label: "Manual", value: manualCount, icon: UserCheck, color: "#00C853" },
            { label: "Auto-Generated", value: autoCount, icon: Zap, color: "#FF9500" },
            { label: "Emergency", value: emergencyCount, icon: Siren, color: "#FF2D55" },
          ].map(stat => {
            const SIcon = stat.icon;
            return (
              <div key={stat.label} className="flex items-center gap-3 px-4 py-3.5 rounded-xl"
                style={{ background: `${stat.color}05`, border: `1px solid ${stat.color}10` }}>
                <div className="size-9 rounded-lg flex items-center justify-center" style={{ background: `${stat.color}10` }}>
                  <SIcon style={{ width: 16, height: 16, color: stat.color }} />
                </div>
                <div>
                  <p style={{ fontSize: 20, fontWeight: 900, color: stat.color, letterSpacing: "-0.5px" }}>{stat.value}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontWeight: 600, letterSpacing: "0.3px" }}>{stat.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* How it works */}
        <div
          className="mb-6 px-5 py-4 rounded-xl"
          style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.06)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Radio style={{ width: 14, height: 14, color: "#00C8E0" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>Hybrid Alert Architecture</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { step: "1", title: "Event Detected", desc: "GPS out-of-zone, SOS, Hazard, or Manual broadcast", color: "#FF9500" },
              { step: "2", title: "Smart Routing", desc: "Targets by Role, Zone, Department, or All Company", color: "#00C8E0" },
              { step: "3", title: "In-App Delivery", desc: "Instant push to employee app — $0 cost, unlimited", color: "#00C853" },
            ].map(s => (
              <div key={s.step} className="flex items-start gap-2.5">
                <div className="size-6 rounded-full flex items-center justify-center shrink-0" style={{ background: `${s.color}12`, border: `1px solid ${s.color}20` }}>
                  <span style={{ fontSize: 10, fontWeight: 900, color: s.color }}>{s.step}</span>
                </div>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{s.title}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, marginTop: 2 }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-4">
          <Filter style={{ width: 14, height: 14, color: "rgba(255,255,255,0.1)" }} />
          {(["all", "manual", "auto"] as const).map(f => {
            const active = filterSource === f;
            return (
              <button key={f} onClick={() => setFilterSource(f)}
                className="px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: active ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${active ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
                  fontSize: 11, fontWeight: active ? 700 : 500,
                  color: active ? "#00C8E0" : "rgba(255,255,255,0.25)",
                }}>
                {f === "all" ? "All" : f === "manual" ? "Manual" : "Auto-Generated"}
              </button>
            );
          })}

          <div className="w-px h-4 mx-1" style={{ background: "rgba(255,255,255,0.06)" }} />

          {(["all", "emergency", "urgent", "normal", "info"] as const).map(p => {
            const active = filterPriority === p;
            const cfg = p !== "all" ? PRIORITY_CONFIG[p] : null;
            return (
              <button key={p} onClick={() => setFilterPriority(p)}
                className="px-2.5 py-1.5 rounded-lg transition-all"
                style={{
                  background: active ? (cfg ? cfg.bg : "rgba(0,200,224,0.08)") : "rgba(255,255,255,0.02)",
                  border: `1px solid ${active ? (cfg ? cfg.border : "rgba(0,200,224,0.2)") : "rgba(255,255,255,0.04)"}`,
                  fontSize: 10, fontWeight: active ? 700 : 500,
                  color: active ? (cfg ? cfg.color : "#00C8E0") : "rgba(255,255,255,0.2)",
                }}>
                {p === "all" ? "All" : cfg?.label}
              </button>
            );
          })}
        </div>

        {/* Messages list */}
        <AnimatePresence mode="popLayout">
          {filtered.length > 0 ? (
            filtered.map(msg => (
              <MessageCard key={msg.id} msg={msg} onDelete={() => handleDelete(msg.id)} />
            ))
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16"
            >
              <Megaphone style={{ width: 40, height: 40, color: "rgba(255,255,255,0.06)", marginBottom: 12 }} />
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.2)" }}>No broadcasts yet</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.1)", marginTop: 4 }}>
                Send your first broadcast or wait for auto-alerts
              </p>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowCompose(true)}
                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg"
                style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", fontSize: 12, fontWeight: 600, color: "#00C8E0" }}
              >
                <Send style={{ width: 12, height: 12 }} />
                Compose
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Smart Escalation + Scheduled Panels ── */}
        <div className="mt-6 space-y-4">
          <EscalationPanel log={escalationLog} totalEscalations={escalationCount} />
          <ScheduledPanel
            scheduled={scheduled}
            onCancel={(id) => { cancelScheduledBroadcast(id); setScheduled(getScheduledBroadcasts()); }}
            onShowForm={() => setShowScheduleForm(true)}
          />
        </div>
      </div>

      {/* Compose Drawer */}
      <AnimatePresence>
        {showCompose && (
          <ComposeDrawer
            onClose={() => setShowCompose(false)}
            onSend={handleSend}
          />
        )}
      </AnimatePresence>

      {/* Schedule Broadcast Drawer */}
      <AnimatePresence>
        {showScheduleForm && (
          <ScheduleDrawer
            onClose={() => setShowScheduleForm(false)}
            onSchedule={(scheduledFor, msg) => {
              scheduleBroadcast(scheduledFor, msg);
              setScheduled(getScheduledBroadcasts());
              setShowScheduleForm(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}