-- ═══════════════════════════════════════════════════════════════
-- SOSphere — P3-#11f Journeys (Journey Management)
-- ─────────────────────────────────────────────────────────────
-- Tracks field-worker journeys: origin → destination routes with
-- ordered waypoints, ETAs, status, and distance progress. Powers
-- the Journey Management dashboard and feeds the "On-Route Incident"
-- section of the compliance PDF (journeyLog field, currently null
-- because the table didn't exist).
--
-- Prior behavior: journeys existed only in the originating admin's
-- browser localStorage, so Journey Management was a device-local
-- view. A watchdog could launch SAR based on a journey it could see,
-- but any other admin on any other device had no idea the journey
-- was even active. That's a safety-critical blind spot for field
-- ops.
--
-- Shape: waypoints is jsonb (Waypoint[]) to match the client type
-- 1:1 — waypoints are always rendered as an ordered group and the
-- sequence matters. A future migration can normalize them into a
-- child table if we need per-waypoint querying.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.journeys (
  id                 text primary key,
  company_id         uuid not null references public.companies(id) on delete cascade,

  employee_id        text,
  employee_name      text,
  origin             text,
  destination        text,

  start_time         timestamptz,
  estimated_end      timestamptz,
  actual_end         timestamptz,

  waypoints          jsonb not null default '[]'::jsonb,       -- Waypoint[]

  status             text not null default 'active',           -- active | completed | delayed | deviated | sos
  current_location   text,
  distance_covered   numeric(10,2) not null default 0,         -- km
  total_distance     numeric(10,2) not null default 0,         -- km
  vehicle_type       text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Dashboard filter: "show me this company's journeys sorted by
-- most recent start, usually limited to the active set."
create index if not exists journeys_company_idx
  on public.journeys(company_id, start_time desc);

-- Status-filtered queries (active / delayed / deviated) used by the
-- filter pills are hot — keep a composite so the optimizer doesn't
-- scan the whole company's history.
create index if not exists journeys_company_status_idx
  on public.journeys(company_id, status);

-- "Find journeys assigned to a specific employee" — used by the
-- employee-detail drawer and by SAR launches that cross-reference
-- from an incident back to the journey that led to it.
create index if not exists journeys_employee_idx
  on public.journeys(employee_id) where employee_id is not null;

-- ── Row Level Security ───────────────────────────────────────
alter table public.journeys enable row level security;

drop policy if exists "journeys_select" on public.journeys;
create policy "journeys_select" on public.journeys
  for select using (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  );

drop policy if exists "journeys_write" on public.journeys;
create policy "journeys_write" on public.journeys
  for all using (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  ) with check (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  );

-- Reuse the touch_updated_at() trigger function defined in the
-- earlier risk_register migration. `create or replace` there makes
-- this safe regardless of migration order.
drop trigger if exists journeys_touch_updated_at on public.journeys;
create trigger journeys_touch_updated_at
  before update on public.journeys
  for each row execute function public.touch_updated_at();
