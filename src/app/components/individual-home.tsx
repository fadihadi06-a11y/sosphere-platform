import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, Bell,
  Users, MapPin, Timer, HeartPulse,
  ChevronRight, Smartphone, Mic, Footprints, Lock,
} from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { RecordingConsentModal } from "./recording-consent-modal";
import { useLang } from "./useLang";
import { getRecordingMode, setRecordingMode, availableRecordingModes, type RecordingMode } from "./subscription-service";
import { SecurityPinModal } from "./security-pin-modal";

// Load REAL emergency contacts from localStorage (saved during registration)
function loadFamilyMembers(): { id: number; name: string; role: string; avatar: string; online: boolean; lastSeen: string }[] {
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
          avatar: "",  // no avatar for real contacts — initials will show
          online: false,
          lastSeen: c.phone || "",
        }));
    }
  } catch (_) { /* ignore */ }
  return [];
}

function getQuickActions(isAr: boolean) {
  return [
    { id: "family",   icon: Users,      label: isAr ? "العائلة"        : "Family Circle", color: "#00C8E0", bg: "rgba(0,200,224,0.06)" },
    { id: "safewalk", icon: Footprints, label: isAr ? "المسار الآمن"   : "Safe Walk",     color: "#00C853", bg: "rgba(0,200,83,0.06)" },
    { id: "checkin",  icon: Timer,      label: isAr ? "تسجيل الحضور"   : "Check-in",      color: "#FF9500", bg: "rgba(255,150,0,0.06)" },
    { id: "medical",  icon: HeartPulse, label: isAr ? "البطاقة الطبية" : "Medical ID",    color: "#FF2D55", bg: "rgba(255,45,85,0.06)" },
  ];
}

