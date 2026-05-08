-- ═══════════════════════════════════════════════════════════════
-- SOSphere — L1-A: log_sos_audit gains a trace_id parameter
-- ─────────────────────────────────────────────────────────────
-- Companion to 20260508130000 which added trace_id columns to
-- sos_sessions and audit_log. This migration upgrades the
-- log_sos_audit RPC so every audit event written during an SOS
-- lifecycle CAN carry the trace_id, making the audit_log queryable
-- by trace_id (rather than only by emergency_id, actor_id, time).
--
-- Why a real parameter (not metadata JSON):
--   • Embedding trace_id inside p_metadata jsonb works but lives
--     behind a JSON lookup — no index, slow at scale.
--   • A real column with an index (added in the prior migration)
--     gives O(log n) pivot from trace → all related rows.
--   • Backward-compatible: parameter is optional (default null),
--     so any caller that hasn't been upgraded yet keeps working.
--
-- Rollback hint:
--   DROP FUNCTION public.log_sos_audit(text, text, text, text, text,
--                                       text, jsonb, uuid);
--   -- then re-apply 20260424103233_log_sos_audit_rpc.sql
-- ═══════════════════════════════════════════════════════════════

-- Drop ALL existing variants of log_sos_audit to avoid signature
-- collisions (Postgres allows overloads, but we want exactly ONE).
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
  p_trace_id     uuid default null
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
     metadata, trace_id, created_at)
  values
    (v_id,
     p_action,
     coalesce(p_actor, 'system'),
     coalesce(p_actor_level, 'worker'),
     coalesce(p_operation, 'sos'),
     p_target,
     p_target_name,
     coalesce(p_metadata, '{}'::jsonb),
     p_trace_id,
     now());
end;
$$;

grant execute on function public.log_sos_audit(text, text, text, text, text, text, jsonb, uuid)
  to service_role, authenticated;

comment on function public.log_sos_audit is
  '2026-05-08 (L1-A): adds optional p_trace_id (uuid) parameter so audit rows tied to an SOS lifecycle carry the trace_id used by client + sos-alert + sos_sessions for end-to-end correlation. Backward-compatible — older callers without the parameter keep working (trace_id falls back to NULL).';
