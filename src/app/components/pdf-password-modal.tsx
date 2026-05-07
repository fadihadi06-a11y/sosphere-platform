// ═══════════════════════════════════════════════════════════════
// SOSphere — PDF Password Protection Modal (v2)
// Professional glassmorphism modal for setting PDF encryption
// Features: remember preference, encryption validation, email hook
// Used by Compliance Reports & Audit Log PDF export
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Lock, Eye, EyeOff, Shield, ShieldCheck, X,
  FileText, Key, CheckCircle2, AlertTriangle,
  Save, RotateCcw, Info,
} from "lucide-react";

import { storeJSONSync, loadJSONSync, removeJSONSync } from "./api/storage-adapter";

// ── Storage Key ────────────────────────────────────────────────
const LS_KEY = "sosphere_pdf_enc_prefs";

interface SavedPrefs {
  enableProtection: boolean;
  permissions: PdfPermission[];
  savedAt: number;
}

function loadSavedPrefs(): SavedPrefs | null {
  const parsed = loadJSONSync<SavedPrefs | null>(LS_KEY, null);
  if (parsed && typeof parsed.enableProtection === "boolean") return parsed;
  return null;
}

function savePrefs(prefs: SavedPrefs) {
  storeJSONSync(LS_KEY, prefs);
}

function clearPrefs() {
  removeJSONSync(LS_KEY);
}

// ── Password Strength Evaluator ────────────────────────────────
function evaluateStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "transparent" };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score: 1, label: "Weak", color: "#FF2D55" };
  if (score <= 2) return { score: 2, label: "Fair", color: "#FF9500" };
  if (score <= 3) return { score: 3, label: "Good", color: "#FFD60A" };
  if (score <= 4) return { score: 4, label: "Strong", color: "#00C853" };
  return { score: 5, label: "Excellent", color: "#00C8E0" };
}

// ── Encryption Compatibility Test ──────────────────────────────
// Tests if jsPDF supports encryption by creating a tiny test doc
let encryptionSupported: boolean | null = null;
let encryptionMethod = "Standard PDF Encryption (RC4-128)";

async function testEncryptionSupport(): Promise<boolean> {
  if (encryptionSupported !== null) return encryptionSupported;
  try {
    const { default: jsPDF } = await import("jspdf");
    const testDoc = new jsPDF({
      encryption: {
        userPassword: "test",
        ownerPassword: "testowner",
        userPermissions: ["print"],
      },
    } as any);
    // If constructor didn't throw, encryption is supported
    testDoc.text("test", 10, 10);
    // Check if output works without error
    testDoc.output("arraybuffer");
    encryptionSupported = true;
    encryptionMethod = "Standard PDF Encryption (RC4-128)";
    return true;
  } catch (err) {
    console.warn("[SOSphere] jsPDF encryption not supported:", err);
    encryptionSupported = false;
    return false;
  }
}

// ── Permission Options ─────────────────────────────────────────
type PdfPermission = "print" | "copy" | "modify" | "annot-forms";

const PERMISSIONS: { id: PdfPermission; label: string; desc: string; icon: any }[] = [
  { id: "print",       label: "Allow Printing",      desc: "Recipients can print the document", icon: FileText },
  { id: "copy",        label: "Allow Copy/Paste",     desc: "Text and images can be copied",     icon: Key },
  { id: "modify",      label: "Allow Modifications",  desc: "Document can be edited",            icon: Shield },
  { id: "annot-forms", label: "Allow Annotations",    desc: "Comments and form fill allowed",    icon: ShieldCheck },
];

// ── Types ──────────────────────────────────────────────────────
export interface PdfEncryptionConfig {
  password: string;
  ownerPassword: string;
  permissions: PdfPermission[];
}

interface PdfPasswordModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (config: PdfEncryptionConfig | null) => void;
  title?: string;
  description?: string;
}

// ── Encryption-safe jsPDF helper (exported for consumers) ──────
// Returns the encryption options to merge into jsPDF constructor
export function getEncryptionOptions(encConfig: PdfEncryptionConfig | null): any {
  if (!encConfig) return {};
  return {
    encryption: {
      userPassword: encConfig.password,
      ownerPassword: encConfig.ownerPassword,
      userPermissions: encConfig.permissions,
    },
  };
}

