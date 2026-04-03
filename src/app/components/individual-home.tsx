import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, Bell,
  Users, MapPin, Timer, HeartPulse,
  ChevronRight, Smartphone, Mic, Footprints,
} from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { RecordingConsentModal } from "./recording-consent-modal";

const familyMembers = [
  {
    id: 1, name: "Sarah", role: "Wife",
    avatar: "https://images.unsplash.com/photo-1655249493799-9cee4fe983bb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjB3b21hbiUyMHBvcnRyYWl0JTIwaGVhZHNob3R8ZW58MXx8fHwxNzcyNzY3MDk0fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
    online: true, lastSeen: "Now",
  },
  {
    id: 2, name: "Alex", role: "Son",
    avatar: "https://images.unsplash.com/photo-1631905131477-eefc1360588a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0ZWVuYWdlciUyMGJveSUyMHBvcnRyYWl0JTIwaGVhZHNob3R8ZW58MXx8fHwxNzcyODMyMjM5fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
    online: true, lastSeen: "Now",
  },
  {
    id: 3, name: "Mom", role: "Mother",
    avatar: "https://images.unsplash.com/photo-1758686254563-5c5ab338c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxlbGRlcmx5JTIwd29tYW4lMjBzbWlsaW5nJTIwcG9ydHJhaXR8ZW58MXx8fHwxNzcyNzU4MDg3fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
    online: false, lastSeen: "25m ago",
  },
  {
    id: 4, name: "David", role: "Brother",
    avatar: "https://images.unsplash.com/photo-1628619487925-e9b8fc4c6b08?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx5b3VuZyUyMG1hbiUyMHBvcnRyYWl0JTIwY2FzdWFsJTIwaGVhZHNob3R8ZW58MXx8fHwxNzcyODMyMjM4fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
    online: false, lastSeen: "1h ago",
  },
];

const quickActions = [
  { id: "family", icon: Users, label: "Family Circle", color: "#00C8E0", bg: "rgba(0,200,224,0.06)" },
  { id: "safewalk", icon: Footprints, label: "Safe Walk", color: "#00C853", bg: "rgba(0,200,83,0.06)" },
  { id: "checkin", icon: Timer, label: "Check-in Timer", color: "#FF9500", bg: "rgba(255,150,0,0.06)" },
  { id: "medical", icon: HeartPulse, label: "Medical ID", color: "#FF2D55", bg: "rgba(255,45,85,0.06)" },
];

