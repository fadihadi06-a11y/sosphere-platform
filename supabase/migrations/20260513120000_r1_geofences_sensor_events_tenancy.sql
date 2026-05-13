-- ═══════════════════════════════════════════════════════════════════════════
-- R-1 (2026-05-13): geofences + sensor_events — full tenancy (ROOT FIX)
-- ─────────────────────────────────────────────────────────────────────────
-- SUPERSEDES the L5-SEC-4 Phase-1 band-aid (20260512170000) which set
-- USING(false) on both tables to stop the cross-tenant leak without
-- adding tenant columns. That left both features dead.
--
-- This migration delivers the proper fix:
--   1. geofences gains `company_id uuid REFERENCES companies(id)`.
--      Tenant-scoped via is_company_member(company_id) for reads and
--      is_company_admin(company_id) for writes.
--   2. sensor_events gains `user_id uuid REFERENCES auth.users(id)`.
--      Tenant-scoped via user_id = auth.uid() for both reads and writes.
--   3. SECDEF write RPCs pin tenancy server-side so the client cannot
--      forge company_id / user_id (defense-in-depth on top of RLS).
--   4. Authenticated callers regain SELECT (now properly scoped).
--      Writes go through the RPCs only — direct table grants stay
--      revoked from anon + authenticated (W3-8 pattern).
--
-- LEGACY DATA
--   * geofences:    0 rows in prod. New column is NULL-friendly.
--   * sensor_events: 41 legacy rows from before RLS was enabled.
--     Their user_id stays NULL. RLS USING(user_id = auth.uid()) hides
--     them from all authenticated readers — they remain accessible
--     only to service_role for forensic queries. No data loss; just
--     no longer cross-tenant readable.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Add tenancy columns ────────────────────────────────────────────────
ALTER TABLE public.geofences
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.sensor_events
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_geofences_company_id     ON public.geofences(company_id);
CREATE INDEX IF NOT EXISTS idx_sensor_events_user_id    ON public.sensor_events(user_id);
CREATE INDEX IF NOT EXISTS idx_sensor_events_detected_at ON public.sensor_events(detected_at DESC);

-- ── 2. Drop the Phase-1 deny-all SELECT policies + recreate properly ─────
DROP POLICY IF EXISTS geofences_authenticated_read     ON public.geofences;
DROP POLICY IF EXISTS sensor_events_authenticated_read ON public.sensor_events;

CREATE POLICY geofences_company_read
  ON public.geofences FOR SELECT TO authenticated
  USING (company_id IS NOT NULL AND public.is_company_member(company_id));

CREATE POLICY sensor_events_owner_read
  ON public.sensor_events FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

