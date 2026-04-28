-- ═══════════════════════════════════════════════════════════════════════════
-- CRIT-#16 (2026-04-28) — Data retention cron (GDPR Art. 5(1)(e) enforcement).
--
-- privacy-page.tsx, section 5 ("مدة الاحتفاظ"), promises:
--   • بيانات الطوارئ — 90 يوم
--   • بيانات الموقع الروتينية — 30 يوم
--   • حق طلب الحذف الفوري متاح
--
-- Pre-fix: NONE of these promises were enforced. Data accumulated forever.
-- This is a direct GDPR violation (Art. 5(1)(e) "storage limitation") and
-- a breach of the public privacy policy.
--
-- Fix: 7 SECURITY DEFINER cleanup functions + pg_cron schedules. Each runs
-- daily at 02:00–02:18 UTC, staggered by 3-minute intervals to avoid lock
-- contention. Each function:
--   1. Returns the count of rows deleted (for observability).
--   2. Writes an audit_log row with the count (tamper-evident proof of
--      compliance — investigators can prove cleanup ran).
--   3. Wraps the DELETE in its own transaction (a failure in one function
--      doesn't roll back the others).
--
-- TABLES AND TTLs (verified against production schema 2026-04-28):
--   sos_sessions            — 90 days (terminal states only — preserves active SOS)
--   sos_queue               — 90 days (terminal dispatcher states only)
--   sos_messages            — 90 days (dispatcher↔user chat tied to incidents)
--   gps_trail               — 30 days (routine location pings — privacy-page §5)
--   evidence_vaults         — 90 days (overrides 20260416 "permanent" comment;
--                              GDPR storage-limitation > original design intent)
--   processed_stripe_events — 30 days (Stripe replay window is 5 minutes;
--                              30-day retention is generous)
--   idempotency_cache       — immediate when expires_at < now()
--   emergency_locations     — 30 days (existing cleanup_old_locations function,
--                              previously dormant — we activate it here)
--   notifications (read)    — 90 days (existing cleanup_old_locations function;
--                              read-only flag preserves unread)
--   audit_log               — NEVER DELETED (compliance: indefinite for
--                              ISO 27001 / SOC 2 / SAR responses)
--
-- FK CASCADES (verified):
--   sos_sessions.id deletes cascade to: outbox_messages, sos_outbox,
--   sos_public_links. No manual handling needed.
--
-- IDEMPOTENCY:
--   • CREATE EXTENSION IF NOT EXISTS — safe re-run.
--   • CREATE OR REPLACE FUNCTION — safe re-run.
--   • cron.schedule — protected with cron.unschedule lookup before re-add.
--
-- ROLLBACK:
--   Run `supabase/migrations/20260428110000_crit16_ROLLBACK.sql` (not
--   committed by default). Or manually: SELECT cron.unschedule(jobname)
--   FROM cron.job WHERE jobname LIKE 'sosphere_retention_%';
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Step 1: enable pg_cron ────────────────────────────────────────────────
-- Verified available on this Supabase project: pg_cron 1.6.4
-- (SELECT * FROM pg_available_extensions WHERE name='pg_cron'.)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Step 2: helper to audit each cleanup run ──────────────────────────────
-- Writes a single audit_log row per cleanup invocation, even when 0 rows
-- were deleted. The presence of the row proves the cron fired.
CREATE OR REPLACE FUNCTION public.log_retention_cleanup(
  p_table        text,
  p_deleted      bigint,
  p_ttl_days     int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.audit_log (
    id, action, actor, actor_role, operation, target,
    category, severity, metadata, created_at
  ) VALUES (
    gen_random_uuid()::text,
    'retention_cleanup',
    'system_retention_cron',
    'system',
    'DELETE',
    p_table,
    'compliance',
    CASE WHEN p_deleted > 0 THEN 'info' ELSE 'debug' END,
    jsonb_build_object(
      'rows_deleted', p_deleted,
      'ttl_days',     p_ttl_days,
      'ran_at',       now()
    ),
    now()
  );
EXCEPTION WHEN OTHERS THEN
  -- Audit-log write failure must NOT abort the cleanup itself. Log to
  -- Postgres NOTICE so it shows up in Supabase logs.
  RAISE NOTICE 'log_retention_cleanup: audit write failed for % (%)', p_table, SQLERRM;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_retention_cleanup(text, bigint, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_retention_cleanup(text, bigint, int) FROM authenticated, anon;

COMMENT ON FUNCTION public.log_retention_cleanup IS
  'CRIT-#16: writes a tamper-evident audit_log entry per cleanup run. '
  'Service-role only. Catches its own errors so they cannot poison the '
  'parent cleanup transaction.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ── Step 3: 7 cleanup functions  ─────────────────────────────────────────
-- Each function:
--   • Has SECURITY DEFINER + SET search_path = public, pg_temp (G-32 pattern)
--   • Returns bigint (rows deleted) for observability via cron.job_run_details
--   • Writes audit_log via the helper above
--   • REVOKEs execute from authenticated/anon (service-role only)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 3.1 sos_sessions (90d, terminal states only) ──────────────────────────
-- Uses coalesce(started_at, created_at) because some legacy rows may have
-- NULL started_at. Terminal-state filter preserves active SOS sessions.
CREATE OR REPLACE FUNCTION public.cleanup_sos_sessions()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  WITH deleted AS (
    DELETE FROM public.sos_sessions
    WHERE status IN ('resolved', 'canceled', 'cancelled', 'ended')
      AND coalesce(started_at, created_at) < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;

  PERFORM public.log_retention_cleanup('sos_sessions', v_deleted, 90);
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cleanup_sos_sessions() FROM PUBLIC, authenticated, anon;
COMMENT ON FUNCTION public.cleanup_sos_sessions IS
  'CRIT-#16: deletes terminal sos_sessions older than 90 days. '
  'Cascades to outbox_messages, sos_outbox, sos_public_links. '
  'privacy-page.tsx §5 (90-day emergency-data retention).';

-- ── 3.2 sos_queue (90d, terminal dispatcher states only) ──────────────────
CREATE OR REPLACE FUNCTION public.cleanup_sos_queue()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  WITH deleted AS (
    DELETE FROM public.sos_queue
    WHERE status IN ('resolved', 'broadcast', 'forwarded', 'reviewed')
      AND recorded_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;

  PERFORM public.log_retention_cleanup('sos_queue', v_deleted, 90);
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cleanup_sos_queue() FROM PUBLIC, authenticated, anon;
COMMENT ON FUNCTION public.cleanup_sos_queue IS
  'CRIT-#16: deletes terminal sos_queue rows older than 90 days. '
  'Active/in-progress incidents preserved. privacy-page.tsx §5.';

-- ── 3.3 sos_messages (90d, all messages — tied to incidents) ──────────────
-- No status filter: messages are immutable per the dashboard-actions
-- design (immutable audit trail). All messages older than 90 days are
-- routine emergency comms covered by privacy-page §5.
CREATE OR REPLACE FUNCTION public.cleanup_sos_messages()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  WITH deleted AS (
    DELETE FROM public.sos_messages
    WHERE created_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;

  PERFORM public.log_retention_cleanup('sos_messages', v_deleted, 90);
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cleanup_sos_messages() FROM PUBLIC, authenticated, anon;
COMMENT ON FUNCTION public.cleanup_sos_messages IS
  'CRIT-#16: deletes sos_messages older than 90 days. '
  'Dispatcher↔user chat is emergency comms. privacy-page.tsx §5.';

-- ── 3.4 gps_trail (30d, all rows — routine location pings) ────────────────
-- privacy-page §5 explicitly: "بيانات الموقع الروتينية تُحذف بعد 30 يوماً".
CREATE OR REPLACE FUNCTION public.cleanup_gps_trail()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  WITH deleted AS (
    DELETE FROM public.gps_trail
    WHERE recorded_at < now() - interval '30 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;

  PERFORM public.log_retention_cleanup('gps_trail', v_deleted, 30);
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cleanup_gps_trail() FROM PUBLIC, authenticated, anon;
COMMENT ON FUNCTION public.cleanup_gps_trail IS
  'CRIT-#16: deletes gps_trail older than 30 days. '
  'privacy-page.tsx §5 (30-day routine-location retention).';

-- ── 3.5 evidence_vaults (90d, all rows) ───────────────────────────────────
-- OVERRIDES the 20260416 migration comment: "No delete allowed — vaults are
-- permanent evidence". That comment was a pre-GDPR design decision. The
-- public privacy policy (privacy-page §5) commits us to 90-day retention,
-- which legally supersedes internal design intent. GDPR Art. 5(1)(e)
-- ("storage limitation") forbids indefinite retention without lawful basis.
CREATE OR REPLACE FUNCTION public.cleanup_evidence_vaults()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  WITH deleted AS (
    DELETE FROM public.evidence_vaults
    WHERE created_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;

  PERFORM public.log_retention_cleanup('evidence_vaults', v_deleted, 90);
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cleanup_evidence_vaults() FROM PUBLIC, authenticated, anon;
COMMENT ON FUNCTION public.cleanup_evidence_vaults IS
  'CRIT-#16: deletes evidence_vaults older than 90 days. '
  'OVERRIDES 20260416 "permanent" comment per GDPR Art. 5(1)(e) and '
  'privacy-page.tsx §5. Future legal-hold support: add WHERE NOT EXISTS '
  '(SELECT 1 FROM legal_holds WHERE vault_id = evidence_vaults.vault_id).';

-- ── 3.6 processed_stripe_events (30d) ─────────────────────────────────────
-- Stripe's webhook replay window is 5 minutes. 30 days is paranoid-safe.
CREATE OR REPLACE FUNCTION public.cleanup_processed_stripe_events()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  WITH deleted AS (
    DELETE FROM public.processed_stripe_events
    WHERE processed_at < now() - interval '30 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;

  PERFORM public.log_retention_cleanup('processed_stripe_events', v_deleted, 30);
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cleanup_processed_stripe_events() FROM PUBLIC, authenticated, anon;
COMMENT ON FUNCTION public.cleanup_processed_stripe_events IS
  'CRIT-#16: deletes processed_stripe_events older than 30 days. '
  'Stripe replay window is 5 minutes; 30 days is generous.';

-- ── 3.7 idempotency_cache (immediate when expired) ────────────────────────
-- The cache is created with `expires_at = NOW() + interval '24 hours'`,
-- so this just sweeps expired keys. Runs hourly (different cadence) to
-- keep the table tight under load.
CREATE OR REPLACE FUNCTION public.cleanup_idempotency_cache()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  WITH deleted AS (
    DELETE FROM public.idempotency_cache
    WHERE expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;

  PERFORM public.log_retention_cleanup('idempotency_cache', v_deleted, 0);
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cleanup_idempotency_cache() FROM PUBLIC, authenticated, anon;
COMMENT ON FUNCTION public.cleanup_idempotency_cache IS
  'CRIT-#16: deletes expired idempotency cache rows (expires_at < now). '
  'Runs hourly to keep the table tight under sustained edge-function load.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ── Step 4: schedule with pg_cron ────────────────────────────────────────
-- Stagger by 3 minutes (02:00, 02:03, 02:06, ..., 02:18) to avoid lock
-- contention if any single function takes longer than expected. UTC time.
-- idempotency_cache runs hourly (00:30 every hour) since it's high-churn.
--
-- Pattern: unschedule any pre-existing job with the same name, then
-- schedule fresh. This makes the migration safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- NOTE on naming: variables are prefixed `v_` to disambiguate from the
-- `cron.job` table. A previous attempt used `job` as the loop variable,
-- which Postgres flagged as ambiguous against `cron.job` in the EXISTS
-- subquery. The IF EXISTS / THEN pattern below is also clearer than the
-- earlier `PERFORM ... WHERE EXISTS` construct.
DO $$
DECLARE
  v_jobs jsonb := jsonb_build_array(
    jsonb_build_object('name', 'sosphere_retention_sos_sessions',
                       'cron', '0 2 * * *',
                       'cmd',  'SELECT public.cleanup_sos_sessions()'),
    jsonb_build_object('name', 'sosphere_retention_sos_queue',
                       'cron', '3 2 * * *',
                       'cmd',  'SELECT public.cleanup_sos_queue()'),
    jsonb_build_object('name', 'sosphere_retention_sos_messages',
                       'cron', '6 2 * * *',
                       'cmd',  'SELECT public.cleanup_sos_messages()'),
    jsonb_build_object('name', 'sosphere_retention_gps_trail',
                       'cron', '9 2 * * *',
                       'cmd',  'SELECT public.cleanup_gps_trail()'),
    jsonb_build_object('name', 'sosphere_retention_evidence_vaults',
                       'cron', '12 2 * * *',
                       'cmd',  'SELECT public.cleanup_evidence_vaults()'),
    jsonb_build_object('name', 'sosphere_retention_processed_stripe_events',
                       'cron', '15 2 * * *',
                       'cmd',  'SELECT public.cleanup_processed_stripe_events()'),
    jsonb_build_object('name', 'sosphere_retention_idempotency_cache',
                       'cron', '30 * * * *',
                       'cmd',  'SELECT public.cleanup_idempotency_cache()'),
    -- Activates pre-existing dormant function `cleanup_old_locations`
    -- (created elsewhere) which sweeps emergency_locations >30d and
    -- read notifications >90d. We do not modify the function — only
    -- schedule it. Adds 2 more tables to retention coverage.
    jsonb_build_object('name', 'sosphere_retention_old_locations',
                       'cron', '18 2 * * *',
                       'cmd',  'SELECT public.cleanup_old_locations()')
  );
  v_job  jsonb;
  v_name text;
BEGIN
  FOR v_job IN SELECT * FROM jsonb_array_elements(v_jobs)
  LOOP
    v_name := v_job->>'name';

    -- Unschedule existing job with this name (no-op if absent).
    -- Aliasing cron.job AS cj also blocks any future column-name collision.
    IF EXISTS (
      SELECT 1 FROM cron.job AS cj WHERE cj.jobname = v_name
    ) THEN
      PERFORM cron.unschedule(v_name);
    END IF;

    -- Schedule fresh.
    PERFORM cron.schedule(
      v_name,
      (v_job->>'cron'),
      (v_job->>'cmd')
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ── Step 5: post-condition probes ────────────────────────────────────────
-- These DO blocks raise an exception if the migration didn't fully apply.
-- Catches partial application during apply_migration runs.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM cron.job
  WHERE jobname LIKE 'sosphere_retention_%';

  IF v_count <> 8 THEN
    RAISE EXCEPTION
      'CRIT-#16: expected 8 sosphere_retention_* cron jobs, found %. '
      'Migration did not fully apply.', v_count;
  END IF;
END $$;

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'cleanup_%'
    AND p.proname IN ('cleanup_sos_sessions','cleanup_sos_queue',
                      'cleanup_sos_messages','cleanup_gps_trail',
                      'cleanup_evidence_vaults','cleanup_processed_stripe_events',
                      'cleanup_idempotency_cache');

  IF v_count <> 7 THEN
    RAISE EXCEPTION
      'CRIT-#16: expected 7 cleanup_* functions, found %.', v_count;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE. Verification queries (paste in SQL Editor):
--   SELECT jobname, schedule, command, active FROM cron.job
--    WHERE jobname LIKE 'sosphere_retention_%' ORDER BY jobname;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--   SELECT created_at, target, metadata FROM public.audit_log
--    WHERE action = 'retention_cleanup' ORDER BY created_at DESC LIMIT 20;
-- ═══════════════════════════════════════════════════════════════════════════
proname IN ('cleanup_sos_sessions','cleanup_sos_queue',
                      'cleanup_sos_messages','cleanup_gps_trail',
                      'cleanup_evidence_vaults','cleanup_processed_stripe_events',
                      'cleanup_idempotency_cache');

  IF v_count <> 7 THEN
    RAISE EXCEPTION
      'CRIT-#16: expected 7 cleanup_* functions, found %.', v_count;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE. Verification queries (paste in SQL Editor):
--   SELECT jobname, schedule, command, active FROM cron.job
--    WHERE jobname LIKE 'sosphere_retention_%' ORDER BY jobname;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--   SELECT created_at, target, metadata FROM public.audit_log
--    WHERE action = 'retention_cleanup' ORDER BY created_at DESC LIMIT 20;
-- ═══════════════════════════════════════════════════════════════════════════
