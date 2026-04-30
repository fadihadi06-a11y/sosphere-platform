-- BATCH 3: register_company_full — atomic company registration
-- Audit Critical #13: makes 4-step wizard atomic. Existing flow may
-- continue to use create_company_v2 + 3 follow-up writes; new code
-- should call this single SECDEF instead.

CREATE OR REPLACE FUNCTION public.register_company_full(
  p_name              text,
  p_industry          text DEFAULT NULL,
  p_country           text DEFAULT 'SA',
  p_employee_estimate int  DEFAULT 25,
  p_invite_code       text DEFAULT NULL,
  p_zones             jsonb DEFAULT '[]'::jsonb,
  p_invitations       jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid;
  v_zone jsonb;
  v_zone_count int := 0;
  v_invite jsonb;
  v_invite_count int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  v_company := public.create_company_v2(p_name);
  UPDATE public.companies
  SET industry = p_industry, country = COALESCE(p_country, 'SA'),
      employee_estimate = COALESCE(p_employee_estimate, 25),
      invite_code = p_invite_code, has_zones = (jsonb_array_length(p_zones) > 0),
      is_active = true
  WHERE id = v_company;
  IF jsonb_array_length(p_zones) > 0 THEN
    FOR v_zone IN SELECT * FROM jsonb_array_elements(p_zones) LOOP
      INSERT INTO public.zones (company_id, name, lat, lng, radius_m, address)
      VALUES (v_company, v_zone->>'name',
        (v_zone->>'lat')::double precision, (v_zone->>'lng')::double precision,
        COALESCE((v_zone->>'radius_m')::int, 200), v_zone->>'address');
      v_zone_count := v_zone_count + 1;
    END LOOP;
  END IF;
  IF jsonb_array_length(p_invitations) > 0 THEN
    FOR v_invite IN SELECT * FROM jsonb_array_elements(p_invitations) LOOP
      BEGIN
        INSERT INTO public.invitations (company_id, email, role, status, invited_by, created_at)
        VALUES (v_company, lower(trim(v_invite->>'email')),
          COALESCE(v_invite->>'role', 'employee'), 'pending', v_user, now());
        v_invite_count := v_invite_count + 1;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('company_id', v_company,
    'zone_count', v_zone_count, 'invite_count', v_invite_count,
    'created_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_company_full(
  text, text, text, int, text, jsonb, jsonb
) TO authenticated;
