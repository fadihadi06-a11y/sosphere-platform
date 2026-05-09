-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — L1-E: Pipeline Health Dashboard RPC
-- ────────────────────────────────────────────────────────────────────────
-- The FINAL piece of Layer 1 (Observability) of the life-safety
-- foundation pyramid (LIFE_SAFETY_FOUNDATION.md).
--
-- Stack so far:
--   L1-A  trace_id propagation                     (20260508130000)
--   L1-A  log_sos_audit accepts trace_id           (20260508140000)
--   L1-B  client + server timestamps               (already in trigger)
--   L1-C  sos_pipeline_metrics table               (20260508150000)
--   L1-C  5 SECURITY DEFINER pipeline RPCs         (20260508160000)
--   L1-C  REVOKE anon/PUBLIC on write RPCs         (20260508170000)
--   L1-D  synthetic SOS probe (cron every 5 min)   (20260508180000)
--   L1-E  this file — operator-facing aggregate    (20260508190000)
--
-- WHY THIS RPC:
--   The dashboard needs a SINGLE round-trip that returns:
--     1. Synthetic probe health (last 24h windowed)
--     2. Real SOS traffic 24h totals (success / failure / p95 latency)
--     3. The 10 most-recent failures (forensic — partial/failed/cancelled)
--
--   We do this server-side rather than from the client because:
--     • One round-trip vs three keeps p99 dashboard load ~50ms instead
--       of ~150ms over a slow LTE connection.
--     • The CHECK on company_memberships.role for admin/owner is the
--       authoritative gate — we don't want the client juggling multiple
--       JWT claims to gate three different views.
--     • percentile_cont aggregations are cheap on the DB but expensive
--       to ship to the client just to throw most of the rows away.
--
-- AUTH MODEL (defense in depth):
--   • SECURITY DEFINER + locked search_path (FOUNDATION-22 invariant).
--   • Internal IF auth.uid() IS NULL THEN raise — blocks anon even if
--     someone accidentally GRANTs EXECUTE to anon in the future.
--   • Internal IF NOT EXISTS (active admin/owner membership) — blocks
--     regular workers from seeing org-wide telemetry, even if the
--     `authenticated` role technically has EXECUTE.
--   • REVOKE PUBLIC + REVOKE anon — explicit, double-locked.
--
-- WHAT THE PAYLOAD LOOKS LIKE:
--   {
--     "synthetic": {
--       "probes_last_24h": 288, "successes": 288, "failures": 0,
--       "p50_total_ms": 239, "p95_total_ms": 260, "p99_total_ms": 264,
--       "last_probe_at": "2026-05-09T15:25:12Z",
--       "last_success_at": "2026-05-09T15:25:12Z"
--     },
--     "real_24h": {
--       "total": 12, "success": 11, "failures": 1, "p95_total_ms": 4321
--     },
--     "recent_failures": [{ "trace_id": "...", "pipeline_status": "partial",
--                            "failure_reason": "twilio 502", "created_at": "...",
--                            "is_synthetic": false }, ...],
--     "fetched_at": "2026-05-09T15:30:00Z"
--   }
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_pipeline_health_summary();
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_pipeline_health_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
STABLE
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_is_admin boolean := false;
  v_synthetic     record;
  v_real_24h      record;
  v_recent_failures jsonb;
BEGIN
  -- Gate 1: must be authenticated.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized: must be logged in';
  END IF;

  -- Gate 2: must be an active admin/owner of at least one company.
  --   We don't scope by company_id here because the synthetic probe
  --   data is global infrastructure telemetry and the real_24h totals
  --   are aggregated across the whole platform — both are operator
  --   surfaces, not tenant surfaces. Per-tenant slice will be a
  --   follow-up RPC if/when we expose this in a customer-facing place.
  SELECT EXISTS (
    SELECT 1 FROM public.company_memberships
    WHERE user_id = v_caller
      AND active = true
      AND role IN ('admin','owner')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'unauthorized: caller is not an active admin/owner of any company';
  END IF;

  -- ── Block 1: synthetic probe health (view defined in L1-D) ──
  SELECT * INTO v_synthetic FROM public.synthetic_probe_health;

  -- ── Block 2: real (non-synthetic) traffic in the last 24h ──
  SELECT
    count(*) FILTER (WHERE is_synthetic = false)                                AS total,
    count(*) FILTER (WHERE is_synthetic = false AND pipeline_status = 'success') AS success,
    count(*) FILTER (WHERE is_synthetic = false
                      AND pipeline_status IN ('partial','failed'))              AS failures,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY total_session_ms)
      FILTER (WHERE is_synthetic = false)                                       AS p95_total_ms
  INTO v_real_24h
  FROM public.sos_pipeline_metrics
  WHERE created_at > now() - interval '24 hours';

  -- ── Block 3: 10 most-recent failures (forensic / triage) ──
  SELECT jsonb_agg(row_to_json(t.*))
  INTO v_recent_failures
  FROM (
    SELECT trace_id, pipeline_status, failure_reason, created_at, is_synthetic
    FROM public.sos_pipeline_metrics
    WHERE pipeline_status IN ('partial','failed','cancelled')
      AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC
    LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'synthetic',       to_jsonb(v_synthetic),
    'real_24h',        to_jsonb(v_real_24h),
    'recent_failures', COALESCE(v_recent_failures, '[]'::jsonb),
    'fetched_at',      now()
  );
END;
$$;

COMMENT ON FUNCTION public.get_pipeline_health_summary() IS
  'L1-E pipeline health dashboard aggregate. Returns synthetic probe health (24h), real SOS traffic 24h totals, and 10 most recent failures. Admin/owner only via internal membership check + locked search_path. Single round-trip for the operator dashboard.';

-- Defense in depth — explicit double-revoke even though SECURITY DEFINER
-- gates the dangerous bits. Matches the pattern from
-- 20260508170000_l1c_security_revoke_anon_from_write_rpcs.sql.
REVOKE EXECUTE ON FUNCTION public.get_pipeline_health_summary() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pipeline_health_summary() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_pipeline_health_summary() TO authenticated;
