-- ═══════════════════════════════════════════════════════════════════════════
-- G-32 (B-20, 2026-04-26): pin search_path on all SECURITY DEFINER functions.
-- See AUDIT_DEEP_2026-04-25.md G-32 for the audit note.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.accept_company_invite(text)                              SET search_path = public, pg_temp;
ALTER FUNCTION public.add_company_member(uuid, text, text)                     SET search_path = public, pg_temp;
ALTER FUNCTION public.add_owner_to_company(uuid)                               SET search_path = public, pg_temp;
ALTER FUNCTION public.archive_old_emergencies()                                SET search_path = public, pg_temp;
ALTER FUNCTION public.check_contact_limit()                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.check_emergency_limit()                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.check_zone_report_limit()                                SET search_path = public, pg_temp;
ALTER FUNCTION public.cleanup_old_locations()                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_sos_timer(uuid)                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.create_company(text)                                     SET search_path = public, pg_temp;
ALTER FUNCTION public.create_company_invite(uuid, text, text)                  SET search_path = public, pg_temp;
ALTER FUNCTION public.create_individual_workspace_for_new_profile()            SET search_path = public, pg_temp;
ALTER FUNCTION public.create_profile_for_user(uuid, text)                      SET search_path = public, pg_temp;
ALTER FUNCTION public.create_sos_timer(integer)                                SET search_path = public, pg_temp;
ALTER FUNCTION public.enqueue_family_notifications(uuid)                       SET search_path = public, pg_temp;
ALTER FUNCTION public.is_company_admin_or_owner_v2(uuid)                       SET search_path = public, pg_temp;
ALTER FUNCTION public.log_emergency_changes()                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.set_active_company(uuid)                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.set_emergency_user_id()                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.set_user_company(uuid, text)                             SET search_path = public, pg_temp;
ALTER FUNCTION public.set_user_family(uuid, text)                              SET search_path = public, pg_temp;
ALTER FUNCTION public.start_family_sos_session(text)                           SET search_path = public, pg_temp;
ALTER FUNCTION public.start_sos(text)                                          SET search_path = public, pg_temp;
ALTER FUNCTION public.upsert_duty_status(uuid, text)                           SET search_path = public, pg_temp;
