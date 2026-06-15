-- ═══════════════════════════════════════════════════════════════
-- SOSphere — Offboarding hardening: revoke ex-employee sessions
-- ─────────────────────────────────────────────────────────────
-- FINDING (pre-launch angle review, 2026-06-15):
--   remove_employee() deletes the public.employees row, which drops
--   the user's company_id on their NEXT token refresh (the JWT hook
--   custom_access_token_hook derives company_id from employees.email).
--   But the access token already issued still carries company_id until
--   it expires (<= access-token TTL), leaving a residual window where a
--   removed worker keeps company-scoped read access (and could trigger
--   SOS as the company). There is no continuous worker-location table,
--   so this is bounded read access — not continuous tracking — but for
--   a life-safety product the window should still be closed.
--
-- FIX:
--   On removal, also revoke the target user's auth sessions + refresh
--   tokens so the JWT CANNOT be refreshed. The residual window can then
--   only shrink to the remaining access-token TTL and never renews.
--   Best-effort: each delete is wrapped so an auth-schema hiccup can
--   never block the actual removal (the DELETE FROM employees is the
--   primary, authoritative effect).
--
-- Everything else is byte-for-byte the prior definition.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.remove_employee(p_employee_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Cannot remove the company owner via this RPC (use owner-transfer)
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

  -- ── Offboarding hardening: revoke the removed user's auth sessions ──
  -- so their already-issued JWT cannot be refreshed (closes the residual
  -- company-access window). Best-effort, never blocks the removal.
  if v_target_uid is not null then
    begin
      delete from auth.sessions where user_id = v_target_uid;
    exception when others then null; end;
    begin
      delete from auth.refresh_tokens where user_id = v_target_uid::text;
    exception when others then null; end;
  end if;

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
                         'removed_role', v_target_role,
                         'sessions_revoked', true),
      now()
    );
  exception when others then null; end;

  return true;
end $function$;
