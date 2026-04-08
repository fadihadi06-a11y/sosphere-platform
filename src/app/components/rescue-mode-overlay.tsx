// ═══════════════════════════════════════════════════════════════
// Emergency Combat Mode — Rescue Mode Overlay Component
// Full-screen map with floating Live Rescue Card and action bar
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Heart,
  AlertCircle,
  Phone,
  MessageSquare,
  Check,
  X,
  Clock,
  Zap,
  Lock,
  Signal,
  Battery,
} from "lucide-react";
import {
  isRescueModeActive,
  getRescueEvent,
  getElapsedSeconds,
  deactivateRescueMode,
  onRescueModeChange,
  type RescueModeState,
  type RescueEvent,
} from "./rescue-mode-controller";

// ── Color Palette ──────────────────────────────────────────────
const COLORS = {
  darkBg: "#0a0e1a",      // Very dark navy
  darkPanel: "#111623",   // Slightly lighter for panels
  brightRed: "#ff2d2d",   // High-contrast red
  brightRedLight: "#ff4444",
  green: "#00c853",       // For "Mark Safe"
  blue: "#2196f3",        // For Call/SMS
  white: "#ffffff",
  textGray: "#e0e0e0",
  border: "rgba(255,45,45,0.3)",
  pulse: "rgba(255,45,45,0.15)",
};

// ── Types ──────────────────────────────────────────────────────

interface RescueModeOverlayProps {
  onMapContainerReady?: (container: HTMLDivElement | null) => void;
}

// ── Main Component ─────────────────────────────────────────────

