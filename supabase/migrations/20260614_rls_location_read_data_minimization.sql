-- ════════════════════════════════════════════════════════════════
-- Data-minimization (dark-angle read-side, 2026-06-14): a plain worker
-- should not read EVERY teammate's continuous location history / safety
-- countdowns. Scope these two pure-surveillance reads to self + admin.
-- SOS queue/events/sessions reads are intentionally LEFT OPEN — responding
-- to a colleague's emergency is the platform's core life-safety feature.
--
-- Verified: safety_timers has ZERO client readers; gps_trail is read only in
-- admin SAR + emergency-response review (command-side). Workers keep reading
-- their OWN rows via the existing self policies (gps_trail_self_write /
-- safety_timers_self, keyed on employee_id|user_id = auth.uid()).
--
-- Verified after (rolled-back): worker_own=1, worker_other=0, admin_all=2.
-- ════════════════════════════════════════════════════════════════

drop policy if exists gps_trail_company_read on public.gps_trail;
create policy gps_trail_admin_read on public.gps_trail
  for select to authenticated
  using (is_company_admin(company_id));

drop policy if exists safety_timers_company_read on public.safety_timers;
create policy safety_timers_admin_read on public.safety_timers
  for select to authenticated
  using ((company_id IS NOT NULL) AND is_company_admin(company_id));
