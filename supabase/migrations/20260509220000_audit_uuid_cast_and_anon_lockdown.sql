-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — L2-AUDIT findings: 2 hidden production bugs caught by audit
-- ────────────────────────────────────────────────────────────────────────
-- Discovered while running adversarial production tests against the L2
-- foundation. Two issues that the user could not have surfaced without
-- explicit failure-path testing:
--
--   1. get_sos_delivery_summary (L2-B) compared sos_sessions.id (uuid)
--      directly to p_emergency_id (text). Same class of bug as
--      log_evidence_event before its fix-up. Live but unusable — every
--      call hit "operator does not exist: uuid = text". Caught when the
--      Test C in the audit suite tried to actually call the RPC.
--
--   2. create_company_and_become_owner (audit #46 finding) was anon-
--      executable AND had no auth.uid() guard. An anon caller could
--      INSERT into public.companies, then the inner set_user_company
--      call would fail (auth.uid() IS NULL) — but the company INSERT
--      had already committed in the SECURITY DEFINER context. Result:
--      orphan companies with no owner. Caught by scanning all anon-
--      callable SECURITY DEFINER functions for missing auth checks.
--
-- WHY THESE MATTER
--   #1 means the dispatch-summary aggregator never returned data — the
--   "did the SOS reach anyone?" surface was effectively dead.
--   #2 means a hostile actor could pollute the companies table with
--   junk rows; not a data-leak but a tenant-list poisoning vector.
--
-- ROLLBACK
--   Both functions are CREATE OR REPLACE — re-applying the previous
--   versions (from earlier migrations) restores the prior behaviour.
-- ════════════════════════════════════════════════════════════════════════

-- ── Fix 1: get_sos_delivery_summary uuid cast ────────────────────────
CREATE OR REPLACE FUNCTION public.get_sos_delivery_summary(p_emergency_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
STABLE
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_session      record;
  v_emerg_uuid   uuid;
  v_authorized   boolean := false;
  v_total        int := 0;
  v_reached      int := 0;
  v_reached_any  boolean := false;
  v_contacts     jsonb;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized: must be logged in'; END IF;

  -- sos_sessions.id is uuid; the RPC takes text per existing convention.
  -- Cast carefully — non-uuid emergency_ids (legacy 'EMG-XXX' format)
  -- are rejected with not_found rather than crashing.
  BEGIN
    v_emerg_uuid := p_emergency_id::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'not_found: emergency does not exist (invalid id format)';
  END;

  SELECT user_id, company_id INTO v_session
    FROM public.sos_sessions WHERE id = v_emerg_uuid LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: emergency does not exist'; END IF;

  IF v_session.user_id = v_caller THEN
    v_authorized := true;
  ELSIF v_session.company_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_memberships
    WHERE user_id = v_caller AND company_id = v_session.company_id
      AND active = true AND role IN ('admin','owner')
  ) THEN
    v_authorized := true;
  END IF;
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'unauthorized: caller is neither the SOS owner nor an admin/owner of the company';
  END IF;

  WITH per_contact AS (
    SELECT
      contact_index,
      max(contact_name)  AS contact_name,
      array_agg(DISTINCT channel)                                                AS channels_attempted,
      array_agg(DISTINCT channel) FILTER (WHERE outcome IN ('sent','delivered')) AS channels_succeeded,
      bool_or(outcome IN ('sent','delivered'))                                    AS reached
    FROM public.sos_dispatch_attempts
    WHERE emergency_id = p_emergency_id
    GROUP BY contact_index
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE reached),
    bool_or(reached),
    jsonb_agg(jsonb_build_object(
      'contact_index',      contact_index,
      'contact_name',       contact_name,
      'channels_attempted', COALESCE(channels_attempted, '{}'::text[]),
      'channels_succeeded', COALESCE(channels_succeeded, '{}'::text[]),
      'reached',            COALESCE(reached, false)
    ) ORDER BY contact_index)
  INTO v_total, v_reached, v_reached_any, v_contacts
  FROM per_contact;

  RETURN jsonb_build_object(
    'emergency_id',         p_emergency_id,
    'reached_any',          COALESCE(v_reached_any, false),
    'all_contacts_reached', v_total > 0 AND v_reached = v_total,
    'total_contacts',       COALESCE(v_total, 0),
    'reached_contacts',     COALESCE(v_reached, 0),
    'contacts',             COALESCE(v_contacts, '[]'::jsonb),
    'fetched_at',           now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_sos_delivery_summary(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sos_delivery_summary(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sos_delivery_summary(text) TO authenticated;

-- ── Fix 2: create_company_and_become_owner anon lockdown ─────────────
CREATE OR REPLACE FUNCTION public.create_company_and_become_owner(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  new_company_id uuid;
BEGIN
  -- AUDIT #46: anon could previously call this and create orphan companies.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized: must be logged in to create a company'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'company name too short';
  END IF;

  INSERT INTO public.companies (name)
  VALUES (trim(p_name))
  RETURNING id INTO new_company_id;

  PERFORM public.set_user_company(new_company_id, 'owner');

  RETURN new_company_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_company_and_become_owner(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_company_and_become_owner(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_company_and_become_owner(text) TO authenticated;
