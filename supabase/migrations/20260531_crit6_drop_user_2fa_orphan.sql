-- ═══════════════════════════════════════════════════════════════
-- 2026-05-31 CRIT-6: drop orphan totp-engine plumbing
-- ─────────────────────────────────────────────────────────────
-- Removed because:
--   1. ZERO importers — grep showed no src/ file imported
--      totp-engine.ts; no edge function or RPC caller existed.
--   2. The live MFA flow uses Supabase native auth.mfa.* (via
--      api/mfa-client.ts → MFAEnrollmentModal/MFAChallengeModal).
--      Two parallel 2FA systems coexisted with only one wired up.
--   3. Security audit confusion — auditors would have to verify
--      both systems even though only one was reachable.
--
-- The plumbing being dropped (all created in P2-Followup A + C):
--   - save_totp_secret(text) RPC
--   - verify_user_2fa(text) RPC (RFC 6238 server-side HMAC)
--   - get_totp_secret_for_verify() RPC
--   - _base32_decode(text) helper
--   - public.user_2fa table (encrypted secrets)
--   - public._app_secrets row keyed 'totp_master_key'
--
-- Migration history preserved: 20260530_p2_followup_encrypt_totp_secret.sql
-- and 20260530_p2_followup_c_server_side_totp_verify.sql stay in git
-- as the historical record of the build-then-deprecate cycle.
--
-- See SECURITY_DECISIONS.md (entry: "Marked Custom TOTP Engine as
-- Dead Code (CRIT-6)" — now updated to "Removed").
-- ═══════════════════════════════════════════════════════════════

-- Drop in dependency order. All idempotent — safe to re-run.
drop function if exists public.save_totp_secret(text);
drop function if exists public.verify_user_2fa(text);
drop function if exists public.get_totp_secret_for_verify();
drop function if exists public._base32_decode(text);

drop table if exists public.user_2fa;

delete from public._app_secrets where key_name = 'totp_master_key';

-- _app_secrets table itself is retained — could be useful for future
-- server-side secrets. Drop separately if a future audit confirms
-- it's also unused.
