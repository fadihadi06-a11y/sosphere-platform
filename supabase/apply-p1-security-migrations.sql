-- ═══════════════════════════════════════════════════════════════════════
-- SOSphere Platform — P1 Security Migrations (2026-04-17)
-- Combines the 5 new security migrations into ONE idempotent script.
-- Safe to run multiple times (IF NOT EXISTS / OR REPLACE / DROP+CREATE).
-- ═══════════════════════════════════════════════════════════════════════
-- Copy-paste this ENTIRE file into Supabase Dashboard → SQL Editor and RUN.
-- Project: rtfhkbskgrasamhjraul (fadiiiiiii)

BEGIN;

-- ─── 1. idempotency_cache (B-C4 / B-H1) ───────────────────────────────
-- Request-scoped idempotency cache for edge functions.
CREATE TABLE IF NOT EXISTS public.idempotency_cache (
  function_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_body JSONB NOT NULL,
  response_status INT NOT NULL DEFAULT 200,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  PRIMARY KEY (function_name, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_cache_expires
  ON public.idempotency_cache(expires_at);

ALTER TABLE public.idempotency_cache ENABLE ROW LEVEL SECURITY;

-- Edge functions use service role; block all anon/authenticated direct access
DROP POLICY IF EXISTS "idempotency_cache_block_all" ON public.idempotency_cache;
CREATE POLICY "idempotency_cache_block_all" ON public.idempotency_cache
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);


-- ─── 2. biometric_verifications (S-H2) ────────────────────────────────
-- Server-side biometric verification timestamps (authoritative source).
CREATE TABLE IF NOT EXISTS public.biometric_verifications (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_method TEXT CHECK (last_verified_method IN ('webauthn','fingerprint','face','pin')),
  device_fingerprint_hash TEXT
);

ALTER TABLE public.biometric_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "biometric_verifications_self" ON public.biometric_verifications;
CREATE POLICY "biometric_verifications_self" ON public.biometric_verifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 3. profiles.onboarding_completed (S-H4) ──────────────────────────
-- Server-side onboarding completion flag (replaces client-mutable user_metadata).
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;


-- ─── 4. current_company_id() RPC (D-C1) ───────────────────────────────
-- Authoritative company_id resolver (replaces client-side JWT decode).
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM public.employees WHERE user_id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;


-- ─── 5. verify_permission(TEXT) RPC (S-C2) ────────────────────────────
-- Server-side permission verification for sensitive actions.
CREATE OR REPLACE FUNCTION public.verify_permission(p_permission TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_company_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  END IF;

  -- Try employee role first
  SELECT role, company_id INTO v_role, v_company_id
  FROM public.employees
  WHERE user_id = v_uid
  LIMIT 1;

  -- Fall back to company owner
  IF v_role IS NULL THEN
    SELECT 'company_owner', id INTO v_role, v_company_id
    FROM public.companies
    WHERE owner_id = v_uid
    LIMIT 1;
  END IF;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_role');
  END IF;

  -- Permission matrix: billing/audit/users/admin require elevated role
  IF p_permission LIKE 'billing:%'
     OR p_permission LIKE 'audit:%'
     OR p_permission LIKE 'users:%'
     OR p_permission LIKE 'admin:%' THEN
    IF v_role NOT IN ('company_owner','super_admin','main_admin','company_admin') THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'insufficient_role',
        'role', v_role
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'role', v_role,
    'company_id', v_company_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_permission(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_permission(TEXT) TO authenticated;


COMMIT;


-- ═══════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES — run these AFTER the above to confirm success
-- ═══════════════════════════════════════════════════════════════════════
-- Run these as a SEPARATE query in SQL Editor (after COMMIT above succeeds):
--
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('idempotency_cache', 'biometric_verifications')
--   ORDER BY table_name;
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'profiles'
--     AND column_name LIKE 'onboarding%';
--
-- SELECT proname FROM pg_proc
--   WHERE proname IN ('current_company_id', 'verify_permission');
--
-- Expected:
--   - 2 tables: biometric_verifications, idempotency_cache
--   - 2 columns: onboarding_completed, onboarding_completed_at
--   - 2 functions: current_company_id, verify_permission
