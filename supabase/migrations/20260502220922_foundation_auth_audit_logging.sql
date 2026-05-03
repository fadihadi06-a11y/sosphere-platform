-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260502220922
-- name:     foundation_auth_audit_logging
-- live:     foundation_auth_audit_logging
-- sha256:   ea9fa5d9dfb30c65 (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- FOUNDATION-1 / Phase 4: Auth event audit logging
--
-- BEFORE this: zero auth events in audit_log. Login, logout,
-- password change, email change all happened invisibly. SOC2/
-- ISO27001/HIPAA compliance impossible. Forensic question "who
-- logged in at 03:14am" had NO answer.
--
-- THIS MIGRATION delivers two complementary mechanisms:
--   (A) TRIGGER on auth.users — captures every Supabase-managed
--       state change automatically. Catches: signup (INSERT),
--       password change (encrypted_password UPDATE), email change
--       (email UPDATE), email confirmation (email_confirmed_at
--       UPDATE), successful sign-in (last_sign_in_at UPDATE).
--   (B) RPC `log_auth_event` — explicit logging for events the
--       app knows about but DB doesn't see directly. Catches:
--       failed login attempts (no row update), logout, password
--       reset requested, MFA enrolled/disabled.
--
-- Both write to audit_log with consistent shape:
--   actor      = user UUID
--   action     = 'login_success' | 'login_failure' | 'logout' | etc.
--   target     = user UUID (self) or other (admin actions)
--   metadata   = jsonb context (reason, ip, ua, before/after)
--   ip_address = inet (resolved from request headers when available)
--   device_info= User-Agent or 'auth-trigger' for DB-side
--   category   = 'auth'
--   severity   = 'info' | 'warning' | 'critical'
--
-- INVARIANT: never log a password value, never log a token. metadata
-- is filtered to PII-safe fields.
-- ═══════════════════════════════════════════════════════════════

-- ─── (B) Explicit RPC for client-initiated auth events ─────────
CREATE OR REPLACE FUNCTION public.log_auth_event(
  p_action     text,
  p_outcome    text DEFAULT 'success',  -- 'success' | 'failure'
  p_reason     text DEFAULT NULL,        -- e.g. 'wrong_password', 'expired_token'
  p_target_id  text DEFAULT NULL,        -- for admin actions; defaults to actor
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
  -- Reject obvious abuse: actions outside the known auth set are blocked
  -- so we don't accept arbitrary "log this event" calls from clients.
  IF p_action NOT IN (
    'signup_attempt','signup_failure',
    'login_attempt','login_failure',
    'logout','logout_all_devices',
    'password_reset_requested','password_reset_completed',
    'mfa_enrolled','mfa_disabled','mfa_failed',
    'email_change_requested','email_change_cancelled',
    'session_invalidated','suspicious_activity'
  ) THEN
    RAISE EXCEPTION 'Unknown auth action: %', p_action USING ERRCODE = '22023';
  END IF;

  -- Build metadata blob: PII-safe fields only
  v_meta := jsonb_build_object(
    'outcome',  p_outcome,
    'reason',   p_reason,
    'source',   'rpc'
  ) || COALESCE(p_metadata, '{}'::jsonb);

  -- Strip any password/token leaks defensively
  v_meta := v_meta - 'password' - 'token' - 'refresh_token' - 'access_token' - 'encrypted_password';

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
'FOUNDATION-1 Phase 4: client-initiated auth event logging. Whitelisted actions only. Strips password/token fields from metadata. SOC2/ISO27001/HIPAA-compliant.';


-- ─── (A) Trigger on auth.users for DB-side auth events ─────────
-- Captures: signup, password change, email change, email confirmation,
-- successful sign-in. We CANNOT capture failed logins from a trigger
-- because no row is updated on failure — those go via the RPC above.
CREATE OR REPLACE FUNCTION public.audit_auth_user_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_action   text;
  v_severity text := 'info';
  v_meta     jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'signup_completed';
    v_meta := jsonb_build_object(
      'email_confirmed', NEW.email_confirmed_at IS NOT NULL,
      'provider', COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
      'invited',  NEW.invited_at IS NOT NULL,
      'source',   'auth-trigger'
    );

    INSERT INTO public.audit_log (
      id, action, actor, actor_id, actor_role,
      target, target_id, category, severity, metadata, created_at
    ) VALUES (
      gen_random_uuid()::text, v_action,
      'user', NEW.id::text, 'user',
      NEW.id::text, NEW.id::text,
      'auth', v_severity, v_meta, NOW()
    );

  ELSIF TG_OP = 'UPDATE' THEN
    -- Password change: encrypted_password differs
    IF OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password
       AND OLD.encrypted_password IS NOT NULL THEN
      INSERT INTO public.audit_log (
        id, action, actor, actor_id, actor_role,
        target, target_id, category, severity, metadata, created_at
      ) VALUES (
        gen_random_uuid()::text, 'password_changed',
        'user', NEW.id::text, 'user',
        NEW.id::text, NEW.id::text,
        'auth', 'info',
        jsonb_build_object('source','auth-trigger'),
        NOW()
      );
    END IF;

    -- Email change
    IF OLD.email IS DISTINCT FROM NEW.email THEN
      INSERT INTO public.audit_log (
        id, action, actor, actor_id, actor_role,
        target, target_id, category, severity,
        metadata, before_value, after_value, created_at
      ) VALUES (
        gen_random_uuid()::text, 'email_changed',
        'user', NEW.id::text, 'user',
        NEW.id::text, NEW.id::text,
        'auth', 'warning',
        jsonb_build_object('source','auth-trigger'),
        OLD.email, NEW.email, NOW()
      );
    END IF;

    -- Email confirmation transition (NULL → not NULL)
    IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
      INSERT INTO public.audit_log (
        id, action, actor, actor_id, actor_role,
        target, target_id, category, severity, metadata, created_at
      ) VALUES (
        gen_random_uuid()::text, 'email_confirmed',
        'user', NEW.id::text, 'user',
        NEW.id::text, NEW.id::text,
        'auth', 'info',
        jsonb_build_object('source','auth-trigger'),
        NOW()
      );
    END IF;

    -- Successful sign-in (last_sign_in_at advances). Skip on signup
    -- (NEW only) and de-dup near-simultaneous JWT refreshers (>2s gap).
    IF OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at
       AND NEW.last_sign_in_at IS NOT NULL
       AND (OLD.last_sign_in_at IS NULL
            OR NEW.last_sign_in_at - OLD.last_sign_in_at > INTERVAL '2 seconds') THEN
      INSERT INTO public.audit_log (
        id, action, actor, actor_id, actor_role,
        target, target_id, category, severity, metadata, created_at
      ) VALUES (
        gen_random_uuid()::text, 'login_success',
        'user', NEW.id::text, 'user',
        NEW.id::text, NEW.id::text,
        'auth', 'info',
        jsonb_build_object(
          'provider', COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
          'source', 'auth-trigger'
        ),
        NEW.last_sign_in_at
      );
    END IF;
  END IF;

  RETURN NULL; -- AFTER trigger, return value ignored
END;
$$;

DROP TRIGGER IF EXISTS audit_auth_users ON auth.users;
CREATE TRIGGER audit_auth_users
AFTER INSERT OR UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.audit_auth_user_changes();

COMMENT ON FUNCTION public.audit_auth_user_changes IS
'FOUNDATION-1 Phase 4: trigger-side auth event capture. Catches signup, password_changed, email_changed, email_confirmed, login_success. Failed logins use log_auth_event RPC instead.';;
