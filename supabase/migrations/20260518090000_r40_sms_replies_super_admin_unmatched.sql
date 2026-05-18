DROP POLICY IF EXISTS sms_replies_super_admin_unmatched_read ON public.sos_sms_replies;

CREATE POLICY sms_replies_super_admin_unmatched_read
  ON public.sos_sms_replies
  FOR SELECT
  TO authenticated
  USING (
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
  'R-40 (2026-05-18, LAUNCH_AUDIT #5): super_admin of any company can read rows that failed automatic tenant resolution (company_id + user_id both NULL). The other two policies remain authoritative for tenant-attributed rows; this one ONLY opens visibility into the UNMATCHED tail.';
