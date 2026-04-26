-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: b_15_b_16_text_to_uuid
-- Version:   20260425180000
-- Applied:   2026-04-25 via Supabase MCP
-- Source of truth: this file matches what was applied to prod.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- B-15 + B-16 (2026-04-25) — convert two text columns to uuid.
--
-- Bug:
--   gps_trail.employee_id   was text, but auth.uid() is uuid.
--   evidence_vaults.user_id was text, same mismatch.
-- All RLS policies cast `auth.uid()::text` to compare. The cast prevents
-- the planner from using the b-tree index on the column → during an SOS
-- storm the dispatcher dashboard would lock up on a sequential scan.
--
-- Pre-migration state:
--   gps_trail had 906 rows of LEGACY non-UUID test fixtures (EMP-001,
--   EMP-Fadi, EMP-Rwan, …). They were preserved into a service-role-only
--   _gps_trail_legacy_text_backup_b15 table before deletion. evidence_vaults
--   was already empty.
--
-- Migration plan (single transaction):
--   1. Drop the 6 RLS policies that reference the columns.
--   2. Drop the b-tree indexes on the columns.
--   3. ALTER TYPE … USING …::uuid  (now safe — non-UUID rows removed).
--   4. Recreate the indexes.
--   5. Recreate the policies WITHOUT the ::text cast — the planner can
--      now use the indexes directly. Verified by EXPLAIN: post-migration
--      plan picks `Index Scan using idx_gps_trail_employee` instead of
--      the prior Seq Scan with cast.
--
-- Verified by 9 scenarios in AUDIT_VERIFICATION_LOG.md:
--   ✓ Insert with valid uuid succeeds
--   ✓ Insert with non-uuid string rejected at column boundary
--   ✓ User A SELECT sees only own rows (RLS scopes)
--   ✓ User B SELECT sees only own rows (RLS scopes)
--   ✓ Cross-tenant invisible
--   ✓ EXPLAIN plan: Index Scan (idx_gps_trail_employee) — proves the
--     dispatcher dashboard SOS-storm path is now O(log n) not O(n).
--   ✓ Same for evidence_vaults_user_id_idx
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Pre-migration: stash legacy non-UUID rows in a service-role table ──
CREATE TABLE IF NOT EXISTS public._gps_trail_legacy_text_backup_b15 AS
  SELECT * FROM public.gps_trail WHERE 1=0;
ALTER TABLE public._gps_trail_legacy_text_backup_b15 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS _bk_block_all ON public._gps_trail_legacy_text_backup_b15;
CREATE POLICY _bk_block_all ON public._gps_trail_legacy_text_backup_b15
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
COMMENT ON TABLE public._gps_trail_legacy_text_backup_b15 IS
  'B-15 2026-04-25: backup of pre-migration gps_trail rows whose employee_id '
  'was not a valid UUID (legacy test fixtures). service-role only. Drop after '
  'a successful production launch.';

-- (The actual data move + delete happened on 2026-04-25 via:
--    INSERT INTO _gps_trail_legacy_text_backup_b15
--      SELECT * FROM gps_trail
--      WHERE employee_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-…';
--    DELETE FROM gps_trail WHERE employee_id !~ '…';
--  Idempotent: this section is a no-op on re-apply because the table
--  is now uuid-typed and the regex would fail to evaluate.)

BEGIN;

-- 1. Drop policies
DROP POLICY IF EXISTS "Users can insert own vaults"          ON public.evidence_vaults;
DROP POLICY IF EXISTS "Users can update own unlocked vaults" ON public.evidence_vaults;
DROP POLICY IF EXISTS "Users can view own vaults"            ON public.evidence_vaults;
DROP POLICY IF EXISTS gps_own_user           ON public.gps_trail;
DROP POLICY IF EXISTS gps_trail_company_read ON public.gps_trail;
DROP POLICY IF EXISTS gps_trail_self         ON public.gps_trail;

-- 2. Drop indexes that we'll rebuild on the new column type
DROP INDEX IF EXISTS public.idx_gps_trail_employee;
DROP INDEX IF EXISTS public.evidence_vaults_user_id_idx;

-- 3. Alter column types
ALTER TABLE public.evidence_vaults
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
ALTER TABLE public.gps_trail
  ALTER COLUMN employee_id TYPE uuid USING employee_id::uuid;

-- 4. Recreate indexes (now genuinely useful — no implicit cast)
CREATE INDEX idx_gps_trail_employee
  ON public.gps_trail(employee_id);
CREATE INDEX evidence_vaults_user_id_idx
  ON public.evidence_vaults(user_id);

-- 5. Recreate policies WITHOUT the ::text cast
CREATE POLICY "Users can view own vaults"
  ON public.evidence_vaults FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own vaults"
  ON public.evidence_vaults FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own unlocked vaults"
  ON public.evidence_vaults FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND locked_at IS NULL);

CREATE POLICY gps_trail_self
  ON public.gps_trail FOR ALL TO authenticated
  USING (
    employee_id = auth.uid()
    OR (company_id IS NULL AND employee_id IS NULL)
  )
  WITH CHECK (
    employee_id = auth.uid()
    OR (company_id IS NULL AND employee_id IS NULL)
  );
CREATE POLICY gps_trail_company_read
  ON public.gps_trail FOR SELECT TO authenticated
  USING (company_id IS NOT NULL AND is_company_member(company_id));
CREATE POLICY gps_own_user
  ON public.gps_trail FOR ALL TO authenticated
  USING (company_id = ((auth.jwt() ->> 'company_id'::text))::uuid);

COMMIT;

COMMENT ON COLUMN public.gps_trail.employee_id IS
  'B-15 2026-04-25: migrated text → uuid so RLS policies use the index '
  'directly without a cast (previously caused seq-scans during SOS load).';
COMMENT ON COLUMN public.evidence_vaults.user_id IS
  'B-16 2026-04-25: migrated text → uuid for the same reason as gps_trail.';
