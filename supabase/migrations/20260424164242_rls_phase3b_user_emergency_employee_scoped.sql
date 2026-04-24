-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: rls_phase3b_user_emergency_employee_scoped_2026_04_24
-- Version:   20260424164242
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- RLS Reconcile — Phase 3b: user-scoped + emergency-scoped + employee-scoped
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── USER-SCOPED (owner = auth.uid()) ─────────────────────────────────

-- individual_users
drop policy if exists auth_all_ind on public.individual_users;
create policy individual_users_self on public.individual_users
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notifications (receiver reads own; system/service_role writes)
drop policy if exists "System inserts notifications" on public.notifications;
create policy notifications_self_read on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_self_mark on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- safe_trips
drop policy if exists allow_all on public.safe_trips;
create policy safe_trips_self on public.safe_trips
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- sos_timers
drop policy if exists allow_all on public.sos_timers;
create policy sos_timers_self on public.sos_timers
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- user_contacts (emergency-contact address book per user)
drop policy if exists allow_all on public.user_contacts;
create policy user_contacts_self on public.user_contacts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- zone_reports (hazard reports from workers — public-view style in some ops,
-- but we scope to the author for read; admins read via company membership
-- requires joining the zone to a company — deferred since zone_reports
-- has no company_id. Authors + service_role for now.)
drop policy if exists "Everyone views zone reports" on public.zone_reports;
create policy zone_reports_self_read on public.zone_reports
  for select to authenticated using (user_id = auth.uid());

-- ─── EMERGENCY-SCOPED (join via emergencies or sos_queue) ─────────────

-- call_logs (emergency_id → emergencies.id, bigint join)
drop policy if exists allow_all on public.call_logs;
create policy call_logs_owner_read on public.call_logs for select to authenticated using (
  exists (
    select 1 from public.emergencies e
    where e.id = call_logs.emergency_id
      and (e.user_id = auth.uid()
           or (e.company_id is not null and public.is_company_member(e.company_id)))
  )
);

-- emergency_call_attempts
drop policy if exists allow_all on public.emergency_call_attempts;
create policy call_attempts_owner_read on public.emergency_call_attempts for select to authenticated using (
  exists (
    select 1 from public.emergencies e
    where e.id = emergency_call_attempts.emergency_id
      and (e.user_id = auth.uid()
           or (e.company_id is not null and public.is_company_member(e.company_id)))
  )
);

-- emergency_claims
drop policy if exists allow_all on public.emergency_claims;
create policy claims_owner_read on public.emergency_claims for select to authenticated using (
  exists (
    select 1 from public.emergencies e
    where e.id = emergency_claims.emergency_id
      and (e.user_id = auth.uid()
           or (e.company_id is not null and public.is_company_member(e.company_id)))
  )
);

-- emergency_logs (emergency_id:bigint)
drop policy if exists "System inserts logs" on public.emergency_logs;
create policy emergency_logs_owner_read on public.emergency_logs for select to authenticated using (
  exists (
    select 1 from public.emergencies e
    where e.id = emergency_logs.emergency_id
      and (e.user_id = auth.uid()
           or (e.company_id is not null and public.is_company_member(e.company_id)))
  )
);

-- rrp_sessions (emergency_id:text → sos_queue.emergency_id text OR sos_sessions.id uuid cast)
create policy rrp_sessions_owner_read on public.rrp_sessions for select to authenticated using (
  exists (
    select 1 from public.sos_queue q
    where q.emergency_id = rrp_sessions.emergency_id
      and public.is_company_member(q.company_id)
  )
  or exists (
    select 1 from public.sos_sessions s
    where s.id::text = rrp_sessions.emergency_id
      and (s.user_id = auth.uid()
           or (s.company_id is not null and public.is_company_member(s.company_id)))
  )
);

-- ─── EMPLOYEE-SCOPED (join via employees.id) ──────────────────────────

-- checkin_events (employee_id:text — cast employees.id::text)
create policy checkin_events_self_read on public.checkin_events for select to authenticated using (
  exists (
    select 1 from public.employees e
    where e.id::text = checkin_events.employee_id
      and (e.user_id = auth.uid() or public.is_company_member(e.company_id))
  )
);
create policy checkin_events_self_write on public.checkin_events for insert to authenticated with check (
  exists (
    select 1 from public.employees e
    where e.id::text = checkin_events.employee_id and e.user_id = auth.uid()
  )
);

-- company_message_recipients (employee_id:uuid — direct join)
create policy recipients_self_read on public.company_message_recipients for select to authenticated using (
  exists (
    select 1 from public.employees e
    where e.id = company_message_recipients.employee_id
      and (e.user_id = auth.uid() or public.is_company_member(e.company_id))
  )
);

-- company_message_rsvps
create policy rsvps_self on public.company_message_rsvps for all to authenticated
using (
  exists (
    select 1 from public.employees e
    where e.id = company_message_rsvps.employee_id and e.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.employees e
    where e.id = company_message_rsvps.employee_id and e.user_id = auth.uid()
  )
);

-- contacts (employee contact list — employee_id:uuid)
drop policy if exists contacts_all on public.contacts;
create policy contacts_self on public.contacts for all to authenticated
using (
  exists (
    select 1 from public.employees e
    where e.id = contacts.employee_id and e.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.employees e
    where e.id = contacts.employee_id and e.user_id = auth.uid()
  )
);

-- risk_scores (employee_id:bigint, employees.id:uuid — type mismatch)
-- Lock to service_role only (default-deny for client). Schema migration
-- needed to reconcile types.
drop policy if exists auth_all_risk on public.risk_scores;
-- No policy added → service_role bypass only.
