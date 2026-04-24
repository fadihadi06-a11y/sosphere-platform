-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: rls_phase3a_cleanup_stale_invitations_policies_2026_04_24
-- Version:   20260424164114
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- Drop the old policies that (a) query auth.users directly (breaks anon
-- role) and (b) depend on custom JWT claim `company_id` which isn't set.
-- My new `invitations_owner_read` / `invitations_owner_write` cover the
-- legitimate cases; invitee-by-email lookups should be done via a
-- SECURITY DEFINER RPC if needed later.
drop policy if exists invitations_select      on public.invitations;
drop policy if exists invitations_write       on public.invitations;
drop policy if exists invitations_own_company on public.invitations;
