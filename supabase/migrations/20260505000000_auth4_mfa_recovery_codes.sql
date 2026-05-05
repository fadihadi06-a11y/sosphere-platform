-- ═══════════════════════════════════════════════════════════════════════
-- AUTH-4 (#174) — MFA recovery codes
-- ═══════════════════════════════════════════════════════════════════════
-- Supabase Auth's built-in MFA (auth.mfa.enroll/verify) handles TOTP
-- factors but does NOT generate recovery codes. We add an app-managed
-- table + 2 RPCs so users with a valid TOTP factor can also be issued
-- 8 single-use recovery codes (matches Stripe / Linear / GitHub UX).
--
-- ─── Threat model ──────────────────────────────────────────────────────
-- • Codes are stored hashed (SHA-256) — even a DB dump can't reveal them.
-- • Plaintext is returned ONCE from mfa_generate_recovery_codes() and
--   never persisted. The UI must prompt the user to print/save them.
-- • mfa_consume_recovery_code() is callable only on a fully-elevated AAL2
--   session (i.e. the user is mid-MFA-challenge, NOT pre-login). This
--   prevents an unauthenticated attacker from brute-forcing codes.
--   Wait — that's wrong: by definition, recovery is used WHEN the user
--   has lost their TOTP device, so they cannot reach AAL2. Therefore the
--   RPC must accept an AAL1 session (post-password, pre-MFA) and the
--   client must call it via the same flow as MFA verification.
-- • Generation REGENERATES — calling it invalidates all prior codes.
--   That way a user discovering an old printout in the wild can scrub
--   it instantly.
-- • Per-user rate limit: 5 generation calls / hour, 10 consume failures
--   / hour. Enforced via a small audit table (mfa_recovery_attempts).
-- ───────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_mfa_recovery_codes (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- SHA-256 of the plaintext code (lowercase hex, 64 chars).
  code_hash    text          NOT NULL,
  used_at      timestamptz   NULL,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  -- Hash uniqueness scoped per-user prevents a freak collision from
  -- letting one user consume another's code (defense-in-depth — the
  -- RPC also filters by user_id).
  CONSTRAINT user_mfa_recovery_codes_user_hash_unique UNIQUE (user_id, code_hash)
);

CREATE INDEX IF NOT EXISTS user_mfa_recovery_codes_user_unused_idx
  ON public.user_mfa_recovery_codes (user_id)
  WHERE used_at IS NULL;

-- Force RLS so a misconfigured anon key can never read these.
ALTER TABLE public.user_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_mfa_recovery_codes FORCE ROW LEVEL SECURITY;

-- Owner-only read (debugging / compliance audits — usually never queried).
CREATE POLICY user_mfa_recovery_codes_self_select
  ON public.user_mfa_recovery_codes
  FOR SELECT
  USING (auth.uid() = user_id);

-- No direct INSERT / UPDATE / DELETE from clients — RPCs only.
REVOKE INSERT, UPDATE, DELETE ON public.user_mfa_recovery_codes FROM anon, authenticated;

