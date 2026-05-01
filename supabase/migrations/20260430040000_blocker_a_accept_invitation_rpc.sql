-- BLOCKER A FIX: Invitation -> Membership transition
-- E2E audit found: invited employees set password but never get linked
-- to company. Orphan accounts. accept_invitation() RPC bridges this gap.

CREATE OR REPLACE FUNCTION public.accept_invitation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  INSERT INTO public.company_memberships (company_id, user_id, role, active, created_at)
  VALUES (v_invitation.company_id, v_user_id, COALESCE(v_invitation.role, 'employee'), true, now())
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET active = true, role = EXCLUDED.role;
  INSERT INTO public.employees (
    company_id, user_id, role, status, name, phone, department, verified, created_at, updated_at
  ) VALUES (
    v_invitation.company_id, v_user_id,
    COALESCE(v_invitation.role_type, v_invitation.role, 'employee'),
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
      jsonb_build_object('invitation_id', v_invitation.id, 'role', COALESCE(v_invitation.role, 'employee'), 'email', v_user_email),
      now()
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true, 'company_id', v_invitation.company_id, 'role', COALESCE(v_invitation.role, 'employee'), 'invitation_id', v_invitation.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation() TO authenticated;