export function IndividualHome({ userName, onSOSTrigger, onRecordingChange, onCheckinTimer, onMedicalID, onFamilyCircle, onLiveLocation, onNotifications, onSafeWalk }: { userName: string; onSOSTrigger: () => void; onRecordingChange?: (enabled: boolean) => void; onCheckinTimer?: () => void; onMedicalID?: () => void; onFamilyCircle?: () => void; onLiveLocation?: () => void; onNotifications?: () => void; onSafeWalk?: () => void }) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activated, setActivated] = useState(false);
  const [shakeFlash, setShakeFlash] = useState(false);
  const [shakeEnabled, setShakeEnabled] = useState(true);
  const [shakePermission, setShakePermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);

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

  const radius = 62;
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
      <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0.03) 0%, transparent 70%)" }}
      />

      <div className="pt-14 pb-28">
        {/* ── Top Bar ── */}
        <div className="flex items-center justify-between px-6 mb-5">
          <div className="flex items-center gap-2">
            <Shield className="size-[18px]" style={{ color: "#00C8E0" }} />
            <span className="text-white" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.3px" }}>
              SOSphere
            </span>
          </div>
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

        {/* ── Greeting ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="px-6 mb-6"
        >
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>Good Morning</p>
          <h1 className="text-white mt-0.5" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px" }}>
            Stay Safe, <span style={{ color: "#00C8E0" }}>{userName.split(" ")[0]}</span>
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
            </div>

            {/* Button */}
            <div className="relative flex items-center justify-center" style={{ width: 150, height: 150 }}>
              {/* Shake ring */}
              <AnimatePresence>
                {shakeFlash && (
                  <motion.div key="sr"
                    initial={{ scale: 1, opacity: 0.4 }} animate={{ scale: 1.4, opacity: 0 }} exit={{}}
                    transition={{ duration: 0.5 }}
                    className="absolute rounded-full pointer-events-none"
                    style={{ width: 150, height: 150, border: "2px solid rgba(255,45,85,0.4)" }}
                  />
                )}
              </AnimatePresence>

              {/* Ambient pulse */}
              <motion.div
                animate={{ scale: [1, 1.12, 1], opacity: [0.08, 0, 0.08] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="absolute rounded-full"
                style={{ width: 150, height: 150, background: activated ? "rgba(0,200,83,0.1)" : "rgba(255,45,85,0.06)" }}
              />

              {/* Progress ring */}
              {(holding || activated) && (
                <svg className="absolute" width="142" height="142" viewBox="0 0 142 142" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="71" cy="71" r={radius} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="2" />
                  <circle cx="71" cy="71" r={radius} fill="none"
                    stroke={activated ? "#00C853" : "rgba(255,255,255,0.5)"}
                    strokeWidth="2" strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - progress)}
                    style={{ transition: "stroke-dashoffset 0.05s linear, stroke 0.5s" }}
                  />
                </svg>
              )}

              {/* The button */}
              <motion.button
                onMouseDown={startHold} onMouseUp={endHold} onMouseLeave={endHold}
                onTouchStart={startHold} onTouchEnd={endHold}
                whileTap={{ scale: 0.95 }}
                animate={shakeFlash ? { scale: [1, 0.94, 1] } : {}}
                transition={shakeFlash ? { duration: 0.3 } : {}}
                className="relative z-10 rounded-full flex flex-col items-center justify-center select-none cursor-pointer"
                style={{
                  width: 128, height: 128,
                  background: activated
                    ? "linear-gradient(180deg, #00C853 0%, #009940 100%)"
                    : "linear-gradient(180deg, #FF2D55 0%, #CC0033 100%)",
                  boxShadow: activated
                    ? "0 0 40px rgba(0,200,83,0.2), 0 12px 40px rgba(0,200,83,0.1), inset 0 1.5px 0 rgba(255,255,255,0.15)"
                    : holding
                      ? `0 0 ${30 + progress * 30}px rgba(255,45,85,${0.15 + progress * 0.15}), inset 0 1.5px 0 rgba(255,255,255,0.12)`
                      : "0 0 30px rgba(255,45,85,0.12), 0 12px 40px rgba(255,45,85,0.06), inset 0 1.5px 0 rgba(255,255,255,0.12)",
                  transition: "background 0.5s, box-shadow 0.3s",
                }}
              >
                <div className="absolute inset-0 rounded-full" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 50%)" }} />
                <span className="relative text-white" style={{ fontSize: activated ? 15 : 32, fontWeight: 800, letterSpacing: activated ? "1px" : "3px" }}>
                  {activated ? "SENT ✓" : "SOS"}
                </span>
                <span className="relative text-white/40 mt-0.5" style={{ fontSize: 9, fontWeight: 500 }}>
                  {activated ? "Help is on the way" : "Hold 3 seconds"}
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
                أو هز هاتفك 3 مرات بقوة
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
                  background: "rgba(255,255,255,0.015)",
                  border: "1px solid rgba(255,255,255,0.035)",
                }}
              >
                <div
                  className="size-9 rounded-[11px] flex items-center justify-center"
                  style={{ background: action.bg, border: `1px solid ${action.color}15` }}
                >
                  <action.icon className="size-[15px]" style={{ color: action.color }} />
                </div>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, textAlign: "center", lineHeight: 1.3 }}>
                  {action.label}
                </span>
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* ── Family Circle ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="px-5 mb-5"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-white" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px" }}>
              Family Circle
            </p>
            <button className="flex items-center gap-0.5" onClick={onFamilyCircle} style={{ fontSize: 12, color: "rgba(0,200,224,0.5)", fontWeight: 500 }}>
              View All <ChevronRight className="size-3.5" />
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
            <div className="flex items-center justify-around">
              {familyMembers.map((member) => (
                <div key={member.id} className="flex flex-col items-center gap-1.5">
                  <div className="relative">
                    <div
                      className="size-[46px] rounded-full overflow-hidden"
                      style={{
                        border: member.online ? "1.5px solid rgba(0,200,83,0.35)" : "1.5px solid rgba(255,255,255,0.06)",
                        padding: 1.5,
                      }}
                    >
                      <ImageWithFallback src={member.avatar} alt={member.name} className="w-full h-full rounded-full object-cover" />
                    </div>
                    <span
                      className="absolute bottom-0 right-0 size-3 rounded-full"
                      style={{
                        background: member.online ? "#00C853" : "rgba(255,255,255,0.12)",
                        border: "2px solid #0A1220",
                        boxShadow: member.online ? "0 0 6px rgba(0,200,83,0.4)" : "none",
                      }}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-white" style={{ fontSize: 11, fontWeight: 600 }}>{member.name}</p>
                    <p style={{ fontSize: 9, color: member.online ? "rgba(0,200,83,0.6)" : "rgba(255,255,255,0.15)", fontWeight: 500 }}>
                      {member.lastSeen}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Status Card ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="px-5"
        >
          <p className="text-white mb-3" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px" }}>
            Status
          </p>
          <div className="space-y-2">
            {[
              { label: "Sarah", sub: "Checked in", time: "2m ago", color: "#00C853", dot: true },
              { label: "Alex", sub: "Left school zone", time: "18m ago", color: "#00C8E0", dot: true },
              { label: "Mom", sub: "Last check-in", time: "25m ago", color: "#FF9500", dot: false },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3.5 py-3"
                style={{
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.015)",
                  border: "1px solid rgba(255,255,255,0.035)",
                }}
              >
                <div className="relative">
                  <div
                    className="size-[7px] rounded-full"
                    style={{ background: item.color, boxShadow: item.dot ? `0 0 6px ${item.color}40` : "none", opacity: item.dot ? 1 : 0.4 }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>
                    <span style={{ fontWeight: 600, color: "#fff" }}>{item.label}</span>{" "}
                    <span style={{ color: "rgba(255,255,255,0.3)" }}>{item.sub}</span>
                  </p>
                </div>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.12)", fontWeight: 400 }}>{item.time}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Recording Consent Modal */}
      <RecordingConsentModal
        visible={showConsentModal}
        onAccept={() => { setRecordingEnabled(true); onRecordingChange?.(true); setShowConsentModal(false); }}
        onDecline={() => { setRecordingEnabled(false); onRecordingChange?.(false); setShowConsentModal(false); }}
      />
    </div>
  );
}