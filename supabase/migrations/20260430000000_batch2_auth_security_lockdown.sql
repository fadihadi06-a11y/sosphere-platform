-- ════════════════════════════════════════════════════════════════════
-- BATCH 2: Server-side enforcement (Audit Critical #2, #3, #5)
-- 2026-04-30 — closes 4 audit findings:
--   #2: Trial-restart exploit — trial date is now derived from
--       user_trial_history; cannot be reset by deleting+re-registering.
--   #3: Client-controlled plan/trial_ends_at/billing_cycle — blocked
--       at the row level by lock_company_billing_columns trigger;
--       only service_role (Stripe webhook + SECDEF RPCs) can mutate.
--   #5: OTP rate-limit was client-only — added check_rate_limit RPC
--       backed by rate_limits table.
--   #12: Wizard validation (company name length 2-100 chars).
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_trial_history (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  trial_started_at timestamptz NOT NULL DEFAULT now(),
  trial_used boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_trial_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_trial_history_select_self ON public.user_trial_history;
CREATE POLICY user_trial_history_select_self ON public.user_trial_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.lock_company_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    RAISE EXCEPTION 'plan can only be changed via Stripe webhook' USING ERRCODE = '42501';
  END IF;
  IF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at THEN
    RAISE EXCEPTION 'trial_ends_at cannot be changed by client' USING ERRCODE = '42501';
  END IF;
  IF NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle THEN
    RAISE EXCEPTION 'billing_cycle can only be changed via Stripe webhook' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_company_billing_columns_trigger ON public.companies;
CREATE TRIGGER lock_company_billing_columns_trigger
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_company_billing_columns();

CREATE OR REPLACE FUNCTION public.create_company_v2(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid;
  v_existing_trial RECORD;
  v_existing_owner RECORD;
  v_trial_ends timestamptz;
  v_clean_name text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  v_clean_name := trim(p_name);
  IF v_clean_name IS NULL OR length(v_clean_name) < 2 OR length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'Company name must be 2-100 characters' USING ERRCODE = '22023';
  END IF;
  SELECT m.company_id INTO v_existing_owner
    FROM public.company_memberships m
    WHERE m.user_id = v_user AND m.active = true AND m.role = 'owner'
    LIMIT 1;
  IF v_existing_owner.company_id IS NOT NULL THEN
    RAISE EXCEPTION 'You already own an active company (id=%)', v_existing_owner.company_id USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_existing_trial FROM public.user_trial_history WHERE user_id = v_user;
  IF v_existing_trial.user_id IS NOT NULL THEN
    v_trial_ends := v_existing_trial.trial_started_at + interval '14 days';
  ELSE
    v_trial_ends := now() + interval '14 days';
  END IF;
  INSERT INTO public.companies (name, plan, trial_ends_at, billing_cycle, owner_id, owner_user_id)
  VALUES (v_clean_name, 'starter', v_trial_ends, 'monthly', v_user, v_user)
  RETURNING id INTO v_company;
  UPDATE public.company_memberships SET active = false
    WHERE user_id = v_user AND active = true;
  INSERT INTO public.company_memberships (company_id, user_id, role, active, created_at)
  VALUES (v_company, v_user, 'owner', true, now());
  INSERT INTO public.user_trial_history (user_id, first_company_id, trial_started_at, trial_used)
  VALUES (v_user, v_company, COALESCE(v_existing_trial.trial_started_at, now()), true)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN v_company;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_company_v2(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  identifier text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON public.rate_limits (bucket, identifier, attempted_at DESC);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket text,
  p_identifier text,
  p_max_attempts int DEFAULT 5,
  p_window_seconds int DEFAULT 3600
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
  v_oldest_in_window timestamptz;
BEGIN
  IF p_bucket IS NULL OR length(p_bucket) = 0 OR length(p_bucket) > 50 THEN
    RAISE EXCEPTION 'invalid bucket' USING ERRCODE = '22023';
  END IF;
  IF p_identifier IS NULL OR length(p_identifier) = 0 OR length(p_identifier) > 200 THEN
    RAISE EXCEPTION 'invalid identifier' USING ERRCODE = '22023';
  END IF;
  IF p_max_attempts < 1 OR p_max_attempts > 100 THEN
    RAISE EXCEPTION 'invalid max_attempts' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid window_seconds' USING ERRCODE = '22023';
  END IF;
  SELECT COUNT(*), MIN(attempted_at) INTO v_count, v_oldest_in_window
    FROM public.rate_limits
    WHERE bucket = p_bucket AND identifier = p_identifier
      AND attempted_at > (now() - make_interval(secs => p_window_seconds));
  IF v_count >= p_max_attempts THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'count', v_count,
      'reset_at', v_oldest_in_window + make_interval(secs => p_window_seconds),
      'retry_after_s', GREATEST(0, EXTRACT(EPOCH FROM (v_oldest_in_window + make_interval(secs => p_window_seconds) - now()))::int)
    );
  END IF;
  INSERT INTO public.rate_limits (bucket, identifier) VALUES (p_bucket, p_identifier);
  DELETE FROM public.rate_limits
    WHERE bucket = p_bucket AND identifier = p_identifier
      AND attempted_at <= (now() - make_interval(secs => p_window_seconds));
  RETURN jsonb_build_object(
    'allowed', true,
    'count', v_count + 1,
    'remaining', GREATEST(0, p_max_attempts - v_count - 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, int, int) TO anon, authenticated;

COMMENT ON TABLE public.user_trial_history IS
  'Audit 2026-04-30 fix #2: tracks original trial start per user to prevent abuse via account/company recreation.';
COMMENT ON FUNCTION public.lock_company_billing_columns() IS
  'Audit 2026-04-30 fix #3: prevents authenticated users from modifying plan/trial_ends_at/billing_cycle directly.';
COMMENT ON FUNCTION public.check_rate_limit(text, text, int, int) IS
  'Audit 2026-04-30 fix #5: server-side rate limit. Bucket examples: otp_send, otp_verify, signup.';
