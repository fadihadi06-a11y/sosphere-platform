-- ═══════════════════════════════════════════════════════════════════════
-- Discreet/silent SOS → sos_queue projection (P0 life-safety) — 2026-06-11
-- ─────────────────────────────────────────────────────────────────────
-- GAP: silent/discreet SOS (for coercion/abduction) wrote a durable
-- discreet_sessions row but NEVER reached the responder dashboard durably —
-- it relied on an ephemeral Realtime broadcast, lost if no dashboard was open
-- at that instant. In the exact scenario the feature exists for, the alert
-- could vanish.
--
-- FIX: project every new discreet session into sos_queue (the durable feed,
-- delivered via CDC even to a later-opened dashboard) WITHOUT any device
-- noise or auto-dial that could tip off an attacker. Flagged covert so the
-- dispatcher knows NOT to call the worker back. Resolves sos_queue.employee_id
-- (employees.id, FK, nullable) from the discreet session's auth uid NULL-safely.
-- Validated: simulated discreet session auto-created a critical covert
-- sos_queue alert with location; tested + cleaned up.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_discreet_session_to_queue ON public.discreet_sessions;
--   DROP FUNCTION IF EXISTS public.project_discreet_session_to_queue();
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.project_discreet_session_to_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_emp_id uuid;
  v_name   text;
BEGIN
  SELECT e.id, e.name INTO v_emp_id, v_name
  FROM public.employees e
  WHERE e.user_id = NEW.employee_id AND e.company_id = NEW.company_id
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.sos_queue q WHERE (q.metadata->>'discreet_session_id') = NEW.id::text
  ) THEN
    INSERT INTO public.sos_queue (
      id, company_id, employee_id, employee_name, lat, lng,
      trigger_method, severity, status, type, recorded_at, metadata
    ) VALUES (
      gen_random_uuid()::text, NEW.company_id, v_emp_id,
      COALESCE(NULLIF(v_name, ''), 'Worker'),
      NEW.start_lat, NEW.start_lng,
      'discreet_sos', 'critical', 'active', 'discreet', now(),
      jsonb_build_object(
        'reason', 'Silent/discreet SOS — handle covertly; do NOT call the worker back',
        'silent', true, 'mode', NEW.mode,
        'discreet_session_id', NEW.id::text,
        'user_id', NEW.employee_id::text)
    );
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_discreet_session_to_queue ON public.discreet_sessions;
CREATE TRIGGER trg_discreet_session_to_queue
  AFTER INSERT ON public.discreet_sessions
  FOR EACH ROW EXECUTE FUNCTION public.project_discreet_session_to_queue();
