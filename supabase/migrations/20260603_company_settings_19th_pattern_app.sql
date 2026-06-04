-- ═══════════════════════════════════════════════════════════════
-- 2026-06-03 Company Settings (19th pattern application)
-- ─────────────────────────────────────────────────────────────
-- Audit (C-3, 8 markers): dashboard-settings-page.tsx contained an
-- upsert to a `company_settings` table that DID NOT have the columns
-- the upsert tried to write — only (company_id, hidden_cost_hour_rate)
-- existed. Every "Save Settings" click silently failed at the DB.
-- The localStorage mirror worked, so the page felt responsive — but
-- settings vanished across devices, browsers, and shared-device
-- sessions (the previous admin's localStorage leaked into the next).
--
-- 19th application of the world-class server-state pattern:
--   1. ALTER company_settings: + settings jsonb, updated_at, updated_by.
--      Schema-flexible jsonb future-proofs against toggle churn.
--   2. SECDEF RPCs:
--      - get_company_settings(p_company_id): admin reader, returns
--        '{}' when no row exists yet.
--      - upsert_company_settings(p_company_id, p_settings):
--        owner/admin-only writer.
--   3. RLS: company-scoped reads; writes only via SECDEF.
-- ═══════════════════════════════════════════════════════════════

-- Table already exists with (company_id, hidden_cost_hour_rate). Extend.
alter table public.company_settings
  add column if not exists settings    jsonb not null default '{}'::jsonb,
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists updated_by  uuid references auth.users(id) on delete set null;

alter table public.company_settings enable row level security;

drop policy if exists company_settings_read on public.company_settings;
create policy company_settings_read on public.company_settings
  for select using (
    company_id in (select c.id from public.companies c where c.owner_id = (select auth.uid()))
    or company_id in (
      select m.company_id from public.company_memberships m
      where m.user_id = (select auth.uid()) and m.active = true
    )
    or company_id in (
      select e.company_id from public.employees e where e.user_id = (select auth.uid())
    )
  );

create or replace function public.get_company_settings(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_settings jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select exists(
    select 1 from public.companies c where c.id = p_company_id and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = v_uid and m.active = true
  ) or exists(
    select 1 from public.employees e where e.company_id = p_company_id and e.user_id = v_uid
  ) into v_allowed;
  if not v_allowed then raise exception 'not authorized' using errcode='42501'; end if;

  select settings into v_settings from public.company_settings where company_id = p_company_id;
  return coalesce(v_settings, '{}'::jsonb);
end $$;
revoke execute on function public.get_company_settings(uuid) from public, anon;
grant  execute on function public.get_company_settings(uuid) to authenticated;

create or replace function public.upsert_company_settings(
  p_company_id uuid,
  p_settings   jsonb
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if p_company_id is null or p_settings is null then
    raise exception 'p_company_id and p_settings are required' using errcode='22023';
  end if;
  select exists(
    select 1 from public.companies c where c.id = p_company_id and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then raise exception 'only owner/admin can change company settings' using errcode='42501'; end if;

  insert into public.company_settings (company_id, settings, updated_at, updated_by)
  values (p_company_id, p_settings, now(), v_uid)
  on conflict (company_id) do update set
    settings   = excluded.settings,
    updated_at = now(),
    updated_by = v_uid;
  return true;
end $$;
revoke execute on function public.upsert_company_settings(uuid, jsonb) from public, anon;
grant  execute on function public.upsert_company_settings(uuid, jsonb) to authenticated;
