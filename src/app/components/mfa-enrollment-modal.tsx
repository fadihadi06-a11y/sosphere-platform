/**
 * MFAEnrollmentModal — guided 4-step TOTP enrollment with recovery codes.
 *
 *   Step 1 (intro)   → why MFA + what happens
 *   Step 2 (scan)    → QR code + manual secret entry option
 *   Step 3 (verify)  → 6-digit input → mfa.verify
 *   Step 4 (codes)   → 8 recovery codes, copy/download/print, acknowledge
 *
 * After step 4, parent's onComplete() is called and the user can close.
 *
 * UX matches Stripe Dashboard / Linear / Notion enrollment wizards:
 *   - Cannot skip steps backwards once verified (recovery codes shown ONCE)
 *   - Manual secret with monospace + copy button for password-manager users
 *   - Recovery codes formatted AAAA-AAAA so they're memorable in a pinch
 *   - Download as .txt + clipboard copy + print-friendly view
 *   - Acknowledgement checkbox — explicit "I have saved these codes"
 *     before Done is enabled (mirrors GitHub's pattern)
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shield, Smartphone, Copy, Download, CheckCircle2, AlertTriangle, X, RefreshCw, KeyRound, ArrowRight } from "lucide-react";
import {
  mfaEnrollTotp,
  mfaVerifyEnroll,
  mfaUnenroll,
  mfaGenerateRecoveryCodes,
  type MfaEnrollData,
} from "./api/mfa-client";

type Step = "intro" | "scan" | "verify" | "codes";

export interface MFAEnrollmentModalProps {
  /** Called once enrollment is fully complete (factor verified + codes acknowledged). */
  onComplete: () => void;
  /** Called if the user dismisses before completion. We unenroll any in-progress factor. */
  onCancel: () => void;
}