export const RescueModeOverlay: React.FC<RescueModeOverlayProps> = ({ onMapContainerReady }) => {
  const [isActive, setIsActive] = useState(false);
  const [rescueEvent, setRescueEvent] = useState<RescueEvent | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(Date.now());
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [isLongPressingExit, setIsLongPressingExit] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Subscribe to rescue mode state changes
  useEffect(() => {
    const unsub = onRescueModeChange((state: RescueModeState) => {
      setIsActive(state === "RESCUE_ACTIVE");
      setRescueEvent(getRescueEvent());
      setLastUpdateTime(Date.now());
    });

    // Initial state
    setIsActive(isRescueModeActive());
    setRescueEvent(getRescueEvent());

    return unsub;
  }, []);

  // Update elapsed timer
  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      setElapsedSeconds(getElapsedSeconds());
      setLastUpdateTime(Date.now());
    }, 100);

    return () => clearInterval(interval);
  }, [isActive]);

  // Handle long-press for exit button
  const handleExitMouseDown = () => {
    setIsLongPressingExit(true);
    longPressTimerRef.current = setTimeout(() => {
      setExitConfirmOpen(true);
      setIsLongPressingExit(false);
    }, 2000);
  };

  const handleExitMouseUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    setIsLongPressingExit(false);
  };

  return (
    <AnimatePresence>
      {isActive && rescueEvent && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed inset-0 z-[9999] overflow-hidden"
          style={{ background: COLORS.darkBg }}
        >
          {/* Full-screen Map Container - 100% of viewport */}
          <MapContainer onContainerReady={onMapContainerReady} />

          {/* Top Alert Strip - Pulsing red banner */}
          <TopAlertBanner elapsedSeconds={elapsedSeconds} event={rescueEvent} />

          {/* Live Rescue Card - Top-right corner (or bottom on mobile) */}
          <LiveRescueCard event={rescueEvent} lastUpdateTime={lastUpdateTime} />

          {/* Bottom Action Bar - Floating center-bottom */}
          <BottomActionBar
            event={rescueEvent}
            isLongPressingExit={isLongPressingExit}
            onExitMouseDown={handleExitMouseDown}
            onExitMouseUp={handleExitMouseUp}
          />

          {/* Exit Confirmation Modal */}
          <AnimatePresence>
            {exitConfirmOpen && (
              <ExitConfirmationModal
                onConfirm={() => {
                  setExitConfirmOpen(false);
                  deactivateRescueMode();
                }}
                onCancel={() => setExitConfirmOpen(false)}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ── Subcomponents ──────────────────────────────────────────────

interface TopAlertBannerProps {
  event: RescueEvent;
  elapsedSeconds: number;
}

function TopAlertBanner({ event, elapsedSeconds }: TopAlertBannerProps) {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timeStr = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed top-0 left-0 right-0 h-12 flex items-center justify-center z-[10001]"
      style={{
        background: COLORS.brightRed,
      }}
    >
      {/* Pulsing animation */}
      <motion.div
        animate={{ opacity: [1, 0.8, 1] }}
        transition={{ duration: 1, repeat: Infinity }}
        className="flex items-center justify-center gap-3 text-sm font-bold"
        style={{ color: COLORS.white }}
      >
        <span>RESCUE ACTIVE</span>
        <span>•</span>
        <span>{event.employeeName}</span>
        <span>•</span>
        <span>{event.zone}</span>
        <span>•</span>
        <span className="font-mono">{timeStr}</span>
      </motion.div>
    </motion.div>
  );
}

interface MapContainerProps {
  onContainerReady?: (container: HTMLDivElement | null) => void;
}

function MapContainer({ onContainerReady }: MapContainerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    onContainerReady?.(containerRef.current);
  }, [onContainerReady]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      ref={containerRef}
      id="rescue-map-container"
      className="fixed inset-0 flex items-center justify-center overflow-hidden"
      style={{
        background: COLORS.darkPanel,
      }}
      aria-label="Emergency map display"
    >
      <div className="text-center">
        <MapPin size={48} style={{ color: COLORS.brightRed, margin: "0 auto 16px" }} />
        <p style={{ color: COLORS.textGray, fontSize: 14 }}>
          Map Portal Ready
        </p>
        <p style={{ color: "rgba(224, 224, 224, 0.4)", fontSize: 12, marginTop: 8 }}>
          Leaflet map will render here
        </p>
      </div>
    </motion.div>
  );
}

interface LiveRescueCardProps {
  event: RescueEvent;
  lastUpdateTime: number;
}

function LiveRescueCard({ event, lastUpdateTime }: LiveRescueCardProps) {
  const getAccuracyBadge = (accuracy?: number) => {
    if (!accuracy) return { color: "#999", label: "?" };
    if (accuracy < 5) return { color: COLORS.green, label: "High" };
    if (accuracy < 20) return { color: "#ffb300", label: "Med" };
    return { color: COLORS.brightRed, label: "Low" };
  };

  const accuracyBadge = getAccuracyBadge(event.accuracy);
  const formattedUpdate = new Date(lastUpdateTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, x: 20 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="fixed top-20 right-4 w-80 rounded-xl border-2 p-4 flex flex-col gap-4 z-[10000] md:bottom-24 md:right-4 md:top-auto md:w-full md:mx-4 md:max-w-sm lg:top-20 lg:bottom-auto"
      style={{
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(40px)",
        borderColor: COLORS.border,
      }}
      role="region"
      aria-label="Live rescue information card"
    >
      {/* Employee Info */}
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-lg bg-gray-600 flex items-center justify-center" style={{ background: "rgba(200, 200, 200, 0.2)" }}>
          <span style={{ color: COLORS.textGray, fontSize: 24 }}>👤</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: COLORS.white }}>
            {event.employeeName}
          </p>
          <p className="text-xs" style={{ color: COLORS.textGray }}>
            {event.zone}
          </p>
        </div>
      </div>

      {/* GPS Coordinates */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <MapPin size={14} style={{ color: COLORS.brightRed }} />
          <span className="text-xs font-bold" style={{ color: COLORS.white, textTransform: "uppercase" }}>
            Location
          </span>
        </div>
        {event.lastGPS ? (
          <>
            <div className="text-xs font-mono" style={{ color: COLORS.white }}>
              <p>{event.lastGPS.lat.toFixed(6)}, {event.lastGPS.lng.toFixed(6)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-bold px-2 py-1 rounded"
                style={{ background: accuracyBadge.color, color: "white" }}
              >
                ±{event.accuracy?.toFixed(0) || "?"} m
              </span>
              <span className="text-xs" style={{ color: COLORS.textGray }}>
                Accuracy
              </span>
            </div>
          </>
        ) : (
          <p className="text-xs" style={{ color: COLORS.textGray }}>
            GPS unavailable
          </p>
        )}
      </div>

      {/* Medical Info */}
      <div className="space-y-2 pt-2 border-t" style={{ borderColor: COLORS.border }}>
        <div className="flex items-center gap-2 mb-2">
          <Heart size={14} style={{ color: COLORS.brightRed }} />
          <span className="text-xs font-bold" style={{ color: COLORS.white, textTransform: "uppercase" }}>
            Medical
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {event.bloodType && (
            <span
              className="text-xs px-2 py-1 rounded font-bold"
              style={{ background: "rgba(255,45,45,0.2)", color: COLORS.brightRed }}
            >
              {event.bloodType}
            </span>
          )}
          {event.allergies && (
            <span
              className="text-xs px-2 py-1 rounded"
              style={{ background: "rgba(255,200,0,0.2)", color: "#ffc800" }}
            >
              Allergies
            </span>
          )}
          {event.medicalConditions && event.medicalConditions.length > 0 && event.medicalConditions.map((cond, i) => (
            <span
              key={i}
              className="text-xs px-2 py-1 rounded"
              style={{ background: "rgba(100,200,255,0.2)", color: "#64c8ff" }}
            >
              {cond}
            </span>
          ))}
        </div>
      </div>

      {/* Device Status */}
      <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: COLORS.border }}>
        {event.batteryLevel !== undefined && (
          <div className="flex items-center gap-1">
            <Battery size={14} style={{ color: event.batteryLevel < 20 ? COLORS.brightRed : COLORS.textGray }} />
            <span className="text-xs" style={{ color: event.batteryLevel < 20 ? COLORS.brightRed : COLORS.textGray }}>
              {event.batteryLevel}%
            </span>
          </div>
        )}
        {event.signalStrength && (
          <div className="flex items-center gap-1">
            <Signal size={14} style={{ color: COLORS.textGray }} />
            <span className="text-xs" style={{ color: COLORS.textGray }}>
              {event.signalStrength}
            </span>
          </div>
        )}
      </div>

      {/* Last Updated */}
      <div className="text-xs" style={{ color: COLORS.textGray, textAlign: "center", paddingTop: 8, borderTop: `1px solid ${COLORS.border}` }}>
        Last updated: {formattedUpdate}
      </div>
    </motion.div>
  );
}

