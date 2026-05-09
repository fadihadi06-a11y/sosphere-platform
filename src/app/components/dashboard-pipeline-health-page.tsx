// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — Pipeline Health Dashboard (L1-E)
// ─────────────────────────────────────────────────────────────────────────
// FINAL piece of Layer 1 (Observability) of the life-safety foundation.
//
// PURPOSE
//   The single page where an operator can answer, in <2 seconds:
//     1. Is the SOS pipeline alive RIGHT NOW?
//     2. Has it been alive for the last 24 hours?
//     3. If something failed, what was it and when?
//
//   Powered by ONE round-trip to public.get_pipeline_health_summary()
//   (admin/owner only via internal company_memberships gate). The RPC
//   aggregates synthetic_probe_health (cron-driven) + sos_pipeline_metrics
//   24h totals + 10 most-recent failures in a single jsonb payload, so
//   the page doesn't have to chain three queries.
//
// SENTRY INTEGRATION (alarm-on-anomaly)
//   When the page renders an anomaly:
//     • synthetic.failures_last_hour > 0   → warning   (probe broke)
//     • last_probe more than 15 min ago    → warning   (cron stuck)
//     • real_24h.failures > 0              → error     (real users impacted)
//     • synthetic.last_probe is null       → fatal     (probe never ran)
//   …we emit a Sentry breadcrumb + captureMessage so the on-call gets
//   alerted via the same channel as every other production error. We
//   only fire ONCE per signature per session — so an operator parking on
//   this page doesn't spam Sentry every refresh.
//
// AUTH GATE
//   The RPC itself rejects non-admin/owner callers with 'unauthorized'.
//   The page surfaces this gracefully ("you don't have permission") rather
//   than erroring — a non-admin viewing this page is a routing bug, not
//   a security incident.
//
// REFRESH
//   Manual reload button + auto-poll every 30s (cleared on unmount).
//   The synthetic probe runs every 5 min, so 30s is more than fast
//   enough — anything more aggressive just wastes RPC budget.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity, AlertTriangle, CheckCircle2, RefreshCw, Heart,
  Clock, TrendingUp, ShieldAlert, Zap, XCircle, Lock,
} from "lucide-react";
import { safeRpc } from "./api/safe-rpc";
import { captureException } from "./sentry-client";

// ── Types — match the jsonb payload from get_pipeline_health_summary ──
// IMPORTANT: keep this in sync with the synthetic_probe_health VIEW columns
// (supabase/migrations/20260508180000_l1d_synthetic_sos_probe.sql). The
// view DOES NOT expose `successes_last_*` directly — successes are derived
// in the UI as (probes - failures). Keeping a phantom `successes_last_24h`
// field here would silently read `undefined`, divide by it, and paint a
// life-safety dashboard with a misleading "0% success rate" warning when
// the pipeline is actually 100% healthy. Discovered live on production
// after L1-E deploy: 217 probes / 0 failures rendered as 0% orange.
interface SyntheticHealth {
  probes_last_hour: number | null;
  probes_last_24h: number | null;
  failures_last_hour: number | null;
  failures_last_24h: number | null;
  p50_total_ms_last_hour: number | null;
  p95_total_ms_last_hour: number | null;
  p99_total_ms_last_hour: number | null;
  last_probe_at: string | null;
  seconds_since_last_probe: number | null;
}

interface Real24h {
  total: number | null;
  success: number | null;
  failures: number | null;
  p95_total_ms: number | null;
}

interface RecentFailure {
  trace_id: string;
  pipeline_status: "partial" | "failed" | "cancelled";
  failure_reason: string | null;
  created_at: string;
  is_synthetic: boolean;
}

interface HealthPayload {
  synthetic: SyntheticHealth | null;
  real_24h: Real24h | null;
  recent_failures: RecentFailure[];
  fetched_at: string;
}

// ── Anomaly detection — single source of truth for "is something wrong" ──
type AnomalyLevel = "ok" | "warning" | "error" | "fatal";
interface Anomaly {
  level: AnomalyLevel;
  signature: string;       // stable string for de-duping Sentry events
  message: string;
}

const STALE_PROBE_THRESHOLD_SEC = 15 * 60; // 15 min — probe runs every 5 min

