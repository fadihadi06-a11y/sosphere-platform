-- ═══════════════════════════════════════════════════════════════════════════
-- W3-20 + W3-23 (Wave 3 red-team, 2026-04-26): repair delete_user_completely.
--
-- BUG W3-20: after B-15/B-16 migrated gps_trail.employee_id and
--   evidence_vaults.user_id from text → uuid, the RPC was never updated:
--     • `where employee_id = p_user_id::text`  → uuid = text mismatch (FAIL)
--     • `where user_id::text = p_user_id::text` → text = text via cast (slow,
--                                                  bypasses pkey index)
--   GDPR Article 17 (right to erasure) is partially broken: the server returns
--   success=true but gps_trail rows are NEVER deleted because the WHERE
--   clause errors out (or in the milder text=text variant, doesn't use index).
--
-- BUG W3-23: the RPC never deletes the user's `subscriptions` row.
--   It relied on auth.users CASCADE — but subscriptions.user_id may not
--   have an ON DELETE CASCADE FK. Result: user requests deletion, app
--   confirms, but Stripe customer + subscription row stay in DB. If their
--   card auto-renews next month, Stripe still charges the orphan customer.
--
-- FIX:
--   • gps_trail:       `where employee_id = p_user_id`  (uuid = uuid, indexed)
--   • evidence_vaults: `where user_id = p_user_id`      (uuid = uuid, indexed)
--   • subscriptions:   explicit DELETE before profiles delete
--
-- Idempotent: CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_user_completely(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
declare
  v_owned_companies         uuid[];
  v_companies_with_others   uuid[];
  v_solo_companies          uuid[];
  v_company_id              uuid;
begin
  if p_user_id is null then raise exception 'p_user_id required'; end if;

  select coalesce(array_agg(id), array[]::uuid[]) into v_owned_companies
  from public.companies
  where owner_user_id = p_user_id or owner_id = p_user_id;

  if array_length(v_owned_companies, 1) > 0 then
    select coalesce(array_agg(c), array[]::uuid[])
      into v_companies_with_others
    from unnest(v_owned_companies) c
    where exists (
      select 1 from public.employees e
      where e.company_id = c and e.user_id <> p_user_id
    ) or exists (
      select 1 from public.company_memberships m
      where m.company_id = c and m.user_id <> p_user_id and m.active
    );

    if array_length(v_companies_with_others, 1) > 0 then
      return jsonb_build_object(
        'success', false,
        'error', 'ownership_conflict',
        'message', 'You own one or more companies that still have other members. Transfer ownership first, then retry deletion.',
        'companies', v_companies_with_others
      );
    end if;

    select coalesce(array_agg(c), array[]::uuid[]) into v_solo_companies
    from unnest(v_owned_companies) c;
  end if;

  begin
    perform public.log_sos_audit(
      'user_self_deleted', '[deleted user]', 'worker', 'gdpr_erasure',
      p_user_id::text, null,
      jsonb_build_object('source','delete_user_completely',
                         'owned_solo_companies', to_jsonb(v_solo_companies),
                         'requested_at', now())
    );
  exception when others then null; end;

  delete from public.sos_messages       where from_user_id = p_user_id;
  delete from public.direct_messages    where sender_id    = p_user_id;
  delete from public.announcements      where sender_id    = p_user_id;
  delete from public.announcement_responses where user_id = p_user_id;
  delete from public.notifications      where user_id      = p_user_id;
  delete from public.push_tokens        where user_id      = p_user_id;
  delete from public.sos_outbox         where to_user_id   = p_user_id;
  delete from public.duty_status        where user_id      = p_user_id;
  delete from public.safe_trips         where user_id      = p_user_id;
  delete from public.safety_timers      where user_id      = p_user_id;
  delete from public.sos_timers         where user_id      = p_user_id;
  delete from public.employee_checkins  where user_id      = p_user_id;
  delete from public.tasks              where user_id      = p_user_id;
  delete from public.user_contacts      where user_id      = p_user_id;
  delete from public.emergency_contacts where user_id      = p_user_id;
  delete from public.call_chains        where user_id      = p_user_id;
  delete from public.zone_reports       where user_id      = p_user_id;
  delete from public.profile_trigger_logs where user_id   = p_user_id;
  delete from public.biometric_verifications where user_id = p_user_id;
  delete from public.civilian_incidents where user_id      = p_user_id;
  -- W3-20: evidence_vaults.user_id is uuid (B-16). Direct equality, indexed.
  delete from public.evidence_vaults    where user_id      = p_user_id;
  delete from public.individual_users   where user_id      = p_user_id;
  -- W3-20: gps_trail.employee_id is uuid (B-15). The pre-fix `::text` cast
  -- caused a uuid=text type mismatch and silently dropped this DELETE.
  delete from public.gps_trail          where employee_id  = p_user_id;
  delete from public.family_memberships where user_id      = p_user_id;
  delete from public.workspace_members  where user_id      = p_user_id;
  delete from public.company_memberships where user_id     = p_user_id;
  delete from public.family_contacts    where owner_user_id = p_user_id;
  delete from public.user_permissions   where user_id      = p_user_id;
  -- W3-23 (B-20, 2026-04-26): explicitly delete subscriptions row. Was
  -- relying on auth.users CASCADE which may not exist on the FK. Without
  -- this, user "deletes account" but Stripe customer / sub row stays.
  delete from public.subscriptions      where user_id      = p_user_id;

  delete from public.sos_sessions where user_id = p_user_id and company_id is null;
  delete from public.emergencies  where user_id = p_user_id and company_id is null;

  update public.sos_queue set
    employee_id       = null,
    employee_name     = '[deleted user]',
    acknowledged_by   = case when acknowledged_by = p_user_id        then null else acknowledged_by end,
    assigned_by       = case when assigned_by     = p_user_id        then null else assigned_by     end,
    assigned_to       = case when assigned_to     = p_user_id::text  then null else assigned_to     end,
    resolved_by       = case when resolved_by     = p_user_id        then null else resolved_by     end,
    reviewed_by       = case when reviewed_by     = p_user_id        then null else reviewed_by     end,
    broadcast_by      = case when broadcast_by    = p_user_id        then null else broadcast_by    end,
    forwarded_by      = case when forwarded_by    = p_user_id        then null else forwarded_by    end
    where employee_id      = p_user_id
       or acknowledged_by  = p_user_id
       or assigned_by      = p_user_id
       or assigned_to      = p_user_id::text
       or resolved_by      = p_user_id
       or reviewed_by      = p_user_id
       or broadcast_by     = p_user_id
       or forwarded_by     = p_user_id;

  update public.sos_sessions set user_id = null
   where user_id = p_user_id and company_id is not null;

  update public.emergencies
     set user_id     = case when user_id = p_user_id then null else user_id end,
         resolved_by = case when resolved_by = p_user_id::text then null else resolved_by end
   where company_id is not null
     and (user_id = p_user_id or resolved_by = p_user_id::text);

  update public.audit_log
     set actor = '[deleted user]', actor_id = null, actor_name = null
   where actor_id = p_user_id::text;

  update public.audit_logs set user_id = null where user_id = p_user_id;

  update public.invitations         set invited_by = null where invited_by = p_user_id;
  update public.company_invitations set created_by = null where created_by = p_user_id;
  update public.notification_broadcasts set admin_id = null where admin_id = p_user_id;
  update public.user_permissions    set updated_by = null where updated_by = p_user_id;

  update public.family_contacts set contact_user_id = null where contact_user_id = p_user_id;

  delete from public.emergency_recipients where recipient_user_id = p_user_id;

  update public.sensor_events set resolved_by = null where resolved_by = p_user_id::text;

  delete from public.employees where user_id = p_user_id;
  delete from public.profiles  where id = p_user_id or user_id = p_user_id;

  if array_length(v_solo_companies, 1) > 0 then
    foreach v_company_id in array v_solo_companies loop
      delete from public.companies where id = v_company_id;
    end loop;
  end if;

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'solo_companies_deleted', coalesce(array_length(v_solo_companies, 1), 0),
    'completed_at', now()
  );
end;
$function$;
