-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — R-12: GRANT lockdown on 3 over-permissive SECDEF maintenance RPCs
-- ─────────────────────────────────────────────────────────────────────────
-- THE FINDING (security sweep #2)
--   The original L5-SEC review (2026-05-09) audited the bulk of SECDEF
--   functions. This second sweep (2026-05-14) re-ran the gate on what
--   changed since, and surfaced THREE SECURITY DEFINER functions whose
--   EXECUTE privilege was still PUBLIC (i.e. callable by ANY authenticated
--   role — including anon — without an internal auth.uid() guard):
--
--     1. public.check_rate_limit(p_bucket, p_identifier, p_max_attempts, p_window_seconds)
--        HIGH severity. Anyone can pass `identifier="<victim_user_id>"`
--        and rapid-fire to exhaust the victim's rate-limit budget. DoS
--        vector targeting any specific user.
--
--     2. public.archive_old_emergencies()
--        LOW-MEDIUM. UPDATEs across emergencies table; could create lock
--        contention during a real concurrent emergency. Bounded impact
--        (only rows already inactive 90+ days), but no reason for anon
--        callers to trigger.
--
--     3. public.cleanup_old_locations()
--        LOW. DELETEs aged-out emergency_locations + read notifications.
--        Currently called from cron job sosphere_retention_old_locations
--        as `postgres` (superuser), so REVOKE from public won't disrupt
--        the scheduled cleanup.
--
-- THE FIX
--   REVOKE EXECUTE from PUBLIC, anon, authenticated for all three.
--   GRANT EXECUTE to service_role explicitly so server-side callers
--   (edge functions using service_role key) still work. postgres /
--   pg_cron jobs already bypass GRANT checks as superuser.
--
-- IMPACT
--   - public.check_rate_limit: a client-side caller in
--     src/app/components/api/supabase-client.ts already passes the
--     WRONG parameter names (p_action vs p_bucket) — the call has
--     always failed and the code already falls back to client-side
--     rate-limiting. No behavior change for legitimate clients.
--   - public.archive_old_emergencies: no current callers (orphan).
--   - public.cleanup_old_locations: cron job continues to work.
--
-- RELATED
--   This pattern matches the W3-#39 SECDEF grant lockdown from
--   2026-04-26 (see 20260426270000_w3_39_secdef_grant_lockdown.sql)
--   but covers three functions that were missed in that sweep.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. check_rate_limit ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.check_rate_limit(text, text, integer, integer) IS
  'R-12 (2026-05-14): SECDEF rate-limit helper. Locked to service_role only — any anon caller could DoS arbitrary user identifiers. Client-side callers should hit an edge function which then calls this with a verified user_id.';

-- ─── 2. archive_old_emergencies ─────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.archive_old_emergencies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_old_emergencies() TO service_role;

COMMENT ON FUNCTION public.archive_old_emergencies() IS
  'R-12 (2026-05-14): SECDEF maintenance function (archives 90+ day inactive emergencies). Locked to service_role — no reason for client/anon to trigger lock contention on emergencies during real concurrent SOS.';

-- ─── 3. cleanup_old_locations ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.cleanup_old_locations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_locations() TO service_role;

COMMENT ON FUNCTION public.cleanup_old_locations() IS
  'R-12 (2026-05-14): SECDEF retention cleanup (deletes 30+ day emergency_locations + 90+ day read notifications). Locked to service_role — cron job sosphere_retention_old_locations runs as postgres and still works.';
