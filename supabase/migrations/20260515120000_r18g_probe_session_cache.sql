-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — R-18-G: probe session cache (real-capacity load testing)
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS
--   R-18-F revealed that Supabase Auth API has a HARD rate limit of
--   30 sign-ins per 5 minutes per IP. Edge function = 1 IP. This made
--   it impossible to load-test sos-alert beyond ~30 probe users in a
--   single run, even with batching.
--
--   R-18-E confirmed real production users use cached JWTs (localStorage
--   in WebView + autoRefreshToken) so this Auth limit doesn't apply to
--   them. But the probe was creating fresh users each run, paying the
--   Auth tax every time.
--
-- THE FIX
--   This table caches probe-user sessions so they're created ONCE and
--   reused across runs:
--     - First "seed" run: creates 50 users SLOWLY (6/min) over ~9 min,
--       saves their access_token + refresh_token here.
--     - Subsequent runs: load JWTs from this table — instant, no Auth API.
--     - Refresh: when access_token has <60s left, refresh via
--       /auth/v1/token?grant_type=refresh_token (much higher rate limit).
--
-- SECURITY
--   - This table holds plaintext refresh_tokens. service_role-only RLS.
--   - All rows have user_id pointing at probe users with @sosphere.internal
--     emails (R-13 reserved domain) — they have no app permissions.
--   - Compromise of these tokens lets an attacker drive the probe pipeline,
--     not real user data. R-13 classifies them is_synthetic=true so dashboards
--     filter them out anyway.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sos_probe_session_cache (
  probe_index   integer     PRIMARY KEY,
  user_id       uuid        NOT NULL UNIQUE,
  email         text        NOT NULL UNIQUE,
  password      text        NOT NULL,
  access_token  text        NOT NULL,
  refresh_token text        NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sos_probe_session_cache IS
  'R-18-G (2026-05-15): caches probe-user JWTs so load tests don''t hit Supabase Auth rate limit (30 sign-ins / 5 min / IP). service_role-only. Rows belong to @sosphere.internal probe users (R-13 reserved). Synthetic-classified by R-13 so dashboards filter out.';

COMMENT ON COLUMN public.sos_probe_session_cache.refresh_token IS
  'Plaintext refresh token. Safe ONLY because: (1) table is service_role-only (RLS denies anon/authenticated), (2) probe users have no app permissions, (3) R-13 classifies their activity as synthetic.';

-- ── RLS lockdown ──────────────────────────────────────────────────────────
ALTER TABLE public.sos_probe_session_cache ENABLE ROW LEVEL SECURITY;

-- Default deny: no policies for anon or authenticated. service_role bypasses
-- RLS, so probes (using SUPABASE_SERVICE_ROLE_KEY) can read/write freely.
-- Explicit revokes to be defense-in-depth:
REVOKE ALL ON public.sos_probe_session_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sos_probe_session_cache TO service_role;

-- ── Auto-touch updated_at on UPDATE ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public._probe_session_cache_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sos_probe_session_cache_touch ON public.sos_probe_session_cache;
CREATE TRIGGER sos_probe_session_cache_touch
  BEFORE UPDATE ON public.sos_probe_session_cache
  FOR EACH ROW
  EXECUTE FUNCTION public._probe_session_cache_touch();

-- Lock the trigger function the same way (no PUBLIC EXECUTE)
REVOKE ALL ON FUNCTION public._probe_session_cache_touch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._probe_session_cache_touch() TO service_role;

-- ── Helpful index for lookups by probe_index range ────────────────────────
-- Primary key already covers exact-match. Add a range index for
-- "WHERE probe_index < N" loads (the probe's hot path).
-- (Skipped — PK index suffices for current scale; revisit at N > 1000.)
