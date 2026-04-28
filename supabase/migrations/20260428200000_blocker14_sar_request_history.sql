-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCKER #14 (2026-04-28) — GDPR Art. 15 Subject Access Request scaffolding.
--
-- Article 15 of the General Data Protection Regulation grants every data
-- subject the right to obtain a copy of their personal data. The retention
-- cron we built in CRIT-#16 implements Art. 5(1)(e) (storage limitation);
-- this migration is the data-portability counterpart.
--
-- The SAR endpoint itself (export-my-data edge function) does the actual
-- table-walking and JSON assembly. This migration provides the rate-limit
-- and audit scaffolding it depends on:
--   1. sar_request_history — one row per export request, used to enforce
--      a 30-day cooldown between requests by the same user.
--   2. request_sar_export() RPC — the gatekeeper. The edge function calls
--      this FIRST; only if it returns success=true does the function go on
--      to assemble the export. The RPC is the single place rate-limit
--      policy lives, so changing the cooldown is a one-line edit.
--
-- Why 30 days?
--   • GDPR Art. 12(5) explicitly allows the controller to "refuse to act
--     on the request or charge a reasonable fee" when requests are
--     "manifestly unfounded or excessive, in particular because of their
--     repetitive character". 30 days is an established industry norm
--     (Google, Meta, Apple all sit between 14-30 days).
--   • Generous enough to support legitimate use (insurance claims,
--     subject-access challenges, account-takeover investigations).
--   • Tight enough to block obvious abuse (someone scraping their own
--     account data daily as a stress test, or competitive intel
--     disguised as SAR requests).
--
-- DO NOT make the cooldown shorter without re-evaluating cost: the
-- export edge function reads ~47 tables and writes an audit row, which
-- is non-trivial under sustained load.
--
-- Security:
--   • SECURITY DEFINER + SET search_path (G-32 pattern).
--   • REVOKE EXECUTE FROM PUBLIC, GRANT EXECUTE TO authenticated only.
--   • FORCE ROW LEVEL SECURITY on the table — even direct service-role
--     queries (bypassing RLS) won't see the row content unless they go
--     through the function. (Belt + suspenders; service-role bypasses
--     FORCE RLS too, but we declare intent.)
--   • Auth check inside the RPC (auth.uid() IS NULL → reject).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Step 1: history table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sar_request_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  -- Computed at insert time so the gate query is a simple comparison —
  -- no math in the WHERE clause = index can be used cleanly.
  next_allowed_at timestamptz NOT NULL,
  -- Bookkeeping for observability / forensic checks.
  ip_address      inet,
  user_agent      text,
  -- Denormalized count of tables actually exported in this request.
  -- Useful for spotting partial failures across the table-walking pass.
  tables_count    integer,
  bytes_returned  bigint,
  status          text NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('completed', 'partial', 'failed'))
);

