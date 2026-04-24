-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: rls_phase1_helpers_and_anon_lockdown_2026_04_24_v2
-- Version:   20260424162710
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- RLS Reconcile — Phase 1 (v2 — reuse existing helper signatures)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Upgrade existing helpers to SECURITY DEFINER + dual-source check ──
-- SECURITY DEFINER is needed so the helper can read from the membership
-- tables even when the caller's RLS (on company_memberships itself, once
-- we lock it down in later phases) would normally block.
--
-- We also widen the check to cover BOTH company_memberships and employees
-- because the codebase populates these inconsistently (sos-alert uses
-- employees; older migration paths use company_memberships).

create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id    = auth.uid()
      and m.active     = true
  ) or exists (
    select 1 from public.employees e
    where e.company_id = p_company_id
      and e.user_id    = auth.uid()
  );
$function$;
comment on function public.is_company_member(uuid) is
  '2026-04-24 v2 RLS helper: true when auth.uid() belongs to target company via EITHER company_memberships OR employees. SECURITY DEFINER to bypass RLS on membership tables.';

create or replace function public.is_company_owner(p_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id    = auth.uid()
      and m.active     = true
      and m.role       = 'owner'
  ) or exists (
    select 1 from public.companies c
    where c.id = p_company_id
      and (c.owner_user_id = auth.uid() or c.owner_id = auth.uid())
  );
$function$;
comment on function public.is_company_owner(uuid) is
  '2026-04-24 v2 RLS helper: owner via company_memberships.role=owner OR companies.owner_*.';

grant execute on function public.is_company_member(uuid) to authenticated, service_role;
grant execute on function public.is_company_owner(uuid)  to authenticated, service_role;

-- ── Enable RLS on system_logs ──────────────────────────────────────────
alter table public.system_logs enable row level security;
-- Default-deny; edge functions bypass via service_role.

-- ── Drop every anon-role policy (attacker with only anon key) ──────────
drop policy if exists anon_all_companies      on public.companies;
drop policy if exists anon_all_employees      on public.employees;
drop policy if exists anon_all_profiles       on public.profiles;
drop policy if exists anon_all_settings       on public.company_settings;
drop policy if exists anon_all_files          on public.files;
drop policy if exists anon_all_invitations    on public.invitations;
drop policy if exists anon_all_sos            on public.sos_queue;
drop policy if exists anon_all_zones          on public.zones;
drop policy if exists anon_all_perms          on public.user_permissions;
drop policy if exists anon_insert_gps         on public.gps_trail;
drop policy if exists anon_select_gps         on public.gps_trail;
drop policy if exists anon_insert_rrp         on public.rrp_sessions;
drop policy if exists anon_select_rrp         on public.rrp_sessions;
drop policy if exists anon_insert_checkin     on public.checkin_events;
drop policy if exists anon_select_checkin     on public.checkin_events;
