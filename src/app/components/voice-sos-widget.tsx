import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, MicOff } from "lucide-react";

interface VoiceSOSWidgetProps {
  onVoiceSOSTriggered: (keyword: string, confidence: number) => void;
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
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const lastTriggerRef = useRef(0);
  const allKeywords = [primaryKeyword, ...secondaryKeywords].map(k => k.toLowerCase());

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SR);
  }, []);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      const now = Date.now();
      if (now - lastTriggerRef.current < cooldownMs) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        const confidence = event.results[i][0].confidence;
        for (const keyword of allKeywords) {
          if (transcript.includes(keyword) && confidence >= confidenceThreshold) {
            lastTriggerRef.current = now;
            onVoiceSOSTriggered(keyword, confidence);
            return;
          }
        }
      }
    };
    recognition.onerror = (event: any) => {
      console.warn("[VoiceSOS] error:", event.error);
      if (event.error !== "aborted") setIsListening(false);
    };
    recognition.onend = () => {
      if (recognitionRef.current) { try { recognitionRef.current.start(); } catch {} }
    };
    recognitionRef.current = recognition;
    try { recognition.start(); setIsListening(true); } catch {}
  }, [allKeywords, confidenceThreshold, cooldownMs, onVoiceSOSTriggered]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    setIsListening(false);
  }, []);

  useEffect(() => { return () => { if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} } }; }, []);

  if (!isSupported) return null;

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
      ? "right-4"
      : "left-4";

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
          bottom: "max(80px, calc(env(safe-area-inset-bottom) + 72px))",
          width: "48px",
          height: "48px",
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
            className={`fixed ${position === "bottom-right" ? "right-20" : "left-20"} z-40 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap pointer-events-none`}
            data-mic-tooltip="true"
            style={{
              bottom: "max(88px, calc(env(safe-area-inset-bottom) + 80px))",
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
      {isListening && (
        <motion.div className="absolute inset-0 rounded-full" style={{ border: "2px solid rgba(255,45,85,0.3)" }}
          animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} />
      )}
    </motion.button>
  );
}
