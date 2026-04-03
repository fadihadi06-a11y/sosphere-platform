// ═══════════════════════════════════════════════════════════════
// SOSphere — Shake-to-SOS
// ─────────────────────────────────────────────────────────────
// Detects 3 rapid shakes → triggers SOS instantly
// For situations where touching the screen is impossible
// (attack, broken hand, trapped)
// Uses DeviceMotion API (same sensor as Fall Detection)
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Smartphone, Shield, X, AlertTriangle, CheckCircle,
  Activity, Vibrate,
} from "lucide-react";

// ── Shake Detection Hook ──────────────────────────────────────
interface ShakeConfig {
  enabled: boolean;
  onShakeSOS: () => void;
  shakeThreshold?: number;  // acceleration threshold (m/s²)
  shakeCount?: number;      // number of shakes needed
  shakeWindow?: number;     // time window (ms) to complete shakes
  cooldownMs?: number;      // prevent re-trigger
}

export function useShakeDetection({
  enabled,
  onShakeSOS,
  shakeThreshold = 25,
  shakeCount = 3,
  shakeWindow = 2000,
  cooldownMs = 30000,
}: ShakeConfig) {
  const [isSupported, setIsSupported] = useState(false);
  const [shakeProgress, setShakeProgress] = useState(0); // 0 to shakeCount
  const [isActive, setIsActive] = useState(false);
  const shakesRef = useRef<number[]>([]);
  const lastTriggerRef = useRef(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIsSupported("DeviceMotionEvent" in window);
  }, []);

  // Listen for device motion
  useEffect(() => {
    if (!enabled || !isSupported) return;

    const handleMotion = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

      const totalAcceleration = Math.sqrt(
        acc.x * acc.x + acc.y * acc.y + acc.z * acc.z
      );

      if (totalAcceleration > shakeThreshold) {
        const now = Date.now();

        // Cooldown check
        if (now - lastTriggerRef.current < cooldownMs) return;

        shakesRef.current.push(now);

        // Remove old shakes outside the window
        shakesRef.current = shakesRef.current.filter(
          (t) => now - t < shakeWindow
        );

        setShakeProgress(shakesRef.current.length);

        if (shakesRef.current.length >= shakeCount) {
          // SHAKE SOS TRIGGERED!
          lastTriggerRef.current = now;
          shakesRef.current = [];
          setShakeProgress(0);
          setIsActive(true);
          onShakeSOS();
        }
      }
    };

    window.addEventListener("devicemotion", handleMotion);
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, [enabled, isSupported, shakeThreshold, shakeCount, shakeWindow, cooldownMs, onShakeSOS]);

  // Auto-clear shake progress after window expires
  useEffect(() => {
    if (shakeProgress > 0) {
      const timer = setTimeout(() => {
        setShakeProgress(0);
        shakesRef.current = [];
      }, shakeWindow);
      return () => clearTimeout(timer);
    }
  }, [shakeProgress, shakeWindow]);

  // Demo: simulate shake
  const simulateShake = useCallback(() => {
    if (!enabled) return;
    if (Date.now() - lastTriggerRef.current < cooldownMs) return;

    // Simulate progressive shakes
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setShakeProgress(count);
      if (count >= shakeCount) {
        clearInterval(interval);
        lastTriggerRef.current = Date.now();
        setTimeout(() => {
          setShakeProgress(0);
          setIsActive(true);
          onShakeSOS();
        }, 300);
      }
    }, 400);
  }, [enabled, cooldownMs, shakeCount, onShakeSOS]);

  return {
    isSupported,
    shakeProgress,
    isActive,
    setIsActive,
    simulateShake,
    maxShakes: shakeCount,
  };
}

