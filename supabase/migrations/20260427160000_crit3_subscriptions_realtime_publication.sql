-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: subscriptions_realtime_publication_2026_04_27
-- Version:   20260427160000
-- Purpose:   CRIT-#3 — add public.subscriptions to the supabase_realtime
--            publication so the civilian app receives an instant tier
--            update push from the Stripe webhook (instead of waiting
--            up to 5 minutes for the polling interval).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Background:
--   The Stripe webhook (supabase/functions/stripe-webhook) upserts
--   public.subscriptions on checkout / renewal / cancellation. The
--   civilian client (src/app/components/api/subscription-realtime.ts)
--   subscribes via supabase.channel("sub-tier:<uid>").on("postgres_changes",
--   { table: "subscriptions", filter: "user_id=eq.<uid>" }, ...).
--
--   For that to fire, the table MUST be in the supabase_realtime
--   publication. Without this migration the channel is open but the
--   server never streams the row mutation — exactly the silent failure
--   that drove BLOCKER #3.
--
-- Safety:
--   - Idempotent: NO-OP if the table is already in the publication.
--   - Read-only side: Realtime respects RLS, so a user only sees rows
--     where the standard subscriptions RLS policy lets them read
--     (their own user_id). No new exposure surface.
--   - Reversible: drop with `alter publication supabase_realtime drop
--     table public.subscriptions;` if Realtime needs to be paused.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'subscriptions'
  ) then
    execute 'alter publication supabase_realtime add table public.subscriptions';
  end if;
end$$;

-- Verify the row is present after the DO block (will return one row).
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'subscriptions';
