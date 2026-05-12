-- ═══════════════════════════════════════════════════════════════════════════
-- L5-SEC-4 (2026-05-12): close cross-tenant leak on geofences + sensor_events
-- ─────────────────────────────────────────────────────────────────────────
-- THREAT (High, pre-launch security review)
--   The G-31 migration (2026-04-26) added two SELECT policies that grant
--   any authenticated user the right to read ALL rows in both tables:
--     CREATE POLICY geofences_authenticated_read
--       ON public.geofences FOR SELECT TO authenticated USING (true);
--     CREATE POLICY sensor_events_authenticated_read
--       ON public.sensor_events FOR SELECT TO authenticated USING (true);
--
--   Neither table has a tenancy column (company_id / user_id / etc), so
--   there's no way to scope reads. Any authenticated user — including
--   trial-tier customers and pilot-program users on other companies —
--   could read every other tenant's geo-fences (physical site polygons,
--   risk zones) and sensor events (fall-detection telemetry with
--   timestamps + acceleration profiles).
--
--   Risk severity: High. Physical-site polygons are PII for high-risk
--   industries (private security, executive protection); fall events
--   reveal employee health timing patterns.
--
-- THIS COMMIT (Phase 1) — close the SELECT leak with zero behaviour break
--   Replace the USING(true) read policies with USING(false). Practical
--   impact today is zero:
--     * geofences:     0 rows in production; dashboard-geofencing-page
--                      returns an empty list either way.
--     * sensor_events: 41 legacy rows (pre-RLS-enable); no client code
--                      reads from this table — fall-detection.tsx only
--                      writes to it, and those writes are ALREADY denied
--                      by RLS today (no INSERT policy exists). The 41
--                      rows date from before RLS was enabled.
--
--   Effect: no caller can read either table except via service_role
--   (edge functions / admin DB ops). Cross-tenant disclosure closed.
--
-- DEFERRED TO PHASE 2 (POST-LAUNCH) — proper tenancy redesign
--   When the team is ready to make these tables actually usable:
--     1. Add user_id uuid column to sensor_events (FK to auth.users).
--        Backfill the 41 legacy rows with NULL.
--     2. Add company_id uuid column to geofences (FK to companies).
--     3. Move fall-detection.tsx writes through a SECDEF RPC
--        `record_sensor_event(p_event_type, p_acceleration)` that pins
--        user_id = auth.uid().
--     4. Move dashboard-geofencing-page writes through a SECDEF RPC
--        that pins company_id from the actor's active company.
--     5. Replace the USING(false) SELECT policy with proper scoped
--        reads:
--          geofences:     USING (is_company_member(company_id))
--          sensor_events: USING (user_id = auth.uid())
--     6. Re-grant authenticated SELECT only after #5 lands; keep INSERT/
--        UPDATE/DELETE service-role-only (writes go through RPCs).
--
-- AUDIT LINKAGE
--   Mirrors the same defense-in-depth pattern applied to audit_log in
--   W3-8 (2026-04-26): policy + grants both tightened, FORCE RLS on,
--   service_role keeps the keys. See
--   20260426190000_w3_8_audit_log_grants_tighten.sql for prior art.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Replace USING(true) read policies with USING(false). Drop-and-recreate
--    is idempotent and explicit. Comment on the policy documents the deferred
--    Phase 2 work.
DROP POLICY IF EXISTS geofences_authenticated_read ON public.geofences;
CREATE POLICY geofences_authenticated_read
  ON public.geofences FOR SELECT TO authenticated
  USING (false);
COMMENT ON POLICY geofences_authenticated_read ON public.geofences IS
  'L5-SEC-4 (2026-05-12): deny-all read policy. Table has no tenancy '
  'column today — cross-tenant disclosure was possible under USING(true). '
  'Phase 2 (post-launch): add company_id + replace with '
  'USING (is_company_member(company_id)).';

DROP POLICY IF EXISTS sensor_events_authenticated_read ON public.sensor_events;
CREATE POLICY sensor_events_authenticated_read
  ON public.sensor_events FOR SELECT TO authenticated
  USING (false);
COMMENT ON POLICY sensor_events_authenticated_read ON public.sensor_events IS
  'L5-SEC-4 (2026-05-12): deny-all read policy. Table has no tenancy '
  'column today — fall-detection telemetry was cross-tenant readable '
  'under USING(true). Phase 2 (post-launch): add user_id + replace with '
  'USING (user_id = auth.uid()) and route writes through a SECDEF RPC.';

-- 2. Tighten table-level grants (W3-8 pattern). Revoke write privileges
--    from anon + authenticated even though no write policies exist today.
--    Defense-in-depth: if a future migration adds a permissive write
--    policy, the grant gate still denies.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.geofences     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sensor_events FROM anon, authenticated;
REVOKE ALL  ON public.geofences     FROM anon;
REVOKE ALL  ON public.sensor_events FROM anon;
GRANT  SELECT ON public.geofences     TO authenticated;  -- RLS USING(false) still denies
GRANT  SELECT ON public.sensor_events TO authenticated;  -- RLS USING(false) still denies
GRANT  INSERT, UPDATE, DELETE, SELECT ON public.geofences     TO service_role;
GRANT  INSERT, UPDATE, DELETE, SELECT ON public.sensor_events TO service_role;

-- 3. FORCE ROW LEVEL SECURITY so even table-owner (postgres) writes go
--    through RLS. Matches the audit_log hardening pattern.
ALTER TABLE public.geofences     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_events FORCE ROW LEVEL SECURITY;

-- 4. Document the table state for future auditors so the deferred Phase 2
--    work is discoverable from \d+ output.
COMMENT ON TABLE public.geofences IS
  'L5-SEC-4 (2026-05-12): service-role-only until Phase 2 adds company_id + '
  'tenant-scoped read policy. Dashboard reads return zero rows today.';
COMMENT ON TABLE public.sensor_events IS
  'L5-SEC-4 (2026-05-12): service-role-only until Phase 2 adds user_id + '
  'tenant-scoped read policy. fall-detection.tsx writes are RLS-denied '
  'today (no INSERT policy); 41 legacy rows date from before RLS-enable.';
