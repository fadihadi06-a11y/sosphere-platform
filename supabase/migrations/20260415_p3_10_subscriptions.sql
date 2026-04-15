-- ═══════════════════════════════════════════════════════════════
-- SOSphere — P3-#10 subscriptions table
-- ─────────────────────────────────────────────────────────────
-- The canonical source of truth for a user's paid tier. Populated
-- by the stripe-webhook edge function; read by resolveTier() in
-- sos-alert and by any client code that gates features by plan.
--
-- One row per user. The webhook does UPSERT on user_id so every
-- subscription lifecycle event (created / updated / deleted)
-- overwrites the same row — we don't keep a history table here
-- because Stripe itself is the audit log of record.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.subscriptions (
  user_id                 uuid primary key references auth.users(id) on delete cascade,

  -- Stripe identifiers. customer_id survives across subscriptions so
  -- we can reuse it when a user resubscribes; subscription_id churns.
  stripe_customer_id      text,
  stripe_subscription_id  text,
  stripe_price_id         text,

  -- Flattened plan view used by the app. `tier` maps to one of
  -- starter / growth / business / enterprise (or "free" if the
  -- user cancelled and the grace period expired).
  tier                    text not null default 'free',
  status                  text not null default 'inactive',
    -- Expected values: active, trialing, past_due, canceled, inactive
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Fast lookup from Stripe customer id → user id. The webhook uses
-- this on customer.subscription.updated/deleted events.
create index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions(stripe_customer_id);

-- Fast lookup from Stripe subscription id → row. Used by the
-- deleted / payment_failed handlers.
create index if not exists subscriptions_stripe_sub_idx
  on public.subscriptions(stripe_subscription_id);

-- ── Row Level Security ───────────────────────────────────────
-- Users can read their own subscription row. Only the service
-- role (used by edge functions) can write — clients must never
-- self-promote their tier.
alter table public.subscriptions enable row level security;

drop policy if exists "Users read own subscription" on public.subscriptions;
create policy "Users read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policies for authenticated users —
-- writes require the service role. This is intentional.
