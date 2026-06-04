-- ═══════════════════════════════════════════════════════════════
-- 2026-06-03 Email Schedules (21st pattern application)
-- ─────────────────────────────────────────────────────────────
-- Audit (C-5, 3 markers): batch-email-scheduler.tsx stored schedules
-- in localStorage `sosphere_email_schedules`. An admin who set up
-- a quarterly compliance email on their laptop couldn't see / edit /
-- disable it from a different device. Cross-tenant leak on shared
-- devices. Same CRIT-#4 class as the prior pattern apps.
--
-- 21st application of the world-class server-state pattern.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.email_schedules (
  id              text primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  frequency       text not null check (frequency in ('daily','weekly','monthly','quarterly')),
  report_types    text[] not null default '{}',
  recipients      text[] not null default '{}',
  enabled         boolean not null default true,
  next_run        timestamptz,
  last_run        timestamptz,
  include_charts  boolean not null default false,
  include_qr      boolean not null default false,
  format          text not null default 'pdf' check (format in ('pdf','csv','both')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists email_schedules_company_idx on public.email_schedules(company_id);
create index if not exists email_schedules_company_enabled_next_idx
  on public.email_schedules(company_id, next_run)
  where enabled = true;

alter table public.email_schedules enable row level security;

drop policy if exists email_schedules_company_read on public.email_schedules;
create policy email_schedules_company_read on public.email_schedules
  for select using (
    company_id in (select c.id from public.companies c where c.owner_id = (select auth.uid()))
    or company_id in (
      select m.company_id from public.company_memberships m
      where m.user_id = (select auth.uid()) and m.active = true
    )
  );

create or replace function public.get_email_schedules(p_company_id uuid)
returns table (
  id text, name text, frequency text, report_types text[], recipients text[],
  enabled boolean, next_run timestamptz, last_run timestamptz,
  include_charts boolean, include_qr boolean, format text,
  created_at timestamptz
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
  ) into v_allowed;
  if not v_allowed then raise exception 'not authorized' using errcode='42501'; end if;

  return query
  select s.id, s.name, s.frequency, s.report_types, s.recipients,
         s.enabled, s.next_run, s.last_run,
         s.include_charts, s.include_qr, s.format, s.created_at
  from public.email_schedules s
  where s.company_id = p_company_id
  order by s.created_at desc;
end $$;
revoke execute on function public.get_email_schedules(uuid) from public, anon;
grant  execute on function public.get_email_schedules(uuid) to authenticated;

create or replace function public.upsert_email_schedule(
  p_company_id     uuid,
  p_id             text,
  p_name           text,
  p_frequency      text,
  p_report_types   text[],
  p_recipients     text[],
  p_enabled        boolean,
  p_next_run       timestamptz default null,
  p_include_charts boolean default false,
  p_include_qr     boolean default false,
  p_format         text default 'pdf'
) returns boolean
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
    where m.company_id = p_company_id and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then raise exception 'only owner/admin can manage schedules' using errcode='42501'; end if;

  insert into public.email_schedules (
    id, company_id, name, frequency, report_types, recipients,
    enabled, next_run, include_charts, include_qr, format
  ) values (
    p_id, p_company_id, p_name, p_frequency, p_report_types, p_recipients,
    p_enabled, p_next_run, p_include_charts, p_include_qr, p_format
  )
  on conflict (id) do update set
    name           = excluded.name,
    frequency      = excluded.frequency,
    report_types   = excluded.report_types,
    recipients     = excluded.recipients,
    enabled        = excluded.enabled,
    next_run       = coalesce(excluded.next_run, public.email_schedules.next_run),
    include_charts = excluded.include_charts,
    include_qr     = excluded.include_qr,
    format         = excluded.format,
    updated_at     = now();
  return true;
end $$;
revoke execute on function public.upsert_email_schedule(uuid, text, text, text, text[], text[], boolean, timestamptz, boolean, boolean, text) from public, anon;
grant  execute on function public.upsert_email_schedule(uuid, text, text, text, text[], text[], boolean, timestamptz, boolean, boolean, text) to authenticated;

create or replace function public.delete_email_schedule(p_id text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_allowed boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select company_id into v_company from public.email_schedules where id = p_id;
  if v_company is null then return true; end if;
  select exists(
    select 1 from public.companies c where c.id = v_company and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = v_company and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then raise exception 'only owner/admin can delete schedules' using errcode='42501'; end if;

  delete from public.email_schedules where id = p_id;
  return true;
end $$;
revoke execute on function public.delete_email_schedule(text) from public, anon;
grant  execute on function public.delete_email_schedule(text) to authenticated;
