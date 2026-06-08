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

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, CheckCircle2, AlertTriangle, HelpCircle,
  ChevronRight, Home as HomeIcon, FileText, Clock,
  Phone, Camera, Mic, MessageCircle, ShieldCheck,
} from "lucide-react";
import type { IncidentRecord } from "./sos-emergency";

// ── L2-H-UI (2026-05-10): post-emergency forensic surface ─────────────
// Type for a single inbound SMS reply row as broadcast by sos-sms-inbound
// and persisted to sos_sms_replies. Mirrors that table's columns one-to-one
// so a typo here would surface as an unknown-column query error.
interface SmsReplyRow {
  id: string;
  contact_index: number | null;
  contact_name: string | null;
  from_phone: string;
  body: string;
  is_ack: boolean;
  ack_keyword: string | null;
  received_at: string;
}

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
import { upsertDebrief, buildDebriefRow } from "./incident-debrief-service";
import { logAuditEvent } from "./audit-log-store";

function saveDebriefToHistory(
  incidentId: string,
  answers: { feltSafe: FeltSafe; note: string }
) {
  // 2026-06-06 final-audit refactor: extracted the RPC + jsonb shape
  // into incident-debrief-service.ts (27th pattern app proper). This
  // function now only handles the localStorage instant-UI mirror; the
  // server mirror goes through upsertDebrief() which is contract-tested.
  const row = buildDebriefRow(answers);
  // ── Local UI write (instant) ─────────────────────────────────
  try {
    const raw = localStorage.getItem("sosphere_incident_history");
    if (raw) {
      const list: any[] = JSON.parse(raw);
      const idx = list.findIndex((e) => e?.id === incidentId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], debrief: row };
        localStorage.setItem("sosphere_incident_history", JSON.stringify(list));
      }
    }
  } catch {
    /* non-fatal — server write below is the durable record */
  }
  // ── Server mirror (fire-and-forget) ──────────────────────────
  void upsertDebrief(incidentId, answers);
}

