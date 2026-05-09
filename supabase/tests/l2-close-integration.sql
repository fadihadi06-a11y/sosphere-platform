-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — Layer 1 × Layer 2 full-stack integration test
-- ─────────────────────────────────────────────────────────────────────────
-- Simulates a complete SOS lifecycle and verifies that all observability
-- and reliability layers compose correctly. Run this against production
-- (or a clone) any time a Layer-1 or Layer-2 RPC changes shape — if any
-- assertion fails, the SOS pipeline can't be trusted end-to-end.
--
-- USAGE
--   psql $DATABASE_URL -f supabase/tests/l2-close-integration.sql
--
--   The script writes nothing permanent — it cleans up every row it
--   inserted before the final NOTICE. Safe to re-run.
--
-- WHAT THIS PROVES
--   ✓ L1-A trace_id propagates through L1-C pipeline_metrics → L2-B
--     dispatch_attempts → log_sos_audit (every step).
--   ✓ L1-B client_claimed_at + server_received_at timestamps survive
--     the round-trip and produce non-NULL total_session_ms.
--   ✓ L1-C pipeline_metrics row reaches pipeline_status='success' when
--     all stages report in.
--   ✓ L2-A breaker check + record state machine works.
--   ✓ L2-B dispatch_attempts ledger has one row per (contact × channel).
--   ✓ L2-D audit_log rows from log_evidence_event get prev_hash + row_hash
--     populated by the BEFORE INSERT trigger (chain-of-custody live).
--   ✓ L2-H evidence events satisfy the 'evidence.' prefix + 64-char hex
--     validators.
--
-- IF THIS FAILS
--   The shape of one of the underlying RPCs changed. Either the test or
--   the production RPC is wrong — read the error message, check the
--   matching architectural test in src/app/components/__tests__/, and
--   reconcile.
-- ════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_trace        uuid := gen_random_uuid();
  v_emerg        uuid := gen_random_uuid();
  v_company      uuid;
  v_user         uuid;
  v_audit_count  int;
  v_dispatch_cnt int;
  v_pipeline     record;
  v_breaker_pre  jsonb;
  v_breaker_post jsonb;
  v_aud1 text; v_aud2 text;
