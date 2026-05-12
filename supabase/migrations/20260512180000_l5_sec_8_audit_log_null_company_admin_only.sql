-- ═══════════════════════════════════════════════════════════════════════════
-- L5-SEC-8b (2026-05-12): restrict NULL-company audit reads to admins
-- ─────────────────────────────────────────────────────────────────────────
-- THREAT (Medium, pre-launch security review)
--   The current SELECT policy on public.audit_log is:
--     USING ((company_id IS NULL) OR is_company_member(company_id))
--
--   The OR-IS-NULL branch was added to let admins see platform-level
--   audit events (system_probe, retention_cleanup, twilio webhook drift,
--   GDPR SAR exports, etc.) that aren't tied to any single company.
--   But the policy didn't gate that branch by role — so ANY authenticated
--   user could read ALL system events, including:
--     • GDPR SAR export rows for OTHER users (cross-PII leak)
--     • Stripe webhook events (financial activity)
--     • Twilio webhook drift detections (infra config)
--     • System probe outputs (telemetry)
--   486 such NULL-company rows live in production today.
--
-- FIX
--   Gate the NULL-company branch on public.is_admin() — a stable
--   SECDEF-friendly helper that returns true only when the caller's
--   profiles.role = 'admin'.
--   Tenant-scoped reads (is_company_member) are unchanged.
--
--   New policy:
--     USING (
--       (company_id IS NULL AND public.is_admin())
--       OR public.is_company_member(company_id)
--     )
--
-- COMPATIBILITY
--   * Admin dashboards that read system events continue to work
--     (admins satisfy is_admin()).
--   * Regular employees lose access to NULL-company rows — they had
--     no legitimate reason to see them anyway.
--   * service_role retains full access (BYPASSRLS).
--
-- LINKAGE
--   Pairs with the L5-SEC-1 actor-forgery fix from earlier today: the
--   chain INTEGRITY is hash-locked; this fix locks the CONFIDENTIALITY
--   of platform-level entries.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS audit_log_company_read ON public.audit_log;

CREATE POLICY audit_log_company_read
  ON public.audit_log FOR SELECT TO authenticated
  USING (
    (company_id IS NULL AND public.is_admin())
    OR public.is_company_member(company_id)
  );

COMMENT ON POLICY audit_log_company_read ON public.audit_log IS
  'L5-SEC-8b (2026-05-12): NULL-company rows readable only by admins '
  '(was: readable by any authenticated user). Tenant-scoped rows '
  'continue to be readable by company members.';
