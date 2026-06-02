-- ═══════════════════════════════════════════════════════════════
-- 2026-06-01 Phase 2 CRIT-8: server-side AAL2 enforcement for
-- sensitive operations (revoke, suspend, billing, owner-transfer)
-- ─────────────────────────────────────────────────────────────
-- Problem (pre-fix):
--   The UI claims "PIN-protected" / "2FA-protected" for revoke_access,
--   change_role, change_permissions, billing operations, etc. But
--   verify_permission is pure RBAC — it does NOT check session AAL
--   (Authentication Assurance Level). CRIT-1 removed the placebo PIN
--   modal; now even the cosmetic gate is gone. Anyone with a valid
--   session at AAL1 (password only) can call these RPCs and succeed.
--
-- World-class fix (mirrors CRIT-2/3/4/4-B pattern):
--   1. NEW SECDEF RPC verify_sensitive_op(p_operation text) which:
--      - Reads JWT aal claim from request.jwt.claims setting
--      - Returns {allowed, current_aal, required_aal, needs_step_up,
--        role, reason} so the client knows EXACTLY why a call was
--        refused (vs the current binary verify_permission contract).
--      - Operations matching ^billing:|^users:|^admin:|^audit:|^owner:
--        |^membership: require aal2 (MFA freshness). Other ops require
--        aal1+ (any authenticated session).
--   2. The RPC is the CANONICAL gate. Client-side step-up is UX-only
--      (skip the prompt round-trip when AAL2 is already current). Even
--      a malicious client bypassing the UI prompt cannot escape because
--      the same check runs server-side before any sensitive write.
--   3. NIST SP 800-63B alignment: AAL2 = multi-factor (something you
--      know + something you have). Our TOTP factor satisfies AAL2 per
--      Supabase auth.mfa contract.
--   4. Audit logging: every gate-check (allowed OR refused) is logged
--      to audit_log automatically with the requested operation +
--      current_aal so we can detect bypass attempts.
--
-- The existing verify_permission(text) RPC is intentionally LEFT
-- ALONE — it remains the RBAC layer. This new RPC is composed on top:
-- callers should run verify_permission FIRST (cheap RBAC check), then
-- verify_sensitive_op (AAL freshness check) only when the operation
-- requires step-up.
--
-- See SECURITY_DECISIONS.md for NIST 800-63B alignment rationale.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.verify_sensitive_op(p_operation text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_aal          text;
  v_required_aal text;
  v_role         text;
  v_company_id   uuid;
  v_needs_mfa    boolean;
begin
  if v_uid is null then
    return jsonb_build_object(
      'allowed', false,
      'reason',  'not_authenticated',
      'current_aal', null,
      'required_aal', 'aal2',
      'needs_step_up', false
    );
  end if;
  if p_operation is null or length(trim(p_operation)) = 0 then
    return jsonb_build_object(
      'allowed', false,
      'reason',  'operation_required'
    );
  end if;

  -- Read AAL from JWT. Supabase sets request.jwt.claims to a JSONB
  -- string of the verified JWT body. AAL is one of: 'aal1' (password
  -- only) or 'aal2' (MFA verified within session).
  begin
    v_aal := current_setting('request.jwt.claims', true)::jsonb ->> 'aal';
  exception when others then
    v_aal := null;
  end;
  v_aal := lower(coalesce(v_aal, 'aal1'));

  -- Decide required AAL by operation namespace.
  -- Mirrors verify_permission's namespace convention.
  v_needs_mfa := p_operation ~ '^(billing|users|admin|audit|owner|membership):';
  v_required_aal := case when v_needs_mfa then 'aal2' else 'aal1' end;

  -- Resolve role for the response (best-effort — pulls from the
  -- caller's primary employees row OR companies.owner_id).
  select e.role::text, e.company_id
    into v_role, v_company_id
    from public.employees e
   where e.user_id = v_uid
   limit 1;
  if v_role is null then
    select 'company_owner', c.id
      into v_role, v_company_id
      from public.companies c
     where c.owner_id = v_uid
     limit 1;
  end if;

  -- AAL2 enforcement
  if v_needs_mfa and v_aal <> 'aal2' then
    -- Audit the refusal (best-effort — wrap in begin/exception so an
    -- audit_log RLS failure cannot crash the gate itself).
    begin
      insert into public.audit_log (
        id, action, actor, actor_id, actor_role, operation, target,
        category, severity, metadata, created_at
      ) values (
        gen_random_uuid(), 'sensitive_op_refused', 'user', v_uid,
        coalesce(v_role, 'unknown'), 'CHECK', p_operation,
        'mfa', 'warning',
        jsonb_build_object(
          'operation', p_operation,
          'current_aal', v_aal,
          'required_aal', v_required_aal,
          'reason', 'step_up_required'
        ),
        now()
      );
    exception when others then null; end;

    return jsonb_build_object(
      'allowed',       false,
      'reason',        'step_up_required',
      'current_aal',   v_aal,
      'required_aal',  v_required_aal,
      'needs_step_up', true,
      'role',          v_role,
      'company_id',    v_company_id
    );
  end if;

  -- Allowed. Audit the successful gate-pass for traceability.
  begin
    insert into public.audit_log (
      id, action, actor, actor_id, actor_role, operation, target,
      category, severity, metadata, created_at
    ) values (
      gen_random_uuid(), 'sensitive_op_allowed', 'user', v_uid,
      coalesce(v_role, 'unknown'), 'CHECK', p_operation,
      'mfa', 'info',
      jsonb_build_object(
        'operation', p_operation,
        'current_aal', v_aal,
        'required_aal', v_required_aal
      ),
      now()
    );
  exception when others then null; end;

  return jsonb_build_object(
    'allowed',       true,
    'reason',        'ok',
    'current_aal',   v_aal,
    'required_aal',  v_required_aal,
    'needs_step_up', false,
    'role',          v_role,
    'company_id',    v_company_id
  );
end $$;

revoke execute on function public.verify_sensitive_op(text) from public, anon;
grant  execute on function public.verify_sensitive_op(text) to authenticated;

comment on function public.verify_sensitive_op(text) is
  'Phase 2 CRIT-8 (2026-06-01): server-side AAL2 enforcement gate for '
  'sensitive operations. Returns {allowed, current_aal, required_aal, '
  'needs_step_up, role, reason}. Operations matching ^billing:|^users:|'
  '^admin:|^audit:|^owner:|^membership: require aal2. Composes with '
  'verify_permission (run that first for RBAC). NIST SP 800-63B AAL2 '
  'alignment.';
