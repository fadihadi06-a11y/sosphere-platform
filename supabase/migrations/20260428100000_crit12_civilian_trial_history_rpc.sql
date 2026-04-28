-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: civilian_trial_history + start_civilian_trial RPC
-- Version:   20260428100000
-- Purpose:   CRIT-#12 — server-side anti-replay check for the one-time
--            7-day Elite trial. Pre-fix: trial state lived ONLY in
--            localStorage, so a user could clear browser storage and
--            re-arm the trial indefinitely → revenue loss + abuse.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Design:
--   • civilian_trial_history is a 1-row-per-user PERMANENT record.
--   • The RPC start_civilian_trial(p_plan) is the SINGLE entry point.
--     - First call for a user: INSERT row, return { success: true, ... }.
--     - Any later call (whether trial expired, cancelled, or wiped from
--       localStorage): finds existing row, returns { success: false,
--       reason: "trial_already_used" }. ONE-SHOT PER LIFETIME.
--   • Frontend writes localStorage ONLY when the RPC returns success.
--     Without RPC approval, no Elite features are granted.
--
-- Safety:
--   • SECURITY DEFINER + SET search_path so the function bypasses RLS
--     (it's the gatekeeper, not the gated thing) but cannot be hijacked
--     by malicious search_path injection.
--   • REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO authenticated only —
--     anon callers cannot start trials.
--   • Returns jsonb with EXPLICIT success/error keys so the client can
--     branch deterministically (no guessing from null/exception).
--   • ON CONFLICT (user_id) DO NOTHING — race-safe; concurrent calls from
--     the same user produce exactly one row.
--   • RLS policy: users read their own row only. Insert is RPC-only
--     (no direct INSERT policy needed since the RPC bypasses RLS).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.civilian_trial_history (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trial_plan    text NOT NULL DEFAULT 'elite',
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  duration_days integer NOT NULL DEFAULT 7 CHECK (duration_days > 0 AND duration_days <= 90),
  cancelled_at  timestamptz,                                  -- nullable: set if user cancels early
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS civilian_trial_history_expires_at_idx
  ON public.civilian_trial_history(expires_at);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.civilian_trial_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civilian_trial_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_trial" ON public.civilian_trial_history;
CREATE POLICY "users_read_own_trial"
  ON public.civilian_trial_history
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies — only the SECURITY DEFINER RPC writes.
-- service_role retains full access automatically (bypasses RLS).

REVOKE INSERT, UPDATE, DELETE ON public.civilian_trial_history FROM authenticated, anon;
GRANT  SELECT ON public.civilian_trial_history TO authenticated;

-- ── RPC: start_civilian_trial ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.start_civilian_trial(text);
DROP FUNCTION IF EXISTS public.start_civilian_trial(text, integer);

CREATE OR REPLACE FUNCTION public.start_civilian_trial(
  p_plan          text DEFAULT 'elite',
  p_duration_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id  uuid;
  v_existing record;
  v_new_row  record;
BEGIN
  -- ── 1) Caller must be authenticated ────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'unauthorized'
    );
  END IF;

  -- ── 2) Validate plan + duration (defence against client tampering) ──
  IF p_plan NOT IN ('elite', 'basic') THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'invalid_plan'
    );
  END IF;
  IF p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 90 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'invalid_duration'
    );
  END IF;

  -- ── 3) Check existing trial history (anti-replay core) ──────────────
  SELECT *
    INTO v_existing
    FROM public.civilian_trial_history
   WHERE user_id = v_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success',     false,
      'reason',      'trial_already_used',
      'started_at',  v_existing.started_at,
      'expires_at',  v_existing.expires_at,
      'cancelled_at',v_existing.cancelled_at,
      'plan',        v_existing.trial_plan
    );
  END IF;

  -- ── 4) First-time: insert the record ────────────────────────────────
  INSERT INTO public.civilian_trial_history (
    user_id, trial_plan, started_at, expires_at, duration_days
  )
  VALUES (
    v_user_id,
    p_plan,
    now(),
    now() + make_interval(days => p_duration_days),
    p_duration_days
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING * INTO v_new_row;

  -- ── 5) Race detector: if INSERT was a no-op (DO NOTHING fired),
  --    a concurrent call from the same user already inserted. Re-read
  --    and return its data so both calls report consistent state.
  IF v_new_row.user_id IS NULL THEN
    SELECT *
      INTO v_existing
      FROM public.civilian_trial_history
     WHERE user_id = v_user_id;
    RETURN jsonb_build_object(
      'success',     false,
      'reason',      'trial_already_used',
      'started_at',  v_existing.started_at,
      'expires_at',  v_existing.expires_at,
      'plan',        v_existing.trial_plan,
      'race',        true
    );
  END IF;

  -- ── 6) Success ─────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',       true,
    'plan',          v_new_row.trial_plan,
    'started_at',    v_new_row.started_at,
    'expires_at',    v_new_row.expires_at,
    'duration_days', v_new_row.duration_days
  );
EXCEPTION WHEN OTHERS THEN
  -- Defensive: never leak SQLSTATE / internal table names to the client.
  RAISE WARNING '[start_civilian_trial] unexpected error for user %: %', v_user_id, SQLERRM;
  RETURN jsonb_build_object(
    'success', false,
    'reason',  'internal_error'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.start_civilian_trial(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_civilian_trial(text, integer) TO authenticated;

COMMENT ON FUNCTION public.start_civilian_trial(text, integer) IS
  'CRIT-#12: server-side anti-replay check for one-shot 7-day Elite trial. Returns success=true only on first call per user (lifetime). Frontend writes localStorage only when this returns success.';

-- ── RPC: cancel_civilian_trial ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.cancel_civilian_trial();

CREATE OR REPLACE FUNCTION public.cancel_civilian_trial()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
  v_updated record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  UPDATE public.civilian_trial_history
     SET cancelled_at = now(),
         updated_at   = now()
   WHERE user_id = v_user_id
     AND cancelled_at IS NULL          -- only mark once (idempotent)
     AND expires_at > now()            -- only if not already expired
   RETURNING * INTO v_updated;

  IF v_updated.user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_active_trial_to_cancel');
  END IF;
  RETURN jsonb_build_object(
    'success',     true,
    'cancelled_at',v_updated.cancelled_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_civilian_trial() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_civilian_trial() TO authenticated;

COMMENT ON FUNCTION public.cancel_civilian_trial() IS
  'CRIT-#12: cancel an in-progress civilian trial. Idempotent — no-op if already cancelled or expired. Cannot re-arm via cancellation.';

-- ── Verify ──────────────────────────────────────────────────────────────
SELECT
  'civilian_trial_history exists' AS check,
  EXISTS (SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'civilian_trial_history')
    AS result
UNION ALL
SELECT
  'start_civilian_trial RPC exists',
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE n.nspname = 'public' AND p.proname = 'start_civilian_trial')
UNION ALL
SELECT
  'FORCE RLS enabled',
  COALESCE((SELECT relforcerowsecurity FROM pg_class
             WHERE relname = 'civilian_trial_history'
               AND relnamespace = 'public'::regnamespace), false);
