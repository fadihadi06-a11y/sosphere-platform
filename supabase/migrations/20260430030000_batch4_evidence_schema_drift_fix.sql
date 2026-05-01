-- BATCH 4 HOTFIX: evidence table schema drift
-- Live test caught: "Could not find the 'actions' column of 'evidence' in the schema cache"
-- The client writes 22 columns; production had only 12. Adds the missing 10.

ALTER TABLE public.evidence
  ADD COLUMN IF NOT EXISTS incident_report_id     text,
  ADD COLUMN IF NOT EXISTS photos                 jsonb       DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS audio_memo             text,
  ADD COLUMN IF NOT EXISTS reviewed_by            text,
  ADD COLUMN IF NOT EXISTS reviewed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS actions                jsonb       DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS comments               jsonb       DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_investigation_id text,
  ADD COLUMN IF NOT EXISTS linked_risk_entry_id   text,
  ADD COLUMN IF NOT EXISTS linked_audit_entry_id  text,
  ADD COLUMN IF NOT EXISTS included_in_pdf        boolean     DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_evidence_incident_report_id
  ON public.evidence (incident_report_id) WHERE incident_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evidence_reviewed_by
  ON public.evidence (reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evidence_included_in_pdf
  ON public.evidence (included_in_pdf) WHERE included_in_pdf = true;