-- ── Generation rate limiter (5 / hour) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfa_recovery_attempts (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text         NOT NULL CHECK (kind IN ('generate', 'consume_fail')),
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_recovery_attempts_user_kind_time_idx
  ON public.mfa_recovery_attempts (user_id, kind, created_at DESC);

ALTER TABLE public.mfa_recovery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_attempts FORCE ROW LEVEL SECURITY;
-- No SELECT policy — opaque to clients, RPCs read it via SECDEF.

-- ═══════════════════════════════════════════════════════════════════════
-- RPC 1: mfa_generate_recovery_codes()
-- Returns 8 plaintext codes ONCE. Wipes all previous codes for this user.
-- Format: AAAA-AAAA (8 chars, 32-symbol alphabet, ~40 bits entropy each).
-- ═══════════════════════════════════════════════════════════════════════
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
  v_alphabet   text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 chars, no I/O/0/1
  v_i          int;
  v_j          int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Rate limit: 5 generation calls / hour per user.
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

  -- Generate 8 codes; format AAAA-AAAA. Loop with extract+random per char.
  -- Using gen_random_bytes for crypto-strong entropy.
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

  -- Wipe previous codes (regeneration invalidates the old set).
  DELETE FROM public.user_mfa_recovery_codes WHERE user_id = v_user_id;

  -- Insert hashed codes.
  INSERT INTO public.user_mfa_recovery_codes(user_id, code_hash)
  SELECT v_user_id, encode(digest(c, 'sha256'), 'hex')
  FROM unnest(v_codes) AS c;

  RETURN jsonb_build_object(
    'ok',    true,
    'codes', to_jsonb(v_codes)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mfa_generate_recovery_codes() FROM anon;
GRANT  EXECUTE ON FUNCTION public.mfa_generate_recovery_codes() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- RPC 2: mfa_consume_recovery_code(p_code text)
-- Verifies and burns a single recovery code. Used during login when the
-- TOTP device is unavailable. Returns { ok, remaining }.
-- ═══════════════════════════════════════════════════════════════════════
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

  -- Rate limit: 10 failed consumes / hour per user.
  SELECT count(*) INTO v_recent
  FROM public.mfa_recovery_attempts
  WHERE user_id = v_user_id
    AND kind = 'consume_fail'
    AND created_at > now() - interval '1 hour';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'Too many failed recovery attempts. Try again in 1 hour.'
      USING ERRCODE = '54000';
  END IF;

  -- Normalize: uppercase, strip non-alphanumerics. Preserves original
  -- AAAA-AAAA format internally as we hash the original. Enforce length.
  v_normalized := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9-]', '', 'g'));
  IF length(v_normalized) NOT IN (8, 9) THEN
    INSERT INTO public.mfa_recovery_attempts(user_id, kind) VALUES (v_user_id, 'consume_fail');
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_format');
  END IF;
  -- Re-insert dash if user typed without it (canonical AAAA-AAAA hash).
  IF length(v_normalized) = 8 THEN
    v_normalized := substr(v_normalized, 1, 4) || '-' || substr(v_normalized, 5, 4);
  END IF;

  v_hash := encode(digest(v_normalized, 'sha256'), 'hex');

  -- Find unused matching code for this user.
  SELECT id INTO v_match_id
  FROM public.user_mfa_recovery_codes
  WHERE user_id = v_user_id
    AND code_hash = v_hash
    AND used_at IS NULL
  LIMIT 1;

  IF v_match_id IS NULL THEN
    INSERT INTO public.mfa_recovery_attempts(user_id, kind) VALUES (v_user_id, 'consume_fail');
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  END IF;

  -- Mark used.
  UPDATE public.user_mfa_recovery_codes
     SET used_at = now()
   WHERE id = v_match_id;

  SELECT count(*) INTO v_remaining
  FROM public.user_mfa_recovery_codes
  WHERE user_id = v_user_id AND used_at IS NULL;

  RETURN jsonb_build_object(
    'ok',        true,
    'remaining', v_remaining
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mfa_consume_recovery_code(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.mfa_consume_recovery_code(text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- RPC 3: mfa_recovery_status()
-- Returns { has_codes, remaining, last_generated_at }. Used by Settings
-- to show "8 unused codes" / "regenerate" prompts.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mfa_recovery_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_remaining  int;
  v_last_gen   timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('has_codes', false, 'remaining', 0);
  END IF;

  SELECT count(*) FILTER (WHERE used_at IS NULL),
         max(created_at)
    INTO v_remaining, v_last_gen
  FROM public.user_mfa_recovery_codes
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'has_codes',        v_remaining > 0,
    'remaining',        coalesce(v_remaining, 0),
    'last_generated_at', v_last_gen
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mfa_recovery_status() FROM anon;
GRANT  EXECUTE ON FUNCTION public.mfa_recovery_status() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- pgcrypto guard — digest() requires it. Skip if already enabled.
-- ═══════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
