ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS upcoming_renewal_at     timestamptz,
  ADD COLUMN IF NOT EXISTS upcoming_renewal_amount integer,
  ADD COLUMN IF NOT EXISTS upcoming_renewal_currency text;

COMMENT ON COLUMN public.subscriptions.upcoming_renewal_at IS
  'R-43 (LAUNCH_AUDIT, 2026-05-18): next renewal charge timestamp from Stripe invoice.upcoming. Cleared on invoice.payment_succeeded.';
COMMENT ON COLUMN public.subscriptions.upcoming_renewal_amount IS
  'R-43: next renewal amount in cents (Stripe convention).';
COMMENT ON COLUMN public.subscriptions.upcoming_renewal_currency IS
  'R-43: ISO-4217 currency code (lowercase per Stripe convention).';

CREATE INDEX IF NOT EXISTS idx_subscriptions_upcoming_renewal
  ON public.subscriptions (upcoming_renewal_at)
  WHERE upcoming_renewal_at IS NOT NULL;
