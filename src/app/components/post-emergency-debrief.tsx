/**
 * Post-Emergency Debrief
 * ═══════════════════════
 * Shown immediately after an SOS ends. Civilian-first design:
 *   1. Ask "Are you safe now?" — primary question, 3 large answers.
 *   2. If user needs more help → bubbles up via onNeedMoreHelp (parent decides
 *      whether to re-trigger SOS or route to emergency-services page).
 *   3. Otherwise, optional free-text note + choice to view full report
 *      or return home.
 *
 * Isolation notes:
 *   • No dependency on SosEmergency internals — receives a completed
 *     IncidentRecord and three navigation callbacks only.
 *   • Debrief answers are persisted as a SIDE-EFFECT into the already-
 *     stored incident-history entry (matches by id). We never mutate the
 *     IncidentRecord interface — just add optional runtime keys the
 *     history reader tolerates.
 *   • Pure client-side; server sync is Phase 6.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, CheckCircle2, AlertTriangle, HelpCircle,
  ChevronRight, Home as HomeIcon, FileText, Clock,
  Phone, Camera, Mic,
} from "lucide-react";
import type { IncidentRecord } from "./sos-emergency";

type FeltSafe = "safe" | "unsure" | "need_help";

interface Props {
  record: IncidentRecord;
  isAr?: boolean;
  onViewFullReport: () => void;
  onGoHome: () => void;
  onNeedMoreHelp: () => void;
}

/**
 * Persist debrief answers into the existing incident-history entry so the
 * record is enriched without mutating the IncidentRecord TypeScript interface.
 * Swallows all errors — debrief UX must never block on storage failures.
 */
function saveDebriefToHistory(
  incidentId: string,
  answers: { feltSafe: FeltSafe; note: string }
) {
  try {
    const raw = localStorage.getItem("sosphere_incident_history");
    if (!raw) return;
    const list: any[] = JSON.parse(raw);
    const idx = list.findIndex((e) => e?.id === incidentId);
    if (idx < 0) return;
    list[idx] = {
      ...list[idx],
      debrief: {
        feltSafe: answers.feltSafe,
        note: answers.note.trim() || undefined,
        submittedAt: new Date().toISOString(),
      },
    };
    localStorage.setItem("sosphere_incident_history", JSON.stringify(list));
  } catch {
    /* non-fatal */
  }
}

