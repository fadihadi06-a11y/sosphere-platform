-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: stripe_unmapped_events
-- Version:   20260425094500
-- Issue:     B-13 (master audit) — stripe-webhook silently dropped paying
--            customers' subscriptions when the priceId wasn't in env.
--            Returning 400 made Stripe stop retrying. Customer paid, our
--            DB never recorded it.
-- Fix:       Persist every UnmappedPriceError event into a forensic table,
--            return 5xx so Stripe keeps retrying for ~3 days. Once the
--            operator adds the missing STRIPE_PRICE_* env mapping the
--            next retry succeeds. The row stays in stripe_unmapped_events
--            as audit history regardless.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.stripe_unmapped_events (
  -- Stripe event id, e.g. evt_1OAbCdEfGhIjKlMn. Idempotent on retry.
  event_id          text primary key,
  event_type        text not null,
  -- Unrecognised priceId Stripe sent us. nullable if the price field
  -- was missing entirely.
  price_id          text,
  user_id           uuid,
  customer_id       text,
  -- Full raw event payload for forensic recovery.
  raw_event         jsonb not null,
  -- Operational metadata
  reason            text not null default 'unmapped_price',
  retry_count       int  not null default 1,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  -- Operator workflow
  resolved_at       timestamptz,
  resolved_by       uuid,
  resolution_note   text
);

create index if not exists stripe_unmapped_events_unresolved_idx
  on public.stripe_unmapped_events (resolved_at)
  where resolved_at is null;

create index if not exists stripe_unmapped_events_price_idx
  on public.stripe_unmapped_events (price_id)
  where price_id is not null;

-- ── RLS: locked down. Only service-role (edge functions) writes.
-- Owners + admins can SELECT via a SECURITY DEFINER helper if/when
-- a UI surface is added; for now the row is invisible to anon and
-- to authenticated users.
alter table public.stripe_unmapped_events enable row level security;

-- Default-deny for authenticated. The edge function uses the
-- service-role key which bypasses RLS, so writes still work.
drop policy if exists stripe_unmapped_events_block_authenticated
  on public.stripe_unmapped_events;
create policy stripe_unmapped_events_block_authenticated
  on public.stripe_unmapped_events
  for all to authenticated
  using (false) with check (false);

-- Default-deny for anon — extra defense in depth.
drop policy if exists stripe_unmapped_events_block_anon
  on public.stripe_unmapped_events;
create policy stripe_unmapped_events_block_anon
  on public.stripe_unmapped_events
  for all to anon
  using (false) with check (false);

comment on table public.stripe_unmapped_events is
  '2026-04-25 B-13 fix: forensic recovery store for Stripe webhook events that '
  'arrived with an unmapped priceId. Edge function persists the raw event then '
  'returns 5xx so Stripe retries. Once operator adds the env mapping, the next '
  'retry succeeds (or operator can manually replay). Service-role only.';
