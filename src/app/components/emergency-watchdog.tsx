// ═══════════════════════════════════════════════════════════════
// SOSphere — Emergency Watchdog (FIX 3: Auto-Escalation Timer)
// ───────────────────────────────────────────────────────────────
// Monitors unattended emergencies and triggers full-screen alerts
// Runs every 30 seconds — no Supabase required (localStorage only)
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Phone, Siren } from "lucide-react";

export interface Emergency {
  id: string;
  employeeName: string;
  employeeId: string;
  zone: string;
  severity: "critical" | "high" | "medium" | "low";
  timestamp: number;
  status: "pending" | "active" | "resolved";
  actionsLog?: any[];
}

interface EmergencyWatchdogProps {
  emergencies: Emergency[];
  onTakeAction: (emergencyId: string) => void;
  onCall997: (emergencyId: string) => void;
}

const UNATTENDED_THRESHOLD = 5 * 60 * 1000; // 5 minutes in milliseconds
const CHECK_INTERVAL = 30 * 1000; // Check every 30 seconds

export function EmergencyWatchdog({ emergencies, onTakeAction, onCall997 }: EmergencyWatchdogProps) {
  const [unattendedEmergency, setUnattendedEmergency] = useState<Emergency | null>(null);

  useEffect(() => {
    // Check immediately on mount
    checkForUnattended();

    // Then check every 30 seconds
    const interval = setInterval(() => {
      checkForUnattended();
    }, CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [emergencies]);

  const checkForUnattended = () => {
    const now = Date.now();
    
    // Find emergencies that are active for 5+ minutes with NO admin action
    const unattended = emergencies.find(emg => {
      const elapsed = now - emg.timestamp;
      const hasActions = emg.actionsLog && emg.actionsLog.length > 0;
      
      return (
        emg.status === "active" &&
        elapsed >= UNATTENDED_THRESHOLD &&
        !hasActions
      );
    });

    if (unattended && (!unattendedEmergency || unattendedEmergency.id !== unattended.id)) {
      setUnattendedEmergency(unattended);
    } else if (!unattended && unattendedEmergency) {
      setUnattendedEmergency(null);
    }
  };

  const handleDismiss = () => {
    // Cannot dismiss — must take action
    // This function intentionally does nothing
  };

  const handleTakeAction = () => {
    if (unattendedEmergency) {
      onTakeAction(unattendedEmergency.id);
      setUnattendedEmergency(null);
    }
  };

  const handleCall997 = () => {
    if (unattendedEmergency) {
      onCall997(unattendedEmergency.id);
      setUnattendedEmergency(null);
    }
  };

  if (!unattendedEmergency) return null;

  const elapsed = Date.now() - unattendedEmergency.timestamp;
  const minutesElapsed = Math.floor(elapsed / 60000);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[99999] flex items-center justify-center"
        style={{
          background: "rgba(255,45,85,0.95)",
          backdropFilter: "blur(8px)",
          fontFamily: "'Outfit', sans-serif",
        }}
      >
        <div className="relative max-w-md w-full mx-4">
          {/* Pulsing danger icon */}
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.8, 1, 0.8],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="flex justify-center mb-6"
          >
            <div
              className="size-24 rounded-full flex items-center justify-center"
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "3px solid rgba(255,255,255,0.5)",
              }}
            >
              <Siren className="size-12 text-white" />
            </div>
          </motion.div>

          {/* Alert text */}
          <div className="text-center mb-8">
            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              style={{
                fontSize: 32,
                fontWeight: 900,
                color: "white",
                marginBottom: 12,
                textShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              ⚠️ EMERGENCY UNATTENDED
            </motion.h1>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "rgba(255,255,255,0.9)",
                marginBottom: 4,
              }}
            >
              {minutesElapsed} MINUTES
            </motion.p>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              style={{
                fontSize: 16,
                color: "rgba(255,255,255,0.8)",
                lineHeight: 1.6,
              }}
            >
              <strong>{unattendedEmergency.employeeName}</strong> is waiting for help
            </motion.p>
          </div>

          {/* Emergency details */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="p-5 rounded-2xl mb-6"
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "2px solid rgba(255,255,255,0.3)",
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginBottom: 2 }}>ZONE</p>
                <p style={{ fontSize: 15, fontWeight: 700, color: "white" }}>{unattendedEmergency.zone}</p>
              </div>
              <div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginBottom: 2 }}>SEVERITY</p>
                <p
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "white",
                    textTransform: "uppercase",
                  }}
                >
                  {unattendedEmergency.severity}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Action buttons */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="space-y-3"
          >
            <button
              onClick={handleTakeAction}
              className="w-full py-5 rounded-2xl font-bold text-lg transition-transform active:scale-95"
              style={{
                background: "white",
                color: "#FF2D55",
                boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              }}
            >
              Take Action Now
            </button>

            <button
              onClick={handleCall997}
              className="w-full py-5 rounded-2xl font-bold text-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
              style={{
                background: "rgba(255,255,255,0.15)",
                color: "white",
                border: "2px solid rgba(255,255,255,0.4)",
              }}
            >
              <Phone className="size-5" />
              Call 997 Now
            </button>
          </motion.div>

          {/* Warning notice */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-center mt-6"
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.7)",
              lineHeight: 1.6,
            }}
          >
            This alert cannot be dismissed without taking an action.
            <br />
            <strong>Worker safety is your responsibility.</strong>
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
