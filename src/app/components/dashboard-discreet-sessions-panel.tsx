// ═══════════════════════════════════════════════════════════════
// SOSphere — Dashboard Discreet Sessions Panel (Phase 2 CRIT-9 Phase B)
// ─────────────────────────────────────────────────────────────
// Admin-facing live panel for active discreet SOS sessions. Mounted
// on the company-dashboard. Subscribes to:
//   1. supabase.channel("discreet_sessions:<companyId>") realtime
//      INSERT/UPDATE on discreet_sessions so the panel refreshes
//      within ~250ms of any state change anywhere in the org
//   2. onSyncEvent for DISCREET_SOS_STARTED/HEARTBEAT/WARNING/ENDED
//      as a redundant lower-latency path (matches the mobile-side
//      emit lag — usually beats realtime by a few hundred ms)
//
// Both paths converge on loadActiveDiscreetSessions() to reconcile
// state — realtime is hint-only, RPC is source of truth.
//
// Each row shows:
//   - Worker identity (employee_id resolved to name via dashboardStore)
//   - Mode (blackout vs low_battery — different threat severity)
//   - Heartbeat freshness (fresh < 3 min, stale 3-10 min, missing > 10 min)
//   - Last GPS position (link to map)
//   - "Mark Safe" button → end_discreet_session(reason='admin_cleared')
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { EyeOff, MapPin, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import {
  loadActiveDiscreetSessions,
  endDiscreetSession,
  classifyHeartbeat,
  statusColor,
  type ActiveDiscreetRow,
  type HeartbeatHealth,
} from "./discreet-session-service";
import { onSyncEvent } from "./shared-store";
import { useT } from "./dashboard-i18n";
import { useLang } from "./useLang";

interface Props {
  /** Company id — required; panel renders nothing when null. */
  companyId: string | null | undefined;
}

const HEALTH_LABEL_KEY: Record<HeartbeatHealth, string> = {
  fresh:   "disc.health.live",
  stale:   "disc.health.stale",
  missing: "disc.health.noSignal",
  expired: "disc.health.expired",
};
const HEALTH_COLOR: Record<HeartbeatHealth, string> = {
  fresh:   "#00C853",
  stale:   "#FF9500",
  missing: "#FF2D55",
  expired: "#8E8E93",
};

export function DashboardDiscreetSessionsPanel({ companyId }: Props) {
  const { lang } = useLang();
  const t = useT(lang);
  const [rows, setRows] = useState<ActiveDiscreetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);
  // Tick state forces re-render every 10s so the heartbeat-age
  // classification stays current without a network round-trip.
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const res = await loadActiveDiscreetSessions(companyId);
    if (res.ok) setRows(res.rows);
    setLoading(false);
  }, [companyId]);

  // Initial + realtime
  useEffect(() => {
    if (!companyId) return;
    void refresh();

    // Path 1: SyncEvent bus (faster, hint-only — triggers a refresh)
    const offSync = onSyncEvent((e) => {
      if (
        e.type === "DISCREET_SOS_STARTED" ||
        e.type === "DISCREET_SOS_HEARTBEAT" ||
        e.type === "DISCREET_SOS_WARNING" ||
        e.type === "DISCREET_SOS_ENDED"
      ) {
        void refresh();
      }
    });

    // Path 2: Supabase realtime on the discreet_sessions table
    let channelCleanup: (() => void) | null = null;
    void (async () => {
      try {
        const { supabase } = await import("./api/supabase-client");
        const channel = supabase
          .channel(`discreet_sessions:${companyId}`)
          .on(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "postgres_changes" as any,
            { event: "*", schema: "public", table: "discreet_sessions",
              filter: `company_id=eq.${companyId}` },
            () => { void refresh(); },
          )
          .subscribe();
        channelCleanup = () => { void supabase.removeChannel(channel); };
      } catch { /* realtime is hint-only; sync bus is the fallback */ }
    })();

    // Tick every 10s so heartbeat-age labels stay fresh
    const tickHandle = setInterval(() => setTick(t => t + 1), 10_000);

    return () => {
      offSync();
      if (channelCleanup) channelCleanup();
      clearInterval(tickHandle);
    };
  }, [companyId, refresh]);

  const handleMarkSafe = async (sessionId: string) => {
    if (!confirm(t("disc.confirmMarkSafe"))) return;
    setEndingId(sessionId);
    const ok = await endDiscreetSession({ sessionId, reason: "admin_cleared" });
    setEndingId(null);
    if (ok) void refresh();
  };

  if (!companyId || rows.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="p-5 rounded-2xl"
      style={{
        background: "rgba(255,45,85,0.05)",
        border:     "1px solid rgba(255,45,85,0.22)",
      }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <EyeOff className="size-4" style={{ color: "#FF2D55" }} />
          <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>
            {t("disc.activeSessions")}
          </p>
        </div>
        <span
          className="px-2 py-0.5 rounded-md"
          style={{
            background: "rgba(255,45,85,0.15)",
            border: "1px solid rgba(255,45,85,0.3)",
            color: "#FF2D55", fontSize: 11, fontWeight: 700,
          }}>
          {rows.length}{loading ? " ⟳" : ""}
        </span>
      </div>

      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
        <AnimatePresence initial={false}>
          {rows.map((row) => {
            const health = classifyHeartbeat(row.heartbeat_age_sec, row.auto_timeout_at);
            const healthColor = HEALTH_COLOR[health];
            const healthLabel = t(HEALTH_LABEL_KEY[health]);
            const sColor = statusColor(row.status);
            const startedMin = Math.round((Date.now() - new Date(row.started_at).getTime()) / 60_000);
            return (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: `1px solid ${sColor}22`,
                }}>
                <div className="size-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${sColor}18`, border: `1px solid ${sColor}40` }}>
                  {row.mode === "blackout" ? (
                    <EyeOff className="size-4" style={{ color: sColor }} />
                  ) : (
                    <AlertTriangle className="size-4" style={{ color: sColor }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 700 }}>
                      {row.employee_id.slice(0, 8)}…
                    </p>
                    <span style={{ fontSize: 9, fontWeight: 700, color: sColor }}>
                      {row.status.toUpperCase()}
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                      style={{ background: `${healthColor}18`, border: `1px solid ${healthColor}40` }}>
                      <span className="size-1.5 rounded-full" style={{ background: healthColor }} />
                      <span style={{ fontSize: 9, fontWeight: 600, color: healthColor }}>{healthLabel}</span>
                    </span>
                  </div>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
                    <Clock className="inline size-2.5 mr-1" />
                    {t("disc.started")} {startedMin}{t("disc.minAgo")} · {t("disc.mode")}: {row.mode}
                    {row.last_lat != null && row.last_lng != null && (
                      <span className="ml-2">
                        <MapPin className="inline size-2.5 mr-0.5" />
                        {row.last_lat.toFixed(4)}, {row.last_lng.toFixed(4)}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => handleMarkSafe(row.id)}
                  disabled={endingId === row.id}
                  className="px-3 py-1.5 rounded-md flex items-center gap-1 whitespace-nowrap"
                  style={{
                    background: "rgba(0,200,83,0.12)",
                    border: "1px solid rgba(0,200,83,0.35)",
                    color: "#00C853", fontSize: 10, fontWeight: 700,
                    opacity: endingId === row.id ? 0.5 : 1,
                    cursor: endingId === row.id ? "wait" : "pointer",
                  }}>
                  <CheckCircle2 className="size-3" />
                  {endingId === row.id ? t("disc.clearing") : t("disc.markSafe")}
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