export function IndividualHome({ userName, onSOSTrigger, onRecordingChange, onCheckinTimer, onMedicalID, onFamilyCircle, onEmergencyContacts, onLiveLocation, onNotifications, onSafeWalk, t: tProp }: { userName: string; onSOSTrigger: () => void; onRecordingChange?: (enabled: boolean) => void; onCheckinTimer?: () => void; onMedicalID?: () => void; onFamilyCircle?: () => void; onEmergencyContacts?: () => void; onLiveLocation?: () => void; onNotifications?: () => void; onSafeWalk?: () => void; t?: (key: string) => string }) {
  const t = tProp || ((k: string) => k);
  const { isAr } = useLang();
  const quickActions = getQuickActions(isAr);
  const familyMembers = loadFamilyMembers();
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activated, setActivated] = useState(false);
  const [shakeFlash, setShakeFlash] = useState(false);
  const [shakeEnabled, setShakeEnabled] = useState(true);
  const [shakePermission, setShakePermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [recMode, setRecMode] = useState<RecordingMode>(() => getRecordingMode());
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  // Cycle between available modes for the current tier. Cleanly persisted.
  const cycleRecMode = useCallback(() => {
    const modes = availableRecordingModes();
    const next = modes[(modes.indexOf(recMode) + 1) % modes.length];
    setRecMode(next);
    setRecordingMode(next);
  }, [recMode]);
  const recModeLabel = (m: RecordingMode): string => {
    if (isAr) return m === "during" ? "أثناء" : m === "both" ? "الاثنين" : "بعد";
    return m === "during" ? "During" : m === "both" ? "Both" : "After";
  };

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Shake detection is handled by parent mobile-app.tsx's useShakeDetection
  // (which shows a confirmation overlay). No local useShake to avoid double-trigger.

  useEffect(() => {
    if (typeof DeviceMotionEvent !== "undefined") setShakePermission("granted");
  }, []);

  const handleEnableShake = useCallback(async () => {
    // Permission handling only — actual shake detection is in mobile-app.tsx
    setShakePermission("granted");
    setShakeEnabled(true);
  }, []);

  const startHold = useCallback(() => {
    if (activated) return;
    setHolding(true);
    startTimeRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(elapsed / 3000, 1);
      setProgress(pct);
      if (pct >= 1) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setActivated(true);
        setHolding(false);
        setTimeout(() => { setActivated(false); setProgress(0); onSOSTrigger(); }, 800);
      }
    }, 20);
  }, [activated, onSOSTrigger]);

  const endHold = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!activated) { setHolding(false); setProgress(0); }
  }, [activated]);

  const radius = 78;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden relative" style={{ scrollbarWidth: "none" }}>
      {/* Shake flash */}
      <AnimatePresence>
        {shakeFlash && (
          <motion.div key="sf" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-30 pointer-events-none"
            style={{ background: "rgba(255,45,85,0.15)" }}
          />
        )}
      </AnimatePresence>

      {/* Ambient */}
      <div
        data-ambient-glow
        className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0) 0%, transparent 70%)" }}
      />

      <div style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 112px)" }}>
        {/* ── Top Bar ── */}
        <div className="flex items-center justify-between px-6 mb-5">
          <div className="flex items-center gap-2">
            <Shield className="size-[18px]" style={{ color: "#00C8E0" }} />
            <span className="text-white" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.3px" }}>
              SOSphere
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSecurityModal(true)}
              aria-label={isAr ? "رموز الأمان" : "Security PINs"}
              className="relative p-2 rounded-[12px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
            >
              <Lock className="size-[17px]" style={{ color: "rgba(255,255,255,0.35)" }} />
            </button>
            <button
              onClick={onNotifications}
              className="relative p-2 rounded-[12px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
            >
              <Bell className="size-[17px]" style={{ color: "rgba(255,255,255,0.35)" }} />
              <span className="absolute top-1.5 right-1.5 size-[6px] rounded-full"
                style={{ background: "#FF2D55", boxShadow: "0 0 6px rgba(255,45,85,0.6)" }}
              />
            </button>
          </div>
        </div>

        {/* ── Security PIN Modal (deactivation + duress) ── */}
        <SecurityPinModal
          open={showSecurityModal}
          onClose={() => setShowSecurityModal(false)}
          isAr={isAr}
        />

        {/* ── Greeting ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="px-6 mb-6"
        >
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>{(() => { const h = new Date().getHours(); if (isAr) return h < 12 ? "صباح الخير" : h < 17 ? "مساء الخير" : "مساء الخير"; return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening"; })()}</p>
          <h1 className="text-white mt-0.5" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px" }}>
            {isAr ? "ابقَ بأمان، " : "Stay Safe, "}<span style={{ color: "#00C8E0" }}>{userName.split(" ")[0]}</span>
          </h1>
        </motion.div>

        {/* ── SOS Button Section ── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="flex flex-col items-center mb-4"
        >
          {/* SOS Container */}
          <div
            className="relative w-[calc(100%-40px)] flex flex-col items-center py-7"
            style={{
              borderRadius: 28,
              background: "rgba(255,255,255,0.015)",
              border: "1px solid rgba(255,255,255,0.035)",
              backdropFilter: "blur(20px)",
            }}
          >
            {/* Trigger tags */}
            <div className="flex items-center gap-2 mb-5">
              <div className="flex items-center gap-1.5 px-2.5 py-[5px]"
                style={{ borderRadius: 8, background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.1)" }}
              >
                <div className="size-[5px] rounded-full" style={{ background: "#FF2D55" }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,45,85,0.7)" }}>Hold 3s</span>
              </div>

              <button
                onClick={shakePermission === "unknown" ? handleEnableShake : undefined}
                className="flex items-center gap-1.5 px-2.5 py-[5px]"
                style={{
                  borderRadius: 8,
                  background: shakeEnabled ? "rgba(0,200,83,0.06)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${shakeEnabled ? "rgba(0,200,83,0.12)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                {shakeEnabled ? (
                  <motion.div animate={{ rotate: [-5, 5, -5] }} transition={{ duration: 0.4, repeat: Infinity, repeatDelay: 2.5 }}>
                    <Smartphone style={{ width: 10, height: 10, color: "#00C853" }} />
                  </motion.div>
                ) : (
                  <Smartphone style={{ width: 10, height: 10, color: "rgba(255,255,255,0.2)" }} />
                )}
                <span style={{ fontSize: 10, fontWeight: 600, color: shakeEnabled ? "rgba(0,200,83,0.7)" : "rgba(255,255,255,0.2)" }}>
                  Shake ×3
                </span>
              </button>

              <button
                onClick={() => { if (!recordingEnabled) setShowConsentModal(true); else setRecordingEnabled(false); }}
                className="flex items-center gap-1.5 px-2.5 py-[5px]"
                style={{
                  borderRadius: 8,
                  background: recordingEnabled ? "rgba(255,45,85,0.06)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${recordingEnabled ? "rgba(255,45,85,0.12)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                <Mic style={{ width: 10, height: 10, color: recordingEnabled ? "#FF2D55" : "rgba(255,255,255,0.2)" }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: recordingEnabled ? "rgba(255,45,85,0.7)" : "rgba(255,255,255,0.2)" }}>
                  {recordingEnabled ? "REC" : "REC"}
                </span>
                {recordingEnabled && (
                  <motion.div animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.9, repeat: Infinity }}
                    className="size-[5px] rounded-full" style={{ background: "#FF2D55" }}
                  />
                )}
              </button>

              {/* Recording timing mode — shown only when REC is enabled.
                  Tap to cycle through the available modes for the user's tier. */}
              {recordingEnabled && (
                <button
                  onClick={cycleRecMode}
                  aria-label={isAr ? "توقيت التسجيل" : "Recording timing"}
                  className="flex items-center gap-1.5 px-2.5 py-[5px]"
                  style={{
                    borderRadius: 8,
                    background: "rgba(255,45,85,0.06)",
                    border: "1px solid rgba(255,45,85,0.12)",
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,45,85,0.8)" }}>
                    {recModeLabel(recMode)}
                  </span>
                </button>
              )}
            </div>

            {/* ── Premium SOS Button ── */}
            <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
              {/* Shake ring */}
              <AnimatePresence>
                {shakeFlash && (
                  <motion.div key="sr"
                    initial={{ scale: 1, opacity: 0.6 }} animate={{ scale: 1.5, opacity: 0 }} exit={{}}
                    transition={{ duration: 0.6 }}
                    className="absolute rounded-full pointer-events-none"
                    style={{ width: 200, height: 200, border: "2px solid rgba(255,45,85,0.5)" }}
                  />
                )}
              </AnimatePresence>

              {/* Outer glow halo — large soft red/green light */}
              <motion.div
                animate={{ scale: [1, 1.18, 1], opacity: [0.4, 0.7, 0.4] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="absolute rounded-full pointer-events-none"
                style={{
                  width: 210, height: 210,
                  background: activated
                    ? "radial-gradient(circle, rgba(0,200,83,0.35) 0%, rgba(0,200,83,0.1) 50%, transparent 72%)"
                    : "radial-gradient(circle, rgba(255,45,85,0.3) 0%, rgba(255,45,85,0.08) 50%, transparent 72%)",
                  filter: "blur(4px)",
                }}
              />

              {/* Middle glow ring — medium bright pulse */}
              <motion.div
                animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.9, 0.5] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
                className="absolute rounded-full pointer-events-none"
                style={{
                  width: 180, height: 180,
                  border: activated
                    ? "1.5px solid rgba(0,200,83,0.4)"
                    : "1.5px solid rgba(255,45,85,0.35)",
                  background: activated
                    ? "radial-gradient(circle, rgba(0,200,83,0.12) 0%, transparent 65%)"
                    : "radial-gradient(circle, rgba(255,45,85,0.1) 0%, transparent 65%)",
                }}
              />

              {/* Inner glow ring — fast bright pulse */}
              <motion.div
                animate={{ scale: [1, 1.06, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.7 }}
                className="absolute rounded-full pointer-events-none"
                style={{
                  width: 160, height: 160,
                  border: activated
                    ? "1px solid rgba(0,200,83,0.5)"
                    : "1px solid rgba(255,45,85,0.4)",
                  background: "transparent",
                }}
              />

              {/* Progress ring — SVG */}
              {(holding || activated) && (
                <svg className="absolute" width="170" height="170" viewBox="0 0 170 170" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="85" cy="85" r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2.5" />
                  <circle cx="85" cy="85" r={radius} fill="none"
                    stroke={activated ? "#00C853" : "rgba(255,255,255,0.6)"}
                    strokeWidth="2.5" strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - progress)}
                    style={{ transition: "stroke-dashoffset 0.05s linear, stroke 0.5s", filter: activated ? "drop-shadow(0 0 6px rgba(0,200,83,0.5))" : "drop-shadow(0 0 4px rgba(255,255,255,0.3))" }}
                  />
                </svg>
              )}

              {/* The main button */}
              <motion.button
                onMouseDown={startHold} onMouseUp={endHold} onMouseLeave={endHold}
                onTouchStart={startHold} onTouchEnd={endHold}
                whileTap={{ scale: 0.93 }}
                animate={shakeFlash ? { scale: [1, 0.92, 1] } : {}}
                transition={shakeFlash ? { duration: 0.3 } : {}}
                className="relative z-10 rounded-full flex flex-col items-center justify-center select-none cursor-pointer"
                style={{
                  width: 144, height: 144,
                  WebkitUserSelect: "none",
                  userSelect: "none",
                  WebkitTouchCallout: "none",
                  WebkitTapHighlightColor: "transparent",
                  background: activated
                    ? "radial-gradient(circle at 40% 35%, #00E676 0%, #00C853 40%, #009940 100%)"
                    : holding
                      ? `radial-gradient(circle at 40% 35%, #FF6B81 0%, #FF2D55 40%, #B8002B 100%)`
                      : "radial-gradient(circle at 40% 35%, #FF4F6E 0%, #FF2D55 35%, #CC0033 70%, #99001A 100%)",
                  boxShadow: activated
                    ? "0 0 60px rgba(0,200,83,0.35), 0 0 120px rgba(0,200,83,0.15), 0 8px 32px rgba(0,200,83,0.2), inset 0 2px 0 rgba(255,255,255,0.2)"
                    : holding
                      ? `0 0 ${40 + progress * 60}px rgba(255,45,85,${0.2 + progress * 0.3}), 0 0 ${80 + progress * 40}px rgba(255,45,85,${0.08 + progress * 0.12}), inset 0 2px 0 rgba(255,255,255,0.15)`
                      : "0 0 50px rgba(255,45,85,0.2), 0 0 100px rgba(255,45,85,0.08), 0 8px 32px rgba(255,45,85,0.12), inset 0 2px 0 rgba(255,255,255,0.15)",
                  transition: "background 0.5s, box-shadow 0.3s",
                }}
              >
                {/* Glass highlight overlay */}
                <div className="absolute inset-0 rounded-full" style={{
                  background: "linear-gradient(170deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 30%, transparent 55%)",
                }} />

                {/* Subtle inner ring */}
                <div className="absolute rounded-full" style={{
                  inset: 4,
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "50%",
                }} />

                {/* SOSphere text + SOS */}
                <span className="relative pointer-events-none" style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "2.5px", marginBottom: 2 }}>
                  SOSphere
                </span>
                <span className="relative text-white pointer-events-none" style={{
                  fontSize: activated ? 16 : 38,
                  fontWeight: 900,
                  letterSpacing: activated ? "1.5px" : "5px",
                  textShadow: "0 2px 8px rgba(0,0,0,0.3)",
                }}>
                  {activated ? (isAr ? "تم" : "SENT") : "SOS"}
                </span>
                <span className="relative mt-0.5 pointer-events-none" style={{
                  fontSize: 9,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.45)",
                }}>
                  {activated ? (isAr ? "المساعدة في الطريق" : "Help is on the way") : (isAr ? "اضغط 3 ثواني" : "Hold 3 seconds")}
                </span>
              </motion.button>
            </div>

            {/* Shake hint */}
            {shakeEnabled && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", marginTop: 10 }}
              >
                {isAr ? "أو هز هاتفك 3 مرات بقوة" : "Or shake your phone 3 times"}
              </motion.p>
            )}
          </div>
        </motion.div>

        {/* ── Quick Actions ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="px-5 mb-5"
        >
          <div className="grid grid-cols-4 gap-2">
            {/* AUDIT-FIX (2026-04-21): unified visual weight for all
                quick actions — identical card background + border +
                icon tint strength + label weight/color. The colour
                identity of each action (cyan/green/orange/red) now
                lives ONLY in the icon stroke, not in the card tint.
                This removes the "some clear, some transparent" feeling. */}
            {quickActions.map((action, i) => (
              <motion.button
                key={action.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.25 + i * 0.05 }}
                whileTap={{ scale: 0.94 }}
                onClick={action.id === "checkin" ? onCheckinTimer : action.id === "medical" ? onMedicalID : action.id === "family" ? onFamilyCircle : action.id === "location" ? onLiveLocation : action.id === "safewalk" ? onSafeWalk : undefined}
                className="flex flex-col items-center gap-2 py-3"
                style={{
                  borderRadius: 16,
                  background: "rgba(255,255,255,0.035)",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
                }}
              >
                <div
                  className="size-9 rounded-[11px] flex items-center justify-center"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    boxShadow: `inset 0 0 0 1px ${action.color}30`,
                  }}
                >
                  <action.icon className="size-[15px]" style={{ color: action.color }} strokeWidth={2.2} />
                </div>
                <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.72)", fontWeight: 600, textAlign: "center", lineHeight: 1.3, letterSpacing: "0.1px" }}>
                  {action.label}
                </span>
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* ── Emergency Contacts (Family Circle) ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="px-5 mb-5"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-white" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px" }}>
              {isAr ? "جهات الطوارئ" : "Emergency Contacts"}
            </p>
            <button className="flex items-center gap-0.5" onClick={onFamilyCircle} style={{ fontSize: 12, color: "rgba(0,200,224,0.5)", fontWeight: 500 }}>
              {isAr ? "عرض الكل" : "View All"} <ChevronRight className="size-3.5" />
            </button>
          </div>
          <div
            className="px-3 py-3.5"
            style={{
              borderRadius: 18,
              background: "rgba(255,255,255,0.015)",
              border: "1px solid rgba(255,255,255,0.035)",
            }}
          >
            {familyMembers.length > 0 ? (
              <div className="flex items-center justify-around">
                {familyMembers.map((member) => (
                  <div key={member.id} className="flex flex-col items-center gap-1.5">
                    <div className="relative">
                      <div
                        className="size-[46px] rounded-full overflow-hidden flex items-center justify-center"
                        style={{
                          border: "1.5px solid rgba(0,200,224,0.2)",
                          padding: 1.5,
                          background: "rgba(0,200,224,0.08)",
                        }}
                      >
                        {member.avatar ? (
                          <ImageWithFallback src={member.avatar} alt={member.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          <span style={{ fontSize: 18, fontWeight: 700, color: "#00C8E0" }}>
                            {member.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-white" style={{ fontSize: 11, fontWeight: 600 }}>{member.name}</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>
                        {member.role}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-3">
                <Users className="size-6 mb-2" style={{ color: "rgba(255,255,255,0.15)" }} />
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
                  {isAr ? "لم تُضف جهات طوارئ بعد" : "No emergency contacts added yet"}
                </p>
                <button onClick={onFamilyCircle} className="mt-2" style={{ fontSize: 12, color: "#00C8E0", fontWeight: 500 }}>
                  {isAr ? "إضافة جهة اتصال" : "Add Contact"}
                </button>
              </div>
            )}
          </div>
        </motion.div>

      </div>

      {/* Recording Consent Modal */}
      <RecordingConsentModal
        visible={showConsentModal}
        lang={isAr ? "ar" : "en"}
        onAccept={() => { setRecordingEnabled(true); onRecordingChange?.(true); setShowConsentModal(false); }}
        onDecline={() => { setRecordingEnabled(false); onRecordingChange?.(false); setShowConsentModal(false); }}
      />
    </div>
  );
}