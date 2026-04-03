// ═══════════════════════════════════════════════════════════════
// FIX E: Post-Incident Monitoring Mode Banner
// ═══════════════════════════════════════════════════════════════
// Shows on employee mobile app after "minor" incident resolution
// Reminds employee to check in every 30 minutes
// Auto-escalates to admin if check-in missed
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Clock, CheckCircle, AlertTriangle } from "lucide-react";

interface MonitoringModeBannerProps {
  checkInInterval: number; // minutes
  nextCheckInTime: number; // timestamp
  monitorUntil: number; // timestamp
  onCheckIn: () => void;
}

export function MonitoringModeBanner({
  checkInInterval,
  nextCheckInTime,
  monitorUntil,
  onCheckIn,
}: MonitoringModeBannerProps) {
  const [timeLeft, setTimeLeft] = useState(0);
  const [isOverdue, setIsOverdue] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const left = Math.max(0, nextCheckInTime - now);
      setTimeLeft(Math.floor(left / 1000));
      setIsOverdue(left === 0);
    }, 1000);

    return () => clearInterval(interval);
  }, [nextCheckInTime]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  // Auto-dismiss if monitoring period ended
  if (Date.now() > monitorUntil) {
    return null;
  }

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="px-5 py-4 mb-4 rounded-2xl"
      style={{
        background: isOverdue
          ? "linear-gradient(135deg, rgba(255,45,85,0.15), rgba(255,45,85,0.10))"
          : "linear-gradient(135deg, rgba(255,149,0,0.15), rgba(255,149,0,0.10))",
        border: `2px solid ${isOverdue ? "rgba(255,45,85,0.4)" : "rgba(255,149,0,0.4)"}`,
        boxShadow: `0 4px 20px ${isOverdue ? "rgba(255,45,85,0.3)" : "rgba(255,149,0,0.3)"}`,
      }}
    >
      <div className="flex items-start gap-3 mb-3">
        <motion.div
          animate={{ scale: isOverdue ? [1, 1.1, 1] : 1 }}
          transition={{ duration: 1, repeat: isOverdue ? Infinity : 0 }}
          className="p-2 rounded-full"
          style={{
            background: isOverdue ? "rgba(255,45,85,0.2)" : "rgba(255,149,0,0.2)",
          }}
        >
          {isOverdue ? (
            <AlertTriangle className="size-5" style={{ color: "#FF2D55" }} />
          ) : (
            <Clock className="size-5" style={{ color: "#FF9500" }} />
          )}
        </motion.div>
        <div className="flex-1">
          <h3 style={{
            fontSize: 15,
            fontWeight: 700,
            color: isOverdue ? "#FF2D55" : "#FF9500",
            marginBottom: 3,
          }}>
            {isOverdue ? "⚠️ Check-In Overdue" : "📋 Post-Incident Monitoring"}
          </h3>
          <p style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.7)",
            lineHeight: 1.5,
          }}>
            {isOverdue
              ? "You missed your check-in. Press 'I'm OK' now or your supervisor will be alerted."
              : `Your supervisor is monitoring you after the recent incident. Check in every ${checkInInterval} minutes.`
            }
          </p>
        </div>
      </div>

      {/* Countdown */}
      {!isOverdue && (
        <div className="mb-3 px-4 py-2 rounded-xl" style={{
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              Next check-in in:
            </span>
            <span style={{
              fontSize: 16,
              fontWeight: 800,
              color: timeLeft < 60 ? "#FF9500" : "#00C8E0",
              fontFamily: "monospace",
            }}>
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
          </div>
        </div>
      )}

      {/* Check-In Button */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onCheckIn}
        className="w-full px-4 py-3 rounded-xl"
        style={{
          background: isOverdue
            ? "linear-gradient(135deg, #FF2D55, #D9193D)"
            : "linear-gradient(135deg, #00C853, #00A843)",
          boxShadow: isOverdue
            ? "0 4px 16px rgba(255,45,85,0.4)"
            : "0 4px 16px rgba(0,200,83,0.4)",
        }}
      >
        <div className="flex items-center justify-center gap-2">
          <CheckCircle className="size-5" style={{ color: "#fff" }} />
          <span style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#fff",
          }}>
            {isOverdue ? "Check In NOW" : "I'm OK — Check In"}
          </span>
        </div>
      </motion.button>

      {/* Monitoring ends */}
      <p style={{
        fontSize: 10,
        color: "rgba(255,255,255,0.4)",
        textAlign: "center",
        marginTop: 8,
      }}>
        Monitoring ends in {Math.floor((monitorUntil - Date.now()) / 60000)} minutes
      </p>
    </motion.div>
  );
}
