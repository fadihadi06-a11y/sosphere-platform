-- ═══════════════════════════════════════════════════════════════
-- SOSphere — L1 OBSERVABILITY: trace_id + forensic timestamps
-- ─────────────────────────────────────────────────────────────
-- Layer 1 of the life-safety foundation pyramid (see
-- docs/LIFE_SAFETY_FOUNDATION.md). Adds the two columns that make
-- end-to-end SOS-pipeline forensics possible:
--
--   1. trace_id  — UUID v4 generated at button-press time on the
--      client and propagated through every layer (client log,
--      HTTP header, sos-alert edge function, sos_sessions row,
--      audit_log rows, Twilio statusCallback, Sentry tag).
--      Without this, post-incident reconstruction is guesswork —
--      we cannot answer "what happened during emergency X?" as a
--      single timeline.
--
--   2. client_claimed_at + server_received_at  — both wall-clock
--      timestamps captured at distinct moments. The DELTA between
--      them is a forensic signal:
--        delta < 5s    → normal (network round-trip)
--        delta > 30s   → client clock skew or offline replay
--        delta < 0     → client clock manipulation — alert security
--      Required for legal admissibility under ISO/IEC 27037
--      digital-evidence standards.
--
-- Tables touched:
--   • sos_sessions  — both columns + indices
--   • audit_log     — trace_id only (it already has created_at +
--                      client_timestamp from the original P3-#11
--                      schema, which serve the same delta purpose)
--
-- Rollback hint:
--   ALTER TABLE public.sos_sessions
--     DROP COLUMN trace_id, DROP COLUMN client_claimed_at,
--     DROP COLUMN server_received_at;
--   ALTER TABLE public.audit_log DROP COLUMN trace_id;
--   DROP INDEX IF EXISTS idx_sos_sessions_trace_id;
--   DROP INDEX IF EXISTS idx_audit_log_trace_id;
-- ═══════════════════════════════════════════════════════════════

-- Use uuid_generate_v4 if available, gen_random_uuid otherwise.
-- pgcrypto is enabled by default in Supabase; uuid-ossp is not.
-- We don't auto-populate (existing rows stay NULL) — only future
-- rows get a trace_id, and the application layer is responsible.

-- ── sos_sessions ───────────────────────────────────────────────
ALTER TABLE public.sos_sessions
  ADD COLUMN IF NOT EXISTS trace_id            uuid,
  ADD COLUMN IF NOT EXISTS client_claimed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS server_received_at  timestamptz;

COMMENT ON COLUMN public.sos_sessions.trace_id IS
  'L1-A observability: UUID v4 generated at SOS button press, propagated through every layer for end-to-end forensic reconstruction. NULL on rows pre-dating this migration.';

COMMENT ON COLUMN public.sos_sessions.client_claimed_at IS
  'L1-B observability: client wall-clock timestamp at the moment the user pressed SOS. Compared against server_received_at to detect clock skew, offline replay (>30s), or clock manipulation (<0).';

COMMENT ON COLUMN public.sos_sessions.server_received_at IS
  'L1-B observability: server wall-clock timestamp at the moment sos-alert edge function received the trigger HTTP request. Authoritative for forensic timing analysis.';

-- Index on trace_id so we can pivot a sos_sessions row to its
-- correlated audit_log rows efficiently.
CREATE INDEX IF NOT EXISTS idx_sos_sessions_trace_id
  ON public.sos_sessions (trace_id)
  WHERE trace_id IS NOT NULL;

-- ── audit_log ──────────────────────────────────────────────────
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS trace_id uuid;

COMMENT ON COLUMN public.audit_log.trace_id IS
  'L1-A observability: same UUID as sos_sessions.trace_id when this audit row was emitted as part of an SOS press lifecycle. NULL for unrelated audit events (auth, settings, etc.).';

CREATE INDEX IF NOT EXISTS idx_audit_log_trace_id
  ON public.audit_log (trace_id)
  WHERE trace_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- Notes for client + edge-function authors:
--
--   1. Generate trace_id at the FIRST moment of the SOS lifecycle
--      (button press → before any network call). Pass it via:
--        • HTTP header `X-SOS-Trace-Id: <uuid>`
--        • Twilio statusCallback `?trace_id=<uuid>` query param
--        • supabase.rpc audit_log inserts as `p_trace_id`
--        • Sentry: Sentry.setTag('sos_trace_id', <uuid>)
--
--   2. Set client_claimed_at = new Date().toISOString() at the
--      same moment. Send in the trigger payload as
--      `clientClaimedAt`.
--
--   3. server_received_at is set in sos-alert edge function from
--      `new Date().toISOString()` at the very top of the handler,
--      before any other DB write.
--
--   4. NEVER backfill trace_id on existing rows — it would imply
--      a correlation that didn't actually happen.
-- ═══════════════════════════════════════════════════════════════
