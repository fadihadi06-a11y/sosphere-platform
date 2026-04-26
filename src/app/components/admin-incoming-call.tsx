// ═══════════════════════════════════════════════════════════════
// SOSphere — Admin Incoming Call System
// Two modes:
//   1. INCOMING: Full overlay when employee triggers SOS + calling
//   2. ACTIVE_BAR: Small floating bar after admin answers (with End Call)
//   3. OUTGOING: Admin calling back employee from missed calls
// Also handles End Call for admin-initiated calls (from CallPanel)
// ═══════════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Phone, PhoneOff, X, MapPin,
  Shield, Mic, MicOff, Volume2, AlertTriangle,
} from "lucide-react";
import {
  onCallSignal, emitCallSignal, clearCallSignal, getCallSignal,
  onAdminCallChange, getAdminActiveCall, endAdminCall,
  emitSyncEvent, addMissedCall,
  type CallSignal, type AdminActiveCall,
} from "./shared-store";
import { voiceCallEngine, type VoiceCallInfo } from "./voice-call-engine";
import { trackEventSync } from "./smart-timeline-tracker";
import { supabase } from "./api/supabase-client";

// ── Pulse ring animation ──────────────────────────────────────
function PulseRings({ color }: { color: string }) {
  return (
    <div className="contents">
      {[1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute inset-0 rounded-full pointer-events-none"
          animate={{ scale: [1, 1.4 + i * 0.15, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.35, ease: "easeOut" }}
          style={{ border: `1.5px solid ${color}`, boxShadow: `0 0 12px ${color}40` }}
        />
      ))}
    </div>
  );
}

