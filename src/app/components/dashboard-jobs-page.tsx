// ═══════════════════════════════════════════════════════════════
// SOSphere — Dashboard Jobs Page (E1.6)
// ═══════════════════════════════════════════════════════════════
// PURPOSE
//   Live-updating list of asynchronous jobs (bulk_invite today; SCIM
//   sync, data export, csv_import in later phases). Pairs with the
//   E1 async queue (pgmq + async_job_metadata) and the worker
//   process-bulk-invite that materializes the actual side effects.
//
// DATA FLOW
//   1. On mount: loadCanonicalIdentity() → company_id (single source of
//      truth — see canonical-identity.ts FOUNDATION-1)
//   2. RPC public.get_my_jobs(p_company_id) → initial list
//   3. supabase.channel('async_job_metadata:<company_id>') with
//      postgres_changes subscription on UPDATE/INSERT/DELETE filtered
//      by company_id → live patches into local state
//
// CANCEL / RETRY
//   • cancel button (only enabled on pending/running jobs) calls
//     public.cancel_job(p_job_id) RPC
//   • retry: NOT exposed in this iteration — workers retry automatically
//     up to max_attempts with exponential backoff. A "Retry now" UX
//     would skip backoff and is intentionally deferred.
//
// SECURITY
//   • RLS on async_job_metadata enforces company-scoped reads
//     (company_memberships join). Server is the source of truth; the
//     UI only requests rows for the active company and ignores any
//     stragglers.
//
// REALTIME GOTCHAS
//   • Supabase realtime supports filter on PRIMARY KEY columns and
//     indexed text/uuid columns. company_id is uuid + indexed via
//     idx_async_job_company_status_created → eligible for filter.
//   • DELETE events do not include row data, so we treat them as
//     "remove by id".
// ═══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  CheckCircle2, XCircle, Loader2, Clock,
  AlertTriangle, RefreshCw, Ban, Inbox, ChevronDown,
  ChevronRight, Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import { loadCanonicalIdentity } from "./api/canonical-identity";

// ── Types ─────────────────────────────────────────────────────
type JobStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

interface AsyncJob {
  id: string;
  job_type: string;
  status: JobStatus;
  progress: { total: number; processed: number; succeeded: number; failed: number };
  payload_summary: { source?: string; estimated_count?: number } | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  /** Local-only flag — set when a row was patched in via Realtime
      so we can briefly highlight it. Never sent to the server. */
  _justUpdated?: boolean;
}

type StatusFilter = "all" | "active" | "completed" | "failed";

const STATUS_META: Record<JobStatus, { label: string; color: string; bg: string; icon: any }> = {
  pending:   { label: "Pending",   color: "#FF9500", bg: "rgba(255,149,0,0.10)",  icon: Clock },
  running:   { label: "Running",   color: "#00C8E0", bg: "rgba(0,200,224,0.10)",  icon: Loader2 },
  paused:    { label: "Paused",    color: "#9B59B6", bg: "rgba(155,89,182,0.10)", icon: Clock },
  completed: { label: "Completed", color: "#00C853", bg: "rgba(0,200,83,0.10)",   icon: CheckCircle2 },
  failed:    { label: "Failed",    color: "#FF2D55", bg: "rgba(255,45,85,0.10)",  icon: XCircle },
  cancelled: { label: "Cancelled", color: "#7A7A7A", bg: "rgba(122,122,122,0.10)", icon: Ban },
};

const JOB_TYPE_LABEL: Record<string, string> = {
  bulk_invite: "Bulk Employee Invite",
  csv_import:  "CSV Employee Import",
  scim_sync:   "SCIM Directory Sync",
  data_export: "Data Export",
};

// ── E1.6-DIAG: localStorage breadcrumbs (bypass EnvShield) ──
// TEMPORARY diagnostic for why useEffect's IIFE never reaches setCompanyId.
// Read from DevTools Console: localStorage.getItem('_dbg_jobs')
function dlog(msg: string): void {
  try {
    const cur = localStorage.getItem('_dbg_jobs') || '';
    const next = cur + `\n[${new Date().toISOString().slice(11, 23)}] ${msg}`;
    // Cap at 32KB so we don't blow up storage
    localStorage.setItem('_dbg_jobs', next.slice(-32768));
  } catch (_) { /* non-fatal */ }
}

// ── Helpers ───────────────────────────────────────────────────
function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60)   return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)   return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr  < 24)   return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7)    return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function pct(progress: AsyncJob["progress"]): number {
  if (!progress?.total || progress.total <= 0) return 0;
  return Math.round((progress.processed / progress.total) * 100);
}

