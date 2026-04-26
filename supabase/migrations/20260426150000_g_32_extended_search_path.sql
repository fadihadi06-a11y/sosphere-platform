-- ═══════════════════════════════════════════════════════════════════════════
-- G-32 extended (B-20, 2026-04-26): pin search_path on the remaining 14
-- non-SECDEF functions + the (uuid, text) overload of start_sos.
-- Plus: tighten the duty_status admin update WITH CHECK predicate so it
-- matches USING (was `true`, allowing cross-company target switch).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.audit_log_normalize_actor()        SET search_path = public, pg_temp;
ALTER FUNCTION public.block_sensitive_profile_changes()  SET search_path = public, pg_temp;
ALTER FUNCTION public.calc_response_time()               SET search_path = public, pg_temp;
ALTER FUNCTION public.compute_age(date)                  SET search_path = public, pg_temp;
ALTER FUNCTION public.debug_set_uid(uuid)                SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin()                         SET search_path = public, pg_temp;
ALTER FUNCTION public.is_company_admin(uuid)             SET search_path = public, pg_temp;
ALTER FUNCTION public.is_workspace_member(uuid)          SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_emergency()                 SET search_path = public, pg_temp;
ALTER FUNCTION public.protect_profile_fields()           SET search_path = public, pg_temp;
ALTER FUNCTION public.resolve_sos_context(uuid)          SET search_path = public, pg_temp;
ALTER FUNCTION public.set_company_owner()                SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()                   SET search_path = public, pg_temp;
ALTER FUNCTION public.update_modified_column()           SET search_path = public, pg_temp;
ALTER FUNCTION public.start_sos(uuid, text)              SET search_path = public, pg_temp;

-- Tighten duty_status admin update WITH CHECK
DO $$
DECLARE v_using_expr text;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO v_using_expr
    FROM pg_policy
   WHERE polname = 'admin_can_update_company_duty_status'
     AND polrelid = 'public.duty_status'::regclass;
  IF v_using_expr IS NULL THEN RETURN; END IF;
  EXECUTE 'DROP POLICY IF EXISTS admin_can_update_company_duty_status ON public.duty_status';
  EXECUTE format($f$
    CREATE POLICY admin_can_update_company_duty_status
      ON public.duty_status
      FOR UPDATE TO authenticated
      USING      (%s)
      WITH CHECK (%s)
  $f$, v_using_expr, v_using_expr);
END $$;
