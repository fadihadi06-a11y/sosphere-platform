-- ═══════════════════════════════════════════════════════════════
-- 2026-06-08 — Weather scheduled sweeps (pg_cron + pg_net)
-- ─────────────────────────────────────────────────────────────
-- Phase 2 of the 29th pattern app: scheduled per-zone weather pulls.
--
-- Architecture (mirrors trigger_bulk_invite_worker doctrine):
--   1. weather_fetch_schedule table — one row per (company, zone)
--      with lat/lng + frequency_minutes + enabled flag + last_fetched_at
--   2. upsert/delete/list_weather_schedule RPCs — super_admin gated
--   3. trigger_weather_sweep() — cron-invoked. Picks due schedules
--      (last_fetched_at older than frequency_minutes ago), fires one
--      net.http_post per zone to /functions/v1/weather-fetch?action=sweep
--      with x-cron-secret header.
--   4. record_weather_observation_cron() — server-side variant of
--      record_weather_observation, callable WITHOUT auth.uid() via
--      service_role only. Used by weather-fetch in sweep mode.
--   5. pg_cron entry: sosphere_weather_sweep every 15 minutes
--
-- SETUP (required by super_admin before sweeps start working):
--   1. OPENWEATHER_API_KEY in Supabase Function Secrets (free tier OK)
--   2. weather_fetch_url in Vault, value:
--        https://<project>.supabase.co/functions/v1/weather-fetch
--   3. cron_shared_secret in Vault (already exists from bulk-invite path)
--   4. At least one row in weather_fetch_schedule via upsert_weather_schedule
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.weather_fetch_schedule (
  id                  text PRIMARY KEY,
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  zone_id             text,
  lat                 numeric NOT NULL,
  lng                 numeric NOT NULL,
  frequency_minutes   integer NOT NULL DEFAULT 60 CHECK (frequency_minutes BETWEEN 15 AND 1440),
  enabled             boolean NOT NULL DEFAULT true,
  last_fetched_at     timestamptz,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, zone_id)
);

CREATE INDEX IF NOT EXISTS idx_weather_schedule_due
  ON public.weather_fetch_schedule (last_fetched_at NULLS FIRST, frequency_minutes)
  WHERE enabled = true;

ALTER TABLE public.weather_fetch_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weather_schedule_company_read ON public.weather_fetch_schedule;
CREATE POLICY weather_schedule_company_read ON public.weather_fetch_schedule
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.company_memberships cm
    WHERE cm.user_id = (SELECT auth.uid())
      AND cm.company_id = weather_fetch_schedule.company_id
      AND cm.active = true
  ));

