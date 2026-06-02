-- ═══════════════════════════════════════════════════════════════
-- 2026-06-02 Phase 2 CRIT-7: cross-table search RPC (9th pattern app)
-- ─────────────────────────────────────────────────────────────
-- Audit: global-search.tsx (258 lines) is a pure CLIENT-SIDE filter
-- over whatever happens to be in `employees`/`zones`/`incidents`
-- props. Limitations:
--   - Misses anything not pre-loaded (invitations, geofence_events,
--     audit_log, sos_queue, discreet_sessions)
--   - At 10k+ employees the parent has to preload everything just
--     to filter 6 results
--   - Substring match only (no fuzzy, no ranking by relevance)
--
-- World-class fix:
--   New SECDEF RPC search_company(p_company_id, p_query, p_types[],
--   p_limit) that scans the canonical tables server-side with
--   company-scoped RLS + score-based ranking, returns a unified
--   {type, id, title, subtitle, snippet, score} row shape the UI
--   renders as Spotlight-style results.
--
-- Companion client search-service.ts wraps the RPC with debounce +
-- result-grouping helpers + 10 contract tests.
--
-- Scoring (intentionally simple, stable across versions):
--   100 — query is a PREFIX of the primary title field
--    80 — query appears as substring in the title field
--    50 — query appears only in a secondary field (phone, email, etc.)
-- ═══════════════════════════════════════════════════════════════

create or replace function public.search_company(
  p_company_id uuid,
  p_query      text,
  p_types      text[] default null,
  p_limit      int    default 30
) returns table (
  result_type text,
  result_id   text,
  title       text,
  subtitle    text,
  snippet     text,
  score       int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed boolean;
  v_q       text;
  v_lim     int := greatest(1, least(coalesce(p_limit, 30), 100));
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_query is null or length(trim(p_query)) < 2 then
    return;
  end if;
  v_q := '%' || lower(trim(p_query)) || '%';

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

  if p_types is null or 'employee' = any(p_types) then
    return query
    select 'employee'::text as result_type,
           e.id::text       as result_id,
           coalesce(e.name, '(unnamed)')                                 as title,
           coalesce(e.department, '') || ' · ' || coalesce(e.status, '') as subtitle,
           coalesce(e.phone, '')                                         as snippet,
           case
             when lower(coalesce(e.name,'')) like (lower(trim(p_query)) || '%') then 100
             when lower(coalesce(e.name,'')) like v_q then 80
             else 50
           end as score
      from public.employees e
     where e.company_id = p_company_id
       and (lower(coalesce(e.name,''))       like v_q
         or lower(coalesce(e.phone,''))      like v_q
         or lower(coalesce(e.department,'')) like v_q)
     order by score desc, e.name
     limit v_lim;
  end if;

  if p_types is null or 'zone' = any(p_types) then
    return query
    select 'zone'::text as result_type,
           z.id::text   as result_id,
           coalesce(z.name, '(unnamed)') as title,
           coalesce(z.type, '') || coalesce(' · risk: ' || z.risk_level, '') as subtitle,
           ''::text as snippet,
           case
             when lower(coalesce(z.name,'')) like (lower(trim(p_query)) || '%') then 100
             when lower(coalesce(z.name,'')) like v_q then 80
             else 50
           end as score
      from public.zones z
     where z.company_id = p_company_id
       and (lower(coalesce(z.name,'')) like v_q
         or lower(coalesce(z.type,'')) like v_q)
     order by score desc, z.name
     limit v_lim;
  end if;

  if p_types is null or 'invitation' = any(p_types) then
    return query
    select 'invitation'::text as result_type,
           i.id::text          as result_id,
           coalesce(i.name, i.email)                              as title,
           'invitation · ' || coalesce(i.status, '')              as subtitle,
           coalesce(i.email, '')                                  as snippet,
           case
             when lower(coalesce(i.email,'')) like (lower(trim(p_query)) || '%') then 100
             when lower(coalesce(i.email,'')) like v_q then 80
             else 50
           end as score
      from public.invitations i
     where i.company_id = p_company_id
       and (lower(coalesce(i.email,'')) like v_q
         or lower(coalesce(i.name,''))  like v_q
         or lower(coalesce(i.phone,'')) like v_q)
     order by score desc, i.created_at desc
     limit v_lim;
  end if;

  if p_types is null or 'emergency' = any(p_types) then
    return query
    select 'emergency'::text as result_type,
           s.id::text        as result_id,
           coalesce(s.employee_name, '(unknown)') || ' — SOS'                  as title,
           coalesce(s.zone, '') || ' · ' || coalesce(s.status, 'open')         as subtitle,
           coalesce(s.severity, '') || ' · ' || coalesce(s.trigger_method, '') as snippet,
           case
             when lower(coalesce(s.employee_name,'')) like (lower(trim(p_query)) || '%') then 100
             when lower(coalesce(s.employee_name,'')) like v_q then 80
             else 50
           end as score
      from public.sos_queue s
     where s.company_id = p_company_id
       and (lower(coalesce(s.employee_name,'')) like v_q
         or lower(coalesce(s.zone,''))           like v_q
         or lower(coalesce(s.severity,''))       like v_q)
     order by score desc, s.recorded_at desc
     limit v_lim;
  end if;
end $$;

revoke execute on function public.search_company(uuid, text, text[], int) from public, anon;
grant  execute on function public.search_company(uuid, text, text[], int) to authenticated;

comment on function public.search_company(uuid, text, text[], int) is
  '2026-06-02 CRIT-7 (9th pattern app): cross-table dashboard search. '
  'Scans employees + zones + invitations + sos_queue with company-scope '
  '+ score-based ranking (100=prefix, 80=substring-in-title, 50=other). '
  'Caller can restrict to a subset via p_types. Returns at most p_limit '
  'rows per type. Authorized via owner/admin/employee.';
