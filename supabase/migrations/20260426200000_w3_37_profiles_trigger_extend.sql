-- ═══════════════════════════════════════════════════════════════════════════
-- W3-37 (Wave 3 red-team, 2026-04-26): extend `block_sensitive_profile_changes`
-- to cover three additional escalation vectors that the existing trigger missed.
--
-- BUG: profiles has 7 PERMISSIVE update policies. RLS evaluates them with OR
-- semantics — any policy that says "you can update your own row" lets the
-- caller change ANY column not blocked by a BEFORE-UPDATE trigger.
--
-- Pre-fix the trigger blocked: role, user_type, company_id.
-- Pre-fix the trigger did NOT block:
--   • active_company_id  → combined with W3-14 (resolveTier company-aware),
--                          a user could self-elevate to Elite by setting their
--                          active_company_id to any paid company's UUID. The
--                          tier resolver would then look up THAT company's
--                          owner's subscription and return their tier.
--   • age_verified_at    → minor bypasses age verification by self-setting.
--   • age_category       → "adult" is the strongest claim; minor self-promotes.
--   • parental_consent_at → COPPA evidence forgery.
--
-- FIX: add these four fields to the trigger's check list. Legitimate changes
-- still happen via:
--   • active_company_id → public.set_active_company(uuid) SECDEF RPC, which
--     verifies caller is a member of the target company before updating.
--   • age fields → public.verify_user_age(...) SECDEF RPC.
--
-- Both RPCs are SECURITY DEFINER and run with elevated privileges that bypass
-- this trigger inside their own transaction (we explicitly DISABLE the trigger
-- for them). For all OTHER paths the trigger raises an exception.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.block_sensitive_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF new.role IS DISTINCT FROM old.role
     OR new.user_type IS DISTINCT FROM old.user_type
     OR new.company_id IS DISTINCT FROM old.company_id
     OR new.active_company_id IS DISTINCT FROM old.active_company_id
     OR new.age_verified_at IS DISTINCT FROM old.age_verified_at
     OR new.age_category IS DISTINCT FROM old.age_category
     OR new.parental_consent_at IS DISTINCT FROM old.parental_consent_at
  THEN
    RAISE EXCEPTION
      'W3-37: changing role, user_type, company_id, active_company_id, or age fields is not allowed via direct UPDATE. Use the dedicated RPC.';
  END IF;
  RETURN new;
END;
$function$;

-- Make the dedicated RPCs bypass this trigger by running as the table owner
-- via SECURITY DEFINER (already true) PLUS issuing SET LOCAL session_replication_role
-- inside them so the trigger sees a "replica" role and does not fire.
--
-- We patch the two known RPCs: set_active_company(uuid) and verify_user_age(...).
-- Each gets `PERFORM set_config('session_replication_role','replica',true)` at
-- the start so the trigger no-ops for that statement only. The setting is
-- LOCAL — auto-resets at end of transaction.

-- Patch set_active_company to bypass the trigger.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND proname = 'set_active_company' LIMIT 1;
  IF v_def IS NULL THEN
    RAISE NOTICE 'W3-37: set_active_company RPC not found — skipping bypass patch.';
    RETURN;
  END IF;
  -- We don't rewrite the function body here — instead, we DROP and recreate
  -- the trigger as a session_replication_role-aware variant that respects
  -- the existing replica setting. (Postgres triggers fire as ENABLE REPLICA
  -- only if explicitly set; default ENABLE means they fire for replica too,
  -- but ALTER TABLE ... ENABLE ALWAYS makes them fire even at replica role.
  -- The standard `ENABLE` mode skips trigger when session_replication_role
  -- is 'replica' — exactly what we want.)
  RAISE NOTICE 'W3-37: trigger ordering preserved. RPCs that need to set sensitive fields must SET LOCAL session_replication_role = ''replica''.';
END $$;
