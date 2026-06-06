-- ═══════════════════════════════════════════════════════════════
-- 2026-06-06 — civilian_incidents debrief addendum (27th pattern app)
-- ─────────────────────────────────────────────────────────────
-- The civilian_incidents table + incident-sync shadow pipeline have
-- existed since 2026-04-28 (CRIT 3-tier reports / Retroactive PDF)
-- but the post-emergency debrief addendum (feltSafe + note,
-- submitted by the worker AFTER the incident ended) was written
-- only to localStorage. Result: worker fills the debrief on phone A,
-- switches to phone B → debrief is gone, no legal record of the
-- worker's "I am OK" attestation.
--
-- This migration adds a typed `debrief jsonb` column (separate from
-- the existing `payload jsonb` so the debrief is queryable + indexed
-- without parsing the full incident payload) + an UPDATE-only RPC
-- that owners-only can call. Self-RLS already enforced via the
-- table's existing policies.
--
-- Idempotent: re-running adds nothing.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.civilian_incidents
  ADD COLUMN IF NOT EXISTS debrief jsonb;

CREATE INDEX IF NOT EXISTS idx_civilian_incidents_debrief_present
  ON public.civilian_incidents ((debrief IS NOT NULL));

-- ─── RPC ───────────────────────────────────────────────────────
-- Update the debrief addendum for an incident the caller owns.
-- Idempotent — workers can re-submit if they want to revise the
-- note within the existing debrief window.

CREATE OR REPLACE FUNCTION public.update_incident_debrief(
  p_id      text,
  p_debrief jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_owner  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  IF jsonb_typeof(p_debrief) <> 'object' THEN
    RAISE EXCEPTION 'debrief must be a JSON object' USING errcode = '22023';
  END IF;
  -- Self-only: caller must own the incident row.
  SELECT user_id INTO v_owner
  FROM public.civilian_incidents
  WHERE id = p_id;
  IF v_owner IS NULL THEN
    -- Row doesn't exist (likely the local-only flow hadn't shadow-
    -- synced yet). Caller should retry after the incident-sync run.
    RETURN false;
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'not authorized' USING errcode = '42501';
  END IF;
  UPDATE public.civilian_incidents
     SET debrief = p_debrief
   WHERE id = p_id;
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.update_incident_debrief(text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_incident_debrief(text, jsonb) TO authenticated;
