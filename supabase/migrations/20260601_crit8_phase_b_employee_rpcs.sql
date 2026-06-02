-- ═══════════════════════════════════════════════════════════════
-- 2026-06-01 Phase 2 CRIT-8 v2 Phase B: real backend RPCs
-- ─────────────────────────────────────────────────────────────
-- Problem (CRIT-8 v1 gap):
--   dashboard-roles-page.tsx had requirePIN gating in front of
--   setMembers(...) — pure LOCAL state mutations. The gate was real
--   but the backend was mock — change a role, refresh the page, the
--   change vanishes. Worse: line 643 had a UserX button calling
--   setMembers(prev => prev.filter(...)) with NO gate at all.
--
-- World-class fix (mirrors CRIT-3/4/8-v1 pattern):
--   1. SECDEF RPC update_employee_role(p_employee_id, p_new_role)
--   2. SECDEF RPC upsert_user_permissions(p_user_id, p_company_id, ...)
--   3. SECDEF RPC remove_employee(p_employee_id) — hard-delete via
--      employees row deletion (cascade handles dependents).
--   All three authorize the caller as owner or active admin of the
--   target employee's company. All three write audit_log rows.
--
-- Composes with verify_sensitive_op (CRIT-8 v1) AT THE DB LAYER via
-- a new helper _sensitive_op_aal_check(operation) that mirrors the
-- AAL2 namespace rule. Even if the client bypass attempts to call
-- these RPCs at AAL1 (e.g. directly via curl), the DB itself
-- refuses — TRUE defense-in-depth.
-- ═══════════════════════════════════════════════════════════════

