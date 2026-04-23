-- ═════════════════════════════════════════════════════════════════════════════
-- 2026-04-23 — Dashboard dispatcher action support
-- ═════════════════════════════════════════════════════════════════════════════
-- Adds the schema bits needed by the dashboard-actions edge function so
-- dispatchers can actually: resolve, acknowledge, assign, and message an
-- emergency. Previously those UI buttons were `[SUPABASE_READY]` stubs.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── sos_sessions: add fields for dispatcher state ───────────────────────────
alter table if exists public.sos_sessions
  add column if not exists acknowledged_by uuid references auth.users(id),
  add column if not exists acknowledged_at timestamptz,
  add column if not exists assigned_to uuid references auth.users(id),
  add column if not exists assigned_by uuid references auth.users(id),
  add column if not exists assigned_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

-- ─── sos_messages: bidirectional channel between dispatcher and user ─────────
create table if not exists public.sos_messages (
  id uuid primary key default gen_random_uuid(),
  emergency_id text not null,
  from_user_id uuid not null references auth.users(id),
  from_name text,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists sos_messages_emergency_idx
  on public.sos_messages (emergency_id, created_at desc);

alter table public.sos_messages enable row level security;

-- Read: the original SOS user OR anyone in the same company can see messages
drop policy if exists "sos_messages_read_user_or_company" on public.sos_messages;
create policy "sos_messages_read_user_or_company"
  on public.sos_messages for select
  using (
    exists (
      select 1 from public.sos_sessions s
      where s.emergency_id = sos_messages.emergency_id
        and (
          s.user_id = auth.uid()
          or s.company_id in (
            select company_id from public.employees where user_id = auth.uid()
          )
          or s.company_id in (
            select id from public.companies where owner_id = auth.uid()
          )
        )
    )
  );

-- Insert: only via service role (edge function dashboard-actions)
drop policy if exists "sos_messages_insert_blocked" on public.sos_messages;
create policy "sos_messages_insert_blocked"
  on public.sos_messages for insert with check (false);

-- Messages are immutable (audit trail)
drop policy if exists "sos_messages_no_update" on public.sos_messages;
create policy "sos_messages_no_update"
  on public.sos_messages for update using (false);

drop policy if exists "sos_messages_no_delete" on public.sos_messages;
create policy "sos_messages_no_delete"
  on public.sos_messages for delete using (false);

comment on table public.sos_messages is
  '2026-04-23: dispatcher → user messaging during active SOS. Append-only; writes via dashboard-actions edge function only.';
