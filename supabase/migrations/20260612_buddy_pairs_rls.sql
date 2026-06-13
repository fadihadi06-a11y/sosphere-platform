-- Durable buddy-system pairings (life-safety: the buddy is the closest responder
-- when a worker triggers SOS). A buddy_pairs table already existed but was
-- localStorage-only on the client and had no company-scoped RLS. This migration
-- guarantees the table + its company-scoped RLS, trigger and index exist so the
-- client can persist pairs to Supabase (synced across admins/devices).
create table if not exists public.buddy_pairs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  employee_a_id   text not null,
  employee_a_name text not null default '',
  employee_b_id   text not null,
  employee_b_name text not null default '',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists buddy_pairs_company_idx on public.buddy_pairs (company_id);

drop trigger if exists buddy_pairs_set_updated_at on public.buddy_pairs;
create trigger buddy_pairs_set_updated_at
  before update on public.buddy_pairs
  for each row execute function public.set_updated_at();

alter table public.buddy_pairs enable row level security;

drop policy if exists buddy_pairs_select on public.buddy_pairs;
create policy buddy_pairs_select on public.buddy_pairs for select using (
  company_id in (select company_id from public.employees where user_id = (select auth.uid()))
  or company_id in (select id from public.companies where owner_id = (select auth.uid()))
);

drop policy if exists buddy_pairs_insert on public.buddy_pairs;
create policy buddy_pairs_insert on public.buddy_pairs for insert with check (
  company_id in (select id from public.companies where owner_id = (select auth.uid()))
  or company_id in (select company_id from public.employees
       where user_id = (select auth.uid()) and role in ('admin','owner','manager','zone_admin'))
);

drop policy if exists buddy_pairs_update on public.buddy_pairs;
create policy buddy_pairs_update on public.buddy_pairs for update using (
  company_id in (select id from public.companies where owner_id = (select auth.uid()))
  or company_id in (select company_id from public.employees
       where user_id = (select auth.uid()) and role in ('admin','owner','manager','zone_admin'))
) with check (
  company_id in (select id from public.companies where owner_id = (select auth.uid()))
  or company_id in (select company_id from public.employees
       where user_id = (select auth.uid()) and role in ('admin','owner','manager','zone_admin'))
);

drop policy if exists buddy_pairs_delete on public.buddy_pairs;
create policy buddy_pairs_delete on public.buddy_pairs for delete using (
  company_id in (select id from public.companies where owner_id = (select auth.uid()))
  or company_id in (select company_id from public.employees
       where user_id = (select auth.uid()) and role in ('admin','owner','manager','zone_admin'))
);
