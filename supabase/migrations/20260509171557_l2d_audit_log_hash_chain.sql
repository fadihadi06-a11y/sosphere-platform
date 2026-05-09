-- ════════════════════════════════════════════════════════════════════════
-- SOSphere — L2-D: Append-only audit log with hash chain (S-13)
-- ────────────────────────────────────────────────────────────────────────
-- Layer 2 of the life-safety foundation pyramid (LIFE_SAFETY_FOUNDATION.md).
-- The first piece of L2 because every other piece relies on audit_log
-- being tamper-evident: if the log itself can be edited, all forensic
-- verification downstream is meaningless.
--
-- WHAT THIS DOES
--   1. Adds two columns to public.audit_log:
--        prev_hash  text  — SHA-256 of the prior row in this company's chain
--        row_hash   text  — SHA-256 of (this row's canonical fields ‖ prev_hash)
--   2. BEFORE INSERT trigger fills both automatically. Every write — from
--      any of the 14 SECURITY DEFINER RPCs that touch audit_log — gets
--      hashed without code changes anywhere else.
--   3. Per-tenant advisory lock prevents concurrent inserts from forking
--      the chain. Different companies hash in parallel.
--   4. verify_audit_chain(company_id) RPC re-walks the chain, recomputes
--      every row_hash, and returns the first divergence (or NULL if
--      the chain is intact).
--
-- WHAT THIS DOES NOT DO (out of scope for this migration)
--   • Backfill existing 379 rows. They stay row_hash=NULL = "pre-chain
--     legacy". The verify RPC skips them. A separate one-time backfill
--     can chain them retroactively if/when needed.
--   • Block UPDATE/DELETE on audit_log. Append-only enforcement is a
--     separate concern (retention cleanup must still work). The hash
--     chain detects tampering after the fact, which is the actual S-13
--     requirement.
--
-- THREAT MODEL
--   The chain protects against:
--     • Service-role access editing a row in place (any field change →
--       row_hash mismatch on verify).
--     • Service-role access DELETING a row (next row's prev_hash points
--       to the deleted row's hash → mismatch).
--     • Service-role access INSERTING a backdated row (any insert is
--       only chainable at the tail; back-inserting forks the chain).
--
--   It does NOT protect against:
--     • Truncating the WHOLE chain and starting over. Mitigation: the
--       tail hash is meant to be exported to an external WORM store on
--       a schedule. Out of scope here.
--     • Rewriting the trigger function itself. Mitigation: trigger
--       function is SECURITY DEFINER + locked search_path; modifying
--       it requires superuser, which is a separate audit boundary.
--
-- CRITICAL INVARIANT
--   The canonical-serialization field list MUST stay in sync between
--   the trigger function and the verify RPC. Adding a new column to
--   audit_log later requires updating both — otherwise the chain breaks.
--   The architectural test in
--   src/app/components/__tests__/l2d-audit-hash-chain-invariants.test.ts
--   asserts both functions reference the same set of columns.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.verify_audit_chain(uuid);
--   DROP TRIGGER  IF EXISTS audit_log_hash_chain ON public.audit_log;
--   DROP FUNCTION IF EXISTS public._audit_log_compute_hash_chain();
--   ALTER TABLE   public.audit_log DROP COLUMN IF EXISTS prev_hash;
--   ALTER TABLE   public.audit_log DROP COLUMN IF EXISTS row_hash;
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Schema ─────────────────────────────────────────────────────
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS prev_hash text,
  ADD COLUMN IF NOT EXISTS row_hash  text;

COMMENT ON COLUMN public.audit_log.prev_hash IS
  'L2-D: SHA-256 hex of the immediately-prior row in this company''s chain. NULL on the first row of each company''s chain (genesis). Set automatically by the audit_log_hash_chain BEFORE INSERT trigger.';

COMMENT ON COLUMN public.audit_log.row_hash IS
  'L2-D: SHA-256 hex of (canonical(this row) ‖ prev_hash). NULL = pre-chain legacy row inserted before this migration. Set automatically by the audit_log_hash_chain BEFORE INSERT trigger.';

-- Index speeds up the "find tail of this company's chain" lookup the
-- trigger does on every insert. row_hash IS NOT NULL filters out the
-- pre-chain rows so the tail lookup goes O(1) on the partial index.
CREATE INDEX IF NOT EXISTS idx_audit_log_company_chain_tail
  ON public.audit_log (company_id, created_at DESC, id DESC)
  WHERE row_hash IS NOT NULL;

-- ── 2. Trigger function ───────────────────────────────────────────
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
  -- Per-company advisory lock. Two writes for the SAME company serialize
  -- through this lock — neither can compute prev_hash until the other
  -- commits. Two writes for DIFFERENT companies hash in parallel.
  -- The literal '__global__' partitions rows with company_id=NULL into
  -- their own chain (platform-level events).
  v_lock_key := hashtextextended(coalesce(NEW.company_id::text, '__global__'), 42);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Tail of this company's chain. We exclude row_hash IS NULL rows so the
  -- pre-chain legacy 379 rows don't pollute the lookup.
  SELECT row_hash
    INTO v_prev
    FROM public.audit_log
   WHERE company_id IS NOT DISTINCT FROM NEW.company_id
     AND row_hash IS NOT NULL
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  NEW.prev_hash := v_prev;  -- NULL = genesis row of this company's chain

  -- ──────────────────────────────────────────────────────────────────
  -- CANONICAL SERIALIZATION
  -- Every column that matters for forensic review goes in. Joined by
  -- ASCII Unit Separator (\x1f) so an attacker can't construct two
  -- semantically-different rows that produce the same canonical form
  -- (E.g. by abusing field separators inside metadata.text).
  --
  -- Field order is FROZEN. Adding a new column to audit_log later
  -- requires:
  --   (a) appending it here AND in verify_audit_chain
  --   (b) bumping the architectural test
  --   (c) accepting that newly-added rows hash differently than legacy
  --       rows — which is fine because legacy rows had row_hash=NULL.
  --
  -- The ALL-CAPS '__GENESIS__' marker for null prev_hash is intentional:
  -- a genuine SHA-256 hex string is 64 chars [0-9a-f] so '__GENESIS__'
  -- is unambiguously not a hash and can't collide with a real prev.
  -- ──────────────────────────────────────────────────────────────────
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
    || coalesce(NEW.prev_hash, '__GENESIS__');

  NEW.row_hash := encode(extensions.digest(v_canon, 'sha256'), 'hex');

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public._audit_log_compute_hash_chain() IS
  'L2-D internal: BEFORE INSERT hook on audit_log that fills prev_hash + row_hash. Per-company advisory lock prevents fork. Field order is FROZEN — see verify_audit_chain for the matching reader.';

-- Underscore-prefixed function is internal — only the trigger should
-- ever call it. REVOKE everything from PUBLIC + roles to make that
-- explicit.
REVOKE EXECUTE ON FUNCTION public._audit_log_compute_hash_chain() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._audit_log_compute_hash_chain() FROM anon, authenticated;

-- ── 3. Trigger wiring ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_log_hash_chain ON public.audit_log;
CREATE TRIGGER audit_log_hash_chain
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public._audit_log_compute_hash_chain();

-- ── 4. Verify RPC ─────────────────────────────────────────────────
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
  -- Gate 1: must be authenticated.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized: must be logged in';
  END IF;

  -- Gate 2: must be an active admin/owner OF THIS SPECIFIC COMPANY.
  -- Cross-tenant verify is rejected — even an admin of company A cannot
  -- verify company B's chain.
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

  -- Walk the chain in insertion order, recompute each row_hash, compare
  -- with what's stored. First divergence wins — return immediately so we
  -- don't waste cycles on a known-broken chain.
  FOR v_row IN
    SELECT *
      FROM public.audit_log
     WHERE company_id = p_company_id
       AND row_hash IS NOT NULL  -- skip pre-chain legacy rows
     ORDER BY created_at ASC, id ASC
  LOOP
    v_index := v_index + 1;

    -- (a) does this row's prev_hash match the previous row's row_hash?
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

    -- (b) does this row's row_hash match a fresh hash of its content?
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

  -- Whole chain is intact.
  RETURN jsonb_build_object(
    'verified',      true,
    'rows_verified', v_index,
    'tail_hash',     v_expected_prev,
    'verified_at',   now()
  );
END;
$$;

COMMENT ON FUNCTION public.verify_audit_chain(uuid) IS
  'L2-D: re-walks the company-scoped audit_log chain and returns first divergence (or {verified:true, tail_hash, rows_verified}). Admin/owner only via internal company_memberships check. The tail_hash is the value to export to an external WORM store on a schedule for off-system anchoring.';

-- Defense in depth — internal admin check is the real gate, but
-- explicitly REVOKE from public/anon as well.
REVOKE EXECUTE ON FUNCTION public.verify_audit_chain(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_audit_chain(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.verify_audit_chain(uuid) TO authenticated;
