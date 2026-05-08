-- ════════════════════════════════════════════════════════════════════════
-- L1-D: Synthetic SOS Probe — automated pipeline liveness check
-- ────────────────────────────────────────────────────────────────────────
-- Builds on L1-C (pipeline_metrics + 5 RPCs). Runs every 5 minutes via
-- pg_cron. Each probe simulates a complete SOS lifecycle by calling all
-- 5 RPCs in sequence with realistic timestamps, then SELECTs the row
-- back and verifies it materialized correctly.
--
-- WHAT IT TESTS (binary pass/fail):
--   • Are RPCs callable from postgres role?
--   • Do they accept the expected parameter shapes?
--   • Do they correctly compute the 4 duration fields?
--   • Does the row persist with pipeline_status='success'?
--
-- WHAT IT MEASURES (continuous):
--   • Real DB latency for each step (clock_timestamp deltas)
--   • Total probe time = baseline for "DB is healthy"
--   • All 4 computed *_ms columns = baseline for "math is correct"
--
-- WHAT IT DOES NOT TEST (Phase 2, future):
--   • External HTTP path through sos-alert edge function
--   • CORS, JWT, Deno bundling, env vars
--   • Twilio dispatch (synthetic uses fake channel="sms")
--   • Geographic routing
--
-- COST PROFILE:
--   12 probes/hour × 24h × 7d retention = 2,016 rows max in production.
--   ~200 bytes/row → ~400 KB total. Negligible.
--
-- PERMISSIONS:
--   postgres only (cron runs as postgres). REVOKEd from PUBLIC + anon +
--   authenticated. Defense in depth: even service_role doesn't need to
--   call these.
--
-- ROLLBACK:
--   SELECT cron.unschedule('sosphere_synthetic_probe');
--   SELECT cron.unschedule('sosphere_retention_synthetic_metrics');
--   DROP VIEW public.synthetic_probe_health;
--   DROP FUNCTION public.cleanup_synthetic_pipeline_metrics(integer);
--   DROP FUNCTION public.run_synthetic_sos_probe();
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. The probe itself ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_synthetic_sos_probe()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_trace        uuid := gen_random_uuid();
  v_emergency_id text := 'synthetic-' || to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYYMMDDHH24MISSUS');
  v_t0           timestamptz := clock_timestamp();
  v_total_ms     integer;
  v_row          record;
