// ═══════════════════════════════════════════════════════════════
// SOSphere — Voice SOS Widget
// ─────────────────────────────────────────────────────────────
// Floating microphone button that toggles voice-activated SOS
// States: idle, listening, triggered, unsupported
// Privacy-first: no audio storage, client-side only
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, MicOff, Volume2 } from "lucide-react";
import { toast } from "sonner";
import {
  useVoiceSOSDetection,
  isVoiceSosSupported,
} from "./voice-sos-trigger";

export interface VoiceSOSWidgetProps {
  onVoiceSOSTriggered?: (keyword: string, confidence: number) => void;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  confidenceThreshold?: number;
  cooldownMs?: number;
  position?: "bottom-left" | "bottom-right";
}

export function VoiceSOSWidget({
  onVoiceSOSTriggered,
  primaryKeyword = "help me",
  secondaryKeywords = ["emergency", "mayday"],
  confidenceThreshold = 0.7,
  cooldownMs = 30000,
  position = "bottom-left",
}: VoiceSOSWidgetProps) {
  // ── State ────────────────────────────────────────────────────
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [triggerFlash, setTriggerFlash] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const toastIdRef = useRef<string | number | null>(null);

  // ── Persist preference to localStorage ────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("sosphere_voice_sos_enabled");
    if (saved === "true") {
      setVoiceEnabled(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("sosphere_voice_sos_enabled", String(voiceEnabled));
  }, [voiceEnabled]);

  // ── Voice Recognition Hook ───────────────────────────────────
  const {
    isSupported,
    isListening,
    currentTranscript,
    confidence,
    startListening,
    stopListening,
  } = useVoiceSOSDetection({
    enabled: voiceEnabled,
    onKeywordDetected: (keyword, conf) => {
      // Handle keyword detection
      handleVoiceSOSTriggered(keyword, conf);
    },
    primaryKeyword,
    secondaryKeywords,
    confidenceThreshold,
    cooldownMs,
    interimResults: false, // Battery-conscious
    maxListeningDurationMs: 300000, // 5 min auto-restart
  });

  // ── Listen for Voice SOS Triggered Event ──────────────────────
  useEffect(() => {
    const handleEvent = (e: any) => {
      const { keyword, confidence: conf } = e.detail || {};
      if (keyword) {
        handleVoiceSOSTriggered(keyword, conf);
      }
    };

    window.addEventListener("voice-sos-triggered", handleEvent);
    return () => window.removeEventListener("voice-sos-triggered", handleEvent);
  }, []);

  // ── Voice SOS Triggered Handler ──────────────────────────────
  const handleVoiceSOSTriggered = useCallback(
    (keyword: string, conf: number) => {
      setTriggerFlash(true);
      setShowConfirmation(true);

      // Dismiss previous toast if any
      if (toastIdRef.current !== null) {
        toast.dismiss(toastIdRef.current);
      }

      // Show confirmation toast (3 seconds)
      toastIdRef.current = toast("🚨 Voice SOS Detected — Sending alert...", {
        duration: 3000,
        position: "top-center",
        style: {
          background: "linear-gradient(135deg, #FF5544, #FF2222)",
          color: "white",
          border: "1px solid rgba(255,255,255,0.2)",
          boxShadow: "0 8px 32px rgba(255,34,34,0.3)",
        },
      });

      // Flash for 2 seconds
      setTimeout(() => setTriggerFlash(false), 2000);
      setTimeout(() => setShowConfirmation(false), 3000);

      // Call parent handler if provided
      if (onVoiceSOSTriggered) {
        onVoiceSOSTriggered(keyword, conf);
      }
    },
    [onVoiceSOSTriggered]
  );

  // ── Toggle Listening ────────────────────────────────────────
  const handleToggle = useCallback(() => {
    if (!isSupported) return;

    if (voiceEnabled) {
      setVoiceEnabled(false);
      stopListening();
    } else {
      setVoiceEnabled(true);
      startListening();
    }
  }, [voiceEnabled, isSupported, startListening, stopListening]);

  // ── Render Nothing if Unsupported ────────────────────────────
  if (!isSupported) {
    return null;
  }

  // ── Computed States ──────────────────────────────────────────
  const isActive = voiceEnabled && isListening;
  const positionClass =
    position === "bottom-right"
      ? "fixed-bottom-safe-lg right-6"
      : "fixed-bottom-safe-lg left-6";

  // ── Icon Color Based on State ────────────────────────────────
  let iconColor = "rgba(255,255,255,0.4)"; // idle (gray)
  if (isActive && !triggerFlash) {
    iconColor = "#4CAF50"; // listening (green)
  } else if (triggerFlash) {
    iconColor = "#FF2222"; // triggered (red flash)
  }

  return (
    <>
      {/* Voice SOS Floating Button */}
      <motion.button
        onClick={handleToggle}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        whileTap={{ scale: 0.9 }}
        className={`fixed ${positionClass} z-40 flex items-center justify-center rounded-full shadow-lg transition-all`}
        style={{
          width: "56px",
          height: "56px",
          background: triggerFlash
            ? "linear-gradient(135deg, rgba(255,34,34,0.2), rgba(255,34,34,0.1))"
            : isActive
              ? "linear-gradient(135deg, rgba(76,175,80,0.2), rgba(76,175,80,0.1))"
              : "linear-gradient(135deg, rgba(200,200,200,0.1), rgba(150,150,150,0.05))",
          border:
            triggerFlash || isActive
              ? `2px solid ${triggerFlash ? "rgba(255,34,34,0.5)" : "rgba(76,175,80,0.5)"}`
              : "2px solid rgba(255,255,255,0.1)",
          cursor: isSupported ? "pointer" : "default",
          backdropFilter: "blur(8px)",
        }}
        aria-label={
          voiceEnabled
            ? "Voice SOS Active - Click to disable"
            : "Click to enable Voice SOS"
        }
        title={
          voiceEnabled
            ? "Voice SOS Active - Listening for keywords"
            : "Click to enable Voice SOS"
        }
      >
        {/* Pulsing ring for listening state */}
        {isActive && !triggerFlash && (
          <motion.div
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.4, opacity: 0 }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute inset-0 rounded-full"
            style={{ border: "2px solid rgba(76,175,80,0.5)" }}
          />
        )}

        {/* Flashing red for triggered state */}
        {triggerFlash && (
          <motion.div
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 0.6, repeat: Infinity }}
            className="absolute inset-0 rounded-full"
            style={{ border: "2px solid rgba(255,34,34,0.8)" }}
          />
        )}

        {/* Icon */}
        <motion.div
          animate={
            isActive && !triggerFlash
              ? {
                  rotate: [0, -10, 10, -10, 10, 0],
                  scale: [1, 1.1, 1.1, 1.1, 1.1, 1],
                }
              : triggerFlash
                ? { scale: [1, 1.15, 1] }
                : {}
          }
          transition={
            isActive && !triggerFlash
              ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
              : triggerFlash
                ? { duration: 0.6, repeat: Infinity }
                : {}
          }
        >
          {isActive ? (
            <Mic
              size={24}
              style={{
                color: iconColor,
                transition: "color 0.3s ease",
                filter: triggerFlash ? "drop-shadow(0 0 8px rgba(255,34,34,0.6))" : "none",
              }}
            />
          ) : (
            <MicOff
              size={24}
              style={{
                color: iconColor,
                transition: "color 0.3s ease",
              }}
            />
          )}
        </motion.div>
      </motion.button>

      {/* Status Tooltip */}
      <AnimatePresence>
        {voiceEnabled && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className={`fixed ${position === "bottom-right" ? "right-20" : "left-20"} fixed-bottom-safe z-40 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap pointer-events-none`}
            style={{
              background: isActive
                ? "rgba(76,175,80,0.2)"
                : "rgba(200,200,200,0.1)",
              border: isActive
                ? "1px solid rgba(76,175,80,0.3)"
                : "1px solid rgba(255,255,255,0.1)",
              color: isActive ? "#4CAF50" : "rgba(255,255,255,0.6)",
              backdropFilter: "blur(8px)",
            }}
          >
            {isActive ? "🎙️ Voice SOS Active" : "🎙️ Voice SOS Ready"}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transcript Display (Debug Mode) */}
      {import.meta.env.DEV && voiceEnabled && currentTranscript && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className={`fixed ${position === "bottom-right" ? "right-20" : "left-20"} fixed-bottom-safe-lg z-40 px-3 py-2 rounded-lg text-xs max-w-xs pointer-events-none`}
          style={{
            bottom: 'calc(max(24px, env(safe-area-inset-bottom)) + 60px)',
            background: "rgba(100,150,200,0.15)",
            border: "1px solid rgba(100,150,200,0.3)",
            color: "#7DB1E0",
            backdropFilter: "blur(8px)",
            wordWrap: "break-word",
          }}
        >
          <div className="font-medium mb-1">Transcript:</div>
          <div>{currentTranscript}</div>
          <div className="text-xs opacity-75 mt-1">
            Confidence: {(confidence * 100).toFixed(0)}%
          </div>
        </motion.div>
      )}

      {/* Trigger Confirmation Toast is handled by toast() above */}
    </>
  );
}

// ── Export for use in app ────────────────────────────────────
export default VoiceSOSWidget;
