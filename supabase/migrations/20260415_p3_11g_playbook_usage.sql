-- ═══════════════════════════════════════════════════════════════
-- SOSphere — P3-#11g Playbook Usage (emergency response)
-- ─────────────────────────────────────────────────────────────
-- Tracks per-company execution counts and last-used timestamps for
-- each emergency response playbook. We intentionally do NOT persist
-- full playbook definitions server-side — those ship with the
-- client (icon components, color tokens, localized strings) and
-- are the same across all companies. What changes per-company is
-- "how often does this team actually use this playbook" and "when
-- was the last time they ran it", which is exactly what the
-- compliance PDF's Response Playbook Summary section needs.
--
-- Previously, useCount and lastUsed lived only in React state, so
-- they were wiped on every reload and invisible to any other admin
-- — the "Response Playbook Summary" in compliance reports was
-- therefore always 100% mock. This migration gives the page a
-- durable counter and gives compliance-data-service a real field
-- to pull from.
--
-- Unique (company_id, playbook_id) so repeated runs hit the same
-- row and we use upsert + increment rather than accumulating
-- duplicate rows.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.playbook_usage (
  id                 text primary key,
  company_id         uuid not null references public.companies(id) on delete cascade,
  playbook_id        text not null,

  use_count          integer not null default 0,
  last_used_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (company_id, playbook_id)
);

create index if not exists playbook_usage_company_idx
  on public.playbook_usage(company_id);

-- ── Row Level Security ───────────────────────────────────────
alter table public.playbook_usage enable row level security;

drop policy if exists "playbook_usage_select" on public.playbook_usage;
create policy "playbook_usage_select" on public.playbook_usage
  for select using (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  );

drop policy if exists "playbook_usage_write" on public.playbook_usage;
create policy "playbook_usage_write" on public.playbook_usage
  for all using (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  ) with check (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  );

drop trigger if exists playbook_usage_touch_updated_at on public.playbook_usage;
create trigger playbook_usage_touch_updated_at
  before update on public.playbook_usage
  for each row execute function public.touch_updated_at();

-- ── Atomic increment RPC ─────────────────────────────────────
-- Avoids a read-modify-write race when two admins happen to run the
-- same playbook at the same moment. Called from the client via
-- `supabase.rpc('increment_playbook_use', {...})`.
create or replace function public.increment_playbook_use(
  p_company_id uuid,
  p_playbook_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_allowed boolean;
begin
  -- Enforce the same access boundary as the table RLS: the caller
  -- must belong to this company (employee or owner). Without this
  -- check, security definer would let any authenticated user bump
  -- any company's counter.
  select
    exists (select 1 from public.employees where user_id = auth.uid() and company_id = p_company_id)
    or exists (select 1 from public.companies where owner_id = auth.uid() and id = p_company_id)
  into caller_allowed;

  if not caller_allowed then
    raise exception 'not authorized for company %', p_company_id;
  end if;

  insert into public.playbook_usage(id, company_id, playbook_id, use_count, last_used_at)
  values (
    p_company_id::text || ':' || p_playbook_id,
    p_company_id,
    p_playbook_id,
    1,
    now()
  )
  on conflict (company_id, playbook_id) do update
    set use_count    = public.playbook_usage.use_count + 1,
        last_used_at = now();
end;
$$;
