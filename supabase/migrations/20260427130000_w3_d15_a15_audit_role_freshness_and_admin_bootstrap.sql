-- ═══════════════════════════════════════════════════════════════════════════
-- D-15 + A-15 / W3 TIER 2 (2026-04-27)
--
-- ────────────────────────────────────────────────────────────────────────
-- D-15: audit_log JWT-claim trust during stale TTL
--
-- BUG: log_sos_audit accepted p_actor_level from the caller and stamped
-- audit_log.actor_role verbatim. When a user has been demoted in DB
-- (admin → employee, or banned) but their JWT hasn't yet expired (~1h
-- TTL), every action they take was recorded with the OLD role —
-- obscuring the forensic trail at exactly the moment we most want to
-- see "did this attacker keep using their stale token?".
--
-- FIX: log_sos_audit now revalidates the role from public.profiles at
-- write time. If p_actor parses as a UUID, we look up the LIVE role
-- and override the caller-supplied claim. The override is recorded in
-- metadata.actor_role_source so post-hoc analysis can see whether the
-- row trusted the claim (legacy) or revalidated (post-D-15).
--
-- ────────────────────────────────────────────────────────────────────────
-- A-15: promote_user_to_admin "service-role bootstrap" branch
--
-- BUG: when auth.uid() IS NULL (service_role context), the function
-- silently granted admin to ANY p_user_id with NO further checks.
-- Intended for first-time bootstrap but had no guard against
--    (a) being called when admins already exist (escalation vector)
--    (b) leaked service_role key + this RPC = instant admin takeover
--
-- FIX: split into two RPCs.
--   - promote_user_to_admin (TIGHTENED): auth.uid() MUST be non-null
--     AND must be admin/super_admin. No service-role bypass at all.
--   - promote_first_admin (NEW): only callable by service_role; refuses
--     if any admin already exists; one-shot setup function.
--
-- W3-37 trigger update: the "block_sensitive_profile_changes" trigger
-- previously rejected ALL role updates, breaking the legitimate
-- promote RPCs. We add a session-variable bypass (app.allow_role_update)
-- that ONLY the SECDEF promote RPCs set; outside those RPCs the block
-- still applies exactly as W3-37 intended.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── D-15: rebuild log_sos_audit with role freshness ───────────
CREATE OR REPLACE FUNCTION public.log_sos_audit(
  p_action text,
  p_actor text,
  p_actor_level text DEFAULT 'worker',
  p_operation text DEFAULT 'sos',
  p_target text DEFAULT NULL,
  p_target_name text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_company_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id text;
  v_resolved_company uuid := p_company_id;
  v_actor_uuid uuid;
  v_fresh_role text := NULL;
  v_resolved_role text;
  v_role_source text := 'claim';
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  v_id := 'AUD-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISSMS')
       || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  IF p_actor IS NOT NULL THEN
    BEGIN
      v_actor_uuid := p_actor::uuid;
    EXCEPTION WHEN OTHERS THEN v_actor_uuid := NULL; END;
  END IF;

  IF v_resolved_company IS NULL AND v_actor_uuid IS NOT NULL THEN
    SELECT active_company_id INTO v_resolved_company
      FROM public.profiles WHERE id = v_actor_uuid LIMIT 1;
  END IF;

  -- D-15 FIX: re-read the actor's CURRENT role from profiles. Override
  -- the client-supplied claim if a fresh role is found.
  IF v_actor_uuid IS NOT NULL THEN
    SELECT role INTO v_fresh_role FROM public.profiles
      WHERE id = v_actor_uuid OR user_id = v_actor_uuid LIMIT 1;
    IF v_fresh_role IS NOT NULL AND length(trim(v_fresh_role)) > 0 THEN
      v_resolved_role := v_fresh_role;
      v_role_source := 'fresh';
    ELSE
      v_resolved_role := COALESCE(p_actor_level, 'worker');
      v_role_source := 'fallback';
    END IF;
  ELSE
    v_resolved_role := COALESCE(p_actor_level, 'worker');
    v_role_source := 'no_actor_uuid';
  END IF;

  v_metadata := jsonb_set(v_metadata, '{actor_role_source}',
                          to_jsonb(v_role_source), true);
  IF v_role_source = 'fresh' AND v_fresh_role IS DISTINCT FROM p_actor_level THEN
    v_metadata := jsonb_set(v_metadata, '{stale_role_claim}',
                            to_jsonb(p_actor_level), true);
  END IF;

  INSERT INTO public.audit_log
    (id, action, actor, actor_role, operation, target, target_name,
     metadata, created_at, category, severity, actor_name, detail,
     target_id, client_timestamp, company_id)
  VALUES
    (v_id, p_action, COALESCE(p_actor, 'system'),
     v_resolved_role, COALESCE(p_operation, 'sos'),
     p_target, p_target_name, v_metadata, now(),
     'emergency', COALESCE(v_metadata->>'severity', 'info'),
     p_actor, COALESCE(v_metadata->>'reason', v_metadata->>'detail', null),
     p_target, now(), v_resolved_company);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_sos_audit(text,text,text,text,text,text,jsonb,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_sos_audit(text,text,text,text,text,text,jsonb,uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.log_sos_audit(text,text,text,text,text,text,jsonb,uuid) TO service_role;

-- ─── A-15 / W3-37 trigger update — session-variable bypass ─────
CREATE OR REPLACE FUNCTION public.block_sensitive_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_allow_role text;
BEGIN
  BEGIN
    v_allow_role := current_setting('app.allow_role_update', true);
  EXCEPTION WHEN OTHERS THEN v_allow_role := NULL; END;

  IF v_allow_role = 'true' AND new.role IS DISTINCT FROM old.role THEN
    NULL;  -- legitimate role-update RPC bypass
  ELSIF new.role IS DISTINCT FROM old.role THEN
    RAISE EXCEPTION 'W3-37: changing role is not allowed via direct UPDATE. Use the dedicated RPC.';
  END IF;

  IF new.user_type IS DISTINCT FROM old.user_type
     OR new.company_id IS DISTINCT FROM old.company_id
     OR new.active_company_id IS DISTINCT FROM old.active_company_id
     OR new.age_verified_at IS DISTINCT FROM old.age_verified_at
     OR new.age_category IS DISTINCT FROM old.age_category
     OR new.parental_consent_at IS DISTINCT FROM old.parental_consent_at
  THEN
    RAISE EXCEPTION 'W3-37: changing user_type, company_id, active_company_id, or age fields is not allowed via direct UPDATE. Use the dedicated RPC.';
  END IF;

  RETURN new;
END;
$function$;

-- ─── A-15: tighten promote_user_to_admin ───────────────────────
CREATE OR REPLACE FUNCTION public.promote_user_to_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_role text;
BEGIN
  -- A-15 FIX: NO MORE service-role bypass. Caller MUST be an
  -- authenticated existing admin. Bootstrap is now handled by the
  -- separate promote_first_admin RPC below.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION '[A-15] promote_user_to_admin requires authenticated admin caller'
      USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role
    FROM public.profiles WHERE id = v_caller OR user_id = v_caller LIMIT 1;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '[A-15] forbidden: only existing admins may promote users'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.allow_role_update', 'true', true);
  UPDATE public.profiles SET role = 'admin' WHERE id = p_user_id;
  PERFORM set_config('app.allow_role_update', '', true);
END $function$;

REVOKE EXECUTE ON FUNCTION public.promote_user_to_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_user_to_admin(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.promote_user_to_admin(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.promote_user_to_admin(uuid) TO service_role;

-- ─── A-15: NEW guarded bootstrap RPC ───────────────────────────
CREATE OR REPLACE FUNCTION public.promote_first_admin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_existing_admins int;
BEGIN
  -- A-15 GUARD: refuse if any admin already exists.
  SELECT COUNT(*) INTO v_existing_admins
    FROM public.profiles
   WHERE role IN ('admin', 'super_admin');
  IF v_existing_admins > 0 THEN
    RAISE EXCEPTION '[A-15] promote_first_admin refused: % admin(s) already exist', v_existing_admins
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.allow_role_update', 'true', true);
  UPDATE public.profiles SET role = 'admin' WHERE id = p_user_id;
  PERFORM set_config('app.allow_role_update', '', true);

  -- Audit the bootstrap event so we have a forensic record.
  INSERT INTO public.audit_log
    (id, action, actor, actor_role, operation, target, metadata,
     created_at, category, severity, company_id)
  VALUES
    ('AUD-BOOT-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
     'promote_first_admin', 'service_role', 'system', 'admin_bootstrap',
     p_user_id::text,
     jsonb_build_object('detail', 'first-admin bootstrap; no prior admin existed'),
     now(), 'admin', 'critical', NULL);

  RETURN jsonb_build_object(
    'ok', true,
    'promoted_user_id', p_user_id,
    'recorded_at', now()
  );
END $function$;

-- service_role only: never callable from a client.
REVOKE EXECUTE ON FUNCTION public.promote_first_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_first_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.promote_first_admin(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.promote_first_admin(uuid) TO service_role;
