-- ═══════════════════════════════════════════════════════════════
-- Beehive Audit #4 — pre-launch hardening (2026-04-29)
-- ─────────────────────────────────────────────────────────────
-- This migration lands in 3 logical waves matching the order in
-- which we discovered the issue surface. They're applied in one
-- transaction.
--
-- Wave 1 — REVOKE FROM anon (4 functions where anon had an explicit
--          grant). Affects:
--            • cancel_civilian_trial
--            • create_company
--            • request_sar_export
--            • start_civilian_trial
--
-- Wave 2 — REVOKE FROM PUBLIC + re-GRANT to authenticated
--          (6 functions where anon inherited EXECUTE through PUBLIC,
--          which the FROM anon REVOKE in Wave 1 cannot reach).
--          Affects:
--            • accept_company_invite (×2 overloads)
--            • add_company_member    (×2 overloads)
--            • set_active_company
--            • transfer_ownership
--
-- Wave 3 — search_path lockdown on contains_xss_pattern (advisory
--          warning #11 from Supabase database linter).
--
-- Why both waves are needed: Postgres `has_function_privilege(role, fn,
-- 'EXECUTE')` returns true if the role has the privilege EITHER
-- directly OR through PUBLIC. So REVOKE FROM anon only removes the
-- explicit-anon entry; if PUBLIC has EXECUTE, anon still passes the
-- check. We have to REVOKE FROM PUBLIC to truly lock down access.
--
-- Why re-GRANT TO authenticated: when we drop the PUBLIC grant, we
-- also drop authenticated's inherited access. Re-granting explicitly
-- preserves the legit auth flow.
--
-- All revokes are safe because every legit call site is authenticated:
--   • start_civilian_trial      → trial-service.ts after sign-in
--   • cancel_civilian_trial     → settings page after sign-in
--   • request_sar_export        → privacy page after sign-in
--   • create_company            → company-register after sign-in
--   • set_active_company        → tenant-switcher after sign-in
--   • add_company_member (×2)   → invite-employees flow after sign-in
--   • accept_company_invite (×2)→ /accept-invite after sign-in
--   • transfer_ownership        → admin settings after sign-in
-- ═══════════════════════════════════════════════════════════════

-- ── Wave 1: explicit-anon revokes ──────────────────────────────
REVOKE EXECUTE ON FUNCTION public.cancel_civilian_trial()                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_company(text)                     FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_sar_export(integer)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.start_civilian_trial(text, integer)      FROM anon;

-- ── Wave 2: PUBLIC revoke + authenticated re-grant ─────────────
REVOKE EXECUTE ON FUNCTION public.accept_company_invite(uuid)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_company_invite(text)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_company_member(uuid, uuid, text)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_company_member(uuid, text, text)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_active_company(uuid)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transfer_ownership(uuid, uuid)           FROM PUBLIC;

GRANT  EXECUTE ON FUNCTION public.accept_company_invite(uuid)              TO authenticated;
GRANT  EXECUTE ON FUNCTION public.accept_company_invite(text)              TO authenticated;
GRANT  EXECUTE ON FUNCTION public.add_company_member(uuid, uuid, text)     TO authenticated;
GRANT  EXECUTE ON FUNCTION public.add_company_member(uuid, text, text)     TO authenticated;
GRANT  EXECUTE ON FUNCTION public.set_active_company(uuid)                 TO authenticated;
GRANT  EXECUTE ON FUNCTION public.transfer_ownership(uuid, uuid)           TO authenticated;

-- ── Wave 3: search_path lockdown ───────────────────────────────
ALTER FUNCTION public.contains_xss_pattern(text) SET search_path = '';

-- ═══════════════════════════════════════════════════════════════
-- Note: `promote_user_to_admin`, `set_admin_pin`, `verify_admin_pin`
-- were already locked from anon (per W3-D15/A15 work earlier in
-- the audit cycle). They are intentionally left alone here.
-- ═══════════════════════════════════════════════════════════════
