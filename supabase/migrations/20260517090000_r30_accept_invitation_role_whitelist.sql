-- ═══════════════════════════════════════════════════════════════════════════
-- R-30 (2026-05-17) — accept_invitation role whitelist
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS (security blocker, LAUNCH_AUDIT.md #7)
--
--   The company-registration wizard collects "role" as a FREE-TEXT job-title
--   field (company-register.tsx:1431). When an owner CSV-imports employee
--   rows, that text lands directly in public.invitations.role. The previous
--   accept_invitation() RPC propagated this value verbatim into
--   public.company_memberships.role via COALESCE(v_invitation.role,
--   'employee') — granting whatever role the inviter typed, including
--   'admin' or 'owner'.
--
--   Combined with the dashboard-actions edge function's lack of admin/owner
--   role check (R-30 sibling fix), this gave any junior employee a path to
--   full SOS-lifecycle control once their owner's CSV happened to set
--   role='admin' as a free-text job title.
--
-- THE FIX (root-level)
--   Whitelist server-side. Roles allowed via accept_invitation are
--   {'employee', 'member'}. Anything else collapses to 'employee'.
--   Elevation to 'admin' or 'owner' must go through promote_user_to_admin
--   (existing RPC, owner-only, audited separately).
--
-- BACKWARDS-COMPAT
--   This migration does NOT touch existing rows in company_memberships.
--   Pre-existing admin/owner memberships granted through the buggy path
--   stay as-is; security review can revoke them manually via SQL if any
--   are found in production. (Run: SELECT * FROM company_memberships
--   WHERE role IN ('admin','owner') AND created_at > '2026-04-30'
--   AND user_id NOT IN (SELECT user_id FROM companies WHERE owner = true))
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.accept_invitation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_user_email  text;
  v_invitation  RECORD;
  -- R-30: whitelisted roles. Free-text job-title fields land here and are
  -- coerced to a safe default if not in this set.
  v_safe_role   text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'User email not found' USING ERRCODE = '42704';
  END IF;
  SELECT * INTO v_invitation FROM public.invitations
    WHERE lower(trim(email)) = lower(trim(v_user_email))
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at DESC LIMIT 1;
  IF v_invitation.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_pending_invitation', 'email', v_user_email);
  END IF;
  IF v_invitation.company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invitation_missing_company_id', 'invitation_id', v_invitation.id);
  END IF;

  -- R-30 ROOT FIX: coerce the wizard's free-text role to a safe whitelist.
  -- Privileged roles (admin/owner) MUST come through promote_user_to_admin
  -- which checks the caller's existing privileges — not through a CSV row.
  v_safe_role := CASE
    WHEN lower(trim(coalesce(v_invitation.role, ''))) IN ('employee', 'member')
      THEN lower(trim(v_invitation.role))
    ELSE 'employee'
  END;

  INSERT INTO public.company_memberships (company_id, user_id, role, active, created_at)
  VALUES (v_invitation.company_id, v_user_id, v_safe_role, true, now())
  ON CONFLICT (company_id, user_id) DO UPDATE
    -- R-30: never DOWNGRADE an existing privileged role on re-acceptance,
    -- and never UPGRADE based on a fresh invitation either. Keep what was
    -- there if it was already privileged; otherwise apply the whitelisted
    -- new role.
    SET active = true,
        role = CASE
          WHEN company_memberships.role IN ('admin', 'owner') THEN company_memberships.role
          ELSE EXCLUDED.role
        END;

  INSERT INTO public.employees (
    company_id, user_id, role, status, name, phone, department, verified, created_at, updated_at
  ) VALUES (
    v_invitation.company_id, v_user_id,
    -- The employees.role column is denormalised display data; same coercion.
    v_safe_role,
    'off_duty', COALESCE(v_invitation.name, ''),
    v_invitation.phone, COALESCE(v_invitation.department, 'General'),
    true, now(), now()
  )
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET verified = true,
        name = COALESCE(NULLIF(EXCLUDED.name, ''), employees.name),
        phone = COALESCE(EXCLUDED.phone, employees.phone),
        department = COALESCE(EXCLUDED.department, employees.department),
        updated_at = now();

  INSERT INTO public.profiles (id, user_id, full_name, role, active_company_id, company_id, email, user_type, updated_at)
  VALUES (
    v_user_id, v_user_id,
    COALESCE(v_invitation.name, split_part(v_user_email, '@', 1)),
    'employee', v_invitation.company_id, v_invitation.company_id,
    v_user_email, 'business', now()
  )
  ON CONFLICT (id) DO UPDATE
    SET active_company_id = EXCLUDED.active_company_id,
        company_id = EXCLUDED.company_id,
        role = CASE WHEN profiles.role IS NULL OR profiles.role = '' THEN EXCLUDED.role ELSE profiles.role END,
        full_name = CASE WHEN profiles.full_name IS NULL OR profiles.full_name = '' THEN EXCLUDED.full_name ELSE profiles.full_name END,
        updated_at = now();

  UPDATE public.invitations SET status = 'accepted', accepted_at = now() WHERE id = v_invitation.id;

  BEGIN
    INSERT INTO public.audit_log (id, action, actor, actor_id, actor_role, operation, target, category, severity, metadata, created_at)
    VALUES (
      gen_random_uuid(), 'invitation_accepted', 'user', v_user_id, 'user',
      'INSERT', v_invitation.company_id::text, 'membership', 'info',
      -- R-30: audit records BOTH the raw invitation role (for forensic
      -- traceability of "what did the inviter try to grant?") and the
      -- safe role that was actually applied.
      jsonb_build_object(
        'invitation_id', v_invitation.id,
        'raw_role',      v_invitation.role,
        'applied_role',  v_safe_role,
        'role_coerced',  v_invitation.role IS DISTINCT FROM v_safe_role,
        'email',         v_user_email
      ),
      now()
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', v_invitation.company_id,
    'role', v_safe_role,
    'invitation_id', v_invitation.id
  );
END;
$$;

COMMENT ON FUNCTION public.accept_invitation() IS
  'R-30 (2026-05-17): whitelists role to {employee, member}. Privileged '
  'role (admin/owner) cannot be granted via an invitation — use '
  'promote_user_to_admin instead. Audit row records both raw and applied '
  'role for forensic visibility.';
