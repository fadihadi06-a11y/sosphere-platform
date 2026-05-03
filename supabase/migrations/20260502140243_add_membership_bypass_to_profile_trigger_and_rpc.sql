-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260502140243
-- name:     add_membership_bypass_to_profile_trigger_and_rpc
-- live:     add_membership_bypass_to_profile_trigger_and_rpc
-- sha256:   761a020621c56113 (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- Audit 2026-05-02 (CRITICAL employee onboarding fix, layer 2):
-- After fixing the user_type CHECK (add_business_to_profiles_user_type_check),
-- accept_invitation() still failed because of the
-- block_sensitive_profile_changes() trigger (W3-37). The trigger correctly
-- prevents users from self-promoting their company_id / user_type via
-- direct UPDATE, but the legitimate accept_invitation flow needs to set
-- those fields when a new employee accepts their invite (the profile row
-- often pre-exists with user_type='individual' from the auth signup
-- defaults, so the UPSERT becomes an UPDATE and the guard fires).
--
-- This migration:
--   (a) extends the trigger to honor a second bypass flag
--       `app.allow_membership_update` for user_type / company_id /
--       active_company_id changes (mirrors the existing
--       `app.allow_role_update` mechanism for role).
--   (b) updates accept_invitation() to set both bypass flags before its
--       profiles UPSERT, so this single RPC remains the only legitimate
--       path that can reshape membership fields.

-- (a) Trigger update
CREATE OR REPLACE FUNCTION public.block_sensitive_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_allow_role       text;
  v_allow_membership text;
BEGIN
  BEGIN
    v_allow_role := current_setting('app.allow_role_update', true);
  EXCEPTION WHEN OTHERS THEN v_allow_role := NULL; END;

  BEGIN
    v_allow_membership := current_setting('app.allow_membership_update', true);
  EXCEPTION WHEN OTHERS THEN v_allow_membership := NULL; END;

  -- role guard (unchanged)
  IF v_allow_role = 'true' AND new.role IS DISTINCT FROM old.role THEN
    NULL;
  ELSIF new.role IS DISTINCT FROM old.role THEN
    RAISE EXCEPTION 'W3-37: changing role is not allowed via direct UPDATE. Use the dedicated RPC.';
  END IF;

  -- membership guard — now bypass-aware
  IF v_allow_membership = 'true' THEN
    NULL; -- legitimate RPC such as accept_invitation
  ELSIF new.user_type IS DISTINCT FROM old.user_type
     OR new.company_id IS DISTINCT FROM old.company_id
     OR new.active_company_id IS DISTINCT FROM old.active_company_id
  THEN
    RAISE EXCEPTION 'W3-37: changing user_type, company_id, or active_company_id is not allowed via direct UPDATE. Use the dedicated RPC.';
  END IF;

  -- age fields stay locked regardless (compliance — no bypass)
  IF new.age_verified_at IS DISTINCT FROM old.age_verified_at
     OR new.age_category IS DISTINCT FROM old.age_category
     OR new.parental_consent_at IS DISTINCT FROM old.parental_consent_at
  THEN
    RAISE EXCEPTION 'W3-37: changing age fields is not allowed via direct UPDATE.';
  END IF;

  RETURN new;
END;
$$;

-- (b) accept_invitation: set bypass flag for the profiles UPSERT
CREATE OR REPLACE FUNCTION public.accept_invitation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invitation RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'User email not found' USING ERRCODE = '42704';
  END IF;

  SELECT * INTO v_invitation
    FROM public.invitations
    WHERE lower(trim(email)) = lower(trim(v_user_email))
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at DESC
    LIMIT 1;

  IF v_invitation.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_pending_invitation', 'email', v_user_email);
  END IF;

  IF v_invitation.company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invitation_missing_company_id', 'invitation_id', v_invitation.id);
  END IF;

  -- 1. Membership
  INSERT INTO public.company_memberships (company_id, user_id, role, active, created_at)
  VALUES (v_invitation.company_id, v_user_id, COALESCE(v_invitation.role, 'employee'), true, now())
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET active = true, role = EXCLUDED.role;

  -- 2. Employee
  INSERT INTO public.employees (
    company_id, user_id, role, status, name, phone, department, verified, created_at, updated_at
  ) VALUES (
    v_invitation.company_id, v_user_id,
    COALESCE(v_invitation.role_type, v_invitation.role, 'employee'),
    'off_duty',
    COALESCE(v_invitation.name, ''),
    v_invitation.phone,
    COALESCE(v_invitation.department, 'General'),
    true, now(), now()
  )
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET verified = true,
        name = COALESCE(NULLIF(EXCLUDED.name, ''), employees.name),
        phone = COALESCE(EXCLUDED.phone, employees.phone),
        department = COALESCE(EXCLUDED.department, employees.department),
        updated_at = now();

  -- 3. Profile — set bypass flag so block_sensitive_profile_changes
  --    allows the legitimate user_type/company_id transition.
  --    Flag is LOCAL to this transaction (auto-cleared on commit/rollback).
  PERFORM set_config('app.allow_membership_update', 'true', true);

  INSERT INTO public.profiles (id, user_id, full_name, role, active_company_id, company_id, email, user_type, updated_at)
  VALUES (
    v_user_id, v_user_id,
    COALESCE(v_invitation.name, split_part(v_user_email, '@', 1)),
    'employee',
    v_invitation.company_id, v_invitation.company_id,
    v_user_email, 'business', now()
  )
  ON CONFLICT (id) DO UPDATE
    SET active_company_id = EXCLUDED.active_company_id,
        company_id        = EXCLUDED.company_id,
        user_type         = CASE
          WHEN profiles.user_type IN ('individual', '') OR profiles.user_type IS NULL
          THEN EXCLUDED.user_type
          ELSE profiles.user_type
        END,
        role              = CASE
          WHEN profiles.role IS NULL OR profiles.role = '' THEN EXCLUDED.role
          ELSE profiles.role
        END,
        full_name = CASE
          WHEN profiles.full_name IS NULL OR profiles.full_name = '' THEN EXCLUDED.full_name
          ELSE profiles.full_name
        END,
        updated_at = now();

  -- 4. Mark invitation accepted
  UPDATE public.invitations
    SET status = 'accepted', accepted_at = now()
  WHERE id = v_invitation.id;

  -- 5. Audit (best-effort)
  BEGIN
    INSERT INTO public.audit_log (id, action, actor, actor_id, actor_role, operation, target, category, severity, metadata, created_at)
    VALUES (
      gen_random_uuid(),
      'invitation_accepted',
      'user', v_user_id, 'user', 'INSERT', v_invitation.company_id::text,
      'membership', 'info',
      jsonb_build_object('invitation_id', v_invitation.id, 'role', COALESCE(v_invitation.role, 'employee'), 'email', v_user_email),
      now()
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'company_id', v_invitation.company_id, 'role', COALESCE(v_invitation.role, 'employee'), 'invitation_id', v_invitation.id);
END;
$$;;