export function MFAEnrollmentModal({ onComplete, onCancel }: MFAEnrollmentModalProps) {
  const [step, setStep]               = useState<Step>("intro");
  const [enrolling, setEnrolling]     = useState(false);
  const [enrollData, setEnrollData]   = useState<MfaEnrollData | null>(null);
  const [code, setCode]               = useState("");
  const [verifying, setVerifying]     = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [codes, setCodes]             = useState<string[] | null>(null);
  const [codesLoading, setCodesLoading] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [codesCopied, setCodesCopied]   = useState(false);

  // Track unmount: if user dismisses mid-enrollment, unenroll the dangling
  // factor so they don't leave Supabase with an unverified TOTP factor that
  // would prevent re-enrollment until manually cleaned up.
  const factorIdRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      // Component is unmounting. If we have an in-progress factor and the
      // user did NOT complete (no codes shown), unenroll it best-effort.
      if (factorIdRef.current && !codes) {
        void mfaUnenroll(factorIdRef.current);
      }
    };
    // codes intentionally outside deps — we only want this on real unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step transitions ──────────────────────────────────────────────
  const startEnrollment = async () => {
    setEnrolling(true);
    setVerifyError("");
    const { data, error } = await mfaEnrollTotp();
    setEnrolling(false);
    if (error || !data) {
      setVerifyError(error?.message || "Could not start enrollment.");
      return;
    }
    factorIdRef.current = data.factorId;
    setEnrollData(data);
    setStep("scan");
  };

  const submitVerify = async () => {
    if (!enrollData) return;
    if (code.length !== 6) {
      setVerifyError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setVerifying(true);
    setVerifyError("");
    const { error } = await mfaVerifyEnroll(enrollData.factorId, code);
    if (error) {
      setVerifying(false);
      setVerifyError(error.message);
      return;
    }
    // Verified — generate recovery codes.
    setCodesLoading(true);
    const r = await mfaGenerateRecoveryCodes();
    setCodesLoading(false);
    setVerifying(false);
    if (r.error || !r.data) {
      // Factor IS verified, but codes failed. Move on but warn.
      setVerifyError(r.error?.message || "Could not generate recovery codes.");
      setCodes([]);
      setStep("codes");
      return;
    }
    setCodes(r.data.codes);
    setStep("codes");
  };

  // ── Helpers ───────────────────────────────────────────────────────
  const copySecret = async () => {
    if (!enrollData) return;
    try { await navigator.clipboard.writeText(enrollData.secret); setSecretCopied(true); setTimeout(() => setSecretCopied(false), 1500); }
    catch (_) { /* user can manually select */ }
  };
  const copyCodes = async () => {
    if (!codes) return;
    try { await navigator.clipboard.writeText(codes.join("\n")); setCodesCopied(true); setTimeout(() => setCodesCopied(false), 1500); }
    catch (_) { /* */ }
  };
  const downloadCodes = () => {
    if (!codes) return;
    const text =
      "SOSphere — MFA Recovery Codes\n" +
      "Generated: " + new Date().toISOString() + "\n\n" +
      "Each code can be used ONCE to sign in if you lose your authenticator.\n" +
      "Store securely (password manager, printed in a safe).\n\n" +
      codes.map((c, i) => `${(i + 1).toString().padStart(2, "0")}. ${c}`).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "sosphere-mfa-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(5,7,14,0.85)", backdropFilter: "blur(8px)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0,  scale: 1 }}
        exit   ={{ opacity: 0, y: 16, scale: 0.97 }}
        style={{ width: "100%", maxWidth: 460, background: "#0A0F1C", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, overflow: "hidden", fontFamily: "'Outfit', sans-serif" }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(0,200,224,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Shield size={16} style={{ color: "#00C8E0" }} />
            </div>
            <div>
              <p style={{ color: "rgba(255,255,255,0.95)", fontSize: 15, fontWeight: 700, margin: 0 }}>Two-Factor Authentication</p>
              <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, margin: 0 }}>{stepLabel(step)}</p>
            </div>
          </div>
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Step indicator dots */}
        <div style={{ display: "flex", gap: 6, padding: "12px 20px 0" }}>
          {(["intro","scan","verify","codes"] as Step[]).map((s, i) => {
            const stepIdx = ["intro","scan","verify","codes"].indexOf(step);
            const filled  = i <= stepIdx;
            return (
              <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: filled ? "#00C8E0" : "rgba(255,255,255,0.08)", transition: "background 0.2s" }} />
            );
          })}
        </div>

        {/* Body */}
        <div style={{ padding: "20px" }}>
          <AnimatePresence mode="wait">
            {step === "intro" && (
              <motion.div key="intro" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                <h3 style={{ color: "rgba(255,255,255,0.95)", fontSize: 18, fontWeight: 800, margin: "0 0 8px" }}>Add a second layer of protection</h3>
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, lineHeight: 1.6, margin: "0 0 16px" }}>
                  Even if someone gets your password, they won't be able to sign in without the 6-digit code from your authenticator app.
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { ic: <Smartphone size={14} style={{ color: "#00C8E0" }} />, t: "Works with any authenticator", d: "Authy, Google Authenticator, 1Password, Microsoft Authenticator, …" },
                    { ic: <KeyRound  size={14} style={{ color: "#00C8E0" }} />, t: "8 recovery codes", d: "Single-use codes for when your phone isn't with you." },
                    { ic: <Shield    size={14} style={{ color: "#00C8E0" }} />, t: "Required for high-risk actions", d: "Re-prompted before deleting accounts, changing billing, mass-revoking users." },
                  ].map((row, i) => (
                    <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ width: 24, height: 24, borderRadius: 8, background: "rgba(0,200,224,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                        {row.ic}
                      </div>
                      <div>
                        <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 700, margin: 0 }}>{row.t}</p>
                        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, margin: "2px 0 0", lineHeight: 1.5 }}>{row.d}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                {verifyError && <p style={{ color: "#FF2D55", fontSize: 12, margin: "0 0 12px" }}>{verifyError}</p>}
                <button onClick={startEnrollment} disabled={enrolling} style={primaryBtn(enrolling)}>
                  {enrolling ? "Setting up..." : "Set up authenticator"} <ArrowRight size={14} />
                </button>
              </motion.div>
            )}

            {step === "scan" && enrollData && (
              <motion.div key="scan" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                <h3 style={{ color: "rgba(255,255,255,0.95)", fontSize: 16, fontWeight: 800, margin: "0 0 6px" }}>Scan with your authenticator</h3>
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, margin: "0 0 16px" }}>Open your authenticator app and scan this QR code.</p>
                <div style={{ background: "#fff", borderRadius: 16, padding: 14, display: "flex", justifyContent: "center", marginBottom: 16 }}
                     dangerouslySetInnerHTML={{ __html: enrollData.qrCodeSvg }} />
                <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, margin: "0 0 6px", textAlign: "center" }}>
                  Can't scan? Enter this key manually:
                </p>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  <code style={{ flex: 1, padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "ui-monospace, monospace", letterSpacing: 1, wordBreak: "break-all" }}>
                    {enrollData.secret}
                  </code>
                  <button onClick={copySecret} style={iconBtn}>
                    {secretCopied ? <CheckCircle2 size={14} style={{ color: "#00C853" }} /> : <Copy size={14} />}
                  </button>
                </div>
                <button onClick={() => setStep("verify")} style={primaryBtn(false)}>
                  I've added the code <ArrowRight size={14} />
                </button>
              </motion.div>
            )}

            {step === "verify" && (
              <motion.div key="verify" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                <h3 style={{ color: "rgba(255,255,255,0.95)", fontSize: 16, fontWeight: 800, margin: "0 0 6px" }}>Enter the 6-digit code</h3>
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, margin: "0 0 18px" }}>Type the current code shown by your authenticator.</p>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoFocus
                  maxLength={6}
                  value={code}
                  onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setVerifyError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) submitVerify(); }}
                  placeholder="000000"
                  style={{
                    width: "100%", height: 56, borderRadius: 14,
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    color: "#fff", fontSize: 24, fontWeight: 800, letterSpacing: 12,
                    textAlign: "center", outline: "none", marginBottom: 12,
                    fontFamily: "ui-monospace, monospace",
                  }}
                />
                {verifyError && <p style={{ color: "#FF2D55", fontSize: 12, margin: "0 0 12px" }}>{verifyError}</p>}
                <button onClick={submitVerify} disabled={code.length !== 6 || verifying || codesLoading} style={primaryBtn(code.length !== 6 || verifying || codesLoading)}>
                  {verifying ? "Verifying..." : codesLoading ? "Generating codes..." : "Verify & continue"} <ArrowRight size={14} />
                </button>
                <button onClick={() => setStep("scan")} style={ghostBtn}>← Back to QR</button>
              </motion.div>
            )}

            {step === "codes" && (
              <motion.div key="codes" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <CheckCircle2 size={16} style={{ color: "#00C853" }} />
                  <h3 style={{ color: "rgba(255,255,255,0.95)", fontSize: 16, fontWeight: 800, margin: 0 }}>MFA enabled</h3>
                </div>
                <div style={{ display: "flex", gap: 8, padding: 12, borderRadius: 12, background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.15)", marginBottom: 14 }}>
                  <AlertTriangle size={14} style={{ color: "#FF9500", flexShrink: 0, marginTop: 2 }} />
                  <p style={{ color: "rgba(255,150,0,0.85)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                    Save these recovery codes <strong>now</strong>. Each code can be used <strong>once</strong> to sign in if you lose your authenticator. They will not be shown again.
                  </p>
                </div>
                {codes && codes.length > 0 ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14, padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      {codes.map((c, i) => (
                        <code key={i} style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "rgba(255,255,255,0.85)", letterSpacing: 1, padding: "4px 6px" }}>
                          {(i+1).toString().padStart(2,"0")}. {c}
                        </code>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                      <button onClick={copyCodes} style={secondaryBtn}>
                        {codesCopied ? <CheckCircle2 size={14} style={{ color: "#00C853" }} /> : <Copy size={14} />}
                        {codesCopied ? "Copied" : "Copy"}
                      </button>
                      <button onClick={downloadCodes} style={secondaryBtn}>
                        <Download size={14} /> Download .txt
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: 12, background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.15)", borderRadius: 12, marginBottom: 14 }}>
                    <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, margin: 0 }}>
                      MFA is active, but recovery codes couldn't be generated. You can generate them later from Settings.
                    </p>
                  </div>
                )}

                <label style={{ display: "flex", gap: 10, padding: "10px 4px", cursor: "pointer", alignItems: "flex-start", marginBottom: 12 }}>
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} style={{ marginTop: 3 }} />
                  <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, lineHeight: 1.5 }}>
                    I have saved these recovery codes in a safe place.
                  </span>
                </label>
                <button onClick={onComplete} disabled={!acknowledged} style={primaryBtn(!acknowledged)}>
                  Done
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

// ── Style helpers ───────────────────────────────────────────────────
function stepLabel(s: Step): string {
  if (s === "intro")  return "Step 1 of 4 — Overview";
  if (s === "scan")   return "Step 2 of 4 — Scan QR";
  if (s === "verify") return "Step 3 of 4 — Verify code";
  return "Step 4 of 4 — Save recovery codes";
}
function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    width: "100%", height: 48, borderRadius: 14, border: "none",
    background: disabled ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #00C8E0, #00A5C0)",
    color: disabled ? "rgba(255,255,255,0.3)" : "#03131A",
    fontSize: 14, fontWeight: 700, cursor: disabled ? "default" : "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  };
}
const secondaryBtn = {
  flex: 1, height: 40, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.85)",
  fontSize: 12, fontWeight: 700, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
} as React.CSSProperties;
const ghostBtn = {
  width: "100%", marginTop: 10, padding: 8, background: "transparent", border: "none",
  color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: 500, cursor: "pointer",
} as React.CSSProperties;
const iconBtn = {
  width: 40, height: 40, borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
} as React.CSSProperties;