function detectAnomalies(payload: HealthPayload): Anomaly[] {
  const out: Anomaly[] = [];
  const s = payload.synthetic;
  const r = payload.real_24h;

  // FATAL: probe never ran (cron not scheduled or whole DB is on fire)
  if (!s || s.last_probe_at === null) {
    out.push({
      level: "fatal",
      signature: "probe-never-ran",
      message: "Synthetic probe has never produced a row. Pipeline liveness is unknown.",
    });
    return out; // skip lesser checks — we have no data anyway
  }

  // WARNING: probe is stuck (cron blocked, pgmq deadlocked, etc.)
  if (s.seconds_since_last_probe !== null && s.seconds_since_last_probe > STALE_PROBE_THRESHOLD_SEC) {
    out.push({
      level: "warning",
      signature: "probe-stuck",
      message: `Synthetic probe has not run in ${Math.round((s.seconds_since_last_probe ?? 0) / 60)} minutes (threshold ${STALE_PROBE_THRESHOLD_SEC / 60}m).`,
    });
  }

  // WARNING: synthetic failures in the last hour (probe broke before real users hit it)
  if ((s.failures_last_hour ?? 0) > 0) {
    out.push({
      level: "warning",
      signature: "probe-failures-last-hour",
      message: `Synthetic probe recorded ${s.failures_last_hour} failure(s) in the last hour.`,
    });
  }

  // ERROR: real (non-synthetic) failures in the last 24h — actual users impacted
  if (r && (r.failures ?? 0) > 0) {
    out.push({
      level: "error",
      signature: "real-failures-24h",
      message: `${r.failures} real SOS pipeline failure(s) in the last 24 hours (out of ${r.total ?? 0}).`,
    });
  }

  return out;
}

