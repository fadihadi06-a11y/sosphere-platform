-- ═══════════════════════════════════════════════════════════════════════════
-- W3 Consolidated CRITICAL+HIGH batch (2026-04-27)
-- Mirror of `w3_consolidated_critical_fixes_batch_2026_04_27` applied live.
-- ───────────────────────────────────────────────────────────────────────
-- Items closed in this migration:
--   #11 — companies.owner_id vs owner_user_id reconciliation trigger
--   #13 — is_neighbor_receive_granted privacy leak (added auth check)
--   #1  — server-side PIN verification (set_admin_pin + verify_admin_pin RPCs)
--
-- Item already-fine (verified, no work needed):
--   #18 — profiles.user_id index exists (idx_profiles_user)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── #11 owner_id reconciliation ───────────────────────────────
CREATE OR REPLACE FUNCTION public.companies_sync_owner_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.owner_id IS NULL AND NEW.owner_user_id IS NOT NULL THEN
    NEW.owner_id := NEW.owner_user_id;
  END IF;
  IF NEW.owner_user_id IS NULL AND NEW.owner_id IS NOT NULL THEN
    NEW.owner_user_id := NEW.owner_id;
  END IF;
  IF NEW.owner_id IS NOT NULL AND NEW.owner_user_id IS NOT NULL
     AND NEW.owner_id <> NEW.owner_user_id THEN
    RAISE EXCEPTION 'companies.owner_id and owner_user_id must match (% vs %)',
      NEW.owner_id, NEW.owner_user_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_companies_sync_owner ON public.companies;
CREATE TRIGGER trg_companies_sync_owner
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.companies_sync_owner_columns();

-- ─── #13 is_neighbor_receive_granted authz ────────────────────
CREATE OR REPLACE FUNCTION public.is_neighbor_receive_granted(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    NULL;  -- service_role (no JWT) → permitted
  ELSIF v_caller <> p_user_id THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE (p.id = p_user_id OR p.user_id = p_user_id)
      AND p.neighbor_receive_decision = 'granted'
      AND p.neighbor_receive_at IS NOT NULL
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.is_neighbor_receive_granted(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_neighbor_receive_granted(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_neighbor_receive_granted(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_neighbor_receive_granted(uuid) TO service_role;

-- ─── #1 server-side PIN verification ──────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_pin_hash text,
  ADD COLUMN IF NOT EXISTS admin_pin_salt text,
  ADD COLUMN IF NOT EXISTS admin_pin_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_pin_failed_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admin_pin_locked_until timestamptz;

COMMENT ON COLUMN public.profiles.admin_pin_hash IS
  '#1 (2026-04-27): SHA-256(pin || salt) for server-side admin PIN gate. Never client-trusted.';

CREATE OR REPLACE FUNCTION public.set_admin_pin(p_hash text, p_salt text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF p_hash IS NULL OR length(p_hash) < 32 OR length(p_hash) > 256 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_hash');
  END IF;
  IF p_salt IS NULL OR length(p_salt) < 16 OR length(p_salt) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_salt');
  END IF;
  INSERT INTO public.profiles (id, user_id) VALUES (v_uid, v_uid)
    ON CONFLICT (id) DO NOTHING;
  UPDATE public.profiles SET
    admin_pin_hash = p_hash,
    admin_pin_salt = p_salt,
    admin_pin_set_at = now(),
    admin_pin_failed_attempts = 0,
    admin_pin_locked_until = NULL
  WHERE id = v_uid OR user_id = v_uid;
  RETURN jsonb_build_object('ok', true, 'set_at', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_admin_pin(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_stored_hash text;
  v_failed int;
  v_locked_until timestamptz;
  MAX_ATTEMPTS constant int := 5;
  LOCK_DURATION constant interval := '5 minutes';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF p_hash IS NULL OR length(p_hash) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_hash');
  END IF;
  SELECT admin_pin_hash, admin_pin_failed_attempts, admin_pin_locked_until
    INTO v_stored_hash, v_failed, v_locked_until
  FROM public.profiles WHERE id = v_uid OR user_id = v_uid LIMIT 1;
  IF v_stored_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_pin_set');
  END IF;
  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'locked',
      'locked_until', v_locked_until,
      'remaining_seconds', EXTRACT(EPOCH FROM (v_locked_until - now()))::int
    );
  END IF;
  IF v_stored_hash = p_hash THEN
    UPDATE public.profiles SET
      admin_pin_failed_attempts = 0, admin_pin_locked_until = NULL
    WHERE id = v_uid OR user_id = v_uid;
    RETURN jsonb_build_object('ok', true, 'verified_at', now());
  ELSE
    v_failed := COALESCE(v_failed, 0) + 1;
    IF v_failed >= MAX_ATTEMPTS THEN
      UPDATE public.profiles SET
        admin_pin_failed_attempts = v_failed,
        admin_pin_locked_until = now() + LOCK_DURATION
      WHERE id = v_uid OR user_id = v_uid;
      RETURN jsonb_build_object('ok', false, 'reason', 'locked',
        'locked_until', now() + LOCK_DURATION, 'attempts', v_failed);
    ELSE
      UPDATE public.profiles SET admin_pin_failed_attempts = v_failed
        WHERE id = v_uid OR user_id = v_uid;
      RETURN jsonb_build_object('ok', false, 'reason', 'wrong_pin',
        'attempts_remaining', MAX_ATTEMPTS - v_failed);
    END IF;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_admin_pin(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_admin_pin(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_admin_pin(text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.verify_admin_pin(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_admin_pin(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.verify_admin_pin(text) TO authenticated;
