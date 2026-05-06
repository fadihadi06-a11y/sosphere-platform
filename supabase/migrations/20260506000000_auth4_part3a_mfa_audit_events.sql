-- ═══════════════════════════════════════════════════════════════════════
-- AUTH-4 Part 3a (#174) — MFA audit-log events
-- ═══════════════════════════════════════════════════════════════════════
-- The foundation_auth_audit_logging migration (20260502220922) ships
-- log_auth_event() with a whitelist of action names. Part 1 + Part 2 of
-- AUTH-4 added MFA enrollment, the login challenge gate, and recovery
-- codes — but none of those write audit_log entries yet, so SOC2 / ISO27001
-- forensic queries like "when did user X disable MFA?" or "did anyone use
-- a recovery code?" go unanswered.
--
-- This migration:
--   1. EXTENDS the log_auth_event whitelist with three new MFA actions:
--        - mfa_recovery_codes_generated  (info)
--        - mfa_recovery_used             (warning — escalation worthy)
--        - mfa_recovery_failed           (warning — possible attack)
--   2. ADDS server-side log_auth_event calls inside the recovery-code
--      RPCs (mfa_generate_recovery_codes, mfa_consume_recovery_code) so
--      we get a tamper-resistant trail without trusting the client.
--   3. Leaves mfa_enrolled / mfa_disabled / mfa_failed (already in
--      whitelist from Foundation Phase 4) to be called from the client
--      wrapper, since Supabase's auth.mfa_factors changes don't fire
--      the auth.users trigger.
--
-- INVARIANT: never log the plaintext recovery code or TOTP code.
-- We log: action, outcome, remaining count (after burn), reason on failure.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── (1) Extend the log_auth_event whitelist ──────────────────────────
CREATE OR REPLACE FUNCTION public.log_auth_event(
  p_action     text,
  p_outcome    text DEFAULT 'success',
  p_reason     text DEFAULT NULL,
  p_target_id  text DEFAULT NULL,
  p_metadata   jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_log_id   uuid := gen_random_uuid();
  v_severity text := CASE WHEN p_outcome = 'failure' THEN 'warning' ELSE 'info' END;
  v_meta     jsonb;
BEGIN
  IF p_action NOT IN (
    'signup_attempt','signup_failure',
    'login_attempt','login_failure',
    'logout','logout_all_devices',
    'password_reset_requested','password_reset_completed',
    'mfa_enrolled','mfa_disabled','mfa_failed',
    'mfa_recovery_codes_generated','mfa_recovery_used','mfa_recovery_failed',
    'email_change_requested','email_change_cancelled',
    'session_invalidated','suspicious_activity'
  ) THEN
    RAISE EXCEPTION 'Unknown auth action: %', p_action USING ERRCODE = '22023';
  END IF;

  -- Recovery use is treated as warning even on success — security teams
  -- want to see it because it's an unusual event (TOTP device lost or
  -- compromised).
  IF p_action = 'mfa_recovery_used' THEN
    v_severity := 'warning';
  END IF;

  v_meta := jsonb_build_object(
    'outcome',  p_outcome,
    'reason',   p_reason,
    'source',   'rpc'
  ) || COALESCE(p_metadata, '{}'::jsonb);

  -- Defensive PII / secret strip.
  v_meta := v_meta - 'password' - 'token' - 'refresh_token' - 'access_token'
                   - 'encrypted_password' - 'totp_code' - 'recovery_code'
                   - 'totp_secret';

  INSERT INTO public.audit_log (
    id, action, actor, actor_id, actor_role,
    target, target_id, category, severity,
    metadata, created_at
  )
  VALUES (
    v_log_id::text, p_action,
    'user', v_user_id::text, 'user',
    COALESCE(p_target_id, v_user_id::text),
    COALESCE(p_target_id, v_user_id::text),
    'auth', v_severity,
    v_meta, NOW()
  );

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_auth_event(text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_auth_event(text, text, text, text, jsonb) TO anon;

COMMENT ON FUNCTION public.log_auth_event IS
'FOUNDATION-1 Phase 4 + AUTH-4 P3a: client-initiated auth event logging. Whitelisted actions only. Strips password/token/totp/recovery secrets. SOC2/ISO27001/HIPAA-compliant.';

-- ─── (2a) mfa_generate_recovery_codes — log on success ────────────────
CREATE OR REPLACE FUNCTION public.mfa_generate_recovery_codes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_recent     int;
  v_codes      text[] := ARRAY[]::text[];
  v_code       text;
  v_alphabet   text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_i          int;
  v_j          int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.mfa_recovery_attempts
  WHERE user_id = v_user_id
    AND kind = 'generate'
    AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'Too many recovery-code generations. Try again in 1 hour.'
      USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.mfa_recovery_attempts(user_id, kind) VALUES (v_user_id, 'generate');

  FOR v_i IN 1..8 LOOP
    v_code := '';
    FOR v_j IN 1..8 LOOP
      v_code := v_code || substr(v_alphabet,
                                 (get_byte(gen_random_bytes(1), 0) % 32) + 1,
                                 1);
      IF v_j = 4 THEN v_code := v_code || '-'; END IF;
    END LOOP;
    v_codes := v_codes || v_code;
  END LOOP;

  DELETE FROM public.user_mfa_recovery_codes WHERE user_id = v_user_id;

  INSERT INTO public.user_mfa_recovery_codes(user_id, code_hash)
  SELECT v_user_id, encode(digest(c, 'sha256'), 'hex')
  FROM unnest(v_codes) AS c;

  -- AUDIT: tamper-resistant log entry. We never store the plaintext.
  PERFORM public.log_auth_event(
    'mfa_recovery_codes_generated',
    'success',
    NULL,
    NULL,
    jsonb_build_object('count', 8)
  );

  RETURN jsonb_build_object(
    'ok',    true,
    'codes', to_jsonb(v_codes)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mfa_generate_recovery_codes() FROM anon;
GRANT  EXECUTE ON FUNCTION public.mfa_generate_recovery_codes() TO authenticated;

-- ─── (2b) mfa_consume_recovery_code — log success and failure ─────────
CREATE OR REPLACE FUNCTION public.mfa_consume_recovery_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_normalized text;
  v_hash      text;
  v_recent    int;
  v_match_id  uuid;
  v_remaining int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.mfa_recovery_attempts
  WHERE user_id = v_user_id
    AND kind = 'consume_fail'
    AND created_at > now() - interval '1 hour';
  IF v_recent >= 10 THEN
    PERFORM public.log_auth_event(
      'mfa_recovery_failed',
      'failure',
      'rate_limited',
      NULL,
      jsonb_build_object('window_failures', v_recent)
    );
    RAISE EXCEPTION 'Too many failed recovery attempts. Try again in 1 hour.'
      USING ERRCODE = '54000';
  END IF;

  v_normalized := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9-]', '', 'g'));
  IF length(v_normalized) NOT IN (8, 9) THEN
    INSERT INTO public.mfa_recovery_attempts(user_id, kind) VALUES (v_user_id, 'consume_fail');
    PERFORM public.log_auth_event(
      'mfa_recovery_failed',
      'failure',
      'invalid_format',
      NULL,
      '{}'::jsonb
    );
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_format');
  END IF;
  IF length(v_normalized) = 8 THEN
    v_normalized := substr(v_normalized, 1, 4) || '-' || substr(v_normalized, 5, 4);
  END IF;

  v_hash := encode(digest(v_normalized, 'sha256'), 'hex');

  SELECT id INTO v_match_id
  FROM public.user_mfa_recovery_codes
  WHERE user_id = v_user_id
    AND code_hash = v_hash
    AND used_at IS NULL
  LIMIT 1;

  IF v_match_id IS NULL THEN
    INSERT INTO public.mfa_recovery_attempts(user_id, kind) VALUES (v_user_id, 'consume_fail');
    PERFORM public.log_auth_event(
      'mfa_recovery_failed',
      'failure',
      'invalid_or_used',
      NULL,
      '{}'::jsonb
    );
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  END IF;

  UPDATE public.user_mfa_recovery_codes
     SET used_at = now()
   WHERE id = v_match_id;

  SELECT count(*) INTO v_remaining
  FROM public.user_mfa_recovery_codes
  WHERE user_id = v_user_id AND used_at IS NULL;

  -- AUDIT: success path — security-relevant warning event.
  PERFORM public.log_auth_event(
    'mfa_recovery_used',
    'success',
    NULL,
    NULL,
    jsonb_build_object('remaining', v_remaining)
  );

  RETURN jsonb_build_object(
    'ok',        true,
    'remaining', v_remaining
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mfa_consume_recovery_code(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.mfa_consume_recovery_code(text) TO authenticated;
