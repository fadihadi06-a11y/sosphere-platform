-- ═══════════════════════════════════════════════════════════════════════════
-- L5-SEC-1 (2026-05-12): close log_sos_audit actor-UUID forgery
-- ─────────────────────────────────────────────────────────────────────────
-- THREAT (Critical, found during pre-launch security review)
--   The D-15 hardening (2026-04-27) forced actor_role to a freshly-read
--   value from public.profiles, closing the stale-TTL impersonation. But
--   it left p_actor (the actor's UUID/identity) trusted from the client.
--
--   Any authenticated user could call:
--     supabase.rpc('log_sos_audit', {
--       p_action: 'mission_resolved',
--       p_actor:  '<admin-user-uuid>',  -- ANY UUID
--       p_actor_level: 'whatever',      -- ignored, overridden by D-15
--       ...
--     });
--   and the row would be hashed (L2-D chain) with actor pointing at the
--   victim. The hash chain "verifies" intact, but it's verifying lies.
--   The forensic trail is unrecoverable.
--
-- FIX
--   Detect the caller's identity inside the SECDEF function. Apply
--   override capability in tiers, most-trusted first:
--     • postgres / supabase_admin (raw superuser, e.g. MCP execute_sql,
--       pg_cron, manual DB ops) — full override. session_user check.
--     • service_role JWT (edge functions, PostgREST RPC) — full
--       override. JWT-role check.
--     • authenticated JWT (browser/mobile client) — IGNORE p_actor,
--       pin to auth.uid().
--     • anon / unknown — reject entirely (insufficient_privilege).
--
--   The session_user allowlist is required because PostgREST sets
--   session_user='authenticator' and SET ROLE for the JWT identity, but
--   MCP/cron/manual ops connect as 'postgres' with no JWT — those
--   callers ALREADY bypass everything (RLS via BYPASSRLS, etc.), so
--   blocking them here would just break legitimate admin ops.
--
--   We annotate metadata.actor_id_source so post-hoc forensic analysis
--   can distinguish revalidated rows ('auth_uid'), service-attributed
--   rows ('service_override'), and superuser-attributed rows
--   ('superuser_override'). Legacy rows have no actor_id_source.
--
--   When an authenticated caller supplies a non-matching p_actor (a
--   forgery attempt), we record the claim in metadata.actor_id_claim_overridden
--   so forensic analysts can see what was attempted.
--
-- COMPATIBILITY
--   All 9 edge-function call sites use the service-role client (admin)
--   — verified by grep on supabase/functions/**. No edge function passes
--   a forged actor; they all attribute correctly.
--   Browser/client call sites (shared-store.ts, dashboard-sar-page.tsx,
--   sos-emergency.tsx) pass the user's own UUID. After this migration
--   their explicit p_actor is silently replaced with auth.uid() — same
--   value, no behaviour change.
--
-- ROLLBACK
--   Replay the L1-A migration (20260508140000_l1a_log_sos_audit_trace_id_param.sql)
--   to restore the pre-L5 production body.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_actor text;
  v_actor_id_source text;
  v_fresh_role text := null;
  v_resolved_role text;
  v_role_source text := 'claim';
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_caller_role text;
  v_session_user text;
begin
  v_id := 'AUD-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISSMS')
       || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  begin
    v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  exception when others then
    v_caller_role := null;
  end;
  v_session_user := session_user;

  -- L5-SEC-1: actor identity authentication tiers, from most-privileged
  -- to most-restricted:
  --   * postgres / supabase_admin (raw superuser, e.g. MCP execute_sql,
  --     pg_cron) — full override.
  --   * service_role JWT (edge functions, cron via PostgREST RPC) —
  --     full override.
  --   * authenticated JWT (browser/mobile client) — IGNORE p_actor,
  --     pin to auth.uid().
  --   * anon / unknown — reject entirely.
  if v_session_user in ('postgres', 'supabase_admin') then
    v_actor := coalesce(p_actor, 'system');
    v_actor_id_source := 'superuser_override';
  elsif v_caller_role = 'service_role' then
    v_actor := coalesce(p_actor, 'system');
    v_actor_id_source := 'service_override';
  elsif v_caller_role = 'authenticated' then
    if auth.uid() is null then
      raise exception 'log_sos_audit: authenticated caller has null auth.uid()'
        using errcode = '42501';
    end if;
    v_actor := auth.uid()::text;
    v_actor_id_source := 'auth_uid';
  else
    raise exception 'log_sos_audit: caller role % is not permitted to write audit', coalesce(v_caller_role, 'null')
      using errcode = '42501';
  end if;

  begin
    v_actor_uuid := v_actor::uuid;
  exception when others then v_actor_uuid := null; end;

  if v_resolved_company is null and v_actor_uuid is not null then
    select active_company_id into v_resolved_company
      from public.profiles where id = v_actor_uuid limit 1;
  end if;

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

  v_metadata := jsonb_set(v_metadata, '{actor_role_source}', to_jsonb(v_role_source), true);
  v_metadata := jsonb_set(v_metadata, '{actor_id_source}',   to_jsonb(v_actor_id_source), true);
  if v_role_source = 'fresh' and v_fresh_role is distinct from p_actor_level then
    v_metadata := jsonb_set(v_metadata, '{stale_role_claim}', to_jsonb(p_actor_level), true);
  end if;
  if v_actor_id_source = 'auth_uid'
     and p_actor is not null
     and p_actor <> v_actor then
    v_metadata := jsonb_set(v_metadata, '{actor_id_claim_overridden}', to_jsonb(p_actor), true);
  end if;

  insert into public.audit_log
    (id, action, actor, actor_role, operation, target, target_name,
     metadata, created_at, category, severity, actor_name, detail,
     target_id, client_timestamp, company_id, trace_id)
  values
    (v_id, p_action, v_actor,
     v_resolved_role, coalesce(p_operation, 'sos'),
     p_target, p_target_name, v_metadata, now(),
     'emergency', coalesce(v_metadata->>'severity', 'info'),
     v_actor, coalesce(v_metadata->>'reason', v_metadata->>'detail', null),
     p_target, now(), v_resolved_company, p_trace_id);
end;
$$;

grant execute on function public.log_sos_audit(text, text, text, text, text, text, jsonb, uuid, uuid)
  to service_role, authenticated;

comment on function public.log_sos_audit is
  'L5-SEC-1 (2026-05-12): closes actor-UUID forgery. Authenticated callers can no longer claim a different actor; p_actor is overridden with auth.uid(). service_role + postgres/supabase_admin retain override capability. anon and unknown roles rejected. Preserves D-15 role freshness + L1-A trace_id.';
