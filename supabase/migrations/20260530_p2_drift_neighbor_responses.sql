-- ═══════════════════════════════════════════════════════════════
-- P2 drift fix — neighbor_responses
-- ─────────────────────────────────────────────────────────────
-- Schema derived from neighbor-alert-service.ts:674. Records every
-- community responder's acknowledgement / decline / on-way reply
-- to a neighbor alert (request_id). Without this table the realtime
-- broadcast still fired but no durable record existed — so a
-- requester refreshing the page lost all prior responses.
--
-- Design notes:
--   • responder_user_id auto-populated via DEFAULT auth.uid() so the
--     INSERT call doesn't need to pass it (and so it can't be forged).
--   • Unique on (request_id, responder_user_id) prevents double-acks
--     when a responder taps "respond" twice (idempotency).
--   • RLS: responder writes their own row + reads it back; the
--     original requester also reads all responses to their request
--     via a SECURITY DEFINER RPC, NOT a direct cross-row policy.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.neighbor_responses (
  id                  uuid primary key default gen_random_uuid(),
  request_id          text not null,
  responder_user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status              text not null check (status in ('acknowledged','on_way','declined','arrived')),
  note                text check (length(note) <= 280),
  responded_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (request_id, responder_user_id)
);

create index if not exists neighbor_responses_request_idx
  on public.neighbor_responses(request_id, responded_at);

create index if not exists neighbor_responses_responder_idx
  on public.neighbor_responses(responder_user_id, responded_at desc);

alter table public.neighbor_responses enable row level security;

drop policy if exists "neighbor_responses_insert" on public.neighbor_responses;
create policy "neighbor_responses_insert" on public.neighbor_responses
  for insert with check (responder_user_id = (select auth.uid()));

drop policy if exists "neighbor_responses_select" on public.neighbor_responses;
create policy "neighbor_responses_select" on public.neighbor_responses
  for select using (responder_user_id = (select auth.uid()));

drop policy if exists "neighbor_responses_update" on public.neighbor_responses;
create policy "neighbor_responses_update" on public.neighbor_responses
  for update using (responder_user_id = (select auth.uid()))
  with check (responder_user_id = (select auth.uid()));

drop policy if exists "neighbor_responses_delete" on public.neighbor_responses;
create policy "neighbor_responses_delete" on public.neighbor_responses
  for delete using (responder_user_id = (select auth.uid()));
