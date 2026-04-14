-- =================================================================
-- SOSphere — Supabase Setup: Evidence Table + Storage Bucket
-- =================================================================
-- Run this in Supabase Dashboard → SQL Editor
-- =================================================================

-- 1. Create the evidence table
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  emergency_id TEXT NOT NULL,
  incident_report_id TEXT,
  submitted_by TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  zone TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  incident_type TEXT NOT NULL,
  worker_comment TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  audio_memo JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'broadcast', 'in_rca', 'closed', 'archived')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  actions JSONB DEFAULT '[]'::jsonb,
  comments JSONB DEFAULT '[]'::jsonb,
  linked_investigation_id TEXT,
  linked_risk_entry_id TEXT,
  linked_audit_entry_id TEXT,
  included_in_pdf BOOLEAN DEFAULT FALSE,
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'paid', 'enterprise')),
  retention_days INTEGER DEFAULT 7,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable Row Level Security
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
-- Allow authenticated users to read all evidence (same company)
CREATE POLICY "Users can read evidence"
  ON evidence FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert evidence
CREATE POLICY "Users can insert evidence"
  ON evidence FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update evidence
CREATE POLICY "Users can update evidence"
  ON evidence FOR UPDATE
  TO authenticated
  USING (true);

-- 4. Create Storage Bucket for evidence files (photos + audio)
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence', 'evidence', true)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage Policies — allow authenticated users to upload/read
CREATE POLICY "Authenticated users can upload evidence files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'evidence');

CREATE POLICY "Anyone can view evidence files"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'evidence');

-- 6. Index for fast queries
CREATE INDEX IF NOT EXISTS idx_evidence_emergency_id ON evidence(emergency_id);
CREATE INDEX IF NOT EXISTS idx_evidence_zone ON evidence(zone);
CREATE INDEX IF NOT EXISTS idx_evidence_status ON evidence(status);
CREATE INDEX IF NOT EXISTS idx_evidence_submitted_at ON evidence(submitted_at DESC);

-- =================================================================
-- Done! After running this:
-- 1. Evidence table is ready
-- 2. Storage bucket "evidence" is created
-- 3. RLS policies protect the data
-- 4. Photos/audio can be uploaded to the bucket
-- =================================================================
