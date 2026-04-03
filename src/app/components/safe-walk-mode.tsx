// ═══════════════════════════════════════════════════════════════
// SOSphere — Safe Walk Mode ("Walk Me Home")
// Virtual escort: someone watches your live location while you walk
// Auto-escalates if you stop moving for too long
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, Footprints, Shield, MapPin, Clock,
  Phone, AlertTriangle, CheckCircle2, X, User,
  Heart, Users, Navigation, Radio, Eye, Timer,
  Moon, Volume2, VolumeX, Zap, Send, MessageSquare,
  Lock, Crown, Pause, Play, XCircle, Locate,
  ArrowRight, ChevronDown, Signal, Route, Home,
} from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { emitSyncEvent } from "./shared-store";

// ── Types ─────────────────────────────────────────────────────

type WalkPhase = "setup" | "active" | "paused" | "stopped" | "arrived" | "escalated";

interface Guardian {
  id: string;
  name: string;
  avatar: string;
  relation: string;
  online: boolean;
  watching: boolean;
}

interface WalkEvent {
  id: string;
  type: "start" | "pause" | "resume" | "stop_detected" | "guardian_alert" | "arrived" | "sos_escalated" | "message" | "route_deviation";
  timestamp: number;
  message: string;
  severity: "info" | "warning" | "danger";
}

// [SUPABASE_MIGRATION_POINT] Guardians will load from supabase.from('emergency_contacts').select()
// MOCK_GUARDIANS removed — guardians now derived from emergencyContacts prop

// ── Quick Messages ────────────────────────────────────────────

const QUICK_MESSAGES = [
  { emoji: "👋", text: "Almost there!" },
  { emoji: "☕", text: "Stopping briefly" },
  { emoji: "🏠", text: "Arrived safely!" },
  { emoji: "🚶", text: "Still walking" },
  { emoji: "🚗", text: "Got a ride" },
  { emoji: "⚠️", text: "Feeling unsafe" },
];

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═���═════════════════════════════════════════════════════════════

interface SafeWalkModeProps {
  onBack: () => void;
  onSOSTrigger?: () => void;
  isPro?: boolean;
  onUpgrade?: () => void;
  emergencyContacts?: Array<{
    name: string;
    phone: string;
    relation: string;
    avatar?: string;
  }>;
  userId?: string;
  userName?: string;
  userZone?: string;
}

