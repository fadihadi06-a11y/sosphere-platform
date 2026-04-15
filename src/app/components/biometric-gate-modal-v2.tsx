// ═══════════════════════════════════════════════════════════════
// SOSphere — Biometric Authentication Modal
// ─────────────────────────────────────────────────────────────
// React component for WebAuthn biometric verification
// Animated modal with FaceID/TouchID/Windows Hello support
// Falls back to PIN verification if biometrics unavailable
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Fingerprint, X, Shield, CheckCircle2, AlertTriangle,
  Eye, EyeOff, Lock,
} from "lucide-react";
import {
  checkBiometricAvailability,
  enrollBiometric,
  verifyBiometric,
  isBiometricVerified,
  getBiometricStatus,
  unenrollBiometric,
  type BiometricStatus,
} from "./biometric-gate";
import { setBiometricLockEnabled } from "./biometric-lock-settings";
import { useReducedMotion, springPresets, modalVariants, backdropVariants, contentFadeVariants } from "./view-transitions";

// ─────────────────────────────────────────────────────────────
// P1-#4 — Lock-out recovery
// ─────────────────────────────────────────────────────────────
// Before this: if a user enrolled biometric, then later the hardware
// became unavailable (OS update, sensor hardware change, native plugin
// removed, WebAuthn list stale after browser reinstall), the app-entry
// gate would permanently block launch. No cancel handler is wired up
// for the root gate, so the user was trapped with no escape.
//
// Now: on mount we cross-check the credential flag against live
// availability. If we were enrolled but the platform can no longer
// produce an authenticator, we surface a "locked_out" screen. After
// 3 consecutive failed verify attempts we also escalate to locked_out.
//
// The recovery path is to disable the biometric lock flag + clear the
// stale credential, which safely releases the gate without touching
// user data.
// ─────────────────────────────────────────────────────────────
const VERIFY_STRIKE_LIMIT = 3;

interface BiometricGateModalProps {
  isOpen: boolean;
  onVerified: () => void;
  onCancel?: () => void;
  title?: string;
  description?: string;
  userId?: string;
  userName?: string;
  allowPinFallback?: boolean;
}

type ModalState = "checking" | "enroll" | "enroll_waiting" | "verify" | "verify_waiting" | "verified" | "pin_fallback" | "locked_out" | "error";

/**
 * Biometric Gate Modal Component
 * Handles enrollment and verification flows with fallback to PIN
 */
