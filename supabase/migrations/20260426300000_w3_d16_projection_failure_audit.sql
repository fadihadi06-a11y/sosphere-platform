-- ═══════════════════════════════════════════════════════════════════════════
-- D-16 / W3 TIER 2 (Wave 3 red-team, 2026-04-26): make project_sos_session_to_queue
-- failures observable.
--
-- BUG: the trigger function caught EVERY exception with `RAISE WARNING` — but
-- warnings go ONLY to the Postgres log, invisible to the dashboard. A
-- silently-broken projection could leave sos_queue empty for a real
-- emergency without any operator-visible signal until forensic post-mortem.
--
-- FIX: in the EXCEPTION clause, also insert a row into audit_log with
-- action='projection_failure' so the dashboard's compliance view sees it
-- in real time. The audit insert is itself wrapped in a try/catch so a
-- secondary failure doesn't bubble up. Best-effort; never blocks the
-- original sos_sessions write.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.project_sos_session_to_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_employee_name text;
  v_employee_id uuid;
  v_company_id uuid;
BEGIN
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
  -- D-16: log the failure both to the Postgres log AND to audit_log so
  -- the dashboard's compliance view sees it in real time.
  RAISE WARNING 'project_sos_session_to_queue failed for session %: %',
    NEW.id, SQLERRM;
  BEGIN
    INSERT INTO public.audit_log (
      id, action, actor, actor_role, operation,
      target, target_name, target_id, metadata,
      category, severity, company_id, created_at
    ) VALUES (
      'AE-PROJ-' || EXTRACT(EPOCH FROM clock_timestamp())::bigint::text
                || '-' || substr(md5(random()::text), 1, 6),
      'projection_failure',
      'system', 'system', 'TRIGGER',
      'sos_sessions', NEW.user_name, NEW.id::text,
      jsonb_build_object(
        'sql_error', SQLERRM,
        'sql_state', SQLSTATE,
        'sos_session_id', NEW.id,
        'auto_projected_from', 'sos_sessions',
        'detail', 'sos_queue projection trigger failed; SOS recorded but dashboard queue may be missing this row'
      ),
      'sos', 'critical', NEW.company_id, now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Defensive: audit insert failure must NOT block the SOS write
    RAISE WARNING '[D-16] secondary audit insert also failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
