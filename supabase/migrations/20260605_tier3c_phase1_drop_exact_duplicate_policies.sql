-- ═══════════════════════════════════════════════════════════════
-- 2026-06-05 roots-of-roots Tier 3C Phase 1 — drop exact-duplicate
-- RLS policies
-- ─────────────────────────────────────────────────────────────
-- The Supabase performance advisor flagged 259 instances of
-- `multiple_permissive_policies`: stacked PERMISSIVE policies on
-- the same (table, role, cmd). Each one is evaluated per row, so
-- 5 policies on profiles SELECT = 5 evaluations per row read.
--
-- This phase 1 closes the SAFE subset: policies where the qual
-- expression AND the with_check expression are byte-identical to
-- another policy on the same (table, role, cmd). These are pure
-- naming drift from successive migrations — semantically the
-- same policy with a different name.
--
-- Identified via:
--   GROUP BY tablename, role, cmd, qual, with_check HAVING count > 1
--
-- 6 groups => 7 droppable policies (one per group kept).
-- Zero semantic change — Postgres evaluates the kept policy the
-- exact same way as the dropped ones did. Verified post-apply
-- that `exact_dupes_remaining` is 0.
--
-- Tables affected:
--   profiles            : 3 of 3 SELECT/public + 1 of 2 SELECT/authed
--                         + 1 of 2 UPDATE/authed
--   emergency_recipients: 1 of 2 INSERT, 1 of 2 SELECT, 1 of 2 DELETE
--
-- Phase 2 (a future migration) will tackle semantically-distinct
-- stacking by consolidating expressions with OR — that's higher
-- risk and needs per-table review.
--
-- Idempotent: DROP POLICY IF EXISTS makes re-runs safe.
-- ═══════════════════════════════════════════════════════════════

-- profiles: 3 identical "view own profile" SELECT policies for public
-- Keep: "Users can view own profile" (lexicographically first)
-- Drop: "Users view own profile", "read own profile"
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
DROP POLICY IF EXISTS "read own profile"       ON public.profiles;

-- profiles: 2 identical SELECT/authenticated policies (id = auth.uid())
-- Keep: profiles_read_own (lexicographically first)
-- Drop: profiles_select_own
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;

-- profiles: 2 identical UPDATE/authenticated policies (id = auth.uid())
-- Keep: profiles_update_own (lexicographically first)
-- Drop: profiles_update_own_active_company
DROP POLICY IF EXISTS profiles_update_own_active_company ON public.profiles;

-- emergency_recipients: 3 pairs of identical policies for authenticated
-- Naming drift: "recipients X by owner" vs "recipients_X" — same body.
-- Keep: the "recipients X by owner" variants.
-- Drop: recipients_delete, recipients_insert, recipients_select
DROP POLICY IF EXISTS recipients_delete ON public.emergency_recipients;
DROP POLICY IF EXISTS recipients_insert ON public.emergency_recipients;
DROP POLICY IF EXISTS recipients_select ON public.emergency_recipients;
