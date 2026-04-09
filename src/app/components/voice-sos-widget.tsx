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

  const posStyle = position === "bottom-left" ? { left: 16, bottom: 100 } : { right: 16, bottom: 100 };

  return (
    <motion.button
      onClick={() => isListening ? stopListening() : startListening()}
      className="fixed z-50 flex items-center justify-center"
      style={{
        ...posStyle, width: 48, height: 48, borderRadius: 24,
        background: isListening ? "linear-gradient(135deg, #FF2D55, #FF6B8A)" : "rgba(255,255,255,0.08)",
        border: isListening ? "2px solid rgba(255,45,85,0.4)" : "1px solid rgba(255,255,255,0.1)",
        boxShadow: isListening ? "0 4px 20px rgba(255,45,85,0.3)" : "0 2px 8px rgba(0,0,0,0.2)",
      }}
      whileTap={{ scale: 0.9 }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
    >
      <AnimatePresence mode="wait">
        {isListening ? (
          <motion.div key="on" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Mic size={20} color="#fff" /></motion.div>
        ) : (
          <motion.div key="off" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><MicOff size={20} color="rgba(255,255,255,0.4)" /></motion.div>
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
