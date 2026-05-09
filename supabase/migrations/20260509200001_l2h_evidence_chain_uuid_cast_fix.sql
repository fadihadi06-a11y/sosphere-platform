-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — L2-H fix-up: cast text emergency_id to uuid before lookup
-- ────────────────────────────────────────────────────────────────────────
-- BUG DISCOVERED IN SMOKE TEST
--   sos_sessions.id is uuid; the L2-H RPC takes p_emergency_id as text
--   (per existing convention with log_sos_audit and friends — some
--   callers pass 'EMG-XXX' format ids that aren't valid uuids). The
--   original migration did `WHERE id = p_emergency_id` which failed at
--   runtime with "operator does not exist: uuid = text".
--
-- FIX
--   Cast p_emergency_id::uuid inside a BEGIN/EXCEPTION block. If the
--   caller passed a non-uuid (legacy 'EMG-XXX'), the cast silently
--   fails and we proceed with NULL company_id + NULL actor — the
--   audit row still goes in, just without resolved tenant context.
--   That's strictly better than the previous "throw and lose the
--   evidence event entirely".
--
-- WHY A FIX-UP MIGRATION INSTEAD OF EDITING THE PREVIOUS FILE
--   Same forward-only pattern as the L2-D chain_seq fix: editing the
--   committed migration file would diverge git-truth from prod-truth
--   and the migration drift CI guard would fail.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_evidence_event(
  p_emergency_id  text,
  p_event_type    text,
  p_file_kind     text DEFAULT NULL,
  p_file_hash     text DEFAULT NULL,
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
  v_emerg_uuid    uuid;
  v_session       record;
  v_metadata      jsonb;
BEGIN
  IF p_event_type IS NULL OR NOT p_event_type LIKE 'evidence.%' THEN
    RAISE EXCEPTION 'log_evidence_event: p_event_type must start with evidence.';
  END IF;

  IF p_file_hash IS NOT NULL
     AND (length(p_file_hash) <> 64 OR p_file_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'log_evidence_event: p_file_hash must be 64-char lowercase SHA-256 hex';
  END IF;

  -- sos_sessions.id is uuid. If p_emergency_id is non-uuid (legacy
  -- 'EMG-XXX' format), the cast fails and we proceed with NULLs for
  -- company/user. The audit row still goes in (just less context).
  BEGIN
    v_emerg_uuid := p_emergency_id::uuid;
    SELECT user_id, company_id INTO v_session
      FROM public.sos_sessions WHERE id = v_emerg_uuid LIMIT 1;
    IF FOUND THEN
      v_actor_uuid := v_session.user_id;
      v_company_id := v_session.company_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- non-uuid emergency_id; leave actor/company as NULL
  END;

  v_actor_text := COALESCE(v_actor_uuid::text, 'system');

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

REVOKE EXECUTE ON FUNCTION public.log_evidence_event(text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_evidence_event(text, text, text, text, text, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.log_evidence_event(text, text, text, text, text, jsonb) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.log_evidence_event(text, text, text, text, text, jsonb) TO service_role;
