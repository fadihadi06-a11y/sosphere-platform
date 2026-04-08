// ═══════════════════════════════════════════════════════════════
// SOSphere — Voice-Activated SOS Trigger
// ─────────────────────────────────────────────────────────────
// Detects voice keywords via Web Speech API → triggers SOS instantly
// Uses: "help me", "emergency", "mayday" (configurable)
// For situations where hands are unavailable (injury, trapped, etc.)
// Privacy-first: recognition 100% client-side, NO audio storage
// ═══════════════════════════════════════════════════════════════

// ── Type Definitions ─────────────────────────────────────────

export interface VoiceSOSConfig {
  enabled: boolean;
  onKeywordDetected: (keyword: string, confidence: number) => void;
  primaryKeyword?: string;      // Default: "help me"
  secondaryKeywords?: string[];  // Default: ["emergency", "mayday"]
  confidenceThreshold?: number;  // Default: 0.7 (0-1)
  cooldownMs?: number;           // Default: 30000 (prevent re-trigger spam)
  language?: string;             // Default: auto-detect from document or navigator
  interimResults?: boolean;      // Default: false (battery-conscious)
  maxListeningDurationMs?: number; // Default: 300000 (5 min before auto-restart)
}

interface RecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  isFinal: boolean;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionStartEvent extends Event {
  type: "start";
}

interface SpeechRecognitionEndEvent extends Event {
  type: "end";
}

// ── Voice SOS Engine Hook ────────────────────────────────────

