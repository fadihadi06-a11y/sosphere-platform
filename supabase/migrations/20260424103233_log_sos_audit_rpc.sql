-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: log_sos_audit_rpc_2026_04_24
-- Version:   20260424103233
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- Defensive: drop any prior signature so later reinstalls don't leave
-- orphans. 0 rows expected on first apply, but harmless if re-run.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'log_sos_audit'
  loop
    execute 'drop function ' || r.sig;
  end loop;
end$$;

create or replace function public.log_sos_audit(
  p_action text,
  p_actor text,
  p_actor_level text default 'worker',
  p_operation text default 'sos',
  p_target text default null,
  p_target_name text default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  v_id := 'AUD-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISSMS')
       || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  insert into public.audit_log
    (id, action, actor, actor_level, operation, target, target_name,
     metadata, created_at)
  values
    (v_id,
     p_action,
     coalesce(p_actor, 'system'),
     coalesce(p_actor_level, 'worker'),
     coalesce(p_operation, 'sos'),
     p_target,
     p_target_name,
     coalesce(p_metadata, '{}'::jsonb),
     now());
end;
$$;

grant execute on function public.log_sos_audit(text, text, text, text, text, text, jsonb)
  to service_role, authenticated;

comment on function public.log_sos_audit is
  '2026-04-24: security-definer helper so Edge Functions and clients can append SOS audit events. Matches live audit_log schema.';
