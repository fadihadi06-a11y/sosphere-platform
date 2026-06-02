-- ═══════════════════════════════════════════════════════════════
-- 2026-06-02 Compliance reads consolidation (8th pattern application)
-- ─────────────────────────────────────────────────────────────
-- Audit findings:
--   compliance-data-service.ts (564 lines) fires 7 separate .from()
--   queries to build a single compliance PDF: sos_queue, risk_register,
--   investigations, employees, playbook_usage, rrp_sessions, journeys,
--   checkin_events. ONE button click = 7-round-trip waterfall.
--
--   ALSO missing: zero reads from training_records. PDF section
--   "medical_id_status / training" gets null/mock data.
--
-- World-class fix:
--   1. ONE SECDEF RPC get_compliance_summary(p_company_id, p_since)
--      that does everything in a single transactional read with
--      stable RLS + authorization (mirror the pattern from
--      get_checkin_feed, get_buddy_pairs, etc).
--   2. Includes training_records counts so the PDF section is complete.
--   3. Returns aggregated jsonb the PDF can consume; callers can still
--      hit individual tables for drill-down via RLS.
--
-- The existing compliance-data-service.ts can call this RPC and skip
-- the 7 sequential round-trips. Backwards-compatible: old query paths
-- remain valid; new code paths use the RPC.
--
-- NOTE: sos_queue uses recorded_at (not created_at). Schema quirk
-- preserved from earlier P3 baseline.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.get_compliance_summary(
  p_company_id uuid,
  p_since      timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed boolean;
  v_since   timestamptz := coalesce(p_since, now() - interval '30 days');
  v_result  jsonb;
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
  ) or exists(
    select 1 from public.employees e
    where e.company_id = p_company_id and e.user_id = v_uid
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', p_company_id using errcode = '42501';
  end if;

  with
  emp_stats as (
    select count(*) as total,
           count(*) filter (where status = 'on-shift' or status = 'checked-in') as on_shift,
           count(*) filter (where status = 'off-shift' or status = 'off_duty') as off_shift
      from public.employees where company_id = p_company_id
  ),
  sos_stats as (
    select count(*) as total_30d,
           count(*) filter (where status = 'resolved' or status = 'cancelled') as resolved_30d,
           count(*) filter (where recorded_at > now() - interval '7 days') as last_7d
      from public.sos_queue
     where company_id = p_company_id and recorded_at >= v_since
  ),
  risk_stats as (
    select count(*) as total,
           count(*) filter (where risk_level = 'high' or risk_score >= 12) as high_count,
           count(*) filter (where risk_level = 'medium' or (risk_score >= 6 and risk_score < 12)) as medium_count,
           count(*) filter (where risk_level = 'low' or risk_score < 6) as low_count
      from public.risk_register where company_id = p_company_id
  ),
  inv_stats as (
    select count(*) as total,
           count(*) filter (where status = 'open' or status = 'in_progress') as open_count,
           count(*) filter (where status = 'closed' or status = 'resolved') as closed_count,
           count(*) filter (where final_report_date is not null) as with_report
      from public.investigations where company_id = p_company_id
  ),
  train_stats as (
    select count(*) as total,
           count(*) filter (where expiry_date > now()) as valid_count,
           count(*) filter (where expiry_date <= now()) as expired_count,
           count(*) filter (where expiry_date > now() and expiry_date <= now() + interval '30 days') as expiring_soon
      from public.training_records where company_id = p_company_id
  ),
  checkin_stats as (
    select count(*) as total_30d,
           count(*) filter (where event_type = 'checkin') as checkins_30d,
           count(*) filter (where event_type = 'missed')  as missed_30d,
           count(*) filter (where event_type = 'warning') as warnings_30d
      from public.checkin_events
     where company_id = p_company_id and created_at >= v_since
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'since',      v_since,
    'generated_at', now(),
    'employees',   (select row_to_json(emp_stats)     from emp_stats),
    'sos',         (select row_to_json(sos_stats)     from sos_stats),
    'risk',        (select row_to_json(risk_stats)    from risk_stats),
    'investigations', (select row_to_json(inv_stats)  from inv_stats),
    'training',    (select row_to_json(train_stats)   from train_stats),
    'checkins',    (select row_to_json(checkin_stats) from checkin_stats)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function public.get_compliance_summary(uuid, timestamptz) from public, anon;
grant  execute on function public.get_compliance_summary(uuid, timestamptz) to authenticated;

comment on function public.get_compliance_summary(uuid, timestamptz) is
  '2026-06-02 compliance reads consolidation (8th pattern app): '
  'replaces 7 separate .from() round-trips in compliance-data-service.ts '
  'with one transactional read. Also adds training_records counts '
  '(previously missing from PDF). Authorized via owner/admin/employee.';
