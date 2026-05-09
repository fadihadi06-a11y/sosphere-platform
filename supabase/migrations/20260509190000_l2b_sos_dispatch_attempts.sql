-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — L2-B: Per-channel SOS dispatch attempts ledger (S-03)
-- ────────────────────────────────────────────────────────────────────────
-- Layer 2 third piece (after L2-D hash chain + L2-A circuit breaker).
--
-- WHY THIS EXISTS
--   sos_pipeline_metrics tells us:
--     • how many contacts we ATTEMPTED  (contacts_attempted)
--     • how many ACKED                  (contacts_reached — pressed 1 in IVR)
--   It does NOT tell us:
--     • which CHANNELS were tried for each contact
--     • whether any channel actually delivered
--     • whether the Twilio breaker short-circuited a leg
--     • per-leg latency or provider error code
--
--   That gap matters because the foundation contract is "every alert
--   tier must reach the responder via at least one channel" — and we
--   currently can't answer "did the SOS reach anyone via ANY channel?"
--   without scraping logs.
--
-- WHAT THIS ADDS
--   sos_dispatch_attempts: append-only ledger, one row per
--   (emergency × contact × channel) attempt. Written from:
--     • supabase/functions/sos-alert/index.ts after each fanout leg
--     • twilio-call & twilio-sms when the breaker short-circuits
--     • twilio-status when callbacks update final delivery state
--
-- WHAT THIS DOES NOT DO (out of scope for L2-B)
--   • Synthetic probe channel-failure simulation. That's a follow-up
--     test extension — needs a way to mock per-channel outage in the
--     probe. For L2-B we ship the LEDGER + RPCs so anomalies are at
--     least visible.
--   • Dashboard visualization. The L1-E health dashboard can
--     consume get_sos_delivery_summary in a follow-up patch.
--   • Auto-retry orchestration. If push fails, the system continues
--     to send SMS+Voice in parallel — the failover is implicit, not
--     orchestrated. Adding explicit retry loops is a separate effort.
--
-- THREAT MODEL / FORENSIC PROPERTY
--   Each row is APPEND-ONLY (no UPDATE policy granted to anyone except
--   service_role for the status-callback final-state writeback). Pairs
--   with L2-D so audit_log entries reference the dispatch_attempt id
--   for full chain-of-custody from press-to-delivery.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.get_sos_delivery_summary(text);
--   DROP FUNCTION IF EXISTS public.record_sos_dispatch_attempt(...);
--   DROP TABLE     IF EXISTS public.sos_dispatch_attempts;
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sos_dispatch_attempts (
  -- Identity
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id    text        NOT NULL,
  trace_id        uuid,
  company_id      uuid,
  user_id         uuid,        -- caller of the SOS (denormalized for fast tenant scoping)

  -- Per-contact identity (fanout index lets us correlate with sos_sessions.contacts JSON)
  contact_index   integer     NOT NULL,
  contact_name    text,
  contact_phone   text,        -- E.164, redact-friendly

  -- Channel attempt
  channel         text        NOT NULL
                              CHECK (channel IN ('push','sms','tts_call','bridge_call','conference','voice','email')),
  outcome         text        NOT NULL
                              CHECK (outcome IN ('sent','failed','breaker_open','invalid','timeout','skipped','delivered','undelivered')),
  -- 'sent'        = upstream accepted (Twilio queued / FCM accepted)
  -- 'delivered'   = final-state confirmation (twilio-status callback)
  -- 'undelivered' = Twilio gave up after retries
  -- 'failed'      = upstream returned non-2xx
  -- 'breaker_open'= L2-A short-circuit, never reached upstream
  -- 'invalid'     = phone format / disabled push token / etc.
  -- 'timeout'     = the 20s race timer fired before the upstream replied
  -- 'skipped'     = tier doesn't support this channel (e.g. Free + tts_call)

  -- Provider correlation
  provider_sid    text,        -- Twilio MessageSid / CallSid / FCM messageId
  provider_code   text,        -- Twilio error code / FCM error reason

  -- Breaker context — captures whether the breaker was open when we
  -- attempted, so a failure-clustered SOS can be traced to a known outage.
  breaker_state   text         CHECK (breaker_state IS NULL OR breaker_state IN ('closed','open','half_open')),

  -- Timing
  attempted_at    timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,    -- set when twilio-status callback arrives
  duration_ms     integer,        -- attempted_at → completed_at (denorm)

  -- Bookkeeping
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sos_dispatch_attempts IS
  'L2-B: append-only ledger of every per-contact, per-channel dispatch attempt for an SOS. Writes from sos-alert fanout, twilio-call/sms (breaker short-circuits), and twilio-status (final-state callbacks). Source of truth for "did the SOS reach any contact via any channel?".';

-- ── Indexes — the queries the dashboard / forensic tooling will run ──
CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_emergency
  ON public.sos_dispatch_attempts (emergency_id, attempted_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_trace
  ON public.sos_dispatch_attempts (trace_id, attempted_at)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_company_attempted
  ON public.sos_dispatch_attempts (company_id, attempted_at DESC)
  WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_failure
  ON public.sos_dispatch_attempts (attempted_at DESC)
  WHERE outcome IN ('failed','breaker_open','timeout','undelivered');

-- ── RLS: service_role writes; tenant admins read scoped to their company ──
ALTER TABLE public.sos_dispatch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sos_dispatch_attempts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispatch_attempts_company_admin_read ON public.sos_dispatch_attempts;
CREATE POLICY dispatch_attempts_company_admin_read
  ON public.sos_dispatch_attempts
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.company_memberships cm
      WHERE cm.company_id = sos_dispatch_attempts.company_id
        AND cm.user_id    = auth.uid()
        AND cm.active     = true
        AND cm.role IN ('admin','owner')
    )
  );

