-- ═══════════════════════════════════════════════════════════════════════════
-- G-33 (B-20, 2026-04-26): drop admin_stats SECURITY DEFINER view.
-- See AUDIT_DEEP_2026-04-25.md G-33. Zero references in source tree.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.admin_stats;
