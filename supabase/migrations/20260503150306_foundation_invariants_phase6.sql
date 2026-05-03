-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260503150306
-- name:     foundation_invariants_phase6
-- live:     foundation_invariants_phase6
-- sha256:   f1c0e5a3c2bf06f0 (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- FOUNDATION-1 / Phase 6: Identity invariants enforced at the DB layer
-- ═══════════════════════════════════════════════════════════════════════════
-- get_my_identity() (Phase 1-5) papers over identity fragmentation by READING
-- multiple tables and emitting a canonical view + warnings. Phase 6 makes
-- those warnings IMPOSSIBLE in the first place by enforcing the contracts at
-- the database layer, where no application code can bypass them.
--
-- INVARIANTS ENFORCED
-- ───────────────────
--   I-A  role values in {owner,admin,employee,dispatcher} on memberships+employees
--        (currently CHECK only allows {owner,admin,employee}; dispatcher used
--        in code via get_my_identity so without this fix any 'dispatcher'
--        membership would fail INSERT — bug waiting)
--   I-B  active owner-role membership.user_id == companies.owner_id
--        (two sources of truth today; trigger forces convergence)
--   I-D  profiles.active_company_id, when set, MUST match an active
--        company_membership of the same user
--   I-E  invitations.invited_by MUST own invitations.company_id
--        (edge function check exists; this is defense-in-depth at DB layer)
--   I-F  audit_log rows with category='auth' must carry actor_id
--        (SOC2/ISO27001 evidence integrity)
--
-- DEFERRED ENFORCEMENT
-- ────────────────────
-- I-B and I-D triggers are CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY
-- DEFERRED so multi-step transactions like register_company_full and
-- accept_invitation can complete naturally; the check fires at COMMIT.
-- This is the only correct way to validate cross-row invariants in
-- Postgres without forcing brittle insert ordering on application code.
--
-- SAFETY GATE
-- ───────────
-- The migration FIRST asserts the pre-conditions: zero existing rows
-- violate any of I-A through I-F. If somehow data drifted between
-- diagnostic and apply, this RAISE aborts BEFORE any constraint is added,
-- leaving the system fi its prior state.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Pre-flight assertion: refuse to apply if any current row violates ───
DO $$
DECLARE
  v_violations int;
BEGIN
  SELECT
      (SELECT COUNT(*) FROM public.company_memberships WHERE role NOT IN ('owner','admin','employee','dispatcher'))
    + (SELECT COUNT(*) FROM public.employees           WHERE role NOT IN ('owner','admin','employee','dispatcher'))
    + (SELECT COUNT(*) FROM public.company_memberships cm JOIN public.companies c ON c.id=cm.company_id
         WHERE cm.active=true AND cm.role='owner' AND c.owner_id IS DISTINCT FROM cm.user_id)
    + (SELECT COUNT(*) FROM public.profiles p
         LEFT JOIN public.company_memberships cm
           ON cm.user_id=p.id AND cm.company_id=p.active_company_id AND cm.active=true
         WHERE p.active_company_id IS NOT NULL AND cm.user_id IS NULL)
    + (SELECT COUNT(*) FROM public.invitations i JOIN public.companies c ON c.id=i.company_id
         WHERE i.invited_by IS DISTINCT FROM c.owner_id)
    + (SELECT COUNT(*) FROM public.audit_log WHERE category='auth' AND actor_id IS NULL)
    + (SELECT COUNT(*) FROM public.company_memberships WHERE active IS NULL)
    INTO v_violations;
  IF v_violations > 0 THEN
    RAISE EXCEPTION 'foundation_invariants_phase6: pre-flight failed, % rows violate one or more invariants. Investigate before applying.', v_violations
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCK A: widen role CHECKs to include 'dispatcher' (purely additive)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.company_memberships DROP CONSTRAINT IF EXISTS company_memberships_role_check;
ALTER TABLE public.company_memberships
  ADD CONSTRAINT company_memberships_role_check
  CHECK (role IN ('owner','admin','employee','dispatcher'));

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_role_check
  CHECK (role IN ('owner','admin','employee','dispatcher'));

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCK B: company_memberships.active NOT NULL (was nullable; 0 nulls today)
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public.company_memberships
  ALTER COLUMN active SET DEFAULT true;
ALTER TABLE public.company_memberships
  ALTER COLUMN active SET NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK C: I-B — owner-role membership ↔ companies.owner_id consistency
-- DEFERRABLE so register_company_full's atomic insert sequence works.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enforce_owner_membership_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_company_owner uuid;
BEGIN
  -- Only check when this is an active owner-role membership
  IF NEW.role <> 'owner' OR NEW.active = false THEN
    RETURN NEW;
  END IF;

  SELECT owner_id INTO v_company_owner
    FROM public.companies WHERE id = NEW.company_id;

  IF v_company_owner IS NULL THEN
    RAISE EXCEPTION 'I-B: company % has NULL owner_id but a user (%) claims owner membership',
      NEW.company_id, NEW.user_id
      USING ERRCODE = '23514';
  END IF;

  IF v_company_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'I-B: owner-role membership user_id=% does not match companies.owner_id=% for company %',
      NEW.user_id, v_company_owner, NEW.company_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS enforce_owner_membership_consistency ON public.company_memberships;
CREATE CONSTRAINT TRIGGER enforce_owner_membership_consistency
AFTER INSERT OR UPDATE OF role, active, user_id ON public.company_memberships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_owner_membership_consistency();

COMMENT ON FUNCTION public.enforce_owner_membership_consistency IS
  'FOUNDATION-1 Phase 6 / I-B: owner-role membership.user_id MUST equal companies.owner_id. DEFERRABLE so register_company_full multi-step transaction works.';

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCK D: I-E — invitations.invited_by must own invitations.company_id
-- BEFORE INSERT (synchronous; service_role bypass for edge functions)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enforce_invitation_inviter_owns_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_owner uuid;
  v_jwt_role text;
BEGIN
  -- Service role bypass: direct Postgres connection (admin tools, edge fns
  -- using the SR JWT, server-side migrations). Mirrors the dual-signal
  -- pattern from batch2_hotfix_lock_trigger_robust_role_check.
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;
  v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT owner_id INTO v_owner
    FROM public.companies WHERE id = NEW.company_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'I-E: cannot invite to company % — company has no owner', NEW.company_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.invited_by IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'I-E: invited_by=% does not own company % (owner=%). Only the company owner may issue invites.',
      NEW.invited_by, NEW.company_id, v_owner
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS enforce_invitation_inviter_owns_company ON public.invitations;
CREATE TRIGGER enforce_invitation_inviter_owns_company
BEFORE INSERT ON public.invitations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_invitation_inviter_owns_company();

COMMENT ON FUNCTION public.enforce_invitation_inviter_owns_company IS
  'FOUNDATION-1 Phase 6 / I-E: invitations.invited_by MUST equal companies.owner_id. Defense-in-depth (edge function already checks). Service-role connections bypass.';

-- ═════════════════════════════════════════════════════════════════════════
-- BLOCK E: I-F — auth-category audit_log rows MUST carry actor_id
-- CHECK constraint (synchronous, no trigger overhead)
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_auth_actor_required;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_auth_actor_required
  CHECK (
    category <> 'auth'
    OR action = 'system'
    OR actor_id IS NOT NULL
  )
  NOT VALID;
ALTER TABLE public.audit_log VALIDATE CONSTRAINT audit_log_auth_actor_required;

COMMENT ON CONSTRAINT audit_log_auth_actor_required ON public.audit_log IS
  'FOUNDATION-1 Phase 6 / I-F: SOC2/ISO27001 evidence integrity. Auth events must be traceable to an actor.';

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCK F: I-D — profiles.active_company_id ↔ active membership
-- DEFERRABLE so accept_invitation's transaction can insert membership and
-- update profile in either order before the COMMIT-time check.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enforce_profile_active_company_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
BEGIN
  -- NULL is always allowed: civilian users + just-signed-up users
  IF NEW.active_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.company_memberships
     WHERE user_id    = NEW.id
       AND company_id = NEW.active_company_id
       AND active     = true
  ) THEN
    RAISE EXCEPTION 'I-D: profile %.active_company_id=% has no matching active membership',
      NEW.id, NEW.active_company_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS enforce_profile_active_company_match ON public.profiles;
