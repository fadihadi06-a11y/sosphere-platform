// ═══════════════════════════════════════════════════════════════
// Emergency Warp — Rescue Mode Overlay Component
// High-contrast UI for admin during active SOS emergency
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  MapPin,
  Heart,
  AlertCircle,
  Phone,
  MessageSquare,
  Radio,
  Check,
  X,
  Clock,
  Zap,
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
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  // Subscribe to rescue mode state changes
  useEffect(() => {
    const unsub = onRescueModeChange((state: RescueModeState) => {
      setIsActive(state === "RESCUE_ACTIVE");
      setRescueEvent(getRescueEvent());
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
    }, 100);

    return () => clearInterval(interval);
  }, [isActive]);

  return (
    <AnimatePresence>
      {isActive && rescueEvent && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed inset-0 z-[9999] overflow-hidden"
          style={{ background: COLORS.darkBg }}
        >
          {/* Layout Container */}
          <div className="w-full h-full flex flex-col">
            {/* Top Alert Banner */}
            <TopAlertBanner elapsedSeconds={elapsedSeconds} event={rescueEvent} />

            {/* Main Content Area */}
            <div className="flex-1 flex gap-3 p-4 overflow-hidden">
              {/* Map Container (70%) */}
              <div className="flex-1 flex flex-col">
                <MapContainer onContainerReady={onMapContainerReady} />
              </div>

              {/* Right Sidebar (30%) */}
              <div className="w-[30%] flex flex-col gap-3 overflow-hidden md:hidden lg:flex">
                <MedicalIDCard event={rescueEvent} />
                <GPSCoordinates event={rescueEvent} />
                <ActionButtons event={rescueEvent} onExit={() => setExitConfirmOpen(true)} />
              </div>
            </div>

            {/* Mobile Stack - Visible on smaller screens */}
            <div className="hidden md:flex lg:hidden flex-col gap-3 p-4 max-h-1/3 overflow-y-auto">
              <MedicalIDCard event={rescueEvent} />
              <GPSCoordinates event={rescueEvent} />
              <div className="flex gap-2">
                <ActionButtons event={rescueEvent} onExit={() => setExitConfirmOpen(true)} />
              </div>
            </div>

            {/* Bottom Exit Bar */}
            <BottomExitBar
              onExit={() => setExitConfirmOpen(true)}
              elapsedSeconds={elapsedSeconds}
            />
          </div>

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
      className="w-full border-b-2 p-4"
      style={{
        background: `linear-gradient(90deg, ${COLORS.darkPanel}, rgba(255,45,45,0.05))`,
        borderColor: COLORS.brightRed,
      }}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Pulsing Alert */}
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [1, 0.7, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="flex items-center gap-3"
        >
          <div className="size-4 rounded-full" style={{ background: COLORS.brightRed }} />
          <span
            className="text-sm font-bold tracking-wider"
            style={{ color: COLORS.brightRed, textTransform: "uppercase" }}
          >
            🚨 SOS ACTIVE
          </span>
        </motion.div>

        {/* Employee Name & Role */}
        <div className="flex-1">
          <p className="text-lg font-bold" style={{ color: COLORS.white }}>
            {event.employeeName}
          </p>
          <p className="text-xs" style={{ color: COLORS.textGray }}>
            {event.zone}
          </p>
        </div>

        {/* Elapsed Timer */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: COLORS.darkPanel, border: `1px solid ${COLORS.border}` }}>
          <Clock size={16} style={{ color: COLORS.brightRed }} />
          <span className="font-mono font-bold text-lg" style={{ color: COLORS.brightRed }}>
            {timeStr}
          </span>
        </div>
      </div>
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
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      ref={containerRef}
      id="rescue-map-container"
      className="flex-1 rounded-xl border-2 overflow-hidden flex items-center justify-center"
      style={{
        background: COLORS.darkPanel,
        borderColor: COLORS.border,
        minHeight: "100%",
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

interface MedicalIDCardProps {
  event: RescueEvent;
}

function MedicalIDCard({ event }: MedicalIDCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="rounded-lg border-2 p-4 flex flex-col gap-3"
      style={{
        background: COLORS.darkPanel,
        borderColor: COLORS.border,
      }}
      role="region"
      aria-label="Medical information"
    >
      <div className="flex items-center gap-2">
        <Heart size={18} style={{ color: COLORS.brightRed }} />
        <span className="text-sm font-bold" style={{ color: COLORS.white, textTransform: "uppercase" }}>
          Medical ID
        </span>
      </div>

      <div className="space-y-2">
        {/* Blood Type */}
        {event.bloodType && (
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: COLORS.textGray }}>
              Blood Type
            </span>
            <span className="text-sm font-bold" style={{ color: COLORS.brightRed }}>
              {event.bloodType}
            </span>
          </div>
        )}

        {/* Allergies */}
        {event.allergies && (
          <div>
            <span className="text-xs" style={{ color: COLORS.textGray }}>
              Allergies
            </span>
            <p className="text-xs mt-1" style={{ color: COLORS.white }}>
              {event.allergies}
            </p>
          </div>
        )}

        {/* Medical Conditions */}
        {event.medicalConditions && event.medicalConditions.length > 0 && (
          <div>
            <span className="text-xs" style={{ color: COLORS.textGray }}>
              Conditions
            </span>
            <div className="flex flex-wrap gap-2 mt-1">
              {event.medicalConditions.map((cond, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: "rgba(255,45,45,0.1)",
                    color: COLORS.brightRed,
                  }}
                >
                  {cond}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Emergency Contacts */}
        {event.emergencyContacts && event.emergencyContacts.length > 0 && (
          <div>
            <span className="text-xs" style={{ color: COLORS.textGray }}>
              Emergency Contacts
            </span>
            <div className="space-y-1 mt-1">
              {event.emergencyContacts.map((contact, i) => (
                <div key={i} className="text-xs" style={{ color: COLORS.white }}>
                  <p className="font-semibold">{contact.name}</p>
                  <p style={{ color: COLORS.textGray }}>{contact.phone}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!event.bloodType && !event.allergies && !event.medicalConditions?.length && !event.emergencyContacts?.length && (
          <p className="text-xs" style={{ color: COLORS.textGray }}>
            No medical data recorded
          </p>
        )}
      </div>
    </motion.div>
  );
}

interface GPSCoordinatesProps {
  event: RescueEvent;
}

function GPSCoordinates({ event }: GPSCoordinatesProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="rounded-lg border-2 p-4 flex flex-col gap-3"
      style={{
        background: COLORS.darkPanel,
        borderColor: COLORS.border,
      }}
      role="region"
      aria-label="GPS coordinates"
    >
      <div className="flex items-center gap-2">
        <MapPin size={18} style={{ color: COLORS.brightRed }} />
        <span className="text-sm font-bold" style={{ color: COLORS.white, textTransform: "uppercase" }}>
          GPS Coordinates
        </span>
      </div>

      <div className="space-y-2">
        {event.lastGPS ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: COLORS.textGray }}>
                Latitude
              </span>
              <span className="text-sm font-mono" style={{ color: COLORS.white }}>
                {event.lastGPS.lat.toFixed(6)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: COLORS.textGray }}>
                Longitude
              </span>
              <span className="text-sm font-mono" style={{ color: COLORS.white }}>
                {event.lastGPS.lng.toFixed(6)}
              </span>
            </div>
            {event.accuracy && (
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: COLORS.textGray }}>
                  Accuracy
                </span>
                <span className="text-sm" style={{ color: COLORS.brightRed }}>
                  ±{event.accuracy.toFixed(0)}m
                </span>
              </div>
            )}
            {event.lastGPS.address && (
              <div className="mt-2 p-2 rounded" style={{ background: "rgba(255,45,45,0.05)", borderLeft: `2px solid ${COLORS.brightRed}` }}>
                <p className="text-xs" style={{ color: COLORS.textGray }}>
                  {event.lastGPS.address}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs" style={{ color: COLORS.textGray }}>
            GPS data not available
          </p>
        )}

        {/* Device Status */}
        {(event.batteryLevel !== undefined || event.signalStrength) && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: COLORS.border }}>
            {event.batteryLevel !== undefined && (
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs" style={{ color: COLORS.textGray }}>
                  Battery
                </span>
                <span className="text-sm font-bold" style={{ color: event.batteryLevel < 20 ? COLORS.brightRed : COLORS.white }}>
                  {event.batteryLevel}%
                </span>
              </div>
            )}
            {event.signalStrength && (
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: COLORS.textGray }}>
                  Signal
                </span>
                <span className="text-sm" style={{ color: COLORS.white }}>
                  {event.signalStrength}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

interface ActionButtonsProps {
  event: RescueEvent;
  onExit: () => void;
}

function ActionButtons({ event, onExit }: ActionButtonsProps) {
  const handleMarkSafe = () => {
    if (import.meta.env.DEV) console.log("[RescueMode] Mark Safe clicked for:", event.employeeName);
    // TODO: Emit event to update status
  };

  const handleDispatchHelp = () => {
    if (import.meta.env.DEV) console.log("[RescueMode] Dispatch Help clicked for:", event.employeeName);
    // TODO: Emit event to dispatch team
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.25 }}
      className="flex flex-col gap-2"
      role="toolbar"
      aria-label="Emergency action buttons"
    >
      {/* Primary Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleDispatchHelp}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all"
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
          aria-label="Dispatch help to emergency"
        >
          <Zap size={16} />
          <span>Dispatch Help</span>
        </button>

        <button
          onClick={handleMarkSafe}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all"
          style={{
            background: "transparent",
            color: COLORS.white,
            border: `1px solid ${COLORS.border}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(0,200,83,0.5)";
            e.currentTarget.style.color = "rgba(0,200,83,1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = COLORS.border;
            e.currentTarget.style.color = COLORS.white;
          }}
          aria-label="Mark employee as safe"
        >
          <Check size={16} />
          <span>Mark Safe</span>
        </button>
      </div>

      {/* Communication Actions */}
      <div className="flex gap-2 text-xs">
        <button
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg transition-all"
          style={{
            background: "rgba(255,45,45,0.1)",
            color: COLORS.brightRed,
            border: `1px solid ${COLORS.border}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,45,45,0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,45,45,0.1)";
          }}
          aria-label="Call employee"
        >
          <Phone size={14} />
          Call
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg transition-all"
          style={{
            background: "rgba(255,45,45,0.1)",
            color: COLORS.brightRed,
            border: `1px solid ${COLORS.border}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,45,45,0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,45,45,0.1)";
          }}
          aria-label="Send SMS"
        >
          <MessageSquare size={14} />
          SMS
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg transition-all"
          style={{
            background: "rgba(255,45,45,0.1)",
            color: COLORS.brightRed,
            border: `1px solid ${COLORS.border}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,45,45,0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,45,45,0.1)";
          }}
          aria-label="Radio communication"
        >
          <Radio size={14} />
          Radio
        </button>
      </div>
    </motion.div>
  );
}

interface BottomExitBarProps {
  onExit: () => void;
  elapsedSeconds: number;
}

function BottomExitBar({ onExit, elapsedSeconds }: BottomExitBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="border-t-2 p-3 flex items-center justify-between"
      style={{
        background: COLORS.darkPanel,
        borderColor: COLORS.border,
      }}
    >
      <div className="text-xs" style={{ color: COLORS.textGray }}>
        Emergency Mode Active — {elapsedSeconds} seconds elapsed
      </div>
      <button
        onClick={onExit}
        className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all"
        style={{
          background: "transparent",
          color: COLORS.textGray,
          border: `1px solid ${COLORS.border}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,45,45,0.08)";
          e.currentTarget.style.color = COLORS.brightRed;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = COLORS.textGray;
        }}
        aria-label="Exit rescue mode"
      >
        <X size={16} />
        Exit Rescue Mode
      </button>
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
