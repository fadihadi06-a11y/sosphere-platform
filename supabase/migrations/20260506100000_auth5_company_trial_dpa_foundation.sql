-- ═══════════════════════════════════════════════════════════════════════════
-- AUTH-5 (#175) Phase 1 — Company trial + DPA acceptance FOUNDATION
-- Version:   20260506100000
-- Purpose:   Server-side foundation for B2B trial signup. Mirrors the
--            civilian_trial_history pattern (CRIT-#12 / 20260428100000)
--            but adapted for company-level subscriptions and EU/KSA
--            compliance (DPA acceptance is mandatory before billing).
-- ═══════════════════════════════════════════════════════════════════════════
-- Why we don't add a `company_trial_history` table
-- ────────────────────────────────────────────────
-- The civilians table (`civilian_trial_history`) exists because civilian
-- trial state lived ONLY in localStorage pre-fix — clearing the browser
-- re-armed the trial. Companies don't have that problem: a company is
-- a permanent DB row with a uniqueness invariant on `subscriptions.company_id`,
-- and authenticated clients cannot DELETE subscription rows (REVOKE).
-- So one subscription row per company IS the trial-history record.
-- The status transitions (trialing → past_due → active → canceled) form
-- a complete, tamper-resistant audit of the company's billing lifecycle.
-- This matches Stripe / Linear / Notion world-class patterns: the
-- subscription IS the ledger, no separate "history" table needed.
--
-- What this migration delivers
-- ────────────────────────────
-- 1. `company_dpa_acceptances` — legal evidence trail (EU GDPR Art. 28,
--    KSA PDPL Art. 7 require demonstrable DPA between data controller
--    [the company employer] and data processor [SOSphere]).
-- 2. `current_dpa_version()` — single source of truth for the active DPA
--    text version. Bumping invalidates prior acceptances for renewal UX.
-- 3. `accept_company_dpa()` — owner-only, idempotent per version, captures
--    IP / user-agent / signer name + title for legal forensics.
-- 4. `start_company_trial()` — atomic, owner-only. Creates the subscriptions
--    row with status='trialing', trial_ends_at = now() + duration. Anti-
--    replay via UNIQUE constraint on (company_id) in subscriptions.
-- 5. `get_company_subscription_state()` — readable by any active company
--    member; owner gets full billing fields, employee gets plan + limits
--    only (no Stripe IDs).
-- 6. `cancel_company_trial()` — owner cancels mid-trial. Sets
--    cancel_at_period_end=true — trial runs to natural expiry, then
--    drops to inactive. Mirrors Stripe semantics so a future upgrade
--    just unflips the bit instead of creating a fresh row.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- (0) Ensure subscriptions has UNIQUE (company_id) — invariant enforcement
-- ═══════════════════════════════════════════════════════════════════════════
-- The subscriptions table has `company_id` nullable but NO uniqueness
-- constraint, so concurrent owner clicks on "Start trial" could insert
-- two rows for the same company — silently double-billing later. Lock
-- it down. Partial unique index ignores civilian (user_id) rows.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_company_unique_idx
  ON public.subscriptions (company_id)
  WHERE company_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- (1) DPA acceptance ledger
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.company_dpa_acceptances (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  dpa_version     text          NOT NULL,                     -- e.g. "2026-05-06"
  signer_user_id  uuid          NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer_full_name text         NOT NULL,                     -- snapshot at time of signing
  signer_title    text          NOT NULL,                     -- e.g. "CEO", "DPO", "IT Manager"
  signer_email    text          NOT NULL,                     -- snapshot from auth.users
  signer_ip       inet,                                       -- nullable: not all callers expose it
  signer_user_agent text,
  accepted_at     timestamptz   NOT NULL DEFAULT now(),

  -- One acceptance per (company, version). Re-accepting the same version
  -- is a no-op — the RPC short-circuits before INSERT.
  CONSTRAINT company_dpa_acceptances_company_version_unique UNIQUE (company_id, dpa_version)
);

CREATE INDEX IF NOT EXISTS company_dpa_acceptances_company_idx
  ON public.company_dpa_acceptances(company_id, accepted_at DESC);

ALTER TABLE public.company_dpa_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_dpa_acceptances FORCE ROW LEVEL SECURITY;

-- Read: any active member of the company can see acceptances (so
-- employees can verify their employer is compliant). No PII beyond
-- signer_name + email + title, which the employer already owns.
DROP POLICY IF EXISTS company_dpa_member_read ON public.company_dpa_acceptances;
CREATE POLICY company_dpa_member_read
  ON public.company_dpa_acceptances
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.company_memberships m
    WHERE m.company_id = company_dpa_acceptances.company_id
      AND m.user_id    = auth.uid()
      AND m.active     = true
  ));

