-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — L2-D fix-up: deterministic chain order via dedicated sequence
-- ────────────────────────────────────────────────────────────────────────
-- BUG DISCOVERED IN SMOKE TEST
--   Three INSERTs in the same transaction share the same now()
--   (transaction_timestamp). The original trigger ordered by
--   (created_at DESC, id DESC) to find the chain tail — but inside one
--   transaction, all rows have identical created_at, so the tie-breaker
--   was the lexicographically-largest random id. That picks rows in
--   essentially random order rather than insertion order, and the chain
--   forks: row 3 chains back to row 1 instead of row 2.
--
-- ROOT CAUSE
--   `now()` is transaction-scoped by design (good for compliance). The
--   chain needs an INSERTION-order signal that survives "many inserts in
--   one transaction" — a property `created_at` cannot provide.
--
-- FIX
--   PostgreSQL sequences are NOT transactional and produce a strictly
--   monotonic value per call. Add `chain_seq bigint DEFAULT nextval(...)`
--   so every INSERT — same transaction or not — gets a unique
--   higher-than-everything-before number. Trigger uses that as the
--   ordering key for the tail lookup.
--
-- WHY A FIX-UP MIGRATION INSTEAD OF EDITING THE PREVIOUS FILE
--   The original migration is already on production. Editing the file
--   in git would create drift between git-truth and prod-truth and the
--   migration drift CI guard would fail. Forward-only fix-up is the
--   correct pattern.
--
-- ROLLBACK
--   -- Restore the prior trigger function & verify RPC body, drop the
--   -- column. See the original 20260509171557 migration for the
--   -- earlier shape.
--   ALTER TABLE public.audit_log DROP COLUMN IF EXISTS chain_seq;
--   DROP SEQUENCE IF EXISTS public.audit_log_chain_seq;
-- ════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS public.audit_log_chain_seq;

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS chain_seq bigint NOT NULL DEFAULT nextval('public.audit_log_chain_seq');

COMMENT ON COLUMN public.audit_log.chain_seq IS
  'L2-D: per-row sequence for chain insertion order. Used by trigger + verify RPC instead of (created_at, id) so multiple inserts in the same transaction can never fork the chain.';

DROP INDEX IF EXISTS public.idx_audit_log_company_chain_tail;
CREATE INDEX IF NOT EXISTS idx_audit_log_company_chain_tail
  ON public.audit_log (company_id, chain_seq DESC)
  WHERE row_hash IS NOT NULL;

-- ── Replace trigger function — chain_seq becomes the ordering key ──
CREATE OR REPLACE FUNCTION public._audit_log_compute_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_lock_key bigint;
  v_prev     text;
  v_canon    text;
BEGIN
  v_lock_key := hashtextextended(coalesce(NEW.company_id::text, '__global__'), 42);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Order by chain_seq DESC: PostgreSQL sequences are non-transactional and
  -- monotonic, so this is the only deterministic insertion-order signal we
  -- have. Two inserts in the same transaction get DIFFERENT chain_seq values.
  SELECT row_hash
    INTO v_prev
    FROM public.audit_log
   WHERE company_id IS NOT DISTINCT FROM NEW.company_id
     AND row_hash IS NOT NULL
     AND chain_seq < NEW.chain_seq
   ORDER BY chain_seq DESC
   LIMIT 1;

  NEW.prev_hash := v_prev;

  -- Canonical serialization — see the original migration for the rationale.
  -- chain_seq is now part of the canonical input so reordering rows breaks
  -- the chain even if all other fields stay identical.
  v_canon :=
       coalesce(NEW.id, '')                  || E'\x1f'
    || coalesce(NEW.action, '')              || E'\x1f'
    || coalesce(NEW.actor, '')               || E'\x1f'
    || coalesce(NEW.actor_id, '')            || E'\x1f'
    || coalesce(NEW.actor_role, '')          || E'\x1f'
    || coalesce(NEW.actor_name, '')          || E'\x1f'
    || coalesce(NEW.operation, '')           || E'\x1f'
    || coalesce(NEW.target, '')              || E'\x1f'
    || coalesce(NEW.target_id, '')           || E'\x1f'
    || coalesce(NEW.target_name, '')         || E'\x1f'
    || coalesce(NEW.target_role, '')         || E'\x1f'
    || coalesce(NEW.metadata::text, '')      || E'\x1f'
    || coalesce(NEW.before_value, '')        || E'\x1f'
    || coalesce(NEW.after_value, '')         || E'\x1f'
    || coalesce(NEW.zone, '')                || E'\x1f'
    || coalesce(NEW.ip_address::text, '')    || E'\x1f'
    || coalesce(NEW.device_info, '')         || E'\x1f'
    || coalesce(NEW.severity, '')            || E'\x1f'
    || coalesce(NEW.verified_2fa::text, '')  || E'\x1f'
    || coalesce(NEW.client_timestamp::text, '') || E'\x1f'
    || coalesce(NEW.trace_id::text, '')      || E'\x1f'
    || coalesce(NEW.company_id::text, '')    || E'\x1f'
    || coalesce(NEW.created_at::text, '')    || E'\x1f'
    || coalesce(NEW.chain_seq::text, '')     || E'\x1f'
    || coalesce(NEW.prev_hash, '__GENESIS__');

  NEW.row_hash := encode(extensions.digest(v_canon, 'sha256'), 'hex');

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._audit_log_compute_hash_chain() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._audit_log_compute_hash_chain() FROM anon, authenticated;