// ── Format seconds to MM:SS ────────────────────────────────────
function fmt(s: number): string {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════
// PART 1: Incoming Call Overlay (Employee → Admin)
// ═══════════════════════════════════════════════════════════════
type IncomingCallState = "ringing" | "connected" | "declined" | "missed";

interface IncomingCallOverlayProps {
  signal: CallSignal;
  onDismiss: () => void;
}

function IncomingCallOverlay({ signal, onDismiss }: IncomingCallOverlayProps) {
  const [callState, setCallState] = useState<IncomingCallState>("ringing");
  const [muted, setMuted] = useState(false);
  const [voiceInfo, setVoiceInfo] = useState<VoiceCallInfo | null>(null);
  const voiceUnsubRef = useRef<(() => void) | null>(null);
  const callStateRef = useRef<IncomingCallState>("ringing");
  const ringStartRef = useRef(Date.now());

  // Auto-miss after 30s
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (callState === "ringing") {
        // ── PHONE FALLBACK: Try admin's phone before giving up ──
        try {
          const adminPhone = localStorage.getItem("sosphere_admin_phone");
          if (adminPhone) {
            // Try to ring admin's mobile phone
            window.open(`tel:${adminPhone.replace(/\s/g, "")}`, "_system");
          }
        } catch {}

        setCallState("missed");
        voiceCallEngine.forceReset();
        if (voiceUnsubRef.current) { voiceUnsubRef.current(); voiceUnsubRef.current = null; }
        emitCallSignal({
          type: "ADMIN_DECLINED",
          employeeId: signal.employeeId,
          employeeName: signal.employeeName,
          zone: signal.zone,
        });
        emitSyncEvent({
          type: "ADMIN_UNREACHABLE",
          employeeId: signal.employeeId,
          employeeName: signal.employeeName,
          zone: signal.zone,
          timestamp: Date.now(),
          data: {
            action: "missed",
            reason: "Auto-timeout after 30s",
            responseTimeSec: Math.round((Date.now() - ringStartRef.current) / 1000),
          },
        });
        addMissedCall({
          employeeId: signal.employeeId,
          employeeName: signal.employeeName,
          zone: signal.zone,
          timestamp: Date.now(),
          missedOn: "desktop",
        });

        // Track admin missed in timeline
        trackEventSync(
          signal.data?.emergencyId as string || "unknown",
          "admin_missed",
          `Admin did not answer call from ${signal.employeeName} within 30s`,
          "System", "System",
          { missedOn: "desktop", responseTimeSec: 30 }
        );

        setTimeout(onDismiss, 2500);
      }
    }, 30000);
    return () => clearTimeout(timeout);
  }, [callState]);

  // Listen for CALL_ENDED from employee side
  useEffect(() => {
    const unsub = onCallSignal((s) => {
      if (s?.type === "CALL_ENDED" && s.employeeId === signal.employeeId) {
        if (callStateRef.current === "connected") {
          callStateRef.current = "missed" as any;
        }
        setCallState("missed");
        voiceCallEngine.endCall();
        if (voiceUnsubRef.current) { voiceUnsubRef.current(); voiceUnsubRef.current = null; }
        setTimeout(onDismiss, 2000);
      }
    });
    return unsub;
  }, [signal.employeeId]);

  const handleAnswer = async () => {
    const responseTimeSec = Math.round((Date.now() - ringStartRef.current) / 1000);
    setCallState("connected");
    callStateRef.current = "connected";
    emitCallSignal({
      type: "ADMIN_ANSWERED",
      employeeId: signal.employeeId,
      employeeName: signal.employeeName,
      zone: signal.zone,
    });
    emitSyncEvent({
      type: "ADMIN_ACKNOWLEDGED",
      employeeId: signal.employeeId,
      employeeName: signal.employeeName,
      zone: signal.zone,
      timestamp: Date.now(),
      data: {
        action: "answered",
        responseTimeSec,
        adminName: "Safety Admin",
      },
    });

    // Track admin answer in timeline
    trackEventSync(
      signal.data?.emergencyId as string || "unknown",
      "admin_answered",
      `Admin answered call from ${signal.employeeName}`,
      "Admin", "Admin",
      { responseTimeSec }
    );

    const callId = `sos-call-${signal.employeeId}`;
    voiceUnsubRef.current = voiceCallEngine.subscribe((info) => {
      setVoiceInfo(info);
      if (info.state === "ended" && callStateRef.current !== "missed") {
        handleEndCall();
      }
    });
    await voiceCallEngine.answerCall(callId, 60);
  };

  const handleDecline = () => {
    setCallState("declined");
    voiceCallEngine.forceReset();
    if (voiceUnsubRef.current) { voiceUnsubRef.current(); voiceUnsubRef.current = null; }
    emitCallSignal({
      type: "ADMIN_DECLINED",
      employeeId: signal.employeeId,
      employeeName: signal.employeeName,
      zone: signal.zone,
    });
    emitSyncEvent({
      type: "ADMIN_UNREACHABLE",
      employeeId: signal.employeeId,
      employeeName: signal.employeeName,
      zone: signal.zone,
      timestamp: Date.now(),
      data: {
        action: "declined",
        responseTimeSec: Math.round((Date.now() - ringStartRef.current) / 1000),
        adminName: "Safety Admin",
      },
    });
    setTimeout(onDismiss, 1800);
  };

  const handleEndCall = () => {
    if (voiceUnsubRef.current) { voiceUnsubRef.current(); voiceUnsubRef.current = null; }
    voiceCallEngine.endCall();
    const finalElapsed = voiceInfo?.elapsed ?? 0;
    emitCallSignal({
      type: "CALL_ENDED",
      employeeId: signal.employeeId,
      employeeName: signal.employeeName,
      zone: signal.zone,
    });
    emitSyncEvent({
      type: "SOS_CONTACT_ANSWERED",
      employeeId: signal.employeeId,
      employeeName: signal.employeeName,
      zone: signal.zone,
      timestamp: Date.now(),
      data: {
        action: "call_ended",
        callDurationSec: finalElapsed,
        adminName: "Safety Admin",
      },
    });
    clearCallSignal();
    onDismiss();
  };

  const initials = signal.employeeName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: -20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -16 }}
      transition={{ type: "spring", stiffness: 340, damping: 28 }}
      className="fixed inset-0 z-[9999] flex items-start justify-end pt-6 pr-6"
      style={{ pointerEvents: "none" }}
    >
      {/* Backdrop blur for the whole screen */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgba(5,7,14,0.75)", backdropFilter: "blur(6px)", pointerEvents: "auto" }}
        onClick={callState === "ringing" ? undefined : handleEndCall}
      />

      {/* Main Call Card */}
      <motion.div
        className="relative w-[380px] rounded-3xl overflow-hidden"
        style={{
          background: "linear-gradient(165deg, rgba(15,18,35,0.98) 0%, rgba(8,10,22,0.99) 100%)",
          border: "1px solid rgba(255,45,85,0.15)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 40px rgba(255,45,85,0.08)",
          pointerEvents: "auto",
        }}
      >
        {/* Red emergency bar at top */}
        {callState === "ringing" && (
          <motion.div
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="px-4 py-2 flex items-center justify-center gap-2"
            style={{ background: "rgba(255,45,85,0.12)", borderBottom: "1px solid rgba(255,45,85,0.1)" }}
          >
            <AlertTriangle className="size-3.5" style={{ color: "#FF2D55" }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: "#FF2D55", letterSpacing: 1.2, fontFamily: "'Outfit', sans-serif" }}>
              SOS EMERGENCY CALL
            </span>
          </motion.div>
        )}

        {/* Connected bar */}
        {callState === "connected" && (
          <div className="px-4 py-2 flex items-center justify-between" style={{ background: "rgba(0,200,83,0.08)", borderBottom: "1px solid rgba(0,200,83,0.1)" }}>
            <div className="flex items-center gap-2">
              <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1, repeat: Infinity }} style={{ width: 6, height: 6, borderRadius: "50%", background: "#00C853" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#00C853", fontFamily: "'Outfit', sans-serif" }}>Connected</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#00C853", fontFamily: "'Outfit', sans-serif" }}>{fmt(voiceInfo?.elapsed ?? 0)}</span>
          </div>
        )}

        {/* Avatar + Info */}
        <div className="flex flex-col items-center pt-8 pb-4 px-6">
          <div className="relative">
            <motion.div
              className="size-24 rounded-full flex items-center justify-center"
              style={{
                background: callState === "ringing"
                  ? "rgba(255,45,85,0.08)"
                  : callState === "connected"
                  ? "rgba(0,200,83,0.08)"
                  : "rgba(255,255,255,0.04)",
                border: `2.5px solid ${callState === "ringing" ? "rgba(255,45,85,0.25)" : callState === "connected" ? "rgba(0,200,83,0.25)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <span style={{
                fontSize: 32, fontWeight: 800, fontFamily: "'Outfit', sans-serif",
                color: callState === "ringing" ? "#FF2D55" : callState === "connected" ? "#00C853" : "rgba(255,255,255,0.3)",
              }}>
                {initials}
              </span>
            </motion.div>
            {callState === "ringing" && <PulseRings color="#FF2D55" />}
          </div>

          <h3 className="mt-5 text-white" style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Outfit', sans-serif" }}>
            {signal.employeeName}
          </h3>

          {signal.zone && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <MapPin className="size-3" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 12, color: "#00C8E0", fontWeight: 600 }}>{signal.zone}</span>
            </div>
          )}

          {/* GPS & Medical Info */}
          {signal.data?.lastGPS && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
              <MapPin style={{ width: 12, height: 12 }} />
              <span>GPS: {(signal.data.lastGPS as any).lat?.toFixed(4)}, {(signal.data.lastGPS as any).lng?.toFixed(4)}</span>
            </div>
          )}
          {signal.data?.bloodType && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#FF2D55", marginTop: 6 }}>
              <Shield style={{ width: 12, height: 12 }} />
              <span>Blood Type: {signal.data.bloodType as string}</span>
            </div>
          )}
          {signal.data?.battery != null && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: (signal.data.battery as number) <= 15 ? "#FF2D55" : "rgba(255,255,255,0.6)", marginTop: 6 }}>
              <AlertTriangle style={{ width: 12, height: 12 }} />
              <span>Battery: {signal.data.battery as number}%</span>
            </div>
          )}

          <p className="mt-2" style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
            {callState === "ringing" ? `${signal.employeeName} is calling you` :
             callState === "connected" ? "Call in progress" :
             callState === "declined" ? "Call declined" :
             "Call missed"}
          </p>

          {/* Emergency context */}
          {callState === "ringing" && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 w-full p-3 rounded-xl"
              style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.08)" }}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-3.5 mt-0.5 flex-shrink-0" style={{ color: "#FF2D55" }} />
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#FF2D55" }}>Active SOS Emergency</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                    Employee is in danger and requesting help. Answering enables direct coordination.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="px-6 pb-6 pt-2">
          {callState === "ringing" && (
            <div className="flex gap-3">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleDecline}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl"
                style={{
                  background: "rgba(255,45,85,0.08)",
                  border: "1px solid rgba(255,45,85,0.15)",
                  cursor: "pointer",
                }}
              >
                <PhoneOff className="size-4" style={{ color: "#FF2D55" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#FF2D55" }}>Decline</span>
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleAnswer}
                animate={{ boxShadow: ["0 0 0 0 rgba(0,200,83,0)", "0 0 0 8px rgba(0,200,83,0.15)", "0 0 0 0 rgba(0,200,83,0)"] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl"
                style={{
                  background: "linear-gradient(135deg, rgba(0,200,83,0.15), rgba(0,200,83,0.08))",
                  border: "1px solid rgba(0,200,83,0.25)",
                  cursor: "pointer",
                }}
              >
                <Phone className="size-4" style={{ color: "#00C853" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#00C853" }}>Answer</span>
              </motion.button>
            </div>
          )}

          {callState === "connected" && (
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setMuted(!muted)}
                className="size-12 rounded-full flex items-center justify-center"
                style={{
                  background: muted ? "rgba(255,45,85,0.12)" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${muted ? "rgba(255,45,85,0.2)" : "rgba(255,255,255,0.08)"}`,
                  cursor: "pointer",
                }}
              >
                {muted ? <MicOff className="size-5" style={{ color: "#FF2D55" }} /> : <Mic className="size-5" style={{ color: "rgba(255,255,255,0.6)" }} />}
              </button>
              <button
                className="size-12 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}
              >
                <Volume2 className="size-5" style={{ color: "rgba(255,255,255,0.6)" }} />
              </button>
              <button
                onClick={handleEndCall}
                className="size-12 rounded-full flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #FF2D55, #cc1a3a)",
                  boxShadow: "0 4px 16px rgba(255,45,85,0.3)",
                  cursor: "pointer",
                }}
              >
                <PhoneOff className="size-5 text-white" />
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PART 2: Admin Active Call Mini-Bar (from CallPanel)
// ═══════════════════════════════════════════════════════════════
function AdminActiveCallMiniBar({ call, onEnd }: { call: AdminActiveCall; onEnd: () => void }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, [call.startedAt]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="fixed top-4 right-4 z-[9998] flex items-center gap-3 px-4 py-2.5 rounded-2xl"
      style={{
        background: "linear-gradient(135deg, rgba(15,18,35,0.95), rgba(8,10,22,0.95))",
        border: "1px solid rgba(0,200,83,0.15)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        backdropFilter: "blur(20px)",
      }}
    >
      <motion.div
        animate={{ scale: [1, 1.3, 1] }}
        transition={{ duration: 1, repeat: Infinity }}
        style={{ width: 8, height: 8, borderRadius: "50%", background: "#00C853" }}
      />
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: "'Outfit', sans-serif" }}>
          {call.employeeName}
        </p>
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
          {call.zone || "Direct call"} · {fmt(elapsed)}
        </p>
      </div>
      <button
        onClick={onEnd}
        className="ml-2 size-8 rounded-full flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, #FF2D55, #cc1a3a)",
          cursor: "pointer",
        }}
      >
        <PhoneOff className="size-3.5 text-white" />
      </button>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PART 3: Outgoing Callback Overlay (Admin → Employee call back)