export function BiometricGateModal({
  isOpen,
  onVerified,
  onCancel,
  title = "Verify Identity",
  description = "Use biometric authentication to continue",
  userId = "user-default",
  userName = "User",
  allowPinFallback = true,
}: BiometricGateModalProps) {
  const [state, setState] = useState<ModalState>("checking");
  const [biometricStatus, setBiometricStatus] = useState<BiometricStatus>("not_available");
  const [error, setError] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinAttempts, setPinAttempts] = useState(0);
  const [pinLocked, setPinLocked] = useState(false);
  // P1-#4: Count consecutive failed biometric verifications. Resets on
  // successful verify or modal close. Triggers locked_out after 3 strikes.
  const [verifyStrikes, setVerifyStrikes] = useState(0);

  // Initialize on mount
  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setState("checking");
      setError("");
      setPinInput("");
      setPinAttempts(0);
      setPinLocked(false);
      setVerifyStrikes(0);
      return;
    }

    // Check biometric availability and status
    const initializeBiometric = async () => {
      // P1-#4: Detect lock-out. If the user was previously enrolled
      // (credential handle stored) but the platform can no longer produce
      // an authenticator, we'd otherwise be stuck — the gate has no cancel
      // path when used as the app-entry lock. Surface a recovery screen.
      const priorStatus = getBiometricStatus();
      const status = await checkBiometricAvailability();
      setBiometricStatus(status);

      if (priorStatus === "enrolled" && status === "not_available") {
        setError("Biometric hardware is no longer available on this device.");
        setState("locked_out");
        return;
      }

      if (status === "enrolled") {
        // Already enrolled - go to verification
        setState("verify");
      } else if (status === "not_enrolled") {
        // Biometric available but not enrolled - offer enrollment
        setState("enroll");
      } else {
        // Not available - fallback to PIN or error
        if (allowPinFallback) {
          setState("pin_fallback");
        } else {
          setError("Biometric authentication not available on this device");
          setState("error");
        }
      }
    };

    initializeBiometric();
  }, [isOpen, allowPinFallback]);

  // Handle enrollment
  const handleEnroll = async () => {
    setState("enroll_waiting");
    setError("");

    try {
      const success = await enrollBiometric(userId, userName);

      if (success) {
        // Enrollment successful - verify immediately
        setState("verify");
      } else {
        setError("Enrollment cancelled or failed");
        setState("enroll");
      }
    } catch (e) {
      setError(`Enrollment error: ${e instanceof Error ? e.message : "Unknown error"}`);
      setState("enroll");
    }
  };

  // Handle verification
  const handleVerify = async () => {
    setState("verify_waiting");
    setError("");

    try {
      const success = await verifyBiometric();

      if (success) {
        setVerifyStrikes(0);
        setState("verified");
        setTimeout(() => {
          onVerified();
        }, 1000);
      } else {
        // P1-#4: Count strikes. After VERIFY_STRIKE_LIMIT consecutive
        // failures, assume the authenticator is unusable and offer the
        // recovery screen instead of looping the user forever.
        const strikes = verifyStrikes + 1;
        setVerifyStrikes(strikes);
        if (strikes >= VERIFY_STRIKE_LIMIT) {
          setError("Biometric verification failed repeatedly.");
          setState("locked_out");
        } else {
          setError(`Biometric verification failed. ${VERIFY_STRIKE_LIMIT - strikes} attempt(s) before recovery options appear.`);
          setState("verify");
        }
      }
    } catch (e) {
      const strikes = verifyStrikes + 1;
      setVerifyStrikes(strikes);
      if (strikes >= VERIFY_STRIKE_LIMIT) {
        setError(`Verification error: ${e instanceof Error ? e.message : "Unknown error"}`);
        setState("locked_out");
      } else {
        setError(`Verification error: ${e instanceof Error ? e.message : "Unknown error"}`);
        setState("verify");
      }
    }
  };

  // P1-#4: Recovery escape hatch. Disables the biometric-lock opt-in
  // and clears the stale credential. This is a controlled un-gate:
  // no user data is touched — only the "gate on entry" flag is cleared.
  // Equivalent to the user going into Settings → Privacy → turning the
  // lock off, except they can reach it from here because they're trapped.
  const handleDisableLockAndContinue = () => {
    try {
      setBiometricLockEnabled(false);
      unenrollBiometric();
      setBiometricStatus("not_enrolled");
    } catch (e) {
      console.warn("[Biometric] Failed to disable lock:", e);
    }
    setVerifyStrikes(0);
    setState("verified");
    setTimeout(() => {
      onVerified();
    }, 500);
  };

  const handleRetryFromLockedOut = async () => {
    setVerifyStrikes(0);
    setError("");
    // Re-run availability check — maybe the user fixed their sensor
    // permission / rebooted / plugged in a security key.
    const status = await checkBiometricAvailability();
    setBiometricStatus(status);
    if (status === "enrolled") setState("verify");
    else if (status === "not_enrolled") setState("enroll");
    else if (allowPinFallback) setState("pin_fallback");
    else setState("locked_out"); // still bad — stay put
  };

  // Handle PIN verification (fallback)
  const handlePinVerify = async () => {
    // In production, this would verify against Supabase
    // For now, we use a simple demo PIN
    const DEMO_PIN = "123456";

    if (pinInput === DEMO_PIN) {
      setState("verified");
      setTimeout(() => {
        onVerified();
      }, 1000);
    } else {
      const newAttempts = pinAttempts + 1;
      setPinAttempts(newAttempts);

      if (newAttempts >= 3) {
        setPinLocked(true);
        setError("Too many failed attempts. Please try again later.");
        setTimeout(() => {
          onCancel?.();
        }, 3000);
      } else {
        setError(`Incorrect PIN. ${3 - newAttempts} attempts remaining.`);
      }

      setPinInput("");
    }
  };

  // Handle enrollment fallback if biometric fails
  const handleEnrollmentFallback = async () => {
    if (allowPinFallback) {
      setState("pin_fallback");
      setError("");
    } else {
      setError("Biometric enrollment is required");
    }
  };

  // Handle unenroll
  const handleUnenroll = () => {
    unenrollBiometric();
    setBiometricStatus("not_enrolled");
    setState("enroll");
    setError("");
  };

  const prefersReduced = useReducedMotion();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={prefersReduced ? { duration: 0 } : springPresets.backdrop}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={onCancel}
          />

          {/* Modal */}
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={prefersReduced ? { duration: 0 } : springPresets.modalEntry}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ pointerEvents: "none" }}
          >
            <motion.div
              className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
              style={{
                background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
                border: "1px solid rgba(148, 163, 184, 0.2)",
                pointerEvents: "auto",
              }}
            >
              {/* Header */}
              <div className="relative px-6 py-6 border-b border-slate-700/50">
                <button
                  onClick={onCancel}
                  className="absolute top-4 right-4 p-2 hover:bg-slate-700/30 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>

                <div className="flex flex-col items-center gap-3">
                  {/* Icon with animation */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{
                      background:
                        state === "verified"
                          ? "rgba(34, 197, 94, 0.15)"
                          : "rgba(30, 144, 255, 0.15)",
                      border: `1px solid ${state === "verified" ? "rgba(34, 197, 94, 0.3)" : "rgba(30, 144, 255, 0.3)"}`,
                    }}
                  >
                    <AnimatePresence mode="wait">
                      {state === "verified" ? (
                        <motion.div
                          key="verified"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                          transition={{ type: "spring" }}
                        >
                          <CheckCircle2 className="w-8 h-8 text-green-500" />
                        </motion.div>
                      ) : state === "error" || state === "locked_out" ? (
                        <motion.div
                          key="error"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                        >
                          <AlertTriangle className="w-8 h-8 text-red-500" />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="biometric"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                        >
                          <Fingerprint className="w-8 h-8 text-blue-400" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>

                  {/* Title and description */}
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-white">
                      {state === "verified"
                        ? "Verified"
                        : state === "error"
                          ? "Error"
                          : state === "locked_out"
                            ? "Can't Verify Biometric"
                            : state === "pin_fallback"
                              ? "Enter PIN"
                              : title}
                    </h2>
                    <p className="text-sm text-slate-400 mt-2">
                      {state === "verified"
                        ? "Identity confirmed. Proceeding..."
                        : state === "error"
                          ? error
                          : state === "locked_out"
                            ? (error || "Biometric verification is currently unavailable.")
                            : state === "pin_fallback"
                              ? "Biometrics unavailable. Use PIN instead."
                              : state === "enroll"
                                ? "Set up biometric authentication for this device"
                                : state === "verify"
                                  ? "Place your finger on the reader or look at the camera"
                                  : description}
                    </p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="px-6 py-6">
                <AnimatePresence mode="wait">
                  {/* Enrollment state */}
                  {(state === "enroll" || state === "enroll_waiting") && (
                    <motion.div
                      key="enroll"
                      variants={contentFadeVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={prefersReduced ? { duration: 0 } : { duration: 0.2 }}
                      className="space-y-4"
                    >
                      <div className="p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
                        <p className="text-sm text-slate-300">
                          This will register your biometric on this device. You can re-register or use PIN if needed.
                        </p>
                      </div>

                      <button
                        onClick={handleEnroll}
                        disabled={state === "enroll_waiting"}
                        className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {state === "enroll_waiting" ? (
                          <>
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ duration: 1, repeat: Infinity }}
                              className="w-4 h-4 border-2 border-transparent border-t-white rounded-full"
                            />
                            Setting up...
                          </>
                        ) : (
                          <>
                            <Fingerprint className="w-4 h-4" />
                            Start Enrollment
                          </>
                        )}
                      </button>

                      {allowPinFallback && (
                        <button
                          onClick={() => setState("pin_fallback")}
                          className="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-colors text-sm"
                        >
                          Use PIN Instead
                        </button>
                      )}
                    </motion.div>
                  )}

                  {/* Verification state */}
                  {(state === "verify" || state === "verify_waiting") && (
                    <motion.div
                      key="verify"
                      variants={contentFadeVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={prefersReduced ? { duration: 0 } : { duration: 0.2 }}
                      className="space-y-4"
                    >
                      {state === "verify_waiting" && (
                        <div className="flex flex-col items-center justify-center py-8">
                          <motion.div
                            animate={{ scale: [1, 1.1, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                            className="w-20 h-20 rounded-2xl flex items-center justify-center"
                            style={{
                              background: "rgba(30, 144, 255, 0.1)",
                              border: "2px solid rgba(30, 144, 255, 0.3)",
                            }}
                          >
                            <Fingerprint className="w-10 h-10 text-blue-400" />
                          </motion.div>
                          <p className="text-slate-400 text-sm mt-4">Waiting for biometric...</p>
                        </div>
                      )}

                      {state === "verify" && (
                        <>
                          <button
                            onClick={handleVerify}
                            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                          >
                            <Fingerprint className="w-4 h-4" />
                            Verify Biometric
                          </button>

                          <button
                            onClick={handleUnenroll}
                            className="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-colors text-sm"
                          >
                            Register Different Biometric
                          </button>

                          {allowPinFallback && (
                            <button
                              onClick={() => setState("pin_fallback")}
                              className="w-full px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors text-sm"
                            >
                              Use PIN Instead
                            </button>
                          )}
                        </>
                      )}
                    </motion.div>
                  )}

                  {/* PIN fallback state */}
                  {state === "pin_fallback" && (
                    <motion.div
                      key="pin"
                      variants={contentFadeVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={prefersReduced ? { duration: 0 } : { duration: 0.2 }}
                      className="space-y-4"
                    >
                      <div className="space-y-2">
                        <label className="block text-sm font-semibold text-slate-300">PIN</label>
                        <div className="relative">
                          <input
                            type={pinInput ? "password" : "text"}
                            value={pinInput}
                            onChange={(e) => {
                              setPinInput(e.target.value);
                              setError("");
                            }}
                            onKeyPress={(e) => {
                              if (e.key === "Enter" && !pinLocked) {
                                handlePinVerify();
                              }
                            }}
                            placeholder="••••••"
                            disabled={pinLocked}
                            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white text-lg tracking-widest placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </div>
                      </div>

                      {error && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-3 bg-red-900/20 border border-red-700/30 rounded-lg flex items-start gap-2"
                        >
                          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                          <span className="text-sm text-red-300">{error}</span>
                        </motion.div>
                      )}

                      <button
                        onClick={handlePinVerify}
                        disabled={pinLocked || pinInput.length === 0}
                        className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {pinLocked ? "Locked" : "Verify PIN"}
                      </button>

                      <button
                        onClick={onCancel}
                        className="w-full px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors text-sm"
                      >
                        Cancel
                      </button>
                    </motion.div>
                  )}

                  {/* P1-#4: Lock-out recovery — offers safe escape hatch when
                       biometric hardware is unavailable or repeatedly rejects. */}
                  {state === "locked_out" && (
                    <motion.div
                      key="locked_out"
                      variants={contentFadeVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={prefersReduced ? { duration: 0 } : { duration: 0.2 }}
                      className="space-y-4"
                    >
                      <div className="p-4 bg-amber-900/20 border border-amber-700/30 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-slate-300 space-y-2">
                          <p>
                            Your device can't verify your biometric right now. This
                            can happen after a system update, a sensor change, or
                            reinstalling the browser.
                          </p>
                          <p className="text-slate-400 text-xs">
                            To regain access you can try again, use your PIN if
                            available, or turn off Biometric Lock for this device.
                            Turning it off won't erase any of your data.
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={handleRetryFromLockedOut}
                        className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        <Fingerprint className="w-4 h-4" />
                        Try Again
                      </button>

                      {allowPinFallback && (
                        <button
                          onClick={() => { setError(""); setState("pin_fallback"); }}
                          className="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-colors text-sm"
                        >
                          Use PIN Instead
                        </button>
                      )}

                      <button
                        onClick={handleDisableLockAndContinue}
                        className="w-full px-4 py-3 bg-red-600/80 hover:bg-red-500 text-white font-semibold rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
                      >
                        <Lock className="w-4 h-4" />
                        Turn Off Biometric Lock & Continue
                      </button>
                    </motion.div>
                  )}

                  {/* Error state */}
                  {state === "error" && (
                    <motion.div
                      key="error"
                      variants={contentFadeVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={prefersReduced ? { duration: 0 } : { duration: 0.2 }}
                      className="space-y-4"
                    >
                      <button
                        onClick={onCancel}
                        className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
                      >
                        Close
                      </button>
                    </motion.div>
                  )}

                  {/* Verified state */}
                  {state === "verified" && (
                    <motion.div
                      key="verified"
                      variants={contentFadeVariants}
                      initial="hidden"
                      animate="visible"
                      transition={prefersReduced ? { duration: 0 } : { duration: 0.2 }}
                      className="flex flex-col items-center justify-center py-4"
                    >
                      <motion.div
                        animate={{ scale: [0.8, 1] }}
                        transition={{ type: "spring" }}
                        className="flex items-center gap-2 text-green-400"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        <span className="font-semibold">Identity Verified</span>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-700/50 bg-slate-900/30">
                <p className="text-xs text-slate-500 text-center">
                  {state === "pin_fallback"
                    ? "Demo PIN: 123456"
                    : "Your biometric is stored securely on this device only"}
                </p>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
