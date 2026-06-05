-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 roots-of-roots Tier 3C Phase 2c — consolidate
-- emergencies ALL/public 3-stack into one policy
-- ─────────────────────────────────────────────────────────────
-- emergencies is the hot SOS table — every active emergency hits
-- it on every dashboard render. The current 3-stack for ALL:
--
--   1. emergencies_all
--        qual:  company_id IN (companies owned by auth.uid())
--        check: NULL  (so SELECT/DELETE for company owner, no INSERT/UPDATE)
--   2. emergencies_own
--        qual:  user_id = auth.uid()
--        check: NULL  (SELECT/DELETE for row owner, no INSERT/UPDATE)
--   3. emergencies_owner_write
--        qual:  user_id = auth.uid()
--        check: user_id = auth.uid()  (the one that grants INSERT/UPDATE)
--
-- Effective current behaviour (OR-merged):
--   SELECT/DELETE: user owns row OR company owner
--   INSERT/UPDATE: user owns row (only #3 supplies the with_check)
--
-- Consolidated policy preserves the EXACT same effective behaviour:
--   USING (SELECT/DELETE):   owner OR company-owner
--   WITH CHECK (INSERT/UPDATE): owner only
--
-- The separate SELECT-only policy `emergencies_owner_or_company_read`
-- (which also lets is_company_member read) is NOT touched — it
-- intentionally adds a READ-only path for non-owner company members.
-- Merging it into the ALL policy would also grant them DELETE, which
-- is a privilege escalation we are explicitly NOT making.
--
-- Atomic: all 3 DROPs + the CREATE run in one transaction.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS emergencies_all          ON public.emergencies;
DROP POLICY IF EXISTS emergencies_own          ON public.emergencies;
DROP POLICY IF EXISTS emergencies_owner_write ON public.emergencies;

CREATE POLICY emergencies_access ON public.emergencies
  FOR ALL
  TO public
  USING (
    user_id = (SELECT auth.uid())
    OR company_id IN (
      SELECT companies.id FROM companies
      WHERE companies.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
  );
