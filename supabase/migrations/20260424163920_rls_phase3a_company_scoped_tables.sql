-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: rls_phase3a_company_scoped_tables_2026_04_24_v2
-- Version:   20260424163920
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- RLS Reconcile — Phase 3a v2 (cast text company_id to uuid for helpers)
-- ═══════════════════════════════════════════════════════════════════════════

-- broadcasts
drop policy if exists auth_all_bro on public.broadcasts;
create policy broadcasts_member_read  on public.broadcasts for select to authenticated using (public.is_company_member(company_id));
create policy broadcasts_member_write on public.broadcasts for all    to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- buddy_pairs
drop policy if exists auth_all_bud on public.buddy_pairs;
create policy buddy_pairs_member_read  on public.buddy_pairs for select to authenticated using (public.is_company_member(company_id));
create policy buddy_pairs_member_write on public.buddy_pairs for all    to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- commands
drop policy if exists authenticated_read_commands  on public.commands;
drop policy if exists authenticated_write_commands on public.commands;
create policy commands_member_read  on public.commands for select to authenticated using (public.is_company_member(company_id));
create policy commands_member_write on public.commands for all    to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- company_checkin_sessions (company_id is TEXT — cast)
drop policy if exists allow_all on public.company_checkin_sessions;
create policy checkin_sessions_member_read  on public.company_checkin_sessions for select to authenticated using (public.is_company_member(company_id::uuid));
create policy checkin_sessions_member_write on public.company_checkin_sessions for all    to authenticated using (public.is_company_member(company_id::uuid)) with check (public.is_company_member(company_id::uuid));

-- company_employees
drop policy if exists authenticated_read_employees on public.company_employees;
create policy company_employees_member_read on public.company_employees for select to authenticated using (public.is_company_member(company_id));

-- company_messages
drop policy if exists allow_all on public.company_messages;
create policy company_messages_member_read  on public.company_messages for select to authenticated using (public.is_company_member(company_id));
create policy company_messages_member_write on public.company_messages for all    to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- company_settings
drop policy if exists allow_all on public.company_settings;
create policy company_settings_member_read on public.company_settings for select to authenticated using (public.is_company_member(company_id));
create policy company_settings_owner_write on public.company_settings for all    to authenticated using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));

-- company_working_hours
drop policy if exists allow_all on public.company_working_hours;
create policy working_hours_member_read on public.company_working_hours for select to authenticated using (public.is_company_member(company_id));
create policy working_hours_owner_write on public.company_working_hours for all    to authenticated using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));

-- employee_checkins (company_id is TEXT — cast)
drop policy if exists allow_all on public.employee_checkins;
create policy checkins_member_read  on public.employee_checkins for select to authenticated using (public.is_company_member(company_id::uuid));
create policy checkins_self_write   on public.employee_checkins for insert to authenticated with check (user_id = auth.uid() and public.is_company_member(company_id::uuid));

-- feature_flags
drop policy if exists allow_all on public.feature_flags;
create policy feature_flags_member_read on public.feature_flags for select to authenticated using (public.is_company_member(company_id));
create policy feature_flags_owner_write on public.feature_flags for all    to authenticated using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));

-- files
create policy files_member_read  on public.files for select to authenticated using (public.is_company_member(company_id));
create policy files_member_write on public.files for all    to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- handover_notes
drop policy if exists auth_all_han on public.handover_notes;
create policy handover_notes_member_read  on public.handover_notes for select to authenticated using (public.is_company_member(company_id));
create policy handover_notes_member_write on public.handover_notes for all    to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- invitations
drop policy if exists allow_all_invitations on public.invitations;
create policy invitations_owner_read  on public.invitations for select to authenticated using (public.is_company_owner(company_id));
create policy invitations_owner_write on public.invitations for all    to authenticated using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));

-- invites
drop policy if exists allow_all on public.invites;
create policy invites_owner_read  on public.invites for select to authenticated using (public.is_company_owner(company_id));
create policy invites_owner_write on public.invites for all    to authenticated using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));

-- ire_records
drop policy if exists ire_records_all on public.ire_records;
create policy ire_records_member_read on public.ire_records for select to authenticated using (public.is_company_member(company_id));

-- missions
drop policy if exists auth_all_mis on public.missions;
create policy missions_member_read  on public.missions for select to authenticated using (public.is_company_member(company_id));
create policy missions_member_write on public.missions for all    to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- processes
drop policy if exists allow_all on public.processes;
create policy processes_member_read on public.processes for select to authenticated using (public.is_company_member(company_id));
create policy processes_owner_write on public.processes for all    to authenticated using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));

-- sar_missions
drop policy if exists sar_all on public.sar_missions;
create policy sar_missions_member_read  on public.sar_missions for select to authenticated using (public.is_company_member(company_id));
create policy sar_missions_member_write on public.sar_missions for all    to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- sos_events
drop policy if exists auth_read_sos  on public.sos_events;
drop policy if exists auth_write_sos on public.sos_events;
create policy sos_events_member_read  on public.sos_events for select to authenticated using (public.is_company_member(company_id));
create policy sos_events_member_write on public.sos_events for all    to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- subscriptions
drop policy if exists auth_all_sub on public.subscriptions;
create policy subscriptions_member_read on public.subscriptions for select to authenticated using (public.is_company_member(company_id));
create policy subscriptions_owner_write on public.subscriptions for all    to authenticated using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));

-- tasks
drop policy if exists allow_all on public.tasks;
create policy tasks_member_read  on public.tasks for select to authenticated using (public.is_company_member(company_id));
create policy tasks_member_write on public.tasks for all    to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- user_permissions
drop policy if exists allow_all_permissions on public.user_permissions;
create policy permissions_self_read   on public.user_permissions for select to authenticated using (user_id = auth.uid());
create policy permissions_owner_admin on public.user_permissions for all    to authenticated using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));

-- zones
drop policy if exists authenticated_read_zones  on public.zones;
drop policy if exists authenticated_write_zones on public.zones;
create policy zones_member_read  on public.zones for select to authenticated using (public.is_company_member(company_id));
create policy zones_owner_write  on public.zones for all    to authenticated using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));

-- checkins
drop policy if exists checkins_all on public.checkins;
create policy checkins_company_read on public.checkins for select to authenticated using (public.is_company_member(company_id));
create policy checkins_company_write on public.checkins for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- safety_timers
drop policy if exists allow_all on public.safety_timers;
create policy safety_timers_self on public.safety_timers for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy safety_timers_company_read on public.safety_timers for select to authenticated using (company_id is not null and public.is_company_member(company_id));

-- companies
drop policy if exists allow_insert_companies             on public.companies;
drop policy if exists allow_select_companies             on public.companies;
drop policy if exists allow_update_companies             on public.companies;
drop policy if exists companies_insert_any_authenticated on public.companies;
create policy companies_member_read on public.companies for select to authenticated using (public.is_company_member(id));
create policy companies_owner_update on public.companies for update to authenticated
  using      (owner_user_id = auth.uid() or owner_id = auth.uid())
  with check (owner_user_id = auth.uid() or owner_id = auth.uid());

-- notification_broadcasts (no tenancy column — service_role only)
drop policy if exists "Admins manage broadcasts" on public.notification_broadcasts;
