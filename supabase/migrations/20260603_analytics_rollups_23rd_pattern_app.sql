-- ═══════════════════════════════════════════════════════════════
-- 2026-06-03 Analytics Rollups (23rd pattern application)
-- ─────────────────────────────────────────────────────────────
-- Closes the last 2 fabricated content blocks in the compliance
-- PDF that needed new server-side aggregations:
--   1. admin_performance — was 6 hardcoded named admins with fake
--      tiers + scores under the user's real company name. False
--      document. Now derived from sos_queue.assigned_by /
--      resolved_by.
--   2. safety_score history — was 7 hardcoded monthly bars
--      (Sep 72 -> Mar 87) and a "Improving — up from 83%" caption.
--      Now derived from sos_queue resolution rate per month.
--
-- Both RPCs are SECDEF, company-scoped via the standard owner /
-- admin / member gate, and return tabular results suitable for
-- jsonb shipping to the PDF generator.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.get_admin_performance(
  p_company_id uuid,
  p_days       integer default 30
) returns table (
  user_id            uuid,
  display_name       text,
  role               text,
  incidents_handled  integer,
  avg_response_sec   integer,
  current_streak     integer
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_since timestamptz := now() - (greatest(1, p_days) * interval '1 day');
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
  with admin_actions as (
    select
      coalesce(q.resolved_by, q.assigned_by) as user_id,
      coalesce(q.assigned_to, 'Admin') as display_name,
      extract(epoch from (q.resolved_at - q.recorded_at))::integer as response_sec,
      q.resolved_at,
      q.recorded_at
    from public.sos_queue q
    where q.company_id = p_company_id
      and q.recorded_at >= v_since
      and (q.resolved_by is not null or q.assigned_by is not null)
  ),
  per_admin as (
    select
      a.user_id,
      max(a.display_name) as display_name,
      count(*)::integer as incidents_handled,
      avg(nullif(a.response_sec, 0))::integer as avg_response_sec,
      (
        select count(distinct date_trunc('day', a2.resolved_at))::integer
        from admin_actions a2
        where a2.user_id = a.user_id
          and a2.resolved_at is not null
          and a2.resolved_at >= now() - interval '14 days'
      ) as current_streak
    from admin_actions a
    where a.user_id is not null
    group by a.user_id
  )
  select
    p.user_id,
    p.display_name,
    coalesce(
      (select cm.role from public.company_memberships cm
       where cm.user_id = p.user_id and cm.company_id = p_company_id limit 1),
      case when exists(select 1 from public.companies c where c.id = p_company_id and c.owner_id = p.user_id)
           then 'owner' else 'admin' end
    ) as role,
    p.incidents_handled,
    coalesce(p.avg_response_sec, 0) as avg_response_sec,
    coalesce(p.current_streak, 0) as current_streak
  from per_admin p
  order by p.incidents_handled desc, p.avg_response_sec asc nulls last
  limit 10;
end $$;
revoke execute on function public.get_admin_performance(uuid, integer) from public, anon;
grant  execute on function public.get_admin_performance(uuid, integer) to authenticated;

create or replace function public.get_safety_score_history(
  p_company_id uuid,
  p_months     integer default 6
) returns table (
  month_label   text,
  sos_count     integer,
  resolved_count integer,
  safety_score  integer
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_since timestamptz := date_trunc('month', now()) - (greatest(1, p_months - 1) * interval '1 month');
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
  with month_buckets as (
    select
      generate_series(
        date_trunc('month', v_since),
        date_trunc('month', now()),
        '1 month'::interval
      ) as bucket
  ),
  monthly as (
    select
      b.bucket,
      to_char(b.bucket, 'Mon')                              as month_label,
      coalesce(count(q.id), 0)::integer                     as sos_count,
      coalesce(sum(case when q.status = 'resolved' then 1 else 0 end), 0)::integer as resolved_count
    from month_buckets b
    left join public.sos_queue q
      on q.company_id = p_company_id
     and date_trunc('month', q.recorded_at) = b.bucket
    group by b.bucket
    order by b.bucket
  )
  select
    m.month_label,
    m.sos_count,
    m.resolved_count,
    case
      when m.sos_count = 0       then 100
      when m.resolved_count = 0  then 0
      else round((m.resolved_count::numeric / m.sos_count) * 100)::integer
    end as safety_score
  from monthly m;
end $$;
revoke execute on function public.get_safety_score_history(uuid, integer) from public, anon;
grant  execute on function public.get_safety_score_history(uuid, integer) to authenticated;
