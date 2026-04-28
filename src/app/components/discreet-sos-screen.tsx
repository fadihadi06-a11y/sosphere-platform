// ═══════════════════════════════════════════════════════════════
// SOSphere — Discreet SOS Screen Overlay
// ─────────────────────────────────────────────────────────────
// Displays convincing fake shutdown screen while secretly
// recording location and audio. Two modes:
//
//  1. Blackout: Pure black screen with minimal UI
//  2. Low-Battery: Fake iOS/Android "battery dead" screen
//
// Exit via triple-tap in bottom-left corner
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef } from "react";
// Foundation fix (2026-04-28): use the installed `motion` package directly
// instead of relying on framer-motion as a transitive peer dep — npm prune
// or a future motion@13 update could drop framer-motion silently. This
// matches the import style of all 60+ other animated components in src/.
import { motion, AnimatePresence } from "motion/react";
import {
  isDiscreetModeActive,
  getDiscreetMode,
  getDiscreetModeElapsed,
  handleDiscreetTap,
  deactivateDiscreetSos,
  subscribeToDiscreetMode,
} from "./discreet-sos-mode-v2";

interface DiscreetSosScreenProps {
  isOpen: boolean;
  onClose?: () => void;
}

const HIDDEN_INDICATOR_SIZE = 2; // 2px for status indicators

