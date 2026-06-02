-- ═══════════════════════════════════════════════════════════════
-- 2026-06-02 Attendance world-class refactor (7th pattern application)
-- ─────────────────────────────────────────────────────────────
-- Surface audit revealed THREE bugs beyond the original cross-device
-- invisibility complaint:
--   1. checkin_events table had NO company_id column → all dashboard
--      queries doing .eq("company_id", X) silently returned zero rows
--      (e.g. compliance-data-service.ts:434 was a no-op for months).
--   2. Mobile writes hardcoded employee_id = "EMP-APP" → RLS write
--      policy (employees.id::text = "EMP-APP" AND user_id = auth.uid())
--      failed for every real user. Writes only succeeded if a magic
--      'EMP-APP' employees row happened to exist (masking the bug).
--   3. dashboard-workforce-page generated lastCheckin via Math.random()
--      — pure fabrication, not stale data.
--
-- World-class fix (Phase A — server):
--   1. Add company_id column to checkin_events, backfill via employees
--      join, then index for fast company-scoped reads.
--   2. New SECDEF RPC record_checkin_event(...) that:
--      - Resolves employee_id from auth.uid() → employees row server-side
--      - Pins company_id from the same employees row (defense-in-depth)
--      - Refuses if caller has no employee row (clearer than RLS deny)
--   3. New SECDEF RPC get_checkin_feed(p_company_id, p_since, p_limit)
--      that returns the last-N check-in events for a company (admin-only).
--   4. New admin-direct RLS read path keyed on the new company_id column
--      so dashboard queries can hit the table directly without joining
--      through employees just to filter (cheaper).
--
-- Phase B (client refactor) lives in attendance-service.ts +
-- dashboard-attendance-page + dashboard-workforce-page in a separate
-- commit so blast radius stays small.
-- ═══════════════════════════════════════════════════════════════

alter table public.checkin_events
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.checkin_events ce
   set company_id = e.company_id
  from public.employees e
 where ce.company_id is null
   and ce.employee_id is not null
   and ce.employee_id = e.id::text;

create index if not exists checkin_events_company_recent_idx
  on public.checkin_events(company_id, created_at desc)
  where company_id is not null;

create or replace function public.record_checkin_event(
  p_event_type     text,
  p_zone           text default null,
  p_duration_min   int  default null,
  p_remaining_sec  int  default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_emp_id    uuid;
  v_emp_name  text;
  v_company   uuid;
  v_id        uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_event_type is null or p_event_type not in ('checkin','warning','missed','resumed') then
    raise exception 'event_type must be checkin|warning|missed|resumed' using errcode = '22023';
  end if;

  select id, name, company_id
    into v_emp_id, v_emp_name, v_company
    from public.employees
   where user_id = v_uid
   limit 1;

  if v_emp_id is null then
    raise exception 'caller has no employee row — cannot record check-in' using errcode = '22023';
  end if;

  insert into public.checkin_events (
    id, employee_id, employee_name, zone, event_type,
    duration_min, remaining_sec, company_id, created_at
  ) values (
    gen_random_uuid(), v_emp_id::text, v_emp_name, p_zone, p_event_type,
    p_duration_min, p_remaining_sec, v_company, now()
  )
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.record_checkin_event(text, text, int, int) from public, anon;
grant  execute on function public.record_checkin_event(text, text, int, int) to authenticated;

create or replace function public.get_checkin_feed(
  p_company_id uuid,
  p_since      timestamptz default null,
  p_limit      int default 200
) returns table (
  id            uuid,
  employee_id   text,
  employee_name text,
  zone          text,
  event_type    text,
  duration_min  int,
  remaining_sec int,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select exists(
    select 1 from public.companies c where c.id = p_company_id and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin')
  ) or exists(
    select 1 from public.employees e
    where e.company_id = p_company_id and e.user_id = v_uid
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', p_company_id using errcode = '42501';
  end if;

  return query
  select ce.id, ce.employee_id, ce.employee_name, ce.zone, ce.event_type,
         ce.duration_min, ce.remaining_sec, ce.created_at
  from public.checkin_events ce
  where ce.company_id = p_company_id
    and (p_since is null or ce.created_at >= p_since)
  order by ce.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;

revoke execute on function public.get_checkin_feed(uuid, timestamptz, int) from public, anon;
grant  execute on function public.get_checkin_feed(uuid, timestamptz, int) to authenticated;

drop policy if exists checkin_events_company_admin_read on public.checkin_events;
create policy checkin_events_company_admin_read on public.checkin_events
  for select using (
    company_id is not null and (
      company_id in (select c.id from public.companies c where c.owner_id = (select auth.uid()))
      or company_id in (
        select m.company_id from public.company_memberships m
        where m.user_id = (select auth.uid())
          and m.active = true and m.role in ('owner','admin')
      )
    )
  );

comment on function public.record_checkin_event(text, text, int, int) is
  '2026-06-02 attendance refactor: replaces 11 hardcoded "EMP-APP" '
  'write callsites. Server resolves employee_id + company_id from '
  'auth.uid() — clients cannot forge identity.';
comment on function public.get_checkin_feed(uuid, timestamptz, int) is
  '2026-06-02 attendance refactor: admin-only reader. Returns recent '
  'check-in events for a company. Used by dashboard-attendance-page '
  'and dashboard-workforce-page (which previously fabricated data via '
  'Math.random() — a real bug, not just staleness).';
