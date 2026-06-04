-- ═══════════════════════════════════════════════════════════════
-- 2026-06-03 Emergency resolve + dispatch SECDEF RPCs
-- ─────────────────────────────────────────────────────────────
-- 17th pattern app follow-up: complete the doctrine alignment.
-- data-layer.resolveEmergency + dispatchTeam currently do direct
-- supabase.from("sos_queue").update() calls (RLS-mediated). This
-- works but breaks consistency with the other 17 pattern apps where
-- all writes go through SECDEF RPCs (auditable, role-gated, single
-- enforcement point).
--
-- Two new SECDEF RPCs:
--   - resolve_emergency: status='resolved', resolved_by from auth.uid().
--     Resolution note can carry the display name (free-text).
--   - dispatch_team: status='investigating', assigned_to + dispatch_note +
--     dispatched_at + assigned_by from auth.uid().
-- ═══════════════════════════════════════════════════════════════

create or replace function public.resolve_emergency(
  p_id              text,
  p_resolved_by_name text default null,
  p_resolution_note  text default null
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
      and m.active = true and m.role in ('owner','admin','dispatcher','safety_manager','responder')
  ) into v_allowed;
  if not v_allowed then raise exception 'not authorized' using errcode='42501'; end if;

  update public.sos_queue
     set status          = 'resolved',
         resolved_at     = now(),
         resolved_by     = v_uid,
         resolution_note = coalesce(p_resolution_note,
                                    case when p_resolved_by_name is not null
                                         then 'Resolved by ' || p_resolved_by_name
                                         else resolution_note end)
   where id = p_id
     and status not in ('resolved','cancelled');
  return true;
end $$;
revoke execute on function public.resolve_emergency(text, text, text) from public, anon;
grant  execute on function public.resolve_emergency(text, text, text) to authenticated;

create or replace function public.dispatch_team(
  p_id              text,
  p_responders      text[],
  p_dispatch_note   text default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_allowed boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if p_responders is null or array_length(p_responders, 1) is null then
    raise exception 'p_responders cannot be empty' using errcode='22023';
  end if;
  select company_id into v_company from public.sos_queue where id = p_id;
  if v_company is null then raise exception 'emergency not found' using errcode='22023'; end if;
  select exists(
    select 1 from public.companies c where c.id = v_company and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = v_company and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin','dispatcher','safety_manager')
  ) into v_allowed;
  if not v_allowed then raise exception 'only owner/admin/dispatcher/safety_manager can dispatch' using errcode='42501'; end if;

  update public.sos_queue
     set status         = 'investigating',
         assigned_to    = array_to_string(p_responders, ','),
         dispatch_note  = p_dispatch_note,
         dispatched_at  = now(),
         assigned_by    = v_uid,
         assigned_at    = now()
   where id = p_id
     and status not in ('resolved','cancelled');
  return true;
end $$;
revoke execute on function public.dispatch_team(text, text[], text) from public, anon;
grant  execute on function public.dispatch_team(text, text[], text) to authenticated;
