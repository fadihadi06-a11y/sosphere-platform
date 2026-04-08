// ═══════════════════════════════════════════════════════════════
// SOSphere — SOS Emergency Popup (Admin Dashboard)
// Simplified Call Flow:
//   Desktop Ring (25s) → Forward to Phone (3s) → Phone Ring (25s) → Missed
// No attempt counts shown. Clean "calling you" UI.
// ═══════════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Phone, MapPin, X, Shield, ChevronRight, Clock,
  Wifi, WifiOff, Battery, CheckCircle2, Siren,
  Eye, ChevronLeft, ChevronDown, PhoneCall,
  PhoneMissed, Copy, MessageCircle,
  Smartphone, Monitor, Check,
  FileText,
  Radar,
  PhoneOff, Mic, MicOff,
  Compass,
} from "lucide-react";
import { safeTelCall } from "./utils/safe-tel";
import { MedicalAlertBanner } from "./medical-alert-banner";
import {
  emitAdminSignal, emitCallSignal, clearCallSignal,
  emitSyncEvent, addMissedCall,
} from "./shared-store";
import { useReducedMotion, springPresets, modalVariants, contentFadeVariants } from "./view-transitions";

// ── Types ─────────────────────────────────────────────────────
export interface SOSEmployee {
  id: string;
  name: string;
  nameAr?: string;
  role: string;
  department: string;
  phone: string;
  zone: string;
  photoUrl?: string;
  batteryLevel?: number;
  signalStrength?: "excellent" | "good" | "fair" | "poor" | "none";
  isAirplaneMode?: boolean;
  lastGPS?: { lat: number; lng: number };
  elapsedSeconds: number;
  status: "active" | "responding" | "resolved";
  triggeredAt: Date;
  sosType?: "sos_button" | "missed_checkin" | "geofence" | "hazard";
  isDelayed?: boolean;
  delayMinutes?: number;
  // Medical data for MedicalAlertBanner
  bloodType?: string;
  allergies?: string[];
  medications?: string[];
  conditions?: string[];
}

export interface SOSPopupProps {
  emergencies: SOSEmployee[];
  onCall: (empId: string) => void;
  onViewLocation: (empId: string) => void;
  onAcknowledge: (empId: string) => void;
  onViewFull: (empId: string) => void;
  onGuideMe?: (empId: string) => void;
  onLaunchSAR?: (empId: string) => void;
  onReject?: (empId: string) => void;
  onDismiss: (empId: string) => void;
  adminName?: string;
}

// ── Simplified Call State Machine ─────────────────────────────
type CallState =
  | "standby"            // Non-SOS types — admin must manually call
  | "ringing_desktop"    // SOS → ringing admin on dashboard
  | "answered"           // Admin answered
  | "forwarding_phone"   // No answer on desktop → forwarding to phone (3s)
  | "ringing_phone"      // Ringing admin's personal phone
  | "missed";            // No answer on both → missed call

// Demo timers
const RING_DESKTOP_SEC = 25;
const RING_PHONE_SEC = 25;
const FORWARD_DELAY_SEC = 3;
const DEMO_MAX_CALL_DURATION = 60;

const SOS_LABELS: Record<string, string> = {
  sos_button:    "SOS BUTTON PRESSED",
  missed_checkin: "MISSED CHECK-IN",
  geofence:      "GEOFENCE BREACH",
  hazard:        "HAZARD REPORTED",
};

const AVATAR_COLORS = [
  ["#00C8E0", "#0090A0"],
  ["#FF2D55", "#CC1040"],
  ["#FF9500", "#CC7700"],
  ["#00C853", "#008A3A"],
  ["9B59B6", "#7D3C98"],
];

// ═══════════════════════════════════════════════════════════════
// Call Method Panel — manual call options (non-SOS types)
// ═══════════════════════════════════════════════════════════════
function CallMethodPanel({
  phone,
  employeeName,
  onClose,
  onCallPlaced,
}: {
  phone: string;
  employeeName: string;
  onClose: () => void;
  onCallPlaced: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleDeviceCall = () => {
    safeTelCall(phone, employeeName);
    onCallPlaced();
    onClose();
  };

  const handleWhatsApp = () => {
    window.open(`https://wa.me/${phone.replace(/[\s+]/g, "")}`);
    onCallPlaced();
    onClose();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
    onCallPlaced();
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 8 }}
      className="absolute inset-0 z-50 flex flex-col rounded-2xl overflow-hidden"
      style={{
        background: "rgba(5,8,18,0.98)",
        border: "1px solid rgba(255,45,85,0.3)",
        backdropFilter: "blur(20px)",
      }}
    >
      <div className="px-4 py-3 flex items-center justify-between border-b"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.9)" }}>
            Call {employeeName}
          </p>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
            {phone}
          </p>
        </div>
        <button onClick={onClose}
          className="size-7 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.06)" }}>
          <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
        </button>
      </div>

      <div className="p-4 space-y-2.5 flex-1">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleDeviceCall}
          className="w-full flex items-center gap-3 p-3.5 rounded-2xl text-left"
          style={{
            background: "linear-gradient(135deg, rgba(255,45,85,0.15), rgba(255,45,85,0.05))",
            border: "1px solid rgba(255,45,85,0.25)",
          }}
        >
          <div className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(255,45,85,0.2)" }}>
            <Phone className="size-5" style={{ color: "#FF2D55" }} />
          </div>
          <div className="flex-1">
            <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
              Call via Device
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
              Opens phone dialer (mobile) or Skype / Teams (desktop)
            </p>
          </div>
          <ChevronRight className="size-4" style={{ color: "rgba(255,255,255,0.25)" }} />
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleWhatsApp}
          className="w-full flex items-center gap-3 p-3.5 rounded-2xl text-left"
          style={{
            background: "rgba(37,211,102,0.08)",
            border: "1px solid rgba(37,211,102,0.2)",
          }}
        >
          <div className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(37,211,102,0.15)" }}>
            <MessageCircle className="size-5" style={{ color: "#25D366" }} />
          </div>
          <div className="flex-1">
            <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
              Open WhatsApp
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
              Call or message via WhatsApp
            </p>
          </div>
          <ChevronRight className="size-4" style={{ color: "rgba(255,255,255,0.25)" }} />
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleCopy}
          className="w-full flex items-center gap-3 p-3.5 rounded-2xl text-left"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.05)" }}>
            {copied
              ? <Check className="size-5" style={{ color: "#00C853" }} />
              : <Copy className="size-5" style={{ color: "rgba(255,255,255,0.5)" }} />
            }
          </div>
          <div className="flex-1">
            <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
              {copied ? "Copied!" : "Copy Number"}
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
              {copied ? "Call from your personal phone" : "Use your personal phone or desk phone"}
            </p>
          </div>
          {copied && <Check className="size-4" style={{ color: "#00C853" }} />}
        </motion.button>
      </div>

      <div className="px-4 py-3 mx-4 mb-4 rounded-xl"
        style={{ background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.1)" }}>
        <div className="flex items-start gap-2">
          <Monitor className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "rgba(0,200,224,0.5)" }} />
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
            <span style={{ color: "rgba(0,200,224,0.7)", fontWeight: 600 }}>Desktop:</span> Opens Skype / Teams / FaceTime.{" "}
            <span style={{ color: "rgba(0,200,224,0.7)", fontWeight: 600 }}>Mobile:</span> Opens native phone dialer.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Missed Call Panel — Shows when no answer on both desktop & phone
