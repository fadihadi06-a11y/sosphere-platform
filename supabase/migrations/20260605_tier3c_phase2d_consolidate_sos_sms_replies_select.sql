-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 roots-of-roots Tier 3C Phase 2d — consolidate
-- sos_sms_replies SELECT/authenticated 3-stack into one policy
-- ─────────────────────────────────────────────────────────────
-- Three completely orthogonal SELECT paths exist today:
--
--   1. sms_replies_self_read
--        Worker reads their own SMS reply (user_id = auth.uid())
--
--   2. sms_replies_company_admin_read
--        Company admin/owner reads any SMS in their company
--        (company_id IS NOT NULL AND cm.role IN admin/owner)
--
--   3. sms_replies_super_admin_unmatched_read
--        Super admin reads orphan SMS that couldn't be matched
--        to a company or user (both columns NULL) for support
--
-- Each was evaluated per row, so a super-admin viewing the orphan
-- queue evaluated 3 RLS expressions per row even though only #3
-- could possibly match.
--
-- OR-merged into one policy preserves the EXACT same access set.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS sms_replies_self_read                  ON public.sos_sms_replies;
DROP POLICY IF EXISTS sms_replies_company_admin_read         ON public.sos_sms_replies;
DROP POLICY IF EXISTS sms_replies_super_admin_unmatched_read ON public.sos_sms_replies;

CREATE POLICY sos_sms_replies_select ON public.sos_sms_replies
  FOR SELECT
  TO authenticated
  USING (
    -- worker reads their own
    user_id = (SELECT auth.uid())
    -- OR company admin/owner reads any SMS in their company
    OR (company_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM company_memberships cm
      WHERE cm.company_id = sos_sms_replies.company_id
        AND cm.user_id    = (SELECT auth.uid())
        AND cm.active     = true
        AND cm.role       = ANY (ARRAY['admin'::text, 'owner'::text])
    ))
    -- OR super_admin reads unmatched orphans (support queue)
    OR (company_id IS NULL AND user_id IS NULL AND EXISTS (
      SELECT 1 FROM company_memberships cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.active  = true
        AND cm.role    = 'super_admin'::text
    ))
  );
