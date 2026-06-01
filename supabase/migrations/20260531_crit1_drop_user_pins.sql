-- ═══════════════════════════════════════════════════════════════
-- 2026-05-31 CRIT-1: drop user_pins table (PIN auth was security theater)
-- ─────────────────────────────────────────────────────────────
-- Removed because:
--   1. Same factor type as password (knowledge) per NIST 800-63B —
--      did not add a real second factor, just UX friction.
--   2. Implementation bug: client-side lookup key was
--      `${actorLevel}-${actorName}` (e.g. "main_admin-Ahmed Khalil")
--      but row primary key is auth.uid() UUID — could never match.
--   3. 6-digit entropy (10^6) without server-side cross-session
--      rate limiting; brute force feasible.
--   4. Not actually wired to the critical ops it claimed to gate
--      (revoke_access, suspend_user, billing, owner-transfer).
--
-- Real authorization stack (unchanged):
--   - Supabase Auth + MFA (TOTP via mfa-client.ts)
--   - verify_permission SECDEF RPC (api/server-permission.ts)
--   - RLS policies on every PII table (is_company_member helpers)
--   - audit_log hash chain (log_sos_audit RPC)
--
-- Full rationale + future MFA re-challenge plan in SECURITY_DECISIONS.md.
-- ═══════════════════════════════════════════════════════════════

drop table if exists public.user_pins;

-- Note: the prior migration 20260530_p2_drift_user_pins.sql is kept
-- in git as historical record. This DROP supersedes it. Idempotent —
-- safe to re-run on any environment.
