-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260503170553
-- name:     e1_async_job_queue_pgmq_foundation
-- live:     e1_async_job_queue_pgmq_foundation
-- sha256:   7d4d5ff7503b852d (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- E1 / Phase 1: Async Job Queue Foundation (pgmq + metadata + RPCs)
-- ═══════════════════════════════════════════════════════════════════════════
-- ROOT-UP RATIONALE
-- ─────────────────
-- All upstream enterprise capabilities (35K CSV import, SCIM provisioning,
-- nightly digest, retroactive reports for thousands of incidents) need ONE
-- shared primitive: a durable, observable, idempotent job queue.
-- Building it once here means E2 (SCIM), E3 (SAML JIT), E4 (per-seat
-- billing), E5 (multi-region sync) can all consume it instead of each
-- inventing their own ad-hoc batching.
--
-- INDUSTRY ALIGNMENT
-- ──────────────────
-- pgmq is Postgres' SQS-equivalent — built by Tembo + adopted by Supabase.
-- It provides: visibility timeout, dead-letter queues, archive on success,
-- SKIP LOCKED concurrency. Pattern is identical to AWS SQS / Sidekiq /
-- BullMQ / Resque — porting to any of those later is mechanical.
--
-- THIS MIGRATION (E1.2)
-- ─────────────────────
-- Creates ONLY the infrastructure: queue + metadata table + enqueue_job RPC
-- + observability views. Does NOT include the worker/consumer (that ships
-- in E1.4 as a separate edge function with its own deployment surface).
-- This split keeps the DB change atomic and immediately testable on its own.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Pre-flight: assert pgmq is available + 'tasks' table is unused (no row migration needed) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgmq') THEN
    RAISE EXCEPTION 'E1 pre-flight: pgmq extension not available on this Supabase project';
  END IF;
  IF (SELECT COUNT(*) FROM public.tasks) > 0 THEN
    RAISE EXCEPTION 'E1 pre-flight: legacy tasks table has rows — investigate domain overlap before proceeding';
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCK A: enable pgmq + create initial queue
-- ═══════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Bulk-invite is the first consumer (CSV / register_company_full backend).
-- More queues will be added in later phases (e.g., scim_sync, data_export).
-- Idempotent: pgmq.create() does CREATE IF NOT EXISTS internally.
SELECT pgmq.create('bulk_invite');

-- ═════════════════════════════════════════════════════════════════════════
-- BLOCK B: async_job_metadata — progress, audit, observability
-- ════════════════════════════════════════════════════════════════════════════
-- pgmq alone doesn't give us "what's the % done" or "who can see this job".
-- This table sits BESIDE pgmq and tracks:
--   • progress (jsonb: total/processed/succeeded/failed)
--   • RLS-scoped visibility (company_id)
--   • idempotency key for dedup at enqueue time
--   • full state machine: pending → running → completed/failed/cancelled
--   • realtime broadcast to the owning company on every transition
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.async_job_metadata (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pgmq_msg_id     bigint,                  -- references pgmq.q_bulk_invite.msg_id
  queue_name      text        NOT NULL,
  job_type        text        NOT NULL CHECK (job_type IN
                                ('bulk_invite','csv_import','scim_sync','data_export')),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  status          text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  payload_summary jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- redacted summary; full payload in pgmq
  progress        jsonb       NOT NULL DEFAULT
                                jsonb_build_object('total', 0, 'processed', 0, 'succeeded', 0, 'failed', 0),
  error_message   text,
  idempotency_key text,                    -- per-company unique; dedup at enqueue
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  attempt_count   int         NOT NULL DEFAULT 0,
  max_attempts    int         NOT NULL DEFAULT 3
);

-- Indexes: company-scoped status queries for UI; idempotency dedup
CREATE UNIQUE INDEX IF NOT EXISTS uq_async_job_idempotency
  ON public.async_job_metadata (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_async_job_company_status_created
  ON public.async_job_metadata (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_async_job_pgmq_msg
  ON public.async_job_metadata (pgmq_msg_id) WHERE pgmq_msg_id IS NOT NULL;

-- ── RLS: only company members + service_role can see their own jobs ──
ALTER TABLE public.async_job_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.async_job_metadata FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS async_job_metadata_select_company ON public.async_job_metadata;
CREATE POLICY async_job_metadata_select_company
  ON public.async_job_metadata FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.company_memberships cm
             WHERE cm.company_id = async_job_metadata.company_id
               AND cm.user_id    = auth.uid()
               AND cm.active     = true)
  );

-- INSERT/UPDATE only via SECDEF RPCs (no direct table writes from clients).
-- Service role can do anything (workers + admin).
DROP POLICY IF EXISTS async_job_metadata_no_client_write ON public.async_job_metadata;
CREATE POLICY async_job_metadata_no_client_write
  ON public.async_job_metadata FOR ALL
  USING (false) WITH CHECK (false);

-- Service role bypasses RLS automatically; the false-policy above just blocks
-- end-users min writing directly. RPCs below are SECDEF and skip RLS.

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK C: enqueue_job RPC
-- ════════════════════════════════════════════════════════════════════════════
-- Single entry point for clients to schedule async work. Validates ownership,
-- enforces idempotency (returns existing job_id on duplicate key), inserts
-- metadata row, sends payload to pgmq, returns job_id.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_job_type        text,
  p_company_id      uuid,
  p_payload         jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_max_attempts    int  DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_user_id    uuid := auth.uid();
  v_existing   uuid;
  v_job_id     uuid;
  v_msg_id     bigint;
  v_queue      text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'enqueue_job: not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Map job_type → queue name (1:1 today, but allows fan-out later)
  v_queue := CASE p_job_type
    WHEN 'bulk_invite' THEN 'bulk_invite'
    WHEN 'csv_import'  THEN 'bulk_invite'  -- shares queue (same handler)
    WHEN 'scim_sync'   THEN 'bulk_invite'  -- placeholder until E2 lands
    WHEN 'data_export' THEN 'bulk_invite'  -- placeholder until later phase
    ELSE NULL
  END;
  IF v_queue IS NULL THEN
    RAISE EXCEPTION 'enqueue_job: unknown job_type %', p_job_type
      USING ERRCODE = '22023';
  END IF;

  -- Caller MUST own the company (or be active member with admin role).
  -- For now: only owner can enqueue. Tightens later phases.
  IF NOT EXISTS (
    SELECT 1 FROM public.companies
     WHERE id = p_company_id AND owner_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'enqueue_job: caller does not own company %', p_company_id
      USING ERRCODE = '42501';
  END IF;

  -- Idempotency: if a job with the same (company_id, idempotency_key) already
  -- exists and is not in a terminal failed state, return its id (no duplicate).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing
      FROM public.async_job_metadata
     WHERE company_id = p_company_id
       AND idempotency_key = p_idempotency_key
       AND status IN ('pending','running','paused','completed')
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'job_id', v_existing,
        'deduplicated', true
      );
    END IF;
  END IF;

  -- Send payload to pgmq queue (returns msg_id)
  SELECT pgmq.send(v_queue, p_payload) INTO v_msg_id;

  -- Persist metadata row
  INSERT INTO public.async_job_metadata
    (pgmq_msg_id, queue_name, job_type, company_id, created_by, status,
     payload_summary, idempotency_key, max_attempts, progress)
  VALUES
    (v_msg_id, v_queue, p_job_type, p_company_id, v_user_id, 'pending',
     -- payload_summary: only meta fields, never full sensitive data
     jsonb_build_object(
       'estimated_count', COALESCE((p_payload->>'estimated_count')::int,
                                    jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb))),
       'source',          p_payload->>'source'
     ),
     p_idempotency_key,
     GREATEST(1, LEAST(10, p_max_attempts)),
     jsonb_build_object(
       'total',     COALESCE((p_payload->>'estimated_count')::int,
                              jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb))),
       'processed', 0, 'succeeded', 0, 'failed', 0
     )
    )
  RETURNING id INTO v_job_id;

  -- Audit (best-effort — never blocks the enqueue)
  BEGIN
    INSERT INTO public.audit_log
      (id, action, actor, actor_id, actor_role, operation, target, target_id,
       category, severity, metadata, created_at)
    VALUES
      (gen_random_uuid()::text, 'job_enqueued',
       'user', v_user_id::text, 'user', 'INSERT',
       p_company_id::text, v_job_id::text,
       'workflow', 'info',
       jsonb_build_object('job_type', p_job_type, 'queue', v_queue, 'msg_id', v_msg_id),
       NOW());
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job_id,
    'msg_id', v_msg_id,
    'queue',  v_queue
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.enqueue_job(text, uuid, jsonb, text, int) TO authenticated;

