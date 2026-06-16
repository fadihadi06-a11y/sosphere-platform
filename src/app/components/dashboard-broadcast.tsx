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

const PRIORITY_CONFIG: Record<BroadcastPriority, { labelKey: string; color: string; bg: string; border: string; icon: any }> = {
  emergency: { labelKey: "bcast.priorityEmergency", color: "#FF2D55", bg: "rgba(255,45,85,0.06)", border: "rgba(255,45,85,0.12)", icon: Siren },
  urgent: { labelKey: "bcast.priorityUrgent", color: "#FF9500", bg: "rgba(255,150,0,0.06)", border: "rgba(255,150,0,0.12)", icon: AlertTriangle },
  normal: { labelKey: "bcast.priorityNormal", color: "#00C8E0", bg: "rgba(0,200,224,0.06)", border: "rgba(0,200,224,0.12)", icon: Bell },
  info: { labelKey: "bcast.priorityInfo", color: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.06)", icon: Info },
};

const SOURCE_LABELS: Record<string, { labelKey: string; color: string; icon: any }> = {
  manual: { labelKey: "bcast.sourceManual", color: "#00C8E0", icon: UserCheck },
  auto_gps: { labelKey: "bcast.sourceGps", color: "#FF9500", icon: Satellite },
  auto_sos: { labelKey: "bcast.sourceSos", color: "#FF2D55", icon: Siren },
  auto_hazard: { labelKey: "bcast.sourceHazard", color: "#FF9500", icon: AlertTriangle },
  auto_geofence: { labelKey: "bcast.sourceGeofence", color: "#FF2D55", icon: Shield },
  auto_checkin: { labelKey: "bcast.sourceCheckin", color: "#00C853", icon: Check },
};

function timeAgo(ts: number, t: (k: string) => string): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return t("bcast.justNow");
  if (diff < 60) return `${diff}${t("bcast.secondsAgo")}`;
  if (diff < 3600) return `${Math.floor(diff / 60)}${t("bcast.minutesAgo")}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}${t("bcast.hoursAgo")}`;
  return `${Math.floor(diff / 86400)}${t("bcast.daysAgo")}`;
}

// ── Quick templates ───────────────────────────────────────────
const TEMPLATES = [
  { titleKey: "bcast.tplMeetingTitle", bodyKey: "bcast.tplMeetingBody", priority: "normal" as const, icon: "📋" },
  { titleKey: "bcast.tplSafetyTitle", bodyKey: "bcast.tplSafetyBody", priority: "urgent" as const, icon: "🦺" },
  { titleKey: "bcast.tplEvacTitle", bodyKey: "bcast.tplEvacBody", priority: "emergency" as const, icon: "🚨" },
  { titleKey: "bcast.tplWeatherTitle", bodyKey: "bcast.tplWeatherBody", priority: "urgent" as const, icon: "⛈️" },
  { titleKey: "bcast.tplShiftTitle", bodyKey: "bcast.tplShiftBody", priority: "info" as const, icon: "🔄" },
  { titleKey: "bcast.tplEquipTitle", bodyKey: "bcast.tplEquipBody", priority: "normal" as const, icon: "🔧" },
];

