-- ═══════════════════════════════════════════════════════════════
-- 2026-06-03 Shifts table + RPCs (16th pattern application)
-- ─────────────────────────────────────────────────────────────
-- Audit: dashboard-shift-scheduling-page.tsx stored shifts in
-- localStorage `sosphere_shifts` — cross-tenant leak class. The
-- planner is used by multiple admins on shared devices; switching
-- tenants showed the previous tenant's shift assignments.
--
-- World-class fix (16th application):
--   1. shifts table (company-scoped, RLS-protected)
--   2. SECDEF upsert_shifts_batch RPC (admin-only, delete+insert
--      semantics so the page can act as authoritative)
--   3. SECDEF get_shifts RPC (admin reader)
--   4. RLS company-scoped reads
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.shifts (
  id            text primary key,
  company_id    uuid not null references public.companies(id) on delete cascade,
  employee_id   text not null,
  day_of_week   smallint not null check (day_of_week between 0 and 6),
  shift_type    text not null check (shift_type in ('morning','afternoon','night','custom')),
  start_hour    smallint not null check (start_hour between 0 and 23),
  end_hour      smallint not null check (end_hour between 0 and 23),
  zone          text,
  note          text,
  week_offset   integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists shifts_company_idx on public.shifts(company_id);
create index if not exists shifts_company_week_idx on public.shifts(company_id, week_offset);
create index if not exists shifts_employee_idx on public.shifts(company_id, employee_id, day_of_week);

alter table public.shifts enable row level security;

drop policy if exists shifts_company_read on public.shifts;
create policy shifts_company_read on public.shifts
  for select using (
    company_id in (select c.id from public.companies c where c.owner_id = (select auth.uid()))
    or company_id in (
      select m.company_id from public.company_memberships m
      where m.user_id = (select auth.uid()) and m.active = true
    )
    or company_id in (
      select e.company_id from public.employees e where e.user_id = (select auth.uid())
    )
  );

-- All writes via SECDEF RPC

create or replace function public.get_shifts(p_company_id uuid)
returns table (
  id text, employee_id text, day_of_week smallint, shift_type text,
  start_hour smallint, end_hour smallint, zone text, note text,
  week_offset integer
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select exists(
    select 1 from public.companies c where c.id = p_company_id and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = v_uid and m.active = true
  ) or exists(
    select 1 from public.employees e where e.company_id = p_company_id and e.user_id = v_uid
  ) into v_allowed;
  if not v_allowed then raise exception 'not authorized' using errcode='42501'; end if;

  return query
  select s.id, s.employee_id, s.day_of_week, s.shift_type,
         s.start_hour, s.end_hour, s.zone, s.note, s.week_offset
  from public.shifts s
  where s.company_id = p_company_id
  order by s.week_offset, s.day_of_week, s.start_hour;
end $$;
revoke execute on function public.get_shifts(uuid) from public, anon;
grant  execute on function public.get_shifts(uuid) to authenticated;

create or replace function public.upsert_shifts_batch(
  p_company_id uuid,
  p_shifts jsonb
) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_count integer := 0;
  v_incoming_ids text[];
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select exists(
    select 1 from public.companies c where c.id = p_company_id and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then raise exception 'only owner/admin can edit shifts' using errcode='42501'; end if;

  select array_agg(s->>'id') into v_incoming_ids
  from jsonb_array_elements(p_shifts) s;

  delete from public.shifts
    where company_id = p_company_id
      and (v_incoming_ids is null or id <> all(v_incoming_ids));

  insert into public.shifts (id, company_id, employee_id, day_of_week, shift_type,
                             start_hour, end_hour, zone, note, week_offset, updated_at)
  select
    s->>'id',
    p_company_id,
    s->>'employee_id',
    (s->>'day_of_week')::smallint,
    s->>'shift_type',
    (s->>'start_hour')::smallint,
    (s->>'end_hour')::smallint,
    s->>'zone',
    s->>'note',
    coalesce((s->>'week_offset')::integer, 0),
    now()
  from jsonb_array_elements(p_shifts) s
  on conflict (id) do update set
    employee_id = excluded.employee_id,
    day_of_week = excluded.day_of_week,
    shift_type  = excluded.shift_type,
    start_hour  = excluded.start_hour,
    end_hour    = excluded.end_hour,
    zone        = excluded.zone,
    note        = excluded.note,
    week_offset = excluded.week_offset,
    updated_at  = now();

  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.upsert_shifts_batch(uuid, jsonb) from public, anon;
grant  execute on function public.upsert_shifts_batch(uuid, jsonb) to authenticated;
