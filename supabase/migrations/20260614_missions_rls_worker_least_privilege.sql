-- ════════════════════════════════════════════════════════════════
-- Tighten missions RLS to least-privilege.
--
-- ROOT CAUSE (found in dark-angle audit 2026-06-14): three permissive
-- policies each granted EVERY employee full read+write of ALL company
-- missions:
--   * missions_access       (cmd=ALL)    qual: company_id = jwt.company_id
--                            -- the custom_access_token_hook injects
--                            -- company_id into every worker's JWT, so this
--                            -- opened the whole tenant to every worker.
--   * missions_member_write (cmd=ALL)    qual: is_company_member(company_id)
--   * missions_member_read  (cmd=SELECT) qual: is_company_member(company_id)
-- A plain worker could therefore read AND tamper with (update/delete) any
-- other worker's mission via the API, and the mobile worker app's
-- getActiveMissionAny() could surface another worker's mission.
--
-- NEW MODEL (intended all along):
--   * Owners/admins  -> full read+write of their company's missions.
--   * Plain workers  -> read ONLY missions assigned to them; no write.
--     (kept policy: missions_assigned_worker_read)
-- service_role (edge functions) bypasses RLS and is unaffected.
--
-- Verified (rolled-back self-test, real worker/owner JWTs):
--   worker_reads=1 (own only) | worker_update_rows=0 | worker_insert_ok=0
--   | owner_reads=2 (all).
-- ════════════════════════════════════════════════════════════════

drop policy if exists missions_access       on public.missions;
drop policy if exists missions_member_write  on public.missions;
drop policy if exists missions_member_read   on public.missions;

create policy missions_admin_all on public.missions
  for all to authenticated
  using      (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));
