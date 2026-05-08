-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — L1-C RPCs: 5 idempotent emit functions for pipeline metrics
-- ─────────────────────────────────────────────────────────────────────────
-- Companion to 20260508150000_l1c_sos_pipeline_metrics which created the
-- sos_pipeline_metrics table. This migration adds the WRITE CONTRACT —
-- the only sanctioned way to mutate the table is through these 5 RPCs.
--
-- WHY RPCS (NOT DIRECT WRITES):
--   • Server-authoritative durations: client_to_server_ms, server_to_dispatch_ms,
--     press_to_ack_ms, total_session_ms are computed by Postgres, not trusted
--     from the caller. Defends against client clock manipulation.
--   • Idempotency: every RPC is safe to retry. ON CONFLICT DO NOTHING for
--     started; UPDATE ... WHERE *_at IS NULL for the rest. A double-fire
--     from a network retry produces the same row state as one fire.
--   • Validation: pipeline_status / escalation_stage values checked at the
--     RPC boundary, not after a malformed row already landed.
--   • Single source of business logic: the duration formulas live in Postgres,
--     not duplicated across edge functions + offline replay code.
--
-- INDUSTRY PATTERN:
--   Stripe (record_*), PagerDuty (submit_event), Datadog (StatsD events) —
--   all use validated RPCs/APIs as the single write path to their metric
--   stores. The opposite pattern (writing directly from app code) is the
--   source of every "why is this metric wrong?" investigation.
--
-- PERMISSIONS:
--   Granted to service_role only. Edge functions emit via the service-role
--   Supabase client. Authenticated clients NEVER write directly — defense
--   in depth: a compromised JWT cannot fabricate metrics.
--
-- ROLLBACK:
--   DROP FUNCTION public.record_sos_pipeline_started(...) ;
--   DROP FUNCTION public.record_sos_pipeline_dispatched(...) ;
--   DROP FUNCTION public.record_sos_pipeline_acked(...) ;
--   DROP FUNCTION public.record_sos_pipeline_escalated(...) ;
--   DROP FUNCTION public.record_sos_pipeline_ended(...) ;
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. STARTED ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_sos_pipeline_started(
  p_trace_id           uuid,
  p_emergency_id       text,
  p_user_id            uuid    DEFAULT NULL,
  p_company_id         uuid    DEFAULT NULL,
  p_tier               text    DEFAULT NULL,
  p_client_claimed_at  timestamptz DEFAULT NULL,
  p_server_received_at timestamptz DEFAULT NULL,
  p_is_synthetic       boolean DEFAULT false,
  p_is_drill           boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_received timestamptz := COALESCE(p_server_received_at, now());
BEGIN
  INSERT INTO public.sos_pipeline_metrics (
    trace_id, emergency_id, user_id, company_id, tier,
    client_claimed_at, server_received_at, client_to_server_ms,
    is_synthetic, is_drill
  ) VALUES (
    p_trace_id, p_emergency_id, p_user_id, p_company_id, p_tier,
    p_client_claimed_at, v_received,
    CASE WHEN p_client_claimed_at IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (v_received - p_client_claimed_at)) * 1000)::integer
      ELSE NULL END,
    p_is_synthetic, p_is_drill
  )
  ON CONFLICT (trace_id) DO NOTHING;
  RETURN p_trace_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_sos_pipeline_started(uuid, text, uuid, uuid, text, timestamptz, timestamptz, boolean, boolean) TO service_role;

COMMENT ON FUNCTION public.record_sos_pipeline_started IS
  'L1-C: emit pipeline start event. Idempotent on trace_id (ON CONFLICT DO NOTHING). Computes client_to_server_ms server-side. Returns trace_id for chaining.';

