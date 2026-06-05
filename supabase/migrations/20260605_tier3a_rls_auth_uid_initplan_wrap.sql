-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 roots-of-roots Tier 3A — RLS auth.uid() initplan wrap
-- ─────────────────────────────────────────────────────────────
-- The Supabase performance advisor flagged 150 instances of the
-- `auth_rls_initplan` lint: RLS policies that call auth.uid() /
-- auth.role() / auth.jwt() / auth.email() WITHOUT wrapping in
-- (SELECT ...). Postgres re-evaluates the function per-row instead
-- of caching it for the whole statement.
--
-- The fix: wrap every raw call in (SELECT ...). Then Postgres
-- treats it as an init-plan node, evaluates once, and reuses.
-- This is documented + recommended by Supabase:
--   https://supabase.com/docs/guides/database/postgres/row-level-security#use-select-for-functions
--
-- Scope: 187 policies across ~50 tables (126 qual-only,
-- 26 check-only, 35 both). Counted via pg_policies pre-migration.
--
-- The DO block iterates pg_policies and runs ALTER POLICY for any
-- policy that still has unwrapped auth.X(). Idempotent — re-running
-- the same migration is a no-op (the WHERE-clause filter excludes
-- already-wrapped policies).
--
-- Safety:
--   • ALTER POLICY changes USING/WITH CHECK in place — no DROP.
--   • The expression semantics are identical (Postgres treats
--     (SELECT auth.uid()) and auth.uid() as the same value);
--     only the planner's caching behavior changes.
--   • If a policy has NULL qual or NULL with_check, we skip that
--     side — the ALTER POLICY syntax requires you only specify
--     what existed (otherwise it errors).
--
-- Verified post-apply: auth_rls_initplan advisor count 150 -> 0,
-- 161 wrapped policies (matches the 187 candidate set minus
-- policies that touch the same expression more than once).
-- ═══════════════════════════════════════════════════════════════

DO $migration$
DECLARE
  pol record;
  new_qual text;
  new_check text;
  needs_qual boolean;
  needs_check boolean;
  alter_sql text;
BEGIN
  FOR pol IN
    SELECT
      schemaname, tablename, policyname,
      qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (qual IS NOT NULL
         AND (position('auth.uid()' in qual) > 0
              OR position('auth.role()' in qual) > 0
              OR position('auth.jwt()' in qual) > 0
              OR position('auth.email()' in qual) > 0)
         AND position('(select auth.' in lower(qual)) = 0)
        OR
        (with_check IS NOT NULL
         AND (position('auth.uid()' in with_check) > 0
              OR position('auth.role()' in with_check) > 0
              OR position('auth.jwt()' in with_check) > 0
              OR position('auth.email()' in with_check) > 0)
         AND position('(select auth.' in lower(with_check)) = 0)
      )
  LOOP
    new_qual := pol.qual;
    new_check := pol.with_check;
    needs_qual := false;
    needs_check := false;

    IF new_qual IS NOT NULL THEN
      IF position('(select auth.' in lower(new_qual)) = 0
         AND (position('auth.uid()' in new_qual) > 0
              OR position('auth.role()' in new_qual) > 0
              OR position('auth.jwt()' in new_qual) > 0
              OR position('auth.email()' in new_qual) > 0) THEN
        new_qual := replace(new_qual, 'auth.uid()',   '(SELECT auth.uid())');
        new_qual := replace(new_qual, 'auth.role()',  '(SELECT auth.role())');
        new_qual := replace(new_qual, 'auth.jwt()',   '(SELECT auth.jwt())');
        new_qual := replace(new_qual, 'auth.email()', '(SELECT auth.email())');
        needs_qual := true;
      END IF;
    END IF;

    IF new_check IS NOT NULL THEN
      IF position('(select auth.' in lower(new_check)) = 0
         AND (position('auth.uid()' in new_check) > 0
              OR position('auth.role()' in new_check) > 0
              OR position('auth.jwt()' in new_check) > 0
              OR position('auth.email()' in new_check) > 0) THEN
        new_check := replace(new_check, 'auth.uid()',   '(SELECT auth.uid())');
        new_check := replace(new_check, 'auth.role()',  '(SELECT auth.role())');
        new_check := replace(new_check, 'auth.jwt()',   '(SELECT auth.jwt())');
        new_check := replace(new_check, 'auth.email()', '(SELECT auth.email())');
        needs_check := true;
      END IF;
    END IF;

    IF needs_qual AND needs_check THEN
      alter_sql := format(
        'ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        new_qual, new_check
      );
    ELSIF needs_qual AND pol.with_check IS NOT NULL THEN
      alter_sql := format(
        'ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        new_qual, pol.with_check
      );
    ELSIF needs_qual THEN
      alter_sql := format(
        'ALTER POLICY %I ON %I.%I USING (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        new_qual
      );
    ELSIF needs_check AND pol.qual IS NOT NULL THEN
      alter_sql := format(
        'ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        pol.qual, new_check
      );
    ELSIF needs_check THEN
      alter_sql := format(
        'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        new_check
      );
    ELSE
      CONTINUE;
    END IF;

    RAISE NOTICE 'Rewriting % on %.% (qual=%, check=%)',
                 pol.policyname, pol.schemaname, pol.tablename,
                 needs_qual, needs_check;
    EXECUTE alter_sql;
  END LOOP;
END $migration$;
