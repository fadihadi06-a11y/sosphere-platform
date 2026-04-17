-- =================================================================
-- SOSphere — Neighbor Alerts + AI Voice Script Schema
-- =================================================================
-- Run this in Supabase Dashboard → SQL Editor AFTER supabase-setup.sql.
-- Idempotent: safe to re-run.
-- =================================================================

-- ─────────────────────────────────────────────────────────────
-- 1. neighbor_responses
--    Acks written by opted-in neighbours when they receive and act
--    on a nearby SOS broadcast. The service writes one row per
--    response via `respondToAlert()` in neighbor-alert-service.ts.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neighbor_responses (
  id              BIGSERIAL PRIMARY KEY,
  request_id      TEXT NOT NULL,
  responder_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL CHECK (status IN ('on_the_way', 'calling_police', 'cannot_help')),
  note            TEXT,
  responded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_neighbor_responses_request_id
  ON neighbor_responses(request_id);
CREATE INDEX IF NOT EXISTS idx_neighbor_responses_responded_at
  ON neighbor_responses(responded_at DESC);

ALTER TABLE neighbor_responses ENABLE ROW LEVEL SECURITY;

-- RLS — responders may insert their own row; anyone authenticated
-- can read (dashboard needs to see who responded). Stricter policies
-- can be layered on later if a responder identity schema is added.
DROP POLICY IF EXISTS "Responders can insert their own response" ON neighbor_responses;
-- B-C3: responder_id must match authenticated user
CREATE POLICY "Responders can insert their own response"
  ON neighbor_responses FOR INSERT
  TO authenticated
  WITH CHECK (responder_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated can read neighbor_responses" ON neighbor_responses;
CREATE POLICY "Authenticated can read neighbor_responses"
  ON neighbor_responses FOR SELECT
  TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- 2. sos_sessions.ai_script
--    Elite users may attach a personalised TwiML <Say> script to
--    their SOS trigger. The sos-alert edge function validates and
--    stores it here; sos-bridge-twiml reads it at call time.
--
--    Shape (client-enforced, server-validated):
--      { text: string, language: 'en-US' | 'ar-SA', voice: string }
-- ─────────────────────────────────────────────────────────────
ALTER TABLE sos_sessions
  ADD COLUMN IF NOT EXISTS ai_script JSONB;

-- =================================================================
-- Done!
--   • neighbor_responses is ready for inserts + reads
--   • sos_sessions now carries ai_script for the TwiML pipeline
-- =================================================================