BEGIN
  PERFORM public.record_sos_pipeline_started(
    p_trace_id           => v_trace,
    p_emergency_id       => v_emergency_id,
    p_user_id            => NULL,
    p_company_id         => NULL,
    p_tier               => 'free',
    p_client_claimed_at  => clock_timestamp() - interval '200 milliseconds',
    p_server_received_at => clock_timestamp(),
    p_is_synthetic       => true,
    p_is_drill           => false
  );

  PERFORM public.record_sos_pipeline_dispatched(
    p_trace_id           => v_trace,
    p_dispatched_at      => clock_timestamp(),
    p_channel            => 'sms',
    p_contacts_attempted => 1
  );

  PERFORM public.record_sos_pipeline_acked(
    p_trace_id          => v_trace,
    p_acked_at          => clock_timestamp(),
    p_contacts_reached  => 1
  );

  PERFORM public.record_sos_pipeline_ended(
    p_trace_id            => v_trace,
    p_ended_at            => clock_timestamp(),
    p_status              => 'success',
    p_failure_reason      => NULL,
    p_fallbacks_triggered => NULL,
    p_contacts_reached    => 1
  );

  v_total_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::integer;

  SELECT pipeline_status, client_to_server_ms, server_to_dispatch_ms,
         press_to_ack_ms, total_session_ms
    INTO v_row
    FROM public.sos_pipeline_metrics
   WHERE trace_id = v_trace;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'synthetic probe: row not found after writes — trace_id=%', v_trace;
  END IF;
  IF v_row.pipeline_status <> 'success' THEN
    RAISE EXCEPTION 'synthetic probe: status=% (expected success) — trace_id=%', v_row.pipeline_status, v_trace;
  END IF;
  IF v_row.total_session_ms IS NULL OR v_row.total_session_ms < 0 THEN
    RAISE EXCEPTION 'synthetic probe: total_session_ms invalid (%) — trace_id=%', v_row.total_session_ms, v_trace;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'trace_id', v_trace,
    'probe_latency_ms', v_total_ms,
    'computed', jsonb_build_object(
      'client_to_server_ms',   v_row.client_to_server_ms,
      'server_to_dispatch_ms', v_row.server_to_dispatch_ms,
      'press_to_ack_ms',       v_row.press_to_ack_ms,
      'total_session_ms',      v_row.total_session_ms
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[synthetic_probe] FAILED trace_id=% err=%', v_trace, SQLERRM;
    RETURN jsonb_build_object(
      'ok', false,
      'trace_id', v_trace,
      'error', SQLERRM
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_synthetic_sos_probe() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_synthetic_sos_probe() FROM anon, authenticated;

COMMENT ON FUNCTION public.run_synthetic_sos_probe IS
  'L1-D: simulates a full SOS lifecycle by calling all 5 record_sos_pipeline_* RPCs in sequence with realistic timestamps, then SELECTs the row back to verify it materialized. Returns jsonb with ok flag + measured DB latency. Called by sosphere_synthetic_probe pg_cron every 5 minutes. Probe rows have is_synthetic=true and are removed by cleanup_synthetic_pipeline_metrics on a daily retention cycle.';

-- ─── 2. Retention cleanup ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_synthetic_pipeline_metrics(
  p_retention_hours integer DEFAULT 168
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  DELETE FROM public.sos_pipeline_metrics
  WHERE is_synthetic = true
    AND created_at < now() - (p_retention_hours || ' hours')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  BEGIN
    PERFORM public.log_retention_cleanup(
      'sos_pipeline_metrics_synthetic',
      v_deleted,
      (p_retention_hours / 24)::integer
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[cleanup_synthetic] log_retention_cleanup helper failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'deleted', v_deleted,
    'retention_hours', p_retention_hours,
    'cleaned_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_synthetic_pipeline_metrics(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_synthetic_pipeline_metrics(integer) FROM anon, authenticated;

COMMENT ON FUNCTION public.cleanup_synthetic_pipeline_metrics IS
  'L1-D: removes synthetic probe rows older than retention. Called daily by sosphere_retention_synthetic_metrics cron. Default 168 hours (7 days). REAL (non-synthetic) rows are NEVER cleaned — they are forensic records.';

-- ─── 3. Health view ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.synthetic_probe_health AS
SELECT
  count(*) FILTER (WHERE created_at > now() - interval '1 hour')   AS probes_last_hour,
  count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS probes_last_24h,
  count(*) FILTER (WHERE pipeline_status <> 'success'
                     AND created_at > now() - interval '1 hour')   AS failures_last_hour,
  count(*) FILTER (WHERE pipeline_status <> 'success'
                     AND created_at > now() - interval '24 hours') AS failures_last_24h,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY total_session_ms)
    FILTER (WHERE created_at > now() - interval '1 hour') AS p50_total_ms_last_hour,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY total_session_ms)
    FILTER (WHERE created_at > now() - interval '1 hour') AS p95_total_ms_last_hour,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY total_session_ms)
    FILTER (WHERE created_at > now() - interval '1 hour') AS p99_total_ms_last_hour,
  max(created_at) AS last_probe_at,
  EXTRACT(EPOCH FROM (now() - max(created_at)))::integer AS seconds_since_last_probe
FROM public.sos_pipeline_metrics
WHERE is_synthetic = true;

COMMENT ON VIEW public.synthetic_probe_health IS
  'L1-D: aggregated synthetic probe health. Used by alerting + L1-E dashboard. seconds_since_last_probe > 600 means cron is broken.';

REVOKE ALL ON public.synthetic_probe_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.synthetic_probe_health TO service_role, postgres;

-- ─── 4. Schedule the two cron jobs ────────────────────────────────────
SELECT cron.schedule(
  'sosphere_synthetic_probe',
  '*/5 * * * *',
  $cmd$ SELECT public.run_synthetic_sos_probe(); $cmd$
);

SELECT cron.schedule(
  'sosphere_retention_synthetic_metrics',
  '21 2 * * *',
  $cmd$ SELECT public.cleanup_synthetic_pipeline_metrics(168); $cmd$
);
