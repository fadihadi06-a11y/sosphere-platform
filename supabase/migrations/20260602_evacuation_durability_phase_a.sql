-- ═══════════════════════════════════════════════════════════════
-- 2026-06-02 Evacuation durability (10th pattern application)
-- ─────────────────────────────────────────────────────────────
-- Audit: "Evacuation flow PARTIAL. No `evacuations` table —
-- broadcast-only; offline/late-onboarding workers miss event silently.
-- Worker onboarding after broadcast time misses it forever."
--
-- Today everything (ActiveEvacuation, EmployeeEvacuationStatus,
-- EvacuationPoint) lives in localStorage on the admin's browser tab.
-- Tab close = data gone. Cross-device admins see only ACKs that
-- arrived via the live Realtime broadcast they were subscribed to
-- at emit time — no replay, no DB.
--
-- World-class fix (10th pattern application):
--   1. evacuations table (server-side source of truth)
--   2. evacuation_acks table (per-worker ack with phase:
--      acknowledged | evacuating | arrived)
--   3. 4 SECDEF RPCs:
--      - start_evacuation: admin triggers, returns evacuation id
--      - ack_evacuation: worker records ack with phase + GPS
--      - end_evacuation: admin marks completed/cancelled
--      - get_active_evacuations: admin reader with derived counts
--   4. RLS: company-scoped reads; all writes via SECDEF.
--
-- Companion: evacuation-service.ts + dashboard-evacuation-page +
-- mobile evacuation-screen refactors in subsequent commits.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.evacuations (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  zone_id             uuid references public.zones(id) on delete set null,
  zone_name           text,
  reason              text,
  status              text not null default 'active'
                      check (status in ('active','completed','cancelled')),
  triggered_by        uuid references auth.users(id) on delete set null,
  assembly_point_id   text,
  assembly_point_name text,
  triggered_at        timestamptz not null default now(),
  ended_at            timestamptz,
  end_reason          text,
  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists evacuations_company_active_idx
  on public.evacuations(company_id, status)
  where status = 'active';
create index if not exists evacuations_company_recent_idx
  on public.evacuations(company_id, triggered_at desc);

create table if not exists public.evacuation_acks (
  id              uuid primary key default gen_random_uuid(),
  evacuation_id   uuid not null references public.evacuations(id) on delete cascade,
  employee_id     uuid not null references auth.users(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  phase           text not null
                  check (phase in ('acknowledged','evacuating','arrived')),
  lat             double precision,
  lng             double precision,
  accuracy_m      numeric,
  ack_at          timestamptz not null default now()
);

create index if not exists evacuation_acks_evac_employee_idx
  on public.evacuation_acks(evacuation_id, employee_id, ack_at desc);
create index if not exists evacuation_acks_company_recent_idx
  on public.evacuation_acks(company_id, ack_at desc);

alter table public.evacuations enable row level security;
alter table public.evacuation_acks enable row level security;

drop policy if exists evacuations_company_read on public.evacuations;
create policy evacuations_company_read on public.evacuations
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

drop policy if exists evacuation_acks_company_read on public.evacuation_acks;
create policy evacuation_acks_company_read on public.evacuation_acks
  for select using (
    employee_id = (select auth.uid())
    or company_id in (select c.id from public.companies c where c.owner_id = (select auth.uid()))
    or company_id in (
      select m.company_id from public.company_memberships m
      where m.user_id = (select auth.uid()) and m.active = true and m.role in ('owner','admin')
    )
  );

-- All writes via SECDEF RPCs

create or replace function public.start_evacuation(
  p_company_id          uuid,
  p_zone_id             uuid    default null,
  p_zone_name           text    default null,
  p_reason              text    default null,
  p_assembly_point_id   text    default null,
  p_assembly_point_name text    default null,
  p_metadata            jsonb   default '{}'::jsonb
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
  if p_company_id is null then
    raise exception 'p_company_id required' using errcode = '22023';
  end if;
  select exists(
    select 1 from public.companies c where c.id = p_company_id and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then
    raise exception 'only owner/admin can trigger evacuation' using errcode = '42501';
  end if;

  insert into public.evacuations (
    company_id, zone_id, zone_name, reason, status,
    triggered_by, assembly_point_id, assembly_point_name,
    triggered_at, metadata
  ) values (
    p_company_id, p_zone_id, p_zone_name, p_reason, 'active',
    v_uid, p_assembly_point_id, p_assembly_point_name,
    now(), coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;

  return v_id;
end $$;
revoke execute on function public.start_evacuation(uuid, uuid, text, text, text, text, jsonb) from public, anon;
grant  execute on function public.start_evacuation(uuid, uuid, text, text, text, text, jsonb) to authenticated;

create or replace function public.ack_evacuation(
  p_evacuation_id uuid,
  p_phase         text,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_accuracy      numeric          default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_status  text;
  v_allowed boolean;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_phase not in ('acknowledged','evacuating','arrived') then
    raise exception 'phase must be acknowledged|evacuating|arrived' using errcode = '22023';
  end if;

  select company_id, status into v_company, v_status
    from public.evacuations where id = p_evacuation_id;
  if v_company is null then
    raise exception 'evacuation not found' using errcode = '22023';
  end if;
  if v_status <> 'active' then return null; end if;

  select exists(
    select 1 from public.employees e where e.company_id = v_company and e.user_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = v_company and m.user_id = v_uid and m.active = true
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for this evacuation' using errcode = '42501';
  end if;

  insert into public.evacuation_acks (
    evacuation_id, employee_id, company_id, phase, lat, lng, accuracy_m
  ) values (
    p_evacuation_id, v_uid, v_company, p_phase, p_lat, p_lng, p_accuracy
  ) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.ack_evacuation(uuid, text, double precision, double precision, numeric) from public, anon;
grant  execute on function public.ack_evacuation(uuid, text, double precision, double precision, numeric) to authenticated;

create or replace function public.end_evacuation(
  p_evacuation_id uuid,
  p_action        text default 'completed'
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_action not in ('completed','cancelled') then
    raise exception 'action must be completed|cancelled' using errcode = '22023';
  end if;

  select company_id into v_company from public.evacuations where id = p_evacuation_id;
  if v_company is null then return true; end if;

  select exists(
    select 1 from public.companies c where c.id = v_company and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = v_company and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then
    raise exception 'only owner/admin can end evacuation' using errcode = '42501';
  end if;

  update public.evacuations
     set status = p_action,
         ended_at = now(),
         end_reason = p_action
   where id = p_evacuation_id
     and status = 'active';
  return true;
end $$;
revoke execute on function public.end_evacuation(uuid, text) from public, anon;
grant  execute on function public.end_evacuation(uuid, text) to authenticated;

create or replace function public.get_active_evacuations(p_company_id uuid)
returns table (
  id                  uuid,
  zone_id             uuid,
  zone_name           text,
  reason              text,
  triggered_by        uuid,
  assembly_point_id   text,
  assembly_point_name text,
  triggered_at        timestamptz,
  ack_count           int,
  arrived_count       int
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
    where m.company_id = p_company_id and m.user_id = v_uid and m.active = true
  ) or exists(
    select 1 from public.employees e where e.company_id = p_company_id and e.user_id = v_uid
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', p_company_id using errcode = '42501';
  end if;

  return query
  select e.id, e.zone_id, e.zone_name, e.reason, e.triggered_by,
         e.assembly_point_id, e.assembly_point_name, e.triggered_at,
         (select count(distinct a.employee_id)::int
            from public.evacuation_acks a where a.evacuation_id = e.id) as ack_count,
         (select count(distinct a.employee_id)::int
            from public.evacuation_acks a where a.evacuation_id = e.id and a.phase = 'arrived') as arrived_count
  from public.evacuations e
  where e.company_id = p_company_id and e.status = 'active'
  order by e.triggered_at desc;
end $$;
revoke execute on function public.get_active_evacuations(uuid) from public, anon;
grant  execute on function public.get_active_evacuations(uuid) to authenticated;
