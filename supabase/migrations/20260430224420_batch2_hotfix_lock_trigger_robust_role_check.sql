-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260430224420
-- name:     batch2_hotfix_lock_trigger_robust_role_check
-- live:     batch2_hotfix_lock_trigger_robust_role_check_2026_04_30
-- sha256:   c8f9ec29da2061aa (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════
-- BATCH 2 HOTFIX: lock_company_billing_columns role detection
-- 2026-04-30 — Beehive Audit #7 finding
--
-- Original trigger only checked `current_setting('request.jwt.claim.role')`
-- which is populated by PostgREST when a JWT is present. Edge functions
-- and admin tools using @supabase/supabase-js with the service-role key
-- POST the SR JWT through PostgREST, so this works for them. BUT direct
-- Postgres connections that set `current_user='service_role'` (e.g. the
-- postgres CLI or pgAdmin under SR) saw an empty JWT claim and were
-- incorrectly blocked.
--
-- This hotfix accepts EITHER signal as service_role:
--   1) current_user = 'service_role'    (direct Postgres connections)
--   2) JWT claim role = 'service_role'   (PostgREST + edge functions)
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.lock_company_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_role text;
BEGIN
  -- Path 1: direct Postgres role (admin/CLI connections).
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Path 2: PostgREST/edge function service-role JWT.
  v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Block client-side mutation of billing-controlled fields.
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    RAISE EXCEPTION 'plan can only be changed via Stripe webhook'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at THEN
    RAISE EXCEPTION 'trial_ends_at cannot be changed by client'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle THEN
    RAISE EXCEPTION 'billing_cycle can only be changed via Stripe webhook'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.lock_company_billing_columns() IS
  'Audit 2026-04-30 fix #3 (hotfix): accepts current_user=service_role OR JWT role=service_role. Stripe webhook + admin tools both pass.';;
