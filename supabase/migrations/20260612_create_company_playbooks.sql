-- Durable per-company emergency response protocols (playbook definitions).
-- Usage counts continue to live in playbook_usage; this table holds the
-- definitions so Create/Edit/Duplicate persist per company. Additive only.

create table if not exists public.company_playbooks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  template_key  text,
  name          text not null,
  description   text not null default '',
  trigger_type  text not null default 'Manual Trigger',
  severity      text not null default 'high'
                  check (severity in ('critical','high','medium','low')),
  auto_trigger  boolean not null default false,
  icon_name     text not null default 'Shield',
  icon_color    text not null default '#FF9500',
  steps         jsonb not null default '[]'::jsonb,
  is_default    boolean not null default false,
  sort_order    integer not null default 0,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint company_playbooks_name_not_blank check (length(btrim(name)) > 0),
  constraint company_playbooks_steps_is_array check (jsonb_typeof(steps) = 'array')
);

create unique index if not exists company_playbooks_default_uq
  on public.company_playbooks (company_id, template_key) where template_key is not null;
create index if not exists company_playbooks_company_idx
  on public.company_playbooks (company_id);

drop trigger if exists company_playbooks_set_updated_at on public.company_playbooks;
create trigger company_playbooks_set_updated_at
  before update on public.company_playbooks
  for each row execute function public.set_updated_at();

alter table public.company_playbooks enable row level security;

drop policy if exists company_playbooks_select on public.company_playbooks;
create policy company_playbooks_select on public.company_playbooks for select using (
  company_id in (select company_id from public.employees where user_id = (select auth.uid()))
  or company_id in (select id from public.companies where owner_id = (select auth.uid()))
);

drop policy if exists company_playbooks_insert on public.company_playbooks;
create policy company_playbooks_insert on public.company_playbooks for insert with check (
  company_id in (select id from public.companies where owner_id = (select auth.uid()))
  or company_id in (select company_id from public.employees
       where user_id = (select auth.uid()) and role in ('admin','owner','manager','zone_admin'))
);

drop policy if exists company_playbooks_update on public.company_playbooks;
create policy company_playbooks_update on public.company_playbooks for update using (
  company_id in (select id from public.companies where owner_id = (select auth.uid()))
  or company_id in (select company_id from public.employees
       where user_id = (select auth.uid()) and role in ('admin','owner','manager','zone_admin'))
) with check (
  company_id in (select id from public.companies where owner_id = (select auth.uid()))
  or company_id in (select company_id from public.employees
       where user_id = (select auth.uid()) and role in ('admin','owner','manager','zone_admin'))
);

drop policy if exists company_playbooks_delete on public.company_playbooks;
create policy company_playbooks_delete on public.company_playbooks for delete using (
  company_id in (select id from public.companies where owner_id = (select auth.uid()))
  or company_id in (select company_id from public.employees
       where user_id = (select auth.uid()) and role in ('admin','owner','manager','zone_admin'))
);
