-- Root fix: is_admin() (SQL STABLE, queries public.profiles) recursed infinitely
-- under RLS because the profiles policy itself calls is_admin(). Previously
-- masked by short-circuit on is_company_member; tightening profiles exposed it.
-- SECURITY DEFINER lets the self-admin-check read profiles without re-triggering
-- RLS (same pattern as is_company_member). Reports only whether the CURRENT user
-- is a platform admin, so it leaks nothing; fixes every policy using is_admin().
create or replace function public.is_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public','pg_temp'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$function$;