// ══════════════════��════════════════════════════════════════════
// MAIN MODAL
// ═══════════════════════════════════════════════════════════════
export function PdfPasswordModal({
  open,
  onClose,
  onConfirm,
  title = "PDF Security",
  description = "Protect this report with password encryption",
}: PdfPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [enableProtection, setEnableProtection] = useState(true);
  const [permissions, setPermissions] = useState<PdfPermission[]>(["print"]);
  const [rememberPrefs, setRememberPrefs] = useState(false);
  const [encSupported, setEncSupported] = useState<boolean | null>(null);
  const [testingEnc, setTestingEnc] = useState(false);
  const hasRestoredRef = useRef(false);

  // Restore saved preferences on mount
  useEffect(() => {
    if (open && !hasRestoredRef.current) {
      const saved = loadSavedPrefs();
      if (saved) {
        setEnableProtection(saved.enableProtection);
        setPermissions(saved.permissions);
        setRememberPrefs(true);
      }
      hasRestoredRef.current = true;
    }
    if (!open) {
      // Reset form when closed
      setPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      hasRestoredRef.current = false;
    }
  }, [open]);

  // Test encryption support when modal opens
  useEffect(() => {
    if (open && encSupported === null && !testingEnc) {
      setTestingEnc(true);
      testEncryptionSupport().then(result => {
        setEncSupported(result);
        setTestingEnc(false);
      });
    }
  }, [open, encSupported, testingEnc]);

  const strength = evaluateStrength(password);
  const passwordsMatch = password === confirmPassword;
  const isValid = !enableProtection || (password.length >= 4 && passwordsMatch);

  const togglePermission = (id: PdfPermission) => {
    setPermissions(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleConfirm = () => {
    // Save preferences if toggle is on
    if (rememberPrefs) {
      savePrefs({
        enableProtection,
        permissions,
        savedAt: Date.now(),
      });
    } else {
      clearPrefs();
    }

    if (!enableProtection) {
      onConfirm(null);
      return;
    }
    onConfirm({
      password,
      ownerPassword: password + "_sosphere_owner_" + Date.now().toString(36),
      permissions,
    });
  };

  const handleSkip = () => {
    if (rememberPrefs) {
      savePrefs({ enableProtection: false, permissions, savedAt: Date.now() });
    }
    onConfirm(null);
  };

  const handleClearSaved = () => {
    clearPrefs();
    setRememberPrefs(false);
    setEnableProtection(true);
    setPermissions(["print"]);
  };

  const savedPrefs = loadSavedPrefs();
  const hasSavedPrefs = savedPrefs !== null;
  const savedAgo = hasSavedPrefs
    ? Math.round((Date.now() - savedPrefs.savedAt) / 60000)
    : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[400] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(12px)" }}
        >
          <motion.div
            initial={{ scale: 0.88, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative w-full max-w-md mx-4"
            style={{
              background: "linear-gradient(180deg, #0E1529 0%, #080C18 100%)",
              borderRadius: 24,
              border: "1px solid rgba(0,200,224,0.12)",
              boxShadow: "0 40px 100px rgba(0,0,0,0.7), 0 0 60px rgba(0,200,224,0.05)",
              overflow: "hidden",
              maxHeight: "90vh",
            }}
          >
            {/* Scrollable content */}
            <div style={{ maxHeight: "90vh", overflowY: "auto" }}>
              {/* Decorative top glow */}
              <div className="absolute top-0 left-0 right-0 h-px"
                style={{ background: "linear-gradient(90deg, transparent, rgba(0,200,224,0.3), transparent)" }} />

              {/* Header */}
              <div className="px-6 pt-6 pb-4 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-2xl flex items-center justify-center"
                    style={{
                      background: "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.04))",
                      border: "1px solid rgba(0,200,224,0.15)",
                    }}>
                    <Lock className="size-5" style={{ color: "#00C8E0" }} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>{title}</h3>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>{description}</p>
                  </div>
                </div>
                <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
                </button>
              </div>

              {/* Encryption Support Status */}
              {testingEnc && (
                <div className="px-6 mb-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    >
                      <RotateCcw className="size-3" style={{ color: "rgba(0,200,224,0.5)" }} />
                    </motion.div>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Testing encryption compatibility...</span>
                  </div>
                </div>
              )}
              {encSupported === false && (
                <div className="px-6 mb-3">
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
                    style={{ background: "rgba(255,149,0,0.04)", border: "1px solid rgba(255,149,0,0.12)" }}>
                    <AlertTriangle className="size-3.5 shrink-0 mt-0.5" style={{ color: "#FF9500" }} />
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "#FF9500" }}>Encryption Compatibility Notice</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2, lineHeight: 1.5 }}>
                        Your jsPDF version may not fully support password encryption. The PDF will still be generated, but without password protection. Upgrade to jsPDF 2.5+ for full encryption support.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {encSupported === true && (
                <div className="px-6 mb-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background: "rgba(0,200,83,0.03)", border: "1px solid rgba(0,200,83,0.08)" }}>
                    <CheckCircle2 className="size-3" style={{ color: "#00C853" }} />
                    <span style={{ fontSize: 10, color: "rgba(0,200,83,0.7)", fontWeight: 600 }}>
                      {encryptionMethod} verified
                    </span>
                  </div>
                </div>
              )}

              {/* Toggle Protection */}
              <div className="px-6 mb-4">
                <button onClick={() => setEnableProtection(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{
                    background: enableProtection ? "rgba(0,200,224,0.04)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${enableProtection ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)"}`,
                  }}>
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="size-4" style={{ color: enableProtection ? "#00C8E0" : "rgba(255,255,255,0.2)" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: enableProtection ? "#fff" : "rgba(255,255,255,0.4)" }}>
                      Enable Password Protection
                    </span>
                  </div>
                  <div className="relative shrink-0" style={{
                    width: 40, height: 22, borderRadius: 11,
                    background: enableProtection ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.06)",
                    border: `1.5px solid ${enableProtection ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.08)"}`,
                    transition: "all 0.2s",
                  }}>
                    <motion.div initial={false} animate={{ x: enableProtection ? 18 : 2 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-[2px]"
                      style={{ width: 16, height: 16, borderRadius: 8, background: enableProtection ? "#00C8E0" : "rgba(255,255,255,0.25)" }} />
                  </div>
                </button>
              </div>

              {/* Password Fields (only if enabled) */}
              <AnimatePresence>
                {enableProtection && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="px-6 space-y-3">
                      {/* Password */}
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          Password
                        </label>
                        <div className="relative mt-1.5">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4" style={{ color: "rgba(255,255,255,0.15)" }} />
                          <input
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password (min 4 chars)"
                            className="w-full pl-10 pr-10 py-2.5 rounded-xl outline-none"
                            style={{
                              background: "rgba(255,255,255,0.03)",
                              border: `1px solid ${password.length > 0 ? `${strength.color}30` : "rgba(255,255,255,0.06)"}`,
                              fontSize: 13,
                              color: "#fff",
                              fontFamily: "Outfit, sans-serif",
                            }}
                          />
                          <button onClick={() => setShowPassword(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2">
                            {showPassword
                              ? <EyeOff className="size-4" style={{ color: "rgba(255,255,255,0.2)" }} />
                              : <Eye className="size-4" style={{ color: "rgba(255,255,255,0.2)" }} />
                            }
                          </button>
                        </div>
                        {/* Strength Bar */}
                        {password.length > 0 && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex gap-1 flex-1">
                              {[1, 2, 3, 4, 5].map(i => (
                                <div key={i} className="flex-1 h-1 rounded-full" style={{
                                  background: i <= strength.score ? strength.color : "rgba(255,255,255,0.06)",
                                  transition: "all 0.3s",
                                }} />
                              ))}
                            </div>
                            <span style={{ fontSize: 9, fontWeight: 700, color: strength.color }}>{strength.label}</span>
                          </div>
                        )}
                      </div>

                      {/* Confirm Password */}
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          Confirm Password
                        </label>
                        <div className="relative mt-1.5">
                          <Key className="absolute left-3 top-1/2 -translate-y-1/2 size-4" style={{ color: "rgba(255,255,255,0.15)" }} />
                          <input
                            type={showPassword ? "text" : "password"}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm password"
                            className="w-full pl-10 pr-10 py-2.5 rounded-xl outline-none"
                            style={{
                              background: "rgba(255,255,255,0.03)",
                              border: `1px solid ${confirmPassword.length > 0 ? (passwordsMatch ? "rgba(0,200,83,0.25)" : "rgba(255,45,85,0.25)") : "rgba(255,255,255,0.06)"}`,
                              fontSize: 13,
                              color: "#fff",
                              fontFamily: "Outfit, sans-serif",
                            }}
                          />
                          {confirmPassword.length > 0 && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              {passwordsMatch
                                ? <CheckCircle2 className="size-4" style={{ color: "#00C853" }} />
                                : <AlertTriangle className="size-4" style={{ color: "#FF2D55" }} />
                              }
                            </div>
                          )}
                        </div>
                        {confirmPassword.length > 0 && !passwordsMatch && (
                          <p style={{ fontSize: 10, color: "#FF2D55", marginTop: 4 }}>Passwords don't match</p>
                        )}
                      </div>

                      {/* Permissions */}
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "block" }}>
                          Reader Permissions
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {PERMISSIONS.map(perm => {
                            const active = permissions.includes(perm.id);
                            return (
                              <button key={perm.id} onClick={() => togglePermission(perm.id)}
                                className="flex items-center gap-2 px-3 py-2 rounded-xl text-left"
                                style={{
                                  background: active ? "rgba(0,200,224,0.04)" : "rgba(255,255,255,0.015)",
                                  border: `1px solid ${active ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}`,
                                  transition: "all 0.2s",
                                }}>
                                <perm.icon className="size-3.5" style={{ color: active ? "#00C8E0" : "rgba(255,255,255,0.15)" }} />
                                <div>
                                  <p style={{ fontSize: 10, fontWeight: 600, color: active ? "#fff" : "rgba(255,255,255,0.3)" }}>{perm.label}</p>
                                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", marginTop: 1 }}>{perm.desc}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Remember Preference Toggle ──────────────────── */}
              <div className="px-6 mt-4">
                <button onClick={() => setRememberPrefs(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl"
                  style={{
                    background: rememberPrefs ? "rgba(139,92,246,0.04)" : "rgba(255,255,255,0.015)",
                    border: `1px solid ${rememberPrefs ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.04)"}`,
                    transition: "all 0.2s",
                  }}>
                  <div className="flex items-center gap-2.5">
                    <Save className="size-3.5" style={{ color: rememberPrefs ? "#8B5CF6" : "rgba(255,255,255,0.15)" }} />
                    <div className="text-left">
                      <span style={{ fontSize: 11, fontWeight: 600, color: rememberPrefs ? "#fff" : "rgba(255,255,255,0.35)" }}>
                        Remember my preferences
                      </span>
                      <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>
                        {hasSavedPrefs
                          ? `Last saved ${savedAgo < 1 ? "just now" : savedAgo < 60 ? `${savedAgo}m ago` : `${Math.round(savedAgo / 60)}h ago`}`
                          : "Save protection & permission choices for next time"
                        }
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasSavedPrefs && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleClearSaved(); }}
                        className="px-2 py-1 rounded-lg"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <RotateCcw className="size-3" style={{ color: "rgba(255,255,255,0.25)" }} />
                      </button>
                    )}
                    <div className="relative shrink-0" style={{
                      width: 36, height: 20, borderRadius: 10,
                      background: rememberPrefs ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)",
                      border: `1.5px solid ${rememberPrefs ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.08)"}`,
                      transition: "all 0.2s",
                    }}>
                      <motion.div initial={false} animate={{ x: rememberPrefs ? 16 : 2 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="absolute top-[2px]"
                        style={{ width: 14, height: 14, borderRadius: 7, background: rememberPrefs ? "#8B5CF6" : "rgba(255,255,255,0.25)" }} />
                    </div>
                  </div>
                </button>
              </div>

              {/* Info Box */}
              <div className="px-6 mt-3">
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
                  style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.06)" }}>
                  <Info className="size-3.5 shrink-0 mt-0.5" style={{ color: "rgba(0,200,224,0.4)" }} />
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
                    {enableProtection
                      ? encSupported === false
                        ? "Encryption is not available with the current jsPDF version. The PDF will be generated without password protection. Consider upgrading jsPDF for full encryption support."
                        : `The PDF will be encrypted using ${encryptionMethod}. Recipients will need the password to open the document. Password is NOT stored anywhere.`
                      : "The PDF will be generated without password protection. Anyone with the file can open it."
                    }
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="px-6 py-5 flex items-center gap-3">
                <button onClick={handleSkip}
                  className="flex-1 py-2.5 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>
                  Skip Protection
                </button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={handleConfirm}
                  disabled={!isValid}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl"
                  style={{
                    background: isValid
                      ? "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.06))"
                      : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isValid ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
                    fontSize: 12,
                    fontWeight: 700,
                    color: isValid ? "#00C8E0" : "rgba(255,255,255,0.15)",
                    cursor: isValid ? "pointer" : "not-allowed",
                  }}>
                  <Lock className="size-3.5" />
                  {enableProtection ? "Encrypt & Generate" : "Generate PDF"}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}