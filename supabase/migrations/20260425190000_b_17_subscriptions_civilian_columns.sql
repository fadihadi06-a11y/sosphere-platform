-- ═══════════════════════════════════════════════════════════════════════════
-- B-17 (2026-04-25): the stripe-webhook upserts (user_id, stripe_customer_id,
-- stripe_price_id, tier, cancel_at_period_end, updated_at) onto the
-- `subscriptions` table — but those columns don't exist. Every paid civilian
-- event has been silently failing since the webhook was written. This
-- migration aligns the schema with the webhook contract:
--   • Adds user_id (uuid, FK auth.users) — civilian rows.
--   • Adds tier text (mirrors the legacy `plan` column for company rows).
--   • Adds stripe_customer_id, stripe_price_id, cancel_at_period_end, updated_at.
--   • Unique partial index on user_id (lets ON CONFLICT user_id work).
--   • Row CHECK: every row must have either company_id OR user_id (never both NULL).
--   • RLS policies: civilian can read their own row; only edge-function service
--     role writes (webhook holds the service-role key, bypassing RLS as it does today).
--
-- The `subscriptions` table is empty in production at the time of migration
-- (verified: SELECT count(*) returns 0), so no data backfill is required.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS user_id              uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tier                 text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id   text,
  ADD COLUMN IF NOT EXISTS stripe_price_id      text,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz DEFAULT now();

-- ON CONFLICT (user_id) used by stripe-webhook needs a non-partial
-- unique constraint, not a partial index. Postgres treats multiple
-- NULLs as distinct by default (NULLS DISTINCT) so a plain UNIQUE
-- still permits unlimited company rows (user_id IS NULL).
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_key;
ALTER TABLE public.subscriptions
  ADD  CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_subscription_idx
  ON public.subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_owner_present_chk;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_owner_present_chk
  CHECK (company_id IS NOT NULL OR user_id IS NOT NULL);

DROP POLICY IF EXISTS subscriptions_civilian_read_own ON public.subscriptions;
CREATE POLICY subscriptions_civilian_read_own
  ON public.subscriptions
  FOR SELECT
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_my_subscription_tier()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT tier FROM public.subscriptions
      WHERE user_id = auth.uid()
        AND status IN ('active', 'trialing', 'past_due')
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1),
    'free'
  );
$$;

REVOKE ALL ON FUNCTION public.get_my_subscription_tier() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_subscription_tier() TO authenticated;

COMMENT ON FUNCTION public.get_my_subscription_tier() IS
  'B-17: returns the active civilian Stripe tier for the authenticated user, or ''free''.';
