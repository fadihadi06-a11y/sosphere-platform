-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — L1-A: log_sos_audit gains a trace_id parameter
-- ─────────────────────────────────────────────────────────────────────────
-- Companion to 20260508130000 which added trace_id columns to sos_sessions
-- and audit_log. This migration upgrades the log_sos_audit RPC so every
-- audit event written during an SOS lifecycle CAN carry the trace_id,
-- making the audit_log queryable by trace_id (not just emergency_id).
--
-- ════════════════════════════════════════════════════════════════════════
-- L0.5 SCHEMA-DRIFT RECOVERY NOTE
-- ────────────────────────────────────────────────────────────────────────
-- Reading this 2026-05-08, we discovered the production log_sos_audit RPC
-- has DRAMATICALLY diverged from what's in git:
--
--   git version (20260424103233_log_sos_audit_rpc.sql):
--     • 7 params, naive INSERT into actor_level column (which doesn't
--       exist in audit_log!), no freshness, no company resolution
--
--   production version (read live via MCP execute_sql 2026-05-08):
--     • 8 params (adds p_company_id)
--     • D-15 hardening: resolves actor as UUID, re-reads role FROM
--       profiles to prevent stale-role admin-escalation, annotates
--       metadata with actor_role_source
--     • Auto-resolves company from profiles.active_company_id when not
--       supplied
--     • INSERTs into actor_role (correct column name) — git's version
--       targeted actor_level which doesn't exist
--     • Sets category='emergency', severity from metadata, etc.
--
-- The production version was applied via apply_migration MCP and never
-- committed to git. This is exactly the L0.5 drift the migration drift
-- guard was built to catch — and our git is wrong, not production.
--
-- THIS MIGRATION recovers the schema by:
--   1. PRESERVING all the D-15 freshness logic
--   2. PRESERVING the company_id auto-resolution path
--   3. PRESERVING the metadata annotations
--   4. PRESERVING the correct INSERT column list (actor_role, etc.)
--   5. ADDING p_trace_id as a 9th parameter
--   6. ADDING trace_id to the INSERT column list
--
-- After this migration runs, the production function = git version,
-- drift cleared, observability live.
-- ════════════════════════════════════════════════════════════════════════
--
-- Rollback hint (recreates the pre-L1 production state):
--   DROP FUNCTION public.log_sos_audit(text, text, text, text, text, text,
--                                       jsonb, uuid, uuid);
--   -- then restore the 8-param version from this file's TEMPLATE block.
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop ALL existing variants (handles 7-arg legacy and 8-arg production).
do $$
declare
  r record;
begin
  for r in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'log_sos_audit'
  loop
    execute 'drop function ' || r.sig;
  end loop;
end$$;

create or replace function public.log_sos_audit(
  p_action       text,
  p_actor        text,
  p_actor_level  text default 'worker',
  p_operation    text default 'sos',
  p_target       text default null,
  p_target_name  text default null,
  p_metadata     jsonb default '{}'::jsonb,
  p_company_id   uuid default null,
  p_trace_id     uuid default null
) returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_id text;
  v_resolved_company uuid := p_company_id;
  v_actor_uuid uuid;
  v_fresh_role text := null;
  v_resolved_role text;
  v_role_source text := 'claim';
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  v_id := 'AUD-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISSMS')
       || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  -- D-15: resolve actor as UUID once for both company + freshness lookups.
  if p_actor is not null then
    begin
      v_actor_uuid := p_actor::uuid;
    exception when others then v_actor_uuid := null; end;
  end if;

  if v_resolved_company is null and v_actor_uuid is not null then
    select active_company_id into v_resolved_company
      from public.profiles where id = v_actor_uuid limit 1;
  end if;

  -- D-15 FIX: re-read the actor's CURRENT role from profiles. If we
  -- find a row, override the client-supplied claim. This closes the
  -- stale-TTL window where a demoted admin's actions logged as 'admin'.
  if v_actor_uuid is not null then
    select role into v_fresh_role from public.profiles
      where id = v_actor_uuid or user_id = v_actor_uuid limit 1;
    if v_fresh_role is not null and length(trim(v_fresh_role)) > 0 then
      v_resolved_role := v_fresh_role;
      v_role_source := 'fresh';
    else
      v_resolved_role := coalesce(p_actor_level, 'worker');
      v_role_source := 'fallback';
    end if;
  else
    v_resolved_role := coalesce(p_actor_level, 'worker');
    v_role_source := 'no_actor_uuid';
  end if;

  -- Annotate metadata so forensic analysis can distinguish revalidated
  -- rows from legacy rows.
  v_metadata := jsonb_set(
    v_metadata,
    '{actor_role_source}',
    to_jsonb(v_role_source),
    true
  );
  if v_role_source = 'fresh' and v_fresh_role is distinct from p_actor_level then
    v_metadata := jsonb_set(
      v_metadata,
      '{stale_role_claim}',
      to_jsonb(p_actor_level),
      true
    );
  end if;

  -- L1-A: trace_id is written to its own column (added by migration
  -- 20260508130000) so post-incident forensics can SELECT … WHERE
  -- trace_id = $1 with an indexed scan, no JSON lookup.
  insert into public.audit_log
    (id, action, actor, actor_role, operation, target, target_name,
     metadata, created_at, category, severity, actor_name, detail,
     target_id, client_timestamp, company_id, trace_id)
  values
    (v_id, p_action, coalesce(p_actor, 'system'),
     v_resolved_role, coalesce(p_operation, 'sos'),
     p_target, p_target_name, v_metadata, now(),
     'emergency', coalesce(v_metadata->>'severity', 'info'),
     p_actor, coalesce(v_metadata->>'reason', v_metadata->>'detail', null),
     p_target, now(), v_resolved_company, p_trace_id);
end;
$$;

grant execute on function public.log_sos_audit(text, text, text, text, text, text, jsonb, uuid, uuid)
  to service_role, authenticated;

comment on function public.log_sos_audit is
  '2026-05-08 (L1-A): preserves the D-15 freshness logic + p_company_id auto-resolution that were live in production but never committed to git (L0.5 drift); adds p_trace_id (uuid) so audit rows tied to an SOS lifecycle carry the trace_id used by client + sos-alert + sos_sessions for end-to-end correlation. Backward-compatible — older callers without the parameter keep working.';
