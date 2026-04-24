-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: delete_user_completely_rpc_2026_04_24
-- Version:   20260424191847
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- delete_user_completely — GDPR Art. 17 compliant user erasure
-- ─────────────────────────────────────────────────────────────────────────
-- Strategy (hybrid, GDPR-approved):
--   CATEGORY A — DELETE ENTIRELY: purely personal records that nobody
--                else has a legitimate interest in keeping.
--   CATEGORY B — ANONYMIZE: company-owned incident / audit records.
--                We null the user link and replace the name with
--                '[deleted user]' so the company's legal audit chain
--                remains intact but no longer identifies the person.
--   CATEGORY C — OWNERSHIP REFUSAL: if the user owns a company that
--                has other active members, we refuse and return an
--                error code — they must transfer ownership first.
--                If the company is solo, we cascade-delete it.
--
-- Order of operations (children before parents to respect FK constraints):
--   1. Check ownership refusal guard
--   2. Write the FINAL audit row ("user_self_deleted") BEFORE deletion
--   3. Delete leaf child tables (messages, events, logs)
--   4. Anonymize company-owned audit + incident records
--   5. Delete user-scoped personal tables
--   6. Delete membership rows
--   7. Delete employee row (if employee) / individual_users (if civilian)
--   8. Delete profile
--   9. If solo-owner: cascade-delete the company
--   10. Caller (the edge function) deletes auth.users row + Storage objects
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.delete_user_completely(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned_companies         uuid[];
  v_companies_with_others   uuid[];
  v_solo_companies          uuid[];
  v_deleted_counts          jsonb := '{}'::jsonb;
  v_anonymized_counts       jsonb := '{}'::jsonb;
  v_company_id              uuid;
begin
  -- GUARD: must pass a user id
  if p_user_id is null then
    raise exception 'p_user_id required';
  end if;

  -- ── CATEGORY C: ownership refusal guard ─────────────────────────────
  -- Find companies owned by this user.
  select coalesce(array_agg(id), array[]::uuid[]) into v_owned_companies
  from public.companies
  where owner_user_id = p_user_id or owner_id = p_user_id;

  if array_length(v_owned_companies, 1) > 0 then
    -- Partition owned companies: solo (no other members) vs has-others.
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

    -- All owned companies are solo → they will be cascade-deleted at the end.
    select coalesce(array_agg(c), array[]::uuid[])
      into v_solo_companies
    from unnest(v_owned_companies) c;
  end if;

  -- ── STEP 2: FINAL AUDIT ROW (before any deletion) ───────────────────
  -- This row survives the deletion. Critical for proving the user
  -- initiated their own erasure and at what time.
  begin
    perform public.log_sos_audit(
      'user_self_deleted',
      '[deleted user]',   -- actor display — PII stripped immediately
      'worker',
      'gdpr_erasure',
      p_user_id::text,
      null,
      jsonb_build_object(
        'source',            'delete_user_completely',
        'owned_solo_companies', to_jsonb(v_solo_companies),
        'requested_at',      now()
      )
    );
  exception when others then
    -- log_sos_audit absence shouldn't block deletion; fall through.
    null;
  end;

  -- ── STEP 3: leaf / child tables (delete entirely) ───────────────────
  -- These all have user_id/sender_id/etc. pointing at p_user_id.

  -- Messages + direct channels
  delete from public.sos_messages       where from_user_id    = p_user_id;
  delete from public.direct_messages    where sender_id       = p_user_id;
  delete from public.announcements      where sender_id       = p_user_id;
  delete from public.announcement_responses where user_id    = p_user_id;

  -- Notifications + push
  delete from public.notifications      where user_id         = p_user_id;
  delete from public.push_tokens        where user_id         = p_user_id;
  delete from public.sos_outbox         where to_user_id      = p_user_id;

  -- Timers + duty + check-ins
  delete from public.duty_status        where user_id         = p_user_id;
  delete from public.safe_trips         where user_id         = p_user_id;
  delete from public.safety_timers      where user_id         = p_user_id;
  delete from public.sos_timers         where user_id         = p_user_id;
  delete from public.employee_checkins  where user_id         = p_user_id;
  delete from public.tasks              where user_id         = p_user_id;

  -- Personal lists
  delete from public.user_contacts      where user_id         = p_user_id;
  delete from public.emergency_contacts where user_id         = p_user_id;
  delete from public.call_chains        where user_id         = p_user_id;
  delete from public.zone_reports       where user_id         = p_user_id;
  delete from public.profile_trigger_logs where user_id       = p_user_id;

  -- Biometric enrollment
  delete from public.biometric_verifications where user_id    = p_user_id;

  -- Civilian personal records
  delete from public.civilian_incidents where user_id          = p_user_id;
  delete from public.evidence_vaults    where user_id::text    = p_user_id::text;
  delete from public.individual_users   where user_id          = p_user_id;

  -- GPS trail — user might have rows where employee_id stores the uuid as text
  delete from public.gps_trail          where employee_id     = p_user_id::text;

  -- Memberships
  delete from public.family_memberships where user_id         = p_user_id;
  delete from public.workspace_members  where user_id         = p_user_id;
  delete from public.company_memberships where user_id        = p_user_id;

  -- Family contact lists the user owned (their own list)
  delete from public.family_contacts    where owner_user_id   = p_user_id;

  -- Permissions (user_id is the grantee)
  delete from public.user_permissions   where user_id         = p_user_id;

  -- Civilian-owned SOS sessions (no company_id) — delete entirely.
  -- Employee SOS sessions with company_id → anonymize (company's record).
  delete from public.sos_sessions
    where user_id = p_user_id and company_id is null;

  -- Civilian-owned emergencies — same logic.
  delete from public.emergencies
    where user_id = p_user_id and company_id is null;

  -- ── STEP 4: ANONYMIZE company-owned records ─────────────────────────
  -- Employee-context SOS queue rows. The company has a legitimate
  -- interest in keeping the incident record (legal / insurance /
  -- safety analysis) but the user's identity is erased.

  update public.sos_queue set
    employee_id       = null,
    employee_name     = '[deleted user]',
    acknowledged_by   = case when acknowledged_by = p_user_id then null else acknowledged_by end,
    assigned_by       = case when assigned_by     = p_user_id then null else assigned_by     end,
    assigned_to       = case when assigned_to     = p_user_id::text then null else assigned_to end,
    resolved_by       = case when resolved_by     = p_user_id then null else resolved_by     end,
    reviewed_by       = case when reviewed_by     = p_user_id then null else reviewed_by     end,
    broadcast_by      = case when broadcast_by    = p_user_id then null else broadcast_by    end,
    forwarded_by      = case when forwarded_by    = p_user_id then null else forwarded_by    end
    where employee_id      = p_user_id
       or acknowledged_by  = p_user_id
       or assigned_by      = p_user_id
       or assigned_to      = p_user_id::text
       or resolved_by      = p_user_id
       or reviewed_by      = p_user_id
       or broadcast_by     = p_user_id
       or forwarded_by     = p_user_id;

  -- sos_sessions that are employee-owned → anonymize user_id but
  -- preserve the row for company audit.
  update public.sos_sessions
     set user_id = null
   where user_id = p_user_id and company_id is not null;

  -- emergencies with company_id → anonymize
  update public.emergencies
     set user_id     = case when user_id     = p_user_id then null else user_id     end,
         resolved_by = case when resolved_by = p_user_id then null else resolved_by end
   where company_id is not null
     and (user_id = p_user_id or resolved_by = p_user_id);

  -- audit_log (both variants) — preserve rows, strip identity
  update public.audit_log
     set actor        = '[deleted user]',
         actor_id     = null,
         actor_name   = null
   where actor_id = p_user_id::text;

  update public.audit_logs
     set user_id      = null
   where user_id = p_user_id;

  -- Invitations / broadcasts created by this user → anonymize
  update public.invitations         set invited_by = null where invited_by = p_user_id;
  update public.company_invitations set created_by = null where created_by = p_user_id;
  update public.notification_broadcasts set admin_id = null where admin_id = p_user_id;
  update public.user_permissions    set updated_by = null where updated_by = p_user_id;

  -- Someone else's family list has this user as a contact → anonymize (preserve row)
  update public.family_contacts set contact_user_id = null where contact_user_id = p_user_id;

  -- Someone marked this user as their emergency recipient → DELETE the link
  delete from public.emergency_recipients where recipient_user_id = p_user_id;

  -- sensor_events.resolved_by (if present) → anonymize
  update public.sensor_events set resolved_by = null where resolved_by = p_user_id;

  -- ── STEP 5: employee row (if any) ───────────────────────────────────
  -- By this point all FKs to employees have been anonymized. Safe to delete.
  delete from public.employees where user_id = p_user_id;

  -- ── STEP 6: profile (last user-identifying row) ─────────────────────
  -- profiles.id = user_id OR profiles.user_id = user_id (depending on migration)
  delete from public.profiles where id = p_user_id or user_id = p_user_id;

  -- ── STEP 7: solo-owned companies cascade ────────────────────────────
  -- Any remaining solo company where this user is the sole owner →
  -- cascade delete the company. Its FK cascades will handle downstream
  -- cleanup of zones/broadcasts/subscriptions/etc.
  if array_length(v_solo_companies, 1) > 0 then
    foreach v_company_id in array v_solo_companies loop
      delete from public.companies where id = v_company_id;
    end loop;
  end if;

  -- ── Return summary ──────────────────────────────────────────────────
  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'solo_companies_deleted', coalesce(array_length(v_solo_companies, 1), 0),
    'completed_at', now()
  );
end;
$$;

grant execute on function public.delete_user_completely(uuid) to service_role;

-- Only service_role (edge functions) can call this. Clients cannot directly
-- invoke it — they go through the delete-account edge function which does
-- the extra steps (auth re-verification, Storage cleanup, auth.users delete).
revoke execute on function public.delete_user_completely(uuid) from anon, authenticated;

comment on function public.delete_user_completely(uuid) is
  '2026-04-24: GDPR Art. 17 full erasure. Deletes personal records + anonymizes company-owned audit/incident rows. Returns {success, ...} or {success:false, error:"ownership_conflict"} if user owns a non-solo company.';
