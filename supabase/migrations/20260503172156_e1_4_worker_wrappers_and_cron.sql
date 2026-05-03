-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260503172156
-- name:     e1_4_worker_wrappers_and_cron
-- live:     e1_4_worker_wrappers_and_cron
-- sha256:   e2d070ca5bb80da1 (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- E1.4: Worker wrappers + pg_cron schedule for process-bulk-invite
-- (Worker-side companion to E1.2 enqueue infrastructure.)
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable pg_net (HTTP from cron) — pgmq + pg_cron already installed by E1.2/CRIT-#16
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Pre-flight ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgmq') THEN
    RAISE EXCEPTION 'E1.4 pre-flight: pgmq missing (run E1.2 first)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'E1.4 pre-flight: pg_cron missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'E1.4 pre-flight: pg_net failed to install';
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK A: thin wrappers around pgmq, restricted to service_role
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.worker_read_jobs(
  p_queue_name text, p_qty int, p_vt_secs int
)
RETURNS TABLE(msg_id bigint, read_ct int, enqueued_at timestamptz, vt timestamptz, message jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pgmq, public, pg_catalog
AS $$
  SELECT msg_id, read_ct, enqueued_at, vt, message
    FROM pgmq.read(p_queue_name, p_vt_secs, p_qty);
$$;
REVOKE EXECUTE ON FUNCTION public.worker_read_jobs(text, int, int) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.worker_read_jobs(text, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.worker_archive_job(p_queue_name text, p_msg_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pgmq, public, pg_catalog
AS $$
  SELECT pgmq.archive(p_queue_name, p_msg_id);
$$;
REVOKE EXECUTE ON FUNCTION public.worker_archive_job(text, bigint) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.worker_archive_job(text, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.worker_requeue_job_with_delay(
  p_queue_name text, p_payload jsonb, p_delay_secs int
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = pgmq, public, pg_catalog
AS $$
  SELECT pgmq.send(p_queue_name, p_payload, p_delay_secs);
$$;
REVOKE EXECUTE ON FUNCTION public.worker_requeue_job_with_delay(text, jsonb, int) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.worker_requeue_job_with_delay(text, jsonb, int) TO service_role;

-- queue depth observability — readable by authenticated for ops UI
CREATE OR REPLACE FUNCTION public.worker_queue_depth(p_queue_name text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pgmq, public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'queue_name',         p_queue_name,
    'queue_length',       (SELECT queue_length      FROM pgmq.metrics(p_queue_name) LIMIT 1),
    'newest_msg_age_sec', (SELECT newest_msg_age_sec FROM pgmq.metrics(p_queue_name) LIMIT 1),
    'oldest_msg_age_sec', (SELECT oldest_msg_age_sec FROM pgmq.metrics(p_queue_name) LIMIT 1)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.worker_queue_depth(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.worker_queue_depth(text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK B: pg_cron schedule + secrets-driven trigger
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sosphere_bulk_invite_worker') THEN
    PERFORM cron.unschedule('sosphere_bulk_invite_worker');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_bulk_invite_worker()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_catalog
AS $$
DECLARE
  v_url      text;
  v_secret   text;
  v_request  bigint;
BEGIN
  BEGIN SELECT decrypted_secret INTO v_url
          FROM vault.decrypted_secrets WHERE name = 'process_bulk_invite_url';
  EXCEPTION WHEN OTHERS THEN v_url := NULL; END;

  BEGIN SELECT decrypted_secret INTO v_secret
          FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret';
  EXCEPTION WHEN OTHERS THEN v_secret := NULL; END;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'secrets_not_configured');
  END IF;

  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) INTO v_request;

  RETURN jsonb_build_object('ok', true, 'request_id', v_request);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trigger_bulk_invite_worker FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'sosphere_bulk_invite_worker',
  '* * * * *',
  $cron$ SELECT public.trigger_bulk_invite_worker(); $cron$
);

-- ══════════════════════════════════════════════════════════════════════════
-- BLOCK C: post-condition
-- ══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sosphere_bulk_invite_worker') THEN
    RAISE EXCEPTION 'E1.4 post-condition: cron job not scheduled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'worker_read_jobs' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'E1.4 post-condition: worker_read_jobs missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trigger_bulk_invite_worker' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'E1.4 post-condition: trigger_bulk_invite_worker missing';
  END IF;
END;
$$;;
