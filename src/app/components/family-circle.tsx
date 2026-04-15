import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MapPin, Phone,
  MessageSquare, ChevronRight, X, Check,
  Send, UserPlus,
  Copy, Share2, Radio,
} from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import type { Lang } from "./dashboard-i18n";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface FamilyMember {
  id: number;
  name: string;
  role: string;
  avatar: string;
  online: boolean;
  lastSeen: string;
  location: string;
  battery: number;
  safetyStatus: "safe" | "alert" | "sos" | "unknown";
  sharingLocation: boolean;
}

// ─── Load REAL emergency contacts from localStorage ──────────────────────────
function loadRealMembers(): FamilyMember[] {
  try {
    const raw = localStorage.getItem("sosphere_emergency_contacts");
    if (raw) {
      const contacts: { name: string; phone: string }[] = JSON.parse(raw);
      return contacts
        .filter(c => c.name?.trim())
        .map((c, i) => ({
          id: i + 1,
          name: c.name,
          role: c.phone || "",
          avatar: "", // real contacts use initials
          online: false,
          lastSeen: "",
          location: "",
          battery: 0,
          safetyStatus: "unknown" as const,
          sharingLocation: false,
        }));
    }
  } catch (_) { /* ignore */ }
  return [];
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
  const [members] = useState<FamilyMember[]>(loadRealMembers);
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showCheckAll, setShowCheckAll] = useState(false);
  const [checkAllSent, setCheckAllSent] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

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
      {/* Ambient */}
      <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0.03) 0%, transparent 70%)" }}
      />

      <div className="pt-14 pb-28">
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
          <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.12)", letterSpacing: "0.6px", marginBottom: 10, textTransform: "uppercase" }}>
            {tr("Members", "الأعضاء")} ({members.length})
          </p>

          <div className="space-y-2.5">
            {members.map((member, i) => {
              const status = statusConfig[member.safetyStatus];
              return (
                <motion.button
                  key={member.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.06 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedMember(member)}
                  className="w-full text-left"
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

                    <ChevronRight style={{ width: 14, height: 14, color: "rgba(255,255,255,0.08)" }} />
                  </div>
                </motion.button>
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
              style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
              onClick={() => setSelectedMember(null)}
            />
            <motion.div
              key="detail-modal"
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute bottom-0 left-0 right-0 z-50 px-5 pb-10 pt-5"
              style={{
                borderRadius: "28px 28px 0 0",
                background: "rgba(10,18,32,0.98)",
                backdropFilter: "blur(40px)",
                borderTop: `1px solid ${statusConfig[selectedMember.safetyStatus].color}20`,
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
                <button onClick={() => setSelectedMember(null)}>
                  <X style={{ width: 18, height: 18, color: "rgba(255,255,255,0.3)" }} />
                </button>
              </div>

              {/* Quick Actions — simplified: Call + Message only */}
              <div className="grid grid-cols-2 gap-2.5 mb-5">
                {/* Primary: One-tap Call */}
                <motion.button
                  whileTap={{ scale: 0.93 }}
                  className="flex items-center justify-center gap-2.5 py-4"
                  style={{ borderRadius: 16, background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}
                >
                  <Phone style={{ width: 18, height: 18, color: "#00C853" }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#00C853" }}>{tr("Call", "اتصال")}</span>
                </motion.button>
                {/* Message */}
                <motion.button
                  whileTap={{ scale: 0.93 }}
                  className="flex items-center justify-center gap-2.5 py-4"
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

              {/* Request Check-in */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                className="w-full flex items-center justify-center gap-2 py-3.5 mt-4"
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
              style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
              onClick={() => setShowInvite(false)}
            />
            <motion.div
              key="invite-modal"
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute bottom-0 left-0 right-0 z-50 px-5 pb-10 pt-5"
              style={{
                borderRadius: "28px 28px 0 0",
                background: "rgba(10,18,32,0.98)",
                backdropFilter: "blur(40px)",
                borderTop: "1px solid rgba(0,200,224,0.12)",
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
                  return (
                    <motion.button
                      key={opt.label}
                      whileTap={{ scale: 0.98 }}
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
              style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
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
                style={{ borderRadius: 24, background: "rgba(10,18,32,0.98)", border: "1px solid rgba(0,200,224,0.12)", backdropFilter: "blur(40px)" }}
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
    </div>
  );
}