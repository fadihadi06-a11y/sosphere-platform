-- BATCH 2 HOTFIX: lock_company_billing_columns role detection
-- Beehive Audit #7 finding — accept BOTH current_user=service_role AND
-- the JWT role claim, so both direct Postgres connections (admin tools)
-- and PostgREST/edge functions can mutate billing fields.

CREATE OR REPLACE FUNCTION public.lock_company_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_role text;
BEGIN
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;
  v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role = 'service_role' THEN
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
