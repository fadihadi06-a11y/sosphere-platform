-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 roots-of-roots Tier 3C Phase 2b — consolidate
-- duty_status SELECT/UPDATE authenticated stacks
-- ─────────────────────────────────────────────────────────────
-- duty_status has 2 separate 3-stacks for authenticated role:
--
-- SELECT/authenticated 3-stack:
--   1. admin_can_view_company_duty_status — admin in same company
--   2. duty_status_select_own             — user_id = auth.uid()
--   3. members_can_read_duty_status       — is_workspace_member(workspace_id)
--
-- UPDATE/authenticated 3-stack:
--   1. admin_can_update_company_duty_status — admin override
--   2. duty_status_update_own               — user_id = auth.uid()
--   3. user_can_update_own_duty_status      — user_id + workspace member
--
-- For both stacks, the effective predicate is OR of all members.
-- Collapse each into one policy to cut per-row evaluation by 3×.
--
-- Untouched: duty_status_own (cmd=ALL, role=public) handles SELECT
-- and DELETE for the public role umbrella. Its with_check is NULL
-- so it doesn't grant INSERT/UPDATE — those rely on the cmd-specific
-- policies. Touching it would change DELETE semantics, deferred.
--
-- Atomic: all DROPs + the CREATEs run in one transaction; failure
-- rolls back to the original 6 policies.
-- ═══════════════════════════════════════════════════════════════

-- ─── SELECT consolidation ──────────────────────────────────────
DROP POLICY IF EXISTS admin_can_view_company_duty_status ON public.duty_status;
DROP POLICY IF EXISTS duty_status_select_own              ON public.duty_status;
DROP POLICY IF EXISTS members_can_read_duty_status        ON public.duty_status;

CREATE POLICY duty_status_select ON public.duty_status
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR is_workspace_member(workspace_id)
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'admin'
        AND p.company_id = (
          SELECT profiles.company_id FROM profiles
          WHERE profiles.id = duty_status.user_id
        )
    )
  );

-- ─── UPDATE consolidation ──────────────────────────────────────
-- All three originals have qual == with_check, so the consolidated
-- policy gets the same predicate for both clauses. No privilege
-- escalation surface introduced — every clause is the OR of the
-- exact same expressions the originals used.
DROP POLICY IF EXISTS admin_can_update_company_duty_status ON public.duty_status;
DROP POLICY IF EXISTS duty_status_update_own                ON public.duty_status;
DROP POLICY IF EXISTS user_can_update_own_duty_status       ON public.duty_status;

CREATE POLICY duty_status_update ON public.duty_status
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (user_id = (SELECT auth.uid()) AND is_workspace_member(workspace_id))
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'admin'
        AND p.company_id = (
          SELECT profiles.company_id FROM profiles
          WHERE profiles.id = duty_status.user_id
        )
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR (user_id = (SELECT auth.uid()) AND is_workspace_member(workspace_id))
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'admin'
        AND p.company_id = (
          SELECT profiles.company_id FROM profiles
          WHERE profiles.id = duty_status.user_id
        )
    )
  );
