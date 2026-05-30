-- ═══════════════════════════════════════════════════════════════
-- P3-#11 HARDENING — addresses advisor findings on the 5 P3 tables
-- (playbook_usage, risk_register, training_records, investigations,
-- journeys) and the 2 helper functions (touch_updated_at,
-- increment_playbook_use) created in the 2026-04-15 batch.
--
-- This migration was applied retroactively on 2026-05-30 after the
-- drift audit (SUPABASE_DRIFT_AUDIT.md) found those 5 migrations had
-- never reached production. We applied them in sequence then ran
-- Supabase advisors and immediately fixed every WARN they flagged
-- against the new objects.
--
-- Fixes applied:
--   (A) auth_rls_initplan — wrap auth.uid() in (select ...) so the
--       planner caches the result once per query instead of
--       re-evaluating it per row. Standard Supabase RLS perf idiom;
--       roughly 10–100× speedup on large tenant scans.
--   (B) multiple_permissive_policies — split each "_write" (FOR ALL)
--       policy into separate INSERT/UPDATE/DELETE so SELECTs hit
--       only one policy instead of two overlapping ones (cuts
--       planner work and removes redundant security evaluation).
--   (C) touch_updated_at — pin search_path against
--       search-path-hijack attacks (Supabase security advisor).
--   (D) increment_playbook_use — REVOKE EXECUTE from anon (the
--       function self-authorizes via auth.uid(), but defence-in-depth
--       — no caller should reach this RPC who isn't already
--       authenticated). authenticated keeps EXECUTE.
--
-- Idempotency: drops/recreates policies (DROP IF EXISTS first),
-- ALTER FUNCTION is naturally idempotent for SET, and REVOKE is
-- idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ── (C) touch_updated_at search_path ─────────────────────────
alter function public.touch_updated_at() set search_path = public, pg_temp;

-- ── (D) increment_playbook_use anon revoke ───────────────────
revoke execute on function public.increment_playbook_use(uuid, text) from anon, authenticated;
grant execute on function public.increment_playbook_use(uuid, text) to authenticated;

-- ── (A)+(B) Per-table policy hardening ───────────────────────
do $$
declare
  tbl text;
  tables text[] := array['playbook_usage','risk_register','training_records','investigations','journeys'];
begin
  foreach tbl in array tables loop
    execute format('drop policy if exists %I on public.%I', tbl || '_select', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_write',  tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_modify', tbl);

    execute format($f$
      create policy %I on public.%I
        for select using (
          company_id in (select company_id from public.employees where user_id = (select auth.uid()))
          or company_id in (select id from public.companies where owner_id = (select auth.uid()))
        )
    $f$, tbl || '_select', tbl);

    execute format($f$
      create policy %I on public.%I
        for insert with check (
          company_id in (select company_id from public.employees where user_id = (select auth.uid()))
          or company_id in (select id from public.companies where owner_id = (select auth.uid()))
        )
    $f$, tbl || '_insert', tbl);

    execute format($f$
      create policy %I on public.%I
        for update using (
          company_id in (select company_id from public.employees where user_id = (select auth.uid()))
          or company_id in (select id from public.companies where owner_id = (select auth.uid()))
        ) with check (
          company_id in (select company_id from public.employees where user_id = (select auth.uid()))
          or company_id in (select id from public.companies where owner_id = (select auth.uid()))
        )
    $f$, tbl || '_update', tbl);

    execute format($f$
      create policy %I on public.%I
        for delete using (
          company_id in (select company_id from public.employees where user_id = (select auth.uid()))
          or company_id in (select id from public.companies where owner_id = (select auth.uid()))
        )
    $f$, tbl || '_delete', tbl);
  end loop;
end $$;
