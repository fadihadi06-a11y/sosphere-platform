-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260502171347
-- name:     phase1_indexes_cleanup_and_composites_v2
-- live:     phase1_indexes_cleanup_and_composites_v2
-- sha256:   ba438fd82807a415 (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- Phase 1 / #163: index cleanup + composite indexes for 35K scale
-- v2: corrected after dry-run revealed two of the planned DROPs were
-- actually backed by UNIQUE constraints. Verified via pg_constraint
-- that an alternate constraint preserves the invariant before dropping.
--
-- (A) Cleanup — 6 plain duplicate indexes + 2 redundant unique
--     constraints. For each, an alternate constraint or PK already
--     enforces the same invariant (proven before this migration).
-- (B) Add 5 composite indexes for the actual hot-path queries in
--     data-layer.ts and sos-alert/index.ts that will full-scan past
--     a few thousand employees per tenant.
--
-- All operations idempotent. Re-runnable.
-- ═══════════════════════════════════════════════════════════════

-- ─── (A1) DROP redundant UNIQUE CONSTRAINTS ───────────────────
-- companies.owner_id has TWO unique constraints (owner_id_key +
-- owner_id_unique) with identical definition. Keep _key, drop _unique.
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_owner_id_unique;

-- company_memberships PK already covers (company_id, user_id) — the
-- separate UNIQUE constraint is exact duplicate.
ALTER TABLE public.company_memberships
  DROP CONSTRAINT IF EXISTS company_memberships_unique;


-- ─── (A2) DROP plain duplicate indexes ────────────────────────
-- Plain index on companies.owner_id — covered by the unique we kept.
DROP INDEX IF EXISTS public.idx_companies_owner;

-- Plain index on companies.invite_code — covered by partial unique
-- companies_invite_code_idx (WHERE invite_code IS NOT NULL).
DROP INDEX IF EXISTS public.idx_companies_invite;

-- THREE identical partial-unique indexes on (user_id) WHERE active.
-- Keep uq_one_active_company_per_user (clearest naming).
DROP INDEX IF EXISTS public.company_memberships_one_active_per_user;
DROP INDEX IF EXISTS public.company_memberships_one_active_company_per_user;

-- one_owner_per_company is partial on (company_id) WHERE role='owner'.
-- The other variant uq_one_owner_per_company also requires AND active=true,
-- which is semantically correct (an inactive former-owner shouldn't block
-- promoting a new owner). Drop the looser one.
DROP INDEX IF EXISTS public.one_owner_per_company;

-- sos_queue.status indexed twice under different names. Keep idx_sos_status.
DROP INDEX IF EXISTS public.idx_sos_queue_status;


-- ─── (B) CREATE composite indexes for 35K-tenant scale ────────
-- Used by data-layer.ts dashboard KPI queries:
--   SELECT id, status FROM employees WHERE company_id = $1
CREATE INDEX IF NOT EXISTS idx_employees_company_status
  ON public.employees (company_id, status);

-- Used by "recently active employees" / live presence:
--   ... ORDER BY last_seen_at DESC NULLS LAST
CREATE INDEX IF NOT EXISTS idx_employees_company_lastseen
  ON public.employees (company_id, last_seen_at DESC NULLS LAST);

-- LIFESAVING-CRITICAL hot path. Used by sos-alert/index.ts:1623-1628
-- on every SOS trigger:
--   SELECT user_id FROM company_memberships
--   WHERE company_id = $1 AND role = 'owner' AND active = true
CREATE INDEX IF NOT EXISTS idx_memberships_company_role_active
  ON public.company_memberships (company_id, role, active);

-- Used by employees-unified-page.tsx pending-invites view:
--   WHERE company_id = $1 AND status = 'pending'
CREATE INDEX IF NOT EXISTS idx_invitations_company_status
  ON public.invitations (company_id, status)
;

-- Used by GPS trail playback / live tracking:
--   WHERE company_id = $1 AND employee_id = $2
--   ORDER BY recorded_at DESC LIMIT 100
CREATE INDEX IF NOT EXISTS idx_gps_trail_company_emp_time
  ON public.gps_trail (company_id, employee_id, recorded_at DESC);;
