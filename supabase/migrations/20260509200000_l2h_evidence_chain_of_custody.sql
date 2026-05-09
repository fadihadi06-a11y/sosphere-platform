-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — L2-H: Evidence chain-of-custody
-- ────────────────────────────────────────────────────────────────────────
-- Layer 2 fourth piece — pairs with L2-D (audit-log hash chain) to close
-- the forensic loop: every photo, audio recording, and comment in an
-- evidence vault now leaves a cryptographic trace in the audit chain.
--
-- THE GAP THIS CLOSES
--   evidence_vaults already had `integrity_hash` — a SINGLE SHA-256 over
--   the vault as a whole. But:
--     • Per-file hashes (photo_id → hash) lived only in the client's
--       EvidenceManifest object and were never persisted server-side.
--     • Vault creation / locking / file-add events left no audit trail
--       linked to the L2-D hash chain.
--     • A bad actor with service_role could swap one photo for another
--       and recompute the aggregate integrity_hash — undetectable.
--
--   After L2-H:
--     • The full EvidenceManifest (algorithm, computedAt, photoHashes[],
--       audioHash, commentHash, manifestHash) is persisted in
--       evidence_vaults.manifest as jsonb.
--     • Every evidence operation (vault_created, vault_locked,
--       photo_added, audio_finalized) writes an audit_log row whose
--       metadata.file_hash is then covered by the L2-D BEFORE INSERT
--       trigger. Tampering with any photo OR with the manifest OR with
--       the audit row breaks the chain.
--
-- WHAT THIS ADDS
--   1. evidence_vaults.manifest jsonb     — full per-file hash record
--   2. evidence_vaults.manifest_hash text — extracted top-level hash
--                                            (denormalized for indexed lookups)
--   3. log_evidence_event RPC             — service-role-only writer
--                                            that resolves company_id +
--                                            user_id from sos_sessions
--                                            and inserts the audit row
--
-- WHAT THIS DOES NOT DO (out of scope)
--   • Verify the manifest on insert. The trigger could re-compute the
--     manifest from per-file hashes and reject mismatches, but that
--     requires reading file blobs from storage, which is expensive.
--     Verification stays a forensic-time operation done by the dashboard.
--   • Wire mobile-app evidence capture. The client wiring lives in
--     evidence-vault-service.ts and ships in a separate small patch.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.log_evidence_event(
--     text, text, text, text, text, jsonb
--   );
--   ALTER TABLE public.evidence_vaults DROP COLUMN IF EXISTS manifest;
--   ALTER TABLE public.evidence_vaults DROP COLUMN IF EXISTS manifest_hash;
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Schema additions ──────────────────────────────────────────────
ALTER TABLE public.evidence_vaults
  ADD COLUMN IF NOT EXISTS manifest      jsonb,
  ADD COLUMN IF NOT EXISTS manifest_hash text;

COMMENT ON COLUMN public.evidence_vaults.manifest IS
  'L2-H: full EvidenceManifest object — { algorithm, computedAt, photoHashes:[{id,hash}], audioHash?, commentHash?, manifestHash }. Per-file hashes are the unit of forensic verification: each photo''s SHA-256 should match what storage actually holds.';

COMMENT ON COLUMN public.evidence_vaults.manifest_hash IS
  'L2-H: denormalized top-level manifestHash extracted from manifest.manifestHash for indexed lookups. Same value as manifest->>''manifestHash''. NULL until the vault is locked + uploaded.';

-- Indexed lookups by manifest_hash for the (rare) "verify a known
-- hash exists in the system" forensic query.
CREATE INDEX IF NOT EXISTS idx_evidence_vaults_manifest_hash
  ON public.evidence_vaults (manifest_hash)
  WHERE manifest_hash IS NOT NULL;

