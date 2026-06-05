-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 roots-of-roots Tier 3C Phase 2e — consolidate the
-- remaining 11 simple 2-stack policies in one batched migration
-- ─────────────────────────────────────────────────────────────
-- Each block below is a self-contained drop+create for one (table,
-- role, cmd) stack. Same pattern across all of them: a self-access
-- policy AND a company/admin-scope policy, OR-merged into one.
-- All with_check=null variants stay null (preserves the existing
-- SELECT-only / DELETE-only contract); the one (gps_trail) where
-- a real with_check exists merges it correctly.
--
-- 13 stacks closed (12 consolidations + 1 dead-policy drop):
--   1. company_employees      SELECT/authenticated
--   2. company_memberships    SELECT/authenticated
--   3. discreet_sessions      SELECT/public
--   4. employees              SELECT/authenticated
--   5. employees              ALL/public
--   6. geofence_events        SELECT/public
--   7. gps_trail              ALL/authenticated
--   8. missions               ALL/public
--   9. push_tokens            ALL/public (exact dupe in two names)
--  10. sos_dispatch_attempts  SELECT/authenticated
--  11. sos_pipeline_metrics   SELECT/authenticated
--  12. sos_sessions           SELECT/authenticated
--  13. profiles UPDATE/public 2-stack ("Users can update own profile"
--      is dead for UPDATE because check is NULL — drop it)
--
-- profiles UPDATE/authenticated 4-stack DEFERRED — profiles_update_safe
-- has a strict with_check (prevents role/company_id/user_type
-- escalation). OR-merging would weaken it. Needs a separate
-- focused migration.
--
-- Atomic: a failure in any block rolls the entire migration back.
-- Verified post-apply: remaining stacks = 1 (only the deferred
-- profiles UPDATE).
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. company_employees SELECT/authenticated ─────────────────
DROP POLICY IF EXISTS company_employees_member_read ON public.company_employees;
DROP POLICY IF EXISTS users_read_own_membership      ON public.company_employees;
CREATE POLICY company_employees_select ON public.company_employees
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR is_company_member(company_id)
  );

-- ─── 2. company_memberships SELECT/authenticated ───────────────
DROP POLICY IF EXISTS memberships_company_read ON public.company_memberships;
DROP POLICY IF EXISTS memberships_self_read     ON public.company_memberships;
CREATE POLICY company_memberships_select ON public.company_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR is_company_member(company_id)
  );