export function useVoiceSOSDetection({
  enabled,
  onKeywordDetected,
  primaryKeyword = "help me",
  secondaryKeywords = ["emergency", "mayday"],
  confidenceThreshold = 0.7,
  cooldownMs = 30000,
  language = undefined,
  interimResults = false,
  maxListeningDurationMs = 300000,
}: VoiceSOSConfig) {
  const React = require("react");
  const { useState, useEffect, useRef, useCallback } = React;

  // ── State ────────────────────────────────────────────────────
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [confidence, setConfidence] = useState(0);

  // ── Refs ─────────────────────────────────────────────────────
  const recognitionRef = useRef<any>(null);
  const lastTriggerRef = useRef(0);
  const listeningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allKeywordsRef = useRef<string[]>([]);

  // ── Initialize Speech Recognition ────────────────────────────
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const supported = !!SpeechRecognition;
    setIsSupported(supported);

    if (!supported) {
      if (import.meta.env.DEV) {
        console.log("[VoiceSOS] Speech Recognition API not supported");
      }
      return;
    }

    recognitionRef.current = new SpeechRecognition();
    const recognition = recognitionRef.current;

    // Detect language from document or navigator
    const detectedLang =
      language ||
      (document.documentElement.lang && document.documentElement.lang.split("-")[0]) ||
      (navigator.language && navigator.language.split("-")[0]) ||
      "en";

    recognition.language = detectedLang;
    recognition.continuous = true;
    recognition.interimResults = interimResults;

    // Build all trigger phrases
    allKeywordsRef.current = [
      primaryKeyword.toLowerCase(),
      ...secondaryKeywords.map((k) => k.toLowerCase()),
    ];

    if (import.meta.env.DEV) {
      console.log(
        `[VoiceSOS] Initialized for language: ${detectedLang}`,
        `Keywords: ${allKeywordsRef.current.join(", ")}`
      );
    }

    // ── Handle Results ───────────────────────────────────────────
    recognition.onresult = (event: any) => {
      let interimTranscript = "";
      let maxConfidence = 0;
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        const conf = event.results[i][0].confidence;

        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
          maxConfidence = Math.max(maxConfidence, conf);
        } else if (interimResults) {
          interimTranscript += transcript;
        }
      }

      const displayTranscript = finalTranscript || interimTranscript;
      setCurrentTranscript(displayTranscript);
      setConfidence(maxConfidence);

      if (finalTranscript) {
        // Check for keyword matches
        const now = Date.now();
        if (now - lastTriggerRef.current < cooldownMs) {
          if (import.meta.env.DEV) {
            console.log("[VoiceSOS] Cooldown active, ignoring match");
          }
          return;
        }

        for (const keyword of allKeywordsRef.current) {
          if (
            finalTranscript.includes(keyword) &&
            maxConfidence >= confidenceThreshold
          ) {
            if (import.meta.env.DEV) {
              console.log(
                `[VoiceSOS] Keyword detected: "${keyword}" (confidence: ${(maxConfidence * 100).toFixed(1)}%)`
              );
            }

            lastTriggerRef.current = now;

            // Emit custom event for UI to react to
            window.dispatchEvent(
              new CustomEvent("voice-sos-triggered", {
                detail: { keyword, confidence: maxConfidence },
              })
            );

            // Call the handler
            onKeywordDetected(keyword, maxConfidence);

            // Clear transcript after detection
            setCurrentTranscript("");
            setConfidence(0);

            break; // Only trigger once per phrase
          }
        }
      }
    };

    // ── Handle Errors ────────────────────────────────────────────
    recognition.onerror = (event: any) => {
      if (import.meta.env.DEV) {
        console.warn(`[VoiceSOS] Recognition error: ${event.error}`);
      }
    };

    // ── Handle End ───────────────────────────────────────────────
    recognition.onend = () => {
      if (import.meta.env.DEV) {
        console.log("[VoiceSOS] Recognition ended, auto-restarting...");
      }
      setIsListening(false);

      // Auto-restart if still enabled
      if (enabled) {
        try {
          recognition.start();
          setIsListening(true);
          scheduleListeningTimeout();
        } catch (e) {
          // Already started or other error
          if (import.meta.env.DEV) {
            console.warn("[VoiceSOS] Failed to restart recognition:", e);
          }
        }
      }
    };

    return () => {
      if (listeningTimerRef.current) {
        clearTimeout(listeningTimerRef.current);
      }
      try {
        recognition.stop();
      } catch (e) {
        // Already stopped
      }
    };
  }, [enabled, onKeywordDetected, primaryKeyword, secondaryKeywords]);

  // ── Schedule Auto-Restart on Max Duration ────────────────────
  const scheduleListeningTimeout = useCallback(() => {
    if (listeningTimerRef.current) {
      clearTimeout(listeningTimerRef.current);
    }
    listeningTimerRef.current = setTimeout(() => {
      if (recognitionRef.current && isListening) {
        if (import.meta.env.DEV) {
          console.log(
            "[VoiceSOS] Max listening duration reached, restarting..."
          );
        }
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Already stopped
        }
      }
    }, maxListeningDurationMs);
  }, [isListening, maxListeningDurationMs]);

  // ── Start Listening ──────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!isSupported || !recognitionRef.current || isListening) return;

    try {
      recognitionRef.current.start();
      setIsListening(true);
      setCurrentTranscript("");
      setConfidence(0);
      scheduleListeningTimeout();

      if (import.meta.env.DEV) {
        console.log("[VoiceSOS] Listening started");
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn("[VoiceSOS] Failed to start listening:", e);
      }
    }
  }, [isSupported, isListening, scheduleListeningTimeout]);

  // ── Stop Listening ───────────────────────────────────────────
  const stopListening = useCallback(() => {
    if (!isSupported || !recognitionRef.current || !isListening) return;

    try {
      recognitionRef.current.stop();
      setIsListening(false);
      setCurrentTranscript("");
      setConfidence(0);

      if (listeningTimerRef.current) {
        clearTimeout(listeningTimerRef.current);
      }

      if (import.meta.env.DEV) {
        console.log("[VoiceSOS] Listening stopped");
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn("[VoiceSOS] Failed to stop listening:", e);
      }
    }
  }, [isSupported, isListening]);

  return {
    isSupported,
    isListening,
    currentTranscript,
    confidence,
    startListening,
    stopListening,
  };
}

// ── Standalone Helper: Check if Voice SOS is Supported ─────────
export function isVoiceSosSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
}

// ── Export Hook for React Component ──────────────────────────
export { useVoiceSOSDetection as default };
