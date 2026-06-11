-- ═══════════════════════════════════════════════════════════════════════
-- Dead-man check-in watchdog (P0 life-safety) — 2026-06-10
-- ─────────────────────────────────────────────────────────────────────
-- GAP: the check-in / dead-man timer was CLIENT-ONLY. If the worker was
-- incapacitated and their app was killed / phone died, the auto-SOS never
-- fired — the feature failed in exactly the scenario it exists for.
--
-- INSIGHT: clear_checkin_session() deletes the row on a normal check-in or
-- shift-end (upsert_checkin_session pushes the deadline forward on check-in).
-- So an OVERDUE row that STILL EXISTS = the worker neither checked in nor
-- ended their shift = possible incapacitation. This server-side pg_cron
-- sweep detects that and surfaces a CRITICAL alert to the admin dashboard
-- (sos_queue → realtime CDC), independent of the worker's device state.
--
-- SAFE BY DESIGN: surfaces a *dismissible* admin alert (does NOT auto-dial
-- emergency services); 2-minute grace; ignores ancient rows (>12h stale);
-- dedup (one alert per missed session). Validated read-only: matches 0 rows
-- for healthy workers.
--
-- ROLLBACK:
--   SELECT cron.unschedule('sosphere_checkin_deadman_sweep');
--   DROP FUNCTION IF EXISTS public.sosphere_checkin_deadman_sweep();
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sosphere_checkin_deadman_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT cs.user_id, cs.company_id, cs.employee_name, cs.zone, cs.deadline_ts, cs.started_at
    FROM public.checkin_sessions cs
    WHERE cs.deadline_ts < now() - interval '2 minutes'      -- grace for clock skew
      AND cs.updated_at  > now() - interval '12 hours'       -- ignore ancient/abandoned rows
      AND NOT EXISTS (                                       -- dedup: one alert per missed session
        SELECT 1 FROM public.sos_queue q
        WHERE q.employee_id   = cs.user_id
          AND q.trigger_method = 'missed_checkin'
          AND q.recorded_at   >= cs.started_at
      )
  LOOP
    INSERT INTO public.sos_queue (
      id, company_id, employee_id, employee_name, zone,
      trigger_method, severity, status, type, recorded_at, metadata
    ) VALUES (
      gen_random_uuid()::text, r.company_id, r.user_id,
      COALESCE(NULLIF(r.employee_name, ''), 'Worker'),
      r.zone, 'missed_checkin', 'critical', 'active', 'checkin_timeout', now(),
      jsonb_build_object('reason', 'Check-in deadline missed — possible incapacitation',
                         'deadline_ts', r.deadline_ts, 'auto', true)
    );
  END LOOP;
END;
$func$;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sosphere_checkin_deadman_sweep') THEN
    PERFORM cron.unschedule('sosphere_checkin_deadman_sweep');
  END IF;
END
$do$;

SELECT cron.schedule('sosphere_checkin_deadman_sweep', '* * * * *',
  $cron$SELECT public.sosphere_checkin_deadman_sweep();$cron$);