export function PostEmergencyDebrief({
  record, isAr = false, onViewFullReport, onGoHome, onNeedMoreHelp,
}: Props) {
  const [feltSafe, setFeltSafe] = useState<FeltSafe | null>(null);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const t = (en: string, ar: string) => (isAr ? ar : en);

  // ── Derived summary stats (pure, memoized) ──
  const stats = useMemo(() => {
    const start = record.startTime instanceof Date
      ? record.startTime
      : new Date(record.startTime);
    const end = record.endTime instanceof Date
      ? record.endTime
      : record.endTime
        ? new Date(record.endTime)
        : new Date();
    const durationSec = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
    const mm = Math.floor(durationSec / 60);
    const ss = (durationSec % 60).toString().padStart(2, "0");
    const contactsAnswered = record.contacts.filter(c => c.status === "answered").length;
    return {
      durationLabel: `${mm}:${ss}`,
      contactsAnswered,
      contactsTotal: record.contacts.length,
      photos: record.photos?.length || 0,
      recordingSec: record.recordingSeconds || 0,
    };
  }, [record]);

  // ── Handlers ──
  const handlePickSafe = (choice: FeltSafe) => {
    setFeltSafe(choice);
    if (choice === "need_help") {
      // Persist the answer first, then bubble up. Parent may immediately
      // trigger a fresh SOS — we want the note captured before navigation.
      saveDebriefToHistory(record.id, { feltSafe: choice, note });
      onNeedMoreHelp();
    }
  };

  const handleSubmit = () => {
    if (!feltSafe) return;
    saveDebriefToHistory(record.id, { feltSafe, note });
    setSubmitted(true);
  };

  return (
    <div
      className="flex-1 overflow-y-auto overflow-x-hidden relative"
      dir={isAr ? "rtl" : "ltr"}
      style={{ scrollbarWidth: "none" }}
    >
      {/* Ambient */}
      <div
        className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,131,0.04) 0%, transparent 70%)" }}
      />

      <div className="pt-14 pb-28 px-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <Shield className="size-[18px]" style={{ color: "#00C853" }} />
          <span className="text-white" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.3px" }}>
            {t("Post-Emergency Debrief", "ما بعد الطوارئ")}
          </span>
        </div>

        {/* Incident summary strip */}
        <div
          className="mb-6 px-4 py-3 flex items-center justify-between"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 14,
          }}
        >
          <div className="flex items-center gap-2">
            <Clock size={14} style={{ color: "rgba(255,255,255,0.5)" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
              {stats.durationLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Phone size={14} style={{ color: "rgba(255,255,255,0.5)" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
              {stats.contactsAnswered}/{stats.contactsTotal}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Camera size={14} style={{ color: "rgba(255,255,255,0.5)" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
              {stats.photos}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Mic size={14} style={{ color: "rgba(255,255,255,0.5)" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
              {stats.recordingSec}s
            </span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {!submitted ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
            >
              {/* Primary question */}
              <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 700, lineHeight: 1.3, marginBottom: 6 }}>
                {t("Are you safe now?", "هل أنت بأمان الآن؟")}
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 20 }}>
                {t(
                  "This helps us tailor follow-up. Your answer is private.",
                  "إجابتك خاصّة وتساعدنا في تحديد المتابعة المناسبة."
                )}
              </p>

              <div className="flex flex-col gap-3 mb-6">
                <DebriefChoice
                  active={feltSafe === "safe"}
                  icon={<CheckCircle2 size={18} style={{ color: "#00C853" }} />}
                  tint="#00C853"
                  label={t("Yes, I'm safe", "نعم، أنا بأمان")}
                  sub={t("The incident is over", "انتهى الحدث")}
                  onClick={() => handlePickSafe("safe")}
                />
                <DebriefChoice
                  active={feltSafe === "unsure"}
                  icon={<HelpCircle size={18} style={{ color: "#FF9500" }} />}
                  tint="#FF9500"
                  label={t("I'm not sure", "لست متأكّداً")}
                  sub={t("Still uneasy but no immediate threat", "ما زلت قلقاً لكن لا خطر فوري")}
                  onClick={() => handlePickSafe("unsure")}
                />
                <DebriefChoice
                  active={feltSafe === "need_help"}
                  icon={<AlertTriangle size={18} style={{ color: "#FF2D55" }} />}
                  tint="#FF2D55"
                  label={t("I need more help", "أحتاج مزيداً من المساعدة")}
                  sub={t("Re-activate emergency now", "إعادة تفعيل الطوارئ الآن")}
                  onClick={() => handlePickSafe("need_help")}
                />
              </div>

              {/* Optional note — only meaningful when a non-emergency choice is selected */}
              {feltSafe && feltSafe !== "need_help" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.25 }}
                  style={{ overflow: "hidden" }}
                >
                  <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 6 }}>
                    {t("What happened? (optional)", "ماذا حدث؟ (اختياري)")}
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder={t("A short description for your records…", "وصف موجز لسجلّك الشخصي…")}
                    className="w-full px-3 py-2 text-sm mb-4"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      color: "#fff",
                      resize: "none",
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    onClick={handleSubmit}
                    className="w-full py-3 flex items-center justify-center gap-2"
                    style={{
                      background: "#00C8E0",
                      color: "#0f1217",
                      fontWeight: 600,
                      fontSize: 14,
                      borderRadius: 12,
                    }}
                  >
                    {t("Save & continue", "حفظ ومتابعة")}
                    <ChevronRight size={16} />
                  </button>
                </motion.div>
              )}
            </motion.div>
          ) : (
            // Post-submit: thank-you + exit choices
            <motion.div
              key="thanks"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <motion.div
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.35, delay: 0.1 }}
                className="flex items-center justify-center mb-5"
              >
                <div
                  className="rounded-full p-4"
                  style={{ background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.25)" }}
                >
                  <CheckCircle2 size={32} style={{ color: "#00C853" }} />
                </div>
              </motion.div>
              <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 700, textAlign: "center", marginBottom: 6 }}>
                {t("Thank you", "شكراً لك")}
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", textAlign: "center", marginBottom: 24, lineHeight: 1.5 }}>
                {t(
                  "Your note is saved with this incident. You can review the full report any time from Incident History.",
                  "تمّ حفظ ملاحظتك مع هذا الحدث. يمكنك مراجعة التقرير الكامل في أيّ وقت من سجلّ الحوادث."
                )}
              </p>

              <button
                onClick={onViewFullReport}
                className="w-full py-3 flex items-center justify-center gap-2 mb-3"
                style={{
                  background: "rgba(0,200,224,0.08)",
                  border: "1px solid rgba(0,200,224,0.2)",
                  color: "#00C8E0",
                  fontWeight: 600,
                  fontSize: 14,
                  borderRadius: 12,
                }}
              >
                <FileText size={16} />
                {t("View full report", "عرض التقرير الكامل")}
              </button>
              <button
                onClick={onGoHome}
                className="w-full py-3 flex items-center justify-center gap-2"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.85)",
                  fontWeight: 600,
                  fontSize: 14,
                  borderRadius: 12,
                }}
              >
                <HomeIcon size={16} />
                {t("Done, back to home", "تمّ، عودة إلى الرئيسية")}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Small internal choice-card component (kept inside file for cohesion). */
function DebriefChoice({
  active, icon, tint, label, sub, onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  tint: string;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-start"
      style={{
        background: active ? `${tint}14` : "rgba(255,255,255,0.03)",
        border: `1px solid ${active ? `${tint}55` : "rgba(255,255,255,0.06)"}`,
        borderRadius: 14,
        transition: "background 0.2s, border 0.2s",
      }}
    >
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${tint}10`,
          border: `1px solid ${tint}25`,
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{label}</div>
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 1 }}>{sub}</div>
      </div>
      <ChevronRight size={16} style={{ color: "rgba(255,255,255,0.3)" }} />
    </button>
  );
}