// ═════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════
export function DashboardJobsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [jobs,      setJobs]      = useState<AsyncJob[]>([]);
  const [filter,    setFilter]    = useState<StatusFilter>("all");
  const [expanded,  setExpanded]  = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  // E1.6-DIAG: render counter to see if parent re-renders us excessively
  dlog('E1.RENDER');

  // ── Initial load: identity → fetch jobs ─────────────────────
  const loadJobs = useCallback(async (cid: string) => {
    dlog(`E1.LOADJOBS_CALLED cid=${cid.slice(0,8)}`);
    const { data, error } = await supabase.rpc("get_my_jobs", {
      p_company_id: cid,
      p_limit:      50,
    });
    dlog(`E1.LOADJOBS_RPC_RETURNED err=${error?.message?.slice(0,40) || 'null'} jobs=${(data as any)?.jobs?.length ?? 'NF'}`);
    if (error) {
      toast.error(`Failed to load jobs: ${error.message}`);
      return;
    }
    const result = data as { ok?: boolean; jobs?: AsyncJob[] } | null;
    setJobs(Array.isArray(result?.jobs) ? result!.jobs : []);
  }, []);

  useEffect(() => {
    const runId = Math.random().toString(36).slice(2, 6);
    dlog(`E1.MOUNT runId=${runId} cfg=${SUPABASE_CONFIG.isConfigured}`);
    if (!SUPABASE_CONFIG.isConfigured) {
      dlog(`E1.NO_CFG_BAIL runId=${runId}`);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      dlog(`E1.IIFE_START runId=${runId}`);
      try {
        const id = await loadCanonicalIdentity(supabase);
        const ac = id?.active_company?.id;
        dlog(`E1.LCID_DONE runId=${runId} cancelled=${cancelled} ac=${ac ? ac.slice(0,8) : 'null'} role=${id?.primary_role || 'null'}`);
        if (cancelled) {
          dlog(`E1.BAIL_CANCELLED runId=${runId}`);
          return;
        }
        const cid = ac || null;
        setCompanyId(cid);
        dlog(`E1.SET_CID runId=${runId} cid=${cid ? cid.slice(0,8) : 'null'}`);
        if (cid) {
          await loadJobs(cid);
          dlog(`E1.LOADJOBS_DONE runId=${runId}`);
        }
        setLoading(false);
        dlog(`E1.SET_LOADING_FALSE runId=${runId}`);
      } catch (e) {
        dlog(`E1.IIFE_THREW runId=${runId} err=${(e as Error)?.message?.slice(0, 80) || 'unknown'}`);
      }
    })();
    return () => {
      cancelled = true;
      dlog(`E1.CLEANUP runId=${runId}`);
    };
  }, [loadJobs]);

  // ── Realtime subscription: company-scoped patches ───────────
  useEffect(() => {
    if (!companyId || !SUPABASE_CONFIG.isConfigured) return;

    const channel = supabase
      .channel(`async_jobs:${companyId}`)
      .on(
        // deno-lint-ignore no-explicit-any
        "postgres_changes" as any,
        {
          event:  "*",
          schema: "public",
          table:  "async_job_metadata",
          filter: `company_id=eq.${companyId}`,
        },
        (payload: { eventType: "INSERT" | "UPDATE" | "DELETE"; new: any; old: any }) => {
          setJobs(prev => {
            if (payload.eventType === "DELETE") {
              return prev.filter(j => j.id !== payload.old?.id);
            }
            const incoming = payload.new as AsyncJob;
            if (!incoming?.id) return prev;
            // Mark as just-updated so we can briefly highlight
            const flagged = { ...incoming, _justUpdated: true } as AsyncJob;
            const existsIdx = prev.findIndex(j => j.id === incoming.id);
            if (existsIdx >= 0) {
              const next = [...prev];
              next[existsIdx] = { ...next[existsIdx], ...flagged };
              return next;
            }
            // INSERT: prepend (newest first)
            return [flagged, ...prev];
          });

          // Clear the highlight after a short window
          setTimeout(() => {
            setJobs(prev => prev.map(j =>
              j.id === payload.new?.id ? { ...j, _justUpdated: false } : j
            ));
          }, 1500);
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [companyId]);

  // ── Manual refresh (also re-runs canonical identity in case
  //    company changed via tenant switch) ────────────────────────
  const handleRefresh = async () => {
    if (!companyId) return;
    setRefreshing(true);
    try {
      await loadJobs(companyId);
      toast.success("Jobs refreshed");
    } finally {
      setRefreshing(false);
    }
  };

  // ── Cancel a job ────────────────────────────────────────────
  const handleCancel = async (jobId: string) => {
    setCancellingIds(prev => new Set(prev).add(jobId));
    try {
      const { data, error } = await supabase.rpc("cancel_job", { p_job_id: jobId });
      if (error) {
        toast.error(`Cancel failed: ${error.message}`);
        return;
      }
      const result = data as { ok?: boolean; error?: string } | null;
      if (!result?.ok) {
        toast.error(`Cancel failed: ${result?.error ?? "unknown"}`);
        return;
      }
      toast.success("Job cancelled");
      // Realtime will patch it in; optimistic update for snappiness:
      setJobs(prev => prev.map(j => j.id === jobId
        ? { ...j, status: "cancelled" as JobStatus }
        : j
      ));
    } finally {
      setCancellingIds(prev => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  // ── Filter ──────────────────────────────────────────────────
  const filteredJobs = useMemo(() => {
    if (filter === "all") return jobs;
    return jobs.filter(j => {
      if (filter === "active")    return j.status === "pending" || j.status === "running" || j.status === "paused";
      if (filter === "completed") return j.status === "completed";
      if (filter === "failed")    return j.status === "failed" || j.status === "cancelled";
      return true;
    });
  }, [jobs, filter]);

  const counts = useMemo(() => ({
    all:       jobs.length,
    active:    jobs.filter(j => j.status === "pending" || j.status === "running" || j.status === "paused").length,
    completed: jobs.filter(j => j.status === "completed").length,
    failed:    jobs.filter(j => j.status === "failed" || j.status === "cancelled").length,
  }), [jobs]);

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="px-5 py-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.4px" }}>
            Background Jobs
          </h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>
            Bulk operations queued for processing — invite batches, CSV imports, directory syncs. Updates live.
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleRefresh}
          disabled={refreshing || !companyId}
          className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.85)",
            fontSize: 12,
            fontWeight: 700,
            opacity: refreshing || !companyId ? 0.5 : 1,
          }}>
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </motion.button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(["all", "active", "completed", "failed"] as StatusFilter[]).map(f => {
          const isActive = filter === f;
          const count    = counts[f];
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-xl flex items-center gap-2 transition-all"
              style={{
                background: isActive ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${isActive ? "rgba(0,200,224,0.30)" : "rgba(255,255,255,0.06)"}`,
                color: isActive ? "#00C8E0" : "rgba(255,255,255,0.65)",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "capitalize",
              }}>
              {f}
              <span style={{
                fontSize: 10,
                fontWeight: 800,
                background: isActive ? "rgba(0,200,224,0.20)" : "rgba(255,255,255,0.06)",
                color: isActive ? "#00C8E0" : "rgba(255,255,255,0.5)",
                padding: "1px 6px",
                borderRadius: 8,
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Body */}
      {loading ? (
        <LoadingState />
      ) : !companyId ? (
        <EmptyState
          title="No active company"
          description="Sign in as a company owner to view background jobs."
        />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "No jobs yet" : `No ${filter} jobs`}
          description={filter === "all"
            ? "Bulk invitations and CSV imports will appear here as they run."
            : "Try switching the filter to see other jobs."}
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filteredJobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                expanded={expanded.has(job.id)}
                onToggle={() => setExpanded(prev => {
                  const next = new Set(prev);
                  if (next.has(job.id)) next.delete(job.id); else next.add(job.id);
                  return next;
                })}
                onCancel={() => handleCancel(job.id)}
                cancelling={cancellingIds.has(job.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// JobCard
// ═════════════════════════════════════════════════════════════
function JobCard({
  job, expanded, onToggle, onCancel, cancelling,
}: {
  job: AsyncJob;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const meta    = STATUS_META[job.status] || STATUS_META.pending;
  const Icon    = meta.icon;
  const total   = job.progress?.total ?? 0;
  const done    = job.progress?.processed ?? 0;
  const sent    = job.progress?.succeeded ?? 0;
  const failed  = job.progress?.failed ?? 0;
  const percent = pct(job.progress);
  const cancellable = job.status === "pending" || job.status === "running" || job.status === "paused";
  const typeLabel  = JOB_TYPE_LABEL[job.job_type] || job.job_type;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{
        opacity: 1,
        y: 0,
        boxShadow: job._justUpdated
          ? "0 0 0 1px rgba(0,200,224,0.4), 0 4px 24px rgba(0,200,224,0.15)"
          : "0 0 0 1px rgba(255,255,255,0.06)",
      }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "rgba(255,255,255,0.025)" }}>
      {/* Top row: icon + title + status pill + cancel */}
      <div className="px-4 py-3 flex items-center gap-3">
        <button
          onClick={onToggle}
          className="size-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: meta.bg }}>
          <Icon
            className={`size-4 ${job.status === "running" ? "animate-spin" : ""}`}
            style={{ color: meta.color }}
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>
              {typeLabel}
            </span>
            <span className="px-2 py-0.5 rounded-md" style={{
              background: meta.bg, color: meta.color, fontSize: 10, fontWeight: 800,
              letterSpacing: "0.3px", textTransform: "uppercase",
            }}>
              {meta.label}
            </span>
            {job.attempt_count > 1 && (
              <span className="px-2 py-0.5 rounded-md flex items-center gap-1" style={{
                background: "rgba(255,149,0,0.10)", color: "#FF9500",
                fontSize: 10, fontWeight: 700,
              }}>
                <RefreshCw className="size-2.5" />
                Retry #{job.attempt_count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5" style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
            <span className="flex items-center gap-1">
              <Users className="size-3" />
              {total.toLocaleString()} total
            </span>
            {(sent > 0 || failed > 0) && (
              <>
                <span style={{ color: "#00C853" }}>{sent.toLocaleString()} sent</span>
                {failed > 0 && <span style={{ color: "#FF2D55" }}>{failed.toLocaleString()} failed</span>}
              </>
            )}
            <span>· {relativeTime(job.created_at)}</span>
          </div>
        </div>

        {cancellable && (
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={onCancel}
            disabled={cancelling}
            className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 shrink-0"
            style={{
              background: "rgba(255,45,85,0.08)",
              border: "1px solid rgba(255,45,85,0.16)",
              color: "#FF2D55",
              fontSize: 11,
              fontWeight: 700,
              opacity: cancelling ? 0.5 : 1,
            }}>
            <Ban className="size-3" />
            {cancelling ? "Cancelling…" : "Cancel"}
          </motion.button>
        )}

        <button
          onClick={onToggle}
          className="size-7 rounded-md flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.03)" }}>
          {expanded
            ? <ChevronDown className="size-3.5" style={{ color: "rgba(255,255,255,0.5)" }} />
            : <ChevronRight className="size-3.5" style={{ color: "rgba(255,255,255,0.5)" }} />
          }
        </button>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="px-4 pb-3">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.4 }}
              className="h-full"
              style={{
                background: job.status === "failed" ? "#FF2D55" :
                            job.status === "completed" ? "#00C853" :
                            "linear-gradient(90deg, #00C8E0, #00E676)",
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5" style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
            <span>{done.toLocaleString()} / {total.toLocaleString()} processed</span>
            <span>{percent}%</span>
          </div>
        </div>
      )}

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden">
            <div className="px-4 pb-4 pt-1 space-y-2" style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
              <DetailRow label="Job ID"     value={<code style={{ fontFamily: "monospace", fontSize: 10 }}>{job.id}</code>} />
              <DetailRow label="Source"     value={job.payload_summary?.source ?? "—"} />
              <DetailRow label="Created"    value={new Date(job.created_at).toLocaleString()} />
              <DetailRow label="Started"    value={job.started_at ? new Date(job.started_at).toLocaleString() : "—"} />
              <DetailRow label="Completed"  value={job.completed_at ? new Date(job.completed_at).toLocaleString() : "—"} />
              {job.error_message && (
                <div className="mt-2 p-2.5 rounded-lg flex items-start gap-2"
                  style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.12)" }}>
                  <AlertTriangle className="size-3.5 shrink-0 mt-0.5" style={{ color: "#FF2D55" }} />
                  <span style={{ color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
                    {job.error_message}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: "rgba(255,255,255,0.35)", minWidth: 80 }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.8)" }}>{value}</span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// Loading / Empty states
// ═════════════════════════════════════════════════════════════
function LoadingState() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-2xl px-4 py-4 flex items-center gap-3"
          style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="size-8 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }} />
          <div className="flex-1 space-y-2">
            <div className="h-3 rounded" style={{ background: "rgba(255,255,255,0.04)", width: "40%" }} />
            <div className="h-2 rounded" style={{ background: "rgba(255,255,255,0.025)", width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="text-center py-14 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.06)" }}>
      <div className="size-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
        style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.10)" }}>
        <Inbox className="size-6" style={{ color: "rgba(0,200,224,0.6)" }} />
      </div>
      <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{title}</p>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 6, maxWidth: 360, marginLeft: "auto", marginRight: "auto" }}>
        {description}
      </p>
    </div>
  );
}
