-- ═══════════════════════════════════════════════════════════════════════════
-- E1.6.1 — seat-limit check in enqueue_job (beehive audit Q3)
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLEM
--   public.enqueue_job(...) had no plan-level cap. A starter-plan owner
--   (25-employee max) could enqueue a 35,000-row CSV. The worker would
--   then call supabase.auth.admin.inviteUserByEmail 35K times — a real
--   email cost (~$35-100), Supabase Auth rate-limit lockout, and a
--   user-experience disaster (35K confused recipients).
--
-- SOLUTION
--   Pre-flight check inside enqueue_job for job_type IN ('bulk_invite',
--   'csv_import') that:
--     1. Reads companies.plan
--     2. Maps plan → max_employees (mirrored from
--        src/app/constants/pricing.ts UNIFIED_PLANS)
--     3. Allows up to 5× the plan cap per single job (overage-billing
--        territory; growth=100 → 500/job, business=500 → 2,500/job)
--     4. Absolute hard cap: 100,000 items per job regardless of plan
--        (worker resource protection — even Enterprise can't drop a
--        500K-item job in one shot)
--
--   On violation: RAISE EXCEPTION with structured detail so the wizard
--   can surface a clear "Plan limit exceeded — upgrade or split import"
--   message instead of a generic SQL error.
--
-- WHY 5× THE PLAN CAP, NOT 1×?
--   Plans support overage-billing (extraEmployeePrice). A growth-plan
--   company can legitimately import 200 employees and pay $6/extra. A
--   1× cap would block that with a confusing "you're over your plan"
--   error. The 5× burst lets one-time imports through while still
--   killing 1000× runaway scenarios. Long-term: tighter check inside
--   the wizard before enqueue, plus billing reconciliation post-import.
--
-- WHAT THIS DOES NOT DO
--   • Does NOT count current employees + new items against cap. That's
--     a stricter check that needs schema work (active employee count
--     vs. seat_limit) and is deferred to a follow-up.
--   • Does NOT enforce trial expiration. Trial is gated separately
--     in checkTrialGuard() on the frontend and could escape this RPC.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper: plan → max_employees (mirrors UNIFIED_PLANS in TS) ─────────────
CREATE OR REPLACE FUNCTION public._plan_max_employees(p_plan text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE COALESCE(p_plan, 'starter')
    WHEN 'starter'    THEN 25
    WHEN 'growth'     THEN 100
    WHEN 'business'   THEN 500
    WHEN 'enterprise' THEN 100000   -- "unlimited" → practical hard cap
    ELSE 25                          -- unknown plan → conservative
  END;
$$;
COMMENT ON FUNCTION public._plan_max_employees(text) IS
  'E1.6.1: plan→max_employees. Mirrors UNIFIED_PLANS in src/app/constants/pricing.ts. Single source of truth for the SQL side.';

-- ── REPLACE enqueue_job with seat-limit check ──────────────────────────────
-- Same body as 20260503170553 except for the new pre-flight check between
-- the ownership check and the idempotency check. Idempotency, queue
-- mapping, audit_log, all unchanged.
CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_job_type        text,
  p_company_id      uuid,
  p_payload         jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_max_attempts    int  DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_user_id    uuid := auth.uid();
  v_existing   uuid;
  v_job_id     uuid;
  v_msg_id     bigint;
  v_queue      text;
  v_items_n    int;
  v_plan       text;
  v_plan_max   int;
  v_burst_cap  int;
  v_hard_cap   constant int := 100000;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'enqueue_job: not authenticated' USING ERRCODE = '42501';
  END IF;

  v_queue := CASE p_job_type
    WHEN 'bulk_invite' THEN 'bulk_invite'
    WHEN 'csv_import'  THEN 'bulk_invite'
    WHEN 'scim_sync'   THEN 'bulk_invite'
    WHEN 'data_export' THEN 'bulk_invite'
    ELSE NULL
  END;
  IF v_queue IS NULL THEN
    RAISE EXCEPTION 'enqueue_job: unknown job_type %', p_job_type
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.companies
     WHERE id = p_company_id AND owner_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'enqueue_job: caller does not own company %', p_company_id
      USING ERRCODE = '42501';
  END IF;

  -- ── E1.6.1 SEAT-LIMIT CHECK ──────────────────────────────────────────────
  -- Only applies to invite-style jobs. Other job_types (data_export, future
  -- scim_sync) have their own size semantics.
  IF p_job_type IN ('bulk_invite', 'csv_import') THEN
    v_items_n := COALESCE(jsonb_array_length(p_payload->'items'), 0);

    -- Absolute hard cap protects worker resources regardless of plan
    IF v_items_n > v_hard_cap THEN
      RAISE EXCEPTION
        'enqueue_job: hard cap exceeded (% items > % limit). Split into smaller batches.',
        v_items_n, v_hard_cap
        USING ERRCODE = '22023', HINT = 'Split the CSV into multiple uploads of <= 100,000 rows each.';
    END IF;

    -- Plan-aware soft cap: 5× the plan's max_employees
    SELECT plan INTO v_plan FROM public.companies WHERE id = p_company_id;
    v_plan_max  := public._plan_max_employees(v_plan);
    v_burst_cap := v_plan_max * 5;

    IF v_items_n > v_burst_cap THEN
      RAISE EXCEPTION
        'enqueue_job: plan cap exceeded (plan=% allows up to % per import; you sent %). Upgrade plan or split import.',
        COALESCE(v_plan, 'starter'), v_burst_cap, v_items_n
        USING ERRCODE = '22023',
              HINT = 'Visit Billing to upgrade your plan, or split the CSV into smaller files.';
    END IF;
  END IF;

  -- Idempotency
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing
      FROM public.async_job_metadata
     WHERE company_id = p_company_id
       AND idempotency_key = p_idempotency_key
       AND status IN ('pending','running','paused','completed')
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'job_id', v_existing,
        'deduplicated', true
      );
    END IF;
  END IF;

  SELECT pgmq.send(v_queue, p_payload) INTO v_msg_id;

  INSERT INTO public.async_job_metadata
    (pgmq_msg_id, queue_name, job_type, company_id, created_by, status,
     payload_summary, idempotency_key, max_attempts, progress)
  VALUES
    (v_msg_id, v_queue, p_job_type, p_company_id, v_user_id, 'pending',
     jsonb_build_object(
       'estimated_count', COALESCE((p_payload->>'estimated_count')::int,
                                    jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb))),
       'source',          p_payload->>'source'
     ),
     p_idempotency_key,
     GREATEST(1, LEAST(10, p_max_attempts)),
     jsonb_build_object(
       'total',     COALESCE((p_payload->>'estimated_count')::int,
                              jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb))),
       'processed', 0, 'succeeded', 0, 'failed', 0
     )
    )
  RETURNING id INTO v_job_id;

  BEGIN
    INSERT INTO public.audit_log
      (id, action, actor, actor_id, actor_role, operation, target, target_id,
       category, severity, metadata, created_at)
    VALUES
      (gen_random_uuid()::text, 'job_enqueued',
       'user', v_user_id::text, 'user', 'INSERT',
       p_company_id::text, v_job_id::text,
       'workflow', 'info',
       jsonb_build_object('job_type', p_job_type, 'queue', v_queue, 'msg_id', v_msg_id, 'items', v_items_n),
       NOW());
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job_id,
    'msg_id', v_msg_id,
    'queue',  v_queue
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.enqueue_job(text, uuid, jsonb, text, int) TO authenticated;

COMMENT ON FUNCTION public.enqueue_job IS
  'E1 async queue + E1.6.1 seat-limit. Single entry point to schedule bulk/long-running work. SECDEF + caller-owns-company + plan-cap (5x) + 100K hard cap + idempotency + pgmq.send + audit_log.';

-- ── Post-condition assertions ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = '_plan_max_employees' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'E1.6.1 post-condition: _plan_max_employees missing';
  END IF;
  IF public._plan_max_employees('starter')    != 25     THEN RAISE EXCEPTION 'E1.6.1: starter mapping wrong';     END IF;
  IF public._plan_max_employees('growth')     != 100    THEN RAISE EXCEPTION 'E1.6.1: growth mapping wrong';      END IF;
  IF public._plan_max_employees('business')   != 500    THEN RAISE EXCEPTION 'E1.6.1: business mapping wrong';    END IF;
  IF public._plan_max_employees('enterprise') != 100000 THEN RAISE EXCEPTION 'E1.6.1: enterprise mapping wrong';  END IF;
  IF public._plan_max_employees(NULL)         != 25     THEN RAISE EXCEPTION 'E1.6.1: NULL→starter fallback wrong'; END IF;
END;
$$;
