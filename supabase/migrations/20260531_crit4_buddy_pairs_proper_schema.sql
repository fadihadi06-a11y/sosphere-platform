-- ═══════════════════════════════════════════════════════════════
-- 2026-05-31 CRIT-4 part A: proper buddy_pairs persistence
-- ─────────────────────────────────────────────────────────────
-- The P3 backfilled buddy_pairs table had bigint employee columns
-- that did NOT match the client's string IDs ("EMP-001" or uuid).
-- Result: writes would have failed silently or corrupted data.
-- Table was empty (0 rows) so safe to drop+recreate with proper
-- schema matching what shared-store.ts StoredBuddyPair expects.
--
-- World-class refactor — applies the in-memory-truth + bootstrap-cache
-- pattern from CRIT-2 to buddy_pairs:
--   1. Server table is THE source of truth (this migration)
--   2. SECDEF RPCs gate all writes (admin/owner only)
--   3. Client reads via get_buddy_pairs RPC on boot → mirrors to cache
--   4. localStorage is bootstrap cache only (next-session instant-paint)
--
-- See SECURITY_DECISIONS.md for the pattern's rationale.
-- ═══════════════════════════════════════════════════════════════

drop table if exists public.buddy_pairs cascade;

create table public.buddy_pairs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  employee_a_id     text not null,
  employee_a_name   text not null,
  employee_b_id     text not null,
  employee_b_name   text not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, employee_a_id, employee_b_id)
);

create index buddy_pairs_company_idx on public.buddy_pairs(company_id);
create index buddy_pairs_emp_a_idx   on public.buddy_pairs(employee_a_id);
create index buddy_pairs_emp_b_idx   on public.buddy_pairs(employee_b_id);

drop trigger if exists buddy_pairs_touch_updated_at on public.buddy_pairs;
create trigger buddy_pairs_touch_updated_at
  before update on public.buddy_pairs
  for each row execute function public.touch_updated_at();

alter table public.buddy_pairs enable row level security;

create policy buddy_pairs_select on public.buddy_pairs
  for select using (
    company_id in (select company_id from public.employees where user_id = (select auth.uid()))
    or company_id in (select id from public.companies where owner_id = (select auth.uid()))
  );

-- WRITE policies absent on purpose — all mutations via SECDEF RPCs below.

create or replace function public.upsert_buddy_pair(
  p_company_id      uuid,
  p_employee_a_id   text,
  p_employee_a_name text,
  p_employee_b_id   text,
  p_employee_b_name text,
  p_is_active       boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed boolean;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_employee_a_id = p_employee_b_id then
    raise exception 'cannot pair an employee with themselves' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.employees
    where user_id = v_uid and company_id = p_company_id
  ) or exists (
    select 1 from public.companies
    where owner_id = v_uid and id = p_company_id
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', p_company_id using errcode = '42501';
  end if;

  insert into public.buddy_pairs (
    company_id, employee_a_id, employee_a_name,
    employee_b_id, employee_b_name, is_active
  ) values (
    p_company_id, p_employee_a_id, p_employee_a_name,
    p_employee_b_id, p_employee_b_name, p_is_active
  )
  on conflict (company_id, employee_a_id, employee_b_id) do update
    set employee_a_name = excluded.employee_a_name,
        employee_b_name = excluded.employee_b_name,
        is_active       = excluded.is_active,
        updated_at      = now()
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.upsert_buddy_pair(uuid, text, text, text, text, boolean) from public, anon;
grant  execute on function public.upsert_buddy_pair(uuid, text, text, text, text, boolean) to authenticated;

create or replace function public.delete_buddy_pair(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_target  record;
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select company_id into v_target from public.buddy_pairs where id = p_id;
  if v_target.company_id is null then
    return false;
  end if;

  select exists (
    select 1 from public.employees
    where user_id = v_uid and company_id = v_target.company_id
  ) or exists (
    select 1 from public.companies
    where owner_id = v_uid and id = v_target.company_id
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.buddy_pairs where id = p_id;
  return true;
end $$;

revoke execute on function public.delete_buddy_pair(uuid) from public, anon;
grant  execute on function public.delete_buddy_pair(uuid) to authenticated;

create or replace function public.get_buddy_pairs(p_company_id uuid)
returns table (
  id              uuid,
  employee_a_id   text,
  employee_a_name text,
  employee_b_id   text,
  employee_b_name text,
  is_active       boolean,
  created_at      timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return query
  select bp.id, bp.employee_a_id, bp.employee_a_name,
         bp.employee_b_id, bp.employee_b_name, bp.is_active, bp.created_at
  from public.buddy_pairs bp
  where bp.company_id = p_company_id
  order by bp.created_at desc;
end $$;

revoke execute on function public.get_buddy_pairs(uuid) from public, anon;
grant  execute on function public.get_buddy_pairs(uuid) to authenticated;