-- Helper: inline AAL2 check (callable from inside other SECDEF RPCs).
-- Mirrors verify_sensitive_op logic but boolean-only for composition.
create or replace function public._sensitive_op_aal_check(p_operation text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aal text;
  v_needs_mfa boolean;
begin
  if auth.uid() is null then return false; end if;
  begin
    v_aal := current_setting('request.jwt.claims', true)::jsonb ->> 'aal';
  exception when others then v_aal := null; end;
  v_aal := lower(coalesce(v_aal, 'aal1'));
  v_needs_mfa := p_operation ~ '^(billing|users|admin|audit|owner|membership):';
  return (not v_needs_mfa) or v_aal = 'aal2';
end $$;
revoke execute on function public._sensitive_op_aal_check(text) from public, anon;
grant  execute on function public._sensitive_op_aal_check(text) to authenticated;

-- ── 1. update_employee_role ──
create or replace function public.update_employee_role(
  p_employee_id uuid,
  p_new_role    text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_target_co    uuid;
  v_old_role     text;
  v_allowed      boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public._sensitive_op_aal_check('admin:change_role') then
    raise exception 'step_up_required: admin:change_role needs aal2' using errcode = '42501';
  end if;
  if p_employee_id is null then
    raise exception 'p_employee_id required' using errcode = '22023';
  end if;
  if p_new_role is null or p_new_role not in ('owner','admin','main_admin','zone_admin','employee','worker','member') then
    raise exception 'p_new_role must be one of: owner, admin, main_admin, zone_admin, employee, worker, member' using errcode = '22023';
  end if;

  select company_id, role into v_target_co, v_old_role
    from public.employees where id = p_employee_id;
  if v_target_co is null then
    raise exception 'employee % not found', p_employee_id using errcode = '22023';
  end if;

  -- Authorize: caller is company owner OR active admin membership
  select exists(
    select 1 from public.companies c where c.id = v_target_co and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = v_target_co and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', v_target_co using errcode = '42501';
  end if;

  update public.employees
     set role = p_new_role, updated_at = now()
   where id = p_employee_id;

  begin
    insert into public.audit_log (
      id, action, actor, actor_id, actor_role, operation, target,
      category, severity, metadata, created_at
    ) values (
      gen_random_uuid(), 'employee_role_changed', 'user', v_uid,
      'admin', 'UPDATE', p_employee_id::text,
      'roles', 'info',
      jsonb_build_object('old_role', v_old_role, 'new_role', p_new_role,
                         'company_id', v_target_co),
      now()
    );
  exception when others then null; end;

  return true;
end $$;
revoke execute on function public.update_employee_role(uuid, text) from public, anon;
grant  execute on function public.update_employee_role(uuid, text) to authenticated;

-- ── 2. upsert_user_permissions ──
create or replace function public.upsert_user_permissions(
  p_user_id        uuid,
  p_company_id     uuid,
  p_permissions    text[],
  p_level          text  default null,
  p_role           text  default null,
  p_assigned_zones text[] default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed boolean;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public._sensitive_op_aal_check('admin:change_permissions') then
    raise exception 'step_up_required: admin:change_permissions needs aal2' using errcode = '42501';
  end if;
  if p_user_id is null or p_company_id is null then
    raise exception 'p_user_id and p_company_id required' using errcode = '22023';
  end if;

  select exists(
    select 1 from public.companies c where c.id = p_company_id and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', p_company_id using errcode = '42501';
  end if;

  insert into public.user_permissions (
    id, company_id, user_id, permissions, level, role, assigned_zones,
    updated_by, updated_at
  ) values (
    gen_random_uuid(), p_company_id, p_user_id,
    coalesce(p_permissions, ARRAY[]::text[]),
    p_level, p_role,
    coalesce(p_assigned_zones, ARRAY[]::text[]),
    v_uid, now()
  )
  on conflict (company_id, user_id) do update
     set permissions    = excluded.permissions,
         level          = coalesce(excluded.level, public.user_permissions.level),
         role           = coalesce(excluded.role, public.user_permissions.role),
         assigned_zones = excluded.assigned_zones,
         updated_by     = v_uid,
         updated_at     = now()
  returning id into v_id;

  begin
    insert into public.audit_log (
      id, action, actor, actor_id, actor_role, operation, target,
      category, severity, metadata, created_at
    ) values (
      gen_random_uuid(), 'permissions_updated', 'user', v_uid,
      'admin', 'UPSERT', p_user_id::text,
      'roles', 'info',
      jsonb_build_object('company_id', p_company_id,
                         'permission_count', coalesce(array_length(p_permissions,1),0)),
      now()
    );
  exception when others then null; end;

  return v_id;
end $$;
revoke execute on function public.upsert_user_permissions(uuid, uuid, text[], text, text, text[]) from public, anon;
grant  execute on function public.upsert_user_permissions(uuid, uuid, text[], text, text, text[]) to authenticated;

-- ── 3. remove_employee ──
create or replace function public.remove_employee(p_employee_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_target_co uuid;
  v_target_uid uuid;
  v_target_role text;
  v_allowed   boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public._sensitive_op_aal_check('users:remove_employee') then
    raise exception 'step_up_required: users:remove_employee needs aal2' using errcode = '42501';
  end if;
  if p_employee_id is null then
    raise exception 'p_employee_id required' using errcode = '22023';
  end if;

  select company_id, user_id, role
    into v_target_co, v_target_uid, v_target_role
    from public.employees where id = p_employee_id;
  if v_target_co is null then
    -- Idempotent: removing a non-existent employee is success
    return true;
  end if;

  -- Cannot remove the company owner via this RPC (use owner-transfer first)
  if exists(select 1 from public.companies c where c.id = v_target_co and c.owner_id = v_target_uid) then
    raise exception 'cannot remove the company owner — use transfer_ownership first' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.companies c where c.id = v_target_co and c.owner_id = v_uid
  ) or exists(
    select 1 from public.company_memberships m
    where m.company_id = v_target_co and m.user_id = v_uid
      and m.active = true and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', v_target_co using errcode = '42501';
  end if;

  delete from public.employees where id = p_employee_id;

  begin
    insert into public.audit_log (
      id, action, actor, actor_id, actor_role, operation, target,
      category, severity, metadata, created_at
    ) values (
      gen_random_uuid(), 'employee_removed', 'user', v_uid,
      'admin', 'DELETE', p_employee_id::text,
      'roles', 'warning',
      jsonb_build_object('company_id', v_target_co,
                         'removed_user_id', v_target_uid,
                         'removed_role', v_target_role),
      now()
    );
  exception when others then null; end;

  return true;
end $$;
revoke execute on function public.remove_employee(uuid) from public, anon;
grant  execute on function public.remove_employee(uuid) to authenticated;
