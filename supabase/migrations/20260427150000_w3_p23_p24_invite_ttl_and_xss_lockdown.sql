-- ═══════════════════════════════════════════════════════════════════════════
-- #23 + #24 / W3 MEDIUM batch (2026-04-27)
-- Mirror of `w3_p23_p24_invite_ttl_and_xss_lockdown` + `w3_p24_xss_regex_fix_posix`.
--
-- #23 INVITE CODE TTL — enforce expiry server-side
-- #24 XSS LOCKDOWN — block script/iframe/javascript: in user-writable text
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.company_invites
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');
ALTER TABLE public.invitations
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');

CREATE OR REPLACE FUNCTION public.is_invite_valid(p_invite_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row record;
BEGIN
  IF p_invite_code IS NULL OR length(trim(p_invite_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_code');
  END IF;
  SELECT id, company_id, role, expires_at, revoked_at, max_uses, used_count
    INTO v_row FROM public.company_invites WHERE invite_code = p_invite_code LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'revoked');
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired',
      'expired_at', v_row.expires_at);
  END IF;
  IF v_row.max_uses IS NOT NULL AND coalesce(v_row.used_count, 0) >= v_row.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'fully_used',
      'max_uses', v_row.max_uses, 'used_count', v_row.used_count);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'company_id', v_row.company_id,
    'role', v_row.role,
    'expires_at', v_row.expires_at,
    'remaining_uses', CASE WHEN v_row.max_uses IS NULL THEN NULL
                           ELSE v_row.max_uses - coalesce(v_row.used_count, 0) END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.is_invite_valid(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_invite_valid(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_invite_valid(text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_invite_valid(text) TO service_role;

-- POSIX regex (PostgreSQL flavor): \s -> [[:space:]], \b -> \y
CREATE OR REPLACE FUNCTION public.contains_xss_pattern(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p IS NOT NULL AND (
    p ~* '<[[:space:]]*script\y'         OR
    p ~* '<[[:space:]]*iframe\y'         OR
    p ~* '<[[:space:]]*object\y'         OR
    p ~* '<[[:space:]]*embed\y'          OR
    p ~* 'javascript[[:space:]]*:'       OR
    p ~* 'vbscript[[:space:]]*:'         OR
    p ~* 'data[[:space:]]*:[[:space:]]*text/html' OR
    p ~* '\yon[a-z]+[[:space:]]*='       OR
    p ~* 'srcdoc[[:space:]]*='           OR
    p ~* '\yeval[[:space:]]*\('          OR
    p ~* '\ydocument\.cookie'            OR
    p ~* '\ydocument\.write'
  );
$function$;

CREATE OR REPLACE FUNCTION public.reject_xss_in_user_text()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_offender text := NULL;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    IF public.contains_xss_pattern(NEW.full_name) THEN v_offender := 'full_name'; END IF;
  ELSIF TG_TABLE_NAME = 'individual_users' THEN
    IF public.contains_xss_pattern(NEW.name) THEN v_offender := 'name';
    ELSIF NEW.emergency_contacts IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.emergency_contacts) AS x(elem)
        WHERE public.contains_xss_pattern(elem->>'name')
           OR public.contains_xss_pattern(elem->>'phone')
           OR public.contains_xss_pattern(elem->>'relation')
      ) THEN v_offender := 'emergency_contacts'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'employees' THEN
    IF public.contains_xss_pattern(NEW.name) THEN v_offender := 'name';
    ELSIF public.contains_xss_pattern(NEW.name_ar) THEN v_offender := 'name_ar';
    ELSIF public.contains_xss_pattern(NEW.department) THEN v_offender := 'department';
    ELSIF public.contains_xss_pattern(NEW.phone) THEN v_offender := 'phone';
    END IF;
  ELSIF TG_TABLE_NAME = 'invitations' THEN
    IF public.contains_xss_pattern(NEW.name) THEN v_offender := 'name';
    ELSIF public.contains_xss_pattern(NEW.email) THEN v_offender := 'email';
    ELSIF public.contains_xss_pattern(NEW.phone) THEN v_offender := 'phone';
    ELSIF public.contains_xss_pattern(NEW.department) THEN v_offender := 'department';
    ELSIF public.contains_xss_pattern(NEW.zone_name) THEN v_offender := 'zone_name';
    END IF;
  END IF;

  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION '[#24 XSS] Rejected suspicious pattern in column "%". Field cleared for safety.', v_offender
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_xss_profiles ON public.profiles;
CREATE TRIGGER trg_xss_profiles
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.reject_xss_in_user_text();

DROP TRIGGER IF EXISTS trg_xss_individual_users ON public.individual_users;
CREATE TRIGGER trg_xss_individual_users
  BEFORE INSERT OR UPDATE ON public.individual_users
  FOR EACH ROW EXECUTE FUNCTION public.reject_xss_in_user_text();

DROP TRIGGER IF EXISTS trg_xss_employees ON public.employees;
CREATE TRIGGER trg_xss_employees
  BEFORE INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.reject_xss_in_user_text();

DROP TRIGGER IF EXISTS trg_xss_invitations ON public.invitations;
CREATE TRIGGER trg_xss_invitations
  BEFORE INSERT OR UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.reject_xss_in_user_text();
