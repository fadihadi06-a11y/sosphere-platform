// ═══════════════════════════════════════════════════════════════
// SOSphere — Discreet SOS Trigger UI
// ─────────────────────────────────────────────────────────────
// Activation UI for Discreet SOS Mode. Users can choose between
// "Blackout" (pure black) or "Low Battery Decoy" screens while
// secretly streaming GPS and recording audio.
//
// Features:
//  • Two mode selection (blackout, low-battery)
//  • Clear explanation of behavior
//  • Confirmation dialog before activation
//  • Exit instructions
// ═══════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  activateDiscreetSos,
  isDiscreetModeActive,
  getDiscreetMode,
  getDiscreetModeElapsed,
} from "./discreet-sos-mode";
import { X, AlertCircle, Phone, Zap } from "lucide-react";

interface DiscreetSosTriggerProps {
  onActivate?: () => void;
}

export function DiscreetSosTrigger({ onActivate }: DiscreetSosTriggerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"blackout" | "low-battery" | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const isActive = isDiscreetModeActive();
  const currentMode = getDiscreetMode();
  const elapsed = getDiscreetModeElapsed();
  const elapsedSeconds = Math.floor(elapsed / 1000);

  const handleModeSelect = (mode: "blackout" | "low-battery") => {
    setSelectedMode(mode);
    setShowConfirmation(true);
  };

  const handleConfirmActivation = async () => {
    if (!selectedMode) return;

    setIsActivating(true);
    try {
      await activateDiscreetSos(selectedMode);
      setIsOpen(false);
      setSelectedMode(null);
      setShowConfirmation(false);
      onActivate?.();

      // Log dev-level info
      if (import.meta.env.DEV) {
        console.log("[DiscreetSOS] Activation triggered:", selectedMode);
      }
    } catch (err) {
      console.error("[DiscreetSOS] Activation failed:", err);
      alert("Failed to activate discreet mode. Check permissions (GPS, microphone).");
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <>
      {/* Trigger Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
          isActive
            ? "bg-red-600 text-white shadow-lg"
            : "bg-red-500 hover:bg-red-600 text-white shadow-md"
        }`}
      >
        <AlertCircle size={20} />
        {isActive ? "Discreet SOS Active" : "Discreet SOS"}
      </motion.button>

      {/* Active Mode Badge */}
      {isActive && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-xs text-red-600 font-mono mt-1"
        >
          {currentMode === "blackout" ? "📵 Blackout" : "🔋 Low Battery"}
          {" • "} {elapsedSeconds}s
        </motion.div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-red-600 to-red-700 px-6 py-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <AlertCircle size={24} />
                  Discreet SOS Mode
                </h2>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-white hover:bg-red-700 rounded-lg p-1 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {!showConfirmation ? (
                /* Mode Selection Screen */
                <div className="p-6 space-y-4">
                  <div className="bg-red-50 border-l-4 border-red-600 p-4 rounded">
                    <p className="text-sm text-gray-700">
                      When activated, your device will show a fake shutdown screen while secretly
                      recording your location and ambient audio for evidence.
                    </p>
                  </div>

                  {/* Blackout Mode */}
                  <motion.button
                    whileHover={{ x: 4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleModeSelect("blackout")}
                    className="w-full text-left p-4 border-2 border-gray-200 rounded-lg hover:border-red-500 hover:bg-red-50 transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0">
                        <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center text-white font-bold">
                          ⚫
                        </div>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 group-hover:text-red-600">
                          Blackout Mode
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          Pure black screen. Attacker sees "phone powered off"
                        </p>
                        <ul className="text-xs text-gray-500 mt-2 space-y-1">
                          <li>✓ Most convincing for power-off</li>
                          <li>✓ Zero visible UI</li>
                        </ul>
                      </div>
                    </div>
                  </motion.button>

                  {/* Low Battery Mode */}
                  <motion.button
                    whileHover={{ x: 4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleModeSelect("low-battery")}
                    className="w-full text-left p-4 border-2 border-gray-200 rounded-lg hover:border-red-500 hover:bg-red-50 transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0">
                        <div className="w-12 h-12 bg-gradient-to-b from-red-100 to-red-200 rounded-lg flex items-center justify-center text-red-600 font-bold">
                          <Zap size={24} />
                        </div>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 group-hover:text-red-600">
                          Low Battery Mode
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          Fake iOS/Android "battery dead" screen with animation
                        </p>
                        <ul className="text-xs text-gray-500 mt-2 space-y-1">
                          <li>✓ Realistic shutdown animation</li>
                          <li>✓ Looks like normal device shutdown</li>
                        </ul>
                      </div>
                    </div>
                  </motion.button>

                  {/* Key Features */}
                  <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
                    <h4 className="font-semibold text-gray-900">What happens:</h4>
                    <ul className="space-y-2 text-gray-700">
                      <li className="flex gap-2">
                        <span className="text-red-600">📍</span>
                        <span>GPS location sent every 5 seconds</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-red-600">🎤</span>
                        <span>Ambient audio recorded locally</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-red-600">✋</span>
                        <span>Triple-tap bottom-left corner to exit</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-red-600">⏱️</span>
                        <span>Auto-stops after 60 minutes</span>
                      </li>
                    </ul>
                  </div>

                  <div className="text-xs text-gray-500 text-center pt-2">
                    <p>This feature is only for legitimate safety emergencies.</p>
                  </div>
                </div>
              ) : (
                /* Confirmation Screen */
                <div className="p-6 space-y-4">
                  <div className="bg-yellow-50 border-l-4 border-yellow-600 p-4 rounded">
                    <p className="text-sm font-semibold text-yellow-900 flex gap-2">
                      <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                      About to activate Discreet SOS
                    </p>
                    <p className="text-sm text-yellow-800 mt-2">
                      Your screen will appear completely off. You must triple-tap the bottom-left
                      corner of the screen to exit.
                    </p>
                  </div>

                  <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded">
                    <p className="text-sm font-semibold text-blue-900">
                      Selected Mode: {selectedMode === "blackout" ? "Blackout" : "Low Battery"}
                    </p>
                    <p className="text-xs text-blue-800 mt-2">
                      Once activated, your device will secretly track your location and record audio.
                    </p>
                  </div>

                  <div className="space-y-3 pt-4">
                    <button
                      onClick={handleConfirmActivation}
                      disabled={isActivating}
                      className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isActivating ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                          Activating...
                        </>
                      ) : (
                        <>
                          <Phone size={18} />
                          Activate Discreet SOS
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        setShowConfirmation(false);
                        setSelectedMode(null);
                      }}
                      className="w-full bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold py-3 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>

                  <p className="text-xs text-gray-500 text-center">
                    Requires GPS and microphone permissions.
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// Status Display Component (for dashboard)
// ═══════════════════════════════════════════════════════════════

export function DiscreetSosStatus() {
  const isActive = isDiscreetModeActive();
  const currentMode = getDiscreetMode();
  const elapsed = getDiscreetModeElapsed();

  if (!isActive) return null;

  const elapsedSeconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-3">
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1 }}
          className="w-3 h-3 bg-white rounded-full"
        />
        <div>
          <p className="font-semibold">
            Discreet SOS Active ({currentMode === "blackout" ? "Blackout" : "Low Battery"})
          </p>
          <p className="text-sm text-red-100">
            Location & audio streaming • Elapsed: {minutes}m {seconds}s
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Quick Activation Gesture Handler (Volume Button Pattern)
// ═══════════════════════════════════════════════════════════════
// Future enhancement: detect volume button presses for quick activation

export function useDiscreetSosGestureListener() {
  React.useEffect(() => {
    // This is a placeholder for future volume button detection
    // On Capacitor, we can listen to hardware volume key presses
    // For now, activation is UI-based only

    const handleKeyDown = (e: KeyboardEvent) => {
      // Could implement: e.g., Volume Up + Volume Down pressed together
      // For now: no keyboard shortcuts to prevent accidental activation
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