-- No INSERT/UPDATE/DELETE policies — RPC-only writes.
REVOKE INSERT, UPDATE, DELETE ON public.company_dpa_acceptances FROM authenticated, anon;
GRANT  SELECT ON public.company_dpa_acceptances TO authenticated;

COMMENT ON TABLE public.company_dpa_acceptances IS
  'AUTH-5: legal evidence trail for company DPA acceptance. One row per (company, dpa_version). Tamper-resistant via REVOKE writes + RPC-only inserts.';

-- ═══════════════════════════════════════════════════════════════════════════
-- (2) current_dpa_version() — single source of truth
-- ═══════════════════════════════════════════════════════════════════════════
-- Bumping this string forces all owners to re-accept on next dashboard
-- visit. Matches Stripe Atlas / Linear pattern. Treat as a constant we
-- update whenever the legal team revises the DPA.
CREATE OR REPLACE FUNCTION public.current_dpa_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '2026-05-06'::text
$$;

GRANT EXECUTE ON FUNCTION public.current_dpa_version() TO authenticated, anon;
COMMENT ON FUNCTION public.current_dpa_version() IS
  'AUTH-5: returns the active DPA version string. Bump to invalidate prior acceptances and trigger renewal flow.';

-- ═══════════════════════════════════════════════════════════════════════════
-- (3) accept_company_dpa() — owner-only, idempotent
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.accept_company_dpa(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.accept_company_dpa(
  p_company_id       uuid,
  p_dpa_version      text,
  p_signer_full_name text,
  p_signer_title     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_user_id    uuid := auth.uid();
  v_email      text;
  v_existing   record;
  v_new        record;
  v_ip         inet;
  v_ua         text;
BEGIN
  -- ── 1) Auth ─────────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  -- ── 2) Owner check (cheap helper already exists) ────────────────────
  IF NOT public.is_company_owner(p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_owner');
  END IF;

  -- ── 3) Validate inputs ──────────────────────────────────────────────
  IF p_dpa_version IS NULL OR length(trim(p_dpa_version)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_version');
  END IF;
  IF p_signer_full_name IS NULL OR length(trim(p_signer_full_name)) < 2 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_signer_name');
  END IF;
  IF p_signer_title IS NULL OR length(trim(p_signer_title)) < 2 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_signer_title');
  END IF;

  -- ── 4) Idempotency: same version already accepted? ──────────────────
  SELECT * INTO v_existing
  FROM public.company_dpa_acceptances
  WHERE company_id = p_company_id
    AND dpa_version = p_dpa_version
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success',     true,
      'idempotent',  true,
      'accepted_at', v_existing.accepted_at,
      'version',     v_existing.dpa_version,
      'signer',      v_existing.signer_full_name
    );
  END IF;

  -- ── 5) Capture forensic context ─────────────────────────────────────
  -- Supabase passes through `request.headers` JSONB containing the
  -- inbound CF-Connecting-IP / x-forwarded-for. Both can be NULL when
  -- the RPC is called from server-to-server context, so be defensive.
  BEGIN
    v_ip := nullif(
      coalesce(
        current_setting('request.headers', true)::jsonb ->> 'cf-connecting-ip',
        split_part(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ',', 1)
      ),
      ''
    )::inet;
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;
  BEGIN
    v_ua := current_setting('request.headers', true)::jsonb ->> 'user-agent';
  EXCEPTION WHEN OTHERS THEN
    v_ua := NULL;
  END;

  -- ── 6) Snapshot the signer email at time of signing ─────────────────
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- ── 7) Insert acceptance row ────────────────────────────────────────
  INSERT INTO public.company_dpa_acceptances(
    company_id, dpa_version, signer_user_id,
    signer_full_name, signer_title, signer_email,
    signer_ip, signer_user_agent
  ) VALUES (
    p_company_id, p_dpa_version, v_user_id,
    trim(p_signer_full_name), trim(p_signer_title), coalesce(v_email, ''),
    v_ip, v_ua
  )
  ON CONFLICT (company_id, dpa_version) DO NOTHING
  RETURNING * INTO v_new;

  -- Race detector: another concurrent call for same (company, version)
  -- inserted first. Re-read and report idempotent success.
  IF v_new.id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.company_dpa_acceptances
    WHERE company_id = p_company_id AND dpa_version = p_dpa_version;
    RETURN jsonb_build_object(
      'success', true, 'idempotent', true, 'race', true,
      'accepted_at', v_existing.accepted_at,
      'version',     v_existing.dpa_version,
      'signer',      v_existing.signer_full_name
    );
  END IF;

  -- ── 8) Audit (best-effort — never fail the acceptance because of it) ─
  BEGIN
    PERFORM public.log_sos_audit(
      p_action       => 'dpa_accepted',
      p_actor        => v_user_id::text,
      p_actor_level  => 'owner',
      p_operation    => 'billing',
      p_target       => p_company_id::text,
      p_target_name  => NULL,
      p_metadata     => jsonb_build_object(
        'version',      p_dpa_version,
        'signer_title', p_signer_title
      ),
      p_company_id   => p_company_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[accept_company_dpa] audit log failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success',     true,
    'idempotent',  false,
    'accepted_at', v_new.accepted_at,
    'version',     v_new.dpa_version,
    'signer',      v_new.signer_full_name
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[accept_company_dpa] unexpected error: %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'reason', 'internal_error');
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_company_dpa(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_company_dpa(uuid, text, text, text) TO authenticated;
COMMENT ON FUNCTION public.accept_company_dpa IS
  'AUTH-5: owner-only DPA acceptance. Idempotent per (company, version). Captures IP + UA + signer snapshot for legal forensics. Audit-logged via log_sos_audit category=billing.';

-- ═══════════════════════════════════════════════════════════════════════════
-- (4) start_company_trial() — atomic, owner-only, DPA-gated
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.start_company_trial(uuid, text, integer, text, integer, integer);

CREATE OR REPLACE FUNCTION public.start_company_trial(
  p_company_id     uuid,
  p_plan           text DEFAULT 'starter',
  p_duration_days  integer DEFAULT 14,
  p_billing_cycle  text DEFAULT 'monthly',
  p_employee_limit integer DEFAULT 25,
  p_zone_limit     integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_user_id   uuid := auth.uid();
  v_existing  record;
  v_new       record;
  v_dpa_v     text;
  v_dpa_done  boolean;
BEGIN
  -- ── 1) Auth ─────────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  -- ── 2) Owner check ──────────────────────────────────────────────────
  IF NOT public.is_company_owner(p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_owner');
  END IF;

  -- ── 3) Validate plan + cycle + duration ─────────────────────────────
  IF p_plan NOT IN ('starter','growth','business','enterprise') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_plan');
  END IF;
  IF p_billing_cycle NOT IN ('monthly','annual') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_billing_cycle');
  END IF;
  IF p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 30 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_duration');
  END IF;
  IF p_employee_limit IS NULL OR p_employee_limit < 1 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_employee_limit');
  END IF;
  IF p_zone_limit IS NULL OR p_zone_limit < 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_zone_limit');
  END IF;

  -- ── 4) DPA gate: current version must be accepted ───────────────────
  v_dpa_v := public.current_dpa_version();
  SELECT EXISTS (
    SELECT 1 FROM public.company_dpa_acceptances
    WHERE company_id = p_company_id AND dpa_version = v_dpa_v
  ) INTO v_dpa_done;
  IF NOT v_dpa_done THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'dpa_not_accepted',
      'required_version', v_dpa_v
    );
  END IF;

  -- ── 5) Anti-replay: existing subscription row for this company? ─────
  SELECT * INTO v_existing
  FROM public.subscriptions
  WHERE company_id = p_company_id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  CASE
        WHEN v_existing.status = 'trialing' THEN 'already_trialing'
        WHEN v_existing.status IN ('active','past_due') THEN 'already_subscribed'
        ELSE 'trial_already_used'
      END,
      'status',           v_existing.status,
      'trial_ends_at',    v_existing.trial_ends_at,
      'current_period_end', v_existing.current_period_end
    );
  END IF;

  -- ── 6) Insert subscription row in 'trialing' state ──────────────────
  INSERT INTO public.subscriptions(
    company_id, plan, tier, status,
    trial_ends_at, billing_cycle,
    employee_limit, zone_limit,
    cancel_at_period_end, updated_at
  ) VALUES (
    p_company_id, p_plan, p_plan, 'trialing',
    now() + make_interval(days => p_duration_days),
    p_billing_cycle,
    p_employee_limit, p_zone_limit,
    false, now()
  )
  ON CONFLICT (company_id) DO NOTHING
  RETURNING * INTO v_new;

  -- Race detector: a parallel call inserted first.
  IF v_new.id IS NULL THEN
    SELECT * INTO v_existing FROM public.subscriptions WHERE company_id = p_company_id;
    RETURN jsonb_build_object(
      'success', false, 'race', true,
      'reason', CASE WHEN v_existing.status='trialing' THEN 'already_trialing' ELSE 'trial_already_used' END,
      'trial_ends_at', v_existing.trial_ends_at,
      'status',        v_existing.status
    );
  END IF;

  -- ── 7) Mirror the trial deadline to companies.trial_ends_at so the
  --    legacy `companies` field stays in sync with subscriptions. The
  --    column already exists with a 14-day default; we update it here
  --    to reflect the actual chosen duration.
  UPDATE public.companies
     SET trial_ends_at = v_new.trial_ends_at,
         plan          = p_plan,
         billing_cycle = p_billing_cycle
   WHERE id = p_company_id;

  -- ── 8) Audit ────────────────────────────────────────────────────────
  BEGIN
    PERFORM public.log_sos_audit(
      p_action       => 'company_trial_started',
      p_actor        => v_user_id::text,
      p_actor_level  => 'owner',
      p_operation    => 'billing',
      p_target       => p_company_id::text,
      p_target_name  => NULL,
      p_metadata     => jsonb_build_object(
        'plan',           p_plan,
        'billing_cycle',  p_billing_cycle,
        'duration_days',  p_duration_days,
        'employee_limit', p_employee_limit,
        'zone_limit',     p_zone_limit,
        'trial_ends_at',  v_new.trial_ends_at
      ),
      p_company_id   => p_company_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[start_company_trial] audit log failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success',         true,
    'subscription_id', v_new.id,
    'plan',            v_new.plan,
    'tier',            v_new.tier,
    'status',          v_new.status,
    'trial_ends_at',   v_new.trial_ends_at,
    'duration_days',   p_duration_days,
    'billing_cycle',   v_new.billing_cycle,
    'employee_limit',  v_new.employee_limit,
    'zone_limit',      v_new.zone_limit
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[start_company_trial] unexpected error: %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'reason', 'internal_error');
END;
$function$;

