-- ═══════════════════════════════════════════════════════════════
-- Wave 1 / Task 1.1 — Missions realtime publication (2026-04-29)
-- ─────────────────────────────────────────────────────────────
-- Mission Control was a localStorage-only demo; the dashboard
-- never saw real missions. This migration adds the 3 mission
-- tables to the supabase_realtime publication so the dashboard
-- can subscribe to INSERT/UPDATE/DELETE events.
--
-- RLS is already enabled on all 3 tables with proper company
-- scoping (owner-only or member-only), so realtime will respect
-- those policies automatically — admins see only their tenant's
-- rows, employees see only rows for their company.
--
-- This is part of Audit #6 fix #1 (the "BROKEN AT LAUNCH"
-- finding for Mission Control).
-- ═══════════════════════════════════════════════════════════════

-- Add missions, mission_gps, mission_heartbeats to the publication.
-- Using IF NOT EXISTS pattern via DO block since ALTER PUBLICATION
-- doesn't support that syntax directly.
DO $$
BEGIN
  -- missions
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'missions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.missions';
    RAISE NOTICE 'Added public.missions to supabase_realtime';
  ELSE
    RAISE NOTICE 'public.missions already in supabase_realtime — skip';
  END IF;

  -- mission_gps
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'mission_gps'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.mission_gps';
    RAISE NOTICE 'Added public.mission_gps to supabase_realtime';
  ELSE
    RAISE NOTICE 'public.mission_gps already in supabase_realtime — skip';
  END IF;

  -- mission_heartbeats
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'mission_heartbeats'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.mission_heartbeats';
    RAISE NOTICE 'Added public.mission_heartbeats to supabase_realtime';
  ELSE
    RAISE NOTICE 'public.mission_heartbeats already in supabase_realtime — skip';
  END IF;
END $$;
