-- ═══════════════════════════════════════════════════════════════════════════
-- R-2 (2026-05-13): canonical caller-company resolver (ROOT FIX)
-- ─────────────────────────────────────────────────────────────────────────
-- SUPERSEDES the L5-SEC-9 per-user channel scoping for evidence-changes.
-- That band-aid was tighter than the actual privacy model required:
-- admins couldn't observe their own team's evidence pipeline live.
--
-- This migration adds a single SECDEF helper that any client path can
-- call to resolve "what company is this user acting on behalf of?":
--   Tier 1: profiles.active_company_id  (user picked one via UI)
--   Tier 2: single admin/owner membership (auto-pick when unambiguous)
--   Tier 3: single any-role membership (auto-pick for employees)
--   Else:   NULL (ambiguous or unauthenticated)
--
-- evidence-store.ts uses this to scope the evidence-changes Realtime
-- channel as `evidence-changes:<companyId>` — admins + members of the
-- same company see each other's evidence activity; cross-company
-- subscribers are excluded by the channel name itself.
--
-- VERIFIED LIVE (pg_temp r2_check):
--   owner of "dell"      → c07008cd-2824-40ad-9dae-33f8074e1ed9
--   employee of "dell"   → c07008cd-2824-40ad-9dae-33f8074e1ed9
--   anon                 → NULL
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_company_id uuid;
  v_count int;
BEGIN
  IF v_caller IS NULL THEN RETURN NULL; END IF;

  SELECT active_company_id INTO v_company_id FROM public.profiles WHERE id = v_caller LIMIT 1;
  IF v_company_id IS NOT NULL THEN RETURN v_company_id; END IF;

  SELECT count(DISTINCT m.company_id) INTO v_count
    FROM public.company_memberships m
   WHERE m.user_id = v_caller AND m.active = true
     AND m.role IN ('owner','super_admin','admin');
  IF v_count = 1 THEN
    SELECT m.company_id INTO v_company_id
      FROM public.company_memberships m
     WHERE m.user_id = v_caller AND m.active = true
       AND m.role IN ('owner','super_admin','admin')
     LIMIT 1;
    RETURN v_company_id;
  END IF;

  SELECT count(DISTINCT m.company_id) INTO v_count
    FROM public.company_memberships m
   WHERE m.user_id = v_caller AND m.active = true;
  IF v_count = 1 THEN
    SELECT m.company_id INTO v_company_id
      FROM public.company_memberships m
     WHERE m.user_id = v_caller AND m.active = true
     LIMIT 1;
    RETURN v_company_id;
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_my_company_id() IS
  'R-2 (2026-05-13): canonical caller-company resolver. Tier 1 profile.active_company_id; Tier 2 single admin/owner membership; Tier 3 single any-role membership. Returns NULL if ambiguous or no membership.';