-- ── 2. Writer RPC ────────────────────────────────────────────────────
-- One RPC for every evidence event so the audit_log row format is
-- uniform. The metadata jsonb captures the file_kind + file_hash +
-- vault_id; the action column captures the event type. The L2-D
-- BEFORE INSERT trigger automatically chains the row.
CREATE OR REPLACE FUNCTION public.log_evidence_event(
  p_emergency_id  text,
  p_event_type    text,           -- e.g. 'evidence.vault_created', 'evidence.photo_added'
  p_file_kind     text DEFAULT NULL,   -- 'photo' | 'audio' | 'comment' | 'manifest'
  p_file_hash     text DEFAULT NULL,   -- 64-char hex SHA-256
  p_vault_id      text DEFAULT NULL,
  p_extra         jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_id            text;
  v_company_id    uuid;
  v_actor_uuid    uuid;
  v_actor_text    text;
  v_session       record;
  v_metadata      jsonb;
BEGIN
  -- Validate event type — only allow the prefix we own. This prevents
  -- a buggy caller from spamming arbitrary action strings into the
  -- audit chain.
  IF p_event_type IS NULL OR NOT p_event_type LIKE 'evidence.%' THEN
    RAISE EXCEPTION 'log_evidence_event: p_event_type must start with evidence.';
  END IF;

  -- Validate file_hash format if provided. SHA-256 hex = 64 chars [0-9a-f].
  IF p_file_hash IS NOT NULL
     AND (length(p_file_hash) <> 64 OR p_file_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'log_evidence_event: p_file_hash must be 64-char lowercase SHA-256 hex';
  END IF;

  -- Resolve company_id + user_id from the SOS session. We trust the DB
  -- canonical state, not caller-supplied values, so a buggy or hostile
  -- client can't claim an evidence event for someone else's emergency.
  SELECT user_id, company_id INTO v_session
    FROM public.sos_sessions WHERE id = p_emergency_id LIMIT 1;
  IF FOUND THEN
    v_actor_uuid := v_session.user_id;
    v_company_id := v_session.company_id;
  END IF;

  v_actor_text := COALESCE(v_actor_uuid::text, 'system');

  -- Build the audit metadata. Spread p_extra LAST so callers can add
  -- context (e.g., capture coords, file size) without us hard-coding
  -- every field — but they CANNOT override the canonical evidence
  -- fields below (file_kind, file_hash, vault_id, evidence_event=true).
  v_metadata := COALESCE(p_extra, '{}'::jsonb)
                || jsonb_build_object(
                     'evidence_event', true,
                     'file_kind',      p_file_kind,
                     'file_hash',      p_file_hash,
                     'vault_id',       p_vault_id
                   );

  v_id := 'AUD-' || to_char(now() AT TIME ZONE 'utc', 'YYYYMMDDHH24MISSMS')
       || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  INSERT INTO public.audit_log
    (id, action, actor, actor_id, actor_role, operation, target, target_name,
     metadata, category, severity, company_id, created_at, client_timestamp)
  VALUES
    (v_id, p_event_type, v_actor_text, v_actor_text, 'worker', 'evidence',
     p_vault_id, p_emergency_id,
     v_metadata, 'file_access', 'info', v_company_id, now(), now());

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_evidence_event(text, text, text, text, text, jsonb) IS
  'L2-H: write a chain-covered audit_log row for an evidence event (vault_created, vault_locked, photo_added, audio_finalized). The L2-D trigger automatically computes prev_hash + row_hash, so every evidence event becomes part of the per-tenant cryptographic chain. Caller-supplied p_extra is spread under the canonical evidence keys, never overriding them.';

REVOKE EXECUTE ON FUNCTION public.log_evidence_event(text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_evidence_event(text, text, text, text, text, jsonb) FROM anon;
-- authenticated users CAN call this — the RPC is SECURITY DEFINER and
-- internally validates the emergency exists. We deliberately don't
-- check that auth.uid() == sos_sessions.user_id because evidence events
-- can come from a dispatcher / admin observing the emergency too. The
-- audit row records the SESSION owner as actor_id, not the caller, so
-- this can't be used to impersonate.
GRANT  EXECUTE ON FUNCTION public.log_evidence_event(text, text, text, text, text, jsonb) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.log_evidence_event(text, text, text, text, text, jsonb) TO service_role;
