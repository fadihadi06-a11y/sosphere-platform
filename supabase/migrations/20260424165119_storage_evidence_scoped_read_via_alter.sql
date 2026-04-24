-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: storage_evidence_scoped_read_via_alter_2026_04_24
-- Version:   20260424165119
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- Storage bucket `evidence` — tighten via ALTER (postgres role can't
-- CREATE/DROP policies on storage.objects, but CAN ALTER existing ones).
-- ─────────────────────────────────────────────────────────────────────────
-- Path patterns:
--   sos/{emergencyId}/recording.ext   (sos-audio-upload.ts)
--   {evidenceId}/photo-N.ext          (evidence-store.ts)
--   {evidenceId}/audio-memo.ext       (evidence-store.ts)
--
-- Scoping:
--   (a) uploader: owner = auth.uid()
--   (b) sos path: caller is company member of the sos_queue company OR
--       owner of the sos_sessions row (civilian)
--   (c) evidence-row path: caller is company member of the evidence row
-- ═══════════════════════════════════════════════════════════════════════════

alter policy "Anyone can view evidence files" on storage.objects
  using (
    bucket_id = 'evidence'
    and (
      -- (a) uploader
      owner = auth.uid()

      or
      -- (b) SOS recording path: sos/{emergencyId}/...
      (
        (storage.foldername(name))[1] = 'sos'
        and (
          exists (
            select 1 from public.sos_queue q
            where q.emergency_id = (storage.foldername(name))[2]
              and public.is_company_member(q.company_id)
          )
          or exists (
            select 1 from public.sos_sessions s
            where s.id::text = (storage.foldername(name))[2]
              and (s.user_id = auth.uid()
                   or (s.company_id is not null and public.is_company_member(s.company_id)))
          )
        )
      )

      or
      -- (c) Evidence-vault path: {evidenceId}/...
      (
        (storage.foldername(name))[1] <> 'sos'
        and exists (
          select 1 from public.evidence ev
          where ev.id = (storage.foldername(name))[1]
            and (ev.company_id is null or public.is_company_member(ev.company_id))
        )
      )
    )
  );

-- Tighten upload policy to also pin owner = auth.uid() so the read
-- policy's owner check is trustworthy.
alter policy "Authenticated users can upload evidence files" on storage.objects
  with check (
    bucket_id = 'evidence'
    and owner = auth.uid()
  );
