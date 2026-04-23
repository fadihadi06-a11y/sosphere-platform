-- ═══════════════════════════════════════════════════════════════
-- SOSphere — gps_trail schema alignment (AUDIT-FIX 2026-04-18)
-- ─────────────────────────────────────────────────────────────
-- Live audit on a real Android device discovered the GPS tracker
-- was failing to sync to `gps_trail` with PGRST204:
--     "Could not find the 'altitude' column of 'gps_trail' in the
--      schema cache"
--
-- The client-side payload (offline-gps-tracker.ts#_syncBuffer.push)
-- writes these columns:
--   employee_id, lat, lng, accuracy, altitude, speed, heading,
--   battery, is_emergency, session_id, recorded_at
--
-- This migration adds any of those that are missing from the table.
-- Uses `ADD COLUMN IF NOT EXISTS` so it is safe to run multiple
-- times and on partially-migrated schemas.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.gps_trail
  ADD COLUMN IF NOT EXISTS altitude     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS speed        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS heading      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS battery      INTEGER,
  ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS session_id   TEXT;

-- Force PostgREST to reload its schema cache so the next insert
-- from a client picks up the new columns without a server restart.
NOTIFY pgrst, 'reload schema';
