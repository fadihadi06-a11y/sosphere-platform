-- profiles holds PII (phone, date_of_birth, parental_contact, email, consent
-- timestamps, legacy admin_pin_* material). The old profiles_select let ANY
-- company member (every worker) read ALL teammates' full profile rows.
--
-- Roster identity (name/role) now comes from the employees table's OWN columns
-- (employees.name/name_ar/phone/role); the only client read of OTHER users'
-- profiles was the removed `profiles!user_id(...)` embed in fetchEmployees.
-- So restricting profiles to self + admin breaks nothing.
--
-- Verified (rolled-back): worker_own=1, worker_other=0, owner_team=3,
-- worker_roster_names=3 (roster still resolves from employees).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    (id = (select auth.uid()))
    OR (user_id = (select auth.uid()))
    OR public.is_company_admin(company_id)
    OR public.is_admin()
  );
