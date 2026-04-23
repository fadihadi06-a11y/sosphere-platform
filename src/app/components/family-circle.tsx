import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MapPin, Phone,
  MessageSquare, ChevronRight, X, Check,
  Send, UserPlus,
  Copy, Share2, Radio, Edit3,
} from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import type { Lang } from "./dashboard-i18n";
// AUDIT-FIX (2026-04-19): shared civilian-store — one source of truth for
// contacts, used by every screen. Edits from any screen propagate instantly.
import { useContacts, ContactEditSheet, type SafetyContact } from "./shared-stores";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface FamilyMember {
  id: number;
  name: string;
  role: string;        // relation label shown in UI ("Spouse", "Parent"…)
  phone: string;       // canonical E.164 used for tel:/sms: handlers
  avatar: string;
  online: boolean;
  lastSeen: string;
  location: string;
  battery: number;
  safetyStatus: "safe" | "alert" | "sos" | "unknown";
  sharingLocation: boolean;
}

// AUDIT-FIX (2026-04-19): contacts come from the shared civilian-store
// via useContacts() — the store auto-migrates legacy localStorage data
// and the list stays live across all screens.
function contactToMember(c: SafetyContact): FamilyMember & { contactId: string } {
  const lastSeenText = c.lastSeen
    ? (() => {
        const diff = Date.now() - c.lastSeen;
        if (diff < 60000) return "Just now";
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return `${Math.floor(diff / 86400000)}d ago`;
      })()
    : "";
  return {
    contactId: c.id,
    id: parseInt(c.id.replace(/\D/g, "").slice(-6) || "0", 10) || c.addedAt,
    name: c.name,
    role: c.relation || "",
    phone: c.phone || "",
    avatar: "",
    online: c.isOnline,
    lastSeen: lastSeenText,
    location: c.lastKnownLocation
      ? `${c.lastKnownLocation.lat.toFixed(3)}, ${c.lastKnownLocation.lng.toFixed(3)}`
      : "",
    battery: c.batteryLevel ?? 0,
    safetyStatus: c.type === "ghost" ? "unknown" as const : (c.isOnline ? "safe" as const : "unknown" as const),
    sharingLocation: c.locationSharingEnabled,
  };
}

const statusConfig = {
  safe: { color: "#00C853", label: "Safe", bg: "rgba(0,200,83,0.06)" },
  alert: { color: "#FF9500", label: "Alert", bg: "rgba(255,150,0,0.06)" },
  sos: { color: "#FF2D55", label: "SOS Active", bg: "rgba(255,45,85,0.06)" },
  unknown: { color: "#8E8E93", label: "Unknown", bg: "rgba(142,142,147,0.06)" },
};

