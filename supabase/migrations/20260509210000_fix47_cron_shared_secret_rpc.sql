-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — FIX #47: process-bulk-invite cron 401 every minute (root cause)
-- ────────────────────────────────────────────────────────────────────────
-- ROOT CAUSE
--   The current architecture has TWO sources of truth for the cron-shared
--   secret:
--     1. vault.decrypted_secrets['cron_shared_secret'] — read by the
--        Postgres trigger_bulk_invite_worker() to inject as 'x-cron-secret'.
--     2. process-bulk-invite/index.ts reads Deno.env.get("CRON_SECRET")
--        and compares the header against it.
--   These can (and did) drift. The edge function has been returning 401
--   to its own cron caller every minute for >a week. 60 errors/hour
--   pollute the brand-new Pipeline Health dashboard with noise.
--
-- THE FIX (architectural, not a patch)
--   Eliminate the second source. Add a service-role-only RPC that reads
--   the vault secret. The edge function calls this RPC on cold-start,
--   caches the value for the isolate's lifetime, and compares the
--   incoming header against it. Now there is ONE source of truth — drift
--   becomes structurally impossible.
--
--   The CRON_SECRET env var is kept as a fallback for environments where
--   the vault is not configured (CI, local dev) — the edge function
--   prefers vault, falls back to env, errors otherwise.
--
-- WHY NOT JUST UPDATE THE ENV VAR
--   That's the patch path. It fixes the symptom but the same drift can
--   happen tomorrow when one side rotates without the other. The
--   architectural fix is permanent.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_cron_shared_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_catalog
AS $$
DECLARE
  v_secret text;
BEGIN
  -- Read from vault.decrypted_secrets — same source the cron itself uses.
  -- If the vault is missing the entry (e.g., fresh staging clone),
  -- return NULL so the edge function can fall back to its env var.
  BEGIN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'cron_shared_secret'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;
  RETURN v_secret;
END;
$$;

COMMENT ON FUNCTION public.get_cron_shared_secret() IS
  'FIX #47: returns the cron_shared_secret from vault. Used by process-bulk-invite (and any future cron-gated edge function) to compare against the x-cron-secret header. Service-role only.';

-- This RPC must NEVER be callable by anon/authenticated — it would
-- expose the secret used to authenticate cron-only endpoints.
REVOKE EXECUTE ON FUNCTION public.get_cron_shared_secret() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_cron_shared_secret() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_cron_shared_secret() TO service_role;
