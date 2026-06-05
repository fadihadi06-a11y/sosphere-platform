-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 roots-of-roots Tier 3C Phase 2a — consolidate profiles
-- SELECT/authenticated 4-stack into one policy
-- ─────────────────────────────────────────────────────────────
-- profiles is the worst stacking offender — after Phase 1 dropped
-- 5 exact duplicates, the SELECT/authenticated set still has 4
-- semantically-distinct PERMISSIVE policies. Each is evaluated
-- per-row read, which on a 50k-profile company means 200k
-- evaluations per dashboard list page.
--
-- The 4 current policies:
--   1. profiles_company_read         (company_id IS NOT NULL AND is_company_member(company_id))
--   2. profiles_read_own              id = auth.uid()
--   3. profiles_select_own_or_admin  (id = auth.uid() OR is_admin())
--   4. profiles_self_read            (id = auth.uid() OR user_id = auth.uid())
--
-- Postgres OR-combines stacked permissive policies → the effective
-- predicate is the OR of all four. Collapsing into one policy
-- preserves the exact same effective predicate while letting the
-- planner evaluate it ONCE per row.
--
-- The consolidated predicate:
--   id = auth.uid()                              -- self via id (covers #2, #3, #4)
--   OR user_id = auth.uid()                      -- self via user_id (#4)
--   OR (company_id IS NOT NULL AND is_company_member(company_id))  -- company peer (#1)
--   OR is_admin()                                -- admin override (#3)
--
-- Both helper functions verified to exist:
--   public.is_admin() RETURNS boolean
--   public.is_company_member(p_company_id uuid) RETURNS boolean
--
-- All four DROP + the CREATE happen in one implicit transaction.
-- If the CREATE fails, the entire migration rolls back and the
-- old 4 policies remain.
--
-- Verified post-apply: profiles SELECT/authenticated returns
-- exactly one policy (profiles_select) with the OR-combined qual.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS profiles_company_read       ON public.profiles;
DROP POLICY IF EXISTS profiles_read_own           ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_self_read          ON public.profiles;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id      = (SELECT auth.uid())
    OR user_id = (SELECT auth.uid())
    OR (company_id IS NOT NULL AND is_company_member(company_id))
    OR is_admin()
  );
