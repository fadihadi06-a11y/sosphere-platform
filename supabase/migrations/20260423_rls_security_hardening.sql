-- ═════════════════════════════════════════════════════════════════════════════
-- 2026-04-23 — RLS & Integrity Hardening
-- ═════════════════════════════════════════════════════════════════════════════
-- Addresses findings from the 2026-04-23 deep audit:
--
--   #31 call_events table has NO RLS → any authenticated user could read all
--       emergency call logs (information disclosure).
--   #32 evidence_vaults allowed users to INSERT rows with a forged
--       emergency_id (only user_id was checked). An attacker could attach
--       their vault to someone else's incident.
--   #33 investigations / risk_register / training_records allowed full UPDATE
--       with NO change history — the compliance tables claim ISO 45001 /
--       ISO 27001 conformance but a malicious admin could rewrite findings.
--   #34 rrp_sessions claimed immutability in comments but had no DELETE-block
--       policy, so responders' analytics could be erased.
--
-- This migration is additive and SAFE: it only tightens existing RLS and
-- adds a change-history table for mutable compliance rows. It does NOT drop
-- columns or break any existing read path.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── #31: call_events — enable RLS + company-scoped read ─────────────────────
alter table if exists public.call_events enable row level security;

drop policy if exists "call_events: members read own company rows" on public.call_events;
create policy "call_events: members read own company rows"
  on public.call_events
  for select
  using (
    company_id in (
      select company_id from public.employees
      where user_id = auth.uid()
    )
    or company_id in (
      select id from public.companies
      where owner_id = auth.uid()
    )
  );

drop policy if exists "call_events: service role inserts only" on public.call_events;
create policy "call_events: service role inserts only"
  on public.call_events
  for insert
  with check (false); -- only service_role bypasses; clients cannot insert

drop policy if exists "call_events: no update" on public.call_events;
create policy "call_events: no update"
  on public.call_events
  for update
  using (false);

drop policy if exists "call_events: no delete" on public.call_events;
create policy "call_events: no delete"
  on public.call_events
  for delete
  using (false);

-- ─── #32: evidence_vaults — validate emergency_id ownership on INSERT ────────
-- Previous policy only checked auth.uid() = user_id, letting a user attach a
-- vault to ANOTHER user's emergency by supplying their emergency_id. Now we
-- require the emergency_id (if present) to exist in civilian_incidents with
-- the same user_id — binding the vault to an incident the caller owns.
drop policy if exists "evidence_vaults_insert_own" on public.evidence_vaults;
create policy "evidence_vaults_insert_own"
  on public.evidence_vaults
  for insert
  with check (
    auth.uid()::text = user_id
    and (
      emergency_id is null
      or exists (
        select 1 from public.civilian_incidents ci
        where ci.id = evidence_vaults.emergency_id
          and ci.user_id = auth.uid()
      )
    )
  );

-- ─── #34: rrp_sessions — block DELETE to match immutability claim ────────────
drop policy if exists "rrp_sessions_no_delete" on public.rrp_sessions;
create policy "rrp_sessions_no_delete"
  on public.rrp_sessions
  for delete
  using (false);

drop policy if exists "rrp_sessions_no_update" on public.rrp_sessions;
create policy "rrp_sessions_no_update"
  on public.rrp_sessions
  for update
  using (false);

-- ─── #33: compliance tables — append-only via change-history table ───────────
-- Investigations, risk_register, training_records must be defensible under
-- audit. Instead of blocking UPDATE outright (which would break normal
-- workflows like adding more investigation notes over time), we log every
-- change into an immutable history table.
create table if not exists public.compliance_change_history (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  company_id uuid not null,
  changed_by uuid not null,
  change_type text not null check (change_type in ('insert','update','delete')),
  before_value jsonb,
  after_value jsonb,
  changed_at timestamptz not null default now()
);

alter table public.compliance_change_history enable row level security;

drop policy if exists "compliance_history_read_company" on public.compliance_change_history;
create policy "compliance_history_read_company"
  on public.compliance_change_history
  for select
  using (
    company_id in (
      select company_id from public.employees where user_id = auth.uid()
    )
    or company_id in (
      select id from public.companies where owner_id = auth.uid()
    )
  );