REVOKE ALL ON FUNCTION public.start_company_trial(uuid, text, integer, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_company_trial(uuid, text, integer, text, integer, integer) TO authenticated;
COMMENT ON FUNCTION public.start_company_trial IS
  'AUTH-5: atomic owner-only company trial start. DPA-gated, idempotent via UNIQUE(company_id), one trial per company lifetime. Mirrors deadline to companies.trial_ends_at and writes billing audit entry.';

-- ═══════════════════════════════════════════════════════════════════════════
-- (5) cancel_company_trial() — owner cancels mid-trial (graceful)
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.cancel_company_trial(uuid);

CREATE OR REPLACE FUNCTION public.cancel_company_trial(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_user_id  uuid := auth.uid();
  v_updated  record;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  IF NOT public.is_company_owner(p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_owner');
  END IF;

  -- Set cancel_at_period_end so the trial runs to its natural end and
  -- THEN drops to inactive. Mirrors Stripe semantics — if they decide
  -- to upgrade before expiry, just unflip the bit.
  UPDATE public.subscriptions
     SET cancel_at_period_end = true,
         updated_at = now()
   WHERE company_id = p_company_id
     AND status = 'trialing'
     AND cancel_at_period_end = false
   RETURNING * INTO v_updated;

  IF v_updated.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_active_trial_to_cancel');
  END IF;

  BEGIN
    PERFORM public.log_sos_audit(
      p_action       => 'company_trial_cancelled',
      p_actor        => v_user_id::text,
      p_actor_level  => 'owner',
      p_operation    => 'billing',
      p_target       => p_company_id::text,
      p_target_name  => NULL,
      p_metadata     => jsonb_build_object(
        'will_end_at', v_updated.trial_ends_at
      ),
      p_company_id   => p_company_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[cancel_company_trial] audit failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success',     true,
    'will_end_at', v_updated.trial_ends_at,
    'status',      v_updated.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_company_trial(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_company_trial(uuid) TO authenticated;
COMMENT ON FUNCTION public.cancel_company_trial IS
  'AUTH-5: owner cancels mid-trial. Sets cancel_at_period_end so trial runs to natural expiry, then drops to inactive. Idempotent.';

-- ═══════════════════════════════════════════════════════════════════════════
-- (6) get_company_subscription_state() — readable by any active member
-- ═══════════════════════════════════════════════════════════════════════════
-- Owner-only fields (Stripe IDs) are stripped for non-owner callers so
-- employees can read plan / limits but not billing internals.
DROP FUNCTION IF EXISTS public.get_company_subscription_state(uuid);

CREATE OR REPLACE FUNCTION public.get_company_subscription_state(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $function$
DECLARE
  v_user_id   uuid := auth.uid();
  v_is_owner  boolean;
  v_member    boolean;
  v_sub       record;
  v_dpa_v     text;
  v_dpa_done  boolean;
  v_days_left numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  -- Active membership required (owner is also a member by convention).
  SELECT EXISTS (
    SELECT 1 FROM public.company_memberships
    WHERE company_id = p_company_id
      AND user_id    = v_user_id
      AND active     = true
  ) INTO v_member;
  IF NOT v_member THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_a_member');
  END IF;

  v_is_owner := public.is_company_owner(p_company_id);

  SELECT * INTO v_sub FROM public.subscriptions WHERE company_id = p_company_id LIMIT 1;

  v_dpa_v := public.current_dpa_version();
  SELECT EXISTS (
    SELECT 1 FROM public.company_dpa_acceptances
    WHERE company_id = p_company_id AND dpa_version = v_dpa_v
  ) INTO v_dpa_done;

  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object(
      'success',          true,
      'has_subscription', false,
      'is_owner',         v_is_owner,
      'dpa_version',      v_dpa_v,
      'dpa_accepted',     v_dpa_done
    );
  END IF;

  v_days_left := CASE
    WHEN v_sub.status = 'trialing' AND v_sub.trial_ends_at IS NOT NULL
      THEN GREATEST(0, EXTRACT(EPOCH FROM (v_sub.trial_ends_at - now())) / 86400.0)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'success',          true,
    'has_subscription', true,
    'is_owner',         v_is_owner,
    'plan',             v_sub.plan,
    'tier',             v_sub.tier,
    'status',           v_sub.status,
    'billing_cycle',    v_sub.billing_cycle,
    'employee_limit',   v_sub.employee_limit,
    'zone_limit',       v_sub.zone_limit,
    'trial_ends_at',    v_sub.trial_ends_at,
    'current_period_end', v_sub.current_period_end,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'days_left_in_trial', v_days_left,
    'dpa_version',      v_dpa_v,
    'dpa_accepted',     v_dpa_done,
    -- Owner-only Stripe IDs (NULL stripped for employees)
    'stripe_customer_id',     CASE WHEN v_is_owner THEN v_sub.stripe_customer_id END,
    'stripe_subscription_id', CASE WHEN v_is_owner THEN v_sub.stripe_subscription_id END,
    'stripe_price_id',        CASE WHEN v_is_owner THEN v_sub.stripe_price_id END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_company_subscription_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_subscription_state(uuid) TO authenticated;
COMMENT ON FUNCTION public.get_company_subscription_state IS
  'AUTH-5: read-only company subscription state. Active members see plan + trial countdown; only owners see Stripe IDs. Single source of truth for dashboard banners.';

-- ═══════════════════════════════════════════════════════════════════════════
-- (7) Verification
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='company_dpa_acceptances') THEN
    RAISE EXCEPTION 'company_dpa_acceptances missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='accept_company_dpa') THEN
    RAISE EXCEPTION 'accept_company_dpa missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='start_company_trial') THEN
    RAISE EXCEPTION 'start_company_trial missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='cancel_company_trial') THEN
    RAISE EXCEPTION 'cancel_company_trial missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_company_subscription_state') THEN
    RAISE EXCEPTION 'get_company_subscription_state missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_dpa_version') THEN
    RAISE EXCEPTION 'current_dpa_version missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='subscriptions_company_unique_idx') THEN
    RAISE EXCEPTION 'subscriptions company unique index missing';
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class
           WHERE relname='company_dpa_acceptances' AND relnamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'company_dpa_acceptances FORCE RLS not set';
  END IF;
  RAISE NOTICE 'AUTH-5 Phase 1 verification passed.';
END
$verify$;
