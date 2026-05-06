/**
 * MFAChallengeModal — gate at sign-in for users with a verified TOTP factor.
 *
 * Flow:
 *   1. signInWithPassword / OAuth completes → session.aal === "aal1".
 *   2. mfaListFactors().hasTotp === true → render this modal.
 *   3. User enters 6-digit code OR clicks "Use a recovery code" link.
 *   4. mfaChallengeAndVerify → session upgrades to aal2.
 *   5. onVerified() callback fires; caller proceeds to dashboard / app.
 *
 * Recovery flow:
 *   • Switch the form to "recovery code" mode (AAAA-AAAA input).
 *   • mfaConsumeRecoveryCode burns one code on success.
 *   • IMPORTANT: consuming a recovery code DOES NOT elevate AAL in
 *     Supabase. The user gets through the gate via the app-side
 *     onVerified callback. If your server-side endpoints require aal2,
 *     they'll still reject — recovery codes only get the user to the
 *     dashboard so they can re-enroll a new TOTP factor / disable MFA.
 *     We make this clear in the post-success message.
 *
 * Lockout:
 *   • Supabase enforces its own MFA rate limits server-side.
 *   • Our recovery RPC also limits 10 failed consumes / hour.
 */

import { useState } from "react";
import { motion } from "motion/react";
import { Shield, KeyRound, AlertTriangle, ArrowRight, X } from "lucide-react";
import { mfaChallengeAndVerify, mfaConsumeRecoveryCode } from "./api/mfa-client";

export interface MFAChallengeModalProps {
  factorId: string;
  /** Called once verification succeeds (TOTP or recovery). */
  onVerified: (mode: "totp" | "recovery") => void;
  /** Called if the user clicks "Sign out" — caller should run completeLogout. */
  onCancel: () => void;
}

type Mode = "totp" | "recovery";

export function MFAChallengeModal({ factorId, onVerified, onCancel }: MFAChallengeModalProps) {
  const [mode, setMode]       = useState<Mode>("totp");
  const [code, setCode]       = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError]     = useState("");
  const [recoveryRemaining, setRecoveryRemaining] = useState<number | null>(null);

  const submit = async () => {
    setError("");
    if (mode === "totp") {
      if (code.length !== 6) {
        setError("Enter the 6-digit code from your authenticator.");
        return;
      }
      setVerifying(true);
      const r = await mfaChallengeAndVerify(factorId, code);
      setVerifying(false);
      if (r.error) {
        setError(r.error.message || "Invalid code. Try again.");
        setCode("");
        return;
      }
      onVerified("totp");
      return;
    }
    // recovery mode
    if (code.replace(/[^A-Za-z0-9]/g, "").length < 8) {
      setError("Recovery codes are 8 characters (e.g. ABCD-EFGH).");
      return;
    }
    setVerifying(true);
    const r = await mfaConsumeRecoveryCode(code);
    setVerifying(false);
    if (r.error || !r.data) {
      setError(r.error?.message || "Recovery code rejected.");
      setCode("");
      return;
    }
    setRecoveryRemaining(r.data.remaining);
    // Brief pause so user sees the "remaining" count, then proceed.
    setTimeout(() => onVerified("recovery"), 1200);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(5,7,14,0.92)", backdropFilter: "blur(10px)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0,  scale: 1 }}
        style={{ width: "100%", maxWidth: 420, background: "#0A0F1C", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, overflow: "hidden", fontFamily: "'Outfit', sans-serif" }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(0,200,224,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {mode === "totp"
                ? <Shield   size={16} style={{ color: "#00C8E0" }} />
                : <KeyRound size={16} style={{ color: "#00C8E0" }} />}
            </div>
            <p style={{ color: "rgba(255,255,255,0.95)", fontSize: 15, fontWeight: 700, margin: 0 }}>
              {mode === "totp" ? "Two-Factor Authentication" : "Recovery Code"}
            </p>
          </div>
          <button onClick={onCancel} title="Sign out" style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
            {mode === "totp"
              ? "Enter the 6-digit code from your authenticator app to continue."
              : "Enter one of the 8-character recovery codes you saved when enabling MFA. Each code works once."}
          </p>

          <input
            inputMode={mode === "totp" ? "numeric" : "text"}
            pattern={mode === "totp" ? "[0-9]*" : undefined}
            autoFocus
            maxLength={mode === "totp" ? 6 : 9}
            value={code}
            onChange={(e) => {
              const v = e.target.value;
              if (mode === "totp") setCode(v.replace(/\D/g, "").slice(0, 6));
              else setCode(v.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 9));
              setError("");
            }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={mode === "totp" ? "000000" : "ABCD-EFGH"}
            style={{
              width: "100%", height: 56, borderRadius: 14,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              color: "#fff", fontSize: mode === "totp" ? 24 : 18,
              fontWeight: 800, letterSpacing: mode === "totp" ? 12 : 4,
              textAlign: "center", outline: "none", marginBottom: 12,
              fontFamily: "ui-monospace, monospace",
            }}
          />

          {error && (
            <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.2)", marginBottom: 12 }}>
              <AlertTriangle size={14} style={{ color: "#FF2D55", flexShrink: 0, marginTop: 2 }} />
              <p style={{ color: "rgba(255,150,160,0.95)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>{error}</p>
            </div>
          )}

          {recoveryRemaining !== null && (
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.2)", marginBottom: 12 }}>
              <p style={{ color: "rgba(150,230,180,0.95)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                Recovery code accepted. {recoveryRemaining} code{recoveryRemaining === 1 ? "" : "s"} remaining. Sign in to your dashboard now and re-enroll a new authenticator from Settings.
              </p>
            </div>
          )}

          <button
            onClick={submit}
            disabled={verifying || (mode === "totp" ? code.length !== 6 : code.replace(/[^A-Za-z0-9]/g, "").length < 8)}
            style={{
              width: "100%", height: 48, borderRadius: 14, border: "none",
              background: (verifying || (mode === "totp" ? code.length !== 6 : code.replace(/[^A-Za-z0-9]/g, "").length < 8))
                ? "rgba(255,255,255,0.06)"
                : "linear-gradient(135deg, #00C8E0, #00A5C0)",
              color: (verifying || (mode === "totp" ? code.length !== 6 : code.replace(/[^A-Za-z0-9]/g, "").length < 8)) ? "rgba(255,255,255,0.3)" : "#03131A",
              fontSize: 14, fontWeight: 700, cursor: verifying ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {verifying ? "Verifying..." : "Verify & continue"} <ArrowRight size={14} />
          </button>

          {/* Switch mode */}
          <button
            onClick={() => { setMode(mode === "totp" ? "recovery" : "totp"); setCode(""); setError(""); }}
            style={{
              width: "100%", marginTop: 12, padding: 8,
              background: "transparent", border: "none",
              color: "rgba(0,200,224,0.7)", fontSize: 12, fontWeight: 600, cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {mode === "totp" ? "Use a recovery code instead" : "Back to authenticator code"}
          </button>

          {/* Sign out escape */}
          <button
            onClick={onCancel}
            style={{
              width: "100%", marginTop: 4, padding: 6,
              background: "transparent", border: "none",
              color: "rgba(255,255,255,0.3)", fontSize: 11, cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </div>
      </motion.div>
    </div>
  );
}
