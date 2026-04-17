-- S-C2: server-side permission verification
CREATE OR REPLACE FUNCTION public.verify_permission(p_permission TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_company_id UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('allowed', false, 'reason', 'unauthenticated'); END IF;
  SELECT role, company_id INTO v_role, v_company_id
  FROM public.employees WHERE user_id = v_uid LIMIT 1;
  IF v_role IS NULL THEN
    SELECT 'company_owner', id INTO v_role, v_company_id
    FROM public.companies WHERE owner_id = v_uid LIMIT 1;
  END IF;
  IF v_role IS NULL THEN RETURN jsonb_build_object('allowed', false, 'reason', 'no_role'); END IF;
  -- Simple matrix: owner/admin can do billing:*, audit:*, users:*; all authenticated can do dashboard:view
  IF p_permission LIKE 'billing:%' OR p_permission LIKE 'audit:%' OR p_permission LIKE 'users:%' OR p_permission LIKE 'admin:%' THEN
    IF v_role NOT IN ('company_owner','super_admin','main_admin','company_admin') THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'insufficient_role', 'role', v_role);
    END IF;
  END IF;
  RETURN jsonb_build_object('allowed', true, 'role', v_role, 'company_id', v_company_id);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_permission(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_permission(TEXT) TO authenticated;
