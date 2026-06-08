-- ═══════════════════════════════════════════════════════════════
-- 2026-06-08 — Weather sweep Bearer header fix
-- ─────────────────────────────────────────────────────────────
-- Drift discovered post-deploy: trigger_weather_sweep posted only
-- x-cron-secret, but Supabase Edge Gateway requires Authorization:
-- Bearer <JWT> BEFORE the function code runs (verify_jwt=true is
-- the default for new deploys). Result: 401 from the gateway,
-- weather-fetch never ran, weather_log stayed empty.
--
-- Fix: pull supabase_anon_key from vault (it's a public key, vault
-- is just for centralized rotation) and send BOTH headers:
--   • Authorization: Bearer <anon> → satisfies Supabase gateway
--   • x-cron-secret: <secret>     → satisfies weather-fetch code
--
-- Defense in depth: anon key alone wouldn't pass our function's
-- x-cron-secret check, and x-cron-secret alone didn't pass the
-- gateway. Both required.
--
-- BEFORE applying this migration in a fresh DB, ensure vault has:
--   • weather_fetch_url
--   • cron_shared_secret  (shared with bulk-invite worker)
--   • supabase_anon_key   (new — copy from project's anon key)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trigger_weather_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_catalog
AS $$
DECLARE
  v_url        text;
  v_secret     text;
  v_anon       text;
  v_due_count  integer := 0;
  v_row        record;
  v_req_count  integer := 0;
BEGIN
  BEGIN SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'weather_fetch_url';
  EXCEPTION WHEN OTHERS THEN v_url := NULL; END;
  BEGIN SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret';
  EXCEPTION WHEN OTHERS THEN v_secret := NULL; END;
  BEGIN SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'supabase_anon_key';
  EXCEPTION WHEN OTHERS THEN v_anon := NULL; END;

  IF v_url IS NULL OR v_secret IS NULL OR v_anon IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'secrets_not_configured',
      'hint', 'Need weather_fetch_url + cron_shared_secret + supabase_anon_key in vault');
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
    -- Send BOTH headers: Bearer satisfies Supabase Edge gateway
    -- (verify_jwt=true), x-cron-secret satisfies our function code
    -- (defense in depth: anon JWT alone is NOT enough).
    PERFORM net.http_post(
      url     := v_url || '?action=sweep',
      headers := jsonb_build_object(
        'Content-Type',   'application/json',
        'Authorization',  'Bearer ' || v_anon,
        'x-cron-secret',  v_secret
      ),
      body    := jsonb_build_object('companyId', v_row.company_id, 'zoneId', v_row.zone_id,
                                    'lat', v_row.lat, 'lng', v_row.lng),
      timeout_milliseconds := 8000
    );
    v_req_count := v_req_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'due_count', v_due_count,
    'requests_fired', v_req_count, 'swept_at', now());
END $$;
