// ═══════════════════════════════════════════════════════════════
// SOSphere — 2FA / PIN Verification Modal
// Required for Owner & Main Admin before sensitive permission changes
// Animated numpad · 6-digit PIN · Shake on error · Auto-submit
// ═══════════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Fingerprint, X, Shield, Crown, Key, Lock,
  AlertTriangle, CheckCircle2, Eye, EyeOff,
} from "lucide-react";
import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";

type OperationType =
  | "change_permissions"
  | "change_role"
  | "assign_zone_admin"
  | "revoke_access"
  | "suspend_user"
  | "bulk_import";

interface PINVerifyModalProps {
  isOpen: boolean;
  actorName: string;
  actorLevel: "owner" | "main_admin";
  operationType: OperationType;
  targetName?: string;
  onVerified: () => void;
  onCancel: () => void;
}

const OPERATION_CONFIG: Record<OperationType, {
  label: string; desc: string; icon: React.ElementType; risk: "high" | "critical";
}> = {
  change_permissions: { label: "Change Permissions",    desc: "Modifying custom permission overrides",     icon: Key,         risk: "high"     },
  change_role:        { label: "Change Role",           desc: "Changing a member's system role",           icon: Shield,      risk: "high"     },
  assign_zone_admin:  { label: "Assign Zone Admin",     desc: "Promoting a member to Zone Admin",          icon: Shield,      risk: "high"     },
  revoke_access:      { label: "Revoke Access",         desc: "Removing a member's system access",         icon: Lock,        risk: "critical" },
  suspend_user:       { label: "Suspend Account",       desc: "Suspending a user from the system",         icon: AlertTriangle,risk: "critical"},
  bulk_import:        { label: "Bulk CSV Import",       desc: "Importing employees from CSV file",         icon: Key,         risk: "high"     },
};

const ACTOR_CONFIG = {
  owner:      { label: "Owner",      color: "#FF2D55", icon: Crown },
  main_admin: { label: "Main Admin", color: "#FF9500", icon: Key   },
};

// PIN verification — checks Supabase hash, falls back to demo mode in DEV only
const DEMO_PIN = "123456";
const IS_DEV = import.meta.env.DEV === true;
const MAX_ATTEMPTS = 3;

