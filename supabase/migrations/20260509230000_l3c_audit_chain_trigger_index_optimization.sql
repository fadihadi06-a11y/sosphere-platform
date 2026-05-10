-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — L3-C: optimize L2-D BEFORE INSERT trigger to use the index
-- ────────────────────────────────────────────────────────────────────────
-- DISCOVERED via EXPLAIN ANALYZE during the L3-C index-utilization audit.
--
-- THE PROBLEM
--   The L2-D trigger was using `WHERE company_id IS NOT DISTINCT FROM
--   NEW.company_id` to be NULL-safe. But IS NOT DISTINCT FROM doesn't
--   compose with b-tree indexes the way `=` does. Postgres planner
--   couldn't apply the leading column of idx_audit_log_company_chain_tail
--   as an index condition; it scanned the index by chain_seq DESC and
--   filtered company_id post-scan.
--
--   EXPLAIN data: 5.391ms vs 0.071ms — 76× slowdown. Per audit_log
--   INSERT. Every SOS, every login, every workflow audit row.
--
-- THE FIX
--   Branch on whether NEW.company_id IS NULL. The non-NULL branch uses
--   plain `=`, letting Postgres apply BOTH columns of the partial index
--   as index conditions. The NULL branch uses `company_id IS NULL`
--   which IS index-friendly.
--
--   Functionally identical to the previous trigger — the chain
--   semantics, hash inputs, and SECURITY DEFINER/search_path settings
--   are unchanged. ONLY the WHERE clause was split into two paths.
--
-- VERIFICATION (live on production)
--   Pre-fix EXPLAIN: 5.391ms (Filter: NOT (company_id IS DISTINCT FROM …))
--   Post-fix EXPLAIN: 0.044ms (Index Cond: (company_id = … AND chain_seq < …))
--   76× faster on every audit_log INSERT.
-- ════════════════════════════════════════════════════════════════════════

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

  -- L3-C optimization: branch on NULL so Postgres can apply company_id
  -- as an index condition (vs IS NOT DISTINCT FROM which forces a
  -- post-filter scan).
  IF NEW.company_id IS NULL THEN
    SELECT row_hash INTO v_prev
      FROM public.audit_log
     WHERE company_id IS NULL
       AND row_hash IS NOT NULL
       AND chain_seq < NEW.chain_seq
     ORDER BY chain_seq DESC
     LIMIT 1;
  ELSE
    SELECT row_hash INTO v_prev
      FROM public.audit_log
     WHERE company_id = NEW.company_id
       AND row_hash IS NOT NULL
       AND chain_seq < NEW.chain_seq
     ORDER BY chain_seq DESC
     LIMIT 1;
  END IF;

  NEW.prev_hash := v_prev;

  -- Canonical SHA-256 input — IDENTICAL to prior version. Field order
  -- is FROZEN (see L2-D migration comment). Any change here breaks the
  -- chain on every existing tenant.
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