// ═══════════════════════════════════════════════════════════════
type OutgoingCallState = "dialing" | "connecting" | "connected" | "ended";

function OutgoingCallbackOverlay({ signal, onDismiss }: { signal: CallSignal; onDismiss: () => void }) {
  const [callState, setCallState] = useState<OutgoingCallState>("dialing");
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const voiceUnsubRef = useRef<(() => void) | null>(null);
  const endedRef = useRef(false);
  const initials = signal.employeeName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  // ──────────────────────────────────────────────────────────────────
  // G-5 (B-20, 2026-04-26): replace setTimeout simulation with a REAL
  // Twilio call invocation. Pre-fix: dialing → connecting → connected
  // progressed via hardcoded timeouts and started a LOCAL voice engine
  // that was never bridged to PSTN. The admin saw "Connected" while
  // the employee's phone never rang. Now: invoke twilio-call with
  // mode="employee_callback"; the v12 edge function verifies the caller
  // is admin/owner of the emergency's company AND that `to` matches
  // the SOS owner's phone before placing the call.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const callId = (signal.data?.emergencyId as string) || `callback-${signal.employeeId}`;

    (async () => {
      try {
        const employeePhone = (signal.data as any)?.employeePhone as string | undefined;
        if (!employeePhone) {
          console.warn("[admin-callback] no employeePhone in signal — cannot place real call");
          if (!cancelled) {
            setCallState("ended");
            setTimeout(onDismiss, 2000);
          }
          return;
        }

        const { data, error } = await supabase.functions.invoke("twilio-call", {
          body: {
            mode: "employee_callback",
            to: employeePhone,
            callId,
            employeeName: signal.employeeName,
            companyName: (signal.data as any)?.companyName ?? undefined,
            zoneName: signal.zone ?? undefined,
          },
        });

        if (cancelled) return;

        if (error || !(data as any)?.callSid) {
          console.warn("[admin-callback] twilio-call invocation failed:", error?.message);
          setCallState("ended");
          setTimeout(onDismiss, 2000);
          return;
        }

        // Twilio queued the dial. UI advances to connecting; the voice
        // engine takes over for the in-app local audio side.
        setCallState("connecting");
        voiceUnsubRef.current = voiceCallEngine.subscribe((info) => {
          if (info.state === "ended" && !endedRef.current) handleEndCall();
          if (info.state === "active") setCallState("connected");
        });
        voiceCallEngine.startCall(callId, 120);
      } catch (err) {
        console.error("[admin-callback] unexpected error:", err);
        if (!cancelled) {
          setCallState("ended");
          setTimeout(onDismiss, 2000);
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Timer for connected state
  useEffect(() => {
    if (callState !== "connected") return;
    const i = setInterval(() => setElapsed(p => p + 1), 1000);
    return () => clearInterval(i);
  }, [callState]);

  const handleEndCall = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (voiceUnsubRef.current) { voiceUnsubRef.current(); voiceUnsubRef.current = null; }
    voiceCallEngine.endCall();
    setCallState("ended");
    emitCallSignal({
      type: "CALL_ENDED",
      employeeId: signal.employeeId,
      employeeName: signal.employeeName,
      zone: signal.zone,
    });
    setTimeout(onDismiss, 1500);
  };

  const statusText = callState === "dialing"
    ? `Calling ${signal.employeeName}...`
    : callState === "connecting"
    ? "Connecting..."
    : callState === "connected"
    ? `Connected · ${fmt(elapsed)}`
    : "Call Ended";

  const statusColor = callState === "connected" ? "#00C853" : callState === "ended" ? "rgba(255,255,255,0.3)" : "#00C8E0";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: -20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -16 }}
      transition={{ type: "spring", stiffness: 340, damping: 28 }}
      className="fixed inset-0 z-[9999] flex items-start justify-end pt-6 pr-6"
      style={{ pointerEvents: "none" }}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgba(5,7,14,0.75)", backdropFilter: "blur(6px)", pointerEvents: "auto" }}
        onClick={callState === "connected" ? handleEndCall : undefined}
      />

      <motion.div
        className="relative w-[340px] rounded-3xl overflow-hidden"
        style={{
          background: "linear-gradient(165deg, rgba(15,18,35,0.98) 0%, rgba(8,10,22,0.99) 100%)",
          border: "1px solid rgba(0,200,224,0.12)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 40px rgba(0,200,224,0.05)",
          pointerEvents: "auto",
        }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <Phone className="size-3.5" style={{ color: statusColor }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, fontFamily: "'Outfit', sans-serif" }}>
              Outgoing Call
            </span>
          </div>
          {callState !== "ended" && (
            <button onClick={handleEndCall} style={{ cursor: "pointer" }}>
              <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
            </button>
          )}
        </div>

        {/* Avatar */}
        <div className="flex flex-col items-center py-6">
          <div className="relative">
            <div className="size-20 rounded-full flex items-center justify-center" style={{
              background: callState === "connected" ? "rgba(0,200,83,0.08)" : "rgba(0,200,224,0.08)",
              border: `2px solid ${callState === "connected" ? "rgba(0,200,83,0.2)" : "rgba(0,200,224,0.2)"}`,
            }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: callState === "connected" ? "#00C853" : "#00C8E0", fontFamily: "'Outfit', sans-serif" }}>{initials}</span>
            </div>
            {(callState === "dialing" || callState === "connecting") && <PulseRings color="#00C8E0" />}
          </div>

          <h3 className="mt-4 text-white" style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Outfit', sans-serif" }}>
            {signal.employeeName}
          </h3>
          {signal.zone && (
            <div className="flex items-center gap-1 mt-1">
              <MapPin className="size-3" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 11, color: "#00C8E0", fontWeight: 600 }}>{signal.zone}</span>
            </div>
          )}
          <p className="mt-2" style={{ fontSize: 13, color: statusColor, fontWeight: 600, fontFamily: "'Outfit', sans-serif" }}>
            {statusText}
          </p>

          {/* Dialing dots animation */}
          {(callState === "dialing" || callState === "connecting") && (
            <div className="flex gap-1.5 mt-3">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3 }}
                  style={{ width: 6, height: 6, borderRadius: "50%", background: "#00C8E0" }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 pb-6">
          {callState === "connected" && (
            <button
              onClick={() => setMuted(!muted)}
              className="size-12 rounded-full flex items-center justify-center"
              style={{
                background: muted ? "rgba(255,45,85,0.15)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${muted ? "rgba(255,45,85,0.25)" : "rgba(255,255,255,0.08)"}`,
                cursor: "pointer",
              }}
            >
              {muted ? <MicOff className="size-5" style={{ color: "#FF2D55" }} /> : <Mic className="size-5" style={{ color: "rgba(255,255,255,0.6)" }} />}
            </button>
          )}
          {callState !== "ended" && (
            <button
              onClick={handleEndCall}
              className="size-14 rounded-full flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #FF2D55, #cc1a3a)",
                boxShadow: "0 4px 20px rgba(255,45,85,0.3)",
                cursor: "pointer",
              }}
            >
              <PhoneOff className="size-5 text-white" />
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXPORT — Mount once in Company Dashboard
// Handles incoming calls, outgoing callbacks, and admin-initiated active bar
// ═══════════════════════════════════════════════════════════════
export function AdminCallSystem() {
  const [incomingSignal, setIncomingSignal] = useState<CallSignal | null>(null);
  const [adminActiveCall, setAdminActiveCall] = useState<AdminActiveCall | null>(null);
  const [outgoingCallback, setOutgoingCallback] = useState<CallSignal | null>(null);

  // Listen for call signals
  useEffect(() => {
    const initial = getCallSignal();
    if (initial?.type === "EMPLOYEE_CALLING") {
      setIncomingSignal(initial);
    } else if (initial?.type === "ADMIN_CALLING_BACK") {
      setOutgoingCallback(initial);
    }

    const unsub = onCallSignal((signal) => {
      if (signal?.type === "EMPLOYEE_CALLING") {
        setIncomingSignal(signal);
      } else if (signal?.type === "ADMIN_CALLING_BACK") {
        setOutgoingCallback(signal);
      } else if (
        signal?.type === "CALL_ENDED" ||
        signal?.type === "ADMIN_DECLINED" ||
        signal == null
      ) {
        setIncomingSignal(prev => {
          if (prev && signal && prev.employeeId === signal.employeeId) return null;
          return prev;
        });
        setOutgoingCallback(prev => {
          if (prev && signal && prev.employeeId === signal.employeeId) return null;
          return prev;
        });
      }
    });
    return unsub;
  }, []);

  // Listen for admin-initiated active call
  useEffect(() => {
    const initial = getAdminActiveCall();
    setAdminActiveCall(initial);
    const unsub = onAdminCallChange((call) => {
      setAdminActiveCall(call);
    });
    return unsub;
  }, []);

  const handleIncomingDismiss = () => {
    setIncomingSignal(null);
    clearCallSignal();
  };

  const handleOutgoingDismiss = () => {
    setOutgoingCallback(null);
    clearCallSignal();
  };

  const handleAdminCallEnd = () => {
    endAdminCall();
    emitCallSignal({
      type: "CALL_ENDED",
      employeeId: adminActiveCall?.employeeId || "ADMIN-CALL",
      employeeName: adminActiveCall?.employeeName || "Employee",
    });
    setAdminActiveCall(null);
  };

  return (
    <div className="contents">
      {/* Incoming call from employee */}
      <AnimatePresence>
        {incomingSignal && !adminActiveCall && (
          <IncomingCallOverlay
            key={`incoming-${incomingSignal.timestamp}`}
            signal={incomingSignal}
            onDismiss={handleIncomingDismiss}
          />
        )}
      </AnimatePresence>

      {/* Outgoing callback (admin calling back employee) */}
      <AnimatePresence>
        {outgoingCallback && !incomingSignal && !adminActiveCall && (
          <OutgoingCallbackOverlay
            key={`callback-${outgoingCallback.timestamp}`}
            signal={outgoingCallback}
            onDismiss={handleOutgoingDismiss}
          />
        )}
      </AnimatePresence>

      {/* Admin-initiated active call mini-bar */}
      <AnimatePresence>
        {adminActiveCall && (
          <AdminActiveCallMiniBar
            key={`admin-call-${adminActiveCall.startedAt}`}
            call={adminActiveCall}
            onEnd={handleAdminCallEnd}
          />
        )}
      </AnimatePresence>
    </div>
  );
}