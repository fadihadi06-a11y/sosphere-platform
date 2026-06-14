-- ════════════════════════════════════════════════════════════════
-- Systemic RLS least-privilege sweep (dark-angle audit 2026-06-14).
--
-- Same root pattern as the missions fix: many tables had cmd=ALL policies
-- keyed on is_company_member(company_id) or the jwt 'company_id' claim that
-- the access-token hook injects into EVERY worker's JWT. That gave every
-- plain worker UPDATE/DELETE/INSERT of ALL company rows — including deleting/
-- forging audit logs, suppressing or deleting another worker's SOS, tampering
-- with evidence (chain-of-custody) and others' GPS trails, or posting company
-- broadcasts.
--
-- Verified beforehand: 16 affected tables have ZERO client-side writes (writes
-- go through SECURITY DEFINER RPCs / triggers / edge functions that bypass
-- RLS). The SOS projection triggers (project_*_to_queue) are all SECDEF.
--
-- NEW MODEL: admin/owner (is_company_admin) full write; plain workers keep
-- ONLY their legitimate self-writes (evidence/checklist INSERT, gps_trail own
-- rows, safety_timers self). Member SELECT policies left intact.
--
-- Verified after (rolled-back, real worker + owner JWTs):
--   worker insert broadcasts/sos_queue/audit_logs/tasks -> 42501 BLOCKED
--   worker insert checklist/evidence/gps(self)          -> RLS PASS (allowed)
--   worker insert gps(another worker)                   -> 42501 BLOCKED
--   owner insert broadcasts/sos_queue                   -> RLS PASS (allowed)
--   residual ALL/UPDATE/DELETE worker-writable policies -> 0
-- ════════════════════════════════════════════════════════════════

-- ── Group A: worker-write was unused → admin-only write ──────────
drop policy if exists broadcasts_member_write              on public.broadcasts;
drop policy if exists broadcasts_own_company               on public.broadcasts;
create policy broadcasts_admin_all on public.broadcasts
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists announcements_own_company            on public.announcements;
create policy announcements_admin_all on public.announcements
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists tasks_member_write                   on public.tasks;
drop policy if exists tasks_own_company                    on public.tasks;
create policy tasks_admin_all on public.tasks
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists files_member_write                   on public.files;
create policy files_admin_all on public.files
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists commands_member_write                on public.commands;
create policy commands_admin_all on public.commands
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists sar_missions_member_write            on public.sar_missions;
create policy sar_missions_admin_all on public.sar_missions
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists handover_notes_member_write          on public.handover_notes;
create policy handover_notes_admin_all on public.handover_notes
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists company_messages_member_write        on public.company_messages;
create policy company_messages_admin_all on public.company_messages
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists checkin_sessions_member_write        on public.company_checkin_sessions;
create policy checkin_sessions_admin_all on public.company_checkin_sessions
  for all to authenticated using (public.is_company_admin((company_id)::uuid)) with check (public.is_company_admin((company_id)::uuid));

drop policy if exists checkins_company_write               on public.checkins;
drop policy if exists checkins_own_company                 on public.checkins;
create policy checkins_admin_all on public.checkins
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists sos_queue_company_write              on public.sos_queue;
create policy sos_queue_admin_all on public.sos_queue
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists sos_events_member_write              on public.sos_events;
drop policy if exists sos_events_own_company               on public.sos_events;
create policy sos_events_admin_all on public.sos_events
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

-- ── Group B: drop redundant jwt-company_id ALL (proper policy exists) ──
drop policy if exists audit_logs_own_company               on public.audit_logs;
drop policy if exists safety_timers_own                    on public.safety_timers;

drop policy if exists workspaces_own_company               on public.workspaces;
create policy workspaces_owner_modify on public.workspaces
  for all to authenticated using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));

-- ── Group C: keep legitimate worker self-write, strip tamper ─────
drop policy if exists checklist_company_write              on public.checklist_submissions;
create policy checklist_member_insert on public.checklist_submissions
  for insert to authenticated with check ((company_id IS NULL) OR public.is_company_member(company_id));
create policy checklist_admin_all on public.checklist_submissions
  for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists evidence_company_write               on public.evidence;
create policy evidence_member_insert on public.evidence
  for insert to authenticated with check ((company_id IS NULL) OR public.is_company_member(company_id));
create policy evidence_admin_all on public.evidence
  for all to authenticated using ((company_id IS NULL) OR public.is_company_admin(company_id)) with check ((company_id IS NULL) OR public.is_company_admin(company_id));

drop policy if exists gps_trail_access                     on public.gps_trail;
create policy gps_trail_self_write on public.gps_trail
  for all to authenticated
  using      ((employee_id = (select auth.uid())) OR (company_id IS NULL AND employee_id IS NULL))
  with check ((employee_id = (select auth.uid())) OR (company_id IS NULL AND employee_id IS NULL));