CREATE INDEX IF NOT EXISTS sar_request_history_user_recent_idx
  ON public.sar_request_history(user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS sar_request_history_next_allowed_idx
  ON public.sar_request_history(user_id, next_allowed_at DESC);

-- ── Step 2: RLS — users can SELECT their own history but not write ────
ALTER TABLE public.sar_request_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sar_request_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_sar_history" ON public.sar_request_history;
CREATE POLICY "users_read_own_sar_history"
  ON public.sar_request_history
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.sar_request_history FROM authenticated, anon;
GRANT  SELECT ON public.sar_request_history TO authenticated;

COMMENT ON TABLE public.sar_request_history IS
  'BLOCKER #14: one row per GDPR Art. 15 export request. Rate-limit lookup table for request_sar_export() RPC.';

-- ── Step 3: RPC — request_sar_export ───────────────────────────────────
-- Returns jsonb with {success, reason?, next_allowed_at?, last_request_at?}
-- so the client can branch deterministically and surface the right copy.
DROP FUNCTION IF EXISTS public.request_sar_export();
DROP FUNCTION IF EXISTS public.request_sar_export(integer);

CREATE OR REPLACE FUNCTION public.request_sar_export(
  p_cooldown_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id   uuid;
  v_last_row  record;
  v_new_id    uuid;
BEGIN
  -- ── 1) Auth gate ───────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  -- ── 2) Sanity-check cooldown (defence against client tampering) ────
  IF p_cooldown_days IS NULL OR p_cooldown_days < 1 OR p_cooldown_days > 365 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_cooldown');
  END IF;

  -- ── 3) Rate-limit check ────────────────────────────────────────────
  -- Look at the most recent request and its `next_allowed_at` floor.
  -- If now() < next_allowed_at → reject with the timestamp so the UI
  -- can render "available again on <date>".
  SELECT id, requested_at, next_allowed_at
    INTO v_last_row
    FROM public.sar_request_history
   WHERE user_id = v_user_id
   ORDER BY requested_at DESC
   LIMIT 1;

  IF FOUND AND v_last_row.next_allowed_at > now() THEN
    RETURN jsonb_build_object(
      'success',          false,
      'reason',           'rate_limited',
      'last_request_at',  v_last_row.requested_at,
      'next_allowed_at',  v_last_row.next_allowed_at,
      'cooldown_days',    p_cooldown_days
    );
  END IF;

  -- ── 4) Approve: insert pending row, return its id ──────────────────
  -- The edge function will UPDATE this row's tables_count/bytes_returned/
  -- status when the export finishes (or stays 'completed' on success).
  INSERT INTO public.sar_request_history (
    user_id, requested_at, next_allowed_at
  )
  VALUES (
    v_user_id,
    now(),
    now() + make_interval(days => p_cooldown_days)
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success',         true,
    'request_id',      v_new_id,
    'requested_at',    now(),
    'next_allowed_at', now() + make_interval(days => p_cooldown_days)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[request_sar_export] unexpected error for user %: %', v_user_id, SQLERRM;
  RETURN jsonb_build_object('success', false, 'reason', 'internal_error');
END;
$function$;

REVOKE ALL ON FUNCTION public.request_sar_export(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_sar_export(integer) TO authenticated;

COMMENT ON FUNCTION public.request_sar_export(integer) IS
  'BLOCKER #14: gatekeeper for GDPR Art. 15 export. Returns success=true and a request_id only when the user is past the cooldown. Edge function MUST call this first and abort if success=false.';

-- ── Step 4: companion RPC to update the row after the export finishes ──
DROP FUNCTION IF EXISTS public.complete_sar_export(uuid, integer, bigint, text);

CREATE OR REPLACE FUNCTION public.complete_sar_export(
  p_request_id     uuid,
  p_tables_count   integer,
  p_bytes_returned bigint,
  p_status         text DEFAULT 'completed'
)
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
  IF p_status NOT IN ('completed', 'partial', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_status');
  END IF;

  UPDATE public.sar_request_history
     SET tables_count   = p_tables_count,
         bytes_returned = p_bytes_returned,
         status         = p_status
   WHERE id = p_request_id
     AND user_id = v_user_id     -- defence: user can only stamp their own request
   RETURNING * INTO v_updated;

  IF v_updated.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'request_not_found_or_not_owned');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_sar_export(uuid, integer, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_sar_export(uuid, integer, bigint, text) TO authenticated;

COMMENT ON FUNCTION public.complete_sar_export(uuid, integer, bigint, text) IS
  'BLOCKER #14: edge function calls this after the export to record observability metrics on the matching sar_request_history row.';

-- ── Step 5: post-condition probes ──────────────────────────────────────
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'sar_request_history';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'BLOCKER #14: sar_request_history table missing';
  END IF;

  SELECT count(*) INTO v_count FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname IN ('request_sar_export', 'complete_sar_export');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'BLOCKER #14: expected 2 RPCs, found %', v_count;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE. Verification query:
--   SELECT * FROM public.request_sar_export();  -- as an authenticated user
--   → first call: { success: true, request_id, next_allowed_at }
--   → second call within 30 days: { success: false, reason: 'rate_limited', ... }
-- ═══════════════════════════════════════════════════════════════════════════
