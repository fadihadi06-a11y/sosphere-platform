/**
 * Trial Card — one-time 7-day Elite trial CTA
 * ═════════════════════════════════════════════
 * Three visual states, resolved from trial-service alone:
 *   • not-started → "Start 7-day Elite trial"  (primary CTA)
 *   • active      → "Elite trial active · N days left"  (+ Cancel)
 *   • expired     → "Trial ended"  (passive; nudges upgrade)
 *
 * Self-contained. Reads/writes ONLY via trial-service so it can be
 * dropped anywhere without coupling to the surrounding screen.
 */

import { useState } from "react";
import { Crown, Clock, X, Check } from "lucide-react";
import {
  getTrialStatus,
  startTrialAsync,
  cancelTrial,
  getTrialDurationDays,
} from "./trial-service";
import { getStoredTier } from "./subscription-service";

interface Props {
  isAr?: boolean;
  /** Called when the user upgrades — parent can open the real upgrade flow. */
  onRequestUpgrade?: () => void;
}

export function TrialCard({ isAr = false, onRequestUpgrade }: Props) {
  const [, force] = useState(0);
  const [pending, setPending] = useState(false);
  const [denyReason, setDenyReason] = useState<string | null>(null);
  const rerender = () => force(v => v + 1);

  const status = getTrialStatus();
  const storedTier = getStoredTier();
  const t = (en: string, ar: string) => (isAr ? ar : en);

  // If the user already owns Elite, the trial card is irrelevant.
  if (storedTier === "elite") return null;

  // CRIT-#12 (2026-04-28): start handler now goes through the async,
  // server-validated path. Disable the button while in-flight, and surface
  // a reason if the server denies (e.g. trial already used on another device).
  const handleStart = async () => {
    if (pending) return;
    setPending(true);
    setDenyReason(null);
    try {
      const res = await startTrialAsync(getTrialDurationDays());
      if (res.success) {
        rerender();
      } else {
        const reason = res.networkError
          ? t("Network issue — please try again.", "مشكلة في الشبكة — حاول مرة أخرى.")
          : res.reason === "trial_already_used"
            ? t("You've already used your one-time trial.", "لقد استخدمت تجربتك المجانية بالفعل.")
            : res.reason === "trial_already_used_local"
              ? t("Trial already started on this device.", "التجربة تعمل على هذا الجهاز بالفعل.")
              : res.reason === "unauthorized"
                ? t("Please sign in to start your trial.", "يرجى تسجيل الدخول لبدء التجربة.")
                : t("Trial unavailable right now.", "التجربة غير متاحة حالياً.");
        setDenyReason(reason);
        rerender();
      }
    } finally {
      setPending(false);
    }
  };

  const handleCancel = () => {
    cancelTrial();
    rerender();
  };

  // ── State 1: Active trial ──
  if (status.active) {
    return (
      <div
        className="mb-4 p-4 flex items-start gap-3"
        style={{
          borderRadius: 18,
          background: "rgba(255,215,0,0.04)",
          border: "1px solid rgba(255,215,0,0.18)",
        }}
        dir={isAr ? "rtl" : "ltr"}
      >
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 40, height: 40, borderRadius: 12,
            background: "rgba(255,215,0,0.1)",
            border: "1px solid rgba(255,215,0,0.22)",
          }}
        >
          <Crown size={18} style={{ color: "#FFD700" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {t("Elite trial active", "تجربة النخبة نشطة")}
          </div>
          <div
            className="flex items-center gap-1.5 mt-0.5"
            style={{ fontSize: 12, color: "rgba(255,215,0,0.85)" }}
          >
            <Clock size={12} />
            <span>
              {status.remainingDays}{" "}
              {t(
                status.remainingDays === 1 ? "day left" : "days left",
                status.remainingDays === 1 ? "يوم متبقٍ" : "أيام متبقية"
              )}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 4, lineHeight: 1.5 }}>
            {t(
              "All Elite features unlocked. When the trial ends you return to your current plan — no charge, no auto-subscribe.",
              "جميع ميزات النخبة مفعّلة. عند انتهاء التجربة ترجع إلى خطّتك الحالية دون أيّ رسوم أو اشتراك تلقائي."
            )}
          </div>
          <button
            onClick={handleCancel}
            className="mt-2 inline-flex items-center gap-1 px-2.5 py-1"
            style={{
              fontSize: 11, color: "rgba(255,255,255,0.6)",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
            }}
          >
            <X size={11} />
            {t("Cancel trial", "إلغاء التجربة")}
          </button>
        </div>
      </div>
    );
  }

  // ── State 2: Already used ──
  if (status.started && status.expired) {
    return (
      <div
        className="mb-4 p-4 flex items-start gap-3"
        style={{
          borderRadius: 18,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.05)",
        }}
        dir={isAr ? "rtl" : "ltr"}
      >
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 40, height: 40, borderRadius: 12,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <Check size={18} style={{ color: "rgba(255,255,255,0.4)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>
            {t("Trial ended", "انتهت التجربة")}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 4, lineHeight: 1.5 }}>
            {t(
              "You've used your free Elite trial. Upgrade any time to keep the advanced features.",
              "لقد استخدمت تجربة النخبة المجانية. يمكنك الترقية في أيّ وقت للاحتفاظ بالميزات المتقدّمة."
            )}
          </div>
          {onRequestUpgrade && (
            <button
              onClick={onRequestUpgrade}
              className="mt-2 inline-flex items-center gap-1 px-3 py-1.5"
              style={{
                fontSize: 11, fontWeight: 600, color: "#0f1217",
                background: "#00C8E0", borderRadius: 8,
              }}
            >
              {t("Upgrade to Elite", "الترقية إلى النخبة")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── State 3: Not yet started ──
  return (
    <div
      className="mb-4 p-4 flex items-start gap-3"
      style={{
        borderRadius: 18,
        background: "linear-gradient(180deg, rgba(255,215,0,0.04), rgba(0,200,224,0.03))",
        border: "1px solid rgba(255,215,0,0.22)",
      }}
      dir={isAr ? "rtl" : "ltr"}
    >
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 40, height: 40, borderRadius: 12,
          background: "rgba(255,215,0,0.1)",
          border: "1px solid rgba(255,215,0,0.25)",
        }}
      >
        <Crown size={18} style={{ color: "#FFD700" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
          {t(
            `Try Elite free for ${getTrialDurationDays()} days`,
            `جرّب النخبة مجاناً لمدّة ${getTrialDurationDays()} أيام`
          )}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 4, lineHeight: 1.5 }}>
          {t(
            "Duress PIN · AI voice calls · advanced stealth · full PDF dossier. No card required — automatically reverts at the end.",
            "رمز الإكراه · مكالمات الصوت بالذكاء الاصطناعي · التخفّي المتقدّم · تقرير PDF كامل. لا حاجة لبطاقة — يرجع تلقائياً في نهاية التجربة."
          )}
        </div>
        <button
          onClick={handleStart}
          disabled={pending}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-2"
          style={{
            fontSize: 12, fontWeight: 700, color: "#0f1217",
            background: pending ? "rgba(255,215,0,0.45)" : "#FFD700",
            borderRadius: 10,
            cursor: pending ? "wait" : "pointer",
          }}
        >
          <Crown size={13} />
          {pending
            ? t("Starting…", "جاري البدء…")
            : t("Start trial", "ابدأ التجربة")}
        </button>
        {/* CRIT-#12: surface server-deny reasons (e.g. trial already used
            on another device, network error) so the user knows why nothing
            happened after pressing the button. */}
        {denyReason && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: "#FF6B6B",
              background: "rgba(255,107,107,0.08)",
              border: "1px solid rgba(255,107,107,0.22)",
              borderRadius: 8,
              padding: "6px 10px",
            }}
          >
            {denyReason}
          </div>
        )}
      </div>
    </div>
  );
}
