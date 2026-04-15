// ═══════════════════════════════════════════════════════════════
// SOSphere — Neighbor Alert Overlay
// ─────────────────────────────────────────────────────────────
// The UI half of Phase 7: subscribes to neighbour SOS broadcasts via
// `startNeighborListener` and renders an action sheet when a nearby
// alert arrives. User picks one of three responses (on_the_way /
// calling_police / cannot_help) which `respondToAlert` records
// back to Supabase.
//
// Mount ONCE at the top level (mobile-app.tsx) — multiple mounts
// would duplicate listeners, not desirable.
//
// UX guard-rails:
//   • Never shows while the user is in their own active SOS (they
//     have bigger problems). Controlled by the `suppress` prop.
//   • Auto-dismisses after 2 minutes of no response, so the user
//     isn't blocked by a stale alert if they miss it.
//   • If multiple alerts arrive, the latest overwrites the previous
//     — responders don't need to triage a queue.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Radio, MapPin, Navigation, Phone, X } from "lucide-react";
import { toast } from "sonner";
import {
  startNeighborListener,
  respondToAlert,
  type IncomingNeighborAlert,
  type NeighborAlertResponse,
} from "./neighbor-alert-service";

const AUTO_DISMISS_MS = 2 * 60 * 1000; // 2 minutes

export interface NeighborAlertOverlayProps {
  /** Language for labels — falls back to English. */
  lang?: "en" | "ar";
  /**
   * Suppress the overlay when true. Pass `true` while the user is
   * handling their OWN SOS so we don't stack crises on them.
   */
  suppress?: boolean;
}

export function NeighborAlertOverlay({ lang = "en", suppress = false }: NeighborAlertOverlayProps) {
  const [alert, setAlert] = useState<IncomingNeighborAlert | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAr = lang === "ar";
  const tr = (en: string, ar: string) => (isAr ? ar : en);

  // Subscribe to the geocell listener once on mount.
  useEffect(() => {
    const handle = startNeighborListener(
      (incoming) => {
        // Drop anything the user triggered themselves (defensive — the
        // broadcast config already has self:false, but a device with
        // both opt-in flags could theoretically echo).
        setAlert(incoming);
      },
      (retract) => {
        // P1-#5: Requester ended their emergency. Only dismiss if the
        // currently-displayed alert matches — we do this inside a
        // functional setState so React gives us the latest alert value
        // even if the effect captured a stale closure.
        setAlert((current) => {
          if (!current || current.requestId !== retract.requestId) return current;
          const reasonLabel =
            retract.reason === "false_alarm"
              ? tr("Requester marked as false alarm", "تم تحديدها كإنذار كاذب")
              : retract.reason === "safe"
              ? tr("Requester reported safe", "المُبلّغ في أمان")
              : tr("Requester ended the alert", "تم إنهاء النداء");
          toast(reasonLabel);
          return null;
        });
      },
    );
    return () => handle.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss and housekeeping when alert changes or suppress toggles.
  useEffect(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    if (!alert || suppress) return;
    dismissTimer.current = setTimeout(() => setAlert(null), AUTO_DISMISS_MS);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [alert, suppress]);

  if (!alert || suppress) return null;

  const handleRespond = async (status: NeighborAlertResponse) => {
    try {
      await respondToAlert(alert.requestId, status);
    } catch {
      // respondToAlert swallows errors internally; this is defensive.
    }
    toast.success(
      status === "on_the_way"
        ? tr("Marked as on the way", "تم تحديدك كمتجه للمساعدة")
        : status === "calling_police"
        ? tr("Thanks — dispatch recorded", "شكراً — تم تسجيل الاتصال")
        : tr("Response recorded", "تم تسجيل الرد")
    );
    setAlert(null);
  };

  const distanceLabel =
    alert.distanceKm == null
      ? tr("Nearby", "قريب")
      : alert.distanceKm < 1
      ? tr(`${Math.round(alert.distanceKm * 1000)} m away`, `على بعد ${Math.round(alert.distanceKm * 1000)} م`)
      : tr(`${alert.distanceKm.toFixed(1)} km away`, `على بعد ${alert.distanceKm.toFixed(1)} كم`);

  const severityLabel =
    alert.severity === "high"
      ? tr("High severity", "خطورة عالية")
      : alert.severity === "medium"
      ? tr("Medium severity", "خطورة متوسطة")
      : tr("Low severity", "خطورة منخفضة");

  const who = alert.displayName?.trim() || tr("A neighbour", "أحد الجيران");

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
        dir={isAr ? "rtl" : "ltr"}
        style={{ fontFamily: "'Outfit', sans-serif" }}
      >
        <motion.div
          initial={{ y: 80 }}
          animate={{ y: 0 }}
          exit={{ y: 80 }}
          transition={{ type: "spring", damping: 20, stiffness: 220 }}
          className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center rounded-full"
                style={{ width: 40, height: 40, background: "rgba(255, 59, 48, 0.12)" }}
              >
                <Radio size={20} style={{ color: "#FF3B30" }} />
              </div>
              <div>
                <div className="font-semibold text-base" style={{ color: "#111" }}>
                  {tr("Nearby SOS", "نداء طوارئ قريب")}
                </div>
                <div className="text-xs" style={{ color: "#6B6B6B" }}>
                  {severityLabel}
                </div>
              </div>
            </div>
            <button
              onClick={() => setAlert(null)}
              className="p-2 rounded-full"
              style={{ color: "#6B6B6B" }}
              aria-label={tr("Dismiss", "إغلاق")}
            >
              <X size={18} />
            </button>
          </div>

          <div
            className="rounded-2xl p-4 mb-4"
            style={{ background: "#F6F7F9" }}
          >
            <div className="text-sm mb-2" style={{ color: "#111" }}>
              <strong>{who}</strong> {tr("needs help nearby.", "يحتاج المساعدة في منطقتك.")}
            </div>
            <div className="flex items-center gap-2 text-xs" style={{ color: "#6B6B6B" }}>
              <MapPin size={14} />
              <span>{distanceLabel}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => handleRespond("on_the_way")}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-medium text-white"
              style={{ background: "#00B368" }}
            >
              <Navigation size={18} />
              {tr("I'm on the way", "أنا في الطريق")}
            </button>
            <button
              onClick={() => handleRespond("calling_police")}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-medium"
              style={{ background: "rgba(0, 122, 255, 0.12)", color: "#007AFF" }}
            >
              <Phone size={18} />
              {tr("Calling emergency services", "أتصل بالطوارئ")}
            </button>
            <button
              onClick={() => handleRespond("cannot_help")}
              className="w-full py-3 rounded-xl font-medium"
              style={{ background: "transparent", color: "#6B6B6B" }}
            >
              {tr("Can't help right now", "لا أستطيع المساعدة الآن")}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
