-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — L2-F: inbound SMS replies during a live SOS
-- ────────────────────────────────────────────────────────────────────────
-- WHY
--   Phase 1+2 fixed the OUTBOUND side: the alert SMS goes out, the voice
--   call rings ≤2 times, and the dispatch ledger records what we tried.
--   But the channel was still ONE-WAY. A contact who receives the alert
--   and replies "ON MY WAY" had no path to the user — the reply hit the
--   Twilio number and was discarded. The user's mobile screen showed
--   "alert sent" with no acknowledgement.
--
--   L2-F closes the loop: every inbound SMS during an active SOS is
--   captured, ack-keyword-detected, broadcast to the user's emergency
--   screen via Realtime, and recorded in this ledger for forensics.
--
-- SCHEMA RATIONALE
--   • Separate from sos_dispatch_attempts: that ledger is outbound
--     (what WE tried to send). This ledger is inbound (what contacts
--     said back). Mixing the two breaks the "did we reach anyone?"
--     query.
--   • contact_index NULL-able because a reply may arrive from a phone
--     we don't have in contact_snapshot (e.g., contact called from a
--     different line). We still log the reply — security team needs
--     to see ALL inbound traffic to the SOS number, not just expected.
--   • is_ack + ack_keyword denormalized so the dashboard "who
--     acknowledged?" query is a single index scan.
--   • body stored verbatim (Twilio gives ≤1600 chars) for evidence
--     chain. body_normalized = lowercased/trimmed for ack detection
--     debugging only.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sos_sms_replies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id    text        NOT NULL,
  trace_id        uuid,
  company_id      uuid,
  user_id         uuid,                  -- SOS owner (denormalized for fast tenant scope)

  -- Sender attribution
  contact_index   integer,               -- NULL = phone not in contact_snapshot
  contact_name    text,                  -- denorm from contact_snapshot when matched
  from_phone      text        NOT NULL,  -- E.164 normalized
  to_phone        text        NOT NULL,  -- our Twilio number that received it

  -- Provider correlation
  message_sid     text        NOT NULL,  -- Twilio MessageSid — unique per inbound

  -- Content
  body            text        NOT NULL,  -- verbatim — forensic evidence
  body_normalized text,                  -- lowercased/trimmed — debug only

  -- Ack detection
  is_ack          boolean     NOT NULL DEFAULT false,
  ack_keyword     text,                  -- the keyword that matched (NULL if is_ack=false)

  received_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sos_sms_replies IS
  'L2-F: append-only ledger of every inbound SMS received during an active SOS. Source for "who acknowledged?" + forensic timeline of two-way contact communication. message_sid is unique per Twilio inbound message (used for idempotency).';

-- Idempotency: a Twilio webhook retry must not double-insert the same
-- reply. The natural key is message_sid.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sos_sms_replies_message_sid
  ON public.sos_sms_replies (message_sid);

-- Forensic-timeline query: "all replies for this emergency, in order".
CREATE INDEX IF NOT EXISTS idx_sos_sms_replies_emergency
  ON public.sos_sms_replies (emergency_id, received_at);

-- Compliance: per-tenant filter for the dashboard.
CREATE INDEX IF NOT EXISTS idx_sos_sms_replies_company
  ON public.sos_sms_replies (company_id, received_at DESC)
  WHERE company_id IS NOT NULL;

-- Ack-summary query: "did any contact ack this emergency?" — partial
-- index keeps it tiny (most replies are NOT acks, e.g., a reply that
-- says "who is this?").
CREATE INDEX IF NOT EXISTS idx_sos_sms_replies_ack
  ON public.sos_sms_replies (emergency_id, received_at)
  WHERE is_ack = true;

-- L1-A trace correlation.
CREATE INDEX IF NOT EXISTS idx_sos_sms_replies_trace
  ON public.sos_sms_replies (trace_id, received_at)
  WHERE trace_id IS NOT NULL;

-- ── RLS: service_role writes; tenant admins + SOS owner read scoped ──
ALTER TABLE public.sos_sms_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sos_sms_replies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_replies_company_admin_read ON public.sos_sms_replies;
CREATE POLICY sms_replies_company_admin_read
  ON public.sos_sms_replies
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.company_memberships cm
      WHERE cm.company_id = sos_sms_replies.company_id
        AND cm.user_id    = auth.uid()
        AND cm.active     = true
        AND cm.role IN ('admin','owner')
    )
  );

DROP POLICY IF EXISTS sms_replies_self_read ON public.sos_sms_replies;
CREATE POLICY sms_replies_self_read
  ON public.sos_sms_replies
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT / UPDATE / DELETE policies — only service_role writes
-- through the record_sos_sms_reply RPC below. Same pattern as
-- sos_dispatch_attempts.
GRANT SELECT ON public.sos_sms_replies TO authenticated;
GRANT ALL    ON public.sos_sms_replies TO service_role;

-- ── Insert RPC (called by sos-sms-inbound) ────────────────────────────
-- Idempotent on message_sid via the unique index — a Twilio retry that
-- re-fires the same MessageSid returns the EXISTING row's id rather
-- than failing. The webhook handler treats both cases as success.
CREATE OR REPLACE FUNCTION public.record_sos_sms_reply(
  p_emergency_id    text,
  p_message_sid     text,
  p_from_phone      text,
  p_to_phone        text,
  p_body            text,
  p_body_normalized text    DEFAULT NULL,
  p_is_ack          boolean DEFAULT false,
  p_ack_keyword     text    DEFAULT NULL,
  p_trace_id        uuid    DEFAULT NULL,
  p_company_id      uuid    DEFAULT NULL,
  p_user_id         uuid    DEFAULT NULL,
  p_contact_index   integer DEFAULT NULL,
  p_contact_name    text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.sos_sms_replies (
    emergency_id, message_sid, from_phone, to_phone, body, body_normalized,
    is_ack, ack_keyword, trace_id, company_id, user_id, contact_index, contact_name
  ) VALUES (
    p_emergency_id, p_message_sid, p_from_phone, p_to_phone, p_body, p_body_normalized,
    p_is_ack, p_ack_keyword, p_trace_id, p_company_id, p_user_id, p_contact_index, p_contact_name
  )
  ON CONFLICT (message_sid) DO UPDATE
     -- Idempotent: re-insert returns the EXISTING row id without
     -- mutating the row. The DO UPDATE is a no-op SET clause that
     -- still triggers RETURNING.
     SET message_sid = EXCLUDED.message_sid
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_sos_sms_reply(
  text, text, text, text, text, text, boolean, text, uuid, uuid, uuid, integer, text
) IS
  'L2-F: idempotent insert of an inbound SMS reply. Unique on message_sid so Twilio webhook retries do not double-count. Called by sos-sms-inbound edge function.';

REVOKE EXECUTE ON FUNCTION public.record_sos_sms_reply(
  text, text, text, text, text, text, boolean, text, uuid, uuid, uuid, integer, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_sos_sms_reply(
  text, text, text, text, text, text, boolean, text, uuid, uuid, uuid, integer, text
) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_sos_sms_reply(
  text, text, text, text, text, text, boolean, text, uuid, uuid, uuid, integer, text
) TO service_role;