// ═══════════════════════════════════════════════════════════════
function MissedCallPanel({
  employee,
  onViewFull,
  onDismiss,
  onLaunchSAR,
  onMinimize,
  onCallBack,
}: {
  employee: SOSEmployee;
  onViewFull: () => void;
  onDismiss: () => void;
  onLaunchSAR?: () => void;
  onMinimize?: () => void;
  onCallBack?: (employeeId: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-4 space-y-3"
    >
      {/* Missed call header */}
      <div className="flex items-center gap-2.5 p-3 rounded-2xl"
        style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.2)" }}>
        <PhoneMissed className="size-5 flex-shrink-0" style={{ color: "#FF9500" }} />
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#FF9500" }}>Missed Call</p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
            {employee.name} — no answer on desktop or phone
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-1.5">
        {[
          { label: "Desktop Dashboard", status: "No Answer", icon: <Monitor className="size-3" style={{ color: "#FF2D55" }} /> },
          { label: "Admin Phone", status: "No Answer", icon: <Smartphone className="size-3" style={{ color: "#FF2D55" }} /> },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="size-5 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,45,85,0.15)" }}>
              {item.icon}
            </div>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{item.label}</span>
            <span style={{ fontSize: 10, color: "rgba(255,45,85,0.7)", marginLeft: "auto" }}>{item.status}</span>
          </div>
        ))}
      </div>

      {/* Employee notified */}
      <div className="flex items-start gap-2.5 p-3 rounded-2xl"
        style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.15)" }}>
        <Smartphone className="size-4 flex-shrink-0 mt-0.5" style={{ color: "#00C8E0" }} />
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,200,224,0.9)" }}>
            Employee Notified
          </p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, marginTop: 2 }}>
            {employee.name} is prompted to document the incident with photos and a comment.
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-2">
        {/* Call Back — Primary action */}
        {onCallBack && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => { onCallBack(employee.id); onMinimize?.(); }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl"
            style={{
              background: "linear-gradient(135deg, rgba(0,200,83,0.2), rgba(0,200,83,0.05))",
              border: "1px solid rgba(0,200,83,0.3)",
              boxShadow: "0 0 16px rgba(0,200,83,0.1)",
            }}
          >
            <Phone className="size-4" style={{ color: "#00C853" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#00C853" }}>
              Call Back {employee.name.split(" ")[0]}
            </span>
          </motion.button>
        )}

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => { onViewFull(); onMinimize?.(); }}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl"
          style={{
            background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.05))",
            border: "1px solid rgba(0,200,224,0.2)",
          }}
        >
          <FileText className="size-4" style={{ color: "#00C8E0" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>
            View Emergency Hub
          </span>
        </motion.button>

        {onLaunchSAR && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              emitAdminSignal("SAR_ACTIVATED", employee.id, {
                employeeName: employee.name,
                zone: employee.zone,
              });
              onLaunchSAR();
              onMinimize?.();
            }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl"
            style={{
              background: "linear-gradient(135deg, rgba(255,45,85,0.15), rgba(255,45,85,0.05))",
              border: "1px solid rgba(255,45,85,0.3)",
              boxShadow: "0 0 12px rgba(255,45,85,0.1)",
            }}
          >
            <Radar className="size-4" style={{ color: "#FF2D55" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#FF2D55" }}>
              Launch SAR Protocol
            </span>
          </motion.button>
        )}

        <button
          onClick={onDismiss}
          className="w-full py-2.5 rounded-2xl"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.35)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Dismiss
        </button>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Popup Component
// ═══════════════════════════════════════════════════════════════
export function SOSEmergencyPopup({
  emergencies,
  onCall,
  onViewLocation,
  onAcknowledge,
  onViewFull,
  onGuideMe,
  onLaunchSAR,
  onReject,
  onDismiss,
  adminName = "Admin",
}: SOSPopupProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showCallMethod, setShowCallMethod] = useState(false);

  // Per-emergency state
  const [callStates, setCallStates] = useState<Record<string, CallState>>({});
  const [ringTimers, setRingTimers] = useState<Record<string, number>>({});
  const [localElapsed, setLocalElapsed] = useState<Record<string, number>>({});
  const [responseTimers, setResponseTimers] = useState<Record<string, number>>({});
  const [callDurations, setCallDurations] = useState<Record<string, number>>({});
  const [callMuted, setCallMuted] = useState<Record<string, boolean>>({});
  const [medicalAcked, setMedicalAcked] = useState<Record<string, boolean>>({});

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeEms = useMemo(() => 
    emergencies.filter(e => e.status !== "resolved"),
    [emergencies]
  );

  const activeEmsIds = useMemo(() => 
    activeEms.map(e => e.id).join(","),
    [activeEms]
  );

  // ── Auto-start ringing for SOS button triggers ──────────────
  const initializedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    activeEms.forEach(e => {
      if (initializedRef.current.has(e.id)) return;
      initializedRef.current.add(e.id);
      const isTwilioAutoCall = e.sosType === "sos_button" || e.sosType === undefined;
      if (isTwilioAutoCall) {
        clearCallSignal();
        // Start ringing desktop immediately
        setCallStates(p => ({ ...p, [e.id]: "ringing_desktop" }));
        setRingTimers(p => ({ ...p, [e.id]: RING_DESKTOP_SEC }));
      }
      // For missed_checkin, geofence, hazard — keep "standby"
    });
  }, [activeEmsIds, activeEms]);

  // ── Master Tick ──────────────────────────────────────────────
  useEffect(() => {
    if (activeEms.length === 0) return;

    tickRef.current = setInterval(() => {
      // Elapsed timer
      setLocalElapsed(prev => {
        const next = { ...prev };
        activeEms.forEach(e => { next[e.id] = (next[e.id] ?? e.elapsedSeconds) + 1; });
        return next;
      });
      // Response timer
      setResponseTimers(prev => {
        const next = { ...prev };
        activeEms.forEach(e => { if (next[e.id] === undefined) next[e.id] = 0; else next[e.id] += 1; });
        return next;
      });
      // Ring countdown
      setRingTimers(prev => {
        const next = { ...prev };
        activeEms.forEach(e => {
          const cs = callStates[e.id];
          if (cs === "ringing_desktop" || cs === "ringing_phone") {
            next[e.id] = (next[e.id] ?? RING_DESKTOP_SEC) - 1;
          }
        });
        return next;
      });
      // Call duration (counts UP when answered)
      setCallDurations(prev => {
        const next = { ...prev };
        activeEms.forEach(e => {
          if (callStates[e.id] === "answered") {
            next[e.id] = (next[e.id] ?? 0) + 1;
          }
        });
        return next;
      });
    }, 1000);

    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [activeEms.length, callStates]);

  // ── State Machine Transitions ────────────────────────────────
  useEffect(() => {
    activeEms.forEach(e => {
      const cs = callStates[e.id] || "standby";
      const rt = ringTimers[e.id] ?? RING_DESKTOP_SEC;

      // Desktop ring timeout → forward to phone
      if (cs === "ringing_desktop" && rt <= 0) {
        setCallStates(p => ({ ...p, [e.id]: "forwarding_phone" }));
        // After 3s forwarding animation → ring phone
        setTimeout(() => {
          setCallStates(p => {
            if (p[e.id] === "forwarding_phone") {
              return { ...p, [e.id]: "ringing_phone" };
            }
            return p;
          });
          setRingTimers(p => ({ ...p, [e.id]: RING_PHONE_SEC }));
        }, FORWARD_DELAY_SEC * 1000);
      }

      // Phone ring timeout → missed call
      if (cs === "ringing_phone" && rt <= 0) {
        setCallStates(p => ({ ...p, [e.id]: "missed" }));
        // Notify employee side
        emitAdminSignal("ADMIN_UNREACHABLE", e.id);
        // Store missed call (synced between dashboard & admin phone)
        addMissedCall({
          employeeId: e.id,
          employeeName: e.name,
          employeeRole: e.role,
          zone: e.zone,
          phone: e.phone,
          timestamp: Date.now(),
          missedOn: "both",
        });
        // Log to activity
        emitSyncEvent({
          type: "ADMIN_UNREACHABLE",
          employeeId: e.id,
          employeeName: e.name,
          zone: e.zone,
          timestamp: Date.now(),
          data: { action: "missed", reason: "No answer on desktop or phone" },
        });
      }
    });
  }, [ringTimers, callStates, activeEmsIds]);

  // Reset index when list changes
  useEffect(() => { setCurrentIndex(0); }, [activeEms.length]);

  // Auto-rotate — paused when any call is active
  const hasActiveCall = Object.values(callStates).some(s =>
    s === "answered" || s === "ringing_desktop" || s === "ringing_phone" || s === "forwarding_phone"
  );
  useEffect(() => {
    if (activeEms.length <= 1 || hasActiveCall) return;
    const interval = setInterval(() => {
      setCurrentIndex(p => (p + 1) % activeEms.length);
    }, 10000);
    return () => clearInterval(interval);
  }, [activeEms.length, hasActiveCall]);

  if (activeEms.length === 0) return null;

  const clampedIndex = Math.min(currentIndex, activeEms.length - 1);
  const em = activeEms[clampedIndex];
  const cs = callStates[em.id] || "standby";
  const elapsed = localElapsed[em.id] ?? em.elapsedSeconds;
  const responseTime = responseTimers[em.id] ?? 0;

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedLabel = mins > 0 ? `${mins}m ${secs}s ago` : `${secs}s ago`;
  const responseMins = Math.floor(responseTime / 60);
  const responseSecs = responseTime % 60;

  const colorIdx = parseInt(em.id.replace(/\D/g, ""), 10) % AVATAR_COLORS.length;
  const [avatarFrom, avatarTo] = AVATAR_COLORS[colorIdx];

  // ── Call state display info ──────────────────────────────────
  const getCallDisplay = () => {
    if (cs === "ringing_desktop") {
      return { label: `${em.name} is calling you`, color: "#FF2D55", showButtons: true, icon: "ringing" };
    }
    if (cs === "forwarding_phone") {
      return { label: "Forwarding to your phone...", color: "#FF9500", showButtons: false, icon: "forwarding" };
    }
    if (cs === "ringing_phone") {
      return { label: "Ringing your phone...", color: "#FF9500", showButtons: true, icon: "ringing" };
    }
    if (cs === "answered") {
      const dur = callDurations[em.id] ?? 0;
      const durFmt = `${Math.floor(dur / 60).toString().padStart(2, "0")}:${(dur % 60).toString().padStart(2, "0")}`;
      return { label: `Connected ${durFmt}`, color: "#00C853", showButtons: false, icon: "connected" };
    }
    if (cs === "missed") {
      return { label: "Missed Call", color: "#FF9500", showButtons: false, icon: "missed" };
    }
    return null;
  };
  const callDisplay = getCallDisplay();

  const handleCallClick = () => {
    setShowCallMethod(true);
  };

  const handleCallPlaced = () => {
    if (cs === "standby") {
      setCallStates(p => ({ ...p, [em.id]: "ringing_desktop" }));
      setRingTimers(p => ({ ...p, [em.id]: RING_DESKTOP_SEC }));
    }
    onCall(em.id);
  };

  const handleAnswer = () => {
    setCallStates(p => ({ ...p, [em.id]: "answered" }));
    setCallDurations(p => ({ ...p, [em.id]: 0 }));
    setCallMuted(p => ({ ...p, [em.id]: false }));
    emitAdminSignal("ADMIN_ACKNOWLEDGED", em.id);
    emitCallSignal({ type: "ADMIN_ANSWERED", employeeId: em.id, employeeName: em.name, zone: em.zone });
    // Log response time
    emitSyncEvent({
      type: "ADMIN_ACKNOWLEDGED",
      employeeId: em.id,
      employeeName: em.name,
      zone: em.zone,
      timestamp: Date.now(),
      data: {
        action: "answered",
        responseTimeSec: responseTime,
        answeredOn: cs === "ringing_phone" ? "phone" : "desktop",
      },
    });
  };

  const handleReject = () => {
    emitCallSignal({ type: "ADMIN_DECLINED", employeeId: em.id, employeeName: em.name, zone: em.zone });
    clearCallSignal();
    onReject?.(em.id);
    onDismiss(em.id);
  };

  // Auto-end call after 60s (demo limit)
  useEffect(() => {
    if (cs !== "answered") return;
    const dur = callDurations[em.id] ?? 0;
    if (dur >= DEMO_MAX_CALL_DURATION) {
      handleEndCall();
    }
  }, [callDurations[em.id], cs]);

  const handleEndCall = () => {
    emitCallSignal({ type: "CALL_ENDED", employeeId: em.id, employeeName: em.name, zone: em.zone });
    clearCallSignal();
    emitSyncEvent({
      type: "SOS_CONTACT_ANSWERED",
      employeeId: em.id,
      employeeName: em.name,
      zone: em.zone,
      timestamp: Date.now(),
      data: {
        action: "call_ended",
        callDurationSec: callDurations[em.id] ?? 0,
      },
    });
    onAcknowledge(em.id);
    onDismiss(em.id);
  };

  // ── Header color based on state ──────────────────────────────
  const headerColor = cs === "answered" ? "#00C853"
    : cs === "missed" ? "#FF9500"
    : cs === "forwarding_phone" || cs === "ringing_phone" ? "#FF9500"
    : "#FF2D55";

  const headerBorderColor = cs === "answered" ? "rgba(0,200,83,0.3)"
    : cs === "missed" ? "rgba(255,150,0,0.3)"
    : "rgba(255,45,85,0.3)";

  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      variants={modalVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={prefersReduced ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 28 }}
      className="fixed right-4 top-4 z-[9998] w-72"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      {/* Ambient glow */}
      <motion.div
        animate={{ opacity: [0.12, 0.35, 0.12] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at center, ${headerColor}33 0%, transparent 70%)`,
          filter: "blur(12px)",
          transform: "scale(1.15)",
        }}
      />

      {/* Main Card */}
      <div className="relative rounded-2xl overflow-hidden"
        style={{
          background: "rgba(6,10,20,0.98)",
          border: `1px solid ${headerBorderColor}`,
          backdropFilter: "blur(20px)",
          boxShadow: `0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px ${headerColor}14`,
        }}>

        {/* ── Header ── */}
        <div className="relative px-4 py-2.5 flex items-center justify-between"
          style={{
            background: `linear-gradient(135deg, ${headerColor}26, ${headerColor}08)`,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}>

          <div className="flex items-center gap-2">
            <motion.div
              animate={cs === "answered" ? {} : { scale: [1, 1.5, 1], opacity: [1, 0.4, 1] }}
              transition={{ duration: 0.9, repeat: cs === "answered" ? 0 : Infinity }}
              className="size-2 rounded-full"
              style={{
                background: headerColor,
                boxShadow: `0 0 6px ${headerColor}`,
              }}
            />
            <div>
              <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.6px", color: headerColor }}>
                {cs === "answered" ? "CALL CONNECTED"
                  : cs === "missed" ? "MISSED CALL"
                  : cs === "forwarding_phone" ? "FORWARDING..."
                  : cs === "ringing_phone" ? "RINGING PHONE"
                  : (cs === "ringing_desktop") ? "INCOMING CALL"
                  : "EMERGENCY ALERT"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {activeEms.length > 1 && (
              <div className="px-2 py-0.5 rounded-full"
                style={{ background: "rgba(255,45,85,0.15)", border: "1px solid rgba(255,45,85,0.25)" }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#FF2D55" }}>
                  {clampedIndex + 1}/{activeEms.length}
                </span>
              </div>
            )}
            <button onClick={() => setIsMinimized(!isMinimized)}
              className="size-6 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.05)" }}>
              <ChevronDown className="size-3.5"
                style={{ color: "rgba(255,255,255,0.35)", transform: isMinimized ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            </button>
            <button onClick={() => onDismiss(em.id)}
              className="size-6 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.05)" }}>
              <X className="size-3.5" style={{ color: "rgba(255,255,255,0.35)" }} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <AnimatePresence>
          {!isMinimized && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="relative"
            >
              {/* Call Method Overlay */}
              <AnimatePresence>
                {showCallMethod && (
                  <CallMethodPanel
                    phone={em.phone}
                    employeeName={em.name}
                    onClose={() => setShowCallMethod(false)}
                    onCallPlaced={handleCallPlaced}
                  />
                )}
              </AnimatePresence>

              {/* Missed call state */}
              {cs === "missed" ? (
                <MissedCallPanel
                  employee={em}
                  onViewFull={() => onViewFull(em.id)}
                  onDismiss={() => onDismiss(em.id)}
                  onLaunchSAR={onLaunchSAR ? () => onLaunchSAR(em.id) : undefined}
                  onMinimize={() => setIsMinimized(true)}
                  onCallBack={(employeeId) => {
                    // Re-initiate call from missed state → ringing desktop
                    setCallStates(p => ({ ...p, [employeeId]: "ringing_desktop" }));
                    setRingTimers(p => ({ ...p, [employeeId]: RING_DESKTOP_SEC }));
                    setResponseTimers(p => ({ ...p, [employeeId]: 0 }));
                    emitCallSignal({ type: "EMPLOYEE_CALLING", employeeId: em.id, employeeName: em.name, zone: em.zone });
                  }}
                />
              ) : (
                <div className="contents">
                  {/* ── Employee Info ── */}
                  <div className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        <div className="size-14 rounded-2xl overflow-hidden"
                          style={{
                            background: `linear-gradient(135deg, ${avatarFrom}, ${avatarTo})`,
                            border: `2px solid ${cs === "answered" ? "rgba(0,200,83,0.4)" : "rgba(255,45,85,0.35)"}`,
                            boxShadow: `0 0 14px ${cs === "answered" ? "rgba(0,200,83,0.2)" : "rgba(255,45,85,0.2)"}`,
                          }}>
                          {em.photoUrl ? (
                            <img src={em.photoUrl} alt={em.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <span style={{ fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,0.9)" }}>
                                {em.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                              </span>
                            </div>
                          )}
                        </div>
                        <motion.div
                          animate={cs === "answered" ? {} : { scale: [1, 1.1, 1] }}
                          transition={{ duration: 1, repeat: Infinity }}
                          className="absolute -bottom-1 -right-1 size-5 rounded-full flex items-center justify-center"
                          style={{
                            background: cs === "answered" ? "#00C853" : "#FF2D55",
                            border: "2px solid rgba(6,10,20,0.98)",
                          }}>
                          {cs === "answered"
                            ? <CheckCircle2 className="size-2.5" style={{ color: "#fff" }} />
                            : <Siren className="size-2.5" style={{ color: "#fff" }} />
                          }
                        </motion.div>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: 14, fontWeight: 800, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.2px" }}>
                          {em.name}
                        </p>
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
                          {em.role} · {em.department}
                        </p>
                        <button
                          onClick={handleCallClick}
                          className="flex items-center gap-1 mt-1.5"
                          style={{ background: "none", border: "none", cursor: "pointer" }}
                        >
                          <Phone className="size-3" style={{ color: "rgba(0,200,224,0.6)" }} />
                          <span style={{ fontSize: 11, color: "rgba(0,200,224,0.8)", fontWeight: 600 }}>
                            {em.phone}
                          </span>
                        </button>
                        <motion.div
                          animate={{ opacity: [1, 0.5, 1] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                          className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(255,45,85,0.12)", border: "1px solid rgba(255,45,85,0.25)" }}>
                          <div className="size-1.5 rounded-full" style={{ background: "#FF2D55" }} />
                          <span style={{ fontSize: 8, fontWeight: 800, color: "#FF2D55", letterSpacing: "0.4px" }}>
                            {SOS_LABELS[em.sosType || "sos_button"]}
                          </span>
                        </motion.div>
                      </div>
                    </div>

                    {/* Meta pills */}
                    <div className="grid grid-cols-2 gap-1.5 mt-3">
                      <InfoPill icon={<Clock className="size-3" />} label="TRIGGERED" value={elapsedLabel}
                        color={elapsed > 180 ? "#FF2D55" : "rgba(255,255,255,0.5)"} />
                      <InfoPill icon={<MapPin className="size-3" />} label="ZONE"
                        value={em.zone.split(" - ")[0] || em.zone} color="#00C8E0" />
                    </div>

                    {/* Battery + Signal */}
                    <div className="flex items-center gap-3 mt-2">
                      {em.batteryLevel !== undefined && (
                        <div className="flex items-center gap-1">
                          <Battery className="size-3"
                            style={{ color: em.batteryLevel < 20 ? "#FF9500" : "rgba(255,255,255,0.25)" }} />
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>{em.batteryLevel}%</span>
                        </div>
                      )}
                      {em.isAirplaneMode ? (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)" }}>
                          <WifiOff className="size-3" style={{ color: "#FF9500" }} />
                          <span style={{ fontSize: 8, fontWeight: 700, color: "#FF9500" }}>OFFLINE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Wifi className="size-3" style={{ color: "#00C853" }} />
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Connected</span>
                        </div>
                      )}
                      {em.isDelayed && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)" }}>
                          <Clock className="size-3" style={{ color: "#FF9500" }} />
                          <span style={{ fontSize: 8, fontWeight: 700, color: "#FF9500" }}>+{em.delayMinutes}m</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Medical Alert Banner — forces admin to acknowledge medical data ── */}
                  {!medicalAcked[em.id] && (em.bloodType || (em.allergies && em.allergies.length > 0) || (em.medications && em.medications.length > 0) || (em.conditions && em.conditions.length > 0)) && (
                    <div className="px-3 mb-2">
                      <MedicalAlertBanner
                        employee={{
                          name: em.name,
                          bloodType: em.bloodType,
                          allergies: em.allergies,
                          medications: em.medications,
                          conditions: em.conditions,
                        }}
                        onAcknowledge={() => setMedicalAcked(p => ({ ...p, [em.id]: true }))}
                      />
                    </div>
                  )}

                  {/* ── Call State Display ── */}
                  {callDisplay && cs !== "standby" && cs !== "answered" && (
                    <div className="mx-3 mb-3">
                      {/* Call state label */}
                      <div className="flex items-center gap-2.5 px-3 py-3 rounded-xl"
                        style={{ background: `${callDisplay.color}0D`, border: `1px solid ${callDisplay.color}20` }}>
                        {/* Icon */}
                        {callDisplay.icon === "ringing" ? (
                          <motion.div
                            animate={{ rotate: [0, -15, 15, -15, 15, 0] }}
                            transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.5 }}>
                            <PhoneCall className="size-4" style={{ color: callDisplay.color }} />
                          </motion.div>
                        ) : callDisplay.icon === "forwarding" ? (
                          <motion.div
                            animate={{ x: [0, 4, 0] }}
                            transition={{ duration: 1, repeat: Infinity }}>
                            <Smartphone className="size-4" style={{ color: callDisplay.color }} />
                          </motion.div>
                        ) : (
                          <PhoneMissed className="size-4" style={{ color: callDisplay.color }} />
                        )}
                        {/* Label */}
                        <div className="flex-1">
                          <p style={{ fontSize: 11, fontWeight: 700, color: callDisplay.color }}>
                            {callDisplay.label}
                          </p>
                          {cs === "forwarding_phone" && (
                            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                              No answer on desktop — redirecting to your mobile
                            </p>
                          )}
                          {cs === "ringing_phone" && (
                            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                              Check your phone for the incoming call
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Answer / Reject buttons (shown during ringing states) */}
                      {callDisplay.showButtons && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={handleAnswer}
                            className="flex items-center justify-center gap-2 py-2.5 rounded-xl"
                            style={{
                              background: "linear-gradient(135deg, #00C853, #009624)",
                              boxShadow: "0 4px 16px rgba(0,200,83,0.35)",
                            }}>
                            <Phone className="size-4" style={{ color: "#fff" }} />
                            <span style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>Answer</span>
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={handleReject}
                            className="flex items-center justify-center gap-2 py-2.5 rounded-xl"
                            style={{
                              background: "linear-gradient(135deg, #FF2D55, #D91A46)",
                              boxShadow: "0 4px 16px rgba(255,45,85,0.35)",
                            }}>
                            <PhoneMissed className="size-4" style={{ color: "#fff" }} />
                            <span style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>Reject</span>
                          </motion.button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── FIX 1: Guide Me Button — Direct IRE access from SOS Popup ── */}
                  {em.status === "active" && onGuideMe && cs !== "answered" && (
                    <div className="px-3 mb-2">
                      <motion.button
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => { onGuideMe(em.id); setIsMinimized(true); }}
                        className="w-full flex items-center gap-3 py-2.5 px-3.5 rounded-xl relative overflow-hidden"
                        style={{
                          background: "linear-gradient(135deg, rgba(0,200,224,0.1), rgba(139,92,246,0.06))",
                          border: "1px solid rgba(0,200,224,0.25)",
                          boxShadow: "0 0 20px rgba(0,200,224,0.06)",
                        }}
                      >
                        {/* Pulse ring */}
                        <motion.div
                          animate={{ scale: [1, 1.5, 1], opacity: [0.2, 0, 0.2] }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="absolute inset-0 rounded-xl pointer-events-none"
                          style={{ border: "1px solid rgba(0,200,224,0.15)" }}
                        />
                        <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.2)" }}>
                          <Compass className="size-4" style={{ color: "#00C8E0" }} />
                        </div>
                        <div className="flex-1">
                          <p style={{ fontSize: 12, fontWeight: 800, color: "#00C8E0", letterSpacing: "-0.2px" }}>
                            Guide Me Through This
                          </p>
                          <p style={{ fontSize: 9, color: "rgba(0,200,224,0.5)", marginTop: 1 }}>
                            AI step-by-step rescue protocol
                          </p>
                        </div>
                        <ChevronRight className="size-4 flex-shrink-0" style={{ color: "rgba(0,200,224,0.35)" }} />
                      </motion.button>
                    </div>
                  )}

                  {/* ── FIX 4: Launch SAR button — appears after 10+ min elapsed ── */}
                  {onLaunchSAR && elapsed >= 600 && cs !== "answered" && (
                    <div className="px-3 mb-2">
                      <motion.button
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          emitAdminSignal("SAR_ACTIVATED", em.id, {
                            employeeName: em.name,
                            zone: em.zone,
                          });
                          try {
                            localStorage.setItem("sosphere_sar_prefill", JSON.stringify({
                              employeeName: em.name,
                              zone: em.zone,
                              lastGPS: em.lastGPS || { lat: 24.7136, lng: 46.6753 },
                              elapsedMinutes: Math.round(elapsed / 60),
                              emergencyId: em.id,
                            }));
                          } catch {}
                          onLaunchSAR(em.id);
                          setIsMinimized(true);
                        }}
                        className="w-full flex items-center gap-3 py-2.5 px-3.5 rounded-xl relative overflow-hidden"
                        style={{
                          background: "linear-gradient(135deg, rgba(255,149,0,0.1), rgba(255,45,85,0.06))",
                          border: "1px solid rgba(255,149,0,0.3)",
                          boxShadow: "0 0 20px rgba(255,149,0,0.08)",
                          cursor: "pointer",
                        }}>
                        <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: "rgba(255,149,0,0.12)", border: "1px solid rgba(255,149,0,0.25)" }}>
                          <Radar className="size-4" style={{ color: "#FF9500" }} />
                        </div>
                        <div className="flex-1">
                          <p style={{ fontSize: 12, fontWeight: 800, color: "#FF9500", letterSpacing: "-0.2px" }}>
                            Launch SAR Protocol
                          </p>
                          <p style={{ fontSize: 9, color: "rgba(255,149,0,0.5)", marginTop: 1 }}>
                            {Math.round(elapsed / 60)}+ min — initiate search & rescue
                          </p>
                        </div>
                        <ChevronRight className="size-4 flex-shrink-0" style={{ color: "rgba(255,149,0,0.35)" }} />
                      </motion.button>
                    </div>
                  )}

                  {/* ── Response Timer (hidden during active call) ── */}
                  {cs !== "answered" && (
                  <div className="mx-3 mb-3 px-3 py-2.5 rounded-xl flex items-center justify-between"
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.05)",
                    }}>
                    <div>
                      <p style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "0.5px" }}>
                        RESPONSE TIME
                      </p>
                      <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>
                        {cs === "ringing_desktop" ? "Ringing on dashboard…"
                          : cs === "forwarding_phone" ? "Forwarding to phone…"
                          : cs === "ringing_phone" ? "Ringing admin phone…"
                          : cs === "standby" ? "Manual call required"
                          : "Awaiting admin response"}
                      </p>
                    </div>
                    <motion.p
                      key={Math.floor(responseTime / 5)}
                      animate={{ scale: [1.05, 1] }}
                      transition={{ duration: 0.3 }}
                      style={{
                        fontSize: 24, fontWeight: 900,
                        color: responseTime < 60 ? "#FF2D55" : "#FF9500",
                        letterSpacing: "-1px",
                        fontVariantNumeric: "tabular-nums",
                        textShadow: `0 0 16px ${responseTime < 60 ? "#FF2D5540" : "#FF950040"}`,
                      }}>
                      {responseMins > 0
                        ? `${responseMins}:${responseSecs.toString().padStart(2, "0")}`
                        : `${responseSecs}s`}
                    </motion.p>
                  </div>
                  )}

                  {/* ── Action Buttons ── */}
                  <div className="px-3 pb-3 space-y-1.5">

                    {/* Primary Call Button (standby only) */}
                    {cs === "standby" ? (
                      <div className="space-y-1">
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          onClick={handleCallClick}
                          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
                          style={{
                            background: "linear-gradient(135deg, #FF2D55, #D91A46)",
                            boxShadow: "0 4px 18px rgba(255,45,85,0.3)",
                          }}>
                          <Phone className="size-4" style={{ color: "#fff" }} />
                          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>
                            Call Employee Now
                          </span>
                        </motion.button>
                        <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", textAlign: "center", lineHeight: 1.4 }}>
                          {em.sosType === "missed_checkin" ? "Missed check-in — verify employee safety"
                            : em.sosType === "geofence" ? "Geofence breach — confirm employee location"
                            : em.sosType === "hazard" ? "Hazard reported — assess situation"
                            : "Employee triggered SOS — call to assess & send help"}
                        </p>
                      </div>
                    ) : cs === "answered" ? (
                      <div className="space-y-2">
                        {/* ── In-Call Panel ── */}
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-xl overflow-hidden"
                          style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.2)" }}
                        >
                          <div className="flex flex-col items-center gap-1 py-3">
                            <div className="flex items-center gap-3">
                              {/* Audio level bars */}
                              <div className="flex items-end gap-0.5" style={{ height: 14 }}>
                                {[0.3, 0.6, 1, 0.7, 0.4].map((h, i) => (
                                  <motion.div
                                    key={i}
                                    animate={{ scaleY: [0.15, h, 0.15] }}
                                    transition={{ duration: 0.4, repeat: Infinity, delay: i * 0.07 }}
                                    style={{ width: 2.5, height: 14, background: "#00C853", borderRadius: 1, transformOrigin: "bottom" }}
                                  />
                                ))}
                              </div>
                              <span style={{
                                fontSize: 22, fontWeight: 900, color: "#00C853",
                                fontVariantNumeric: "tabular-nums", letterSpacing: "-0.5px",
                              }}>
                                {`${Math.floor((callDurations[em.id] ?? 0) / 60).toString().padStart(2, "0")}:${((callDurations[em.id] ?? 0) % 60).toString().padStart(2, "0")}`}
                              </span>
                              <motion.div
                                animate={{ scale: [1, 1.3, 1], opacity: [1, 0.4, 1] }}
                                transition={{ duration: 1.5, repeat: Infinity }}
                                className="size-2 rounded-full"
                                style={{ background: "#00C853", boxShadow: "0 0 6px #00C853" }}
                              />
                            </div>
                            {/* Remaining time */}
                            {(() => {
                              const dur = callDurations[em.id] ?? 0;
                              const remaining = DEMO_MAX_CALL_DURATION - dur;
                              return remaining <= 15 ? (
                                <motion.p
                                  animate={{ opacity: [1, 0.4, 1] }}
                                  transition={{ duration: 0.8, repeat: Infinity }}
                                  style={{ fontSize: 9, fontWeight: 700, color: remaining <= 5 ? "#FF2D55" : "#FF9500" }}
                                >
                                  Auto-end in {remaining}s (demo)
                                </motion.p>
                              ) : (
                                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                                  {remaining}s remaining (demo limit)
                                </p>
                              );
                            })()}
                          </div>

                          {/* Mute toggle */}
                          <div className="px-3 pb-2.5">
                            <button
                              onClick={() => setCallMuted(p => ({ ...p, [em.id]: !p[em.id] }))}
                              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg"
                              style={{
                                background: callMuted[em.id] ? "rgba(255,45,85,0.08)" : "rgba(255,255,255,0.03)",
                                border: callMuted[em.id] ? "1px solid rgba(255,45,85,0.2)" : "1px solid rgba(255,255,255,0.06)",
                              }}
                            >
                              {callMuted[em.id]
                                ? <MicOff className="size-3.5" style={{ color: "#FF2D55" }} />
                                : <Mic className="size-3.5" style={{ color: "#00C853" }} />
                              }
                              <span style={{ fontSize: 10, fontWeight: 600, color: callMuted[em.id] ? "#FF2D55" : "rgba(255,255,255,0.5)" }}>
                                {callMuted[em.id] ? "Microphone Muted" : "Microphone Active"}
                              </span>
                            </button>
                          </div>
                        </motion.div>

                        {/* End Call */}
                        <motion.button
                          whileTap={{ scale: 0.96 }}
                          onClick={handleEndCall}
                          className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl"
                          style={{
                            background: "linear-gradient(135deg, rgba(255,45,85,0.15), rgba(255,45,85,0.05))",
                            border: "1.5px solid rgba(255,45,85,0.35)",
                            boxShadow: "0 4px 20px rgba(255,45,85,0.12)",
                          }}
                        >
                          <div
                            className="size-8 rounded-full flex items-center justify-center"
                            style={{ background: "linear-gradient(135deg, #FF2D55, #CC0033)", boxShadow: "0 4px 16px rgba(255,45,85,0.4)" }}
                          >
                            <PhoneOff className="size-4 text-white" />
                          </div>
                          <div className="text-left">
                            <p style={{ fontSize: 12, fontWeight: 800, color: "#FF2D55" }}>End Call</p>
                            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>Marks emergency as responding</p>
                          </div>
                        </motion.button>
                      </div>
                    ) : null}

                    {/* Secondary actions */}
                    {cs !== "answered" && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          onClick={() => { onViewLocation(em.id); setIsMinimized(true); }}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-xl"
                          style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                          <MapPin className="size-3.5" style={{ color: "#00C8E0" }} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>Location</span>
                        </motion.button>
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          onClick={() => { onViewFull(em.id); setIsMinimized(true); }}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                          <Eye className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>Emergency Hub</span>
                        </motion.button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Multiple emergencies nav */}
              {activeEms.length > 1 && (
                <div className="flex items-center justify-between px-3 py-2.5 border-t"
                  style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                  <button
                    onClick={() => setCurrentIndex(p => p === 0 ? activeEms.length - 1 : p - 1)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.04)" }}>
                    <ChevronLeft className="size-3" style={{ color: "rgba(255,255,255,0.35)" }} />
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>Prev</span>
                  </button>
                  <div className="flex gap-1.5">
                    {activeEms.map((_, i) => (
                      <button key={i} onClick={() => setCurrentIndex(i)}
                        className="rounded-full transition-all"
                        style={{
                          width: i === clampedIndex ? 14 : 5,
                          height: 5,
                          background: i === clampedIndex ? "#FF2D55" : "rgba(255,255,255,0.12)",
                        }} />
                    ))}
                  </div>
                  <button
                    onClick={() => setCurrentIndex(p => (p + 1) % activeEms.length)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.04)" }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>Next</span>
                    <ChevronRight className="size-3" style={{ color: "rgba(255,255,255,0.35)" }} />
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Minimized strip */}
        {isMinimized && (
          <div className="px-3 py-2 flex items-center gap-2.5">
            <div className="size-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${avatarFrom}, ${avatarTo})` }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#fff" }}>
                {em.name.split(" ")[0][0]}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
                {em.name}
              </p>
              <p style={{ fontSize: 9, color: "#FF2D55" }}>{elapsedLabel}</p>
            </div>
            <button onClick={handleCallClick}
              className="size-7 rounded-lg flex items-center justify-center"
              style={{ background: "#FF2D55" }}>
              <Phone className="size-3.5" style={{ color: "#fff" }} />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Info Pill ─────────────────────────────────────────────────
function InfoPill({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string; color: string;
}) {
  return (
    <div className="px-2.5 py-1.5 rounded-xl"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="flex items-center gap-1 mb-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>
        {icon}
        <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: "0.4px" }}>{label}</span>
      </div>
      <p style={{ fontSize: 10, fontWeight: 600, color }}>{value}</p>
    </div>
  );
}