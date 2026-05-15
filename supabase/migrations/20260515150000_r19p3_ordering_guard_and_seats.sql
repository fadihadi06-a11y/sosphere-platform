-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — R-19 Phase 3: ordering guard + seat quantity tracking
-- ─────────────────────────────────────────────────────────────────────────
-- COLUMNS ADDED
--
--   seat_quantity int — Stripe subscription item quantity (sub.items.data[0].quantity).
--     Stored for forensic visibility + future feature-gate updates. Mirrors what
--     the customer is actually PAYING for, vs the plan-derived default seat limit.
--     For pre-launch, runtime enforcement still uses _plan_max_employees(plan).
--
--   last_stripe_event_at timestamptz — when the most recent Stripe event we
--     applied to this row was created (event.created from the webhook payload).
--     Used as an ordering guard in the webhook: if a later-arriving event has
--     an OLDER event.created, we SKIP the upsert.
--
-- FINDINGS THIS PHASE FIXES
--
--   #7 HIGH — customer.subscription.updated did not propagate seat changes.
--      Owner buys 10 seats → uses Billing Portal to bump to 50 → Stripe charges
--      for 50 but our row stays at the plan-derived 25-seat default. Customer
--      is silently shortchanged. Now we mirror sub.items.data[0].quantity into
--      seat_quantity on every event so the forensic record is correct.
--
--   #10 MEDIUM — out-of-order updates overwrote newer state.
--      Owner upgrades (event A) then immediately downgrades (event B). Stripe
--      webhook ordering is at-least-once and UNORDERED. If B arrives first
--      then A, our DB ends up on the upgrade plan even though the customer
--      is actually on the downgrade. Now: webhook reads existing
--      last_stripe_event_at, skips upsert if incoming event.created is older.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS seat_quantity        int,
  ADD COLUMN IF NOT EXISTS last_stripe_event_at timestamptz;

COMMENT ON COLUMN public.subscriptions.seat_quantity IS
  'R-19 #7 (2026-05-15): Stripe subscription item quantity. Customer actual paid seat count, vs plan-derived _plan_max_employees default. Pre-launch: stored only (forensic). Post-launch: runtime enforcement to be updated to prefer this value when set.';

COMMENT ON COLUMN public.subscriptions.last_stripe_event_at IS
  'R-19 #10 (2026-05-15): event.created of the most recent Stripe webhook we applied to this row. Used as ordering guard in the webhook: a webhook with older event.created is skipped to prevent stale-write-over-new on out-of-order delivery.';