-- A user can read their own SOS attempts (for the "did my SOS go through?"
-- self-confirmation flow on civilian / employee surfaces).
DROP POLICY IF EXISTS dispatch_attempts_self_read ON public.sos_dispatch_attempts;
CREATE POLICY dispatch_attempts_self_read
  ON public.sos_dispatch_attempts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT / UPDATE / DELETE policies — only service_role writes. Same
-- pattern as audit_log. The RPCs below are SECURITY DEFINER and act as
-- the controlled gateway.

GRANT SELECT ON public.sos_dispatch_attempts TO authenticated;
GRANT ALL    ON public.sos_dispatch_attempts TO service_role;

-- ── 1. Insert RPC (called by sos-alert fanout + edge functions) ───────
CREATE OR REPLACE FUNCTION public.record_sos_dispatch_attempt(
  p_emergency_id  text,
  p_contact_index integer,
  p_channel       text,
  p_outcome       text,
  p_trace_id      uuid    DEFAULT NULL,
  p_company_id    uuid    DEFAULT NULL,
  p_user_id       uuid    DEFAULT NULL,
  p_contact_name  text    DEFAULT NULL,
  p_contact_phone text    DEFAULT NULL,
  p_provider_sid  text    DEFAULT NULL,
  p_provider_code text    DEFAULT NULL,
  p_breaker_state text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.sos_dispatch_attempts (
    emergency_id, trace_id, company_id, user_id,
    contact_index, contact_name, contact_phone,
    channel, outcome, provider_sid, provider_code, breaker_state
  ) VALUES (
    p_emergency_id, p_trace_id, p_company_id, p_user_id,
    p_contact_index, p_contact_name, p_contact_phone,
    p_channel, p_outcome, p_provider_sid, p_provider_code, p_breaker_state
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_sos_dispatch_attempt(
  text, integer, text, text, uuid, uuid, uuid, text, text, text, text, text
) IS
  'L2-B: insert a per-channel dispatch-attempt row. Called by sos-alert (fanout results), twilio-call/sms (breaker short-circuits). Returns the row id so twilio-status can later update completed_at when the final delivery callback arrives.';

REVOKE EXECUTE ON FUNCTION public.record_sos_dispatch_attempt(
  text, integer, text, text, uuid, uuid, uuid, text, text, text, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_sos_dispatch_attempt(
  text, integer, text, text, uuid, uuid, uuid, text, text, text, text, text
) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_sos_dispatch_attempt(
  text, integer, text, text, uuid, uuid, uuid, text, text, text, text, text
) TO service_role;

-- ── 2. Final-state update RPC (twilio-status writeback) ───────────────
-- twilio-status posts back StatusCallback events: queued → sending →
-- sent → delivered → undelivered. This RPC updates the matching row's
-- outcome + completed_at + duration_ms in one atomic step.
CREATE OR REPLACE FUNCTION public.update_sos_dispatch_attempt_outcome(
  p_provider_sid  text,
  p_outcome       text,
  p_provider_code text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_provider_sid IS NULL OR length(p_provider_sid) = 0 THEN
    RETURN 0;
  END IF;
  UPDATE public.sos_dispatch_attempts
     SET outcome       = p_outcome,
         provider_code = COALESCE(p_provider_code, provider_code),
         completed_at  = now(),
         duration_ms   = GREATEST(0, EXTRACT(EPOCH FROM (now() - attempted_at))::int * 1000)
   WHERE provider_sid = p_provider_sid
     AND completed_at IS NULL;          -- idempotent — only update once
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.update_sos_dispatch_attempt_outcome(text, text, text) IS
  'L2-B: idempotent final-state update from Twilio StatusCallback. Looks up the attempt by provider_sid, sets outcome + completed_at + duration_ms. Returns the number of rows updated (0 = unknown sid, 1 = matched, idempotent).';

REVOKE EXECUTE ON FUNCTION public.update_sos_dispatch_attempt_outcome(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_sos_dispatch_attempt_outcome(text, text, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.update_sos_dispatch_attempt_outcome(text, text, text) TO service_role;

-- ── 3. Read-side aggregate: "did the SOS reach anyone?" ───────────────
-- Returns:
--   {
--     emergency_id: "EMG-...",
--     reached_any: true,                      -- at least one contact had at least one successful channel
--     all_contacts_reached: false,            -- every contact had at least one successful channel
--     total_contacts: 3,
--     reached_contacts: 2,
--     contacts: [
--       { contact_index, contact_name, channels_attempted: [...], channels_succeeded: [...], reached: bool }, ...
--     ],
--     fetched_at: now()
--   }
--
-- Auth model: caller must be (a) the SOS owner OR (b) admin/owner of
-- the company that owns this emergency. Same shape as
-- sos_dispatch_attempts RLS, but expressed once in the RPC for clean
-- error messages.
CREATE OR REPLACE FUNCTION public.get_sos_delivery_summary(p_emergency_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
STABLE
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_session      record;
  v_authorized   boolean := false;
  v_total        int := 0;
  v_reached      int := 0;
  v_reached_any  boolean := false;
  v_contacts     jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized: must be logged in';
  END IF;

  -- Resolve the SOS owner + company so we can scope the auth check.
  -- We don't trust the caller-supplied emergency_id beyond using it as a
  -- key — any membership/ownership check goes through DB-canonical state.
  SELECT user_id, company_id INTO v_session
    FROM public.sos_sessions
   WHERE id = p_emergency_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: emergency does not exist';
  END IF;

  -- Auth: caller is the owner of the SOS, or an active admin/owner of
  -- the company that owns it.
  IF v_session.user_id = v_caller THEN
    v_authorized := true;
  ELSIF v_session.company_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_memberships
    WHERE user_id = v_caller
      AND company_id = v_session.company_id
      AND active = true
      AND role IN ('admin','owner')
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'unauthorized: caller is neither the SOS owner nor an admin/owner of the company';
  END IF;

  -- Per-contact aggregation: roll up all rows for this emergency by
  -- contact_index, distinguishing channels attempted from channels
  -- succeeded. 'sent' / 'delivered' count as success; everything else
  -- (failed, breaker_open, invalid, timeout, undelivered, skipped)
  -- counts as attempted-only.
  WITH per_contact AS (
    SELECT
      contact_index,
      max(contact_name)  AS contact_name,
      array_agg(DISTINCT channel)                                                          AS channels_attempted,
      array_agg(DISTINCT channel) FILTER (WHERE outcome IN ('sent','delivered'))           AS channels_succeeded,
      bool_or(outcome IN ('sent','delivered'))                                              AS reached
    FROM public.sos_dispatch_attempts
    WHERE emergency_id = p_emergency_id
    GROUP BY contact_index
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE reached),
    bool_or(reached),
    jsonb_agg(jsonb_build_object(
      'contact_index',      contact_index,
      'contact_name',       contact_name,
      'channels_attempted', COALESCE(channels_attempted, '{}'::text[]),
      'channels_succeeded', COALESCE(channels_succeeded, '{}'::text[]),
      'reached',            COALESCE(reached, false)
    ) ORDER BY contact_index)
  INTO v_total, v_reached, v_reached_any, v_contacts
  FROM per_contact;

  RETURN jsonb_build_object(
    'emergency_id',         p_emergency_id,
    'reached_any',          COALESCE(v_reached_any, false),
    'all_contacts_reached', v_total > 0 AND v_reached = v_total,
    'total_contacts',       COALESCE(v_total, 0),
    'reached_contacts',     COALESCE(v_reached, 0),
    'contacts',             COALESCE(v_contacts, '[]'::jsonb),
    'fetched_at',           now()
  );
END;
$$;

COMMENT ON FUNCTION public.get_sos_delivery_summary(text) IS
  'L2-B: per-emergency channel-success matrix. Returns reached_any (did ANY contact get ANY channel through?) + per-contact channels_attempted vs channels_succeeded. Authorized for the SOS owner OR an active admin/owner of the company that owns the emergency.';

REVOKE EXECUTE ON FUNCTION public.get_sos_delivery_summary(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sos_delivery_summary(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sos_delivery_summary(text) TO authenticated;