// ── Compose Drawer ────────────────────────────────────────────
function ComposeDrawer({ onClose, onSend, t }: {
  onClose: () => void;
  onSend: (msg: Omit<BroadcastMessage, "id" | "readBy">) => void;
  t: (k: string) => string;
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
    if (audienceType === "role") return selectedRoles.map(r => ROLE_OPTIONS.find(o => o.id === r)?.label).join(", ") || t("bcast.selectRoles");
    if (audienceType === "zone") return selectedZones.map(z => ZONE_OPTIONS.find(o => o.id === z)?.name).join(", ") || t("bcast.selectZones");
    if (audienceType === "department") return selectedDepts.join(", ") || t("bcast.selectDepartments");
    return t("bcast.allCompany");
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
    setTitle(t(tpl.titleKey));
    setBody(t(tpl.bodyKey));
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
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{t("bcast.newBroadcast")}</h2>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>{t("bcast.sendInApp")}</p>
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
              {t("bcast.quickTemplates")}
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
                        key={`BC-${tpl.titleKey}-${i}`}
                        onClick={() => applyTemplate(tpl)}
                        className="p-2.5 rounded-lg text-left transition-all hover:scale-[1.02]"
                        style={{ background: PRIORITY_CONFIG[tpl.priority].bg, border: `1px solid ${PRIORITY_CONFIG[tpl.priority].border}` }}
                      >
                        <span style={{ fontSize: 16 }}>{tpl.icon}</span>
                        <p className="mt-1" style={{ fontSize: 10, fontWeight: 700, color: PRIORITY_CONFIG[tpl.priority].color }}>{t(tpl.titleKey)}</p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Priority */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>{t("bcast.priority")}</label>
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
                      {t(cfg.labelKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audience selector */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>{t("bcast.audience")}</label>
            <div className="flex gap-2 mb-3">
              {([
                { id: "all", labelKey: "bcast.audAll", icon: Building2 },
                { id: "role", labelKey: "bcast.audRole", icon: Shield },
                { id: "zone", labelKey: "bcast.audZone", icon: MapPin },
                { id: "department", labelKey: "bcast.audDept", icon: Users },
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
                      {t(a.labelKey)}
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
                <span style={{ fontSize: 11, color: "#00C853", fontWeight: 600 }}>{t("bcast.everyoneReceives")}</span>
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>{t("bcast.titleLabel")}</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t("bcast.titlePlaceholder")}
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
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>{t("bcast.messageLabel")}</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={t("bcast.messagePlaceholder")}
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
              {t("bcast.sendBroadcast")}
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
const MessageCard = forwardRef<HTMLDivElement, { msg: BroadcastMessage; onDelete: () => void; t: (k: string) => string }>(
  ({ msg, onDelete, t }, ref) => {
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
                {t(pCfg.labelKey)}
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
              {isAuto ? t("bcast.auto") : msg.senderName}
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
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>{timeAgo(msg.timestamp, t)}</span>
          </div>

          {/* Read count */}
          <div className="flex items-center gap-1 ml-auto">
            <Eye style={{ width: 10, height: 10, color: "rgba(255,255,255,0.1)" }} />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
              {msg.readBy.length} {t("bcast.read")}
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
function EscalationPanel({ log, totalEscalations, t }: { log: EscalationEntry[]; totalEscalations: number; t: (k: string) => string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-4 rounded-xl"
      style={{ background: "rgba(255,45,85,0.05)", border: "1px solid rgba(255,45,85,0.1)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle style={{ width: 14, height: 14, color: "#FF2D55" }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#FF2D55" }}>{t("bcast.smartEscalation")}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="size-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#FF2D5512", border: "1px solid #FF2D5520" }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#FF2D55" }}>!</span>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{t("bcast.totalEscalations")}</p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, marginTop: 2 }}>{totalEscalations}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="size-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#FF2D5512", border: "1px solid #FF2D5520" }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#FF2D55" }}>!</span>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{t("bcast.recentEscalations")}</p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, marginTop: 2 }}>
              {log.length > 0 ? log.map(e => e.reason).join(", ") : t("bcast.none")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Scheduled Broadcasts Panel ────────────────────────────────
function ScheduledPanel({ scheduled, onCancel, onShowForm, t }: { scheduled: ScheduledBroadcast[]; onCancel: (id: string) => void; onShowForm: () => void; t: (k: string) => string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-4 rounded-xl"
      style={{ background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.1)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Clock style={{ width: 14, height: 14, color: "#00C8E0" }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>{t("bcast.scheduledBroadcasts")}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="size-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#00C8E012", border: "1px solid #00C8E020" }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#00C8E0" }}>!</span>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{t("bcast.totalScheduled")}</p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, marginTop: 2 }}>{scheduled.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="size-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#00C8E012", border: "1px solid #00C8E020" }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#00C8E0" }}>!</span>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{t("bcast.pendingBroadcasts")}</p>
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
        {t("bcast.schedule")}
      </motion.button>
    </div>
  );
}

// ── Schedule Broadcast Drawer ────────────────────────────────
function ScheduleDrawer({ onClose, onSchedule, t }: {
  onClose: () => void;
  onSchedule: (scheduledFor: number, msg: Omit<BroadcastMessage, "id" | "readBy">) => void;
  t: (k: string) => string;
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
    if (audienceType === "role") return selectedRoles.map(r => ROLE_OPTIONS.find(o => o.id === r)?.label).join(", ") || t("bcast.selectRoles");
    if (audienceType === "zone") return selectedZones.map(z => ZONE_OPTIONS.find(o => o.id === z)?.name).join(", ") || t("bcast.selectZones");
    if (audienceType === "department") return selectedDepts.join(", ") || t("bcast.selectDepartments");
    return t("bcast.allCompany");
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
    setTitle(t(tpl.titleKey));
    setBody(t(tpl.bodyKey));
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
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{t("bcast.scheduleBroadcast")}</h2>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>{t("bcast.sendInApp")}</p>
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
              {t("bcast.quickTemplates")}
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
                        key={`BC-SCHEDULE-${tpl.titleKey}-${i}`}
                        onClick={() => applyTemplate(tpl)}
                        className="p-2.5 rounded-lg text-left transition-all hover:scale-[1.02]"
                        style={{ background: PRIORITY_CONFIG[tpl.priority].bg, border: `1px solid ${PRIORITY_CONFIG[tpl.priority].border}` }}
                      >
                        <span style={{ fontSize: 16 }}>{tpl.icon}</span>
                        <p className="mt-1" style={{ fontSize: 10, fontWeight: 700, color: PRIORITY_CONFIG[tpl.priority].color }}>{t(tpl.titleKey)}</p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Priority */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>{t("bcast.priority")}</label>
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
                      {t(cfg.labelKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audience selector */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>{t("bcast.audience")}</label>
            <div className="flex gap-2 mb-3">
              {([
                { id: "all", labelKey: "bcast.audAll", icon: Building2 },
                { id: "role", labelKey: "bcast.audRole", icon: Shield },
                { id: "zone", labelKey: "bcast.audZone", icon: MapPin },
                { id: "department", labelKey: "bcast.audDept", icon: Users },
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
                      {t(a.labelKey)}
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
                <span style={{ fontSize: 11, color: "#00C853", fontWeight: 600 }}>{t("bcast.everyoneReceives")}</span>
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>{t("bcast.titleLabel")}</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t("bcast.titlePlaceholder")}
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
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>{t("bcast.messageLabel")}</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={t("bcast.messagePlaceholder")}
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
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>{t("bcast.scheduleFor")}</label>
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
              {t("bcast.scheduleBroadcast")}
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
export function BroadcastPage({ t: tProp, webMode = false }: { t?: (k: string) => string; webMode?: boolean }) {
  const t = tProp ?? ((k: string) => k);
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
                {t("bcast.broadcastCenter")}
              </h1>
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>
              {t("bcast.pageSubtitle")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.12)" }}>
              <DollarSign style={{ width: 12, height: 12, color: "#00C853" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#00C853" }}>{t("bcast.costComparison")}</span>
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
              {t("bcast.newBroadcast")}
            </motion.button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: t("bcast.statTotalMessages"), value: messages.length, icon: MessageSquare, color: "#00C8E0" },
            { label: t("bcast.statManual"), value: manualCount, icon: UserCheck, color: "#00C853" },
            { label: t("bcast.statAutoGenerated"), value: autoCount, icon: Zap, color: "#FF9500" },
            { label: t("bcast.statEmergency"), value: emergencyCount, icon: Siren, color: "#FF2D55" },
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
            <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>{t("bcast.hybridArchitecture")}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { step: "1", title: t("bcast.step1Title"), desc: t("bcast.step1Desc"), color: "#FF9500" },
              { step: "2", title: t("bcast.step2Title"), desc: t("bcast.step2Desc"), color: "#00C8E0" },
              { step: "3", title: t("bcast.step3Title"), desc: t("bcast.step3Desc"), color: "#00C853" },
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
                {f === "all" ? t("bcast.filterAll") : f === "manual" ? t("bcast.statManual") : t("bcast.statAutoGenerated")}
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
                {p === "all" ? t("bcast.filterAll") : cfg ? t(cfg.labelKey) : ""}
              </button>
            );
          })}
        </div>

        {/* Messages list */}
        <AnimatePresence mode="popLayout">
          {filtered.length > 0 ? (
            filtered.map(msg => (
              <MessageCard key={msg.id} msg={msg} onDelete={() => handleDelete(msg.id)} t={t} />
            ))
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16"
            >
              <Megaphone style={{ width: 40, height: 40, color: "rgba(255,255,255,0.06)", marginBottom: 12 }} />
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.2)" }}>{t("bcast.noBroadcasts")}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.1)", marginTop: 4 }}>
                {t("bcast.noBroadcastsHint")}
              </p>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowCompose(true)}
                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg"
                style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", fontSize: 12, fontWeight: 600, color: "#00C8E0" }}
              >
                <Send style={{ width: 12, height: 12 }} />
                {t("bcast.compose")}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Smart Escalation + Scheduled Panels ── */}
        <div className="mt-6 space-y-4">
          <EscalationPanel log={escalationLog} totalEscalations={escalationCount} t={t} />
          <ScheduledPanel
            scheduled={scheduled}
            onCancel={(id) => { cancelScheduledBroadcast(id); setScheduled(getScheduledBroadcasts()); }}
            onShowForm={() => setShowScheduleForm(true)}
            t={t}
          />
        </div>
      </div>

      {/* Compose Drawer */}
      <AnimatePresence>
        {showCompose && (
          <ComposeDrawer
            onClose={() => setShowCompose(false)}
            onSend={handleSend}
            t={t}
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
            t={t}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
