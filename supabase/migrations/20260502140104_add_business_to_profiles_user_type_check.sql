-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260502140104
-- name:     add_business_to_profiles_user_type_check
-- live:     add_business_to_profiles_user_type_check
-- sha256:   d7bd3681779df360 (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- Audit 2026-05-02 (CRITICAL employee onboarding fix):
-- accept_invitation() RPC inserts profiles.user_type = 'business' for any
-- invited employee, but profiles_user_type_check disallowed that value.
-- Result: every single invited employee silently failed onboarding —
-- auth.users created, password set, "Account Activated!" shown, BUT no
-- company_memberships row, no employees row, no profiles row, invitation
-- stayed pending. The RPC error was caught by welcome-activation.tsx as
-- a soft warning and not surfaced to the user.
--
-- Fix: widen the constraint to include 'business' so the RPC's INSERT
-- succeeds. 'business' = a user joined to a company (employee/staff),
-- distinct from 'individual' (civilian app), 'family_*' (family plan),
-- 'company_admin' (owner of a company), 'responder' / 'dispatcher'
-- (specialized B2B roles).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_type_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_type_check
  CHECK (user_type = ANY (ARRAY[
    'individual'::text,
    'family_admin'::text,
    'family_member'::text,
    'company_admin'::text,
    'business'::text,
    'responder'::text,
    'dispatcher'::text
  ]));;