-- ── 3. NO direct INSERT/UPDATE/DELETE policies for authenticated.
-- Writes go through SECDEF RPCs (defense-in-depth: RPC pins tenancy +
-- table-level grants stay revoked so a future migration that forgets
-- to add a write policy doesn't accidentally open the table).

-- ── 4. SECDEF write RPCs ──────────────────────────────────────────────────

-- 4a. upsert_geofence — admin-only, company pinned from profiles.active_company_id
CREATE OR REPLACE FUNCTION public.upsert_geofence(
  p_id      text,
  p_name    text,
  p_type    text,
  p_center  jsonb DEFAULT NULL,
  p_radius  numeric DEFAULT NULL,
  p_points  jsonb DEFAULT NULL,
  p_risk    text DEFAULT NULL,
  p_status  text DEFAULT NULL,
  p_color   text DEFAULT NULL,
  p_locked  boolean DEFAULT FALSE,
  p_visible boolean DEFAULT TRUE,
  p_alerts  jsonb DEFAULT '[]'::jsonb
)
RETURNS public.geofences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_caller        uuid := auth.uid();
  v_company_id    uuid;
  v_existing_co   uuid;
  v_row           public.geofences;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'upsert_geofence: not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR length(trim(p_id)) = 0 THEN
    RAISE EXCEPTION 'upsert_geofence: id required';
  END IF;

  -- Resolve caller's active company from profiles.
  SELECT active_company_id INTO v_company_id
  FROM public.profiles WHERE id = v_caller LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'upsert_geofence: caller has no active company' USING ERRCODE = '42501';
  END IF;

  -- Caller must be admin/owner of that company.
  IF NOT public.is_company_admin(v_company_id) THEN
    RAISE EXCEPTION 'upsert_geofence: caller is not admin/owner of company %', v_company_id
      USING ERRCODE = '42501';
  END IF;

  -- If row exists, it must belong to the same company (prevents stealing
  -- another company's geofence ID).
  SELECT company_id INTO v_existing_co FROM public.geofences WHERE id = p_id;
  IF v_existing_co IS NOT NULL AND v_existing_co <> v_company_id THEN
    RAISE EXCEPTION 'upsert_geofence: id % belongs to a different company', p_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.geofences
    (id, name, type, center, radius, points, risk, status, color, locked, visible, alerts, company_id, created_at, updated_at)
  VALUES
    (p_id, p_name, p_type, p_center, p_radius, p_points, p_risk, p_status, p_color, p_locked, p_visible, p_alerts, v_company_id, now(), now())
  ON CONFLICT (id) DO UPDATE SET
    name       = EXCLUDED.name,
    type       = EXCLUDED.type,
    center     = EXCLUDED.center,
    radius     = EXCLUDED.radius,
    points     = EXCLUDED.points,
    risk       = EXCLUDED.risk,
    status     = EXCLUDED.status,
    color      = EXCLUDED.color,
    locked     = EXCLUDED.locked,
    visible    = EXCLUDED.visible,
    alerts     = EXCLUDED.alerts,
    -- company_id never changes once set.
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 4b. delete_geofence — admin-only, ownership verified
CREATE OR REPLACE FUNCTION public.delete_geofence(p_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_row_co     uuid;
  v_deleted    boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_geofence: not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT company_id INTO v_row_co FROM public.geofences WHERE id = p_id;
  IF v_row_co IS NULL THEN
    RETURN false;  -- not found OR row has NULL company (legacy) — refuse silently
  END IF;
  IF NOT public.is_company_admin(v_row_co) THEN
    RAISE EXCEPTION 'delete_geofence: caller is not admin/owner of owning company'
      USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.geofences WHERE id = p_id AND company_id = v_row_co;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- 4c. record_sensor_event — any authenticated user, user_id pinned to auth.uid()
CREATE OR REPLACE FUNCTION public.record_sensor_event(
  p_id           text,
  p_event_type   text,
  p_acceleration numeric,
  p_detected_at  timestamptz DEFAULT NULL
)
RETURNS public.sensor_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_row    public.sensor_events;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'record_sensor_event: not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_event_type IS NULL THEN
    RAISE EXCEPTION 'record_sensor_event: id + event_type required';
  END IF;

  INSERT INTO public.sensor_events
    (id, event_type, acceleration, detected_at, resolved, user_id, created_at)
  VALUES
    (p_id, p_event_type, p_acceleration,
     COALESCE(p_detected_at, now()), false, v_caller, now())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_geofence(text, text, text, jsonb, numeric, jsonb, text, text, text, boolean, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_geofence(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_sensor_event(text, text, numeric, timestamptz) TO authenticated;

-- service_role already has bypass — explicit grants for clarity.
GRANT EXECUTE ON FUNCTION public.upsert_geofence(text, text, text, jsonb, numeric, jsonb, text, text, text, boolean, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_geofence(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_sensor_event(text, text, numeric, timestamptz) TO service_role;

-- ── 5. Update table comments — Phase 1 ban removed, real tenancy in place ──
COMMENT ON TABLE public.geofences IS
  'R-1 (2026-05-13): tenant-scoped via company_id. Writes via upsert_geofence/delete_geofence RPCs (SECDEF + admin-only). Reads via is_company_member(company_id) policy.';
COMMENT ON TABLE public.sensor_events IS
  'R-1 (2026-05-13): per-user via user_id. Writes via record_sensor_event RPC (SECDEF + auth.uid() pin). Reads via user_id = auth.uid() policy. 41 legacy NULL-user_id rows accessible only to service_role.';
