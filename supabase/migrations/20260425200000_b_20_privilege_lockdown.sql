-- ═══════════════════════════════════════════════════════════════════════════
-- B-20 (2026-04-25): PRIVILEGE LOCKDOWN — closes 8 takeover vectors found in
-- the deep adversarial audit (G-1, G-2, G-6..G-11, G-19).
--
-- See AUDIT_DEEP_2026-04-25.md in the repo root for the full attack scenarios.
-- All four target tables were EMPTY in production at migration time.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── G-1: promote_user_to_admin — was anon/authenticated callable, no auth check.
CREATE OR REPLACE FUNCTION public.promote_user_to_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    NULL;  -- service role bootstrap path
  ELSE
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
    IF v_caller_role NOT IN ('admin', 'super_admin') THEN
      RAISE EXCEPTION 'forbidden: only existing admins may promote users';
    END IF;
  END IF;
  UPDATE public.profiles SET role = 'admin' WHERE id = p_user_id;
END $$;
REVOKE ALL     ON FUNCTION public.promote_user_to_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_user_to_admin(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promote_user_to_admin(uuid) TO service_role;

-- ── G-2: emergencies — drop USING(true), add owner-or-company-member scope
DROP POLICY IF EXISTS dashboard_read_all              ON public.emergencies;
DROP POLICY IF EXISTS emergencies_owner_or_company_read ON public.emergencies;
DROP POLICY IF EXISTS emergencies_owner_write           ON public.emergencies;
ALTER TABLE public.emergencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY emergencies_owner_or_company_read ON public.emergencies
  FOR SELECT USING (
    user_id = auth.uid()
    OR (company_id IS NOT NULL AND public.is_company_member(company_id))
  );
CREATE POLICY emergencies_owner_write ON public.emergencies
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── G-6: get_active_emergency — caller must be self or service_role
CREATE OR REPLACE FUNCTION public.get_active_emergency(p_user_id uuid)
RETURNS TABLE(emergency_id bigint, lat double precision, lon double precision,
              note text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden: can only query own active emergency';
  END IF;
  RETURN QUERY
  SELECT e.id, e.lat, e.lon, e.note, e.created_at
    FROM public.emergencies e
   WHERE e.user_id = p_user_id AND e.is_active = true AND e.archived = false
   LIMIT 1;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_active_emergency(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_active_emergency(uuid) TO authenticated;

-- ── G-7: get_user_contacts — caller must be self or service_role
CREATE OR REPLACE FUNCTION public.get_user_contacts(p_user_id uuid)
RETURNS TABLE(contact_id bigint, name text, phone text, relation text, priority integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden: can only query own emergency contacts';
  END IF;
  RETURN QUERY
  SELECT ec.id, ec.name, ec.phone, ec.relation, ec.priority
    FROM public.emergency_contacts ec
   WHERE ec.user_id = p_user_id AND ec.is_active = true
   ORDER BY ec.priority ASC;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_user_contacts(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_user_contacts(uuid) TO authenticated;

-- ── G-8 + G-9 + G-11: revoke service-only RPCs from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.record_twilio_spend(uuid,uuid,text,text,text,numeric,integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_twilio_spend(uuid,uuid,text,text,text,numeric,integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.log_sos_audit(text,text,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.log_sos_audit(text,text,text,text,text,text,jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_sos_rate_limit(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_sos_rate_limit(uuid, integer, integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.project_sos_session_to_queue()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.project_sos_session_to_queue() TO service_role;

-- ── G-10: drop dangerous create_company(text, uuid) overload
DROP FUNCTION IF EXISTS public.create_company(text, uuid);

-- ── G-19: company_message_recipients + company_message_rsvps — drop USING(true)
DROP POLICY IF EXISTS allow_all                            ON public.company_message_recipients;
DROP POLICY IF EXISTS allow_all                            ON public.company_message_rsvps;
DROP POLICY IF EXISTS cmr_recipient_or_company_read        ON public.company_message_recipients;
DROP POLICY IF EXISTS cmr_rsvps_recipient_or_company_read  ON public.company_message_rsvps;
DROP POLICY IF EXISTS cmr_rsvps_recipient_write            ON public.company_message_rsvps;
DROP POLICY IF EXISTS cmr_rsvps_recipient_update           ON public.company_message_rsvps;
ALTER TABLE public.company_message_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_message_rsvps      ENABLE ROW LEVEL SECURITY;

CREATE POLICY cmr_recipient_or_company_read ON public.company_message_recipients
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.employees e
              WHERE e.id = company_message_recipients.employee_id AND e.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.company_messages m
                WHERE m.id = company_message_recipients.message_id
                  AND public.is_company_member(m.company_id))
  );

CREATE POLICY cmr_rsvps_recipient_or_company_read ON public.company_message_rsvps
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.employees e
              WHERE e.id = company_message_rsvps.employee_id AND e.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.company_messages m
                WHERE m.id = company_message_rsvps.message_id
                  AND public.is_company_member(m.company_id))
  );

CREATE POLICY cmr_rsvps_recipient_write ON public.company_message_rsvps
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.employees e
              WHERE e.id = company_message_rsvps.employee_id AND e.user_id = auth.uid())
  );

CREATE POLICY cmr_rsvps_recipient_update ON public.company_message_rsvps
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.employees e
              WHERE e.id = company_message_rsvps.employee_id AND e.user_id = auth.uid())
  );
