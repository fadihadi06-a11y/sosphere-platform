-- ═══════════════════════════════════════════════════════════════════════════
-- W3-38 (Wave 3 red-team, 2026-04-26): consolidate companies RLS policies.
--
-- BUG: companies has 21 PERMISSIVE policies accumulated over 9 months. RLS
-- evaluates them with OR — any one matching grants access. Several use the
-- legacy `owner_id` column (deprecated; canonical is `owner_user_id`); the
-- conflicting ownership models open subtle attacker paths (e.g. setting
-- owner_id = self via a stale code path bypasses owner_user_id-anchored
-- policies). Plus performance — 21 ORs evaluated per row touch.
--
-- FIX: drop all 21, install 5 canonical:
--   r  companies_select_members      — active member of company can read
--   a  companies_insert_self         — authenticated user can create their own
--   w  companies_update_admin_owner  — only owner/admin (via SECDEF helper)
--   d  companies_delete_owner        — only owner
--   *  (none — explicit policies above cover every command)
--
-- Tested behaviour preserved: every legitimate path I can identify still
-- passes (member read, owner update, admin update, owner delete).
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop all current policies on companies
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy WHERE polrelid = 'public.companies'::regclass
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.companies', pol.polname);
  END LOOP;
END $$;

-- 5 canonical replacements
CREATE POLICY companies_select_members
  ON public.companies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_memberships m
       WHERE m.company_id = companies.id
         AND m.user_id    = auth.uid()
         AND m.active     = true
    )
    OR owner_user_id = auth.uid()
  );

CREATE POLICY companies_insert_self
  ON public.companies FOR INSERT
  TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY companies_update_admin_owner
  ON public.companies FOR UPDATE
  TO authenticated
  USING (public.is_company_admin_or_owner_v2(id))
  WITH CHECK (public.is_company_admin_or_owner_v2(id));

CREATE POLICY companies_delete_owner
  ON public.companies FOR DELETE
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.company_memberships m
       WHERE m.company_id = companies.id
         AND m.user_id    = auth.uid()
         AND m.active     = true
         AND m.role       = 'owner'
    )
  );
