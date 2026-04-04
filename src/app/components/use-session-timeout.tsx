// ═══════════════════════════════════════════════════════════════
// SOSphere — Session Timeout Hook (CRITICAL FIX 3)
// ─────────────────────────────────────────────────────────────
// Real session timeout that:
//  1. Resets on any user interaction (mouse, keyboard, click, touch)
//  2. NEVER expires when active emergencies exist (life-safety override)
//  3. Shows a 60-second warning before logout
//  4. Calls onLogout() when timer reaches zero
//
// SAFETY INVARIANT:
//   If emergencies.filter(e => e.status === "active").length > 0,
//   the timer is SUSPENDED. A person could die if we auto-logout
//   an admin who is managing an active emergency.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Clock, AlertTriangle, X, Shield } from "lucide-react";

// ── Parse timeout string to milliseconds ──────────────────────
function parseTimeoutMs(timeout: string): number {
  const match = timeout.match(/^(\d+)(m|h)$/);
  if (!match) return 30 * 60 * 1000; // default 30m
  const [, num, unit] = match;
  const val = parseInt(num, 10);
  return unit === "h" ? val * 60 * 60 * 1000 : val * 60 * 1000;
}

// ── Warning appears 60 seconds before logout ──────────────────
const WARNING_SECONDS = 60;

interface UseSessionTimeoutOptions {
  /** Timeout string: "15m" | "30m" | "1h" | "4h" */
  timeout: string;
  /** Number of active (unresolved) emergencies — timer suspends if > 0 */
  activeEmergencyCount: number;
  /** Called when session expires */
  onLogout: () => void;
  /** Whether the hook is enabled (only on dashboard) */
  enabled?: boolean;
}

export interface SessionTimeoutState {
  /** Seconds remaining before logout (-1 = no warning) */
  warningSecondsLeft: number;
  /** Whether the warning banner is visible */
  showWarning: boolean;
  /** Whether timeout is suspended due to active emergencies */
  isSuspended: boolean;
  /** Reset the timer manually */
  resetTimer: () => void;
}

export function useSessionTimeout({
  timeout,
  activeEmergencyCount,
  onLogout,
  enabled = true,
}: UseSessionTimeoutOptions): SessionTimeoutState {
  const timeoutMs = parseTimeoutMs(timeout);
  const [showWarning, setShowWarning] = useState(false);
  const [warningSecondsLeft, setWarningSecondsLeft] = useState(-1);

  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isSuspended = activeEmergencyCount > 0;

  // ── Reset activity timestamp ──────────────────────────────────
  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
    setWarningSecondsLeft(-1);
    if (warningTimerRef.current) {
      clearInterval(warningTimerRef.current);
      warningTimerRef.current = null;
    }
  }, []);

  // ── SAFETY: If emergencies start mid-countdown, kill warning immediately ──
  useEffect(() => {
    if (isSuspended && showWarning) {
      resetTimer(); // clears warning + resets lastActivity
    }
  }, [isSuspended, showWarning, resetTimer]);

  // ── Listen for user interactions ──────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    const handler = () => {
      lastActivityRef.current = Date.now();
      // If warning is showing and user interacts, dismiss it
      if (warningTimerRef.current) {
        resetTimer();
      }
    };

    events.forEach(ev => window.addEventListener(ev, handler, { passive: true }));
    return () => {
      events.forEach(ev => window.removeEventListener(ev, handler));
    };
  }, [enabled, resetTimer]);

  // ── Main check interval — runs every 5 seconds ────────────────
  useEffect(() => {
    if (!enabled) return;

    checkTimerRef.current = setInterval(() => {
      // SAFETY: Never expire during active emergencies
      if (isSuspended) {
        lastActivityRef.current = Date.now(); // keep resetting
        return;
      }

      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = timeoutMs - elapsed;

      // Warning phase: 60 seconds before logout
      if (remaining <= WARNING_SECONDS * 1000 && remaining > 0 && !warningTimerRef.current) {
        setShowWarning(true);
        setWarningSecondsLeft(Math.ceil(remaining / 1000));

        // Start countdown
        warningTimerRef.current = setInterval(() => {
          const now = Date.now();
          const secsLeft = Math.ceil((timeoutMs - (now - lastActivityRef.current)) / 1000);

          if (secsLeft <= 0) {
            // TIME'S UP — logout
            if (warningTimerRef.current) clearInterval(warningTimerRef.current);
            warningTimerRef.current = null;
            setShowWarning(false);
            onLogout();
          } else {
            setWarningSecondsLeft(secsLeft);
          }
        }, 1000);
      }
    }, 5000);

    return () => {
      if (checkTimerRef.current) clearInterval(checkTimerRef.current);
      if (warningTimerRef.current) clearInterval(warningTimerRef.current);
    };
  }, [enabled, timeoutMs, isSuspended, onLogout]);

  return { warningSecondsLeft, showWarning, isSuspended, resetTimer };
}

// ═══════════════════════════════════════════════════════════════
// Session Timeout Warning Banner (renders at top of dashboard)
// ═══════════════════════════════════════════════════════════════

export function SessionTimeoutWarning({
  secondsLeft,
  isVisible,
  isSuspended,
  onStayLoggedIn,
}: {
  secondsLeft: number;
  isVisible: boolean;
  isSuspended: boolean;
  onStayLoggedIn: () => void;
}) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center px-4 py-3"
          style={{
            background: "linear-gradient(135deg, rgba(255,45,85,0.95), rgba(200,30,60,0.95))",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <div className="flex items-center gap-4 max-w-2xl w-full">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-white" />
              <span className="text-white" style={{ fontSize: 14, fontWeight: 700, fontFamily: "'Outfit', sans-serif" }}>
                Session Expiring
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-white/70" />
              <span className="text-white/90" style={{ fontSize: 13, fontFamily: "'Outfit', sans-serif" }}>
                Auto-logout in <span style={{ fontWeight: 700, color: "#fff" }}>{secondsLeft}s</span>
              </span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <button
                onClick={onStayLoggedIn}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg transition-all"
                style={{
                  background: "rgba(255,255,255,0.2)",
                  border: "1px solid rgba(255,255,255,0.3)",
                  cursor: "pointer",
                }}
              >
                <Shield className="size-3.5 text-white" />
                <span className="text-white" style={{ fontSize: 12, fontWeight: 700, fontFamily: "'Outfit', sans-serif" }}>
                  Stay Logged In
                </span>
              </button>
              <button onClick={onStayLoggedIn} style={{ cursor: "pointer" }}>
                <X className="size-4 text-white/60" />
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Emergency suspension — no visible indicator; timer silently pauses */}
    </AnimatePresence>
  );
}