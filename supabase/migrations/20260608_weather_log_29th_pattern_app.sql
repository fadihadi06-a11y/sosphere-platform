-- ═══════════════════════════════════════════════════════════════
-- 2026-06-08 — weather_log (29th pattern application)
-- ─────────────────────────────────────────────────────────────
-- Previously the dashboard's weatherAlerts page + compliance-reports
-- weather_log section were placeholder-only (comingSoon flag set,
-- text said "needs a real weather provider integration"). This
-- migration adds the durable side:
--   • weather_log table — append-only observations per (company, zone)
--   • record_weather_observation — INSERT-only SECDEF (called by
--     the weather-fetch Edge function after OpenWeather API call)
--   • list_weather_observations — SELECT for dashboard / compliance
--     reports with optional date-range + zone filter
--   • latest_weather_per_zone — DISTINCT ON for the panel widget
--   • Self-RLS: anyone in the company can read; writes go through
--     SECDEF RPC (Edge function uses service_role internally, plus
--     stamps the caller's auth.uid() as observer_id).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.weather_log (
  id              text PRIMARY KEY,
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  zone_id         text,
  observed_at     timestamptz NOT NULL DEFAULT now(),
  lat             numeric NOT NULL,
  lng             numeric NOT NULL,
  condition       text,
  temp_c          numeric,
  feels_like_c    numeric,
  humidity_pct    integer,
  wind_speed_ms   numeric,
  wind_gust_ms    numeric,
  visibility_m    integer,
  severity        text NOT NULL DEFAULT 'info',
  provider        text NOT NULL DEFAULT 'openweather',
  payload         jsonb NOT NULL,
  observer_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weather_log_company_observed
  ON public.weather_log (company_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_weather_log_company_zone_observed
  ON public.weather_log (company_id, zone_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_weather_log_severity
  ON public.weather_log (company_id, severity, observed_at DESC)
  WHERE severity <> 'info';

ALTER TABLE public.weather_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weather_log_company_read ON public.weather_log;
CREATE POLICY weather_log_company_read ON public.weather_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_memberships cm
      WHERE cm.user_id    = (SELECT auth.uid())
        AND cm.company_id = weather_log.company_id
        AND cm.active     = true
    )
  );

CREATE OR REPLACE FUNCTION public.record_weather_observation(
  p_company_id  uuid,
  p_zone_id     text,
  p_lat         numeric,
  p_lng         numeric,
  p_payload     jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_id        text;
  v_condition text;
  v_severity  text := 'info';
  v_temp      numeric;
  v_feels     numeric;
  v_humidity  integer;
  v_wind      numeric;
  v_gust      numeric;
  v_vis       integer;
  v_alert_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_memberships cm
    WHERE cm.user_id = v_uid AND cm.active = true
      AND (cm.company_id = p_company_id OR cm.role = 'super_admin')
  ) THEN
    RAISE EXCEPTION 'not authorized' USING errcode = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object' USING errcode = '22023';
  END IF;

  v_condition := COALESCE(p_payload #>> '{weather,0,main}', 'Unknown');
  v_temp      := NULLIF(p_payload #>> '{main,temp}', '')::numeric;
  v_feels     := NULLIF(p_payload #>> '{main,feels_like}', '')::numeric;
  v_humidity  := NULLIF(p_payload #>> '{main,humidity}', '')::integer;
  v_wind      := NULLIF(p_payload #>> '{wind,speed}', '')::numeric;
  v_gust      := NULLIF(p_payload #>> '{wind,gust}', '')::numeric;
  v_vis       := NULLIF(p_payload #>> '{visibility}', '')::integer;

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
    v_severity, 'openweather', p_payload, v_uid
  );

  IF v_severity = 'severe' THEN
    INSERT INTO public.audit_log (
      id, company_id, actor_id, actor_role, action, operation,
      target_id, metadata, severity, created_at
    ) VALUES (
      'AUD-' || substr(v_id, 4),
      p_company_id, v_uid, 'system', 'weather_severe', 'monitoring',
      v_id,
      jsonb_build_object(
        'zone_id', p_zone_id, 'condition', v_condition,
        'temp_c', v_temp, 'wind_gust_ms', v_gust,
        'alert_count', v_alert_count
      ),
      'critical', now()
    );
  END IF;

  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_weather_observation(uuid, text, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_weather_observation(uuid, text, numeric, numeric, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_weather_observations(
  p_company_id uuid,
  p_zone_id    text DEFAULT NULL,
  p_from       timestamptz DEFAULT NULL,
  p_to         timestamptz DEFAULT NULL,
  p_limit      integer DEFAULT 200
) RETURNS SETOF public.weather_log
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
STABLE
AS $$
  SELECT * FROM public.weather_log w
  WHERE w.company_id = p_company_id
    AND EXISTS (
      SELECT 1 FROM public.company_memberships cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.company_id = p_company_id
        AND cm.active = true
    )
    AND (p_zone_id IS NULL OR w.zone_id = p_zone_id)
    AND (p_from    IS NULL OR w.observed_at >= p_from)
    AND (p_to      IS NULL OR w.observed_at <= p_to)
  ORDER BY w.observed_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$$;
REVOKE EXECUTE ON FUNCTION public.list_weather_observations(uuid, text, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_weather_observations(uuid, text, timestamptz, timestamptz, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.latest_weather_per_zone(p_company_id uuid)
RETURNS SETOF public.weather_log
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
STABLE
AS $$
  SELECT DISTINCT ON (zone_id) *
  FROM public.weather_log w
  WHERE w.company_id = p_company_id
    AND EXISTS (
      SELECT 1 FROM public.company_memberships cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.company_id = p_company_id
        AND cm.active = true
    )
  ORDER BY zone_id, observed_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.latest_weather_per_zone(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.latest_weather_per_zone(uuid) TO authenticated;
