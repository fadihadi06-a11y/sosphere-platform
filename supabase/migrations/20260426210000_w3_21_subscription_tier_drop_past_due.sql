-- ═══════════════════════════════════════════════════════════════════════════
-- W3-21 (Wave 3 red-team, 2026-04-26): drop `past_due` from active-tier set.
--
-- BUG: `get_my_subscription_tier()` returned the user's paid tier whenever
-- the subscription status was in ('active', 'trialing', 'past_due'). Stripe
-- moves a subscription to `past_due` when a card payment fails. Stripe
-- retries 4 times over up to 21 days. During that window the user kept
-- full Elite features for free.
--
-- IMPACT (paid B2B + civilian):
--   • Card declined → 21 days of "free" elite SOS fanout, TTS calls, conf bridge
--   • Twilio cost burn on owner's account during the dunning window
--   • No incentive to update card (service still works)
--
-- FIX: only ('active', 'trialing') count as active. `past_due` returns 'free'
-- so client renders the upgrade banner / dashboard prompts card update.
-- (When the card succeeds Stripe webhook flips status back to 'active'.)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_subscription_tier()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (SELECT tier FROM public.subscriptions
      WHERE user_id = auth.uid()
        -- W3-21: past_due removed. Only active and trialing grant tier.
        AND status IN ('active', 'trialing')
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1),
    'free'
  );
$function$;
