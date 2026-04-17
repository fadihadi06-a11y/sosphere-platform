/**
 * Security PIN Modal — isolated UI for configuring both:
 *   1. Deactivation PIN — required to end SOS; prevents accidental/forced
 *      termination by someone who grabs the phone from the user.
 *   2. Duress PIN (Elite only) — a SECOND PIN that looks identical to a
 *      normal deactivation, but secretly flags the end event as duress
 *      so the dashboard/contacts know the user was coerced.
 *
 * Isolation notes:
 *   • Imports only from duress-service (pure storage) and lucide-react.
 *   • No dependency on sos-emergency.tsx or mobile-app.tsx state.
 *   • Renders as a portal-style overlay; parent just controls open/close.
 */

import { useState } from "react";
import { Shield, X, Eye, EyeOff, Lock, AlertTriangle } from "lucide-react";
import {
  getDeactivationPin, setDeactivationPin,
  getDuressPin, setDuressPin,
  isDuressFeatureAvailable,
} from "./duress-service";

interface Props {
  open: boolean;
  onClose: () => void;
  isAr?: boolean;
}

export function SecurityPinModal({ open, onClose, isAr = false }: Props) {
  const [normalPin, setNormalPin] = useState("");
  const [duressPinVal, setDuressPinVal] = useState("");
  const [showNormal, setShowNormal] = useState(false);
  const [showDuress, setShowDuress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const eliteUnlocked = isDuressFeatureAvailable();
  const currentNormal = getDeactivationPin();
  const currentDuress = getDuressPin();

  if (!open) return null;

  const t = (en: string, ar: string) => (isAr ? ar : en);

  const handleSaveNormal = async () => {
    setError(null);
    setSuccess(null);
    if (!/^\d{4,10}$/.test(normalPin)) {
      setError(t("Deactivation PIN must be 4–10 digits", "رمز الإلغاء يجب أن يكون 4–10 أرقام"));
      return;
    }
    // E-M1: setDeactivationPin is async now (hashes the PIN).
    const ok = await setDeactivationPin(normalPin);
    if (!ok) {
      setError(t("PIN conflicts with duress PIN — pick a different one", "الرمز مطابق لرمز الإكراه — اختر رمزاً مختلفاً"));
      return;
    }
    setSuccess(t("Deactivation PIN saved", "تم حفظ رمز الإلغاء"));
    setNormalPin("");
  };

  const handleSaveDuress = async () => {
    setError(null);
    setSuccess(null);
    if (!eliteUnlocked) {
      setError(t("Duress PIN is an Elite feature", "رمز الإكراه متوفّر في خطّة النخبة"));
      return;
    }
    if (!/^\d{4,10}$/.test(duressPinVal)) {
      setError(t("Duress PIN must be 4–10 digits", "رمز الإكراه يجب أن يكون 4–10 أرقام"));
      return;
    }
    // E-M1: setDuressPin is async now (hashes the PIN).
    const ok = await setDuressPin(duressPinVal);
    if (!ok) {
      setError(t(
        "Duress PIN must differ from deactivation PIN",
        "رمز الإكراه يجب أن يختلف عن رمز الإلغاء"
      ));
      return;
    }
    setSuccess(t("Duress PIN saved", "تم حفظ رمز الإكراه"));
    setDuressPinVal("");
  };

  const handleClearNormal = () => {
    // E-M1: setDeactivationPin is async. Fire-and-forget is safe here —
    // the local clear is idempotent and UI success message is independent.
    void setDeactivationPin(null);
    setSuccess(t("Deactivation PIN removed", "تم حذف رمز الإلغاء"));
    setError(null);
  };

  const handleClearDuress = () => {
    // E-M1: setDuressPin is async. Fire-and-forget is safe — the local
    // clear is idempotent.
    void setDuressPin(null);
    setSuccess(t("Duress PIN removed", "تم حذف رمز الإكراه"));
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5"
        style={{
          background: "linear-gradient(180deg, #1a1d24 0%, #0f1217 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.6)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield size={20} style={{ color: "#00C8E0" }} />
            <h3 style={{ color: "#fff", fontSize: 16, fontWeight: 600 }}>
              {t("Security PINs", "رموز الأمان")}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label={t("Close", "إغلاق")}
            className="p-1.5 rounded-md"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <X size={16} style={{ color: "rgba(255,255,255,0.6)" }} />
          </button>
        </div>

        {/* ── Deactivation PIN ── */}
        <section className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} style={{ color: "#00C8E0" }} />
            <h4 style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
              {t("Deactivation PIN", "رمز الإلغاء")}
            </h4>
            {currentNormal && (
              <span style={{ fontSize: 10, color: "#00C853", marginInlineStart: 4 }}>
                {t("● set", "● مُعيَّن")}
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 8, lineHeight: 1.5 }}>
            {t(
              "Required to end an active SOS. Protects you from accidental or forced deactivation.",
              "مطلوب لإنهاء أي طوارئ نشطة. يحميك من الإلغاء غير المقصود أو القسري."
            )}
          </p>
          <div className="relative mb-2">
            <input
              type={showNormal ? "text" : "password"}
              inputMode="numeric"
              pattern="\d*"
              maxLength={10}
              value={normalPin}
              onChange={(e) => setNormalPin(e.target.value.replace(/\D/g, ""))}
              placeholder={t("4–10 digits", "٤–١٠ أرقام")}
              className="w-full py-2 text-sm"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                color: "#fff",
                letterSpacing: 2,
                paddingInlineStart: 12,
                paddingInlineEnd: 36,
                boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              onClick={() => setShowNormal(!showNormal)}
              className="absolute top-1/2 -translate-y-1/2 p-1"
              style={{ [isAr ? "left" : "right"]: 8 } as React.CSSProperties}
            >
              {showNormal ? <EyeOff size={14} color="rgba(255,255,255,0.5)" /> : <Eye size={14} color="rgba(255,255,255,0.5)" />}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveNormal}
              className="flex-1 py-2 text-xs font-semibold"
              style={{
                background: "#00C8E0",
                color: "#0f1217",
                borderRadius: 8,
              }}
            >
              {t("Save", "حفظ")}
            </button>
            {currentNormal && (
              <button
                onClick={handleClearNormal}
                className="flex-1 py-2 text-xs font-semibold"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.7)",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {t("Clear", "حذف")}
              </button>
            )}
          </div>
        </section>

        {/* ── Duress PIN (Elite) ── */}
        <section className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} style={{ color: "#FF2D55" }} />
            <h4 style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
              {t("Duress PIN", "رمز الإكراه")}
            </h4>
            {!eliteUnlocked ? (
              <span style={{ fontSize: 10, color: "#FF9500", marginInlineStart: 4 }}>
                {t("Elite", "النخبة")}
              </span>
            ) : currentDuress ? (
              <span style={{ fontSize: 10, color: "#00C853", marginInlineStart: 4 }}>
                {t("● set", "● مُعيَّن")}
              </span>
            ) : null}
          </div>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 8, lineHeight: 1.5 }}>
            {t(
              "If you're forced to end SOS under coercion, enter this PIN instead. The SOS UI ends normally, but your dashboard and contacts receive a silent duress flag.",
              "إن أُجبرت على إنهاء الطوارئ تحت الإكراه، أدخل هذا الرمز بدلاً من رمز الإلغاء. تنتهي الواجهة بشكل طبيعي، ولكن لوحة التحكّم وجهات الاتصال تستلم إشارة إكراه صامتة."
            )}
          </p>
          <div style={{ opacity: eliteUnlocked ? 1 : 0.5 }}>
            <div className="relative mb-2">
              <input
                type={showDuress ? "text" : "password"}
                inputMode="numeric"
                pattern="\d*"
                maxLength={10}
                value={duressPinVal}
                onChange={(e) => setDuressPinVal(e.target.value.replace(/\D/g, ""))}
                placeholder={eliteUnlocked ? t("4–10 digits", "٤–١٠ أرقام") : t("Upgrade to Elite", "اشترك في النخبة")}
                disabled={!eliteUnlocked}
                className="w-full py-2 text-sm"
                style={{
                  background: "rgba(255,45,85,0.04)",
                  border: "1px solid rgba(255,45,85,0.15)",
                  borderRadius: 8,
                  color: "#fff",
                  letterSpacing: 2,
                  paddingInlineStart: 12,
                  paddingInlineEnd: 36,
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={() => setShowDuress(!showDuress)}
                disabled={!eliteUnlocked}
                className="absolute top-1/2 -translate-y-1/2 p-1"
                style={{ [isAr ? "left" : "right"]: 8 } as React.CSSProperties}
              >
                {showDuress ? <EyeOff size={14} color="rgba(255,255,255,0.5)" /> : <Eye size={14} color="rgba(255,255,255,0.5)" />}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveDuress}
                disabled={!eliteUnlocked}
                className="flex-1 py-2 text-xs font-semibold"
                style={{
                  background: eliteUnlocked ? "#FF2D55" : "rgba(255,45,85,0.3)",
                  color: "#fff",
                  borderRadius: 8,
                  cursor: eliteUnlocked ? "pointer" : "not-allowed",
                }}
              >
                {t("Save", "حفظ")}
              </button>
              {currentDuress && eliteUnlocked && (
                <button
                  onClick={handleClearDuress}
                  className="flex-1 py-2 text-xs font-semibold"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    color: "rgba(255,255,255,0.7)",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {t("Clear", "حذف")}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ── Status toast ── */}
        {error && (
          <div
            className="text-xs px-3 py-2 mb-2"
            style={{
              background: "rgba(255,45,85,0.08)",
              border: "1px solid rgba(255,45,85,0.18)",
              color: "#FF6B8A",
              borderRadius: 8,
            }}
          >
            {error}
          </div>
        )}
        {success && (
          <div
            className="text-xs px-3 py-2 mb-2"
            style={{
              background: "rgba(0,200,83,0.08)",
              border: "1px solid rgba(0,200,83,0.18)",
              color: "#4ADE80",
              borderRadius: 8,
            }}
          >
            {success}
          </div>
        )}
      </div>
    </div>
  );
}
