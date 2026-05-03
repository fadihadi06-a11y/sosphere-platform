-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260502220502
-- name:     foundation_canonical_identity_rpc_v4
-- live:     foundation_canonical_identity_rpc_v4
-- sha256:   504cae362f419b9b (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- v4: fix column name (employees.zone_id NOT employees.zone)
CREATE OR REPLACE FUNCTION public.get_my_identity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_email          text;
  v_email_conf     timestamptz;
  v_last_signin    timestamptz;
  v_has_password   boolean;
  v_provider       text;
  v_company_id     uuid;
  v_company_role   text;
  v_company_name   text;
  v_company_owner  uuid;
  v_emp_name       text;
  v_emp_status     text;
  v_emp_role       text;
  v_emp_zone_id    uuid;
  v_emp_zone_name  text;
  v_emp_department text;
  v_emp_phone      text;
  v_emp_verified   boolean;
  v_emp_lastseen   timestamptz;
  v_profile_name   text;
  v_profile_type   text;
  v_profile_role   text;
  v_profile_co_id  text;
  v_primary_role   text;
  v_capabilities   text[] := ARRAY[]::text[];
  v_warnings       text[] := ARRAY[]::text[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'user_id', NULL, 'primary_role', 'guest',
      'capabilities', ARRAY['public.read']::text[]
    );
  END IF;

  SELECT email, email_confirmed_at, last_sign_in_at,
         encrypted_password IS NOT NULL,
         (raw_app_meta_data->>'provider')
    INTO v_email, v_email_conf, v_last_signin, v_has_password, v_provider
    FROM auth.users WHERE id = v_user_id;

  IF v_email IS NULL AND v_has_password IS NULL THEN
    RETURN jsonb_build_object(
      'user_id', v_user_id::text, 'primary_role', 'guest',
      'capabilities', ARRAY['public.read']::text[],
      'warnings', ARRAY['auth_user_missing']::text[]
    );
  END IF;

  SELECT cm.company_id, cm.role
    INTO v_company_id, v_company_role
    FROM public.company_memberships cm
    WHERE cm.user_id = v_user_id AND cm.active = true LIMIT 1;

  IF v_company_id IS NOT NULL THEN
    SELECT name, owner_id INTO v_company_name, v_company_owner
      FROM public.companies WHERE id = v_company_id;

    v_primary_role := v_company_role;

    IF v_company_role = 'owner' AND v_company_owner IS DISTINCT FROM v_user_id THEN
      v_warnings := array_append(v_warnings, 'inv_I2_owner_role_without_owner_id');
    END IF;

    IF v_company_role IN ('employee', 'dispatcher') THEN
      -- employees uses zone_id (UUID FK to zones), not zone (text)
      SELECT e.name, e.status, e.role, e.zone_id, e.department,
             e.phone, e.verified, e.last_seen_at
        INTO v_emp_name, v_emp_status, v_emp_role, v_emp_zone_id, v_emp_department,
             v_emp_phone, v_emp_verified, v_emp_lastseen
        FROM public.employees e
        WHERE e.user_id = v_user_id AND e.company_id = v_company_id LIMIT 1;

      IF v_emp_name IS NULL THEN
        v_warnings := array_append(v_warnings, 'inv_I3_employee_role_without_employees_row');
      END IF;

      -- Resolve zone name if FK is set (best-effort, NULL on miss)
      IF v_emp_zone_id IS NOT NULL THEN
        SELECT name INTO v_emp_zone_name FROM public.zones WHERE id = v_emp_zone_id;
      END IF;
    END IF;
  ELSE
    v_primary_role := 'civilian';
  END IF;

  SELECT full_name, user_type, role, active_company_id::text
    INTO v_profile_name, v_profile_type, v_profile_role, v_profile_co_id
    FROM public.profiles WHERE id = v_user_id;

  IF v_profile_co_id IS NOT NULL AND v_company_id IS NOT NULL
     AND v_profile_co_id::uuid <> v_company_id THEN
    v_warnings := array_append(v_warnings, 'inv_I4_profile_company_mismatch');
  END IF;

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
    'user_id', v_user_id::text,
    'email', v_email,
    'email_confirmed', v_email_conf IS NOT NULL,
    'has_password', COALESCE(v_has_password, false),
    'auth_provider', COALESCE(v_provider, 'email'),
    'last_sign_in', v_last_signin,
    'primary_role', v_primary_role,
    'active_company', CASE WHEN v_company_id IS NOT NULL
                        THEN jsonb_build_object('id', v_company_id::text, 'name', v_company_name)
                        ELSE NULL END,
    'company_role', v_company_role,
    'employee_data', CASE WHEN v_emp_name IS NOT NULL
                        THEN jsonb_build_object(
                          'name', v_emp_name, 'status', v_emp_status,
                          'role', v_emp_role,
                          'zone', CASE WHEN v_emp_zone_id IS NOT NULL
                                    THEN jsonb_build_object('id', v_emp_zone_id::text, 'name', v_emp_zone_name)
                                    ELSE NULL END,
                          'department', v_emp_department, 'phone', v_emp_phone,
                          'verified', v_emp_verified, 'last_seen_at', v_emp_lastseen
                        )
                        ELSE NULL END,
    'profile', jsonb_build_object(
                 'full_name', v_profile_name,
                 'user_type', v_profile_type,
                 'role', v_profile_role
                ),
    'capabilities', v_capabilities,
    'warnings', v_warnings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_identity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_identity() TO anon;;
