-- ═══════════════════════════════════════════════════════════════
-- 2026-06-01 Phase 2 CRIT-4-B: buddy push server-side path
-- ─────────────────────────────────────────────────────────────
-- Problem (pre-fix):
--   Buddy A's SOS fires emitSyncEvent("BUDDY_ALERT", {buddyId})
--   but buddyId is the EMPLOYEE id (uuid). The send-push-notification
--   edge function needs a USER id (auth.users.id). There is no
--   client-resolvable path from one to the other (RLS would block
--   reading other users' employees rows for cross-user lookup), so
--   buddy B's device never receives the push. CRIT-4 part A (commit
--   69408a2) fixed buddy_pairs PERSISTENCE; this fixes the DELIVERY.
--
-- World-class fix (mirrors CRIT-2/3/4-A/3-P2 pattern):
--   1. SECDEF RPC get_buddy_user_ids(p_self_user_id) joins the chain
--      employees(user_id) → buddy_pairs(employee_a/b_id) →
--      employees(id) → user_id of the buddy(ies). Returns ALL
--      currently-active buddies for the caller (typically 1, but
--      schema supports multi-buddy).
--   2. Authorization: caller can only resolve buddies for themselves
--      (p_self_user_id must equal auth.uid()) OR can be called by
--      the SOS edge function with service-role privileges (the SECDEF
--      bypass + the explicit equality check below).
--   3. Returns {buddy_user_id, buddy_employee_id, buddy_name,
--      buddy_phone, company_id, pair_id} — phone enables Twilio SMS
--      fallback when push fails / no device token registered.
--
-- Companion client (buddy-push-service.ts) wraps this RPC + calls
-- send-push-notification edge function for each returned buddy, with
-- Twilio SMS fallback when push_tokens is empty for the target user.
-- See SECURITY_DECISIONS.md for the pattern's rationale.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.get_buddy_user_ids(p_self_user_id uuid default null)
returns table (
  buddy_user_id     uuid,
  buddy_employee_id uuid,
  buddy_name        text,
  buddy_phone       text,
  company_id        uuid,
  pair_id           uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_self_uid   uuid := coalesce(p_self_user_id, auth.uid());
  v_caller_uid uuid := auth.uid();
begin
  if v_self_uid is null then
    raise exception 'self user id required' using errcode = '22023';
  end if;
  -- Authorization: callers can only resolve buddies for themselves
  -- unless this is a service-role invocation (auth.uid() = null).
  -- Service-role bypass intentional — this RPC needs to be callable
  -- from edge functions on behalf of users for the SOS fan-out.
  if v_caller_uid is not null and v_caller_uid <> v_self_uid then
    raise exception 'not authorized to resolve buddies for other users' using errcode = '42501';
  end if;

  return query
  with self_emp as (
    -- Find the employee row for the self user (across all companies they belong to)
    select e.id as emp_id, e.company_id
      from public.employees e
     where e.user_id = v_self_uid
  ),
  pairs as (
    -- Find all active buddy_pairs rows where self is on either side
    select bp.id as pair_id,
           bp.company_id,
           case
             when bp.employee_a_id = se.emp_id::text then bp.employee_b_id
             when bp.employee_b_id = se.emp_id::text then bp.employee_a_id
           end as buddy_emp_text
      from public.buddy_pairs bp
      join self_emp se on se.company_id = bp.company_id
     where bp.is_active = true
       and (bp.employee_a_id = se.emp_id::text or bp.employee_b_id = se.emp_id::text)
  )
  select
    e.user_id            as buddy_user_id,
    e.id                 as buddy_employee_id,
    e.name               as buddy_name,
    e.phone              as buddy_phone,
    p.company_id         as company_id,
    p.pair_id            as pair_id
  from pairs p
  join public.employees e
    on e.company_id = p.company_id
   and e.id::text = p.buddy_emp_text
  where e.user_id is not null;
end $$;

revoke execute on function public.get_buddy_user_ids(uuid) from public, anon;
grant  execute on function public.get_buddy_user_ids(uuid) to authenticated, service_role;
