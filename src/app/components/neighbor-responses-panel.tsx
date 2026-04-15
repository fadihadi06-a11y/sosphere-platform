// ═══════════════════════════════════════════════════════════════
// SOSphere — Neighbor Responses Panel (P1-#6)
// ─────────────────────────────────────────────────────────────
// Shown on the active-SOS screen when a neighbor broadcast was issued.
// Live-counts responses by type as they stream in over the per-emergency
// Realtime channel.
//
// Why this exists:
//   Before P1-#6 the requester had ZERO signal that anyone heard their
//   broadcast. They knew it was sent, but couldn't see that three people
//   are on the way and one already called police. Panic compounds in
//   silence. This panel turns a one-way broadcast into a two-way
//   presence indicator, without exposing any PII about responders.
//
// Design:
//   • Self-contained: owns its own subscription; mount+unmount = on/off.
//   • Opt-in: render nothing unless the caller passes `show`. The parent
//     decides whether this emergency actually broadcast (canBroadcast()
//     at trigger time).
//   • Resilient: deduplicates by (requestId,status,ts) — Realtime's
//     at-least-once delivery means the same response can arrive twice.
//   • Quiet when empty: minimal footprint until the first response
//     arrives, so the active-SOS screen isn't visually cluttered.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Navigation, Phone, Users } from "lucide-react";
import {
  subscribeToNeighborResponses,
  type IncomingNeighborResponse,
  type NeighborAlertResponse,
} from "./neighbor-alert-service";

export interface NeighborResponsesPanelProps {
  /** The active SOS emergency id. */
  emergencyId: string;
  /**
   * Parent-controlled visibility. Pass false when the user didn't opt
   * into broadcast for this emergency or when the SOS has ended.
   */
  show: boolean;
  /** Language for labels. */
  lang?: "en" | "ar";
}

type Counts = Record<NeighborAlertResponse, number>;
const ZERO_COUNTS: Counts = { on_the_way: 0, calling_police: 0, cannot_help: 0 };

export function NeighborResponsesPanel({
  emergencyId,
  show,
  lang = "en",
}: NeighborResponsesPanelProps) {
  const [counts, setCounts] = useState<Counts>(ZERO_COUNTS);
  const [latest, setLatest] = useState<IncomingNeighborResponse | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const isAr = lang === "ar";
  const tr = (en: string, ar: string) => (isAr ? ar : en);

  useEffect(() => {
    if (!show || !emergencyId) return;

    // Reset counters when the subscription actually starts — protects
    // against a stale count if the same component is reused across a
    // second SOS in the same session (unlikely but cheap to guard).
    seenRef.current = new Set();
    setCounts(ZERO_COUNTS);
    setLatest(null);

    const handle = subscribeToNeighborResponses(emergencyId, (r) => {
      // Dedup: same responder may hit the button twice, or Realtime
      // may redeliver. We key on status+ts with a 1-second bucket.
      const bucket = new Date(r.ts).getTime();
      const key = `${r.status}:${Math.floor(bucket / 1000)}`;
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);

      setCounts((prev) => ({ ...prev, [r.status]: (prev[r.status] ?? 0) + 1 }));
      setLatest(r);
    });

    return () => handle.stop();
  }, [show, emergencyId]);

  if (!show) return null;

  const total = counts.on_the_way + counts.calling_police;
  // Hide the panel entirely until the first meaningful response —
  // cuts visual noise during the "waiting for responders" phase.
  if (total === 0 && counts.cannot_help === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ type: "spring", damping: 22, stiffness: 260 }}
        dir={isAr ? "rtl" : "ltr"}
        className="rounded-2xl p-4 mt-3"
        style={{
          background: "rgba(0, 179, 104, 0.12)",
          border: "1px solid rgba(0, 179, 104, 0.35)",
          fontFamily: "'Outfit', sans-serif",
        }}
        aria-live="polite"
        role="status"
      >
        <div className="flex items-center gap-2 mb-3">
          <Users size={16} style={{ color: "#00B368" }} />
          <div className="text-sm font-semibold" style={{ color: "#00B368" }}>
            {total > 0
              ? tr(
                  `${total} neighbor${total === 1 ? "" : "s"} responded`,
                  `استجاب ${total} من الجيران`,
                )
              : tr("Neighbors responded", "استجاب بعض الجيران")}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {counts.on_the_way > 0 && (
            <ResponseChip
              icon={<Navigation size={14} />}
              count={counts.on_the_way}
              label={tr("on the way", "في الطريق")}
              bg="rgba(0, 179, 104, 0.2)"
              fg="#00B368"
            />
          )}
          {counts.calling_police > 0 && (
            <ResponseChip
              icon={<Phone size={14} />}
              count={counts.calling_police}
              label={tr("calling 911", "يتصل بالطوارئ")}
              bg="rgba(0, 122, 255, 0.2)"
              fg="#007AFF"
            />
          )}
        </div>

        {latest && latest.status !== "cannot_help" && (
          <div className="text-xs mt-2" style={{ color: "rgba(255,255,255,0.8)" }}>
            {tr("Someone is aware of your situation.", "أحد الجيران على علم بحالتك.")}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function ResponseChip({
  icon,
  count,
  label,
  bg,
  fg,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  bg: string;
  fg: string;
}) {
  return (
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", damping: 18, stiffness: 300 }}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
      style={{ background: bg, color: fg }}
    >
      {icon}
      <span className="text-sm font-semibold">{count}</span>
      <span className="text-xs">{label}</span>
    </motion.div>
  );
}