export function DiscreetSosScreen({ isOpen, onClose }: DiscreetSosScreenProps) {
  const [mode, setMode] = useState<"blackout" | "low-battery" | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [gpsActive, setGpsActive] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Update mode and elapsed time
  useEffect(() => {
    const timer = setInterval(() => {
      if (isDiscreetModeActive()) {
        const elapsed = getDiscreetModeElapsed();
        setElapsedSeconds(Math.floor(elapsed / 1000));
        setMode(getDiscreetMode());
        // GPS and audio are always active during discreet mode
        setGpsActive(true);
        setAudioActive(true);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Handle tap detection for exit gesture
  const handleTap = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (touch) {
      handleDiscreetTap(touch.clientX, touch.clientY);
    }
  };

  // Prevent any interaction with elements below
  const preventPropagation = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  if (!isOpen || !isDiscreetModeActive()) {
    return null;
  }

  const currentMode = mode || "blackout";

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[99999] bg-black overflow-hidden"
        onClick={preventPropagation}
        onTouchStart={preventPropagation}
        onTouchMove={preventPropagation}
        onTouchEnd={handleTap}
        style={{
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
          WebkitAppearance: "none",
          appearance: "none",
        }}
      >
        {currentMode === "blackout" ? (
          <BlackoutScreen />
        ) : (
          <LowBatteryScreen />
        )}

        {/* Hidden Status Indicators (top-left corner) */}
        <StatusIndicators gpsActive={gpsActive} audioActive={audioActive} />

        {/* Exit Zone Detector (bottom-left 60x60) */}
        <div
          className="absolute bottom-0 left-0"
          style={{
            width: "60px",
            height: "60px",
            backgroundColor: "transparent",
            zIndex: 99998,
          }}
        />

        {/* Secret debugging info (DEV ONLY) - hidden in production */}
        {import.meta.env.DEV && (
          <div className="absolute bottom-4 right-4 text-white text-xs opacity-20 pointer-events-none font-mono">
            <div>Mode: {currentMode}</div>
            <div>Elapsed: {elapsedSeconds}s</div>
            <div>Exit: triple-tap bottom-left</div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// ═══════════════════════════════════════════════════════════════
// BLACKOUT MODE — Pure black screen
// ═══════════════════════════════════════════════════════════════

function BlackoutScreen() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full h-full bg-black"
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// LOW BATTERY MODE — Fake iOS/Android battery dead screen
// ═══════════════════════════════════════════════════════════════

function LowBatteryScreen() {
  const [phase, setPhase] = useState<"startup" | "dimming" | "dead">("startup");

  useEffect(() => {
    // Phase 1: Show battery icon for 3 seconds
    const dimTimer = setTimeout(() => {
      setPhase("dimming");
    }, 3000);

    // Phase 2: After dimming animation, show "dead" state
    const deadTimer = setTimeout(() => {
      setPhase("dead");
    }, 4000);

    return () => {
      clearTimeout(dimTimer);
      clearTimeout(deadTimer);
    };
  }, []);

  return (
    <div className="w-full h-full bg-gradient-to-b from-gray-100 to-white flex items-center justify-center">
      {phase === "startup" || phase === "dimming" ? (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <BatteryIcon large />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: phase === "dimming" ? 0.5 : 1 }}
            transition={{ delay: 2.5, duration: 0.5 }}
            className="mt-6 text-center"
          >
            <h1 className="text-2xl font-bold text-gray-800">Battery Critically Low</h1>
            <p className="text-gray-600 mt-2">Connect to a charger</p>
          </motion.div>
        </motion.div>
      ) : (
        // Dead state: black background with faint battery icon
        <motion.div
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          className="w-full h-full bg-black flex items-center justify-center"
        >
          <motion.div
            initial={{ opacity: 0.3 }}
            animate={{ opacity: 0.15 }}
            transition={{ duration: 2 }}
          >
            <BatteryIcon large />
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BATTERY ICON SVG (pixel-perfect iOS/Android style)
// ═══════════════════════════════════════════════════════════════

interface BatteryIconProps {
  large?: boolean;
  className?: string;
}

function BatteryIcon({ large = false, className = "" }: BatteryIconProps) {
  const size = large ? 120 : 60;
  return (
    <svg
      width={size}
      height={size * 1.2}
      viewBox="0 0 40 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Battery body */}
      <rect
        x="3"
        y="4"
        width="34"
        height="42"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-red-600"
      />

      {/* Battery terminal (top) */}
      <rect
        x="16"
        y="0.5"
        width="8"
        height="4"
        rx="1"
        fill="currentColor"
        className="text-gray-400"
      />

      {/* Empty interior (to show battery is drained) */}
      {/* The battery outline alone implies emptiness */}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATUS INDICATORS (hidden 2px dots in top-left)
// Green = GPS active, Red = Audio active
// ═══════════════════════════════════════════════════════════════

interface StatusIndicatorsProps {
  gpsActive: boolean;
  audioActive: boolean;
}

function StatusIndicators({ gpsActive, audioActive }: StatusIndicatorsProps) {
  const spacing = 6; // pixels between indicators

  return (
    <>
      {/* GPS indicator (green dot) */}
      {gpsActive && (
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute top-2 left-2 rounded-full bg-green-500"
          style={{
            width: `${HIDDEN_INDICATOR_SIZE}px`,
            height: `${HIDDEN_INDICATOR_SIZE}px`,
          }}
        />
      )}

      {/* Audio indicator (red dot) */}
      {audioActive && (
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.7 }}
          className="absolute top-2 left-[14px] rounded-full bg-red-500"
          style={{
            width: `${HIDDEN_INDICATOR_SIZE}px`,
            height: `${HIDDEN_INDICATOR_SIZE}px`,
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// Exit Screen Wrapper (for use in app)
// ═══════════════════════════════════════════════════════════════

interface DiscreetSosScreenWrapperProps {
  /**
   * Whether the discreet SOS screen should be shown.
   * This is controlled by the discreet-sos-mode.ts state.
   */
  show?: boolean;
}

export function DiscreetSosScreenWrapper({ show = true }: DiscreetSosScreenWrapperProps) {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    // Subscribe to discreet mode state changes
    const unsubscribe = subscribeToDiscreetMode(
      (state: any) => {
        setIsActive(state.isActive);
      }
    );
    return unsubscribe;
  }, []);

  return (
    <DiscreetSosScreen
      isOpen={show && isActive}
      onClose={() => {
        deactivateDiscreetSos();
      }}
    />
  );
}
