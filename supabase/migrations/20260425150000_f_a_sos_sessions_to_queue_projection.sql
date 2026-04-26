-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: f_a_sos_sessions_to_queue_projection
-- Version:   20260425150000
-- Applied:   2026-04-25 via Supabase MCP (multi-step: schema reconcile, FK
--            fix, trigger v3 — final state captured here as one migration)
-- Source of truth: this file matches what was applied to prod.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- F-A (2026-04-25) — Connect sos_sessions and sos_queue.
--
-- Discovered during the verification pass (AUDIT_VERIFICATION_LOG.md):
--   • sos-alert writes 19 columns to sos_sessions that didn't exist
--     pre-fix; every persistence call has been silently failing.
--   • Even if it did write, dashboard-actions reads from sos_queue,
--     and there was NO link (no trigger, no RPC, no edge function)
--     between the two tables.
--
-- Fix has 3 parts:
--   (1) Reconcile sos_sessions schema with what sos-alert writes,
--       relax the over-restrictive CHECK constraints, and make
--       context_type / triggered_at nullable (sos-alert never sets them).
--   (2) AFTER INSERT trigger on sos_sessions that projects the
--       relevant fields into sos_queue. Falls back through
--       (NEW.user_name → employees.name → profiles.full_name → 'Unknown')
--       for the NOT NULL employee_name column. Resolves employees.id
--       from user_id (the FK target) so civilians without an employee
--       row get NULL employee_id rather than a constraint violation.
--   (3) Idempotent on sos_queue.id (ON CONFLICT DO NOTHING) so manual
--       pre-population paths still win.
--
-- Verified by 7 scenarios (S1..S7 in AUDIT_VERIFICATION_LOG):
--   ✓ Full payload with user_name override
--   ✓ Prewarm minimal (employee.name fallback)
--   ✓ profile-only user (profiles.full_name fallback)
--   ✓ civilian without company (NULLs preserved)
--   ✓ Pre-existing queue row not overwritten (idempotency)
--   ✓ UPDATE on sos_sessions does not duplicate the queue row
--   ✓ End-to-end beehive: trigger → dashboard-actions resolve works
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Part 1: schema reconcile ──────────────────────────────────────
ALTER TABLE public.sos_sessions DROP CONSTRAINT IF EXISTS sos_sessions_status_check;
ALTER TABLE public.sos_sessions DROP CONSTRAINT IF EXISTS sos_sessions_context_type_check;
ALTER TABLE public.sos_sessions DROP CONSTRAINT IF EXISTS sos_sessions_trigger_source_check;
ALTER TABLE public.sos_sessions
  ADD CONSTRAINT sos_sessions_status_check
  CHECK (status IN (
    'active','prewarm','calling','answered','recording','documenting',
    'ended','resolved','cancelled','escalated','timeout'
  ));
ALTER TABLE public.sos_sessions
  ALTER COLUMN context_type DROP NOT NULL,
  ALTER COLUMN triggered_at DROP NOT NULL;
ALTER TABLE public.sos_sessions
  ALTER COLUMN triggered_at SET DEFAULT now();

ALTER TABLE public.sos_sessions
  ADD COLUMN IF NOT EXISTS user_name           text,
  ADD COLUMN IF NOT EXISTS user_phone          text,
  ADD COLUMN IF NOT EXISTS tier                text,
  ADD COLUMN IF NOT EXISTS started_at          timestamptz,
  ADD COLUMN IF NOT EXISTS last_heartbeat      timestamptz,
  ADD COLUMN IF NOT EXISTS lat                 double precision,
  ADD COLUMN IF NOT EXISTS lng                 double precision,
  ADD COLUMN IF NOT EXISTS last_lat            double precision,
  ADD COLUMN IF NOT EXISTS last_lng            double precision,
  ADD COLUMN IF NOT EXISTS accuracy            double precision,
  ADD COLUMN IF NOT EXISTS address             text,
  ADD COLUMN IF NOT EXISTS blood_type          text,
  ADD COLUMN IF NOT EXISTS zone                text,
  ADD COLUMN IF NOT EXISTS contact_count       integer,
  ADD COLUMN IF NOT EXISTS silent_mode         boolean,
  ADD COLUMN IF NOT EXISTS ai_script           jsonb,
  ADD COLUMN IF NOT EXISTS battery_level       integer,
  ADD COLUMN IF NOT EXISTS elapsed_sec         integer,
  ADD COLUMN IF NOT EXISTS server_triggered_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated           boolean,
  ADD COLUMN IF NOT EXISTS escalation_stage    text;

-- ── Part 2: trigger function (v3 — FK-aware, fallback chain) ──────
CREATE OR REPLACE FUNCTION public.project_sos_session_to_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_employee_name text;
  v_employee_id uuid;
  v_company_id uuid;
BEGIN
  -- Resolve employee_id (FK → employees.id) and the best-known name in one pass.
  SELECT e.id, coalesce(e.name, p.full_name, NEW.user_name, 'Unknown')
    INTO v_employee_id, v_employee_name
  FROM (SELECT NEW.user_id AS uid) base
  LEFT JOIN public.employees e ON e.user_id = base.uid
  LEFT JOIN public.profiles  p ON p.user_id = base.uid OR p.id = base.uid
  LIMIT 1;

  IF NEW.user_name IS NOT NULL AND length(trim(NEW.user_name)) > 0 THEN
    v_employee_name := NEW.user_name;
  END IF;
  IF v_employee_name IS NULL OR length(trim(v_employee_name)) = 0 THEN
    v_employee_name := 'Unknown';
  END IF;

  -- Validate company FK before insert (drop if invalid).
  IF NEW.company_id IS NOT NULL THEN
    PERFORM 1 FROM public.companies WHERE id = NEW.company_id;
    IF FOUND THEN v_company_id := NEW.company_id;
    ELSE v_company_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.sos_queue (
    id, emergency_id, employee_id, employee_name, company_id,
    status, trigger_method, severity, recorded_at, lat, lng,
    battery_level, metadata
  )
  VALUES (
    NEW.id::text, NEW.id::text,
    v_employee_id, v_employee_name, v_company_id,
    'active',
    coalesce(NEW.trigger_source, NEW.tier, 'sos'),
    'critical',
    coalesce(NEW.started_at, NEW.triggered_at, now()),
    NEW.lat, NEW.lng, NEW.battery_level,
    jsonb_build_object(
      'auto_projected_from','sos_sessions',
      'sos_session_id', NEW.id,
      'context_type', NEW.context_type,
      'tier', NEW.tier, 'silent_mode', NEW.silent_mode,
      'projected_at', now())
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'project_sos_session_to_queue failed for session %: %',
    NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sos_session_to_queue_trg ON public.sos_sessions;
CREATE TRIGGER sos_session_to_queue_trg
  AFTER INSERT ON public.sos_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.project_sos_session_to_queue();

COMMENT ON FUNCTION public.project_sos_session_to_queue IS
  'F-A 2026-04-25: AFTER INSERT trigger on sos_sessions that projects a '
  'normalized dispatcher row into sos_queue. Resolves employees.id from '
  'auth user_id; falls back to NULL when no employee row exists. '
  'Verified by 7 scenarios in AUDIT_VERIFICATION_LOG.md.';