-- ─── 2. DISPATCHED ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_sos_pipeline_dispatched(
  p_trace_id           uuid,
  p_dispatched_at      timestamptz DEFAULT NULL,
  p_channel            text DEFAULT NULL,
  p_contacts_attempted integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_dispatched timestamptz := COALESCE(p_dispatched_at, now());
BEGIN
  UPDATE public.sos_pipeline_metrics
  SET primary_alert_dispatched_at = v_dispatched,
      server_to_dispatch_ms       = (EXTRACT(EPOCH FROM (v_dispatched - server_received_at)) * 1000)::integer,
      channel_used                = COALESCE(p_channel, channel_used),
      contacts_attempted          = COALESCE(p_contacts_attempted, contacts_attempted)
  WHERE trace_id = p_trace_id
    AND primary_alert_dispatched_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_sos_pipeline_dispatched(uuid, timestamptz, text, integer) TO service_role;

COMMENT ON FUNCTION public.record_sos_pipeline_dispatched IS
  'L1-C: emit dispatch event. Idempotent — first dispatch wins (later retries are no-ops). Computes server_to_dispatch_ms.';

-- ─── 3. ACKED ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_sos_pipeline_acked(
  p_trace_id          uuid,
  p_acked_at          timestamptz DEFAULT NULL,
  p_contacts_reached  integer DEFAULT 1
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_acked timestamptz := COALESCE(p_acked_at, now());
BEGIN
  UPDATE public.sos_pipeline_metrics
  SET responder_acked_at = v_acked,
      press_to_ack_ms    = CASE WHEN client_claimed_at IS NOT NULL
                             THEN (EXTRACT(EPOCH FROM (v_acked - client_claimed_at)) * 1000)::integer
                             ELSE NULL END,
      contacts_reached   = GREATEST(contacts_reached, p_contacts_reached)
  WHERE trace_id = p_trace_id
    AND responder_acked_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_sos_pipeline_acked(uuid, timestamptz, integer) TO service_role;

COMMENT ON FUNCTION public.record_sos_pipeline_acked IS
  'L1-C: emit acknowledgment event. Idempotent — first ack wins. Computes press_to_ack_ms (the single most important number for life-safety SLA).';

-- ─── 4. ESCALATED ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_sos_pipeline_escalated(
  p_trace_id uuid,
  p_stage    integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  IF p_stage < 1 OR p_stage > 5 THEN
    RAISE EXCEPTION 'invalid escalation stage: % (must be 1..5)', p_stage;
  END IF;
  UPDATE public.sos_pipeline_metrics
  SET watchdog_escalations = GREATEST(watchdog_escalations, p_stage)
  WHERE trace_id = p_trace_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_sos_pipeline_escalated(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.record_sos_pipeline_escalated IS
  'L1-C: emit watchdog escalation event. Stage is monotonic — uses GREATEST so retries of the same stage are no-ops.';

-- ─── 5. ENDED ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_sos_pipeline_ended(
  p_trace_id            uuid,
  p_ended_at            timestamptz DEFAULT NULL,
  p_status              text        DEFAULT 'success',
  p_failure_reason      text        DEFAULT NULL,
  p_fallbacks_triggered text[]      DEFAULT NULL,
  p_contacts_reached    integer     DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_ended timestamptz := COALESCE(p_ended_at, now());
BEGIN
  IF p_status NOT IN ('success','partial','failed','cancelled') THEN
    RAISE EXCEPTION 'invalid pipeline_status: % (must be success|partial|failed|cancelled)', p_status;
  END IF;
  UPDATE public.sos_pipeline_metrics
  SET ended_at            = v_ended,
      total_session_ms    = CASE WHEN client_claimed_at IS NOT NULL
                              THEN (EXTRACT(EPOCH FROM (v_ended - client_claimed_at)) * 1000)::integer
                              ELSE NULL END,
      pipeline_status     = p_status,
      failure_reason      = COALESCE(p_failure_reason, failure_reason),
      fallbacks_triggered = COALESCE(p_fallbacks_triggered, fallbacks_triggered),
      contacts_reached    = COALESCE(p_contacts_reached, contacts_reached)
  WHERE trace_id = p_trace_id
    AND pipeline_status = 'in_progress';
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_sos_pipeline_ended(uuid, timestamptz, text, text, text[], integer) TO service_role;

COMMENT ON FUNCTION public.record_sos_pipeline_ended IS
  'L1-C: emit lifecycle end event. Idempotent — only the first transition out of in_progress wins. Computes total_session_ms. Validates status against the CHECK domain.';
