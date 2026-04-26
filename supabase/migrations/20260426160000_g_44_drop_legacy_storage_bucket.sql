-- ═══════════════════════════════════════════════════════════════════════════
-- G-44 (B-20, 2026-04-26): legacy `super_admin_dashboard.html` storage bucket.
-- See AUDIT_DEEP_2026-04-25.md G-44.
--
-- Investigation:
--   - bucket created 2026-02-23, public=false
--   - contains only Supabase's `.emptyFolderPlaceholder` (0 bytes)
--   - zero references across src/ and supabase/
--   - name is a literal HTML filename → clearly a UI typo at creation time
--
-- Direct DELETE against storage.objects / storage.buckets is blocked by
-- Supabase's `storage.protect_delete()` trigger ("Use the Storage API
-- instead. This prevents accidental data loss from orphaned objects.").
--
-- ACTION REQUIRED — owner deletes via Supabase Dashboard:
--   Storage → super_admin_dashboard.html → ⋮ → "Delete bucket"
--
-- This migration is documentation-only — it records the disposition
-- so future auditors know the bucket was reviewed and confirmed empty.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'super_admin_dashboard.html') THEN
    RAISE NOTICE 'G-44: legacy bucket super_admin_dashboard.html still exists. '
                 'Confirmed empty (only .emptyFolderPlaceholder). '
                 'Owner should delete via Supabase Dashboard → Storage.';
  ELSE
    RAISE NOTICE 'G-44: legacy bucket super_admin_dashboard.html already removed.';
  END IF;
END $$;
