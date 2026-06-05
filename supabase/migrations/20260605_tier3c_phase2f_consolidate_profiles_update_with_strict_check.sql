-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 roots-of-roots Tier 3C Phase 2f — consolidate
-- profiles UPDATE/authenticated 4-stack and RESTORE the strict
-- privilege-escalation guard from profiles_update_safe
-- ─────────────────────────────────────────────────────────────
-- The 4 current UPDATE/authenticated policies:
--
--   1. profiles_self_update         qual+check: (id=uid OR user_id=uid)
--   2. profiles_update_own          qual+check: (id=uid)
--   3. profiles_update_own_or_admin qual+check: (id=uid OR is_admin())
--   4. profiles_update_safe         qual: (id=uid),
--                                   check: (id=uid AND role==old_role
--                                           AND company_id==old_company_id
--                                           AND user_type==old_user_type)
--
-- THE BUG: Postgres OR-combines WITH CHECK across stacked
-- permissive policies. profiles_update_safe's strict
-- privilege-escalation guard was MEANINGLESS as long as
-- profiles_update_own (with loose check `id=uid`) was also
-- present — a user could call `update profiles set role='admin'`
-- and the loose policy would pass it. Quiet vertical privilege
-- escalation surface.
--
-- THE FIX: collapse to ONE permissive policy that:
--   • USING: same effective row-visibility as the union (self or admin)
--   • WITH CHECK: enforces the strict guard from profiles_update_safe
--     for non-admins. Admins still have full mutation rights so
--     legitimate role/company/user_type changes via the dashboard
--     UI keep working.
--
-- Audit confirms no app code currently updates role/company_id/
-- user_type via direct `from('profiles').update(...)`:
--   • profile-settings.tsx:130  → update({ phone })
--   • data-layer.ts:258         → update({ full_name })
--   • onboarding-server.ts:41   → update({ onboarding_completed })
-- All sensitive role/membership mutations go through SECDEF RPCs
-- (add_company_member, switch_active_company, etc.) which bypass
-- RLS entirely. Strengthening the guard is therefore a pure
-- security tightening with zero behavioural regression for
-- legitimate clients.
--
-- ATOMIC: all DROP + CREATE in one transaction.
-- Verified post-apply: 0 remaining permissive policy stacks across
-- the entire public schema. Tier 3C complete.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS profiles_self_update         ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own          ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own_or_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_update_safe         ON public.profiles;

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Same effective row-visibility as the OR-union of the 4 old policies
    id      = (SELECT auth.uid())
    OR user_id = (SELECT auth.uid())
    OR is_admin()
  )
  WITH CHECK (
    -- (a) must remain self or admin (matches USING)
    (
      id      = (SELECT auth.uid())
      OR user_id = (SELECT auth.uid())
      OR is_admin()
    )
    AND
    -- (b) admins may change anything; non-admins MUST NOT change
    --     role, company_id, or user_type (privilege-escalation guard
    --     restored from profiles_update_safe's intent)
    (
      is_admin()
      OR (
        role      = (SELECT p2.role      FROM profiles p2 WHERE p2.id = (SELECT auth.uid()))
        AND NOT (company_id IS DISTINCT FROM
                  (SELECT p2.company_id FROM profiles p2 WHERE p2.id = (SELECT auth.uid())))
        AND user_type = (SELECT p2.user_type FROM profiles p2 WHERE p2.id = (SELECT auth.uid()))
      )
    )
  );