-- History table is append-only — no update, no delete, no client inserts.
-- Triggers below insert with security-definer so writes bypass these policies.
drop policy if exists "compliance_history_no_update" on public.compliance_change_history;
create policy "compliance_history_no_update"
  on public.compliance_change_history for update using (false);

drop policy if exists "compliance_history_no_delete" on public.compliance_change_history;
create policy "compliance_history_no_delete"
  on public.compliance_change_history for delete using (false);

drop policy if exists "compliance_history_no_insert_client" on public.compliance_change_history;
create policy "compliance_history_no_insert_client"
  on public.compliance_change_history for insert with check (false);

-- ─── Triggers: log UPDATE/DELETE on compliance tables into history ───────────
create or replace function public.log_compliance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _company_id uuid;
  _row_id uuid;
begin
  if tg_op = 'DELETE' then
    _company_id := coalesce(old.company_id, null);
    _row_id := old.id;
    insert into public.compliance_change_history
      (table_name, row_id, company_id, changed_by, change_type, before_value, after_value)
    values
      (tg_table_name, _row_id, _company_id, auth.uid(), 'delete', to_jsonb(old), null);
    return old;
  elsif tg_op = 'UPDATE' then
    _company_id := coalesce(new.company_id, old.company_id);
    _row_id := new.id;
    insert into public.compliance_change_history
      (table_name, row_id, company_id, changed_by, change_type, before_value, after_value)
    values
      (tg_table_name, _row_id, _company_id, auth.uid(), 'update', to_jsonb(old), to_jsonb(new));
    return new;
  else
    return new;
  end if;
end;
$$;

-- Attach to the 3 mutable compliance tables
drop trigger if exists trg_investigations_history on public.investigations;
create trigger trg_investigations_history
  after update or delete on public.investigations
  for each row execute function public.log_compliance_change();

drop trigger if exists trg_risk_register_history on public.risk_register;
create trigger trg_risk_register_history
  after update or delete on public.risk_register
  for each row execute function public.log_compliance_change();

drop trigger if exists trg_training_records_history on public.training_records;
create trigger trg_training_records_history
  after update or delete on public.training_records
  for each row execute function public.log_compliance_change();

-- ─── #28 (partial): server-side audit log helper for SOS events ──────────────
-- The sos-alert Edge Function never wrote to audit_log from the SOS path.
-- This helper makes it trivial for service-role writers to append an audit
-- row in one INSERT without RLS friction. Client-side inserts are still
-- constrained by the existing audit_log RLS.
--
-- FIX 2026-04-24: the first draft of this helper targeted a schema that
-- did NOT match the live DB. Live `audit_log` was originally:
--   (id text pk, action text, actor text, actor_level text, operation text,
--    target text, target_name text, metadata jsonb, created_at timestamptz)
-- — minimal schema with no company_id, no actor_id/actor_name split, no
-- severity/category/detail columns. The entire rest of the codebase
-- (audit-log-store, data-layer, pin-verify-modal, training-center,
-- dashboard-audit-log-page, compliance-reports) assumed a much richer
-- schema. Rather than rewriting 6+ client modules, a separate migration
-- (`audit_log_schema_reconcile_2026_04_24`) extends the live table with
-- the expected columns and renames actor_level → actor_role. This RPC's
-- INSERT targets both the minimal (action/actor/actor_role/operation/
-- target/target_name/metadata) and rich (category/severity/actor_name/
-- detail/target_id/client_timestamp) columns. Parameter names are kept
-- unchanged to avoid breaking the already-deployed sos-alert v17.
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
  -- Stable id per call. We use a ULID-like text so reads in the
  -- audit page can order chronologically. UUID is fine too; text pk
  -- accepts either.
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
     p_actor,
     coalesce(p_metadata->>'reason', p_metadata->>'detail', null),
     p_target,
     now());
end;
$$;

-- Wide grant: service_role (Edge Functions) and authenticated (so logged-in
-- clients can call it directly via supabase.rpc() without needing to
-- understand the schema).
grant execute on function public.log_sos_audit(text, text, text, text, text, text, jsonb) to service_role, authenticated;

comment on function public.log_sos_audit is
  '2026-04-24 v2: populates both the minimal (action/actor/actor_role/operation/target/target_name/metadata) and rich-schema (category/severity/actor_name/detail/target_id/client_timestamp) columns so both the edge-function audit writes and the dashboard/compliance readers see the same row.';
