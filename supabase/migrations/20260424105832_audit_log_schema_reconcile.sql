-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: audit_log_schema_reconcile_2026_04_24
-- Version:   20260424105832
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- Reconcile audit_log with what the entire codebase expects.
-- Audit: empty (0 rows) — safe to rename column and add new ones.
-- Client code (audit-log-store.ts, data-layer.ts, pin-verify-modal.tsx,
-- training-center.tsx) all expect the richer schema. Extending the live
-- table is strictly additive for the fields the RPC I just deployed uses
-- (`action`, `actor`, `actor_level`/`actor_role`, `operation`, `target`,
-- `target_name`, `metadata`, `created_at` all stay).

-- 1) Rename actor_level → actor_role (semantically identical; whole
--    codebase uses `actor_role`). actor_level had no index or FK usage.
alter table public.audit_log rename column actor_level to actor_role;

-- 2) Add the rich-schema columns that every client insert/select assumes.
alter table public.audit_log
  add column if not exists company_id        uuid references public.companies(id) on delete cascade,
  add column if not exists actor_id          text,
  add column if not exists actor_name        text,
  add column if not exists category          text,
  add column if not exists detail            text,
  add column if not exists target_id         text,
  add column if not exists target_role       text,
  add column if not exists before_value      text,
  add column if not exists after_value       text,
  add column if not exists zone              text,
  add column if not exists ip_address        inet,
  add column if not exists device_info       text,
  add column if not exists severity          text default 'info',
  add column if not exists verified_2fa      boolean default false,
  add column if not exists client_timestamp  timestamptz;

-- 3) Indexes to match client query patterns (company-scoped reverse-chron
--    is the most common, from data-layer.fetchAuditLog + compliance reports).
create index if not exists audit_log_company_time_idx
  on public.audit_log(company_id, created_at desc);
create index if not exists audit_log_company_category_idx
  on public.audit_log(company_id, category);
create index if not exists audit_log_target_id_idx
  on public.audit_log(target_id);

-- 4) Replace log_sos_audit RPC so it populates the rich columns too.
--    Parameter names kept unchanged so the already-deployed sos-alert
--    function (v17) continues to work without redeploy — only the body
--    maps the params onto the new column layout.
drop function if exists public.log_sos_audit(text, text, text, text, text, text, jsonb);
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
    (id, action, actor, actor_role, operation, target, target_name,
     metadata, created_at,
     -- Rich-schema mirrors so dashboard + compliance readers see the row.
     category, severity, actor_name, detail, target_id, client_timestamp)
  values
    (v_id,
     p_action,
     coalesce(p_actor, 'system'),
     coalesce(p_actor_level, 'worker'),
     coalesce(p_operation, 'sos'),
     p_target,
     p_target_name,
     coalesce(p_metadata, '{}'::jsonb),
     now(),
     'emergency',
     coalesce(p_metadata->>'severity', 'info'),
     p_actor,  -- actor_name mirror (edge function passes auth uid as p_actor)
     coalesce(p_metadata->>'reason', p_metadata->>'detail', null),
     p_target,
     now());
end;
$$;

grant execute on function public.log_sos_audit(text, text, text, text, text, text, jsonb)
  to service_role, authenticated;

comment on function public.log_sos_audit is
  '2026-04-24 v2: populates both the minimal (action/actor/actor_role/operation/target/target_name/metadata) and rich-schema (category/severity/actor_name/detail/target_id/client_timestamp) columns so both the edge-function audit writes and the dashboard/compliance readers see the same row.';

-- 5) RLS check: audit_log already has RLS enabled with policies
--    "Admins can read audit" (r) and "System can insert audit" (a).
--    The RPC is security-definer so it bypasses RLS for writes, and
--    reads go through the admin policy as before. No change needed.
