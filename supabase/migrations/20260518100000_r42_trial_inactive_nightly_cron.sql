CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.sweep_expired_abandoned_trials()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count bigint := 0;
BEGIN
  WITH affected AS (
    UPDATE public.subscriptions
       SET status     = 'inactive',
           updated_at = now()
     WHERE status                 = 'trialing'
       AND trial_ends_at IS NOT NULL
       AND trial_ends_at          < now()
       AND stripe_subscription_id IS NULL
    RETURNING id, user_id, company_id, tier, trial_ends_at
  )
  SELECT count(*) INTO v_count FROM affected;
  BEGIN
    INSERT INTO public.audit_log (
      id, action, actor, actor_role, operation, target,
      category, severity, metadata, created_at
    ) VALUES (
      gen_random_uuid()::text, 'trial_expiry_sweep', 'system_billing_cron',
      'system', 'UPDATE', 'subscriptions', 'billing',
      CASE WHEN v_count > 0 THEN 'info' ELSE 'debug' END,
      jsonb_build_object('rows_flipped', v_count, 'ran_at', now(), 'source', 'R-42'),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'sweep_expired_abandoned_trials: audit write failed (%)', SQLERRM;
  END;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sweep_expired_abandoned_trials() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sweep_expired_abandoned_trials() FROM authenticated, anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sosphere_trial_expiry_sweep') THEN
    PERFORM cron.unschedule('sosphere_trial_expiry_sweep');
  END IF;
  PERFORM cron.schedule(
    'sosphere_trial_expiry_sweep', '30 2 * * *',
    'SELECT public.sweep_expired_abandoned_trials();'
  );
END $$;
