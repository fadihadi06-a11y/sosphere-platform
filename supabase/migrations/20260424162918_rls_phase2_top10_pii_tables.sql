-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: rls_phase2_top10_pii_tables_2026_04_24_v2
-- Version:   20260424162918
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- RLS Reconcile — Phase 2 v2 (type-corrected)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── employees ────────────────────────────────────────────────────────
drop policy if exists allow_all on public.employees;

create policy employees_self_read on public.employees
  for select to authenticated using (user_id = auth.uid());

create policy employees_company_read on public.employees
  for select to authenticated using (public.is_company_member(company_id));

create policy employees_owner_write on public.employees
  for all to authenticated
  using      (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

-- ─── profiles ─────────────────────────────────────────────────────────
drop policy if exists "system can insert profile" on public.profiles;

create policy profiles_self_read on public.profiles
  for select to authenticated using (id = auth.uid() or user_id = auth.uid());

create policy profiles_self_update on public.profiles
  for update to authenticated
  using      (id = auth.uid() or user_id = auth.uid())
  with check (id = auth.uid() or user_id = auth.uid());

create policy profiles_company_read on public.profiles
  for select to authenticated
  using (company_id is not null and public.is_company_member(company_id));

-- ─── medical_profiles ─────────────────────────────────────────────────
-- SCHEMA QUIRK: medical_profiles.employee_id is BIGINT but employees.id
-- is UUID — they can't be joined directly. The medical_profiles table
-- likely predates the UUID migration. Until a schema migration aligns
-- types, we restrict medical_profiles to service_role only (edge fns).
-- The client should read medical data through the profiles/employees
-- tables instead.
drop policy if exists auth_read_med  on public.medical_profiles;
drop policy if exists auth_write_med on public.medical_profiles;
-- No new policies → default-deny for authenticated+anon.
-- service_role bypasses RLS (edge functions still work).

-- ─── sos_queue ────────────────────────────────────────────────────────
drop policy if exists sos_queue_all on public.sos_queue;

create policy sos_queue_company_read on public.sos_queue
  for select to authenticated using (public.is_company_member(company_id));

create policy sos_queue_company_write on public.sos_queue
  for all to authenticated
  using      (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ─── sos_sessions (dual path: civilian user_id + employee company_id) ─
drop policy if exists allow_all on public.sos_sessions;

create policy sos_sessions_self_read on public.sos_sessions
  for select to authenticated using (user_id = auth.uid());

create policy sos_sessions_company_read on public.sos_sessions
  for select to authenticated using (
    company_id is not null and public.is_company_member(company_id)
  );

create policy sos_sessions_self_write on public.sos_sessions
  for all to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── audit_log ────────────────────────────────────────────────────────
drop policy if exists "Admins can read audit"    on public.audit_log;
drop policy if exists "System can insert audit"  on public.audit_log;

create policy audit_log_company_read on public.audit_log
  for select to authenticated using (
    company_id is null or public.is_company_member(company_id)
  );

-- ─── audit_logs (older sibling) ───────────────────────────────────────
drop policy if exists auth_all_aud on public.audit_logs;

create policy audit_logs_company_read on public.audit_logs
  for select to authenticated using (
    company_id is null or public.is_company_member(company_id)
  );

-- ─── gps_trail ────────────────────────────────────────────────────────
-- employee_id is text; auth.uid() is uuid so we cast.
drop policy if exists gps_all       on public.gps_trail;
drop policy if exists gps_trail_all on public.gps_trail;

create policy gps_trail_self on public.gps_trail
  for all to authenticated
  using (
    employee_id = auth.uid()::text
    or (company_id is null and employee_id is null)
  )
  with check (
    employee_id = auth.uid()::text
    or (company_id is null and employee_id is null)
  );

create policy gps_trail_company_read on public.gps_trail
  for select to authenticated using (
    company_id is not null and public.is_company_member(company_id)
  );

-- ─── evidence ─────────────────────────────────────────────────────────
drop policy if exists "Users can insert evidence" on public.evidence;
drop policy if exists "Users can read evidence"   on public.evidence;
drop policy if exists "Users can update evidence" on public.evidence;

create policy evidence_company_read on public.evidence
  for select to authenticated using (
    company_id is null or public.is_company_member(company_id)
  );

create policy evidence_company_write on public.evidence
  for all to authenticated
  using (
    company_id is null or public.is_company_member(company_id)
  )
  with check (
    company_id is null or public.is_company_member(company_id)
  );

-- ─── chat_messages ────────────────────────────────────────────────────
-- emergency_id is text. sos_queue.emergency_id is text (direct match).
-- sos_sessions.id is uuid → cast to text for the join.
drop policy if exists "Anyone can insert chat messages" on public.chat_messages;
drop policy if exists "Anyone can read chat messages"   on public.chat_messages;

create policy chat_messages_emergency_read on public.chat_messages
  for select to authenticated using (
    exists (
      select 1 from public.sos_queue q
      where q.emergency_id = chat_messages.emergency_id
        and public.is_company_member(q.company_id)
    )
    or exists (
      select 1 from public.sos_sessions s
      where s.id::text = chat_messages.emergency_id
        and (s.user_id = auth.uid()
             or (s.company_id is not null and public.is_company_member(s.company_id)))
    )
  );

create policy chat_messages_emergency_write on public.chat_messages
  for insert to authenticated with check (
    exists (
      select 1 from public.sos_queue q
      where q.emergency_id = chat_messages.emergency_id
        and public.is_company_member(q.company_id)
    )
    or exists (
      select 1 from public.sos_sessions s
      where s.id::text = chat_messages.emergency_id
        and (s.user_id = auth.uid()
             or (s.company_id is not null and public.is_company_member(s.company_id)))
    )
  );

-- ─── company_memberships ──────────────────────────────────────────────
drop policy if exists read_all on public.company_memberships;

create policy memberships_self_read on public.company_memberships
  for select to authenticated using (user_id = auth.uid());

create policy memberships_company_read on public.company_memberships
  for select to authenticated using (public.is_company_member(company_id));

create policy memberships_owner_write on public.company_memberships
  for all to authenticated
  using      (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));