CREATE CONSTRAINT TRIGGER enforce_profile_active_company_match
AFTER INSERT OR UPDATE OF active_company_id ON public.profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_active_company_match();

COMMENT ON FUNCTION public.enforce_profile_active_company_match IS
  'FOUNDATION-1 Phase 6 / I-D: profiles.active_company_id MUST equal an active membership of the same user. DEFERRABLE so accept_invitation works.';

-- ═════════════════════════════════════════════════════════════════════════
-- Post-condition: re-run pre-flight assertion to confirm everything still
-- holds AFTER the constraints are in place. Catches any race during apply.
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_violations int;
BEGIN
  SELECT
      (SELECT COUNT(*) FROM public.company_memberships WHERE role NOT IN ('owner','admin','employee','dispatcher'))
    + (SELECT COUNT(*) FROM public.employees           WHERE role NOT IN ('owner','admin','employee','dispatcher'))
    + (SELECT COUNT(*) FROM public.invitations i JOIN public.companies c ON c.id=i.company_id
         WHERE i.invited_by IS DISTINCT FROM c.owner_id)
    + (SELECT COUNT(*) FROM public.audit_log WHERE category='auth' AND actor_id IS NULL)
    + (SELECT COUNT(*) FROM public.company_memberships WHERE active IS NULL)
    INTO v_violations;
  IF v_violations > 0 THEN
    RAISE EXCEPTION 'foundation_invariants_phase6: post-condition violated (% rows). Constraints rolled back by transaction.', v_violations
      USING ERRCODE = '23514';
  END IF;
END;
$$;;
