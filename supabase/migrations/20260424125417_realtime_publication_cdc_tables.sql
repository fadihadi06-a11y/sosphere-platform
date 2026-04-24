-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: realtime_publication_cdc_tables_2026_04_24
-- Version:   20260424125417
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- FIX 2026-04-24 (Point 6): enable realtime Postgres CDC on the tables
-- the dashboard needs to observe. sos_queue was already enabled; the
-- rest weren't, so the new shared-store.subscribeCdc() subscriptions
-- would silently receive nothing. Adding them to supabase_realtime
-- makes the dashboard truly realtime across every writer established
-- in Points 1-5.
--
--   audit_log     — Point 2 (sos-alert), Point 3 (dashboard-actions),
--                   Point 5 (packet state) all write here
--   gps_trail     — Point 4 (live employee movement)
--   sos_messages  — Point 3 (dispatcher broadcast / forward-to-owner)
--   evidence      — Point 1 (audio/photo uploads from debrief)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='audit_log'
  ) then
    execute 'alter publication supabase_realtime add table public.audit_log';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='gps_trail'
  ) then
    execute 'alter publication supabase_realtime add table public.gps_trail';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='sos_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.sos_messages';
  end if;
  -- `evidence` table may not exist in the live schema (tests showed no
  -- evidence table earlier — the codebase targets a Supabase Storage
  -- bucket of the same name). Only add if the table exists.
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='evidence')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='evidence'
     ) then
    execute 'alter publication supabase_realtime add table public.evidence';
  end if;
end$$;

-- Verify
select tablename from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public'
  and tablename in ('sos_queue','audit_log','gps_trail','sos_messages','evidence')
order by tablename;