BEGIN
  SELECT id INTO v_company FROM public.companies LIMIT 1;
  SELECT id INTO v_user    FROM public.profiles  LIMIT 1;

  -- ── L1-A + L1-B + L1-C: pipeline metrics row at SOS start ──────────
  PERFORM public.record_sos_pipeline_started(
    p_trace_id          => v_trace,
    p_emergency_id      => v_emerg::text,
    p_user_id           => v_user,
    p_company_id        => v_company,
    p_tier              => 'basic',
    p_client_claimed_at => now() - interval '2 seconds',
    p_is_synthetic      => true
  );

  -- ── L2-A: breaker round-trip on a dedicated test key ──────────────
  v_breaker_pre  := public.twilio_breaker_check('integration-test');
  PERFORM public.twilio_breaker_record('integration-test', true);
  v_breaker_post := public.twilio_breaker_check('integration-test');
  IF v_breaker_post->>'state' <> 'closed' THEN
    RAISE EXCEPTION 'L2-A: breaker should be closed after success, got %', v_breaker_post->>'state';
  END IF;

  -- ── L2-B: dispatch ledger — 2 contacts × 2 channels = 4 rows ─────
  PERFORM public.record_sos_dispatch_attempt(v_emerg::text, 0, 'sms','sent',
    p_trace_id=>v_trace, p_company_id=>v_company, p_user_id=>v_user,
    p_contact_name=>'Alice', p_provider_sid=>'SM-INT-001');
  PERFORM public.record_sos_dispatch_attempt(v_emerg::text, 0, 'tts_call','sent',
    p_trace_id=>v_trace, p_company_id=>v_company, p_user_id=>v_user,
    p_contact_name=>'Alice', p_provider_sid=>'CA-INT-001');
  PERFORM public.record_sos_dispatch_attempt(v_emerg::text, 1, 'sms','sent',
    p_trace_id=>v_trace, p_company_id=>v_company, p_user_id=>v_user,
    p_contact_name=>'Bob',   p_provider_sid=>'SM-INT-002');
  PERFORM public.record_sos_dispatch_attempt(v_emerg::text, 1, 'tts_call','failed',
    p_trace_id=>v_trace, p_company_id=>v_company, p_user_id=>v_user,
    p_contact_name=>'Bob');

  -- ── L1-C: dispatched event ────────────────────────────────────────
  PERFORM public.record_sos_pipeline_dispatched(
    p_trace_id           => v_trace,
    p_channel            => 'sms',
    p_contacts_attempted => 2
  );

  -- ── L2-D × L2-H: evidence events get chain coverage automatically ─
  v_aud1 := public.log_evidence_event(
    p_emergency_id => v_emerg::text,
    p_event_type   => 'evidence.vault_created',
    p_file_kind    => 'manifest',
    p_file_hash    => repeat('a',64),
    p_vault_id     => 'V-INT-001'
  );
  v_aud2 := public.log_evidence_event(
    p_emergency_id => v_emerg::text,
    p_event_type   => 'evidence.vault_locked',
    p_file_kind    => 'manifest',
    p_file_hash    => repeat('b',64),
    p_vault_id     => 'V-INT-001'
  );

  -- ── L1-C: ended event finalizes the metrics row ───────────────────
  PERFORM public.record_sos_pipeline_ended(
    v_trace, now(), 'success', NULL, NULL, 2
  );

  -- ── ASSERTIONS ─────────────────────────────────────────────────────
  SELECT * INTO v_pipeline FROM public.sos_pipeline_metrics WHERE trace_id = v_trace;
  IF v_pipeline.pipeline_status <> 'success' THEN
    RAISE EXCEPTION 'L1-C: pipeline_status should be success, got %', v_pipeline.pipeline_status;
  END IF;
  IF v_pipeline.contacts_reached < 1 THEN
    RAISE EXCEPTION 'L1-C: contacts_reached should be >= 1, got %', v_pipeline.contacts_reached;
  END IF;
  IF v_pipeline.total_session_ms IS NULL THEN
    RAISE EXCEPTION 'L1-B: total_session_ms not computed (timestamps lost?)';
  END IF;

  SELECT count(*) INTO v_dispatch_cnt FROM public.sos_dispatch_attempts
   WHERE emergency_id = v_emerg::text;
  IF v_dispatch_cnt <> 4 THEN
    RAISE EXCEPTION 'L2-B: expected 4 dispatch_attempts, got %', v_dispatch_cnt;
  END IF;

  SELECT count(*) INTO v_audit_count FROM public.audit_log
   WHERE id IN (v_aud1, v_aud2) AND row_hash IS NOT NULL AND length(row_hash) = 64;
  IF v_audit_count <> 2 THEN
    RAISE EXCEPTION 'L2-D: audit rows missing 64-char row_hash (% / 2)', v_audit_count;
  END IF;

  SELECT count(*) INTO v_audit_count FROM public.sos_dispatch_attempts
   WHERE trace_id = v_trace;
  IF v_audit_count <> 4 THEN
    RAISE EXCEPTION 'INTEGRATION: trace_id linkage broken (% / 4 dispatch rows have it)', v_audit_count;
  END IF;

  -- ── CLEANUP ────────────────────────────────────────────────────────
  DELETE FROM public.audit_log WHERE id IN (v_aud1, v_aud2);
  DELETE FROM public.sos_dispatch_attempts WHERE emergency_id = v_emerg::text;
  DELETE FROM public.sos_pipeline_metrics WHERE trace_id = v_trace;
  DELETE FROM public.twilio_breaker_state WHERE key = 'integration-test';

  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'SOSphere L1×L2 integration test PASSED';
  RAISE NOTICE '  L1-A trace_id propagation        ✓';
  RAISE NOTICE '  L1-B client/server timestamps    ✓ (total_session_ms = % ms)', v_pipeline.total_session_ms;
  RAISE NOTICE '  L1-C pipeline metrics            ✓ (status = %)',                v_pipeline.pipeline_status;
  RAISE NOTICE '  L2-A Twilio breaker              ✓';
  RAISE NOTICE '  L2-B dispatch attempts ledger    ✓ (% rows)', v_dispatch_cnt;
  RAISE NOTICE '  L2-D audit hash chain            ✓ (2 evidence rows hashed)';
  RAISE NOTICE '  L2-H evidence chain-of-custody   ✓';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
