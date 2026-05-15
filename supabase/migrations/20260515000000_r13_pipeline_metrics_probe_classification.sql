-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — R-13: pipeline_metrics probe classification + user_id backfill
-- ─────────────────────────────────────────────────────────────────────────
-- THE FINDING (performance audit, security sweep #2 follow-up)
--   sos_pipeline_metrics had 15 rows with is_synthetic=false that were
--   actually driven by R-4 sos-dispatch-probe runs. They had:
--     - user_id = NULL          (probe never propagated authUserId)
--     - is_synthetic = false    (probe never set the flag)
--     - channel_used = 'none'   (probe uses invalid phone "+10")
--   The dashboard interpreted these as "15 real emergencies, all failed"
--   when in fact NO real emergency had ever been triggered (app pre-launch).
--   Misleading for ops + would have falsely tripped alerting on first read.
--
-- THE FIX (paired with sos-alert R-13 code change, deployed separately)
--   sos-alert/index.ts now:
--     - authenticate() returns email alongside userId
--     - Computes isSyntheticCaller = email.endsWith('@sosphere.internal')
--       (a reserved domain; no real user can register there)
--     - Passes p_user_id + p_is_synthetic to record_sos_pipeline_started
--
-- THIS MIGRATION
--   Documents + replays the one-time data backfill that re-classifies
--   the 15 pre-R-13 probe rows. The SQL is idempotent — already-correct
--   rows are unaffected. The migration is safe to re-apply.
-- ═══════════════════════════════════════════════════════════════════════════

WITH probe_uids AS (
  SELECT id FROM auth.users WHERE email LIKE '%@sosphere.internal'
)
UPDATE public.sos_pipeline_metrics m
SET is_synthetic = true
WHERE m.is_synthetic = false
  AND (m.user_id IS NULL OR m.user_id IN (SELECT id FROM probe_uids));

COMMENT ON COLUMN public.sos_pipeline_metrics.is_synthetic IS
  'R-13 (2026-05-15): TRUE for rows produced by internal probes (R-4 sos-dispatch-probe + R-5 forgery-probe). sos-alert detects probes by checking if the authenticated user email ends with @sosphere.internal — a reserved internal domain. Dashboards should filter is_synthetic=true rows out of "real emergency" KPIs.';
