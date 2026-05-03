-- ═══════════════════════════════════════════════════════════════
-- BACKFILLED FROM LIVE SUPABASE — DO NOT EDIT WITHOUT REGENERATING
-- ═══════════════════════════════════════════════════════════════
-- version:  20260501190929
-- name:     push_tokens_allow_web_subtypes
-- live:     push_tokens_allow_web_subtypes
-- sha256:   7c74bac1b9607ae9 (first 16 hex of body sha256 — drift detector key)
-- pulled:   2026-05-03 (L0.5 foundation backfill, task #182)
-- source:   supabase_migrations.schema_migrations.statements
--
-- This migration was applied directly to the live DB via apply_migration
-- MCP without being committed to git. L0.5 backfilled it so a fresh
-- clone of git can rebuild the schema deterministically.
-- ═══════════════════════════════════════════════════════════════

-- Audit 2026-05-01: push_tokens 400 root cause #1
--
-- The existing CHECK constraint only allowed:
--   platform IN ('android', 'ios', 'web')
--
-- But fcm-push.ts detectPlatform() returns more granular values
-- ('desktop-web', 'mobile-web') for analytics + per-platform push
-- service routing. The DB rejected those with 400 Bad Request, so
-- NO web push subscription was ever persisted, which silently
-- broke the entire owner SOS push fan-out (Blocker B v50).
--
-- Fix: widen the constraint to accept the granular web subtypes
-- alongside the original three. No data loss — existing rows still
-- match (none would have been written anyway because the constraint
-- rejected them all on web).

ALTER TABLE public.push_tokens DROP CONSTRAINT IF EXISTS push_tokens_platform_check;

ALTER TABLE public.push_tokens
  ADD CONSTRAINT push_tokens_platform_check
  CHECK (platform = ANY (ARRAY[
    'android'::text,
    'ios'::text,
    'web'::text,         -- generic web (legacy / unspecified)
    'desktop-web'::text, -- detected via UA: not android/ios/mobile
    'mobile-web'::text   -- detected via UA: mobile but not native
  ]));

COMMENT ON CONSTRAINT push_tokens_platform_check ON public.push_tokens
  IS 'Platform tag for push token analytics + provider routing. Audit 2026-05-01: widened to include web subtypes that fcm-push.ts detectPlatform() returns.';
;