// ── Format helpers ────────────────────────────────────────────────────────
function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ── Component ─────────────────────────────────────────────────────────────
export function PipelineHealthPage() {
  const [payload, setPayload] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const firedSentry = useRef<Set<string>>(new Set());
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await safeRpc<HealthPayload>(
        "get_pipeline_health_summary",
        {},
        { timeoutMs: 6000 },
      );
      if (error) {
        const msg = error.message || "unknown";
        // Server-side raised "unauthorized: ..." — treat as gentle redirect.
        if (msg.includes("unauthorized")) {
          setUnauthorized(true);
          setError(null);
          setPayload(null);
        } else {
          setError(msg);
          setPayload(null);
        }
        return;
      }
      setPayload(data ?? null);
      setError(null);
      setUnauthorized(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Hard error fetching the dashboard itself goes straight to Sentry —
      // this is unexpected (RPC should always return, even on auth fail).
      captureException(e instanceof Error ? e : new Error(msg), {
        tags: { area: "l1e-pipeline-health", phase: "fetch" },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-poll every 30s
  useEffect(() => {
    void load();
    pollRef.current = window.setInterval(() => { void load(); }, 30_000);
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [load]);

  // Anomaly → Sentry alarm (de-duped per signature)
  const anomalies = useMemo(() => (payload ? detectAnomalies(payload) : []), [payload]);

  useEffect(() => {
    if (!payload || anomalies.length === 0) return;
    for (const a of anomalies) {
      if (firedSentry.current.has(a.signature)) continue;
      firedSentry.current.add(a.signature);
      // captureException is the alarm channel — it dedupes naturally and
      // forwards to Sentry. We construct a synthetic Error so the stack
      // trace points back into this component (which is what the on-call
      // wants — "where in the app did we discover this anomaly?").
      const err = new Error(`[pipeline-health:${a.level}] ${a.message}`);
      captureException(err, {
        tags: {
          area: "l1e-pipeline-health",
          anomaly: a.signature,
          level: a.level,
        },
        extra: {
          synthetic: payload.synthetic,
          real_24h: payload.real_24h,
          recent_failures_count: payload.recent_failures.length,
          fetched_at: payload.fetched_at,
        },
      });
    }
  }, [anomalies, payload]);

  // ── Unauthorized: friendly empty state ──
  if (unauthorized) {
    return (
      <div className="px-5 pt-4 pb-10">
        <EmptyState
          icon={Lock}
          title="Operator-only view"
          body="The pipeline health dashboard is restricted to admins and owners. Ask an admin to share the daily snapshot, or escalate via your incident-response channel."
        />
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-10">
      {/* Header ────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="size-5" style={{ color: "#00C8E0" }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "rgba(255,255,255,0.95)" }}>
              Pipeline Health
            </h1>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            Layer 1 observability — synthetic probe + 24h SOS pipeline telemetry.
            {payload?.fetched_at && <> · Fetched {fmtRelative(payload.fetched_at)}</>}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
          style={{
            background: "rgba(0,200,224,0.08)",
            border: "1px solid rgba(0,200,224,0.18)",
            opacity: loading ? 0.5 : 1,
            fontSize: 12, fontWeight: 600, color: "#00C8E0",
          }}
        >
          <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
          Reload
        </button>
      </div>

      {/* Anomaly banner (top-most) ──────────────────────────────── */}
      <AnimatePresence>
        {anomalies.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4"
          >
            {anomalies.map((a) => <AnomalyBanner key={a.signature} anomaly={a} />)}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error state ────────────────────────────────────────────── */}
      {error && !unauthorized && (
        <div className="mb-4 p-4 rounded-2xl flex items-start gap-3"
          style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.18)" }}>
          <XCircle className="size-5 mt-0.5" style={{ color: "#FF2D55" }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#FF2D55" }}>Failed to load pipeline health</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>{error}</div>
          </div>
        </div>
      )}

      {/* Loading skeleton on first load ─────────────────────────── */}
      {loading && !payload && <LoadingSkeleton />}

      {/* Main grid ──────────────────────────────────────────────── */}
      {payload && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          <SyntheticCard health={payload.synthetic} />
          <Real24hCard real={payload.real_24h} />
        </div>
      )}

      {/* Recent failures list ───────────────────────────────────── */}
      {payload && (
        <RecentFailuresCard failures={payload.recent_failures} />
      )}
    </div>
  );
}

// ── Anomaly banner ─────────────────────────────────────────────────────────
function AnomalyBanner({ anomaly }: { anomaly: Anomaly }) {
  const cfg = {
    ok:      { color: "#00C853", bg: "rgba(0,200,83,0.06)",   border: "rgba(0,200,83,0.18)",  icon: CheckCircle2 },
    warning: { color: "#FF9500", bg: "rgba(255,150,0,0.06)",  border: "rgba(255,150,0,0.20)", icon: AlertTriangle },
    error:   { color: "#FF2D55", bg: "rgba(255,45,85,0.06)",  border: "rgba(255,45,85,0.20)", icon: ShieldAlert },
    fatal:   { color: "#FF2D55", bg: "rgba(255,45,85,0.10)",  border: "rgba(255,45,85,0.30)", icon: ShieldAlert },
  }[anomaly.level];
  const Icon = cfg.icon;
  return (
    <div className="p-3 rounded-2xl flex items-start gap-3 mb-2"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      <Icon className="size-4 mt-0.5 shrink-0" style={{ color: cfg.color }} />
      <div className="flex-1">
        <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {anomaly.level} · {anomaly.signature}
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>{anomaly.message}</div>
      </div>
    </div>
  );
}

// ── Synthetic probe card (left column) ─────────────────────────────────────
function SyntheticCard({ health }: { health: SyntheticHealth | null }) {
  if (!health) return <Card title="Synthetic probe" subtitle="No data yet"><EmptyInline /></Card>;
  const last = fmtRelative(health.last_probe_at);
  // Derive success from (probes - failures). The view exposes failures but
  // not successes — see comment on SyntheticHealth.
  const probes24 = health.probes_last_24h ?? 0;
  const failures24 = health.failures_last_24h ?? 0;
  const successPct = probes24 > 0
    ? Math.round(((probes24 - failures24) / probes24) * 100)
    : null;
  return (
    <Card
      title="Synthetic probe"
      subtitle={`Last run ${last} · ${probes24} runs / 24h`}
      icon={Heart}
      iconColor="#00C853"
    >
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Metric label="p50 (1h)"  value={fmtMs(health.p50_total_ms_last_hour)} />
        <Metric label="p95 (1h)"  value={fmtMs(health.p95_total_ms_last_hour)} />
        <Metric label="p99 (1h)"  value={fmtMs(health.p99_total_ms_last_hour)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Success rate (24h)"
          value={successPct !== null ? `${successPct}%` : "—"}
          tone={successPct === null ? "neutral" : successPct < 100 ? "warning" : "ok"}
        />
        <Metric
          label="Failures (1h)"
          value={String(health.failures_last_hour ?? 0)}
          tone={(health.failures_last_hour ?? 0) > 0 ? "warning" : "ok"}
        />
      </div>
    </Card>
  );
}

// ── Real 24h card (right column) ───────────────────────────────────────────
function Real24hCard({ real }: { real: Real24h | null }) {
  if (!real) return <Card title="Real SOS traffic (24h)" subtitle="—"><EmptyInline /></Card>;
  const total = real.total ?? 0;
  const success = real.success ?? 0;
  const failures = real.failures ?? 0;
  return (
    <Card
      title="Real SOS traffic (24h)"
      subtitle={total === 0 ? "No real SOS sessions in window" : `${total} sessions · ${success} ok · ${failures} failed`}
      icon={Zap}
      iconColor="#FF9500"
    >
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Metric label="Total" value={String(total)} />
        <Metric
          label="Success"
          value={String(success)}
          tone="ok"
        />
        <Metric
          label="Failures"
          value={String(failures)}
          tone={failures > 0 ? "error" : "ok"}
        />
      </div>
      <Metric label="p95 total (24h)" value={fmtMs(real.p95_total_ms)} />
    </Card>
  );
}

// ── Recent failures card ───────────────────────────────────────────────────
function RecentFailuresCard({ failures }: { failures: RecentFailure[] }) {
  return (
    <Card
      title="Recent failures"
      subtitle={failures.length === 0 ? "No failures in the last 24 hours" : `${failures.length} most-recent failure(s)`}
      icon={TrendingUp}
      iconColor="#FF2D55"
    >
      {failures.length === 0 ? (
        <div className="py-6 text-center" style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
          <CheckCircle2 className="size-6 mx-auto mb-2" style={{ color: "#00C853" }} />
          Pipeline is clean for the last 24h.
        </div>
      ) : (
        <div className="space-y-2">
          {failures.map((f) => <FailureRow key={f.trace_id} failure={f} />)}
        </div>
      )}
    </Card>
  );
}

function FailureRow({ failure }: { failure: RecentFailure }) {
  const statusColor = failure.pipeline_status === "failed" ? "#FF2D55"
    : failure.pipeline_status === "partial" ? "#FF9500"
    : "#7A7A7A";
  return (
    <div className="p-3 rounded-xl flex items-start gap-3"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
      <div className="shrink-0 px-2 py-1 rounded-lg"
        style={{
          background: `${statusColor}14`,
          border: `1px solid ${statusColor}30`,
          fontSize: 10, fontWeight: 700, color: statusColor,
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
        {failure.pipeline_status}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span style={{ fontSize: 12, fontFamily: "monospace", color: "rgba(255,255,255,0.65)" }}>
            {failure.trace_id.slice(0, 8)}
          </span>
          {failure.is_synthetic && (
            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(155,89,182,0.85)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              synthetic
            </span>
          )}
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
            <Clock className="inline size-3 mr-1 -translate-y-px" />
            {fmtRelative(failure.created_at)}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
          {failure.failure_reason || "(no reason captured)"}
        </div>
      </div>
    </div>
  );
}

// ── Reusable bits ──────────────────────────────────────────────────────────
function Card({
  title, subtitle, icon: Icon, iconColor, children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  iconColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 rounded-2xl"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01))",
        border: "1px solid rgba(255,255,255,0.05)",
        backdropFilter: "blur(20px)",
      }}>
      <div className="flex items-start gap-3 mb-3">
        {Icon && (
          <div className="shrink-0 size-9 rounded-xl flex items-center justify-center"
            style={{ background: `${iconColor ?? "#00C8E0"}12`, border: `1px solid ${iconColor ?? "#00C8E0"}25` }}>
            <Icon className="size-4" style={{ color: iconColor ?? "#00C8E0" }} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Metric({
  label, value, tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warning" | "error";
}) {
  const color = {
    neutral: "rgba(255,255,255,0.92)",
    ok:      "#00C853",
    warning: "#FF9500",
    error:   "#FF2D55",
  }[tone];
  return (
    <div className="p-2.5 rounded-xl"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function EmptyInline() {
  return <div className="py-3 text-center" style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>No data</div>;
}

function EmptyState({
  icon: Icon, title, body,
}: { icon: React.ElementType; title: string; body: string }) {
  return (
    <div className="py-16 px-6 text-center rounded-2xl"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <Icon className="size-8 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.35)" }} />
      <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{title}</div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", maxWidth: 420, margin: "8px auto 0" }}>{body}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {[0, 1].map((i) => (
        <div key={i} className="p-4 rounded-2xl"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", height: 200 }}>
          <div className="animate-pulse h-4 w-32 rounded mb-3" style={{ background: "rgba(255,255,255,0.08)" }} />
          <div className="animate-pulse h-3 w-48 rounded mb-6" style={{ background: "rgba(255,255,255,0.05)" }} />
          <div className="grid grid-cols-3 gap-2">
            {[0,1,2].map(j => <div key={j} className="animate-pulse h-12 rounded" style={{ background: "rgba(255,255,255,0.04)" }} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
