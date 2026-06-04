-- ═══════════════════════════════════════════════════════════════
-- 2026-06-03 Generated Reports (22nd pattern application)
-- ─────────────────────────────────────────────────────────────
-- Closes the C-4 follow-up. compliance-reports.tsx's RECENT_REPORTS
-- list was previously 5 hardcoded fixture rows rendered under the
-- user's real company name (false-document liability). Earlier
-- commit emptied the array as a stopgap. This commit builds the
-- proper persistence:
--   1. generated_reports table (one row per PDF generated, with
--      sections + format + filename + verification_id).
--   2. SECDEF RPCs:
--      - record_generated_report: write hook called from generatePDF
--        on successful doc.save.
--      - get_generated_reports: admin reader (returns most recent N).
--   3. RLS company-scoped reads.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.generated_reports (
  id              text primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  title           text not null,
  type            text not null check (type in ('incident','monthly','quarterly','audit','custom','performance')),
  period          text,
  sections        text[] not null default '{}',
  page_count      integer,
  size_bytes      bigint,
  filename        text,
  verification_id text,
  format          text not null default 'detailed' check (format in ('detailed','executive','legal')),
  was_encrypted   boolean not null default false,
  auto_scheduled  boolean not null default false,
  generated_by    uuid references auth.users(id) on delete set null,
  generated_at    timestamptz not null default now()
);

create index if not exists generated_reports_company_recent_idx
  on public.generated_reports(company_id, generated_at desc);

alter table public.generated_reports enable row level security;

drop policy if exists generated_reports_company_read on public.generated_reports;
create policy generated_reports_company_read on public.generated_reports
  for select using (
    company_id in (select c.id from public.companies c where c.owner_id = (select auth.uid()))
    or company_id in (
      select m.company_id from public.company_memberships m
      where m.user_id = (select auth.uid()) and m.active = true
    )
  );

create or replace function public.record_generated_report(
  p_company_id      uuid,
  p_id              text,
  p_title           text,
  p_type            text,
  p_period          text default null,
  p_sections        text[] default '{}',
  p_page_count      integer default null,
  p_size_bytes      bigint default null,
  p_filename        text default null,
  p_verification_id text default null,
  p_format          text default 'detailed',
  p_was_encrypted   boolean default false,
  p_auto_scheduled  boolean default false
) returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if p_company_id is null or p_id is null then
    raise exception 'p_company_id and p_id required' using errcode='22023';
  end if;
  select exists(
    select 1 from public.companies c where c.id = p_company_id and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = v_uid and m.active = true
  ) into v_allowed;
  if not v_allowed then raise exception 'not authorized' using errcode='42501'; end if;

  insert into public.generated_reports (
    id, company_id, title, type, period, sections, page_count, size_bytes,
    filename, verification_id, format, was_encrypted, auto_scheduled,
    generated_by, generated_at
  ) values (
    p_id, p_company_id, p_title, p_type, p_period, p_sections, p_page_count, p_size_bytes,
    p_filename, p_verification_id, p_format, p_was_encrypted, p_auto_scheduled,
    v_uid, now()
  )
  on conflict (id) do nothing;
  return p_id;
end $$;
revoke execute on function public.record_generated_report(uuid, text, text, text, text, text[], integer, bigint, text, text, text, boolean, boolean) from public, anon;
grant  execute on function public.record_generated_report(uuid, text, text, text, text, text[], integer, bigint, text, text, text, boolean, boolean) to authenticated;

create or replace function public.get_generated_reports(
  p_company_id uuid,
  p_limit      integer default 50
) returns table (
  id text, title text, type text, period text, sections text[],
  page_count integer, size_bytes bigint, filename text, verification_id text,
  format text, was_encrypted boolean, auto_scheduled boolean,
  generated_at timestamptz
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
  select r.id, r.title, r.type, r.period, r.sections,
         r.page_count, r.size_bytes, r.filename, r.verification_id,
         r.format, r.was_encrypted, r.auto_scheduled, r.generated_at
  from public.generated_reports r
  where r.company_id = p_company_id
  order by r.generated_at desc
  limit greatest(1, least(p_limit, 200));
end $$;
revoke execute on function public.get_generated_reports(uuid, integer) from public, anon;
grant  execute on function public.get_generated_reports(uuid, integer) to authenticated;
