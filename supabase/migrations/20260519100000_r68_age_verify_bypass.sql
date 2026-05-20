-- ═══════════════════════════════════════════════════════════════════════════
-- R-68 (MOBILE_AUDIT_FINDINGS, 2026-05-19) — age verification trigger bypass
-- ─────────────────────────────────────────────────────────────────────────
-- ROOT CAUSE:
--   W3-37 (migration 20260502140243) extended the
--   block_sensitive_profile_changes trigger to also lock age fields
--   (age_verified_at, age_category, parental_consent_at). The comment in
--   that migration said "age fields stay locked regardless (compliance
--   - no bypass)" — but the legitimate path to set these fields is the
--   verify_user_age() RPC, which does direct UPDATE statements on those
--   fields. So in production:
--
--     1. User submits DOB in individual-register.tsx
--     2. Frontend calls supabase.rpc('verify_user_age', ...)
--     3. RPC executes UPDATE profiles SET age_category=..., age_verified_at=...
--     4. Trigger fires: W3-37: changing age fields is not allowed via direct UPDATE.
--     5. UI shows the error in red; user is stuck.
--
--   Confirmed by the mobile screenshot from a real Iraqi user attempting
--   signup on 2026-05-19.
--
-- ROOT FIX:
--   Add a third bypass session variable `app.allow_age_update` (same
--   pattern as the existing app.allow_role_update and
--   app.allow_membership_update). The trigger checks for it. ONLY the
--   verify_user_age RPC sets it. Compliance posture preserved: only that
--   one RPC (which is SECURITY DEFINER and audited) can change age
--   fields. Other paths still get the W3-37 exception.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.block_sensitive_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_allow_role       text;
  v_allow_membership text;
  v_allow_age        text;
BEGIN
  BEGIN
    v_allow_role := current_setting('app.allow_role_update', true);
  EXCEPTION WHEN OTHERS THEN v_allow_role := NULL; END;

  BEGIN
    v_allow_membership := current_setting('app.allow_membership_update', true);
  EXCEPTION WHEN OTHERS THEN v_allow_membership := NULL; END;

  BEGIN
    v_allow_age := current_setting('app.allow_age_update', true);
  EXCEPTION WHEN OTHERS THEN v_allow_age := NULL; END;

  -- role guard (unchanged)
  IF v_allow_role = 'true' AND new.role IS DISTINCT FROM old.role THEN
    NULL;
  ELSIF new.role IS DISTINCT FROM old.role THEN
    RAISE EXCEPTION 'W3-37: changing role is not allowed via direct UPDATE. Use the dedicated RPC.';
  END IF;

  -- membership guard
  IF v_allow_membership = 'true' THEN
    NULL;
  ELSIF new.user_type IS DISTINCT FROM old.user_type
     OR new.company_id IS DISTINCT FROM old.company_id
     OR new.active_company_id IS DISTINCT FROM old.active_company_id
  THEN
    RAISE EXCEPTION 'W3-37: changing user_type, company_id, or active_company_id is not allowed via direct UPDATE. Use the dedicated RPC.';
  END IF;

  -- age guard - R-68: now bypass-aware via app.allow_age_update.
  -- Only verify_user_age() RPC sets this flag. Any direct UPDATE from
  -- client code (or even another SECDEF function) still hits the block.
  IF v_allow_age = 'true' THEN
    NULL;
  ELSIF new.age_verified_at IS DISTINCT FROM old.age_verified_at
     OR new.age_category IS DISTINCT FROM old.age_category
     OR new.parental_consent_at IS DISTINCT FROM old.parental_consent_at
  THEN
    RAISE EXCEPTION 'W3-37: changing age fields is not allowed via direct UPDATE. Use verify_user_age RPC.';
  END IF;

  RETURN new;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Patch verify_user_age to set the bypass before its UPDATE statements.
-- The flag is LOCAL to the transaction — auto-reset at COMMIT/ROLLBACK.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.verify_user_age(
  p_dob               date,
  p_parental_contact  text default null
) returns jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_age        int;
  v_category   text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_dob IS NULL OR p_dob > current_date OR p_dob < '1900-01-01'::date THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_dob',
      'message', 'Please enter a valid date of birth.');
  END IF;

  v_age := public.compute_age(p_dob);

  IF v_age < 13 THEN
    v_category := 'under13';
  ELSIF v_age < 16 THEN
    v_category := '13to15';
  ELSE
    v_category := '16plus';
  END IF;

  BEGIN
    PERFORM public.log_sos_audit(
      'age_verification_attempt',
      v_user_id::text,
      'worker',
      'compliance',
      v_user_id::text,
      null,
      jsonb_build_object(
        'category', v_category,
        'age_year_only', extract(year from p_dob)::int,
        'parental_required', v_category = '13to15',
        'source', 'verify_user_age'
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- R-68: lift the W3-37 lock for the rest of THIS transaction so the
  -- UPDATE statements below can write age fields. set_config(..., true)
  -- = SET LOCAL semantics (auto-reset at txn end).
  PERFORM set_config('app.allow_age_update', 'true', true);

  IF v_category = 'under13' THEN
    UPDATE public.profiles
       SET age_category = 'under13',
           date_of_birth = p_dob
     WHERE id = v_user_id OR user_id = v_user_id;
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'under13',
      'message', 'SOSphere is not available for users under 13. Please ask a parent to set up an account on your behalf.'
    );
  END IF;

  IF v_category = '13to15' THEN
    IF p_parental_contact IS NULL OR length(trim(p_parental_contact)) < 5 THEN
      RETURN jsonb_build_object(
        'ok', true,
        'category', '13to15',
        'parental_consent_required', true,
        'message', 'A parent or guardian must approve this account. Please provide their email or phone number.'
      );
    END IF;
    UPDATE public.profiles
       SET date_of_birth       = p_dob,
           age_category        = '13to15',
           age_verified_at     = now(),
           parental_consent_at = now(),
           parental_contact    = p_parental_contact
     WHERE id = v_user_id OR user_id = v_user_id;
    RETURN jsonb_build_object(
      'ok', true,
      'category', '13to15',
      'parental_contact_recorded', true,
      'verified_at', now()
    );
  END IF;

  UPDATE public.profiles
     SET date_of_birth   = p_dob,
         age_category    = '16plus',
         age_verified_at = now()
   WHERE id = v_user_id OR user_id = v_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'category', '16plus',
    'verified_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.verify_user_age(date, text) IS
  'R-68 (2026-05-19): SECDEF RPC that sets app.allow_age_update before '
  'writing age fields, bypassing the W3-37 block_sensitive_profile_changes '
  'trigger. This is the SINGLE legitimate path to set age_verified_at, '
  'age_category, parental_consent_at. All other UPDATEs still get blocked.';