export function SafeWalkMode({ onBack, onSOSTrigger, isPro = false, onUpgrade, emergencyContacts, userId = "unknown", userName = "Unknown", userZone = "Unknown" }: SafeWalkModeProps) {
  const [phase, setPhase] = useState<WalkPhase>("setup");

  // Derive guardians from emergencyContacts prop (no more MOCK_GUARDIANS)
  const initialGuardians: Guardian[] = (emergencyContacts || []).map((c, i) => ({
    id: `g-${i}`,
    name: c.name,
    avatar: c.avatar || "",
    relation: c.relation,
    online: true, // [SUPABASE_MIGRATION_POINT] Will check real online status
    watching: false,
  }));

  const [guardians, setGuardians] = useState<Guardian[]>(initialGuardians);
  const [selectedGuardian, setSelectedGuardian] = useState<Guardian | null>(null);
  const [destination, setDestination] = useState("Home");
  const [estimatedTime, setEstimatedTime] = useState(15); // minutes
  const [soundEnabled, setSoundEnabled] = useState(true);

  // ── Mount log ───────────────────────────────────────────────
  useEffect(() => {
    console.log("[SUPABASE_READY] safe_walk_initialized: " + JSON.stringify({
      userId,
      userName,
      userZone,
      contactsCount: emergencyContacts?.length ?? 0,
    }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Active walk state
  const [walkTimer, setWalkTimer] = useState(0); // seconds elapsed
  const [distanceWalked, setDistanceWalked] = useState(0); // meters
  const [stoppedTimer, setStoppedTimer] = useState(0); // seconds stopped
  const [isMoving, setIsMoving] = useState(true);
  const [events, setEvents] = useState<WalkEvent[]>([]);
  const [showEvents, setShowEvents] = useState(false);
  const [showQuickMsg, setShowQuickMsg] = useState(false);
  const [guardianAlerted, setGuardianAlerted] = useState(false);
  const [escalationCountdown, setEscalationCountdown] = useState(0);

  // Settings
  const [stopThreshold, setStopThreshold] = useState(120); // seconds before alert
  const [escalationDelay, setEscalationDelay] = useState(60); // seconds before SOS
  const [showSettings, setShowSettings] = useState(false);

  // Timer refs
  const walkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const escalationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Walk Timer ──────────────────────────────────────────────

  useEffect(() => {
    if (phase === "active") {
      walkTimerRef.current = setInterval(() => {
        setWalkTimer(t => t + 1);
        if (isMoving) {
          setDistanceWalked(d => d + Math.random() * 3 + 1); // mock movement
        }
      }, 1000);
    } else {
      if (walkTimerRef.current) clearInterval(walkTimerRef.current);
    }
    return () => { if (walkTimerRef.current) clearInterval(walkTimerRef.current); };
  }, [phase, isMoving]);

  // ── Stop Detection Simulation ──────────────────────────────

  useEffect(() => {
    if (phase === "active" && !isMoving) {
      stopTimerRef.current = setInterval(() => {
        setStoppedTimer(t => {
          const next = t + 1;
          if (next >= stopThreshold && !guardianAlerted) {
            // Alert guardian
            setGuardianAlerted(true);
            addEvent("stop_detected", "Stopped moving — guardian alerted", "warning");
            addEvent("guardian_alert", `${selectedGuardian?.name} has been notified`, "warning");
            // Start escalation countdown
            setEscalationCountdown(escalationDelay);
          }
          return next;
        });
      }, 1000);
    } else {
      if (stopTimerRef.current) clearInterval(stopTimerRef.current);
      if (isMoving && guardianAlerted) {
        // Resumed walking — cancel escalation
        setGuardianAlerted(false);
        setEscalationCountdown(0);
        setStoppedTimer(0);
        addEvent("resume", "Resumed walking — alert cancelled", "info");
      }
    }
    return () => { if (stopTimerRef.current) clearInterval(stopTimerRef.current); };
  }, [phase, isMoving, stopThreshold, guardianAlerted]);

  // ── Escalation Countdown ────────────────────────────────────

  useEffect(() => {
    if (escalationCountdown > 0) {
      escalationRef.current = setInterval(() => {
        setEscalationCountdown(c => {
          if (c <= 1) {
            // Escalate to SOS!
            setPhase("escalated");
            addEvent("sos_escalated", "No response — auto-escalated to SOS!", "danger");
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } else {
      if (escalationRef.current) clearInterval(escalationRef.current);
    }
    return () => { if (escalationRef.current) clearInterval(escalationRef.current); };
  }, [escalationCountdown > 0]);

  // ── Simulate random stops (for demo) ───────────────────────

  useEffect(() => {
    if (phase !== "active") return;
    const simStop = setInterval(() => {
      // Every ~40 seconds, simulate a random stop/move
      if (Math.random() > 0.7) {
        setIsMoving(prev => !prev);
      }
    }, 8000);
    return () => clearInterval(simStop);
  }, [phase]);

  // ── Helper Functions ────────────────────────────────────────

  const addEvent = useCallback((type: WalkEvent["type"], message: string, severity: WalkEvent["severity"]) => {
    setEvents(prev => [{
      id: `e-${Date.now()}`,
      type,
      timestamp: Date.now(),
      message,
      severity,
    }, ...prev]);
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const startWalk = () => {
    if (!selectedGuardian) return;
    console.log("[SUPABASE_READY] safe_walk_started: " + JSON.stringify({ guardianCount: guardians.length, guardian: selectedGuardian.name, destination }));
    emitSyncEvent({
      type: "SAFE_WALK_STARTED",
      employeeId: userId,
      employeeName: userName,
      zone: userZone,
      timestamp: Date.now(),
      data: { guardians: guardians.map(g => g.name), destination },
    });
    setPhase("active");
    setWalkTimer(0);
    setDistanceWalked(0);
    setStoppedTimer(0);
    setIsMoving(true);
    setGuardianAlerted(false);
    setEscalationCountdown(0);
    setGuardians(gs => gs.map(g => g.id === selectedGuardian.id ? { ...g, watching: true } : g));
    addEvent("start", `Walk started — ${selectedGuardian.name} is watching`, "info");
  };

  const arrivedSafely = () => {
    setPhase("arrived");
    emitSyncEvent({
      type: "SAFE_WALK_ENDED",
      employeeId: userId,
      employeeName: userName,
      zone: userZone,
      timestamp: Date.now(),
      data: { arrivedSafely: true, duration: walkTimer },
    });
    addEvent("arrived", `Arrived safely at ${destination}!`, "info");
  };

  const pauseWalk = () => {
    setPhase("paused");
    setIsMoving(false);
  };

  const resumeWalk = () => {
    setPhase("active");
    setIsMoving(true);
    setStoppedTimer(0);
    setGuardianAlerted(false);
    setEscalationCountdown(0);
  };

  const cancelEscalation = () => {
    setGuardianAlerted(false);
    setEscalationCountdown(0);
    setStoppedTimer(0);
    setIsMoving(true);
    addEvent("resume", "Escalation cancelled — I'm OK", "info");
  };

  const sendQuickMessage = (msg: string) => {
    addEvent("message", msg, "info");
    setShowQuickMsg(false);
  };

  const endWalk = () => {
    const duration = walkTimer;
    const arrived = phase === "arrived";
    console.log("[SUPABASE_READY] safe_walk_ended: " + JSON.stringify({ duration, arrivedSafely: arrived }));
    emitSyncEvent({
      type: "SAFE_WALK_ENDED",
      employeeId: userId,
      employeeName: userName,
      zone: userZone,
      timestamp: Date.now(),
      data: { arrivedSafely: arrived, duration },
    });
    setPhase("setup");
    setWalkTimer(0);
    setDistanceWalked(0);
    setStoppedTimer(0);
    setEvents([]);
    setGuardianAlerted(false);
    setEscalationCountdown(0);
    setSelectedGuardian(null);
    setGuardians(initialGuardians);
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <div className="relative flex flex-col h-full">
      {/* Ambient */}
      <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[300px] pointer-events-none"
        style={{ background: phase === "active" ? "radial-gradient(ellipse, rgba(0,200,83,0.04) 0%, transparent 70%)" : phase === "escalated" ? "radial-gradient(ellipse, rgba(255,45,85,0.05) 0%, transparent 70%)" : "radial-gradient(ellipse, rgba(0,200,224,0.03) 0%, transparent 70%)" }}
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: "none" }}>
        <div className="pt-14 pb-8">
          {/* ── Header ───────────────────────────────── */}
          <div className="flex items-center justify-between px-5 mb-5">
            <div className="flex items-center gap-3">
              <button onClick={phase === "setup" ? onBack : () => setShowEvents(!showEvents)} className="size-9 rounded-[12px] flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                {phase === "setup" ? (
                  <ChevronLeft className="size-[18px]" style={{ color: "rgba(255,255,255,0.5)" }} />
                ) : (
                  <Clock className="size-[16px]" style={{ color: "rgba(255,255,255,0.3)" }} />
                )}
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-white" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>
                    {phase === "setup" ? "Safe Walk" : phase === "arrived" ? "Arrived!" : phase === "escalated" ? "SOS Escalated" : "Walking..."}
                  </h1>
                  {phase === "active" && (
                    <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
                      <div className="size-2 rounded-full" style={{ background: "#00C853" }} />
                    </motion.div>
                  )}
                </div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                  {phase === "setup" ? "Virtual escort for your safety"
                    : phase === "active" ? `${selectedGuardian?.name} is watching · ${formatTime(walkTimer)}`
                      : phase === "arrived" ? `${formatTime(walkTimer)} · ${Math.round(distanceWalked)}m`
                        : phase === "escalated" ? "Emergency services contacted"
                          : "Walk paused"
                  }
                </p>
              </div>
            </div>
            {phase === "active" && (
              <button onClick={() => setSoundEnabled(!soundEnabled)} className="size-9 rounded-[12px] flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                {soundEnabled ? <Volume2 className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} /> : <VolumeX className="size-4" style={{ color: "rgba(255,255,255,0.15)" }} />}
              </button>
            )}
          </div>

          {/* ═══ SETUP PHASE ═══════════════════════════ */}
          {phase === "setup" && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              {/* Hero Banner */}
              <div className="px-5 mb-5">
                <div className="rounded-2xl p-5 relative overflow-hidden" style={{
                  background: "linear-gradient(135deg, rgba(0,200,224,0.06), rgba(0,200,83,0.03))",
                  border: "1px solid rgba(0,200,224,0.1)",
                }}>
                  <div className="absolute top-0 right-0 size-32 pointer-events-none"
                    style={{ background: "radial-gradient(circle at top right, rgba(0,200,224,0.08), transparent 70%)" }}
                  />
                  <div className="flex items-start gap-4">
                    <div className="size-14 rounded-2xl flex items-center justify-center shrink-0"
                      style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.15)" }}>
                      <Footprints className="size-7" style={{ color: "#00C8E0" }} />
                    </div>
                    <div>
                      <p className="text-white mb-1" style={{ fontSize: 16, fontWeight: 700 }}>Walk Me Home</p>
                      <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
                        A trusted person watches your live location while you walk. 
                        If you stop for too long, they're alerted. If no response — auto-SOS.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* How It Works */}
              <div className="px-5 mb-5">
                <p className="mb-3" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.12)", letterSpacing: "0.5px" }}>
                  HOW IT WORKS
                </p>
                <div className="space-y-2">
                  {[
                    { step: 1, icon: User, text: "Choose a guardian to watch you", color: "#00C8E0" },
                    { step: 2, icon: Navigation, text: "Set your destination & start walking", color: "#00C853" },
                    { step: 3, icon: Eye, text: "Guardian sees your live location", color: "#FF9500" },
                    { step: 4, icon: AlertTriangle, text: "Stop 2min → guardian alert → SOS auto-escalation", color: "#FF2D55" },
                  ].map(item => (
                    <div key={item.step} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.03)" }}>
                      <div className="size-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${item.color}08` }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: item.color }}>{item.step}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-1">
                        <item.icon className="size-3.5 shrink-0" style={{ color: item.color }} />
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{item.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Select Guardian */}
              <div className="px-5 mb-5">
                <p className="mb-3" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.12)", letterSpacing: "0.5px" }}>
                  SELECT YOUR GUARDIAN
                </p>
                <div className="space-y-2">
                  {guardians.map(g => (
                    <motion.button
                      key={g.id}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setSelectedGuardian(g)}
                      className="w-full flex items-center gap-3 p-3.5 rounded-xl"
                      style={{
                        background: selectedGuardian?.id === g.id ? "rgba(0,200,224,0.06)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${selectedGuardian?.id === g.id ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}`,
                        opacity: !g.online ? 0.5 : 1,
                      }}
                    >
                      <div className="relative">
                        <ImageWithFallback src={g.avatar} alt={g.name} className="size-11 rounded-xl object-cover" />
                        <div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full"
                          style={{ background: "#0A1220", border: `2px solid ${g.online ? "#00C853" : "rgba(255,255,255,0.1)"}` }}>
                          <div className="size-full rounded-full" style={{ background: g.online ? "#00C853" : "transparent" }} />
                        </div>
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{g.name}</p>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                          {g.relation} · {g.online ? "Online" : "Offline"}
                        </p>
                      </div>
                      <div className="size-6 rounded-full flex items-center justify-center"
                        style={{
                          background: selectedGuardian?.id === g.id ? "#00C8E0" : "rgba(255,255,255,0.04)",
                          border: `1.5px solid ${selectedGuardian?.id === g.id ? "#00C8E0" : "rgba(255,255,255,0.08)"}`,
                        }}>
                        {selectedGuardian?.id === g.id && <CheckCircle2 className="size-4" style={{ color: "#fff" }} />}
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Destination */}
              <div className="px-5 mb-5">
                <p className="mb-3" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.12)", letterSpacing: "0.5px" }}>
                  DESTINATION
                </p>
                <div className="flex gap-2">
                  {["Home", "Work", "School", "Custom"].map(d => (
                    <button
                      key={d}
                      onClick={() => setDestination(d)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl"
                      style={{
                        background: destination === d ? "rgba(0,200,224,0.06)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${destination === d ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}`,
                        fontSize: 12, fontWeight: destination === d ? 700 : 500,
                        color: destination === d ? "#00C8E0" : "rgba(255,255,255,0.25)",
                      }}
                    >
                      {d === "Home" && <Home className="size-3" />}
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Est. Time */}
              <div className="px-5 mb-5">
                <p className="mb-3" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.12)", letterSpacing: "0.5px" }}>
                  ESTIMATED WALK TIME
                </p>
                <div className="flex gap-2">
                  {[5, 10, 15, 20, 30].map(m => (
                    <button
                      key={m}
                      onClick={() => setEstimatedTime(m)}
                      className="flex-1 py-2.5 rounded-xl"
                      style={{
                        background: estimatedTime === m ? "rgba(0,200,224,0.06)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${estimatedTime === m ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}`,
                        fontSize: 12, fontWeight: estimatedTime === m ? 700 : 500,
                        color: estimatedTime === m ? "#00C8E0" : "rgba(255,255,255,0.25)",
                      }}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Safety Settings */}
              <div className="px-5 mb-5">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="w-full flex items-center justify-between p-3.5 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                >
                  <div className="flex items-center gap-2.5">
                    <Shield className="size-4" style={{ color: "rgba(255,255,255,0.2)" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.35)" }}>Safety Settings</span>
                  </div>
                  <ChevronDown className="size-4" style={{ color: "rgba(255,255,255,0.15)", transform: showSettings ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
                </button>
                <AnimatePresence>
                  {showSettings && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="mt-2 space-y-3 p-3.5 rounded-xl" style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.03)" }}>
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.25)" }}>Stop alert after</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#FF9500" }}>{stopThreshold}s</span>
                          </div>
                          <input
                            type="range" min={30} max={300} step={30} value={stopThreshold}
                            onChange={e => setStopThreshold(Number(e.target.value))}
                            className="w-full h-1 rounded-full appearance-none cursor-pointer"
                            style={{ background: "rgba(255,255,255,0.06)", accentColor: "#FF9500" }}
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.25)" }}>SOS escalation after</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#FF2D55" }}>{escalationDelay}s</span>
                          </div>
                          <input
                            type="range" min={30} max={180} step={15} value={escalationDelay}
                            onChange={e => setEscalationDelay(Number(e.target.value))}
                            className="w-full h-1 rounded-full appearance-none cursor-pointer"
                            style={{ background: "rgba(255,255,255,0.06)", accentColor: "#FF2D55" }}
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Start Button */}
              <div className="px-5">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={startWalk}
                  disabled={!selectedGuardian}
                  className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl"
                  style={{
                    background: selectedGuardian
                      ? "linear-gradient(135deg, #00C853, #009E40)"
                      : "rgba(255,255,255,0.04)",
                    fontSize: 16, fontWeight: 700,
                    color: selectedGuardian ? "#fff" : "rgba(255,255,255,0.15)",
                    boxShadow: selectedGuardian ? "0 8px 30px rgba(0,200,83,0.25)" : "none",
                  }}
                >
                  <Footprints className="size-5" />
                  Start Safe Walk
                </motion.button>
                {!selectedGuardian && (
                  <p className="text-center mt-2" style={{ fontSize: 11, color: "rgba(255,255,255,0.15)" }}>
                    Select a guardian to continue
                  </p>
                )}

                {/* Pro badge */}
                {!isPro && (
                  <button onClick={onUpgrade} className="w-full flex items-center justify-center gap-2 mt-3 py-2.5 rounded-xl"
                    style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.08)", fontSize: 11, fontWeight: 600, color: "#00C8E0" }}>
                    <Crown className="size-3.5" /> Pro feature — tap to upgrade
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* ═══ ACTIVE / PAUSED PHASE ════════════════════ */}
          {(phase === "active" || phase === "paused") && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              {/* Guardian Watching Banner */}
              <div className="px-5 mb-4">
                <div className="flex items-center gap-3 p-3.5 rounded-2xl" style={{
                  background: "rgba(0,200,83,0.04)",
                  border: "1px solid rgba(0,200,83,0.1)",
                }}>
                  <div className="relative">
                    <ImageWithFallback src={selectedGuardian?.avatar || ""} alt="" className="size-11 rounded-xl object-cover" />
                    <motion.div
                      animate={{ scale: [1, 1.3, 1], opacity: [0.8, 0.3, 0.8] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute -top-1 -right-1 size-4 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(0,200,83,0.15)", border: "1.5px solid #00C853" }}
                    >
                      <Eye className="size-2" style={{ color: "#00C853" }} />
                    </motion.div>
                  </div>
                  <div className="flex-1">
                    <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>
                      {selectedGuardian?.name} is watching
                    </p>
                    <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.25)" }}>
                      Live location sharing · To {destination}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                      <Signal className="size-3.5" style={{ color: "#00C853" }} />
                    </motion.div>
                  </div>
                </div>
              </div>

              {/* Live Stats */}
              <div className="px-5 mb-4">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Duration", value: formatTime(walkTimer), color: "#00C8E0", icon: Clock },
                    { label: "Distance", value: `${Math.round(distanceWalked)}m`, color: "#00C853", icon: Route },
                    { label: "Status", value: isMoving ? "Moving" : "Stopped", color: isMoving ? "#00C853" : "#FF9500", icon: isMoving ? Navigation : Pause },
                  ].map(s => (
                    <div key={s.label} className="p-3 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <s.icon className="size-4 mx-auto mb-1.5" style={{ color: s.color }} />
                      <p className="text-white" style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", marginTop: 2 }}>{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Movement Progress Bar */}
              <div className="px-5 mb-4">
                <div className="relative rounded-full overflow-hidden h-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full"
                    animate={{ width: `${Math.min((walkTimer / (estimatedTime * 60)) * 100, 100)}%` }}
                    style={{ background: "linear-gradient(90deg, #00C8E0, #00C853)" }}
                  />
                  {/* Walking figure */}
                  <motion.div
                    className="absolute top-1/2 -translate-y-1/2"
                    animate={{ left: `${Math.min((walkTimer / (estimatedTime * 60)) * 100, 98)}%` }}
                  >
                    <div className="size-5 -ml-2.5 rounded-full flex items-center justify-center"
                      style={{ background: "#00C8E0", boxShadow: "0 2px 8px rgba(0,200,224,0.4)" }}>
                      <Footprints className="size-2.5" style={{ color: "#fff" }} />
                    </div>
                  </motion.div>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.12)" }}>Start</span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.12)" }}>{destination} · ~{estimatedTime}min</span>
                </div>
              </div>

              {/* ── STOP ALERT (when stopped too long) ──── */}
              <AnimatePresence>
                {guardianAlerted && phase === "active" && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="px-5 mb-4"
                  >
                    <motion.div
                      animate={{ boxShadow: ["0 0 20px rgba(255,45,85,0.1)", "0 0 40px rgba(255,45,85,0.2)", "0 0 20px rgba(255,45,85,0.1)"] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="rounded-2xl p-4"
                      style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.15)" }}
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <motion.div
                          animate={{ scale: [1, 1.1, 1] }}
                          transition={{ duration: 0.8, repeat: Infinity }}
                          className="size-10 rounded-xl flex items-center justify-center"
                          style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}
                        >
                          <AlertTriangle className="size-5" style={{ color: "#FF2D55" }} />
                        </motion.div>
                        <div className="flex-1">
                          <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>You stopped moving</p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                            {selectedGuardian?.name} has been alerted
                          </p>
                        </div>
                      </div>

                      {/* Countdown */}
                      {escalationCountdown > 0 && (
                        <div className="mb-3">
                          <div className="flex items-center justify-between mb-1">
                            <span style={{ fontSize: 11, color: "rgba(255,45,85,0.6)" }}>SOS auto-escalation in</span>
                            <span style={{ fontSize: 18, fontWeight: 800, color: "#FF2D55" }}>{escalationCountdown}s</span>
                          </div>
                          <div className="relative rounded-full overflow-hidden h-1.5" style={{ background: "rgba(255,45,85,0.1)" }}>
                            <motion.div
                              className="absolute inset-y-0 left-0 rounded-full"
                              style={{ background: "#FF2D55", width: `${(escalationCountdown / escalationDelay) * 100}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={cancelEscalation}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
                        style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)", fontSize: 14, fontWeight: 700, color: "#00C853" }}
                      >
                        <CheckCircle2 className="size-4" />
                        I'm OK — Cancel Alert
                      </motion.button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Sim Controls (for demo — hidden in production) */}
              {process.env.NODE_ENV === 'development' && (
              <div className="px-5 mb-4">
                <p className="mb-2" style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.08)", letterSpacing: "0.5px" }}>
                  DEMO SIMULATION
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsMoving(true)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                    style={{
                      background: isMoving ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${isMoving ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.04)"}`,
                      fontSize: 11, fontWeight: 600, color: isMoving ? "#00C853" : "rgba(255,255,255,0.2)",
                    }}
                  >
                    <Navigation className="size-3" /> Moving
                  </button>
                  <button
                    onClick={() => { setIsMoving(false); setStoppedTimer(0); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                    style={{
                      background: !isMoving ? "rgba(255,150,0,0.08)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${!isMoving ? "rgba(255,150,0,0.15)" : "rgba(255,255,255,0.04)"}`,
                      fontSize: 11, fontWeight: 600, color: !isMoving ? "#FF9500" : "rgba(255,255,255,0.2)",
                    }}
                  >
                    <Pause className="size-3" /> Stopped
                  </button>
                </div>
                {!isMoving && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <Timer className="size-3" style={{ color: "rgba(255,150,0,0.5)" }} />
                    <p style={{ fontSize: 10, color: "rgba(255,150,0,0.5)" }}>
                      Stopped for {stoppedTimer}s — alert at {stopThreshold}s
                    </p>
                  </div>
                )}
              </div>
              )}

              {/* Quick Messages */}
              <div className="px-5 mb-4">
                <button onClick={() => setShowQuickMsg(!showQuickMsg)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl"
                  style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.08)", fontSize: 12, fontWeight: 600, color: "#00C8E0" }}>
                  <MessageSquare className="size-3.5" /> Quick Message to {selectedGuardian?.name}
                </button>
                <AnimatePresence>
                  {showQuickMsg && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {QUICK_MESSAGES.map(msg => (
                          <button
                            key={msg.text}
                            onClick={() => sendQuickMessage(`${msg.emoji} ${msg.text}`)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", fontSize: 11, color: "rgba(255,255,255,0.4)" }}
                          >
                            <span style={{ fontSize: 13 }}>{msg.emoji}</span> {msg.text}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Action Buttons */}
              <div className="px-5 space-y-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={arrivedSafely}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl"
                  style={{
                    background: "linear-gradient(135deg, #00C853, #009E40)",
                    fontSize: 15, fontWeight: 700, color: "#fff",
                    boxShadow: "0 8px 30px rgba(0,200,83,0.2)",
                  }}
                >
                  <CheckCircle2 className="size-5" />
                  I Arrived Safely
                </motion.button>

                <div className="flex gap-2">
                  <button
                    onClick={phase === "paused" ? resumeWalk : pauseWalk}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                    style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.12)", fontSize: 13, fontWeight: 600, color: "#FF9500" }}
                  >
                    {phase === "paused" ? <><Play className="size-3.5" /> Resume</> : <><Pause className="size-3.5" /> Pause</>}
                  </button>
                  <button
                    onClick={() => { if (onSOSTrigger) onSOSTrigger(); }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                    style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.12)", fontSize: 13, fontWeight: 600, color: "#FF2D55" }}
                  >
                    <AlertTriangle className="size-3.5" /> SOS Now
                  </button>
                </div>
              </div>

              {/* Event Log */}
              {events.length > 0 && (
                <div className="px-5 mt-5">
                  <p className="mb-2" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.12)", letterSpacing: "0.5px" }}>
                    ACTIVITY LOG ({events.length})
                  </p>
                  <div className="space-y-1">
                    {events.slice(0, 6).map(ev => (
                      <div key={ev.id} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.015)" }}>
                        <div className="size-1.5 rounded-full mt-1.5 shrink-0" style={{
                          background: ev.severity === "danger" ? "#FF2D55" : ev.severity === "warning" ? "#FF9500" : "rgba(0,200,224,0.5)"
                        }} />
                        <div className="flex-1 min-w-0">
                          <p className="truncate" style={{ fontSize: 11, color: ev.severity === "danger" ? "#FF2D55" : ev.severity === "warning" ? "rgba(255,150,0,0.7)" : "rgba(255,255,255,0.3)" }}>
                            {ev.message}
                          </p>
                          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.1)" }}>
                            {new Date(ev.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ═══ ARRIVED PHASE ════════════════════════════ */}
          {phase === "arrived" && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="px-5 text-center">
                {/* Success animation */}
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="size-24 rounded-full flex items-center justify-center mx-auto mb-5"
                  style={{ background: "rgba(0,200,83,0.08)", border: "2px solid rgba(0,200,83,0.2)", boxShadow: "0 0 60px rgba(0,200,83,0.1)" }}
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.3, type: "spring" }}
                  >
                    <CheckCircle2 className="size-12" style={{ color: "#00C853" }} />
                  </motion.div>
                </motion.div>

                <motion.h2
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-white mb-2"
                  style={{ fontSize: 24, fontWeight: 800 }}
                >
                  Arrived Safely!
                </motion.h2>
                <motion.p
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginBottom: 24 }}
                >
                  {selectedGuardian?.name} has been notified you're safe
                </motion.p>

                {/* Walk Summary */}
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="grid grid-cols-3 gap-2 mb-6"
                >
                  {[
                    { label: "Duration", value: formatTime(walkTimer), color: "#00C8E0" },
                    { label: "Distance", value: `${Math.round(distanceWalked)}m`, color: "#00C853" },
                    { label: "Alerts", value: events.filter(e => e.severity === "warning").length.toString(), color: "#FF9500" },
                  ].map(s => (
                    <div key={s.label} className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <p style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</p>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 2 }}>{s.label}</p>
                    </div>
                  ))}
                </motion.div>

                <motion.button
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={endWalk}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl"
                  style={{
                    background: "rgba(0,200,224,0.08)",
                    border: "1px solid rgba(0,200,224,0.15)",
                    fontSize: 15, fontWeight: 700, color: "#00C8E0",
                  }}
                >
                  Done
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ═══ ESCALATED PHASE ══════════════════════════ */}
          {phase === "escalated" && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="px-5 text-center">
                <motion.div
                  animate={{ boxShadow: ["0 0 30px rgba(255,45,85,0.1)", "0 0 60px rgba(255,45,85,0.2)", "0 0 30px rgba(255,45,85,0.1)"] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="size-24 rounded-full flex items-center justify-center mx-auto mb-5"
                  style={{ background: "rgba(255,45,85,0.1)", border: "2px solid rgba(255,45,85,0.25)" }}
                >
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                  >
                    <AlertTriangle className="size-12" style={{ color: "#FF2D55" }} />
                  </motion.div>
                </motion.div>

                <h2 className="text-white mb-2" style={{ fontSize: 24, fontWeight: 800 }}>SOS Escalated</h2>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginBottom: 8 }}>
                  You didn't respond — emergency protocol activated
                </p>

                {/* What happened */}
                <div className="rounded-2xl p-4 text-left mb-6" style={{ background: "rgba(255,45,85,0.04)", border: "1px solid rgba(255,45,85,0.1)" }}>
                  <div className="space-y-2.5">
                    {[
                      { label: "Guardian alerted", desc: `${selectedGuardian?.name} received emergency notification`, done: true },
                      { label: "Emergency contacts notified", desc: "All contacts received SOS with location", done: true },
                      { label: "Emergency Ripple activated", desc: "3-wave alert system triggered", done: true },
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <CheckCircle2 className="size-4 shrink-0 mt-0.5" style={{ color: "#FF2D55" }} />
                        <div>
                          <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{item.label}</p>
                          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setPhase("active");
                      setIsMoving(true);
                      setGuardianAlerted(false);
                      setEscalationCountdown(0);
                      setStoppedTimer(0);
                      addEvent("resume", "SOS cancelled — I'm safe", "info");
                    }}
                    className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl"
                    style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)", fontSize: 15, fontWeight: 700, color: "#00C853" }}
                  >
                    <CheckCircle2 className="size-5" />
                    I'm Safe — Cancel SOS
                  </motion.button>
                  <button
                    onClick={endWalk}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
                    style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.25)" }}
                  >
                    End Walk
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}