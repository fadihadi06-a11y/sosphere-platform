-- ═══════════════════════════════════════════════════════════════════════════
-- L5-SEC-9b (2026-05-12): verify_audit_chain refuses verification when
-- post-L2D-cutoff rows have row_hash IS NULL
-- ─────────────────────────────────────────────────────────────────────────
-- THREAT (Low, pre-launch security review)
--   verify_audit_chain currently iterates only rows WHERE row_hash IS NOT NULL,
--   silently skipping legacy / NULL-hash rows. The original intent was
--   to allow pre-L2D rows (which existed before the chain trigger was
--   installed) to coexist with post-cutoff hashed rows.
--
--   But: a service_role attacker (or a future migration bug) could
--   INSERT a backdated row with row_hash = NULL and verify_audit_chain
--   would return verified: true — the row gets hidden from the
--   integrity check.
--
-- FIX
--   Add a guard: BEFORE iterating, check whether any row with
--   created_at >= the L2-D cutoff (2026-05-09, when the chain trigger
--   was installed) has row_hash IS NULL. If yes, return verified: false
--   with reason = 'post_cutoff_null_hash_row_present'.
--
--   Pre-cutoff legacy rows continue to be silently skipped — they
--   pre-date the chain by design.
--
-- COMPATIBILITY
--   * Existing pre-cutoff rows are still skipped — no false positives
--     on historical data.
--   * Post-cutoff rows MUST have a row_hash (the trigger fires
--     BEFORE INSERT, so this is enforced automatically for normal
--     inserts). A NULL post-cutoff row could only appear if someone
--     bypasses the trigger — which is exactly the threat we're
--     guarding against.
--   * Same SECDEF + caller-admin-check semantics preserved.
--
-- THE CUTOFF
--   Hard-coded to 2026-05-09 (the date the L2-D hash chain migration
--   ran in production). Future migrations that re-install or alter
--   the chain should leave this cutoff alone — it documents the
--   historical boundary.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.verify_audit_chain(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_caller          uuid := auth.uid();
  v_is_admin        boolean := false;
  v_legacy_cutoff   timestamptz := '2026-05-09 00:00:00+00';
  v_post_cutoff_null int;
  v_row             public.audit_log%ROWTYPE;
  v_expected_prev   text := NULL;
  v_expected_hash   text;
  v_canon           text;
  v_index           int := 0;
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

  -- L5-SEC-9b: refuse to verify when a post-cutoff row has NULL row_hash.
  -- That state can only arise from a trigger bypass — pretending the
  -- chain is "verified" while hiding such rows would defeat the
  -- forensic guarantee.
  SELECT count(*) INTO v_post_cutoff_null
  FROM public.audit_log
  WHERE company_id IS NOT DISTINCT FROM p_company_id
    AND created_at >= v_legacy_cutoff
    AND row_hash IS NULL;
  IF v_post_cutoff_null > 0 THEN
    RETURN jsonb_build_object(
      'verified',                       false,
      'reason',                         'post_cutoff_null_hash_row_present',
      'post_cutoff_null_hash_row_count', v_post_cutoff_null,
      'cutoff',                         v_legacy_cutoff
    );
  END IF;

  FOR v_row IN
    SELECT *
      FROM public.audit_log
     WHERE company_id IS NOT DISTINCT FROM p_company_id
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
$function$;

COMMENT ON FUNCTION public.verify_audit_chain(uuid) IS
  'L5-SEC-9b (2026-05-12): pre-iteration guard rejects verification when '
  'any post-cutoff (2026-05-09+) row has row_hash IS NULL. Pre-cutoff '
  'legacy rows continue to be silently skipped.';
