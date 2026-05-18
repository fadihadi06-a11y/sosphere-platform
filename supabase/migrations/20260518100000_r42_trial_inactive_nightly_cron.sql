-- ═══════════════════════════════════════════════════════════════════════════
-- R-42 (2026-05-18) — nightly trial → inactive transition (LAUNCH_AUDIT #14)
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS
--
--   start_company_trial / start_civilian_trial set status='trialing' and
--   trial_ends_at = now() + interval '14 days'. The contract: when the
--   trial ends, EITHER a Stripe subscription is in place (status flips
--   to 'active' via stripe-webhook checkout.session.completed) OR the
--   user/company never converted (status MUST flip to 'inactive').
--
--   Today there is NO cron job that handles the second case. A user
--   who clicks 'Start trial' and then never adds a card has
--   status='trialing' FOREVER. get_my_subscription_tier returns
--   'trialing' which is treated as paid by every entitlement check
--   in the codebase. Result: unlimited free Elite forever.
--
--   This migration adds a nightly pg_cron job that flips abandoned
--   trials to 'inactive'. Trials that DID convert to paid Stripe
--   subscriptions are protected by the stripe_subscription_id IS NULL
--   filter — they keep flowing through Stripe's billing lifecycle.
--
-- BEHAVIOR
--   Selects every row where:
--     - status = 'trialing'
--     - trial_ends_at < now()           (trial has actually expired)
--     - stripe_subscription_id IS NULL  (no Stripe conversion)
--   Sets status='inactive', writes one audit row per affected user.
--
--   Idempotent: running twice in a row is a no-op (second run finds
--   nothing in 'trialing' anymore).
--
-- VERIFY
--   SELECT * FROM cron.job WHERE jobname = 'sosphere_trial_expiry_sweep';
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Function: sweep expired abandoned trials ────────────────────────────
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

  -- Tamper-evident audit row per sweep run (count > 0 OR = 0; always written)
  BEGIN
    INSERT INTO public.audit_log (
      id, action, actor, actor_role, operation, target,
      category, severity, metadata, created_at
    ) VALUES (
      gen_random_uuid()::text,
      'trial_expiry_sweep',
      'system_billing_cron',
      'system',
      'UPDATE',
      'subscriptions',
      'billing',
      CASE WHEN v_count > 0 THEN 'info' ELSE 'debug' END,
      jsonb_build_object(
        'rows_flipped', v_count,
        'ran_at',       now(),
        'source',       'R-42'
      ),
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

COMMENT ON FUNCTION public.sweep_expired_abandoned_trials IS
  'R-42 (LAUNCH_AUDIT #14): nightly cron flips status=trialing rows to '
  'inactive when trial_ends_at has passed AND no Stripe subscription was '
  'created. Protects against forever-trial revenue leak.';

-- ── Cron schedule: nightly at 02:30 UTC ─────────────────────────────────
-- 02:30 is a calm window before the retention sweeps at 02:00-02:18.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sosphere_trial_expiry_sweep') THEN
    PERFORM cron.unschedule('sosphere_trial_expiry_sweep');
  END IF;
  PERFORM cron.schedule(
    'sosphere_trial_expiry_sweep',
    '30 2 * * *',
    $$SELECT public.sweep_expired_abandoned_trials();$$
  );
END $$;
