-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — L1-C: sos_pipeline_metrics — end-to-end SOS timing telemetry
-- ─────────────────────────────────────────────────────────────────────────
-- Layer 1 of the life-safety foundation pyramid (LIFE_SAFETY_FOUNDATION.md).
-- Builds on L1-A (trace_id) and L1-B (client/server timestamps) to produce
-- a SINGLE ROW per SOS lifecycle that captures every relevant timing
-- marker, channel decision, escalation, and outcome — keyed on trace_id.
--
-- WHY A SEPARATE TABLE:
--   sos_sessions already holds the runtime state of an SOS — by design
--   it's a "current state" snapshot, mutated heavily during the lifecycle
--   (status flips, contacts updated, escalation_stage advances). It's the
--   wrong place to store the immutable forensic record we need for:
--     • p50/p95/p99 dispatch-latency dashboards
--     • Synthetic probe pass/fail history (L1-D)
--     • Per-tenant SLA reports (L1-E)
--     • Court-admissible ISO/IEC 27037 timelines (Q8)
--   sos_pipeline_metrics is APPEND-once, UPDATE-only-by-trace_id, never
--   deleted (except via Right-to-be-Forgotten, which anonymizes user_id).
--
-- WHY NOT REUSE sos_dispatch_logs:
--   Live discovery 2026-05-08: sos_dispatch_logs has 0 rows, 0 callers in
--   code (lint-guard.mjs explicitly bans .from('sos_dispatch_logs')), and
--   schema captures only (id, request_id, ok, status, error, created_at)
--   — none of the timing markers we need. It's a deprecated table on the
--   drop-candidate list. We leave it alone (separate cleanup migration).
--
-- LIFECYCLE:
--   1. trigger fires    → INSERT (in_progress, server_received_at = now())
--   2. watchdog runs    → UPDATE watchdog_escalations++ on stage 1/2 fire
--   3. twilio-status    → UPDATE responder_acked_at when contact presses 1
--   4. end fires        → UPDATE ended_at + computed *_ms + pipeline_status
--
-- ROLLBACK:
--   DROP TABLE public.sos_pipeline_metrics CASCADE;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sos_pipeline_metrics (
  -- Identity (trace_id is the natural primary key — 1:1 with one SOS press)
  trace_id              uuid PRIMARY KEY,
  emergency_id          text NOT NULL,
  user_id               uuid,
  company_id            uuid,
  tier                  text,

  -- Timing markers (server-authoritative where possible)
  client_claimed_at     timestamptz,
  server_received_at    timestamptz NOT NULL,
  primary_alert_dispatched_at timestamptz,
  responder_acked_at    timestamptz,
  ended_at              timestamptz,

  -- Computed durations (milliseconds, denormalized for fast aggregation)
  -- Filled progressively: client_to_server_ms on insert, others on update.
  client_to_server_ms   integer,
  server_to_dispatch_ms integer,
  press_to_ack_ms       integer,
  total_session_ms      integer,

  -- Channel + escalation breakdown
  channel_used          text CHECK (channel_used IS NULL OR channel_used IN ('push','sms','voice','call','conference','all','none')),
  fallbacks_triggered   text[] DEFAULT '{}'::text[],
  watchdog_escalations  integer NOT NULL DEFAULT 0,
  contacts_attempted    integer NOT NULL DEFAULT 0,
  contacts_reached      integer NOT NULL DEFAULT 0,

  -- Outcome
  pipeline_status       text NOT NULL DEFAULT 'in_progress'
                          CHECK (pipeline_status IN ('in_progress','success','partial','failed','cancelled')),
  failure_reason        text,

  -- Special flags
  is_synthetic          boolean NOT NULL DEFAULT false,
  is_drill              boolean NOT NULL DEFAULT false,

  -- Bookkeeping
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sos_pipeline_metrics IS
  'L1-C observability: one immutable forensic row per SOS lifecycle, keyed on trace_id. Source of truth for p50/p95/p99 dispatch latency, synthetic probe pass/fail, per-tenant SLA reports, and ISO/IEC 27037 chain-of-custody timelines.';

COMMENT ON COLUMN public.sos_pipeline_metrics.client_to_server_ms IS
  'Milliseconds between client_claimed_at and server_received_at. Negative or > 30000 = clock skew or offline replay (forensic flag).';

COMMENT ON COLUMN public.sos_pipeline_metrics.server_to_dispatch_ms IS
  'Milliseconds between server_received_at and the first SMS/call dispatched to a contact. SLA target: < 2000ms p95 across all tiers.';

COMMENT ON COLUMN public.sos_pipeline_metrics.press_to_ack_ms IS
  'End-to-end: from button press to first contact pressing 1 (acknowledged). The single most important number for life-safety SLA.';

-- Indexes for the queries the dashboard / probe / forensic tools will run.
CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_created_at
  ON public.sos_pipeline_metrics (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_user_created
  ON public.sos_pipeline_metrics (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_company_created
  ON public.sos_pipeline_metrics (company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_synthetic
  ON public.sos_pipeline_metrics (created_at DESC)
  WHERE is_synthetic = true;

CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_status_created
  ON public.sos_pipeline_metrics (pipeline_status, created_at DESC)
  WHERE pipeline_status IN ('partial','failed');

-- ── Auto-update updated_at on every UPDATE ────────────────────────────
CREATE OR REPLACE FUNCTION public._sos_pipeline_metrics_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sos_pipeline_metrics_touch ON public.sos_pipeline_metrics;
CREATE TRIGGER sos_pipeline_metrics_touch
  BEFORE UPDATE ON public.sos_pipeline_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public._sos_pipeline_metrics_touch();

-- ── RLS: service-role write, tenant-scoped read (admin/owner only) ────
ALTER TABLE public.sos_pipeline_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sos_pipeline_metrics FORCE ROW LEVEL SECURITY;

-- service_role bypasses RLS. authenticated read access is tenant-scoped:
-- you can read rows where (a) you're the user the row is about, OR
-- (b) you're an active admin/owner of the company the row belongs to.
DROP POLICY IF EXISTS pipeline_metrics_self_read ON public.sos_pipeline_metrics;
CREATE POLICY pipeline_metrics_self_read
  ON public.sos_pipeline_metrics
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS pipeline_metrics_company_admin_read ON public.sos_pipeline_metrics;
CREATE POLICY pipeline_metrics_company_admin_read
  ON public.sos_pipeline_metrics
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.company_memberships cm
      WHERE cm.company_id = sos_pipeline_metrics.company_id
        AND cm.user_id    = auth.uid()
        AND cm.active     = true
        AND cm.role IN ('admin','owner')
    )
  );

-- No INSERT / UPDATE / DELETE policies for authenticated — only
-- service_role (which bypasses RLS) can write. This is the same
-- pattern as audit_log: writes happen exclusively via SECURITY
-- DEFINER RPCs called from edge functions. We will add the RPCs
-- in a follow-up migration once the edge function wiring is in place.

GRANT SELECT ON public.sos_pipeline_metrics TO authenticated;
GRANT ALL    ON public.sos_pipeline_metrics TO service_role;
