-- ═══════════════════════════════════════════════════════════════════════════
-- R-43 (2026-05-18) — subscription columns for invoice.upcoming consumption
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS (LAUNCH_AUDIT.md cluster B)
--
--   SOSphere's Customer Rights screen advertises "7-day advance notice
--   of upcoming renewal charges". Stripe fires `invoice.upcoming` ~7
--   days before the period end with the next invoice's amount + due
--   date. The webhook had no handler for this event; the UI banner
--   had no data to surface.
--
--   Adds two columns + a partial index:
--     upcoming_renewal_at     timestamptz — Stripe's next_payment_attempt
--     upcoming_renewal_amount integer     — cents (Stripe convention)
--
--   These are SET by stripe-webhook on invoice.upcoming and CLEARED on
--   invoice.payment_succeeded (the renewal actually charged) or on
--   subscription.deleted (the customer cancelled before the renewal).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS upcoming_renewal_at     timestamptz,
  ADD COLUMN IF NOT EXISTS upcoming_renewal_amount integer,
  ADD COLUMN IF NOT EXISTS upcoming_renewal_currency text;

COMMENT ON COLUMN public.subscriptions.upcoming_renewal_at IS
  'R-43 (LAUNCH_AUDIT, 2026-05-18): next renewal charge timestamp from '
  'Stripe invoice.upcoming. Cleared on invoice.payment_succeeded.';

COMMENT ON COLUMN public.subscriptions.upcoming_renewal_amount IS
  'R-43: next renewal amount in cents (Stripe convention).';

COMMENT ON COLUMN public.subscriptions.upcoming_renewal_currency IS
  'R-43: ISO-4217 currency code (lowercase per Stripe convention).';

-- Partial index for the dashboard banner query "show me users whose
-- renewal is within the next 7 days". Tiny because most rows have NULL.
CREATE INDEX IF NOT EXISTS idx_subscriptions_upcoming_renewal
  ON public.subscriptions (upcoming_renewal_at)
  WHERE upcoming_renewal_at IS NOT NULL;
