-- ═══════════════════════════════════════════════════════════════
-- 2026-06-03 Emergency CRUD (17th pattern application)
-- ─────────────────────────────────────────────────────────────
-- Audit (#10 P1): dashboard-store.ts addEmergency / updateEmergency /
-- resolveEmergency / takeOwnership / cancelEmergencyById mutated only
-- Zustand state in-memory. Admin take-ownership / cancel / status
-- updates vanished across tab reloads. The mobile SOS path DOES land
-- in sos_queue (via project_sos_session_to_queue trigger) but admin
-- decisions on top of it were runtime-only.
--
-- World-class fix:
--   1. ALTER sos_queue: + type, owned_by, owned_at, manual_priority
--      (indexed for ownership + priority queries).
--   2. 4 SECDEF RPCs:
--      - create_emergency_admin (idempotent UPSERT on id — handles
--        the case where mobile trigger + admin SyncEvent both target
--        the same id without duplicating rows)
--      - take_emergency_ownership (owned_by + assigned_to + status)
--      - cancel_emergency (status='cancelled' — was missing)
--      - update_emergency (non-destructive: type/severity/zone/notes/
--        priority/metadata-merge)
--   3. RLS: company-scoped reads already exist; writes gated by
--      owner/admin/dispatcher/safety_manager role.
--
-- Companion: src/app/components/emergencies-service.ts (cache trio +
-- RPC wrappers) and dashboard-store.ts dual-write refactor (Phase B).
-- ═══════════════════════════════════════════════════════════════

alter table public.sos_queue
  add column if not exists type             text,
  add column if not exists owned_by         text,
  add column if not exists owned_at         timestamptz,
  add column if not exists manual_priority  integer;

create index if not exists sos_queue_company_owned_idx
  on public.sos_queue(company_id, owned_by)
  where owned_by is not null;
create index if not exists sos_queue_company_priority_idx
  on public.sos_queue(company_id, manual_priority desc)
  where manual_priority is not null;
create index if not exists sos_queue_company_status_active_idx
  on public.sos_queue(company_id, recorded_at desc)
  where status = 'active';

-- ── 1. create_emergency_admin (UPSERT, idempotent) ─────────────
create or replace function public.create_emergency_admin(
  p_company_id   uuid,
  p_id           text,
  p_type         text          default null,
  p_severity     text          default 'high',
  p_employee_id  uuid          default null,
  p_employee_name text         default null,
  p_zone         text          default null,
  p_lat          double precision default null,
  p_lng          double precision default null,
  p_metadata     jsonb         default '{}'::jsonb
) returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if p_company_id is null or p_id is null then
    raise exception 'p_company_id and p_id are required' using errcode='22023';
  end if;
  select exists(
    select 1 from public.companies c where c.id = p_company_id and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin','dispatcher','safety_manager')
  ) into v_allowed;
  if not v_allowed then
    raise exception 'only owner/admin/dispatcher/safety_manager can create emergencies' using errcode='42501';
  end if;

  insert into public.sos_queue (
    id, company_id, employee_id, employee_name, zone, lat, lng,
    severity, type, status, recorded_at, metadata
  ) values (
    p_id, p_company_id, p_employee_id, p_employee_name, p_zone, p_lat, p_lng,
    p_severity, p_type, 'active', now(), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (id) do update set
    type     = coalesce(public.sos_queue.type, excluded.type),
    severity = coalesce(public.sos_queue.severity, excluded.severity),
    zone     = coalesce(public.sos_queue.zone, excluded.zone),
    metadata = public.sos_queue.metadata || excluded.metadata;

  return p_id;
end $$;
revoke execute on function public.create_emergency_admin(uuid, text, text, text, uuid, text, text, double precision, double precision, jsonb) from public, anon;
grant  execute on function public.create_emergency_admin(uuid, text, text, text, uuid, text, text, double precision, double precision, jsonb) to authenticated;

-- ── 2. take_emergency_ownership ────────────────────────────────
create or replace function public.take_emergency_ownership(
  p_id          text,
  p_admin_name  text default 'Admin'
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_allowed boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select company_id into v_company from public.sos_queue where id = p_id;
  if v_company is null then raise exception 'emergency not found' using errcode='22023'; end if;
  select exists(
    select 1 from public.companies c where c.id = v_company and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = v_company and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin','dispatcher','safety_manager')
  ) into v_allowed;
  if not v_allowed then raise exception 'not authorized for this emergency' using errcode='42501'; end if;

  update public.sos_queue
     set owned_by  = p_admin_name,
         owned_at  = now(),
         status    = case when status = 'active' then 'investigating' else status end,
         assigned_to = coalesce(assigned_to, p_admin_name),
         assigned_at = coalesce(assigned_at, now()),
         assigned_by = coalesce(assigned_by, v_uid)
   where id = p_id
     and status not in ('resolved','cancelled');
  return true;
end $$;
revoke execute on function public.take_emergency_ownership(text, text) from public, anon;
grant  execute on function public.take_emergency_ownership(text, text) to authenticated;

-- ── 3. cancel_emergency ─────────────────────────────────────────
create or replace function public.cancel_emergency(
  p_id          text,
  p_reason      text default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_allowed boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select company_id into v_company from public.sos_queue where id = p_id;
  if v_company is null then return true; end if;
  select exists(
    select 1 from public.companies c where c.id = v_company and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = v_company and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin','dispatcher','safety_manager')
  ) into v_allowed;
  if not v_allowed then raise exception 'not authorized' using errcode='42501'; end if;

  update public.sos_queue
     set status     = 'cancelled',
         resolved_at = now(),
         resolved_by = v_uid,
         resolution_note = coalesce(p_reason, resolution_note, 'Cancelled by admin')
   where id = p_id
     and status not in ('resolved','cancelled');
  return true;
end $$;
revoke execute on function public.cancel_emergency(text, text) from public, anon;
grant  execute on function public.cancel_emergency(text, text) to authenticated;

-- ── 4. update_emergency (non-destructive fields) ────────────────
create or replace function public.update_emergency(
  p_id              text,
  p_type            text default null,
  p_severity        text default null,
  p_zone            text default null,
  p_notes           text default null,
  p_manual_priority integer default null,
  p_metadata_merge  jsonb default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_allowed boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select company_id into v_company from public.sos_queue where id = p_id;
  if v_company is null then raise exception 'emergency not found' using errcode='22023'; end if;
  select exists(
    select 1 from public.companies c where c.id = v_company and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = v_company and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin','dispatcher','safety_manager')
  ) into v_allowed;
  if not v_allowed then raise exception 'not authorized' using errcode='42501'; end if;

  update public.sos_queue
     set type            = coalesce(p_type, type),
         severity        = coalesce(p_severity, severity),
         zone            = coalesce(p_zone, zone),
         notes           = coalesce(p_notes, notes),
         manual_priority = coalesce(p_manual_priority, manual_priority),
         metadata        = case when p_metadata_merge is null then metadata
                                else metadata || p_metadata_merge end
   where id = p_id
     and status not in ('resolved','cancelled');
  return true;
end $$;
revoke execute on function public.update_emergency(text, text, text, text, text, integer, jsonb) from public, anon;
grant  execute on function public.update_emergency(text, text, text, text, text, integer, jsonb) to authenticated;
