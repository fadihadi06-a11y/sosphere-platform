-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — R-19 Phase 2: subscription columns for missing event handlers
-- ─────────────────────────────────────────────────────────────────────────
-- THE GAP THIS CLOSES
--   The Stripe-webhook audit found 4 missing event handlers, three of which
--   need new state on the subscriptions row to surface signals to the UI:
--
--     #3 charge.dispute.created — flip status to 'canceled' immediately.
--        Uses existing `status` column; no new column needed.
--
--     #4 invoice.payment_action_required — EU 3DS challenge URL must be
--        surfaced to the user so they can complete authentication. Without
--        a column to store the hosted_invoice_url, the UI has nowhere to
--        link them and the renewal silently fails ~7 days later.
--
--     #5 customer.subscription.trial_will_end — Stripe sends this 3 days
--        before trial_ends_at. We need to mark that we showed the warning
--        so it doesn't re-fire on every webhook retry.
--
--     #6 customer.deleted — flip status to 'canceled' + null out the
--        stripe_customer_id so the next portal call doesn't 502 against
--        a deleted Stripe customer. No new column.
--
-- COLUMNS ADDED
--   requires_action_url       text         — Stripe hosted_invoice_url for 3DS challenges
--   trial_ending_notified_at  timestamptz  — when we surfaced the 3-day trial-end warning
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS requires_action_url      text,
  ADD COLUMN IF NOT EXISTS trial_ending_notified_at timestamptz;

COMMENT ON COLUMN public.subscriptions.requires_action_url IS
  'R-19 #4 (2026-05-15): Stripe hosted_invoice_url for EU 3DS (SCA) challenges. Set on invoice.payment_action_required, cleared on the next successful renewal (invoice.payment_succeeded). The UI surfaces a banner linking here so the user can complete authentication before Stripe gives up.';

COMMENT ON COLUMN public.subscriptions.trial_ending_notified_at IS
  'R-19 #5 (2026-05-15): when we surfaced the 3-day trial-end warning (from customer.subscription.trial_will_end event). NULL = warning not yet shown. Used to suppress duplicate notifications if Stripe re-fires the event.';

-- ── Index for fast lookups of "rows requiring user action" ────────────────
-- The mobile-app banner reads this to decide whether to show the 3DS prompt.
-- Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_subscriptions_requires_action
  ON public.subscriptions (user_id, company_id)
  WHERE requires_action_url IS NOT NULL;
