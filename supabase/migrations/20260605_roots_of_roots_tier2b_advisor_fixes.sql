-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 roots-of-roots Tier 2B — Supabase advisor WARN fixes
-- ─────────────────────────────────────────────────────────────
-- Closes 6 of 7 WARN findings flagged by get_advisors (security +
-- performance) that are safe to fix in a single transaction:
--
--   1. Drop 2 duplicate indexes (perf: duplicate_index x2)
--      • company_settings.idx_settings_company shadows the PK
--      • sensor_events.idx_sensor_events_detected duplicates
--        idx_sensor_events_detected_at on the same column
--
--   2. Pin search_path on 4 SECDEF functions (security:
--      function_search_path_mutable x4). All four had proconfig
--      NULL — an attacker with INSERT/UPDATE on referenced tables
--      could theoretically shadow public schema objects via
--      search_path manipulation. Pinning to `public, pg_temp`
--      makes the resolution stable.
--
-- DEFERRED (7th finding, extension_in_public for pg_net):
-- pg_net does not support `ALTER EXTENSION ... SET SCHEMA` — the
-- extension self-pins to the install schema. Moving it requires
-- DROP + CREATE in `extensions` schema with an outage window to
-- avoid losing the in-flight HTTP request queue. Tracked as a
-- follow-up; documented here so we don't lose it.
--
-- All operations are idempotent — re-running is a no-op.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Drop duplicate indexes ─────────────────────────────────
DROP INDEX IF EXISTS public.idx_settings_company;
DROP INDEX IF EXISTS public.idx_sensor_events_detected;

-- ─── 2. Pin search_path on 4 SECDEF functions ──────────────────
ALTER FUNCTION public._probe_session_cache_touch() SET search_path = public, pg_temp;
ALTER FUNCTION public._sos_pipeline_metrics_touch() SET search_path = public, pg_temp;
ALTER FUNCTION public.block_sensitive_profile_changes() SET search_path = public, pg_temp;
ALTER FUNCTION public.current_dpa_version() SET search_path = public, pg_temp;
