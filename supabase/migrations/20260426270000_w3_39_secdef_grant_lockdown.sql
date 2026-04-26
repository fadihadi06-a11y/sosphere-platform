-- ═══════════════════════════════════════════════════════════════════════════
-- W3-39 (Wave 3 red-team, 2026-04-26): SECDEF function EXECUTE-grant lockdown.
--
-- BUG: 4 SECURITY DEFINER functions were granted EXECUTE to PUBLIC / anon /
-- authenticated. Combined with their lack of in-body auth.uid() checks,
-- ANY anonymous caller could:
--   • delete_user_completely(p_user_id) — delete arbitrary user account
--   • log_sos_audit(...) — forge arbitrary audit_log rows
--   • create_profile_for_user(...) — claim arbitrary user_ids
--   • check_company_twilio_budget(...) — leak cross-tenant budget state
--
-- These all SHOULD be service-role only (called from edge functions or
-- auth triggers). G-8 / G-11 missed them.
--
-- FIX: REVOKE ALL from PUBLIC / anon / authenticated. service_role
-- retains EXECUTE.
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.delete_user_completely(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_sos_audit(text, text, text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_profile_for_user(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_company_twilio_budget(uuid)   FROM PUBLIC, anon, authenticated;

-- service_role retains access (Supabase grants it implicitly via SECDEF; we re-grant
-- explicitly so future Postgres versions or pg_dump round-trips don't drop it).
GRANT EXECUTE ON FUNCTION public.delete_user_completely(uuid)        TO service_role;
GRANT EXECUTE ON FUNCTION public.log_sos_audit(text, text, text, text, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_profile_for_user(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_company_twilio_budget(uuid)   TO service_role;
