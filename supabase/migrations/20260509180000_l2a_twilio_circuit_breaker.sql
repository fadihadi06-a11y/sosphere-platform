-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — L2-A: Twilio Circuit Breaker
-- ────────────────────────────────────────────────────────────────────────
-- Layer 2 of the life-safety foundation pyramid. Second piece (after L2-D
-- audit-log hash chain).
--
-- WHY THIS EXISTS
--   Today, every SOS that needs to dispatch a call/SMS hits Twilio with a
--   single fetch(). When Twilio has a regional outage (which happens 2-5%
--   of the year for major cloud APIs), every retried SOS waits for the
--   full HTTP timeout, then fails. Workers re-trigger their SOS button.
--   Result: a thundering herd of doomed Twilio calls during the window
--   when the responder needs the fastest possible signal.
--
-- WHAT THIS DOES
--   Implements a classic three-state circuit breaker (closed / open /
--   half_open) for all Twilio API calls, gated through two RPCs:
--     • twilio_breaker_check(key)   — "should I call Twilio right now?"
--     • twilio_breaker_record(key,ok) — "I just called Twilio, here's
--                                       what happened"
--
--   STATE MACHINE
--     closed     → normal. Each failure increments counter. If
--                  >= THRESHOLD failures within WINDOW seconds → open.
--     open       → fail-fast. Every check returns 'open' for COOL_DOWN
--                  seconds. After cool-down → half_open.
--     half_open  → first call gets through; success → closed. Failure
--                  → open again for another COOL_DOWN.
--
--   The breaker key is currently 'global' (one breaker for all Twilio
--   traffic). When we move to per-tenant Twilio subaccounts (L4),
--   each tenant gets its own row keyed by company_id.
--
-- WHAT THIS DOES NOT DO (for L2-A scope)
--   • Choose a fallback channel when the breaker is open. That's L2-B
--     (Push → SMS → Voice failover). For now, an open breaker just
--     surfaces a 503 with a structured error so the caller knows to
--     skip Twilio entirely.
--   • Per-tenant breakers. Single 'global' breaker is enough for the
--     current single-Twilio-account deployment.
--   • Slow-call detection. Only outright failure counts toward the
--     breaker. Adding latency-based tripping is a future enhancement.
--
-- THRESHOLDS (matched in tests + edge function code)
--   THRESHOLD  = 5 failures
--   WINDOW     = 30 seconds  (time over which failures accumulate)
--   COOL_DOWN  = 30 seconds  (how long we stay 'open' before half-open)
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.twilio_breaker_check(text);
--   DROP FUNCTION IF EXISTS public.twilio_breaker_record(text, boolean);
--   DROP TABLE     IF EXISTS public.twilio_breaker_state;
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. State table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.twilio_breaker_state (
  key                  text PRIMARY KEY,
  state                text NOT NULL DEFAULT 'closed'
                            CHECK (state IN ('closed', 'open', 'half_open')),

  -- Recent-failure tracking (used to decide whether to OPEN)
  failure_count        integer NOT NULL DEFAULT 0,
  last_failure_at      timestamptz,

  -- When we entered the 'open' state. Used to compute cool-down expiry.
  opened_at            timestamptz,

  -- Last success — useful for ops dashboards
  last_success_at      timestamptz,

  -- Lifetime counters (never reset — append-only forensic stats)
  total_failures       bigint NOT NULL DEFAULT 0,
  total_successes      bigint NOT NULL DEFAULT 0,
  total_short_circuits bigint NOT NULL DEFAULT 0,
  total_state_changes  bigint NOT NULL DEFAULT 0,

  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.twilio_breaker_state IS
  'L2-A: per-key Twilio circuit breaker state. One row per breaker (currently just key=''global''). Read by twilio_breaker_check before every Twilio call, mutated by twilio_breaker_record after.';

-- Seed the global breaker so check/record never has to handle the
-- "first row" case.
INSERT INTO public.twilio_breaker_state (key) VALUES ('global')
  ON CONFLICT (key) DO NOTHING;

-- RLS: this is operator-state, not tenant-state. service_role only.
ALTER TABLE public.twilio_breaker_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.twilio_breaker_state FORCE ROW LEVEL SECURITY;
-- No policies on purpose — only service_role (which bypasses RLS) can
-- read/write. The RPCs below are SECURITY DEFINER and act as the
-- controlled gateway.

REVOKE ALL ON public.twilio_breaker_state FROM PUBLIC;
REVOKE ALL ON public.twilio_breaker_state FROM anon, authenticated;
GRANT  ALL ON public.twilio_breaker_state TO service_role;

-- ── 2. CHECK rpc — "should I call Twilio right now?" ──────────────
CREATE OR REPLACE FUNCTION public.twilio_breaker_check(p_key text DEFAULT 'global')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_row    public.twilio_breaker_state%ROWTYPE;
  v_now    timestamptz := now();
  -- Thresholds. KEEP IN SYNC with the architectural test + edge fn.
  v_window     interval := interval '30 seconds';
  v_cool_down  interval := interval '30 seconds';
BEGIN
  -- Lock-free read. We mutate inside the same call only when we need
  -- to transition 'open' → 'half_open' on cool-down expiry.
  SELECT * INTO v_row FROM public.twilio_breaker_state WHERE key = p_key;
  IF NOT FOUND THEN
    -- Auto-seed unknown keys so the caller doesn't have to.
    INSERT INTO public.twilio_breaker_state (key) VALUES (p_key)
      RETURNING * INTO v_row;
  END IF;

  -- State 'open' transitions to 'half_open' once cool-down has passed.
  -- We do this lazily on read so a stale 'open' doesn't get stuck if
  -- no one calls record() during the cool-down window.
  IF v_row.state = 'open'
     AND v_row.opened_at IS NOT NULL
     AND (v_now - v_row.opened_at) > v_cool_down
  THEN
    UPDATE public.twilio_breaker_state
       SET state               = 'half_open',
           total_state_changes = total_state_changes + 1,
           updated_at          = v_now
     WHERE key = p_key;
    v_row.state := 'half_open';
  END IF;

  -- 'closed' state: also stale-prune the failure counter so a fresh
  -- new failure doesn't ride on top of one from 5 minutes ago.
  IF v_row.state = 'closed'
     AND v_row.last_failure_at IS NOT NULL
     AND (v_now - v_row.last_failure_at) > v_window
     AND v_row.failure_count > 0
  THEN
    UPDATE public.twilio_breaker_state
       SET failure_count = 0,
           updated_at    = v_now
     WHERE key = p_key;
    v_row.failure_count := 0;
  END IF;

  -- Track short-circuit so ops can see "how often did we skip Twilio?"
  IF v_row.state = 'open' THEN
    UPDATE public.twilio_breaker_state
       SET total_short_circuits = total_short_circuits + 1
     WHERE key = p_key;
  END IF;

  RETURN jsonb_build_object(
    'state',                v_row.state,
    'allow',                v_row.state IN ('closed','half_open'),
    'opened_at',            v_row.opened_at,
    'failure_count',        v_row.failure_count,
    'last_failure_at',      v_row.last_failure_at,
    'last_success_at',      v_row.last_success_at,
    'cool_down_seconds',    extract(epoch from v_cool_down)::int,
    'window_seconds',       extract(epoch from v_window)::int,
    'now',                  v_now
  );
END;
$$;

COMMENT ON FUNCTION public.twilio_breaker_check(text) IS
  'L2-A: returns {state, allow, ...} for the named breaker. allow=false means the caller MUST skip Twilio and either fall back to another channel or fail fast. Auto-transitions open→half_open on cool-down expiry.';

REVOKE EXECUTE ON FUNCTION public.twilio_breaker_check(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.twilio_breaker_check(text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.twilio_breaker_check(text) TO service_role;

-- ── 3. RECORD rpc — "I just called Twilio, here's the outcome" ────
CREATE OR REPLACE FUNCTION public.twilio_breaker_record(
  p_key      text DEFAULT 'global',
  p_success  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_row     public.twilio_breaker_state%ROWTYPE;
  v_now     timestamptz := now();
  v_threshold int := 5;
  v_window  interval := interval '30 seconds';
  v_old_state text;
BEGIN
  SELECT * INTO v_row FROM public.twilio_breaker_state WHERE key = p_key;
  IF NOT FOUND THEN
    INSERT INTO public.twilio_breaker_state (key) VALUES (p_key)
      RETURNING * INTO v_row;
  END IF;

  v_old_state := v_row.state;

  IF p_success THEN
    -- Success closes the breaker if it was half_open, and resets
    -- the failure counter regardless.
    UPDATE public.twilio_breaker_state
       SET state               = 'closed',
           failure_count       = 0,
           last_success_at     = v_now,
           opened_at           = CASE WHEN state = 'closed' THEN opened_at ELSE NULL END,
           total_successes     = total_successes + 1,
           total_state_changes = total_state_changes + CASE WHEN state <> 'closed' THEN 1 ELSE 0 END,
           updated_at          = v_now
     WHERE key = p_key
     RETURNING * INTO v_row;
  ELSE
    -- Failure: increment the counter (or reset-then-increment if the
    -- last failure was outside the window).
    UPDATE public.twilio_breaker_state
       SET failure_count =
             CASE
               WHEN last_failure_at IS NULL OR (v_now - last_failure_at) > v_window
                 THEN 1
               ELSE failure_count + 1
             END,
           last_failure_at = v_now,
           total_failures  = total_failures + 1,
           updated_at      = v_now
     WHERE key = p_key
     RETURNING * INTO v_row;

    -- Trip the breaker if we crossed the threshold. half_open → open
    -- on any failure. closed → open if threshold reached.
    IF v_row.state = 'half_open'
       OR (v_row.state = 'closed' AND v_row.failure_count >= v_threshold)
    THEN
      UPDATE public.twilio_breaker_state
         SET state               = 'open',
             opened_at           = v_now,
             total_state_changes = total_state_changes + 1,
             updated_at          = v_now
       WHERE key = p_key
       RETURNING * INTO v_row;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'state',          v_row.state,
    'previous_state', v_old_state,
    'transitioned',   v_row.state <> v_old_state,
    'failure_count',  v_row.failure_count,
    'opened_at',      v_row.opened_at,
    'now',            v_now
  );
END;
$$;

COMMENT ON FUNCTION public.twilio_breaker_record(text, boolean) IS
  'L2-A: record a Twilio call outcome and update breaker state. Closes on success, increments failure counter on failure, transitions to ''open'' when threshold crossed.';

REVOKE EXECUTE ON FUNCTION public.twilio_breaker_record(text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.twilio_breaker_record(text, boolean) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.twilio_breaker_record(text, boolean) TO service_role;
