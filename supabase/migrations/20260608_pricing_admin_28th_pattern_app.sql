-- ═══════════════════════════════════════════════════════════════
-- 2026-06-08 — pricing admin (28th pattern application)
-- ─────────────────────────────────────────────────────────────
-- The plans table existed since the 20th pattern app (C-1) but only
-- had read RPCs (list_plans). Pricing changes had to be done via
-- raw SQL by a DBA — error-prone, no audit trail, no UI affordance.
--
-- This migration adds:
--   1. is_super_admin() helper — checks if caller has super_admin
--      role in any company_memberships row. Used to gate platform-
--      level config mutations (pricing, etc.).
--   2. upsert_plan(...) SECDEF RPC for create + edit in one call.
--   3. delete_plan(p_id) SECDEF RPC for removal (idempotent).
--   4. Audit writes inside each RPC — pricing changes are real
--      business decisions and must land in audit_log (ISO 27001
--      §A.12.4 + financial-impact paper trail).
--
-- RLS unchanged: plans_public_read covers reads for anon + auth
-- (so the pricing page renders without auth). Writes happen via
-- SECDEF RPC which checks is_super_admin() internally.
-- ═══════════════════════════════════════════════════════════════

-- ─── is_super_admin helper ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_memberships cm
    WHERE cm.user_id = auth.uid()
      AND cm.active  = true
      AND cm.role    = 'super_admin'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- ─── upsert_plan RPC ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_plan(
  p_id                   text,
  p_kind                 text,
  p_name                 text,
  p_name_ar              text DEFAULT NULL,
  p_description          text DEFAULT NULL,
  p_color                text DEFAULT NULL,
  p_monthly_price        numeric DEFAULT NULL,
  p_annual_price         numeric DEFAULT NULL,
  p_annual_monthly       numeric DEFAULT NULL,
  p_max_employees        integer DEFAULT NULL,
  p_max_zones            integer DEFAULT NULL,
  p_extra_employee_price numeric DEFAULT NULL,
  p_features             jsonb DEFAULT '[]'::jsonb,
  p_popular              boolean DEFAULT false,
  p_sort_order           integer DEFAULT 100,
  p_active               boolean DEFAULT true
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_was_insert boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'not authorized' USING errcode = '42501';
  END IF;
  IF p_id IS NULL OR length(trim(p_id)) = 0 THEN
    RAISE EXCEPTION 'plan id required' USING errcode = '22023';
  END IF;
  IF p_kind NOT IN ('unified','individual','addon') THEN
    RAISE EXCEPTION 'plan kind must be unified|individual|addon' USING errcode = '22023';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'plan name required' USING errcode = '22023';
  END IF;

  SELECT NOT EXISTS(SELECT 1 FROM public.plans WHERE id = p_id) INTO v_was_insert;

  INSERT INTO public.plans (
    id, kind, name, name_ar, description, color,
    monthly_price, annual_price, annual_monthly,
    max_employees, max_zones, extra_employee_price,
    features, popular, sort_order, active,
    created_at, updated_at
  )
  VALUES (
    p_id, p_kind, p_name, p_name_ar, p_description, p_color,
    p_monthly_price, p_annual_price, p_annual_monthly,
    p_max_employees, p_max_zones, p_extra_employee_price,
    coalesce(p_features, '[]'::jsonb), coalesce(p_popular, false),
    coalesce(p_sort_order, 100), coalesce(p_active, true),
    now(), now()
  )
  ON CONFLICT (id) DO UPDATE SET
    kind                 = EXCLUDED.kind,
    name                 = EXCLUDED.name,
    name_ar              = EXCLUDED.name_ar,
    description          = EXCLUDED.description,
    color                = EXCLUDED.color,
    monthly_price        = EXCLUDED.monthly_price,
    annual_price         = EXCLUDED.annual_price,
    annual_monthly       = EXCLUDED.annual_monthly,
    max_employees        = EXCLUDED.max_employees,
    max_zones            = EXCLUDED.max_zones,
    extra_employee_price = EXCLUDED.extra_employee_price,
    features             = EXCLUDED.features,
    popular              = EXCLUDED.popular,
    sort_order           = EXCLUDED.sort_order,
    active               = EXCLUDED.active,
    updated_at           = now();

  -- Audit row (financial-impact change, ISO 27001 §A.12.4).
  INSERT INTO public.audit_log (
    id, actor_id, actor_role, action, operation, target_id, target_name,
    metadata, severity, created_at
  )
  VALUES (
    'AUD-' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 8),
    v_uid, 'super_admin',
    CASE WHEN v_was_insert THEN 'plan_created' ELSE 'plan_updated' END,
    'pricing',
    p_id, p_name,
    jsonb_build_object(
      'kind', p_kind, 'monthly_price', p_monthly_price,
      'annual_price', p_annual_price, 'active', coalesce(p_active, true)
    ),
    CASE WHEN v_was_insert THEN 'success' ELSE 'info' END,
    now()
  );

  RETURN p_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.upsert_plan(text, text, text, text, text, text, numeric, numeric, numeric, integer, integer, numeric, jsonb, boolean, integer, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_plan(text, text, text, text, text, text, numeric, numeric, numeric, integer, integer, numeric, jsonb, boolean, integer, boolean) TO authenticated;

-- ─── delete_plan RPC ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_plan(p_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'not authorized' USING errcode = '42501';
  END IF;

  SELECT name INTO v_name FROM public.plans WHERE id = p_id;
  IF v_name IS NULL THEN
    RETURN false;  -- idempotent: deleting a non-existent plan is OK
  END IF;

  DELETE FROM public.plans WHERE id = p_id;

  INSERT INTO public.audit_log (
    id, actor_id, actor_role, action, operation, target_id, target_name,
    metadata, severity, created_at
  )
  VALUES (
    'AUD-' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 8),
    v_uid, 'super_admin', 'plan_deleted', 'pricing',
    p_id, v_name,
    jsonb_build_object('id', p_id),
    'warning', now()
  );

  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.delete_plan(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_plan(text) TO authenticated;