-- ─── 3. discreet_sessions SELECT/public ────────────────────────
DROP POLICY IF EXISTS discreet_sessions_admin_read ON public.discreet_sessions;
DROP POLICY IF EXISTS discreet_sessions_self_read  ON public.discreet_sessions;
CREATE POLICY discreet_sessions_select ON public.discreet_sessions
  FOR SELECT TO public
  USING (
    employee_id = (SELECT auth.uid())
    OR company_id IN (
      SELECT c.id FROM companies c WHERE c.owner_id = (SELECT auth.uid())
    )
    OR company_id IN (
      SELECT m.company_id FROM company_memberships m
      WHERE m.user_id = (SELECT auth.uid())
        AND m.active = true
        AND m.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

-- ─── 4. employees SELECT/authenticated ─────────────────────────
DROP POLICY IF EXISTS employees_company_read ON public.employees;
DROP POLICY IF EXISTS employees_self_read     ON public.employees;
CREATE POLICY employees_select ON public.employees
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR is_company_member(company_id)
  );

-- ─── 5. employees ALL/public ───────────────────────────────────
DROP POLICY IF EXISTS employees_all          ON public.employees;
DROP POLICY IF EXISTS employees_own_company ON public.employees;
CREATE POLICY employees_access ON public.employees
  FOR ALL TO public
  USING (
    user_id = (SELECT auth.uid())
    OR company_id IN (
      SELECT companies.id FROM companies
      WHERE companies.owner_id = (SELECT auth.uid())
    )
    OR company_id = (((SELECT auth.jwt()) ->> 'company_id'::text))::uuid
  );

-- ─── 6. geofence_events SELECT/public ──────────────────────────
DROP POLICY IF EXISTS geofence_events_admin_read ON public.geofence_events;
DROP POLICY IF EXISTS geofence_events_self_read  ON public.geofence_events;
CREATE POLICY geofence_events_select ON public.geofence_events
  FOR SELECT TO public
  USING (
    user_id = (SELECT auth.uid())
    OR company_id IN (
      SELECT c.id FROM companies c WHERE c.owner_id = (SELECT auth.uid())
    )
    OR company_id IN (
      SELECT m.company_id FROM company_memberships m
      WHERE m.user_id = (SELECT auth.uid())
        AND m.active = true
        AND m.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

-- ─── 7. gps_trail ALL/authenticated ────────────────────────────
-- gps_trail_self provides the real with_check; gps_own_user was check=null.
DROP POLICY IF EXISTS gps_own_user   ON public.gps_trail;
DROP POLICY IF EXISTS gps_trail_self ON public.gps_trail;
CREATE POLICY gps_trail_access ON public.gps_trail
  FOR ALL TO authenticated
  USING (
    employee_id = (SELECT auth.uid())
    OR (company_id IS NULL AND employee_id IS NULL)
    OR company_id = (((SELECT auth.jwt()) ->> 'company_id'::text))::uuid
  )
  WITH CHECK (
    employee_id = (SELECT auth.uid())
    OR (company_id IS NULL AND employee_id IS NULL)
  );

-- ─── 8. missions ALL/public ────────────────────────────────────
DROP POLICY IF EXISTS missions_all          ON public.missions;
DROP POLICY IF EXISTS missions_own_company ON public.missions;
CREATE POLICY missions_access ON public.missions
  FOR ALL TO public
  USING (
    company_id IN (
      SELECT companies.id FROM companies
      WHERE companies.owner_id = (SELECT auth.uid())
    )
    OR company_id = (((SELECT auth.jwt()) ->> 'company_id'::text))::uuid
  );

-- ─── 9. push_tokens ALL/public (identical qual, different names) ─
DROP POLICY IF EXISTS "Users manage own tokens" ON public.push_tokens;
DROP POLICY IF EXISTS push_tokens_own_user      ON public.push_tokens;
CREATE POLICY push_tokens_access ON public.push_tokens
  FOR ALL TO public
  USING (
    user_id = (SELECT auth.uid())
  );

-- ─── 10. sos_dispatch_attempts SELECT/authenticated ────────────
DROP POLICY IF EXISTS dispatch_attempts_company_admin_read ON public.sos_dispatch_attempts;
DROP POLICY IF EXISTS dispatch_attempts_self_read           ON public.sos_dispatch_attempts;
CREATE POLICY sos_dispatch_attempts_select ON public.sos_dispatch_attempts
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (company_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM company_memberships cm
      WHERE cm.company_id = sos_dispatch_attempts.company_id
        AND cm.user_id    = (SELECT auth.uid())
        AND cm.active     = true
        AND cm.role       = ANY (ARRAY['admin'::text, 'owner'::text])
    ))
  );

-- ─── 11. sos_pipeline_metrics SELECT/authenticated ─────────────
DROP POLICY IF EXISTS pipeline_metrics_company_admin_read ON public.sos_pipeline_metrics;
DROP POLICY IF EXISTS pipeline_metrics_self_read           ON public.sos_pipeline_metrics;
CREATE POLICY sos_pipeline_metrics_select ON public.sos_pipeline_metrics
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (company_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM company_memberships cm
      WHERE cm.company_id = sos_pipeline_metrics.company_id
        AND cm.user_id    = (SELECT auth.uid())
        AND cm.active     = true
        AND cm.role       = ANY (ARRAY['admin'::text, 'owner'::text])
    ))
  );

-- ─── 12. sos_sessions SELECT/authenticated ─────────────────────
DROP POLICY IF EXISTS sos_sessions_company_read ON public.sos_sessions;
DROP POLICY IF EXISTS sos_sessions_self_read     ON public.sos_sessions;
CREATE POLICY sos_sessions_select ON public.sos_sessions
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (company_id IS NOT NULL AND is_company_member(company_id))
  );

-- ─── 13. profiles UPDATE/public (drop the dead policy) ─────────
-- "Users can update own profile" has check=null so it can't permit
-- UPDATE (WITH CHECK is required for UPDATE). The other policy
-- "update own profile" has both qual and check identical to it.
-- Dead policy — drop.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
