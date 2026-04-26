-- ═══════════════════════════════════════════════════════════════════════════
-- W3-8 (Wave 3 red-team, 2026-04-26): tighten audit_log + audit_logs grants.
--
-- BUG: `authenticated` and `anon` roles held INSERT/UPDATE/DELETE/TRUNCATE
-- on `audit_log` and `audit_logs`. RLS denies the writes today, but the
-- table-level grants were one `DROP POLICY` migration away from total
-- forensic-tamper exposure. Defense-in-depth requires the GRANT itself
-- to deny these operations — not just the row-level policy.
--
-- FIX:
--   1. REVOKE INSERT/UPDATE/DELETE/TRUNCATE from anon and authenticated
--   2. Keep SELECT for authenticated (RLS scopes by company_id / actor_id)
--   3. service_role retains full access for edge-function writers
--   4. ENABLE FORCE ROW LEVEL SECURITY so even table-owner writes go
--      through RLS (defense even against accidental owner-context queries)
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated;

-- Keep SELECT for authenticated (RLS-gated). Anon: no read either.
REVOKE ALL ON public.audit_log  FROM anon;
REVOKE ALL ON public.audit_logs FROM anon;
GRANT SELECT ON public.audit_log  TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

-- Force RLS so table owner / superuser writes still hit policies.
ALTER TABLE public.audit_log  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- service_role keeps the keys.
GRANT INSERT, UPDATE, DELETE, SELECT ON public.audit_log  TO service_role;
GRANT INSERT, UPDATE, DELETE, SELECT ON public.audit_logs TO service_role;
