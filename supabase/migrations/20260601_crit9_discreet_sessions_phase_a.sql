-- ═══════════════════════════════════════════════════════════════
-- 2026-06-01 Phase 2 CRIT-9 Phase A: discreet sessions persistence
-- ─────────────────────────────────────────────────────────────
-- Surface audit (COHESION_AUDIT_REPORT.md):
--   Discreet SOS is a stealth panic mode (~480 lines of engine code at
--   discreet-sos-mode-v2.ts) that fakes a "blackout" screen on the
--   worker's phone while secretly streaming GPS + recording audio.
--   Pre-fix: session state lives in module-level singleton only;
--   closing the tab loses it; no DB row; no dashboard listener; the
--   employeeId is hardcoded "discreet-sos-user" (a placeholder, not
--   real auth identity). Effectively non-functional cross-device.
--
-- World-class fix (6th application of the established pattern):
--   1. DB tables = canonical truth (this migration)
--      - discreet_sessions: one row per active discreet session
--      - discreet_session_pings: child table for the GPS trail
--   2. 4 SECDEF RPCs gate all writes:
--      - start_discreet_session, heartbeat_discreet_session,
--        end_discreet_session, get_active_discreet_sessions
--   3. RLS: employee sees own; company owner/admin sees all in company
--   4. Companion client service (discreet-session-service.ts) + refactor
--      of discreet-sos-mode-v2.ts to call the RPCs + use real auth.uid()
--   5. Dashboard panel subscribes to realtime channel on discreet_sessions
--
-- Auto-timeout: each session has an auto_timeout_at (default start +
-- 60min, clamped 5-120). heartbeat_discreet_session UPDATES
-- last_heartbeat_at; if a heartbeat arrives AFTER the deadline the
-- session is auto-flipped to status='timed_out'.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.discreet_sessions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  employee_id       uuid not null references auth.users(id) on delete cascade,
  mode              text not null check (mode in ('blackout','low_battery')),
  status            text not null default 'active'
                    check (status in ('active','warned','timed_out','exited','admin_cleared')),
  start_lat         double precision,
  start_lng         double precision,
  start_accuracy_m  numeric,
  last_lat          double precision,
  last_lng          double precision,
  last_accuracy_m   numeric,
  last_heartbeat_at timestamptz,
  auto_timeout_at   timestamptz not null,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  end_reason        text,
  created_at        timestamptz not null default now()
);

create index if not exists discreet_sessions_company_active_idx
  on public.discreet_sessions(company_id, status)
  where status in ('active','warned');
create index if not exists discreet_sessions_employee_idx
  on public.discreet_sessions(employee_id, started_at desc);

create table if not exists public.discreet_session_pings (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.discreet_sessions(id) on delete cascade,
  lat         double precision,
  lng         double precision,
  accuracy_m  numeric,
  battery_pct numeric,
  ping_at     timestamptz not null default now()
);

create index if not exists discreet_session_pings_session_idx
  on public.discreet_session_pings(session_id, ping_at desc);

alter table public.discreet_sessions enable row level security;
alter table public.discreet_session_pings enable row level security;

drop policy if exists discreet_sessions_self_read on public.discreet_sessions;
create policy discreet_sessions_self_read on public.discreet_sessions
  for select using (employee_id = (select auth.uid()));

drop policy if exists discreet_sessions_admin_read on public.discreet_sessions;
create policy discreet_sessions_admin_read on public.discreet_sessions
  for select using (
    company_id in (select c.id from public.companies c where c.owner_id = (select auth.uid()))
    or company_id in (
      select m.company_id from public.company_memberships m
      where m.user_id = (select auth.uid())
        and m.active = true and m.role in ('owner','admin')
    )
  );

drop policy if exists discreet_pings_via_session on public.discreet_session_pings;
create policy discreet_pings_via_session on public.discreet_session_pings
  for select using (
    session_id in (
      select s.id from public.discreet_sessions s
      where s.employee_id = (select auth.uid())
         or s.company_id in (select c.id from public.companies c where c.owner_id = (select auth.uid()))
         or s.company_id in (
              select m.company_id from public.company_memberships m
              where m.user_id = (select auth.uid())
                and m.active = true and m.role in ('owner','admin'))
    )
  );

-- All writes go through SECDEF RPCs

