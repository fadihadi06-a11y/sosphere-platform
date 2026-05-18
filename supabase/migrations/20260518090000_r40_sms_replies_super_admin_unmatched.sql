-- ═══════════════════════════════════════════════════════════════════════════
-- R-40 (2026-05-18) — UNMATCHED inbound SMS visibility for super_admins
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS (LAUNCH_AUDIT.md #5)
--
--   sos_sms_replies has two SELECT policies today:
--     a. sms_replies_company_admin_read: company_id IS NOT NULL + caller
--        is admin/owner of that company → read.
--     b. sms_replies_self_read: user_id = auth.uid() → read.
--
--   When sos-sms-inbound cannot resolve an inbound SMS to a live session
--   (e.g., contact replied 70+ min after SOS, contact on multiple lists,
--   or Twilio number reused), the row is written with company_id=NULL
--   AND user_id=NULL. The migration's own docstring claims the security
--   team should see "every inbound to our Twilio number" — but neither
--   policy matches those rows. Only service_role can read them.
--
--   That defeats the forensic purpose. A contact texting "I'm at the
--   scene with him, he's okay" 90 minutes after his daughter's SOS is
--   exactly the kind of evidence that must be visible to incident
--   reviewers, regardless of whether automatic session resolution
--   succeeded.
--
-- THE FIX
--   Add a third SELECT policy: super_admins of ANY company can read the
--   UNMATCHED rows (company_id IS NULL AND user_id IS NULL).
--
--   The 'super_admin' role is the existing audit-class designation used
--   throughout the codebase (B-20, W3-19, W3-35, AUTH-5-D15-A15) for
--   users who hold cross-tenant compliance / security responsibilities.
--   It is granted manually by company owners via promote_user_to_admin
--   or directly via vendor support — never via the wizard's free-text
--   role field (which R-30 now coerces to {employee, member} only).
--
--   The policy is INTENTIONALLY narrow: it does NOT grant access to
--   tenant-attributed rows (those are still gated by policy (a)). It
--   only opens visibility to rows that fell out of automatic tenant
--   resolution — the very rows the docstring promised to surface.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS sms_replies_super_admin_unmatched_read ON public.sos_sms_replies;

CREATE POLICY sms_replies_super_admin_unmatched_read
  ON public.sos_sms_replies
  FOR SELECT
  TO authenticated
  USING (
    -- Only applies to UNMATCHED rows. Tenant-attributed rows still
    -- flow through sms_replies_company_admin_read above.
    company_id IS NULL
    AND user_id    IS NULL
    AND EXISTS (
      SELECT 1
      FROM   public.company_memberships cm
      WHERE  cm.user_id = auth.uid()
        AND  cm.active  = true
        AND  cm.role    = 'super_admin'
    )
  );

COMMENT ON POLICY sms_replies_super_admin_unmatched_read ON public.sos_sms_replies IS
  'R-40 (2026-05-18, LAUNCH_AUDIT #5): super_admin of any company can read '
  'rows that failed automatic tenant resolution (company_id + user_id both '
  'NULL). The other two policies remain authoritative for tenant-attributed '
  'rows; this one ONLY opens visibility into the UNMATCHED tail.';
