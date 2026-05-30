-- ═══════════════════════════════════════════════════════════════
-- P2 drift fix — call_events
-- ─────────────────────────────────────────────────────────────
-- Schema derived from supabase/functions/twilio-status/index.ts:399
-- (logCallEvent). Operational telemetry: every Twilio call/SMS
-- lifecycle event (ringing → answered → completed → no-answer etc).
-- Used by ops for SLA reports + Twilio dispute resolution.
--
-- RLS: service_role only (deny-all-clients). Written only by the
-- twilio-status edge function (which holds the service role key).
-- Clients never read this directly — surfaced via aggregated views.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.call_events (
  id            text primary key,
  call_id       text not null,
  status        text not null,
  call_sid      text,
  from_number   text,
  to_number     text,
  duration      integer,
  answered_by   text,
  raw_data      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists call_events_call_id_idx
  on public.call_events(call_id, created_at);

create index if not exists call_events_call_sid_idx
  on public.call_events(call_sid) where call_sid is not null;

create index if not exists call_events_created_at_idx
  on public.call_events(created_at);

alter table public.call_events enable row level security;

drop policy if exists "call_events_deny_anon" on public.call_events;
create policy "call_events_deny_anon" on public.call_events
  for all to anon using (false) with check (false);

drop policy if exists "call_events_deny_authenticated" on public.call_events;
create policy "call_events_deny_authenticated" on public.call_events
  for all to authenticated using (false) with check (false);

comment on table public.call_events is
  '2026-05-30 P2 drift fix: service-role only (deny-all-clients). Twilio call lifecycle telemetry. Written by twilio-status edge function. Surfaced to clients via aggregated views/RPCs only.';
