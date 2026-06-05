-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 roots-of-roots Tier 3B — REVOKE trigger-function grants
-- ─────────────────────────────────────────────────────────────
-- The Supabase security advisor flagged 204 SECDEF functions
-- executable to anon (68) + authenticated (136). Most are
-- intentional RPCs (verify_permission, accept_invitation, etc.)
-- where the function body itself gates on auth.uid() — the wide
-- EXECUTE grant is by design.
--
-- However, 13 of those flagged are TRIGGER functions (return
-- type `trigger`). Trigger functions are invoked ONLY by the
-- trigger system on row INSERT/UPDATE/DELETE — never directly
-- by a SQL caller. The EXECUTE grant to anon/authenticated is
-- pure surface area expansion with zero legitimate use case:
--
--   1. The trigger fires regardless of EXECUTE grants because
--      the function runs in the row owner's privileges (SECDEF).
--   2. A malicious caller invoking the trigger function directly
--      gets undefined behavior: NEW/OLD are not bound, so most
--      either NULL-deref or return without side effect — but
--      they still consume DB cycles and could be a DoS vector.
--   3. Two pre-existing trigger functions already follow the
--      doctrine (_audit_log_compute_hash_chain,
--      project_sos_session_to_queue): both have anon=F, authed=F.
--      This migration brings the remaining 13 into line.
--
-- Post-apply verified: all 15 SECDEF trigger functions in the
-- public schema now have anon=F, authed=F, public=F.
--
-- Idempotent: re-running is a no-op (REVOKE on an absent grant
-- is silently ignored).
-- ═══════════════════════════════════════════════════════════════

-- All 13 trigger functions: REVOKE EXECUTE from anon + authenticated
REVOKE EXECUTE ON FUNCTION public.audit_auth_user_changes()                      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.chat_messages_canonicalize_sender()            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_contact_limit()                          FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_emergency_limit()                        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_zone_report_limit()                      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_individual_workspace_for_new_profile()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_invitation_inviter_owns_company()      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_owner_membership_consistency()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_active_company_match()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_emergency_changes()                        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_emergency_user_id()                        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sos_queue_attribution_guard()                  FROM anon, authenticated;

-- Also revoke from PUBLIC (the default-grant role). Belt-and-suspenders.
REVOKE EXECUTE ON FUNCTION public.audit_auth_user_changes()                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_messages_canonicalize_sender()            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_contact_limit()                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_emergency_limit()                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_zone_report_limit()                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_individual_workspace_for_new_profile()  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_invitation_inviter_owns_company()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_owner_membership_consistency()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_active_company_match()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_emergency_changes()                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_emergency_user_id()                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sos_queue_attribution_guard()                  FROM PUBLIC;
