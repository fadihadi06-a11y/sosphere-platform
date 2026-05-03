-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260502220111
-- name:     foundation_canonical_identity_rpc
-- live:     foundation_canonical_identity_rpc
-- sha256:   4fec16eb2e5bb885 (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- FOUNDATION-1 (#176): Canonical Identity Model
-- 
-- BEFORE this migration, "who is this user" was scattered across 5
-- tables (auth.users, profiles, company_memberships, employees,
-- invitations) with no single source of truth. Audit revealed:
--   • Owner FZ had profiles.user_type='individual', role='employee',
--     active_company_id=NULL — wrong on all 3 fields. The truth was
--     in company_memberships (role='owner') + companies (owner_id).
--   • Multiple invitation history rows polluted "current state"
--     queries.
--   • Mode-confusion bugs (civilian becomes employee but profile
--     stays individual) cascaded into UX issues like the "rod" home
--     showing instead of real employee data.
--
-- THIS MIGRATION establishes the source-of-truth contract:
--   • auth.users = identity root (email, password, JWT subject)
--   • company_memberships = AUTHORITATIVE for company role + active
--     company (one active per user enforced by uq_one_active_company_per_user)
--   • employees = operational extension (only when memberships.role
--     IN ('employee','dispatcher'))
--   • profiles = display metadata (full_name, photo) — not auth state
--   • invitations = workflow history (NEVER read for current state)
--   • companies = company metadata + owner_id back-reference
--
-- EXPORTS:
--   public.get_my_identity() — SECURITY DEFINER RPC returning the
--     canonical identity blob for the authenticated caller. Single
--     entry point for "who am I + what can I do" across the entire
--     codebase. Replaces ad-hoc multi-table SELECTs in fast-paths
--     (mobile-app.tsx, dashboard-web-page.tsx, etc.).
--
-- INVARIANTS (will be enforced later by triggers in FOUNDATION-2):
--   I1: every authenticated user has at least zero memberships (OK)
--   I2: a user with active membership of role='owner' MUST have a
--       matching companies.owner_id row
--   I3: a user with active membership of role='employee' SHOULD have
--       an employees row (validated by the RPC; missing rows are
--       reported as warnings in identity.warnings[])
--   I4: profiles.active_company_id, when set, MUST equal an active
--       membership of the same user
-- ═══════════════════════════════════════════════════════════════

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
  -- ── Anonymous caller (no JWT or expired) → guest identity ─────
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'user_id',       NULL,
      'primary_role',  'guest',
      'capabilities',  ARRAY['public.read']::text[]
    );
  END IF;

  -- ── 1. Identity root (auth.users) ─────────────────────────────
  SELECT id, email, email_confirmed_at, created_at, last_sign_in_at,
         encrypted_password IS NOT NULL AS has_password,
         (raw_app_meta_data->>'provider') AS provider
    INTO v_user
    FROM auth.users
    WHERE id = v_user_id;

  IF v_user.id IS NULL THEN
    -- Defensive: JWT exists but auth.users row was deleted.
    -- Possible during account-delete race — return guest-like.
    RETURN jsonb_build_object(
      'user_id',       v_user_id::text,
      'primary_role',  'guest',
      'capabilities',  ARRAY['public.read']::text[],
      'warnings',      ARRAY['auth_user_missing']::text[]
    );
  END IF;

  -- ── 2. Authoritative role: active membership ──────────────────
  -- Partial unique index uq_one_active_company_per_user guarantees
  -- AT MOST ONE active membership per user, so LIMIT 1 is safe.
  SELECT cm.company_id, cm.role, cm.created_at
    INTO v_active
    FROM public.company_memberships cm
    WHERE cm.user_id = v_user_id AND cm.active = true
    LIMIT 1;

  IF v_active.company_id IS NOT NULL THEN
    -- Active company-role user — load company + role-specific data
    SELECT id, name, owner_id::text AS owner_id, created_at
      INTO v_company
      FROM public.companies
      WHERE id = v_active.company_id;

    -- Determine primary_role from membership
    v_primary_role := v_active.role;  -- 'owner' | 'employee' | 'dispatcher' | …

    -- I2 invariant check
    IF v_active.role = 'owner' AND v_company.owner_id::uuid IS DISTINCT FROM v_user_id THEN
      v_warnings := v_warnings || 'inv_I2_owner_role_without_owner_id';
    END IF;

    -- For employee/dispatcher roles, load operational data
    IF v_active.role IN ('employee', 'dispatcher') THEN
      SELECT e.name, e.status, e.role AS emp_role, e.zone, e.department,
             e.phone, e.verified, e.last_seen_at
        INTO v_employee
        FROM public.employees e
        WHERE e.user_id = v_user_id AND e.company_id = v_active.company_id
        LIMIT 1;

      -- I3 invariant: employee role implies employees row exists
      IF v_employee.name IS NULL THEN
        v_warnings := v_warnings || 'inv_I3_employee_role_without_employees_row';
      END IF;
    END IF;
  ELSE
    -- No active membership → civilian (or unconfirmed)
    v_primary_role := 'civilian';
  END IF;

  -- ── 3. Profile (display metadata, not authoritative for role) ──
  SELECT full_name, user_type, role AS profile_role, active_company_id::text AS profile_company
    INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id;

  -- I4 invariant: profile.active_company_id MUST match active membership
  IF v_profile.profile_company IS NOT NULL
     AND v_active.company_id IS NOT NULL
     AND v_profile.profile_company::uuid <> v_active.company_id THEN
    v_warnings := v_warnings || 'inv_I4_profile_company_mismatch';
  END IF;

  -- ── 4. Compute capabilities (the single contract for UI gating) ─
  -- Default everyone gets public.read.
  v_capabilities := v_capabilities || 'public.read';

  -- Authenticated baseline
  v_capabilities := v_capabilities || 'self.read' || 'self.update';

  IF v_primary_role = 'owner' THEN
    v_capabilities := v_capabilities ||
      'dashboard.read' || 'dashboard.admin' ||
      'company.invite' || 'company.revoke' || 'company.delete' ||
      'employees.read' || 'employees.manage' ||
      'sos.review' || 'sos.resolve' || 'sos.history.read' ||
      'reports.generate' || 'audit.read' ||
      'settings.billing' || 'settings.security';
  ELSIF v_primary_role IN ('employee', 'dispatcher') THEN
    v_capabilities := v_capabilities ||
      'app.read' ||
      'sos.trigger' || 'sos.cancel' ||
      'checkin.create' ||
      'mission.read';
    IF v_primary_role = 'dispatcher' THEN
      v_capabilities := v_capabilities ||
        'sos.review' || 'sos.assign' || 'mission.assign';
    END IF;
  ELSIF v_primary_role = 'civilian' THEN
    v_capabilities := v_capabilities ||
      'app.read' ||
      'sos.trigger.personal' ||
      'family.manage' ||
      'contacts.manage';
  END IF;

  -- ── 5. Compose canonical identity blob ────────────────────────
  RETURN jsonb_build_object(
    'user_id',         v_user.id::text,
    'email',           v_user.email,
    'email_confirmed', v_user.email_confirmed_at IS NOT NULL,
    'has_password',    v_user.has_password,
    'auth_provider',   COALESCE(v_user.provider, 'email'),
    'last_sign_in',    v_user.last_sign_in_at,

    'primary_role',    v_primary_role,

    'active_company',  CASE WHEN v_company.id IS NOT NULL
                          THEN jsonb_build_object(
                            'id',   v_company.id::text,
                            'name', v_company.name
                          )
                          ELSE NULL END,

    'company_role',    v_active.role,

    'employee_data',   CASE WHEN v_employee.name IS NOT NULL
                          THEN jsonb_build_object(
                            'name',         v_employee.name,
                            'status',       v_employee.status,
                            'role',         v_employee.emp_role,
                            'zone',         v_employee.zone,
                            'department',   v_employee.department,
                            'phone',        v_employee.phone,
                            'verified',     v_employee.verified,
                            'last_seen_at', v_employee.last_seen_at
                          )
                          ELSE NULL END,

    'profile',         jsonb_build_object(
                         'full_name',  v_profile.full_name,
                         'user_type',  v_profile.user_type,
                         'role',       v_profile.profile_role
                       ),

    'capabilities',    v_capabilities,
    'warnings',        v_warnings
  );
END;
$$;

-- ── Permissions: every authenticated caller can read their identity.
GRANT EXECUTE ON FUNCTION public.get_my_identity() TO authenticated;
-- Anonymous callers get the guest-shape return (handled inside fn).
GRANT EXECUTE ON FUNCTION public.get_my_identity() TO anon;

COMMENT ON FUNCTION public.get_my_identity() IS
'FOUNDATION-1 (#176): canonical identity for the authenticated caller. Single source of truth — replaces ad-hoc multi-table SELECTs in mobile-app fast-path, dashboard auth check, etc. Returns {user_id, email, primary_role, active_company, employee_data, profile, capabilities[], warnings[]}.';;