-- ── Replace verify RPC — chain_seq ordering for replay ──
CREATE OR REPLACE FUNCTION public.verify_audit_chain(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'pg_temp'
STABLE
AS $$
DECLARE
  v_caller        uuid := auth.uid();
  v_is_admin      boolean := false;
  v_row           public.audit_log%ROWTYPE;
  v_expected_prev text := NULL;
  v_expected_hash text;
  v_canon         text;
  v_index         int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized: must be logged in';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.company_memberships
    WHERE user_id    = v_caller
      AND company_id = p_company_id
      AND active     = true
      AND role IN ('admin','owner')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'unauthorized: caller is not an active admin/owner of this company';
  END IF;

  FOR v_row IN
    SELECT *
      FROM public.audit_log
     WHERE company_id = p_company_id
       AND row_hash IS NOT NULL
     ORDER BY chain_seq ASC
  LOOP
    v_index := v_index + 1;

    IF v_row.prev_hash IS DISTINCT FROM v_expected_prev THEN
      RETURN jsonb_build_object(
        'verified',          false,
        'tampered_at_index', v_index,
        'tampered_row_id',   v_row.id,
        'reason',            'prev_hash mismatch — a row was deleted, reordered, or the chain was forked',
        'expected_prev',     v_expected_prev,
        'actual_prev',       v_row.prev_hash
      );
    END IF;

    -- KEEP THIS FIELD LIST IN SYNC WITH _audit_log_compute_hash_chain.
    v_canon :=
         coalesce(v_row.id, '')                  || E'\x1f'
      || coalesce(v_row.action, '')              || E'\x1f'
      || coalesce(v_row.actor, '')               || E'\x1f'
      || coalesce(v_row.actor_id, '')            || E'\x1f'
      || coalesce(v_row.actor_role, '')          || E'\x1f'
      || coalesce(v_row.actor_name, '')          || E'\x1f'
      || coalesce(v_row.operation, '')           || E'\x1f'
      || coalesce(v_row.target, '')              || E'\x1f'
      || coalesce(v_row.target_id, '')           || E'\x1f'
      || coalesce(v_row.target_name, '')         || E'\x1f'
      || coalesce(v_row.target_role, '')         || E'\x1f'
      || coalesce(v_row.metadata::text, '')      || E'\x1f'
      || coalesce(v_row.before_value, '')        || E'\x1f'
      || coalesce(v_row.after_value, '')         || E'\x1f'
      || coalesce(v_row.zone, '')                || E'\x1f'
      || coalesce(v_row.ip_address::text, '')    || E'\x1f'
      || coalesce(v_row.device_info, '')         || E'\x1f'
      || coalesce(v_row.severity, '')            || E'\x1f'
      || coalesce(v_row.verified_2fa::text, '')  || E'\x1f'
      || coalesce(v_row.client_timestamp::text, '') || E'\x1f'
      || coalesce(v_row.trace_id::text, '')      || E'\x1f'
      || coalesce(v_row.company_id::text, '')    || E'\x1f'
      || coalesce(v_row.created_at::text, '')    || E'\x1f'
      || coalesce(v_row.chain_seq::text, '')     || E'\x1f'
      || coalesce(v_row.prev_hash, '__GENESIS__');

    v_expected_hash := encode(extensions.digest(v_canon, 'sha256'), 'hex');

    IF v_row.row_hash IS DISTINCT FROM v_expected_hash THEN
      RETURN jsonb_build_object(
        'verified',          false,
        'tampered_at_index', v_index,
        'tampered_row_id',   v_row.id,
        'reason',            'row_hash mismatch — at least one column on this row was edited after insertion',
        'expected_hash',     v_expected_hash,
        'actual_hash',       v_row.row_hash
      );
    END IF;

    v_expected_prev := v_row.row_hash;
  END LOOP;

  RETURN jsonb_build_object(
    'verified',      true,
    'rows_verified', v_index,
    'tail_hash',     v_expected_prev,
    'verified_at',   now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_audit_chain(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_audit_chain(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.verify_audit_chain(uuid) TO authenticated;
