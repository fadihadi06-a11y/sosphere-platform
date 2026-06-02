-- ═══════════════════════════════════════════════════════════════
-- 2026-06-01 Phase 2 CRIT-8 v2 Phase C: AAL2 enforcement on
-- transfer_ownership (the single highest-risk admin operation)
-- ─────────────────────────────────────────────────────────────
-- The existing transfer_ownership(p_company_id, p_new_owner) had no
-- AAL check — owner-transfer is unrecoverable (the previous owner
-- becomes super_admin and cannot un-transfer themselves back). Wrap
-- it with the _sensitive_op_aal_check helper from Phase B + add two
-- guardrails the audit revealed missing:
--   1. Reject self-transfer (current behavior was undefined)
--   2. Also update companies.owner_id (previous version updated only
--      company_memberships — leaving the FK pointer stale and breaking
--      RLS policies that key on owner_id, e.g. zones_owner_write)
--   3. Audit log row with severity='critical' for ownership_transferred
--
-- Companion: dashboard-roles-page.tsx Phase C UI mounts an owner-only
-- panel that surfaces this RPC behind requirePIN("transfer_ownership").
-- ═══════════════════════════════════════════════════════════════

create or replace function public.transfer_ownership(p_company_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_my_role public.company_role;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public._sensitive_op_aal_check('owner:transfer') then
    raise exception 'step_up_required: owner:transfer needs aal2' using errcode = '42501';
  end if;
  if p_company_id is null or p_new_owner is null then
    raise exception 'company_id and new_owner required' using errcode = '22023';
  end if;
  if p_new_owner = v_uid then
    raise exception 'cannot transfer to yourself' using errcode = '22023';
  end if;

  select role into v_my_role
  from public.company_memberships
  where company_id = p_company_id and user_id = v_uid;

  if v_my_role is null or v_my_role <> 'owner' then
    raise exception 'Only owner can transfer ownership' using errcode = '42501';
  end if;

  -- Make current owner a super_admin (preserves access for handover)
  update public.company_memberships
  set role = 'super_admin'
  where company_id = p_company_id and user_id = v_uid;

  -- Make the new user the owner
  update public.company_memberships
  set role = 'owner', active = true
  where company_id = p_company_id and user_id = p_new_owner;

  -- Also update the companies.owner_id pointer (previous version only
  -- updated company_memberships, leaving companies.owner_id stale and
  -- breaking RLS policies that key on owner_id).
  update public.companies
     set owner_id = p_new_owner
   where id = p_company_id;

  begin
    insert into public.audit_log (
      id, action, actor, actor_id, actor_role, operation, target,
      category, severity, metadata, created_at
    ) values (
      gen_random_uuid(), 'ownership_transferred', 'user', v_uid,
      'owner', 'TRANSFER', p_company_id::text,
      'ownership', 'critical',
      jsonb_build_object('old_owner', v_uid, 'new_owner', p_new_owner),
      now()
    );
  exception when others then null; end;
end $$;