CREATE OR REPLACE FUNCTION public.upsert_weather_schedule(
  p_company_id        uuid,
  p_zone_id           text,
  p_lat               numeric,
  p_lng               numeric,
  p_frequency_minutes integer DEFAULT 60,
  p_enabled           boolean DEFAULT true
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid(); v_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = '42501'; END IF;
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'not authorized' USING errcode = '42501'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'invalid coordinates' USING errcode = '22023';
  END IF;
  IF p_frequency_minutes < 15 OR p_frequency_minutes > 1440 THEN
    RAISE EXCEPTION 'frequency must be 15-1440 minutes' USING errcode = '22023';
  END IF;
  v_id := 'WS-' || replace(p_company_id::text, '-', '') || '-' || COALESCE(p_zone_id, 'site');
  INSERT INTO public.weather_fetch_schedule (id, company_id, zone_id, lat, lng, frequency_minutes, enabled, created_at, updated_at)
  VALUES (v_id, p_company_id, p_zone_id, p_lat, p_lng, p_frequency_minutes, p_enabled, now(), now())
  ON CONFLICT (company_id, zone_id) DO UPDATE SET
    lat = EXCLUDED.lat, lng = EXCLUDED.lng,
    frequency_minutes = EXCLUDED.frequency_minutes, enabled = EXCLUDED.enabled, updated_at = now();
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.upsert_weather_schedule(uuid, text, numeric, numeric, integer, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_weather_schedule(uuid, text, numeric, numeric, integer, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_weather_schedule(p_company_id uuid, p_zone_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = '42501'; END IF;
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'not authorized' USING errcode = '42501'; END IF;
  DELETE FROM public.weather_fetch_schedule
   WHERE company_id = p_company_id
     AND (zone_id = p_zone_id OR (zone_id IS NULL AND p_zone_id IS NULL));
  RETURN FOUND;
END $$;
REVOKE EXECUTE ON FUNCTION public.delete_weather_schedule(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_weather_schedule(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_weather_schedules(p_company_id uuid)
RETURNS SETOF public.weather_fetch_schedule
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp STABLE
AS $$
  SELECT * FROM public.weather_fetch_schedule
  WHERE company_id = p_company_id
    AND EXISTS (
      SELECT 1 FROM public.company_memberships cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.company_id = p_company_id AND cm.active = true)
  ORDER BY zone_id NULLS FIRST;
$$;
REVOKE EXECUTE ON FUNCTION public.list_weather_schedules(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_weather_schedules(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_weather_observation_cron(
  p_company_id uuid, p_zone_id text, p_lat numeric, p_lng numeric, p_payload jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id text; v_condition text; v_severity text := 'info';
  v_temp numeric; v_feels numeric; v_humidity integer;
  v_wind numeric; v_gust numeric; v_vis integer; v_alert_count integer := 0;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object' USING errcode = '22023';
  END IF;
  v_condition := COALESCE(p_payload #>> '{weather,0,main}', 'Unknown');
  v_temp     := NULLIF(p_payload #>> '{main,temp}', '')::numeric;
  v_feels    := NULLIF(p_payload #>> '{main,feels_like}', '')::numeric;
  v_humidity := NULLIF(p_payload #>> '{main,humidity}', '')::integer;
  v_wind     := NULLIF(p_payload #>> '{wind,speed}', '')::numeric;
  v_gust     := NULLIF(p_payload #>> '{wind,gust}', '')::numeric;
  v_vis      := NULLIF(p_payload #>> '{visibility}', '')::integer;
  IF v_condition IN ('Thunderstorm','Tornado','Squall') THEN v_severity := 'severe';
  ELSIF v_condition IN ('Sand','Dust','Ash') THEN v_severity := 'severe';
  ELSIF v_temp IS NOT NULL AND v_temp >= 45 THEN v_severity := 'severe';
  ELSIF v_gust IS NOT NULL AND v_gust >= 20 THEN v_severity := 'severe';
  ELSIF v_condition IN ('Snow','Fog','Mist','Haze') THEN v_severity := 'warning';
  ELSIF v_temp IS NOT NULL AND v_temp >= 40 THEN v_severity := 'warning';
  ELSIF v_vis IS NOT NULL AND v_vis < 1000 THEN v_severity := 'warning';
  END IF;
  IF jsonb_typeof(p_payload -> 'alerts') = 'array' THEN
    v_alert_count := jsonb_array_length(p_payload -> 'alerts');
    IF v_alert_count > 0 AND v_severity = 'info' THEN v_severity := 'warning'; END IF;
  END IF;
  v_id := 'WX-' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.weather_log (
    id, company_id, zone_id, observed_at, lat, lng,
    condition, temp_c, feels_like_c, humidity_pct,
    wind_speed_ms, wind_gust_ms, visibility_m,
    severity, provider, payload, observer_id
  ) VALUES (
    v_id, p_company_id, p_zone_id, now(), p_lat, p_lng,
    v_condition, v_temp, v_feels, v_humidity,
    v_wind, v_gust, v_vis,
    v_severity, 'openweather_cron', p_payload, NULL
  );
  UPDATE public.weather_fetch_schedule
     SET last_fetched_at = now(), last_error = NULL, updated_at = now()
   WHERE company_id = p_company_id
     AND (zone_id = p_zone_id OR (zone_id IS NULL AND p_zone_id IS NULL));
  IF v_severity = 'severe' THEN
    INSERT INTO public.audit_log (
      id, company_id, actor_id, actor_role, action, operation,
      target_id, metadata, severity, created_at
    ) VALUES (
      'AUD-' || substr(v_id, 4), p_company_id, NULL, 'system', 'weather_severe', 'monitoring',
      v_id,
      jsonb_build_object('zone_id', p_zone_id, 'condition', v_condition,
        'temp_c', v_temp, 'wind_gust_ms', v_gust, 'alert_count', v_alert_count, 'source', 'cron'),
      'critical', now()
    );
  END IF;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_weather_observation_cron(uuid, text, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_weather_observation_cron(uuid, text, numeric, numeric, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.trigger_weather_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_catalog
AS $$
DECLARE v_url text; v_secret text; v_due_count integer := 0; v_row record; v_req_count integer := 0;
BEGIN
  BEGIN SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'weather_fetch_url';
  EXCEPTION WHEN OTHERS THEN v_url := NULL; END;
  BEGIN SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret';
  EXCEPTION WHEN OTHERS THEN v_secret := NULL; END;
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'secrets_not_configured',
      'hint', 'Add weather_fetch_url + cron_shared_secret to vault.secrets');
  END IF;
  FOR v_row IN
    SELECT s.id, s.company_id, s.zone_id, s.lat, s.lng
      FROM public.weather_fetch_schedule s
     WHERE s.enabled = true
       AND (s.last_fetched_at IS NULL
            OR s.last_fetched_at + (s.frequency_minutes || ' minutes')::interval <= now())
     ORDER BY s.last_fetched_at NULLS FIRST LIMIT 100
  LOOP
    v_due_count := v_due_count + 1;
    PERFORM net.http_post(
      url     := v_url || '?action=sweep',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body    := jsonb_build_object('companyId', v_row.company_id, 'zoneId', v_row.zone_id,
                                    'lat', v_row.lat, 'lng', v_row.lng),
      timeout_milliseconds := 8000
    );
    v_req_count := v_req_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'due_count', v_due_count,
    'requests_fired', v_req_count, 'swept_at', now());
END $$;
REVOKE EXECUTE ON FUNCTION public.trigger_weather_sweep() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.trigger_weather_sweep() TO service_role;

DO $$ BEGIN PERFORM cron.unschedule('sosphere_weather_sweep'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('sosphere_weather_sweep', '*/15 * * * *', 'SELECT public.trigger_weather_sweep();');
