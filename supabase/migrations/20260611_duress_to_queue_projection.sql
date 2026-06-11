-- ═══════════════════════════════════════════════════════════════════════
-- Duress → sos_queue projection (P1 life-safety) — 2026-06-11
-- ─────────────────────────────────────────────────────────────────────
-- GAP: a worker coerced into ENDING their SOS enters a duress PIN, which
-- writes a durable audit_log row (action='sos_duress_triggered') + an
-- ephemeral broadcast, then ends the SOS. With no dashboard open the duress
-- signal vanished while the SOS was closed — responders think it's resolved
-- while the worker is still in danger.
--
-- FIX: AFTER-INSERT trigger on audit_log turns a duress event into a durable
-- COVERT sos_queue alert (delivered via CDC), flagged "STILL IN DANGER; do
-- NOT call the worker back". Resolves company/employee from the actor's auth
-- uid NULL-safely; reads NEW only (does not touch the audit hash chain).
-- Validated end-to-end inside a rolled-back transaction (covert critical
-- alert created; nothing persisted; audit chain untouched).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_duress_to_queue ON public.audit_log;
--   DROP FUNCTION IF EXISTS public.project_duress_to_queue();
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.project_duress_to_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_uid uuid; v_company uuid; v_emp_id uuid; v_name text;
BEGIN
  IF NEW.action IS NULL OR NEW.action NOT ILIKE '%duress%' THEN RETURN NEW; END IF;

  BEGIN v_uid := NEW.actor::uuid;
  EXCEPTION WHEN others THEN
    BEGIN v_uid := NEW.actor_id::uuid; EXCEPTION WHEN others THEN RETURN NEW; END;
  END;
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  v_company := NEW.company_id;
  SELECT e.id, e.name, e.company_id INTO v_emp_id, v_name, v_company
  FROM public.employees e WHERE e.user_id = v_uid LIMIT 1;
  IF v_company IS NULL THEN
    SELECT m.company_id INTO v_company
    FROM public.company_memberships m WHERE m.user_id = v_uid AND m.active = true LIMIT 1;
  END IF;
  IF v_company IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.sos_queue q
    WHERE q.trigger_method = 'duress'
      AND (q.metadata->>'user_id') = v_uid::text
      AND q.recorded_at > now() - interval '10 minutes'
  ) THEN RETURN NEW; END IF;

  INSERT INTO public.sos_queue (
    id, company_id, employee_id, employee_name, zone,
    trigger_method, severity, status, type, recorded_at, metadata
  ) VALUES (
    gen_random_uuid()::text, v_company, v_emp_id,
    COALESCE(NULLIF(v_name, ''), NULLIF(NEW.target_name, ''), 'Worker'),
    NEW.zone, 'duress', 'critical', 'active', 'duress', now(),
    jsonb_build_object(
      'reason', 'DURESS — worker was coerced into ending their SOS; treat as STILL IN DANGER; do NOT call the worker back',
      'covert', true, 'user_id', v_uid::text, 'auto', true)
  );
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_duress_to_queue ON public.audit_log;
CREATE TRIGGER trg_duress_to_queue
  AFTER INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.project_duress_to_queue();