interface BottomActionBarProps {
  event: RescueEvent;
  isLongPressingExit: boolean;
  onExitMouseDown: () => void;
  onExitMouseUp: () => void;
}

function BottomActionBar({ event, isLongPressingExit, onExitMouseDown, onExitMouseUp }: BottomActionBarProps) {
  const handleDispatchHelp = () => {
    if (import.meta.env.DEV) console.log("[RescueMode] Dispatch Help clicked for:", event.employeeName);
  };

  const handleMarkSafe = () => {
    if (import.meta.env.DEV) console.log("[RescueMode] Mark Safe clicked for:", event.employeeName);
  };

  const handleCall = () => {
    if (import.meta.env.DEV) console.log("[RescueMode] Call clicked for:", event.employeeName);
  };

  const handleSMS = () => {
    if (import.meta.env.DEV) console.log("[RescueMode] SMS clicked for:", event.employeeName);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[10000] flex items-center gap-3 px-4 py-3 rounded-full"
      style={{
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(40px)",
        borderColor: COLORS.border,
        border: `1px solid ${COLORS.border}`,
      }}
      role="toolbar"
      aria-label="Emergency action buttons"
    >
      {/* Dispatch Help */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleDispatchHelp}
        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm transition-all"
        style={{
          background: COLORS.brightRed,
          color: COLORS.white,
        }}
        aria-label="Dispatch help to emergency"
      >
        <Zap size={16} />
        <span>Dispatch</span>
      </motion.button>

      {/* Mark Safe */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleMarkSafe}
        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm transition-all"
        style={{
          background: COLORS.green,
          color: COLORS.white,
        }}
        aria-label="Mark employee as safe"
      >
        <Check size={16} />
        <span>Safe</span>
      </motion.button>

      {/* Call */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleCall}
        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm transition-all"
        style={{
          background: COLORS.blue,
          color: COLORS.white,
        }}
        aria-label="Call employee"
      >
        <Phone size={16} />
        <span>Call</span>
      </motion.button>

      {/* SMS */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleSMS}
        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm transition-all"
        style={{
          background: COLORS.blue,
          color: COLORS.white,
        }}
        aria-label="Send SMS"
      >
        <MessageSquare size={16} />
        <span>SMS</span>
      </motion.button>

      {/* Exit Combat Mode - with long-press */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onMouseDown={onExitMouseDown}
        onMouseUp={onExitMouseUp}
        onMouseLeave={onExitMouseUp}
        onTouchStart={onExitMouseDown}
        onTouchEnd={onExitMouseUp}
        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm transition-all relative"
        style={{
          background: isLongPressingExit ? "rgba(255,45,45,0.8)" : "rgba(255,45,45,0.2)",
          color: COLORS.brightRed,
          border: `1px solid ${COLORS.brightRed}`,
        }}
        aria-label="Exit combat mode (long-press 2 seconds)"
      >
        <Lock size={16} />
        <span>Exit</span>
        {isLongPressingExit && (
          <motion.div
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 2 }}
            className="absolute inset-0 rounded-full opacity-20"
            style={{ background: COLORS.brightRed }}
          />
        )}
      </motion.button>
    </motion.div>
  );
}


interface ExitConfirmationModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

function ExitConfirmationModal({ onConfirm, onCancel }: ExitConfirmationModalProps) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      role="dialog"
      aria-label="Exit confirmation"
      aria-modal="true"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="rounded-lg p-6 max-w-sm border-2"
        style={{
          background: COLORS.darkPanel,
          borderColor: COLORS.brightRed,
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle size={20} style={{ color: COLORS.brightRed }} />
          <h3 className="text-lg font-bold" style={{ color: COLORS.white }}>
            Exit Rescue Mode?
          </h3>
        </div>

        <p className="mb-6" style={{ color: COLORS.textGray, fontSize: 14 }}>
          Are you sure? You can re-activate if needed.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg font-semibold"
            style={{
              background: "transparent",
              color: COLORS.white,
              border: `1px solid ${COLORS.border}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(224,224,224,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            Stay
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-lg font-semibold"
            style={{
              background: COLORS.brightRed,
              color: COLORS.darkBg,
              border: `1px solid ${COLORS.brightRed}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.brightRedLight;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = COLORS.brightRed;
            }}
          >
            Exit
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default RescueModeOverlay;