COMMENT ON FUNCTION public.enqueue_job IS
  'E1 / Async queue: single entry point to schedule bulk/long-running work. SECDEF + caller-owns-company check + idempotency + pgmq.send + audit_log. World-class pattern (SQS/BullMQ/Sidekiq).';

-- ═════════════════════════════════════════════════════════════════════════════
-- BLOCK D: get_my_jobs RPC + cancel_job RPC (observability + control)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_my_jobs(
  p_company_id uuid DEFAULT NULL,
  p_limit      int  DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_user_id uuid := auth.uid();
  v_jobs    jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'get_my_jobs: not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',              j.id,
      'job_type',        j.job_type,
      'status',          j.status,
      'progress',        j.progress,
      'payload_summary', j.payload_summary,
      'error_message',   j.error_message,
      'attempt_count',   j.attempt_count,
      'created_at',      j.created_at,
      'started_at',      j.started_at,
      'completed_at',    j.completed_at
    ) ORDER BY j.created_at DESC
  ), '[]'::jsonb) INTO v_jobs
  FROM public.async_job_metadata j
  JOIN public.company_memberships cm
    ON cm.company_id = j.company_id
   AND cm.user_id    = v_user_id
   AND cm.active     = true
  WHERE (p_company_id IS NULL OR j.company_id = p_company_id)
  LIMIT GREATEST(1, LEAST(200, p_limit));

  RETURN jsonb_build_object('ok', true, 'jobs', v_jobs);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_my_jobs(uuid, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_user_id uuid := auth.uid();
  v_job     record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'cancel_job: not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.company_id, j.status, j.queue_name, j.pgmq_msg_id
    INTO v_job
    FROM public.async_job_metadata j
    JOIN public.companies c ON c.id = j.company_id AND c.owner_id = v_user_id
   WHERE j.id = p_job_id
   LIMIT 1;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'cancel_job: job not found or you do not own its company'
      USING ERRCODE = '42501';
  END IF;

  IF v_job.status NOT IN ('pending', 'paused') THEN
    RAISE EXCEPTION 'cancel_job: job % is in status % — can only cancel pending/paused',
      p_job_id, v_job.status
      USING ERRCODE = '22023';
  END IF;

  -- Try to delete the pgmq message (best-effort; worker may have already grabbed it)
  BEGIN
    PERFORM pgmq.delete(v_job.queue_name, v_job.pgmq_msg_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  UPDATE public.async_job_metadata
     SET status = 'cancelled', completed_at = NOW()
   WHERE id = v_job.id;

  -- Audit
  BEGIN
    INSERT INTO public.audit_log
      (id, action, actor, actor_id, actor_role, operation, target, target_id,
       category, severity, metadata, created_at)
    VALUES
      (gen_random_uuid()::text, 'job_cancelled',
       'user', v_user_id::text, 'user', 'UPDATE',
       v_job.company_id::text, p_job_id::text,
       'workflow', 'info',
       jsonb_build_object('queue', v_job.queue_name),
       NOW());
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'cancelled', p_job_id);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.cancel_job(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCK E: Realtime publication (so frontend can subscribe to job updates)
-- ════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'async_job_metadata'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.async_job_metadata;
  END IF;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- BLOCK F: post-condition assertions
-- ═════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- Queue exists
  IF NOT EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'bulk_invite') THEN
    RAISE EXCEPTION 'E1 post-condition: bulk_invite queue not created';
  END IF;
  -- Functions exist
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enqueue_job' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'E1 post-condition: enqueue_job RPC missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_my_jobs' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'E1 post-condition: get_my_jobs RPC missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cancel_job' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'E1 post-condition: cancel_job RPC missing';
  END IF;
  -- RLS on
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.async_job_metadata'::regclass) THEN
    RAISE EXCEPTION 'E1 post-condition: RLS not enabled on async_job_metadata';
  END IF;
END;
$$;;
