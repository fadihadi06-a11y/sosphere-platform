-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260501111317
-- name:     register_company_full_v2_schema_fix
-- live:     register_company_full_v2_schema_fix
-- sha256:   cb67a91b2005c764 (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- Fix register_company_full RPC: schema-correct columns for zones + invitations.
-- Audit 2026-05-01: original RPC used `radius_m` and `address` (don't exist on
-- zones), and only persisted name+lat+lng+radius for zones, dropping type/risk_level/
-- evacuation_point/evac_lat/evac_lng. Invitations RPC also dropped name/phone/
-- department/zone_name/role_type fields the client sends.
--
-- This v2 matches the actual schema (verified live):
--   zones:       id, company_id, name, name_ar, type, risk_level, capacity,
--                lat, lon, radius, is_active, created_at, updated_at,
--                evacuation_point, evac_lat, evac_lng, radius_meters, lng,
--                employee_count, active_alerts, status
--   invitations: id, company_id, email, role, level, invited_by, token, status,
--                expires_at, created_at, name, phone, department, zone_name,
--                role_type, accepted_at
--
-- Idempotent: DROP + CREATE pattern.

DROP FUNCTION IF EXISTS public.register_company_full(text, text, text, int, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.register_company_full(
  p_name              text,
  p_industry          text DEFAULT NULL,
  p_country           text DEFAULT 'SA',
  p_employee_estimate int  DEFAULT 25,
  p_invite_code       text DEFAULT NULL,
  p_zones             jsonb DEFAULT '[]'::jsonb,
  p_invitations       jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid;
  v_zone jsonb;
  v_zone_count int := 0;
  v_invite jsonb;
  v_invite_count int := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Step 1: create company + owner membership atomically (existing SECDEF helper)
  v_company := public.create_company_v2(p_name);

  -- Step 2: enrich company metadata. Billing columns (plan / billing_cycle /
  -- trial_ends_at) are server-controlled by lock_company_billing_columns
  -- trigger; we don't touch them here.
  UPDATE public.companies
     SET industry          = p_industry,
         country           = COALESCE(p_country, 'SA'),
         employee_estimate = COALESCE(p_employee_estimate, 25),
         invite_code       = p_invite_code,
         has_zones         = (jsonb_array_length(p_zones) > 0),
         is_active         = true
   WHERE id = v_company;

  -- Step 3: zones. Schema-aware: type/risk_level/evacuation_point/evac_lat/
  -- evac_lng/radius_meters are all preserved. lat/lng are mirrored to lon for
  -- backward compatibility with code paths that read either column.
  IF jsonb_array_length(p_zones) > 0 THEN
    FOR v_zone IN SELECT * FROM jsonb_array_elements(p_zones) LOOP
      INSERT INTO public.zones (
        company_id, name, type, risk_level, evacuation_point,
        lat, lon, lng, radius, radius_meters,
        evac_lat, evac_lng, is_active, status
      ) VALUES (
        v_company,
        v_zone->>'name',
        NULLIF(v_zone->>'type', ''),
        NULLIF(v_zone->>'risk_level', ''),
        NULLIF(v_zone->>'evacuation_point', ''),
        NULLIF(v_zone->>'lat', '')::double precision,
        NULLIF(v_zone->>'lng', '')::double precision,
        NULLIF(v_zone->>'lng', '')::double precision,
        NULLIF(v_zone->>'radius_meters', '')::int,
        NULLIF(v_zone->>'radius_meters', '')::int,
        NULLIF(v_zone->>'evac_lat', '')::double precision,
        NULLIF(v_zone->>'evac_lng', '')::double precision,
        true,
        'active'
      );
      v_zone_count := v_zone_count + 1;
    END LOOP;
  END IF;

  -- Step 4: invitations. Preserves name/phone/department/zone_name/role_type
  -- fields the client wizard collects. Email is normalized lower(trim(...))
  -- so accept_invitation RPC matches reliably. Unique violation per email
  -- per company is silently ignored (idempotent).
  IF jsonb_array_length(p_invitations) > 0 THEN
    FOR v_invite IN SELECT * FROM jsonb_array_elements(p_invitations) LOOP
      BEGIN
        INSERT INTO public.invitations (
          company_id, email, name, phone, role, role_type,
          department, zone_name, status, invited_by, created_at
        ) VALUES (
          v_company,
          NULLIF(lower(trim(v_invite->>'email')), ''),
          NULLIF(v_invite->>'name', ''),
          NULLIF(v_invite->>'phone', ''),
          COALESCE(v_invite->>'role', 'employee'),
          COALESCE(v_invite->>'role_type', 'employee'),
          NULLIF(v_invite->>'department', ''),
          NULLIF(v_invite->>'zone_name', ''),
          'pending',
          v_user,
          now()
        );
        v_invite_count := v_invite_count + 1;
      EXCEPTION
        WHEN unique_violation THEN NULL;
        WHEN not_null_violation THEN NULL;  -- skip rows missing email
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id',   v_company,
    'zone_count',   v_zone_count,
    'invite_count', v_invite_count,
    'created_at',   now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_company_full(
  text, text, text, int, text, jsonb, jsonb
) TO authenticated;

COMMENT ON FUNCTION public.register_company_full(text, text, text, int, text, jsonb, jsonb)
IS 'Atomic company registration: company + owner membership + metadata + zones + invitations in a single transaction. Replaces 4-step legacy flow. Schema-aligned with live tables (audit 2026-05-01).';
;
