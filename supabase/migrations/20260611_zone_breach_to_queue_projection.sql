-- ═══════════════════════════════════════════════════════════════════════
-- Zone-breach → sos_queue projection (P1 life-safety) — 2026-06-11
-- ─────────────────────────────────────────────────────────────────────
-- GAP: geofence breaches were a passive log line, never an alert. A worker
-- ENTERING a high-risk or restricted zone wrote a geofence_events row + an
-- ephemeral broadcast — nobody was alerted, and with no dashboard open the
-- event surfaced to no one.
--
-- FIX: AFTER-INSERT trigger turns an ENTER into a DANGER zone (risk_level
-- 'high' OR type 'restricted') into a durable sos_queue alert (severity
-- 'high'), delivered to the dashboard via CDC. Dedup per (worker, zone)
-- within 10 min; employee resolved NULL-safe. Validated end-to-end: entering
-- a high/restricted zone created exactly one alert; entering a low-risk zone
-- created none (filter correct); tested + cleaned up.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_zone_breach_to_queue ON public.geofence_events;
--   DROP FUNCTION IF EXISTS public.project_zone_breach_to_queue();
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.project_zone_breach_to_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_zname text; v_risk text; v_ztype text;
  v_emp_id uuid; v_name text;
BEGIN
  IF NEW.event_type <> 'enter' THEN RETURN NEW; END IF;

  SELECT z.name, z.risk_level, z.type INTO v_zname, v_risk, v_ztype
  FROM public.zones z WHERE z.id = NEW.zone_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NOT (lower(coalesce(v_risk,'')) = 'high'
          OR lower(coalesce(v_ztype,'')) = 'restricted') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sos_queue q
    WHERE q.trigger_method = 'zone_breach'
      AND (q.metadata->>'zone_id') = NEW.zone_id::text
      AND (q.metadata->>'user_id') = NEW.user_id::text
      AND q.recorded_at > now() - interval '10 minutes'
  ) THEN RETURN NEW; END IF;

  SELECT e.id, e.name INTO v_emp_id, v_name
  FROM public.employees e
  WHERE e.user_id = NEW.user_id AND e.company_id = NEW.company_id
  LIMIT 1;

  INSERT INTO public.sos_queue (
    id, company_id, employee_id, employee_name, zone, lat, lng,
    trigger_method, severity, status, type, recorded_at, metadata
  ) VALUES (
    gen_random_uuid()::text, NEW.company_id, v_emp_id,
    COALESCE(NULLIF(v_name, ''), 'Worker'),
    v_zname, NEW.lat, NEW.lng,
    'zone_breach', 'high', 'active', 'zone_breach', now(),
    jsonb_build_object(
      'reason', 'Worker entered a high-risk/restricted zone — verify safety',
      'zone_id', NEW.zone_id::text, 'zone_name', v_zname,
      'risk_level', v_risk, 'zone_type', v_ztype,
      'user_id', NEW.user_id::text, 'auto', true)
  );
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_zone_breach_to_queue ON public.geofence_events;
CREATE TRIGGER trg_zone_breach_to_queue
  AFTER INSERT ON public.geofence_events
  FOR EACH ROW EXECUTE FUNCTION public.project_zone_breach_to_queue();
