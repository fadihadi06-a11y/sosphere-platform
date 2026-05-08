-- ════════════════════════════════════════════════════════════════════════
-- SECURITY: REVOKE PUBLIC + anon EXECUTE from L1-C + audit RPCs
-- ────────────────────────────────────────────────────────────────────────
-- Discovered during L1-C smoke testing 2026-05-08:
--   Postgres' default behavior on CREATE FUNCTION grants EXECUTE to
--   PUBLIC. Supabase additionally auto-grants to anon + authenticated
--   for functions in the public schema. Our prior CREATE FUNCTION
--   migrations only added explicit GRANTs without REVOKEing the
--   defaults. Result: anon could call write-path RPCs and pollute
--   audit_log + sos_pipeline_metrics.
--
-- AFFECTED FUNCTIONS (this migration scope):
--   • log_sos_audit          — pre-existing leak since AUTH-5 P1
--                              (anon could fabricate audit rows!)
--   • record_sos_pipeline_*  — 5 new RPCs from L1-C
--                              (anon could fabricate metrics)
--
-- INTENT MATRIX (post-fix):
--   log_sos_audit          → service_role + authenticated
--                            (auth callers still need it for
--                             client-initiated audit events)
--   record_sos_pipeline_*  → service_role ONLY
--                            (internal write path, edge functions
--                             emit via service-role client only)
--
-- BROADER FINDING (out of scope, separate audit):
--   The same query pattern revealed 18 OTHER SECURITY DEFINER
--   functions exposed to anon (set_user_company,
--   cancel_company_trial, etc.). Each needs case-by-case review —
--   tracked in a separate "SECURITY-AUDIT" task. Defense-in-depth:
--   even where the function body has auth.uid() checks, the grant
--   should match the threat model.
--
-- ROLLBACK:
--   GRANT EXECUTE ON FUNCTION public.<name>(...) TO anon, PUBLIC;
--   (don't do this — it re-opens the hole)
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. log_sos_audit ──────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.log_sos_audit(text, text, text, text, text, text, jsonb, uuid, uuid)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_sos_audit(text, text, text, text, text, text, jsonb, uuid, uuid)
  FROM anon;
-- KEEP: authenticated + service_role (intentional)

-- ─── 2. Pipeline metric write RPCs (5 functions) — service_role only ───
REVOKE EXECUTE ON FUNCTION public.record_sos_pipeline_started(uuid, text, uuid, uuid, text, timestamptz, timestamptz, boolean, boolean)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_sos_pipeline_started(uuid, text, uuid, uuid, text, timestamptz, timestamptz, boolean, boolean)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.record_sos_pipeline_dispatched(uuid, timestamptz, text, integer)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_sos_pipeline_dispatched(uuid, timestamptz, text, integer)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.record_sos_pipeline_acked(uuid, timestamptz, integer)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_sos_pipeline_acked(uuid, timestamptz, integer)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.record_sos_pipeline_escalated(uuid, integer)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_sos_pipeline_escalated(uuid, integer)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.record_sos_pipeline_ended(uuid, timestamptz, text, text, text[], integer)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_sos_pipeline_ended(uuid, timestamptz, text, text, text[], integer)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.log_sos_audit IS
  '2026-05-08 (L1-A + Security): preserves D-15 freshness logic + p_company_id auto-resolution that were live in production but never committed to git (L0.5 drift); adds p_trace_id (uuid) for end-to-end correlation; PUBLIC + anon EXECUTE REVOKED so anon callers cannot fabricate audit rows. Backward-compatible with authenticated callers — older client code still works.';
