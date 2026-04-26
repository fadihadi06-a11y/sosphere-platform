-- ═══════════════════════════════════════════════════════════════════════════
-- W3-9b (Wave 3 red-team, 2026-04-26): repair `notify_emergency` trigger.
--
-- BUG: same class as W3-9. The trigger function references three columns
-- that DO NOT EXIST on the `emergencies` table:
--   NEW.scenario   → real column is NEW.type   (e.g. "SOS Button")
--   NEW.latitude   → real column is NEW.lat
--   NEW.longitude  → real column is NEW.lon  (also NEW.lng exists)
--
-- IMPACT: every INSERT into emergencies fires this trigger, which then
-- raises `42703: record "new" has no field "scenario"` and rolls back the
-- original INSERT. Combined with W3-9 (now fixed), this was the SECOND
-- silent failure path on every dashboard SOS-create attempt.
--
-- FIX:
--   - rename NEW.scenario → NEW.type   (with COALESCE fallback)
--   - rename NEW.latitude/longitude → NEW.lat/NEW.lon
--   - wrap in EXCEPTION handler so a notify failure NEVER breaks SOS
--   - keep original Arabic notification copy
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_emergency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  BEGIN
    INSERT INTO notifications (user_id, title, body, type, data)
    VALUES (
      NEW.user_id,
      'تم تفعيل SOS',
      'تم إبلاغ جهات الاتصال الخاصة بك',
      'emergency',
      jsonb_build_object(
        'emergency_id', NEW.id,
        'type', COALESCE(NEW.type, 'SOS Button')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_emergency] notifications insert failed (id=%): %',
      NEW.id, SQLERRM;
  END;

  BEGIN
    INSERT INTO emergency_logs (emergency_id, action, details)
    VALUES (
      NEW.id,
      'created',
      jsonb_build_object(
        'type', COALESCE(NEW.type, 'SOS Button'),
        'lat', NEW.lat,
        'lon', NEW.lon
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_emergency] emergency_logs insert failed (id=%): %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