create or replace function public.start_discreet_session(
  p_mode        text,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy    numeric default null,
  p_timeout_min int default 60
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_company_id uuid;
  v_id         uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('blackout','low_battery') then
    raise exception 'mode must be blackout or low_battery' using errcode = '22023';
  end if;

  select e.company_id into v_company_id
    from public.employees e where e.user_id = v_uid
    limit 1;
  if v_company_id is null then
    select c.id into v_company_id from public.companies c where c.owner_id = v_uid limit 1;
  end if;
  if v_company_id is null then
    raise exception 'no company found for user — discreet mode requires company affiliation' using errcode = '22023';
  end if;

  update public.discreet_sessions
     set status = 'exited', ended_at = now(), end_reason = 'superseded'
   where employee_id = v_uid
     and status in ('active','warned');

  insert into public.discreet_sessions (
    company_id, employee_id, mode, status,
    start_lat, start_lng, start_accuracy_m,
    last_lat, last_lng, last_accuracy_m, last_heartbeat_at,
    auto_timeout_at, started_at
  ) values (
    v_company_id, v_uid, p_mode, 'active',
    p_lat, p_lng, p_accuracy,
    p_lat, p_lng, p_accuracy, now(),
    now() + (greatest(5, least(p_timeout_min, 120)) || ' minutes')::interval,
    now()
  )
  returning id into v_id;

  return v_id;
end $$;
revoke execute on function public.start_discreet_session(text, double precision, double precision, numeric, int) from public, anon;
grant  execute on function public.start_discreet_session(text, double precision, double precision, numeric, int) to authenticated;

create or replace function public.heartbeat_discreet_session(
  p_session_id uuid,
  p_lat        double precision default null,
  p_lng        double precision default null,
  p_accuracy   numeric default null,
  p_battery    numeric default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_status text;
  v_timeout timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_session_id is null then
    raise exception 'p_session_id required' using errcode = '22023';
  end if;

  select employee_id, status, auto_timeout_at
    into v_owner, v_status, v_timeout
    from public.discreet_sessions where id = p_session_id;
  if v_owner is null then
    raise exception 'session not found' using errcode = '22023';
  end if;
  if v_owner <> v_uid then
    raise exception 'not authorized for this session' using errcode = '42501';
  end if;
  if v_status not in ('active','warned') then
    return false;
  end if;

  if v_timeout < now() then
    update public.discreet_sessions
       set status = 'timed_out', ended_at = now(), end_reason = 'auto_timeout'
     where id = p_session_id;
    return false;
  end if;

  update public.discreet_sessions
     set last_lat = coalesce(p_lat, last_lat),
         last_lng = coalesce(p_lng, last_lng),
         last_accuracy_m = coalesce(p_accuracy, last_accuracy_m),
         last_heartbeat_at = now()
   where id = p_session_id;

  insert into public.discreet_session_pings (session_id, lat, lng, accuracy_m, battery_pct)
  values (p_session_id, p_lat, p_lng, p_accuracy, p_battery);

  return true;
end $$;
revoke execute on function public.heartbeat_discreet_session(uuid, double precision, double precision, numeric, numeric) from public, anon;
grant  execute on function public.heartbeat_discreet_session(uuid, double precision, double precision, numeric, numeric) to authenticated;

create or replace function public.end_discreet_session(
  p_session_id uuid,
  p_reason     text default 'exited'
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_company   uuid;
  v_allowed   boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_session_id is null then
    raise exception 'p_session_id required' using errcode = '22023';
  end if;
  if p_reason not in ('exited','admin_cleared','timed_out') then
    raise exception 'reason must be exited|admin_cleared|timed_out' using errcode = '22023';
  end if;

  select employee_id, company_id into v_owner, v_company
    from public.discreet_sessions where id = p_session_id;
  if v_owner is null then return true; end if;

  if v_owner = v_uid then
    v_allowed := true;
  else
    select exists(
      select 1 from public.companies c where c.id = v_company and c.owner_id = v_uid
    ) or exists(
      select 1 from public.company_memberships m
      where m.company_id = v_company and m.user_id = v_uid
        and m.active = true and m.role in ('owner','admin')
    ) into v_allowed;
  end if;
  if not v_allowed then
    raise exception 'not authorized to end this session' using errcode = '42501';
  end if;

  update public.discreet_sessions
     set status = case when p_reason = 'admin_cleared' then 'admin_cleared'
                       when p_reason = 'timed_out'     then 'timed_out'
                       else 'exited' end,
         ended_at = now(),
         end_reason = p_reason
   where id = p_session_id
     and status in ('active','warned');

  return true;
end $$;
revoke execute on function public.end_discreet_session(uuid, text) from public, anon;
grant  execute on function public.end_discreet_session(uuid, text) to authenticated;

create or replace function public.get_active_discreet_sessions(p_company_id uuid)
returns table (
  id                uuid,
  employee_id       uuid,
  mode              text,
  status            text,
  last_lat          double precision,
  last_lng          double precision,
  last_accuracy_m   numeric,
  last_heartbeat_at timestamptz,
  auto_timeout_at   timestamptz,
  started_at        timestamptz,
  heartbeat_age_sec int
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
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', p_company_id using errcode = '42501';
  end if;

  return query
  select s.id, s.employee_id, s.mode, s.status,
         s.last_lat, s.last_lng, s.last_accuracy_m,
         s.last_heartbeat_at, s.auto_timeout_at, s.started_at,
         extract(epoch from (now() - s.last_heartbeat_at))::int as heartbeat_age_sec
  from public.discreet_sessions s
  where s.company_id = p_company_id
    and s.status in ('active','warned')
  order by s.started_at desc;
end $$;
revoke execute on function public.get_active_discreet_sessions(uuid) from public, anon;
grant  execute on function public.get_active_discreet_sessions(uuid) to authenticated;
