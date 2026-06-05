-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 — checkin_sessions (24th pattern application)
-- ─────────────────────────────────────────────────────────────
-- The active check-in deadline state (when is this worker's next
-- check-in due?) lived ONLY in mobile localStorage prior to this:
--   sosphere_checkin_deadline / _total / _warn_cycle
--
-- That made it impossible for admin to know who was overdue across:
--   • Worker phone died mid-shift (admin gets no signal until SOS)
--   • Worker switched device (deadline lost on new device)
--   • Worker rebooted phone (state survives the reboot via the
--     localStorage key, but only on the SAME phone)
--   • Admin needed real-time "due in X min" countdown across workforce
--
-- This migration creates the server-side mirror of the active
-- deadline so every device + admin dashboard sees the same truth.
-- The mobile checkin-timer.tsx dual-writes (instant localStorage for
-- the worker's own UI, SECDEF RPC for the durable share).
--
-- PK: user_id (one active session per worker — UPSERT replaces the
-- previous one when the worker starts a new check-in cycle).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.checkin_sessions (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_name  text NOT NULL,
  zone           text,
  deadline_ts    timestamptz NOT NULL,
  total_sec      integer NOT NULL CHECK (total_sec > 0),
  warning_cycle  integer NOT NULL DEFAULT 0 CHECK (warning_cycle >= 0),
  started_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkin_sessions_company
  ON public.checkin_sessions (company_id);
CREATE INDEX IF NOT EXISTS idx_checkin_sessions_deadline
  ON public.checkin_sessions (deadline_ts);

ALTER TABLE public.checkin_sessions ENABLE ROW LEVEL SECURITY;

-- Worker reads + writes own row; company admin/owner reads any in
-- their company. Consolidated single PERMISSIVE policy per cmd to
-- avoid the stacking pitfalls cleaned up in Tier 3C.

CREATE POLICY checkin_sessions_select ON public.checkin_sessions
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR is_company_admin_or_owner(company_id)
  );

CREATE POLICY checkin_sessions_insert ON public.checkin_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
  );

CREATE POLICY checkin_sessions_update ON public.checkin_sessions
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY checkin_sessions_delete ON public.checkin_sessions
  FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR is_company_admin_or_owner(company_id)
  );

-- ─── RPCs ──────────────────────────────────────────────────────

-- Upsert the worker's active deadline. The mobile timer calls this
-- after each localStorage write so the durable copy stays in sync.
CREATE OR REPLACE FUNCTION public.upsert_checkin_session(
  p_deadline_ts   timestamptz,
  p_total_sec     integer,
  p_warning_cycle integer,
  p_zone          text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_company_id   uuid;
  v_employee     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  -- Resolve the caller's active company and display name from profiles.
  SELECT company_id, COALESCE(display_name, full_name, email, 'Worker')
    INTO v_company_id, v_employee
  FROM public.profiles
  WHERE id = v_uid
  LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'no active company' USING errcode = '42501';
  END IF;

  INSERT INTO public.checkin_sessions (
    user_id, company_id, employee_name, zone,
    deadline_ts, total_sec, warning_cycle,
    started_at, updated_at
  )
  VALUES (
    v_uid, v_company_id, v_employee, p_zone,
    p_deadline_ts, p_total_sec, GREATEST(0, p_warning_cycle),
    now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    company_id    = EXCLUDED.company_id,
    employee_name = EXCLUDED.employee_name,
    zone          = EXCLUDED.zone,
    deadline_ts   = EXCLUDED.deadline_ts,
    total_sec     = EXCLUDED.total_sec,
    warning_cycle = EXCLUDED.warning_cycle,
    updated_at    = now();

  RETURN v_uid;
END $$;
REVOKE EXECUTE ON FUNCTION public.upsert_checkin_session(timestamptz, integer, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_checkin_session(timestamptz, integer, integer, text) TO authenticated;

-- Clear the caller's active session (worker checked in / cancelled / SOS'd).
CREATE OR REPLACE FUNCTION public.clear_checkin_session()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  DELETE FROM public.checkin_sessions WHERE user_id = v_uid;
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.clear_checkin_session() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clear_checkin_session() TO authenticated;

-- Admin reader: list active check-in sessions for a company so the
-- dashboard can render "due in X min" + filter overdue.
CREATE OR REPLACE FUNCTION public.get_active_checkin_sessions(p_company_id uuid)
RETURNS TABLE (
  user_id        uuid,
  employee_name  text,
  zone           text,
  deadline_ts    timestamptz,
  total_sec      integer,
  warning_cycle  integer,
  started_at     timestamptz,
  updated_at     timestamptz,
  seconds_until_deadline integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  IF NOT is_company_admin_or_owner(p_company_id) THEN
    RAISE EXCEPTION 'not authorized' USING errcode = '42501';
  END IF;

  RETURN QUERY
    SELECT
      s.user_id, s.employee_name, s.zone,
      s.deadline_ts, s.total_sec, s.warning_cycle,
      s.started_at, s.updated_at,
      EXTRACT(EPOCH FROM (s.deadline_ts - now()))::integer AS seconds_until_deadline
    FROM public.checkin_sessions s
    WHERE s.company_id = p_company_id
    ORDER BY s.deadline_ts ASC;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_active_checkin_sessions(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_active_checkin_sessions(uuid) TO authenticated;
