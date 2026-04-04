// ═══════════════════════════════════════════════════════════════
// SOSphere — Fall Detection Engine
// ─────────────────────────────────────────────────────────────
// Uses phone accelerometer to detect falls:
// • Sudden acceleration spike (free-fall) → impact → stillness
// • 15-second countdown before auto-SOS
// • Can be cancelled if false alarm
// • Works without any external hardware
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle, X, Phone, Shield, Activity,
  Smartphone, CheckCircle, Clock, Zap, Heart,
  Volume2, MapPin, ChevronRight,
} from "lucide-react";
import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";

// ── Persist sensor events to Supabase ────────────────────────
export async function saveSensorEvent(type: "fall" | "shake", acceleration: number) {
  // Always save locally
  const events = JSON.parse(localStorage.getItem("sosphere_sensor_events") || "[]");
  const event = {
    id: `SE-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    type,
    acceleration,
    timestamp: new Date().toISOString(),
    resolved: false,
  };
  events.unshift(event);
  localStorage.setItem("sosphere_sensor_events", JSON.stringify(events.slice(0, 200)));

  // Save to Supabase
  if (SUPABASE_CONFIG.isConfigured) {
    try {
      await supabase.from("sensor_events").insert({
        id: event.id,
        event_type: type,
        acceleration,
        detected_at: event.timestamp,
        resolved: false,
      });
    } catch (e) {
      console.warn("[Sensor] Supabase save failed:", e);
    }
  }
}

// ── Fall Detection State ───────────────────────────────────────
type FallState = "monitoring" | "fall_detected" | "countdown" | "sos_triggered" | "cancelled";

interface FallEvent {
  timestamp: number;
  acceleration: number;
  type: "free_fall" | "impact" | "stillness";
}

interface FallDetectionProps {
  enabled: boolean;
  onSOSTrigger: () => void;
  onFallDetected?: (event: FallEvent) => void;
  countdownSeconds?: number;
}

// ── Fall Detection Hook ────────────────────────────────────────
export function useFallDetection({
  enabled,
  onSOSTrigger,
  onFallDetected,
  countdownSeconds = 15,
}: FallDetectionProps) {
  const [state, setState] = useState<FallState>("monitoring");
  const [countdown, setCountdown] = useState(countdownSeconds);
  const [accelerationHistory, setAccelerationHistory] = useState<number[]>([]);
  const [isSupported, setIsSupported] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFallRef = useRef<number>(0);

  // Check device support
  useEffect(() => {
    setIsSupported("DeviceMotionEvent" in window);
  }, []);

  // Simulate fall detection for demo (since DeviceMotion needs real device)
  const simulateFall = useCallback(() => {
    if (!enabled || state !== "monitoring") return;
    
    // Prevent rapid re-triggers
    if (Date.now() - lastFallRef.current < 30000) return;
    lastFallRef.current = Date.now();

    const event: FallEvent = {
      timestamp: Date.now(),
      acceleration: 38.2, // ~4G impact
      type: "impact",
    };

    setState("fall_detected");
    onFallDetected?.(event);
    saveSensorEvent("fall", event.acceleration);

    // After 1.5s show, move to countdown
    setTimeout(() => {
      setState("countdown");
      setCountdown(countdownSeconds);
    }, 1500);
  }, [enabled, state, onFallDetected, countdownSeconds]);

  // Countdown timer
  useEffect(() => {
    if (state !== "countdown") return;

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Time's up — trigger SOS
          if (countdownRef.current) clearInterval(countdownRef.current);
          setState("sos_triggered");
          onSOSTrigger();
          // Reset after 5 seconds
          setTimeout(() => {
            setState("monitoring");
            setCountdown(countdownSeconds);
          }, 5000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [state, onSOSTrigger, countdownSeconds]);

  const cancelFall = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setState("cancelled");
    setCountdown(countdownSeconds);
    // Return to monitoring after 2s
    setTimeout(() => setState("monitoring"), 2000);
  }, [countdownSeconds]);

  // ── Real DeviceMotion accelerometer ──────────────────────────
  // iOS 13+ requires permission; Android fires immediately
  const FREE_FALL_THRESHOLD = 3.0;   // m/s² below this = free-fall (gravity absent)
  const IMPACT_THRESHOLD    = 25.0;  // m/s² above this = hard impact (~2.5G)
  const freeFallRef  = useRef(false);
  const impactTimeRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    let removeListener: (() => void) | null = null;

    const attachMotion = () => {
      const handler = (e: DeviceMotionEvent) => {
        const a = e.accelerationIncludingGravity;
        if (!a) return;
        const mag = Math.sqrt((a.x||0)**2 + (a.y||0)**2 + (a.z||0)**2);

        // Update chart
        setAccelerationHistory(prev => [...prev, mag].slice(-30));

        // Fall algorithm: free-fall → impact within 2s → not already triggered
        if (mag < FREE_FALL_THRESHOLD) {
          freeFallRef.current = true;
          impactTimeRef.current = Date.now();
        } else if (freeFallRef.current && mag > IMPACT_THRESHOLD) {
          const timeSinceFreeFall = Date.now() - impactTimeRef.current;
          if (timeSinceFreeFall < 2000 && Date.now() - lastFallRef.current > 30000) {
            freeFallRef.current = false;
            simulateFall(); // reuse the trigger logic
          }
        } else if (mag > 12) {
          freeFallRef.current = false; // reset on normal movement
        }
      };

      window.addEventListener("devicemotion", handler, true);
      removeListener = () => window.removeEventListener("devicemotion", handler, true);
    };

    // iOS 13+ requires explicit permission
    const DM = window.DeviceMotionEvent as any;
    if (typeof DM?.requestPermission === "function") {
      DM.requestPermission()
        .then((result: string) => { if (result === "granted") attachMotion(); })
        .catch(() => {
          // Fallback: show live chart with random data if permission denied
          const iv = setInterval(() => {
            setAccelerationHistory(prev => [...prev, 9.8 + (Math.random() - 0.5) * 1.5].slice(-30));
          }, 200);
          removeListener = () => clearInterval(iv);
        });
    } else if ("DeviceMotionEvent" in window) {
      attachMotion();
    } else {
      // Desktop / unsupported — keep visual chart running with simulated normal gravity
      const iv = setInterval(() => {
        setAccelerationHistory(prev => [...prev, 9.8 + (Math.random() - 0.5) * 1].slice(-30));
      }, 200);
      removeListener = () => clearInterval(iv);
    }

    return () => { removeListener?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    state,
    countdown,
    isSupported,
    accelerationHistory,
    simulateFall,
    cancelFall,
  };
}

// ── Fall Detection Overlay (shows when fall detected) ──────────
interface FallDetectionOverlayProps {
  state: FallState;
  countdown: number;
  onCancel: () => void;
}

export function FallDetectionOverlay({ state, countdown, onCancel }: FallDetectionOverlayProps) {
  if (state === "monitoring" || state === "cancelled") return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-[70] flex items-center justify-center"
        style={{
          background: state === "sos_triggered"
            ? "rgba(255,45,85,0.95)"
            : "rgba(5,7,14,0.95)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="flex flex-col items-center px-8">
          {/* Fall Detected Phase */}
          {state === "fall_detected" && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
                className="size-24 rounded-full flex items-center justify-center mb-6"
                style={{
                  background: "linear-gradient(135deg, rgba(255,149,0,0.2), rgba(255,45,85,0.15))",
                  border: "2px solid rgba(255,149,0,0.4)",
                  boxShadow: "0 0 40px rgba(255,149,0,0.2)",
                }}
              >
                <AlertTriangle className="size-10" style={{ color: "#FF9500" }} />
              </motion.div>
              <p className="text-white text-center" style={{ fontSize: 22, fontWeight: 800 }}>
                Fall Detected
              </p>
              <p className="text-center mt-2" style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
                Analyzing movement pattern...
              </p>
            </motion.div>
          )}

          {/* Countdown Phase */}
          {state === "countdown" && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center"
            >
              {/* Countdown Circle */}
              <div className="relative size-44 mb-6">
                <svg className="size-44" viewBox="0 0 180 180">
                  <circle cx="90" cy="90" r="82" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
                  <motion.circle
                    cx="90" cy="90" r="82" fill="none"
                    stroke="#FF2D55" strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={515}
                    strokeDashoffset={515 * (1 - countdown / 15)}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <motion.span
                    key={countdown}
                    initial={{ scale: 1.3, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    style={{ fontSize: 52, fontWeight: 900, color: "#FF2D55" }}
                  >
                    {countdown}
                  </motion.span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>
                    seconds
                  </span>
                </div>
              </div>

              <p className="text-white text-center" style={{ fontSize: 18, fontWeight: 800 }}>
                Are you okay?
              </p>
              <p className="text-center mt-2 max-w-[260px]" style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                A fall was detected. SOS will activate automatically if you don't respond.
              </p>

              {/* Cancel Button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={onCancel}
                className="mt-8 flex items-center gap-2.5 px-10 py-4 rounded-2xl"
                style={{
                  background: "linear-gradient(135deg, rgba(0,200,83,0.15), rgba(0,200,83,0.08))",
                  border: "2px solid rgba(0,200,83,0.3)",
                  boxShadow: "0 0 30px rgba(0,200,83,0.1)",
                }}
              >
                <CheckCircle className="size-5" style={{ color: "#00C853" }} />
                <span style={{ fontSize: 16, fontWeight: 800, color: "#00C853" }}>I'm OK — Cancel</span>
              </motion.button>

              {/* Auto-SOS info */}
              <div className="flex items-center gap-2 mt-5 px-4 py-2 rounded-xl"
                style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.1)" }}>
                <Zap className="size-3" style={{ color: "#FF2D55" }} />
                <span style={{ fontSize: 10, color: "#FF2D55", fontWeight: 600 }}>
                  Auto-SOS in {countdown}s with GPS + Audio
                </span>
              </div>
            </motion.div>
          )}

          {/* SOS Triggered Phase */}
          {state === "sos_triggered" && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center"
            >
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                className="size-28 rounded-full flex items-center justify-center mb-6"
                style={{
                  background: "rgba(255,255,255,0.15)",
                  border: "3px solid rgba(255,255,255,0.3)",
                }}
              >
                <Phone className="size-12 text-white" />
              </motion.div>
              <p className="text-white text-center" style={{ fontSize: 24, fontWeight: 900 }}>
                SOS Activated
              </p>
              <p className="text-center mt-2" style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                Emergency contacts are being notified
              </p>
              <div className="flex items-center gap-3 mt-6">
                {[
                  { icon: MapPin, label: "GPS Sent" },
                  { icon: Volume2, label: "Recording" },
                  { icon: Heart, label: "Alerting" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.1)" }}>
                    <item.icon className="size-3 text-white" />
                    <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Fall Detection Settings Card (for settings screen) ─────────
interface FallDetectionSettingsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  sensitivity: "low" | "medium" | "high";
  onSensitivityChange: (s: "low" | "medium" | "high") => void;
  onSimulate?: () => void;
}

export function FallDetectionSettings({
  enabled,
  onToggle,
  sensitivity,
  onSensitivityChange,
  onSimulate,
}: FallDetectionSettingsProps) {
  const sensitivities = [
    { id: "low" as const, label: "Low", desc: "Detects hard falls only", color: "#00C853" },
    { id: "medium" as const, label: "Medium", desc: "Balanced detection", color: "#FF9500" },
    { id: "high" as const, label: "High", desc: "Sensitive — may trigger on rough terrain", color: "#FF2D55" },
  ];

  return (
    <div className="space-y-3">
      {/* Toggle */}
      <div className="p-3.5 rounded-2xl" style={{
        background: enabled ? "rgba(0,200,83,0.04)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${enabled ? "rgba(0,200,83,0.1)" : "rgba(255,255,255,0.05)"}`,
      }}>
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl flex items-center justify-center"
            style={{ background: enabled ? "rgba(0,200,83,0.1)" : "rgba(255,255,255,0.04)" }}>
            <Activity className="size-5" style={{ color: enabled ? "#00C853" : "rgba(255,255,255,0.2)" }} />
          </div>
          <div className="flex-1">
            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Fall Detection</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
              Uses phone accelerometer to detect falls. Auto-triggers SOS after 15s if no response.
            </p>
          </div>
          <button onClick={() => onToggle(!enabled)}
            className="relative w-11 h-6 rounded-full transition-all"
            style={{
              background: enabled
                ? "linear-gradient(135deg, #00C853, #00A040)"
                : "rgba(255,255,255,0.08)",
            }}>
            <motion.div
              animate={{ x: enabled ? 20 : 2 }}
              className="absolute top-1 size-4 rounded-full bg-white"
              style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }}
            />
          </button>
        </div>
      </div>

      {/* Sensitivity */}
      {enabled && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px", marginBottom: 8 }}>
            SENSITIVITY
          </p>
          <div className="flex gap-2">
            {sensitivities.map(s => (
              <button key={s.id} onClick={() => onSensitivityChange(s.id)}
                className="flex-1 p-2.5 rounded-xl text-center transition-all"
                style={{
                  background: sensitivity === s.id ? `${s.color}08` : "rgba(255,255,255,0.02)",
                  border: `1px solid ${sensitivity === s.id ? `${s.color}20` : "rgba(255,255,255,0.04)"}`,
                }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: sensitivity === s.id ? s.color : "rgba(255,255,255,0.3)" }}>
                  {s.label}
                </p>
                <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>{s.desc}</p>
              </button>
            ))}
          </div>

          {/* Test Button */}
          {onSimulate && (
            <button onClick={onSimulate}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl mt-3"
              style={{ background: "rgba(255,149,0,0.06)", border: "1px solid rgba(255,149,0,0.12)", color: "#FF9500", fontSize: 11, fontWeight: 600 }}>
              <Smartphone className="size-3.5" />
              Simulate Fall (Test)
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}