// ── Shake-to-SOS Status Indicator (mobile dashboard) ──────────
export function ShakeSOSIndicator({
  enabled,
  onToggle,
  shakeProgress,
  maxShakes,
  onSimulate,
}: {
  enabled: boolean;
  onToggle: (val: boolean) => void;
  shakeProgress: number;
  maxShakes: number;
  onSimulate: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(255,150,0,0.06), rgba(255,150,0,0.02))",
        border: "1px solid rgba(255,150,0,0.12)",
      }}
    >
      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <div
            className="size-9 rounded-xl flex items-center justify-center"
            style={{
              background: enabled
                ? "linear-gradient(135deg, rgba(255,150,0,0.2), rgba(255,150,0,0.1))"
                : "rgba(255,255,255,0.04)",
              border: `1px solid ${enabled ? "rgba(255,150,0,0.3)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            <Vibrate className="size-4" style={{ color: enabled ? "#FF9500" : "rgba(255,255,255,0.3)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>
              Shake-to-SOS
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
              Shake phone 3× for instant SOS
            </p>
          </div>
          <button
            onClick={() => onToggle(!enabled)}
            className="relative w-10 h-5 rounded-full transition-all"
            style={{
              background: enabled
                ? "linear-gradient(90deg, #FF9500, #FF6B00)"
                : "rgba(255,255,255,0.08)",
              border: `1px solid ${enabled ? "rgba(255,150,0,0.4)" : "rgba(255,255,255,0.1)"}`,
            }}
          >
            <motion.div
              animate={{ x: enabled ? 20 : 2 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="absolute top-0.5 size-3.5 rounded-full"
              style={{ background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }}
            />
          </button>
        </div>

        {/* Shake progress bar */}
        {enabled && shakeProgress > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="mt-2.5 pt-2.5"
            style={{ borderTop: "1px solid rgba(255,150,0,0.1)" }}
          >
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ rotate: [0, -15, 15, -15, 15, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >
                <Smartphone className="size-3.5" style={{ color: "#FF9500" }} />
              </motion.div>
              <span style={{ fontSize: 10, color: "#FF9500", fontWeight: 600 }}>
                Shake detected! {shakeProgress}/{maxShakes}
              </span>
              <div className="flex-1 flex gap-1">
                {Array.from({ length: maxShakes }).map((_, i) => (
                  <motion.div
                    key={i}
                    animate={i < shakeProgress ? { scale: [1, 1.3, 1] } : {}}
                    className="flex-1 h-1.5 rounded-full"
                    style={{
                      background: i < shakeProgress
                        ? "linear-gradient(90deg, #FF9500, #FF6B00)"
                        : "rgba(255,255,255,0.06)",
                    }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* Demo simulate button */}
        {enabled && (
          <button
            onClick={onSimulate}
            className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg"
            style={{
              background: "rgba(255,150,0,0.06)",
              border: "1px solid rgba(255,150,0,0.1)",
            }}
          >
            <Activity className="size-3" style={{ color: "rgba(255,150,0,0.5)" }} />
            <span style={{ fontSize: 9, color: "rgba(255,150,0,0.5)", fontWeight: 600 }}>
              Simulate Shake (Demo)
            </span>
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Shake SOS Confirmation Overlay ────────────────────────────
export function ShakeSOSOverlay({
  isVisible,
  onConfirm,
  onCancel,
}: {
  isVisible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!isVisible) { setCountdown(5); return; }
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onConfirm();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isVisible, onConfirm]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)" }}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="flex flex-col items-center gap-5 px-8"
          >
            {/* Pulsing warning */}
            <motion.div
              animate={{
                boxShadow: [
                  "0 0 0 0 rgba(255,150,0,0.4)",
                  "0 0 0 20px rgba(255,150,0,0)",
                  "0 0 0 0 rgba(255,150,0,0.4)",
                ],
              }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="size-20 rounded-full flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(255,150,0,0.2), rgba(255,45,85,0.2))",
                border: "2px solid rgba(255,150,0,0.4)",
              }}
            >
              <Vibrate className="size-10" style={{ color: "#FF9500" }} />
            </motion.div>

            <div className="text-center">
              <p className="text-white" style={{ fontSize: 20, fontWeight: 800 }}>
                Shake SOS Detected!
              </p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
                SOS will activate in {countdown} seconds
              </p>
            </div>

            {/* Countdown ring */}
            <div className="relative size-16">
              <svg className="size-16 -rotate-90" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                <motion.circle
                  cx="32" cy="32" r="28" fill="none" stroke="#FF9500" strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={175.9}
                  animate={{ strokeDashoffset: 175.9 * (1 - countdown / 5) }}
                  transition={{ duration: 1, ease: "linear" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-white" style={{ fontSize: 22, fontWeight: 800 }}>{countdown}</span>
              </div>
            </div>

            {/* Cancel button */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={onCancel}
              className="flex items-center gap-2 px-8 py-3 rounded-xl"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              <X className="size-4" style={{ color: "rgba(255,255,255,0.5)" }} />
              <span className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>
                I'm OK — Cancel
              </span>
            </motion.button>

            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", textAlign: "center" }}>
              False alarm? Tap cancel to stop SOS activation
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
