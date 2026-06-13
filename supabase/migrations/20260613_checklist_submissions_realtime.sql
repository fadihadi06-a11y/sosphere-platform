-- ═══════════════════════════════════════════════════════════════
-- Realtime for checklist_submissions
-- ─────────────────────────────────────────────────────────────
-- Add the table to the supabase_realtime publication so the admin dashboard
-- receives live INSERT/UPDATE/DELETE events (postgres_changes) when a worker
-- submits a pre-shift checklist — the board updates without a page reload.
-- Realtime still enforces the table's RLS, so a subscriber only receives rows
-- for companies they can read.
-- ═══════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'checklist_submissions'
  ) then
    alter publication supabase_realtime add table public.checklist_submissions;
  end if;
end $$;
