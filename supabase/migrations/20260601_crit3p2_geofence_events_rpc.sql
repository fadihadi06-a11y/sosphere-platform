-- ═══════════════════════════════════════════════════════════════
-- 2026-06-01 Phase 2 CRIT-3: geofencing mobile detection
-- ─────────────────────────────────────────────────────────────
-- Problem (pre-fix):
--   Dashboard admin can draw zones. Mobile GPS samples arrive every
--   N seconds via offline-gps-tracker.ts:processPosition. Yet NO
--   ZONE_ENTRY/ZONE_EXIT event is ever emitted, no `geofence_events`
--   table exists, and zones are never enforced. Pure visual CRUD.
--
-- World-class fix (mirrors CRIT-2/3/4 pattern):
--   1. Server table is THE source of truth (this migration)
--   2. SECDEF RPC gates all writes (user_id pinned + zone-company
--      membership check derived from the zone, not trusted from client)
--   3. Companion client service (geofence-service.ts) handles the
--      pure geometry + hysteresis (debouncing GPS noise) and is
--      locked by 10 Vitest contract tests.
--   4. Hook lives in offline-gps-tracker.ts:processPosition so every
--      existing GPS sample auto-computes zone membership.
--
-- Decision (recorded for posterity): the `zones` table (real lat/lng/
-- radius, seeded in onboarding via company-register.tsx) is the
-- canonical runtime table. The dashboard-side `geofences` table holds
-- CANVAS pixel coords only — it's a visual editor for the admin,
-- never used by detection. Future work: migrate the visual editor to
-- write real geocoords too.
--
-- See SECURITY_DECISIONS.md for the pattern's rationale.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.geofence_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  zone_id         uuid not null references public.zones(id) on delete cascade,
  event_type      text not null check (event_type in ('enter','exit','dwell')),
  lat             double precision not null,
  lng             double precision not null,
  accuracy_meters numeric,
  source          text not null default 'gps' check (source in ('gps','manual','geofence_admin')),
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists geofence_events_company_user_idx
  on public.geofence_events(company_id, user_id, occurred_at desc);
create index if not exists geofence_events_zone_idx
  on public.geofence_events(zone_id, occurred_at desc);
create index if not exists geofence_events_user_recent_idx
  on public.geofence_events(user_id, occurred_at desc);

alter table public.geofence_events enable row level security;

-- Self-read: user sees their own events
drop policy if exists geofence_events_self_read on public.geofence_events;
create policy geofence_events_self_read on public.geofence_events
  for select using (user_id = (select auth.uid()));

-- Admin/owner read: company admin/owner sees all events for their company
drop policy if exists geofence_events_admin_read on public.geofence_events;
create policy geofence_events_admin_read on public.geofence_events
  for select using (
    company_id in (select c.id from public.companies c where c.owner_id = (select auth.uid()))
    or company_id in (
      select m.company_id from public.company_memberships m
      where m.user_id = (select auth.uid())
        and m.active = true
        and m.role in ('owner','admin')
    )
  );

-- ALL writes go through the SECDEF RPC below (no direct INSERT policy).

create or replace function public.record_geofence_event(
  p_zone_id     uuid,
  p_event_type  text,
  p_lat         double precision,
  p_lng         double precision,
  p_accuracy    numeric default null,
  p_source      text default 'gps',
  p_occurred_at timestamptz default null
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
  if p_zone_id is null or p_event_type is null or p_lat is null or p_lng is null then
    raise exception 'zone_id, event_type, lat, lng all required' using errcode = '22023';
  end if;
  if p_event_type not in ('enter','exit','dwell') then
    raise exception 'event_type must be enter|exit|dwell' using errcode = '22023';
  end if;
  if p_source is not null and p_source not in ('gps','manual','geofence_admin') then
    raise exception 'source must be gps|manual|geofence_admin' using errcode = '22023';
  end if;

  -- Derive company_id from the zone and verify caller is a member of that company.
  -- This guards against malicious mobile clients trying to write events for zones
  -- in companies they don't belong to.
  select z.company_id into v_company_id
    from public.zones z
   where z.id = p_zone_id;
  if v_company_id is null then
    raise exception 'zone % not found', p_zone_id using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.companies c where c.id = v_company_id and c.owner_id = v_uid
  ) and not exists (
    select 1 from public.company_memberships m
    where m.company_id = v_company_id and m.user_id = v_uid and m.active = true
  ) and not exists (
    select 1 from public.employees e
    where e.company_id = v_company_id and e.user_id = v_uid
  ) then
    raise exception 'not authorized for company %', v_company_id using errcode = '42501';
  end if;

  insert into public.geofence_events (
    user_id, company_id, zone_id, event_type, lat, lng,
    accuracy_meters, source, occurred_at
  ) values (
    v_uid, v_company_id, p_zone_id, p_event_type, p_lat, p_lng,
    p_accuracy, coalesce(p_source, 'gps'), coalesce(p_occurred_at, now())
  )
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.record_geofence_event(uuid, text, double precision, double precision, numeric, text, timestamptz) from public, anon;
grant  execute on function public.record_geofence_event(uuid, text, double precision, double precision, numeric, text, timestamptz) to authenticated;

-- Paired reader RPC for admin dashboards (mirrors get_company_invitations pattern)
create or replace function public.get_company_geofence_events(
  p_company_id uuid,
  p_limit      int default 100
) returns table (
  id              uuid,
  user_id         uuid,
  zone_id         uuid,
  event_type      text,
  lat             double precision,
  lng             double precision,
  accuracy_meters numeric,
  source          text,
  occurred_at     timestamptz
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
  select exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.owner_id = v_uid
  ) or exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id    = v_uid
      and m.active     = true
      and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', p_company_id using errcode = '42501';
  end if;
  return query
  select e.id, e.user_id, e.zone_id, e.event_type,
         e.lat, e.lng, e.accuracy_meters, e.source, e.occurred_at
  from public.geofence_events e
  where e.company_id = p_company_id
  order by e.occurred_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 1000));
end $$;

revoke execute on function public.get_company_geofence_events(uuid, int) from public, anon;
grant  execute on function public.get_company_geofence_events(uuid, int) to authenticated;
