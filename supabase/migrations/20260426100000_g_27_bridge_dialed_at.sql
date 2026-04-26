-- ═══════════════════════════════════════════════════════════════════════════
-- G-27 (B-20, 2026-04-26): atomic idempotency lock for sos-bridge-twiml's
-- accept handler.
--
-- Pre-fix: Twilio's documented retry behavior dials twice within 2 seconds
-- on flaky cell connections. Each retry hit `action=accept` again, which
-- fired a fresh Twilio call to dial the SOS user — billing doubled,
-- conference split across two SIDs, evidence recording fragmented.
--
-- Now: the accept handler does an atomic `UPDATE WHERE bridge_dialed_at
-- IS NULL RETURNING id`. The first call sets the timestamp and gets the
-- row back. Every retry sees a non-NULL `bridge_dialed_at` and skips
-- the dial entirely.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sos_sessions
  ADD COLUMN IF NOT EXISTS bridge_dialed_at timestamptz;

COMMENT ON COLUMN public.sos_sessions.bridge_dialed_at IS
  'G-27 (B-20): set atomically by sos-bridge-twiml when it dials the SOS user into the conference. Subsequent accept retries see non-null and skip the dial.';