export function PostEmergencyDebrief({
  record, isAr = false, onViewFullReport, onGoHome, onNeedMoreHelp,
}: Props) {
  const [feltSafe, setFeltSafe] = useState<FeltSafe | null>(null);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // ── L2-H-UI: forensic data fetched async ────────────────────────────
  // These start empty and populate as the loader resolves. Empty/null
  // states render NOTHING (the relevant section is omitted entirely)
  // so a debrief for an older record (pre-L2-F / L2-G) looks identical
  // to the previous UX.
  const [smsReplies, setSmsReplies] = useState<SmsReplyRow[]>([]);
  const [forensicPhotoUrl, setForensicPhotoUrl] = useState<string | null>(null);
  const [evidenceLoaded, setEvidenceLoaded] = useState(false);

  const t = (en: string, ar: string) => (isAr ? ar : en);

  // ── L2-H-UI: load post-emergency forensic evidence ──────────────────
  // Pulls sos_sms_replies + a signed URL for the forensic photo from
  // Supabase. Best-effort: any failure leaves state empty (the UI
  // sections then collapse to nothing — the user is not blocked).
  // Dynamic-imports the supabase client to keep the post-emergency
  // chunk slim (file is React.lazy()'d in mobile-app per L3-B).
  useEffect(() => {
    if (!record?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("./api/supabase-client");

        // SMS replies — ordered by received_at so the timeline is
        // chronological. Filter on emergency_id only; the RLS
        // policy already scopes by company / user.
        const { data: replies, error: replyErr } = await supabase
          .from("sos_sms_replies")
          .select("id, contact_index, contact_name, from_phone, body, is_ack, ack_keyword, received_at")
          .eq("emergency_id", record.id)
          .order("received_at", { ascending: true })
          .limit(50);
        if (replyErr) {
          console.warn("[L2-H-UI] sms_replies fetch failed:", replyErr.message);
        } else if (!cancelled && replies) {
          setSmsReplies(replies as SmsReplyRow[]);
        }

        // Forensic photo signed URL. Storage object path mirrors what
        // sos-forensic-capture.ts writes. Returning a 1-hour signed URL
        // is the right tradeoff for a debrief screen — the user might
        // navigate to "View full report" which re-fetches anyway.
        const photoPath = `sos/${record.id}/forensic.jpg`;
        const { data: signed } = await supabase.storage
          .from("evidence")
          .createSignedUrl(photoPath, 3600);
        if (!cancelled && signed?.signedUrl) {
          setForensicPhotoUrl(signed.signedUrl);
        }
      } catch (e) {
        console.warn("[L2-H-UI] evidence load failed (non-fatal):", e);
      } finally {
        if (!cancelled) setEvidenceLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [record?.id]);

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
    // 2026-06-06 final-audit: the debrief is the worker's formal "I am
    // OK" attestation post-incident — legal record + closes the audit
    // chain that opened with sos_triggered_mobile. Severity info
    // because the resolution itself isn't an alarm; the original
    // trigger already logged critical.
    try {
      logAuditEvent("emergency", "post_incident_debrief_submitted", {
        detail: `feltSafe=${feltSafe}; note=${note ? note.slice(0, 200) : "(none)"}`,
        targetId: record.id, severity: "info",
      });
    } catch { /* best-effort */ }
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

        {/* ── L2-H-UI: SMS replies received during/after the SOS ────────
            Only renders when at least one reply arrived (collapsed
            entirely for emergencies that had no inbound traffic).
            The first ack is highlighted with a green ribbon — that's
            the operationally meaningful event for the L1-C SLA. */}
        {evidenceLoaded && smsReplies.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle size={14} style={{ color: "rgba(255,255,255,0.55)" }} />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.3px", color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>
                {t("Contact responses", "ردود جهات الاتصال")}
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                ({smsReplies.length})
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {smsReplies.map((r) => {
                const ts = new Date(r.received_at);
                const hh = ts.getHours().toString().padStart(2, "0");
                const mm = ts.getMinutes().toString().padStart(2, "0");
                return (
                  <div
                    key={r.id}
                    className="px-3 py-2"
                    style={{
                      background: r.is_ack ? "rgba(0,200,83,0.06)" : "rgba(255,255,255,0.03)",
                      border: r.is_ack ? "1px solid rgba(0,200,83,0.25)" : "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 10,
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {r.is_ack && <ShieldCheck size={12} style={{ color: "#00C853", flexShrink: 0 }} />}
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.contact_name || r.from_phone}
                        </span>
                        {r.is_ack && r.ack_keyword && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853", letterSpacing: "0.4px", background: "rgba(0,200,83,0.1)", padding: "1px 6px", borderRadius: 6 }}>
                            {r.ack_keyword}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", flexShrink: 0, marginLeft: 8 }}>
                        {hh}:{mm}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.4, wordBreak: "break-word" }}>
                      {r.body}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── L2-H-UI: forensic photo captured post-call (L2-G) ────────
            Only renders when the capture succeeded and the signed URL
            resolved. Thumbnail-sized — clicking opens full-screen in
            a future iteration (out of scope for Phase 1 surface). */}
        {evidenceLoaded && forensicPhotoUrl && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Camera size={14} style={{ color: "rgba(255,255,255,0.55)" }} />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.3px", color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>
                {t("Scene captured", "صورة المشهد")}
              </span>
            </div>
            <div
              className="overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
              }}
            >
              <img
                src={forensicPhotoUrl}
                alt={t("Post-call forensic capture", "صورة ما بعد المكالمة")}
                style={{ width: "100%", display: "block", maxHeight: 260, objectFit: "cover" }}
                loading="lazy"
              />
              <div className="px-3 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", letterSpacing: "0.3px" }}>
                  {t(
                    "Captured automatically when the call ended. Hashed for chain-of-custody.",
                    "تمّ التقاطها تلقائياً عند انتهاء المكالمة. مُؤمَّنة لسلسلة الأدلّة.",
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

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
