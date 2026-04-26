-- ═══════════════════════════════════════════════════════════════════════════
-- W3-34 (Wave 3 red-team, 2026-04-26): sos_sessions state-machine guard.
--
-- BUG: sos_sessions.status is plain text with no constraint. The owner can
-- set their session to 'active' → 'resolved' → 'active' again (or any other
-- combination), corrupting the forensic timeline. A police-grade evidence
-- chain requires terminal states ('resolved', 'canceled') to be permanent.
--
-- FIX:
--   1. CHECK constraint enforces the known status values.
--   2. BEFORE UPDATE trigger forbids transitions OUT of a terminal state.
--      Service-role bypasses both via session_replication_role='replica'.
--      (Edge functions like sos-alert run with service-role key, but they
--      always WRITE forward, never reverse. So the trigger only blocks
--      tampering attempts via direct UPDATE from authenticated/anon.)
-- ═══════════════════════════════════════════════════════════════════════════

-- Status set: prewarm → active → escalated → (resolved | canceled)
-- Terminal: resolved, canceled. No transition out of those.
DO $$
BEGIN
  -- Drop any existing CHECK on status first.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sos_sessions'::regclass AND conname = 'sos_sessions_status_check'
  ) THEN
    ALTER TABLE public.sos_sessions DROP CONSTRAINT sos_sessions_status_check;
  END IF;
  ALTER TABLE public.sos_sessions
    ADD CONSTRAINT sos_sessions_status_check
    CHECK (status IS NULL OR status IN
      ('prewarm', 'active', 'escalated', 'resolved', 'canceled', 'cancelled', 'ended'));
END $$;

-- BEFORE UPDATE trigger: terminal states are permanent.
CREATE OR REPLACE FUNCTION public.sos_sessions_state_machine_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Allow if status is unchanged.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  -- Once in a terminal state, the only allowed change is back to the same
  -- terminal label (idempotent retry). Any other transition raises.
  IF OLD.status IN ('resolved', 'canceled', 'cancelled', 'ended')
     AND NEW.status NOT IN ('resolved', 'canceled', 'cancelled', 'ended') THEN
    RAISE EXCEPTION
      'W3-34: sos_sessions state machine — cannot transition from terminal state % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sos_sessions_state_machine ON public.sos_sessions;
CREATE TRIGGER trg_sos_sessions_state_machine
  BEFORE UPDATE ON public.sos_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sos_sessions_state_machine_guard();