// ─── Component ─────────────────────────────────────────────────────────────────
export function FamilyCircle({ lang = "en" }: { lang?: Lang } = {}) {
  const isAr = lang === "ar";
  const tr = (en: string, ar: string) => (isAr ? ar : en);
  const [contacts] = useContacts();
  const members = useMemo(() => contacts.map(contactToMember), [contacts]);
  const [selectedMember, setSelectedMember] = useState<(FamilyMember & { contactId?: string }) | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showCheckAll, setShowCheckAll] = useState(false);
  const [checkAllSent, setCheckAllSent] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  // Contextual edit sheet — opened from long-press on a card or from
  // the member detail sheet's Edit pill. Same primitive used by every screen.
  const [editingContact, setEditingContact] = useState<SafetyContact | null>(null);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const openEditFor = (contactId: string) => {
    const target = contacts.find(c => c.id === contactId);
    if (target) { setEditingContact(target); setShowEditSheet(true); }
  };

  const onlineCount = members.filter(m => m.online).length;
  const safeCount = members.filter(m => m.safetyStatus === "safe").length;

  const handleCheckAll = () => {
    setCheckAllSent(true);
    setTimeout(() => { setCheckAllSent(false); setShowCheckAll(false); }, 2000);
  };

  const handleCopyInvite = () => {
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden relative" style={{ scrollbarWidth: "none" }} dir={isAr ? "rtl" : "ltr"}>
      {/* Ambient — tagged data-ambient-glow so global native-compat.css
          can disable it on MIUI WebView where the radial-gradient +
          transform-animated children produce rainbow tearing. */}
      <div
        data-ambient-glow
        className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0) 0%, transparent 70%)" }}
      />

      <div style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 112px)" }}>
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-6 mb-4"
        >
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-white" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px" }}>
              {tr("Family Circle", "دائرة العائلة")}
            </h1>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowInvite(true)}
              className="size-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}
            >
              <UserPlus style={{ width: 15, height: 15, color: "#00C8E0" }} />
            </motion.button>
          </div>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)" }}>
            <span style={{ color: "#00C853", fontWeight: 600 }}>{onlineCount}</span> {tr("online", "متصل")} · <span style={{ color: "#00C8E0", fontWeight: 600 }}>{safeCount}</span> {tr("safe", "آمن")}
          </p>
        </motion.div>

        {/* ── Safety Check Button ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="px-5 mb-5"
        >
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCheckAll(true)}
            className="w-full flex items-center justify-center gap-2.5 py-3.5"
            style={{
              borderRadius: 16,
              background: "linear-gradient(135deg, rgba(0,200,224,0.06) 0%, rgba(0,200,83,0.03) 100%)",
              border: "1px solid rgba(0,200,224,0.1)",
            }}
          >
            <Radio style={{ width: 15, height: 15, color: "#00C8E0" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#00C8E0" }}>{tr("Check on Everyone", "الاطمئنان على الجميع")}</span>
          </motion.button>
        </motion.div>

        {/* ── Members List ── */}
        <div className="px-5">
          <div className="flex items-center justify-between mb-2.5">
            <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.12)", letterSpacing: "0.6px", textTransform: "uppercase" }}>
              {tr("Members", "الأعضاء")} ({members.length})
            </p>
            {/* AUDIT-FIX (2026-04-21): explicit Add Contact button in
                Family Circle — user was confused how to add someone. */}
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => { setEditingContact(null); setShowEditSheet(true); }}
              className="flex items-center gap-1.5 px-3 h-8 rounded-[10px]"
              style={{
                background: "linear-gradient(135deg, #00C8E0, #0099B3)",
                boxShadow: "0 4px 14px rgba(0,200,224,0.25)",
              }}
            >
              <UserPlus style={{ width: 13, height: 13, color: "#fff" }} strokeWidth={2.5} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.2px" }}>
                {tr("Add Contact", "إضافة")}
              </span>
            </motion.button>
          </div>

          <div className="space-y-2.5">
            {members.map((member, i) => {
              const status = statusConfig[member.safetyStatus];
              const cid = (member as FamilyMember & { contactId?: string }).contactId;
              // AUDIT-FIX (2026-04-21): removed long-press (too sensitive,
              // triggered on light touches). Edit access lives on the
              // explicit Edit pill inside the detail sheet.
              return (
                <motion.div
                  key={cid ?? member.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.06 }}
                  className="relative w-full text-left"
                >
                  <div
                    className="p-3.5 flex items-center gap-3"
                    style={{
                      borderRadius: 18,
                      background: "rgba(255,255,255,0.015)",
                      border: `1px solid ${member.safetyStatus === "sos" ? "rgba(255,45,85,0.15)" : "rgba(255,255,255,0.035)"}`,
                    }}
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div
                        className="size-[50px] rounded-full overflow-hidden"
                        style={{
                          border: `2px solid ${member.online ? status.color + "50" : "rgba(255,255,255,0.06)"}`,
                          padding: 1.5,
                        }}
                      >
                        <ImageWithFallback src={member.avatar} alt={member.name} className="w-full h-full rounded-full object-cover" />
                      </div>
                      <span
                        className="absolute bottom-0 right-0 size-3.5 rounded-full"
                        style={{
                          background: member.online ? "#00C853" : "rgba(255,255,255,0.12)",
                          border: "2.5px solid #0A1220",
                          boxShadow: member.online ? "0 0 6px rgba(0,200,83,0.4)" : "none",
                        }}
                      />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-white truncate" style={{ fontSize: 15, fontWeight: 600 }}>{member.name}</p>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.15)" }}>{member.role}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <MapPin style={{ width: 10, height: 10, color: "rgba(255,255,255,0.15)" }} />
                        <p className="truncate" style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
                          {member.location}
                        </p>
                      </div>
                      <div className="flex items-center gap-2.5">
                        {/* Status badge */}
                        <div className="flex items-center gap-1 px-2 py-[2px]"
                          style={{ borderRadius: 6, background: status.bg, border: `1px solid ${status.color}18` }}
                        >
                          <div className="size-[5px] rounded-full" style={{ background: status.color }} />
                          <span style={{ fontSize: 9, fontWeight: 600, color: status.color }}>{status.label}</span>
                        </div>
                        {/* Battery */}
                        <div className="flex items-center gap-1">
                          <div className="relative" style={{ width: 16, height: 9, borderRadius: 2, border: `1px solid ${member.battery > 20 ? "rgba(255,255,255,0.12)" : "rgba(255,45,85,0.3)"}` }}>
                            <div style={{
                              position: "absolute", left: 1, top: 1, bottom: 1,
                              width: `${member.battery * 0.85}%`, borderRadius: 1,
                              background: member.battery > 50 ? "#00C853" : member.battery > 20 ? "#FF9500" : "#FF2D55",
                            }} />
                          </div>
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>{member.battery}%</span>
                        </div>
                        {/* Last seen */}
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.12)" }}>{member.lastSeen}</span>
                      </div>
                    </div>

                    {/* Explicit actions — replaces hidden long-press */}
                    <div className="flex items-center gap-1 shrink-0">
                      {cid && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openEditFor(cid); }}
                          aria-label={tr("Edit contact", "تعديل")}
                          className="size-8 rounded-[9px] flex items-center justify-center"
                          style={{ background: "rgba(0,200,224,0.08)" }}
                        >
                          <Edit3 style={{ width: 13, height: 13, color: "#00C8E0" }} />
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedMember(member)}
                        aria-label={tr("View details", "التفاصيل")}
                        className="size-8 rounded-[9px] flex items-center justify-center"
                        style={{ background: "rgba(255,255,255,0.04)" }}
                      >
                        <ChevronRight style={{ width: 14, height: 14, color: "rgba(255,255,255,0.35)" }} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* ── Quick Stats ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="px-5 mt-5"
        >
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: tr("Safe", "آمن"), value: safeCount, total: members.length, color: "#00C853" },
              { label: tr("Online", "متصل"), value: onlineCount, total: members.length, color: "#00C8E0" },
              { label: tr("Sharing", "يشارك"), value: members.filter(m => m.sharingLocation).length, total: members.length, color: "#FF9500" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col items-center py-3.5"
                style={{
                  borderRadius: 16,
                  background: `${stat.color}04`,
                  border: `1px solid ${stat.color}10`,
                }}
              >
                <p style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>
                  {stat.value}<span style={{ fontSize: 12, color: "rgba(255,255,255,0.12)" }}>/{stat.total}</span>
                </p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 500, marginTop: 2 }}>{stat.label}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── Tip ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          className="px-5 mt-5"
        >
          <div className="px-4 py-3" style={{ borderRadius: 14, background: "rgba(0,200,224,0.02)", border: "1px solid rgba(0,200,224,0.05)" }}>
            <p style={{ fontSize: 10, color: "rgba(0,200,224,0.3)", textAlign: "center", lineHeight: 1.7 }}>
              {tr("Family is notified automatically during emergencies", "يتم إبلاغ العائلة تلقائياً أثناء الطوارئ")}
            </p>
          </div>
        </motion.div>
      </div>

      {/* ── Member Detail Modal ── */}
      <AnimatePresence>
        {selectedMember && (
          <>
            <motion.div
              key="detail-bg"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.82)" }}
              onClick={() => setSelectedMember(null)}
            />
            <motion.div
              key="detail-modal"
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute bottom-0 left-0 right-0 z-50 px-5 pt-5"
              style={{
                borderRadius: "28px 28px 0 0",
                background: "rgba(10,18,32,0.99)",
                boxShadow: `inset 0 1px 0 ${statusConfig[selectedMember.safetyStatus].color}20`,
                paddingBottom: "calc(env(safe-area-inset-bottom) + 32px)",
              }}
            >
              <div className="flex justify-center mb-4">
                <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
              </div>

              {/* Member Header */}
              <div className="flex items-center gap-4 mb-5">
                <div className="relative">
                  <div
                    className="size-16 rounded-full overflow-hidden"
                    style={{ border: `2px solid ${statusConfig[selectedMember.safetyStatus].color}40`, padding: 2 }}
                  >
                    <ImageWithFallback src={selectedMember.avatar} alt={selectedMember.name} className="w-full h-full rounded-full object-cover" />
                  </div>
                  <span
                    className="absolute bottom-0 right-0 size-4 rounded-full"
                    style={{
                      background: selectedMember.online ? "#00C853" : "rgba(255,255,255,0.15)",
                      border: "3px solid #0A1220",
                    }}
                  />
                </div>
                <div className="flex-1">
                  <p className="text-white" style={{ fontSize: 20, fontWeight: 700 }}>{selectedMember.name}</p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)" }}>{selectedMember.role} · {selectedMember.lastSeen}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <MapPin style={{ width: 10, height: 10, color: "rgba(255,255,255,0.2)" }} />
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{selectedMember.location}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const cid = (selectedMember as FamilyMember & { contactId?: string }).contactId;
                      if (cid) { openEditFor(cid); setSelectedMember(null); }
                    }}
                    aria-label={tr("Edit contact", "تعديل جهة الاتصال")}
                    className="size-9 rounded-[10px] flex items-center justify-center"
                    style={{ background: "rgba(0,200,224,0.08)" }}
                  >
                    <Edit3 style={{ width: 15, height: 15, color: "#00C8E0" }} />
                  </button>
                  <button onClick={() => setSelectedMember(null)} className="size-9 rounded-[10px] flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <X style={{ width: 16, height: 16, color: "rgba(255,255,255,0.4)" }} />
                  </button>
                </div>
              </div>

              {/* Quick Actions — simplified: Call + Message only */}
              <div className="grid grid-cols-2 gap-2.5 mb-5">
                {/* Primary: One-tap Call */}
                <motion.button
                  whileTap={{ scale: 0.93 }}
                  onClick={() => {
                    const phone = (selectedMember.phone || "").replace(/[^0-9+]/g, "");
                    if (phone) window.location.href = `tel:${phone}`;
                  }}
                  disabled={!selectedMember.phone}
                  className="flex items-center justify-center gap-2.5 py-4 disabled:opacity-40"
                  style={{ borderRadius: 16, background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}
                >
                  <Phone style={{ width: 18, height: 18, color: "#00C853" }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#00C853" }}>{tr("Call", "اتصال")}</span>
                </motion.button>
                {/* Message */}
                <motion.button
                  whileTap={{ scale: 0.93 }}
                  onClick={() => {
                    const phone = (selectedMember.phone || "").replace(/[^0-9+]/g, "");
                    if (phone) window.location.href = `sms:${phone}`;
                  }}
                  disabled={!selectedMember.phone}
                  className="flex items-center justify-center gap-2.5 py-4 disabled:opacity-40"
                  style={{ borderRadius: 16, background: "rgba(0,122,255,0.06)", border: "1px solid rgba(0,122,255,0.12)" }}
                >
                  <MessageSquare style={{ width: 18, height: 18, color: "#007AFF" }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#007AFF" }}>{tr("Message", "رسالة")}</span>
                </motion.button>
              </div>

              {/* Info Cards */}
              <div className="space-y-2">
                {[
                  { label: tr("Safety Status", "حالة الأمان"), value: statusConfig[selectedMember.safetyStatus].label, color: statusConfig[selectedMember.safetyStatus].color },
                  { label: tr("Battery", "البطارية"), value: `${selectedMember.battery}%`, color: selectedMember.battery > 50 ? "#00C853" : selectedMember.battery > 20 ? "#FF9500" : "#FF2D55" },
                  { label: tr("Location Sharing", "مشاركة الموقع"), value: selectedMember.sharingLocation ? tr("Active", "مفعّل") : tr("Paused", "متوقف"), color: selectedMember.sharingLocation ? "#00C853" : "#FF9500" },
                ].map((info) => (
                  <div
                    key={info.label}
                    className="flex items-center justify-between py-2.5 px-3.5"
                    style={{ borderRadius: 12, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.035)" }}
                  >
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>{info.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: info.color }}>{info.value}</span>
                  </div>
                ))}
              </div>

              {/* Request Check-in — sends SMS asking "are you safe?" */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  const phone = (selectedMember.phone || "").replace(/[^0-9+]/g, "");
                  if (!phone) return;
                  const msg = encodeURIComponent(
                    isAr
                      ? `مرحباً ${selectedMember.name}، هل أنت بخير؟ أرسل لي إشارة عند قراءتك الرسالة. — SOSphere`
                      : `Hi ${selectedMember.name}, are you safe? Please reply to confirm. — SOSphere`
                  );
                  window.location.href = `sms:${phone}?body=${msg}`;
                }}
                disabled={!selectedMember.phone}
                className="w-full flex items-center justify-center gap-2 py-3.5 mt-4 disabled:opacity-40"
                style={{
                  borderRadius: 14,
                  background: "rgba(0,200,224,0.06)",
                  border: "1px solid rgba(0,200,224,0.12)",
                  fontSize: 13, fontWeight: 600, color: "#00C8E0",
                }}
              >
                <Send style={{ width: 14, height: 14 }} />
                {tr("Request Check-in", "طلب الاطمئنان")}
              </motion.button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Invite Modal ── */}
      <AnimatePresence>
        {showInvite && (
          <>
            <motion.div
              key="invite-bg"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.82)" }}
              onClick={() => setShowInvite(false)}
            />
            <motion.div
              key="invite-modal"
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute bottom-0 left-0 right-0 z-50 px-5 pt-5"
              style={{
                borderRadius: "28px 28px 0 0",
                background: "rgba(10,18,32,0.99)",
                boxShadow: "inset 0 1px 0 rgba(0,200,224,0.12)",
                paddingBottom: "calc(env(safe-area-inset-bottom) + 32px)",
              }}
            >
              <div className="flex justify-center mb-4">
                <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
              </div>

              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-white" style={{ fontSize: 17, fontWeight: 700 }}>{tr("Invite Family", "دعوة العائلة")}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>{tr("Share invite code or link", "شارك رمز الدعوة أو الرابط")}</p>
                </div>
                <button onClick={() => setShowInvite(false)}>
                  <X style={{ width: 18, height: 18, color: "rgba(255,255,255,0.3)" }} />
                </button>
              </div>

              {/* Invite Code */}
              <div className="p-4 mb-4" style={{ borderRadius: 16, background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.08)" }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(0,200,224,0.4)", letterSpacing: "0.4px", marginBottom: 8 }}>
                  {tr("INVITE CODE", "رمز الدعوة")}
                </p>
                <div className="flex items-center justify-between">
                  <p className="text-white" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "4px" }}>FML-8K3P</p>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={handleCopyInvite}
                    className="px-3 py-2 rounded-xl"
                    style={{
                      background: inviteCopied ? "rgba(0,200,83,0.08)" : "rgba(0,200,224,0.08)",
                      border: `1px solid ${inviteCopied ? "rgba(0,200,83,0.15)" : "rgba(0,200,224,0.15)"}`,
                    }}
                  >
                    {inviteCopied ? (
                      <Check style={{ width: 14, height: 14, color: "#00C853" }} />
                    ) : (
                      <Copy style={{ width: 14, height: 14, color: "#00C8E0" }} />
                    )}
                  </motion.button>
                </div>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", marginTop: 6 }}>{tr("Code expires in 24 hours", "ينتهي الرمز خلال 24 ساعة")}</p>
              </div>

              {/* Share Options */}
              <div className="space-y-2 mb-4">
                {[
                  { icon: MessageSquare, label: tr("Send SMS Invite", "إرسال دعوة SMS"), detail: tr("Send code via text message", "إرسال الرمز برسالة نصية"), color: "#00C853" },
                  { icon: Share2, label: tr("Share Link", "مشاركة الرابط"), detail: tr("Share via any app", "شارك عبر أي تطبيق"), color: "#00C8E0" },
                ].map((opt) => {
                  const OptIcon = opt.icon;
                  const isSms = opt.icon === MessageSquare;
                  const handleShare = () => {
                    const inviteUrl = `https://sosphere.co/invite/FML-8K3P`;
                    const inviteMsg = isAr
                      ? `انضم لدائرة عائلتي على SOSphere للتواصل الآمن: ${inviteUrl}`
                      : `Join my family circle on SOSphere for safe coordination: ${inviteUrl}`;
                    if (isSms) {
                      window.location.href = `sms:?body=${encodeURIComponent(inviteMsg)}`;
                    } else if ((navigator as { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> }).share) {
                      (navigator as { share: (data: { title?: string; text?: string; url?: string }) => Promise<void> }).share({
                        title: "SOSphere Family Invite",
                        text: inviteMsg,
                        url: inviteUrl,
                      }).catch(() => { /* user cancelled */ });
                    } else {
                      navigator.clipboard?.writeText(inviteMsg);
                    }
                  };
                  return (
                    <motion.button
                      key={opt.label}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleShare}
                      className="w-full flex items-center gap-3 p-3.5 text-left"
                      style={{ borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                    >
                      <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: `${opt.color}08`, border: `1px solid ${opt.color}15` }}>
                        <OptIcon style={{ width: 15, height: 15, color: opt.color }} />
                      </div>
                      <div className="flex-1">
                        <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</p>
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{opt.detail}</p>
                      </div>
                      <ChevronRight style={{ width: 14, height: 14, color: "rgba(255,255,255,0.08)" }} />
                    </motion.button>
                  );
                })}
              </div>

              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.1)", textAlign: "center" }}>
                {tr("You'll be notified when family members join", "سيتم إشعارك عند انضمام أفراد العائلة")}
              </p>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Safety Check All Modal ── */}
      <AnimatePresence>
        {showCheckAll && (
          <>
            <motion.div
              key="check-bg"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.82)" }}
              onClick={() => setShowCheckAll(false)}
            />
            <motion.div
              key="check-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
              className="absolute z-50 mx-8"
              style={{ top: "35%", left: 0, right: 0 }}
            >
              <div className="p-5 flex flex-col items-center text-center"
                style={{ borderRadius: 24, background: "rgba(10,18,32,0.99)", boxShadow: "inset 0 0 0 1px rgba(0,200,224,0.12)" }}
              >
                {checkAllSent ? (
                  <>
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="size-14 rounded-full flex items-center justify-center mb-3"
                      style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)" }}
                    >
                      <Check style={{ width: 24, height: 24, color: "#00C853" }} />
                    </motion.div>
                    <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>{tr("Check Sent", "تم الإرسال")}</p>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>
                      {tr("Safety check sent to", "تم إرسال فحص الأمان إلى")} {members.length} {tr("members", "أعضاء")}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="size-14 rounded-full flex items-center justify-center mb-3"
                      style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.1)" }}
                    >
                      <Radio style={{ width: 22, height: 22, color: "#00C8E0" }} />
                    </div>
                    <p className="text-white mb-1" style={{ fontSize: 16, fontWeight: 700 }}>{tr("Safety Check", "فحص الأمان")}</p>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", marginBottom: 16, lineHeight: 1.6 }}>
                      {tr("Send a safety check to all", "إرسال فحص أمان لجميع")} {members.length} {tr("members", "أعضاء")}
                    </p>
                    <div className="flex gap-2 w-full">
                      <button
                        onClick={() => setShowCheckAll(false)}
                        className="flex-1 py-3"
                        style={{ borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}
                      >
                        {tr("Cancel", "إلغاء")}
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={handleCheckAll}
                        className="flex-1 py-3"
                        style={{ borderRadius: 12, background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)", fontSize: 13, fontWeight: 600, color: "#00C8E0" }}
                      >
                        {tr("Send", "إرسال")}
                      </motion.button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Contextual Contact Edit Sheet — shared primitive ── */}
      <ContactEditSheet
        contact={editingContact}
        open={showEditSheet}
        onClose={() => setShowEditSheet(false)}
        onSaved={() => setShowEditSheet(false)}
      />
    </div>
  );
}