/** Hash PIN using SHA-256 for secure comparison */
async function hashPIN(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`sosphere_pin_${pin}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Verify PIN against Supabase, fallback to demo ONLY in development */
async function verifyPIN(userId: string, enteredPin: string): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) {
    // No Supabase — only accept demo PIN in dev mode
    return IS_DEV && enteredPin === DEMO_PIN;
  }
  try {
    const pinHash = await hashPIN(enteredPin);
    const { data, error } = await supabase
      .from("user_pins")
      .select("pin_hash")
      .eq("user_id", userId)
      .single();
    if (error || !data) {
      // No PIN set yet — accept demo PIN ONLY in dev mode
      if (IS_DEV) return enteredPin === DEMO_PIN;
      console.warn("[PIN] No PIN found in DB and not in dev mode");
      return false;
    }
    return data.pin_hash === pinHash;
  } catch (e) {
    console.warn("[PIN] Verification failed:", e);
    if (IS_DEV) return enteredPin === DEMO_PIN;
    return false;
  }
}

export function PINVerifyModal({
  isOpen,
  actorName,
  actorLevel,
  operationType,
  targetName,
  onVerified,
  onCancel,
}: PINVerifyModalProps) {
  const [pin, setPin] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked] = useState(false);
  const [lockTime, setLockTime] = useState(0);
  const [showPin, setShowPin] = useState(false);
  const [shake, setShake] = useState(false);
  const [verified, setVerified] = useState(false);

  const opCfg = OPERATION_CONFIG[operationType];
  const actCfg = ACTOR_CONFIG[actorLevel];
  const ActorIcon = actCfg.icon;
  const OpIcon = opCfg.icon;

  // Countdown for lockout
  useEffect(() => {
    if (!locked) return;
    const id = setInterval(() => {
      setLockTime(prev => {
        if (prev <= 1) { setLocked(false); setAttempts(0); clearInterval(id); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [locked]);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (pin.length === 6 && !locked) {
      handleVerify(pin.join(""));
    }
  }, [pin]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setPin([]);
      setError("");
      setAttempts(0);
      setLocked(false);
      setLockTime(0);
      setVerified(false);
      setShake(false);
    }
  }, [isOpen]);

  function handleDigit(d: string) {
    if (pin.length >= 6 || locked) return;
    setPin(prev => [...prev, d]);
    setError("");
  }

  function handleDelete() {
    setPin(prev => prev.slice(0, -1));
    setError("");
  }

  const [verifying, setVerifying] = useState(false);

  async function handleVerify(enteredPin: string) {
    if (verifying) return;
    setVerifying(true);

    try {
      // Determine user ID from actor context (or use a default for demo)
      const userId = `${actorLevel}-${actorName}`;
      const isCorrect = await verifyPIN(userId, enteredPin);

      if (isCorrect) {
        setVerified(true);

        // Log successful verification to Supabase
        if (SUPABASE_CONFIG.isConfigured) {
          supabase.from("audit_log").insert({
            id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            action: "pin_verified",
            actor: actorName,
            actor_role: actorLevel,
            operation: operationType,
            target: targetName || null,
            created_at: new Date().toISOString(),
          }).then(() => {}).catch(() => {});
        }

        setTimeout(() => {
          onVerified();
        }, 900);
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setShake(true);
        setPin([]);
        setTimeout(() => setShake(false), 500);

        if (newAttempts >= MAX_ATTEMPTS) {
          setLocked(true);
          setLockTime(30);
          setError(`Account locked for 30 seconds after ${MAX_ATTEMPTS} failed attempts`);

          // Log lockout to audit
          if (SUPABASE_CONFIG.isConfigured) {
            supabase.from("audit_log").insert({
              id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              action: "pin_lockout",
              actor: actorName,
              actor_role: actorLevel,
              operation: operationType,
              target: targetName || null,
              created_at: new Date().toISOString(),
            }).then(() => {}).catch(() => {});
          }
        } else {
          setError(`Incorrect PIN — ${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts !== 1 ? "s" : ""} remaining`);
        }
      }
    } finally {
      setVerifying(false);
    }
  }

  const NUMPAD = [
    ["1","2","3"],
    ["4","5","6"],
    ["7","8","9"],
    ["","0","⌫"],
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(5,7,14,0.92)", backdropFilter: "blur(12px)" }}
            onClick={onCancel}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ pointerEvents: "none" }}
          >
            <motion.div
              animate={shake ? { x: [-8, 8, -6, 6, -4, 4, 0] } : {}}
              transition={{ duration: 0.4 }}
              className="w-full max-w-sm rounded-3xl overflow-hidden"
              style={{
                background: "linear-gradient(180deg, #0A1220 0%, #05070E 100%)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                pointerEvents: "auto",
              }}
            >
              {/* Header */}
              <div className="relative px-6 pt-6 pb-4 text-center"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <button
                  onClick={onCancel}
                  className="absolute top-4 right-4 size-8 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
                </button>

                {/* Icon */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
                  className="size-16 rounded-2xl mx-auto mb-4 flex items-center justify-center relative"
                  style={{
                    background: verified
                      ? "rgba(52,199,89,0.15)"
                      : opCfg.risk === "critical"
                        ? "rgba(255,45,85,0.12)"
                        : "rgba(255,150,0,0.1)",
                    border: `1px solid ${verified ? "rgba(52,199,89,0.3)" : opCfg.risk === "critical" ? "rgba(255,45,85,0.25)" : "rgba(255,150,0,0.2)"}`,
                  }}
                >
                  <AnimatePresence mode="wait">
                    {verified ? (
                      <motion.div key="verified" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
                        <CheckCircle2 className="size-8" style={{ color: "#34C759" }} />
                      </motion.div>
                    ) : (
                      <motion.div key="lock" initial={{ scale: 1 }} exit={{ scale: 0 }}>
                        <Fingerprint className="size-8" style={{ color: opCfg.risk === "critical" ? "#FF2D55" : "#FF9500" }} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.4px" }}>
                  {verified ? "Verified!" : "Confirm with PIN"}
                </h2>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 1.5 }}>
                  {verified
                    ? "Identity confirmed. Applying changes..."
                    : `Enter your ${actCfg.label} PIN to ${opCfg.label.toLowerCase()}`
                  }
                </p>

                {/* Operation Context */}
                {!verified && (
                  <div className="mt-4 p-3 rounded-xl flex items-center gap-3 text-left"
                    style={{
                      background: opCfg.risk === "critical" ? "rgba(255,45,85,0.06)" : "rgba(255,150,0,0.05)",
                      border: `1px solid ${opCfg.risk === "critical" ? "rgba(255,45,85,0.15)" : "rgba(255,150,0,0.12)"}`,
                    }}>
                    <div className="size-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: opCfg.risk === "critical" ? "rgba(255,45,85,0.12)" : "rgba(255,150,0,0.1)" }}>
                      <OpIcon className="size-4" style={{ color: opCfg.risk === "critical" ? "#FF2D55" : "#FF9500" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{opCfg.label}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
                        {targetName ? `Target: ${targetName}` : opCfg.desc}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-md"
                      style={{ background: opCfg.risk === "critical" ? "rgba(255,45,85,0.1)" : "rgba(255,150,0,0.08)" }}>
                      <div className="size-1.5 rounded-full" style={{ background: opCfg.risk === "critical" ? "#FF2D55" : "#FF9500" }} />
                      <span style={{ fontSize: 9, fontWeight: 700, color: opCfg.risk === "critical" ? "#FF2D55" : "#FF9500" }}>
                        {opCfg.risk.toUpperCase()}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* PIN Area */}
              {!verified && (
                <div className="px-6 py-6">
                  {/* Actor badge */}
                  <div className="flex items-center justify-center gap-2 mb-5">
                    <ActorIcon className="size-3.5" style={{ color: actCfg.color }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: actCfg.color }}>{actorName}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>· {actCfg.label}</span>
                  </div>

                  {/* PIN dots */}
                  <div className="flex items-center justify-center gap-3 mb-5">
                    {Array.from({ length: 6 }).map((_, i) => {
                      const filled = i < pin.length;
                      return (
                        <motion.div
                          key={i}
                          animate={filled ? { scale: [1.2, 1] } : { scale: 1 }}
                          transition={{ duration: 0.15 }}
                          className="size-3.5 rounded-full"
                          style={{
                            background: filled
                              ? (locked ? "#FF2D55" : "#00C8E0")
                              : "rgba(255,255,255,0.1)",
                            border: `1.5px solid ${filled ? (locked ? "#FF2D55" : "#00C8E0") : "rgba(255,255,255,0.15)"}`,
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* Show/hide toggle */}
                  <div className="flex items-center justify-center gap-1.5 mb-5">
                    <button
                      onClick={() => setShowPin(!showPin)}
                      className="flex items-center gap-1.5"
                      style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}
                    >
                      {showPin ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      {showPin ? "Hide" : "Show"} PIN
                    </button>
                    {showPin && pin.length > 0 && (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: "4px", marginLeft: 8 }}>
                        {pin.join("")}
                      </span>
                    )}
                  </div>

                  {/* Error / Lock */}
                  <AnimatePresence>
                    {(error || locked) && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2 p-3 rounded-xl mb-4"
                        style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.2)" }}
                      >
                        <AlertTriangle className="size-4 flex-shrink-0" style={{ color: "#FF2D55" }} />
                        <span style={{ fontSize: 11, color: "#FF2D55", lineHeight: 1.4 }}>
                          {locked ? `🔒 Locked — wait ${lockTime}s` : error}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Numpad */}
                  <div className="grid grid-cols-3 gap-2">
                    {NUMPAD.flat().map((d, i) => {
                      if (d === "") return <div key={i} />;
                      const isDelete = d === "⌫";
                      return (
                        <motion.button
                          key={i}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => isDelete ? handleDelete() : handleDigit(d)}
                          disabled={locked || (pin.length === 6)}
                          className="h-14 rounded-2xl flex items-center justify-center"
                          style={{
                            background: isDelete
                              ? "rgba(255,45,85,0.08)"
                              : "rgba(255,255,255,0.04)",
                            border: `1px solid ${isDelete ? "rgba(255,45,85,0.15)" : "rgba(255,255,255,0.06)"}`,
                            fontSize: isDelete ? 18 : 20,
                            fontWeight: 700,
                            color: isDelete ? "#FF2D55" : locked ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.85)",
                            cursor: locked ? "not-allowed" : "pointer",
                          }}
                        >
                          {d}
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* Hint */}
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: 16, lineHeight: 1.6 }}>
                    {SUPABASE_CONFIG.isConfigured
                      ? "Enter your secure PIN to continue"
                      : "Demo mode: use PIN 123456"
                    }
                  </p>
                </div>
              )}

              {/* Verified state */}
              {verified && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="px-6 pb-8 pt-4 text-center"
                >
                  <div className="flex items-center justify-center gap-2">
                    <div className="size-2 rounded-full" style={{ background: "#34C759" }} />
                    <span style={{ fontSize: 13, color: "#34C759", fontWeight: 600 }}>
                      Applying changes securely...
                    </span>
                  </div>
                  <div className="mt-4 flex justify-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="size-5 border-2 rounded-full"
                      style={{ borderColor: "rgba(52,199,89,0.3)", borderTopColor: "#34C759" }}
                    />
                  </div>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
