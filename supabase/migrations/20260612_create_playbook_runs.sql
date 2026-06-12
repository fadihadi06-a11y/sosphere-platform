-- Durable compliance record: every time an emergency playbook is run, who ran
-- it, when, and which steps were completed. Survives playbook deletion (no FK
-- on playbook_id; name/severity snapshotted). Additive only.
create table if not exists public.playbook_runs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  playbook_id     uuid,
  playbook_name   text not null,
  trigger_type    text,
  severity        text,
  run_by          uuid references auth.users(id) on delete set null,
  run_by_name     text not null default 'Admin',
  status          text not null default 'running'
                    check (status in ('running','completed','abandoned')),
  total_steps     integer not null default 0,
  completed_steps jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(completed_steps) = 'array'),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint playbook_runs_name_not_blank check (length(btrim(playbook_name)) > 0)
);

create index if not exists playbook_runs_company_started_idx
  on public.playbook_runs (company_id, started_at desc);

drop trigger if exists playbook_runs_set_updated_at on public.playbook_runs;
create trigger playbook_runs_set_updated_at
  before update on public.playbook_runs
  for each row execute function public.set_updated_at();

alter table public.playbook_runs enable row level security;

drop policy if exists playbook_runs_select on public.playbook_runs;
create policy playbook_runs_select on public.playbook_runs for select using (
  company_id in (select company_id from public.employees where user_id = (select auth.uid()))
  or company_id in (select id from public.companies where owner_id = (select auth.uid()))
);

drop policy if exists playbook_runs_insert on public.playbook_runs;
create policy playbook_runs_insert on public.playbook_runs for insert with check (
  company_id in (select company_id from public.employees where user_id = (select auth.uid()))
  or company_id in (select id from public.companies where owner_id = (select auth.uid()))
);

drop policy if exists playbook_runs_update on public.playbook_runs;
create policy playbook_runs_update on public.playbook_runs for update using (
  company_id in (select company_id from public.employees where user_id = (select auth.uid()))
  or company_id in (select id from public.companies where owner_id = (select auth.uid()))
) with check (
  company_id in (select company_id from public.employees where user_id = (select auth.uid()))
  or company_id in (select id from public.companies where owner_id = (select auth.uid()))
);
