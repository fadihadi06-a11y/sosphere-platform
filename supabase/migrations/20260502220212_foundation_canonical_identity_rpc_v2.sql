-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260502220212
-- name:     foundation_canonical_identity_rpc_v2
-- live:     foundation_canonical_identity_rpc_v2
-- sha256:   3f6689bf7c15b5ea (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- v2: explicit array_append to avoid text[] || text ambiguity (Postgres
-- otherwise tries to interpret 'public.read' as an array literal).

CREATE OR REPLACE FUNCTION public.get_my_identity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_user      record;
  v_active    record;
  v_company   record;
  v_employee  record;
  v_profile   record;
  v_primary_role  text;
  v_capabilities  text[] := ARRAY[]::text[];
  v_warnings      text[] := ARRAY[]::text[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'user_id',       NULL,
      'primary_role',  'guest',
      'capabilities',  ARRAY['public.read']::text[]
    );
  END IF;

  SELECT id, email, email_confirmed_at, created_at, last_sign_in_at,
         encrypted_password IS NOT NULL AS has_password,
         (raw_app_meta_data->>'provider') AS provider
    INTO v_user
    FROM auth.users
    WHERE id = v_user_id;

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object(
      'user_id',       v_user_id::text,
      'primary_role',  'guest',
      'capabilities',  ARRAY['public.read']::text[],
      'warnings',      ARRAY['auth_user_missing']::text[]
    );
  END IF;

  SELECT cm.company_id, cm.role, cm.created_at
    INTO v_active
    FROM public.company_memberships cm
    WHERE cm.user_id = v_user_id AND cm.active = true
    LIMIT 1;

  IF v_active.company_id IS NOT NULL THEN
    SELECT id, name, owner_id::text AS owner_id, created_at
      INTO v_company
      FROM public.companies
      WHERE id = v_active.company_id;

    v_primary_role := v_active.role;

    IF v_active.role = 'owner' AND v_company.owner_id::uuid IS DISTINCT FROM v_user_id THEN
      v_warnings := array_append(v_warnings, 'inv_I2_owner_role_without_owner_id');
    END IF;

    IF v_active.role IN ('employee', 'dispatcher') THEN
      SELECT e.name, e.status, e.role AS emp_role, e.zone, e.department,
             e.phone, e.verified, e.last_seen_at
        INTO v_employee
        FROM public.employees e
        WHERE e.user_id = v_user_id AND e.company_id = v_active.company_id
        LIMIT 1;

      IF v_employee.name IS NULL THEN
        v_warnings := array_append(v_warnings, 'inv_I3_employee_role_without_employees_row');
      END IF;
    END IF;
  ELSE
    v_primary_role := 'civilian';
  END IF;

  SELECT full_name, user_type, role AS profile_role, active_company_id::text AS profile_company
    INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id;

  IF v_profile.profile_company IS NOT NULL
     AND v_active.company_id IS NOT NULL
     AND v_profile.profile_company::uuid <> v_active.company_id THEN
    v_warnings := array_append(v_warnings, 'inv_I4_profile_company_mismatch');
  END IF;

  -- ── Compute capabilities (use array_append to avoid || ambiguity) ─
  v_capabilities := array_append(v_capabilities, 'public.read');
  v_capabilities := array_append(v_capabilities, 'self.read');
  v_capabilities := array_append(v_capabilities, 'self.update');

  IF v_primary_role = 'owner' THEN
    v_capabilities := v_capabilities || ARRAY[
      'dashboard.read', 'dashboard.admin',
      'company.invite', 'company.revoke', 'company.delete',
      'employees.read', 'employees.manage',
      'sos.review', 'sos.resolve', 'sos.history.read',
      'reports.generate', 'audit.read',
      'settings.billing', 'settings.security'
    ]::text[];
  ELSIF v_primary_role IN ('employee', 'dispatcher') THEN
    v_capabilities := v_capabilities || ARRAY[
      'app.read', 'sos.trigger', 'sos.cancel',
      'checkin.create', 'mission.read'
    ]::text[];
    IF v_primary_role = 'dispatcher' THEN
      v_capabilities := v_capabilities || ARRAY[
        'sos.review', 'sos.assign', 'mission.assign'
      ]::text[];
    END IF;
  ELSIF v_primary_role = 'civilian' THEN
    v_capabilities := v_capabilities || ARRAY[
      'app.read', 'sos.trigger.personal',
      'family.manage', 'contacts.manage'
    ]::text[];
  END IF;

  RETURN jsonb_build_object(
    'user_id',         v_user.id::text,
    'email',           v_user.email,
    'email_confirmed', v_user.email_confirmed_at IS NOT NULL,
    'has_password',    v_user.has_password,
    'auth_provider',   COALESCE(v_user.provider, 'email'),
    'last_sign_in',    v_user.last_sign_in_at,
    'primary_role',    v_primary_role,
    'active_company',  CASE WHEN v_company.id IS NOT NULL
                          THEN jsonb_build_object('id', v_company.id::text, 'name', v_company.name)
                          ELSE NULL END,
    'company_role',    v_active.role,
    'employee_data',   CASE WHEN v_employee.name IS NOT NULL
                          THEN jsonb_build_object(
                            'name', v_employee.name, 'status', v_employee.status,
                            'role', v_employee.emp_role, 'zone', v_employee.zone,
                            'department', v_employee.department, 'phone', v_employee.phone,
                            'verified', v_employee.verified, 'last_seen_at', v_employee.last_seen_at
                          )
                          ELSE NULL END,
    'profile',         jsonb_build_object(
                         'full_name', v_profile.full_name,
                         'user_type', v_profile.user_type,
                         'role', v_profile.profile_role
                       ),
    'capabilities',    v_capabilities,
    'warnings',        v_warnings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_identity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_identity() TO anon;;
