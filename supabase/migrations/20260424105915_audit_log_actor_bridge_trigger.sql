-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: audit_log_actor_bridge_trigger_2026_04_24
-- Version:   20260424105915
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- The live audit_log.actor column is NOT NULL (minimal-schema legacy).
-- Client code writes actor_name / actor_id, not actor. A BEFORE INSERT
-- trigger bridges the gap so both shapes work without changing either.
create or replace function public.audit_log_normalize_actor()
returns trigger
language plpgsql
as $$
begin
  if new.actor is null then
    new.actor := coalesce(new.actor_name, new.actor_id, 'system');
  end if;
  -- Category is also commonly unset in the minimal-schema RPC but the
  -- client always sets it; we default it here so client-shape inserts
  -- without category still have a sensible value.
  if new.category is null then
    new.category := coalesce(new.operation, 'other');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_log_normalize_actor on public.audit_log;
create trigger trg_audit_log_normalize_actor
  before insert on public.audit_log
  for each row execute function public.audit_log_normalize_actor();

comment on function public.audit_log_normalize_actor is
  '2026-04-24: bridges the minimal (actor NOT NULL) and rich (actor_name) column naming so both insert shapes work — log_sos_audit RPC and audit-log-store client.';
