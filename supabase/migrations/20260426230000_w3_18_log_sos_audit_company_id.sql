-- ═══════════════════════════════════════════════════════════════════════════
-- W3-18 (Wave 3 red-team, 2026-04-26): log_sos_audit must set company_id.
--
-- BUG: the SECDEF RPC `log_sos_audit` writes to public.audit_log but DOES NOT
-- populate the `company_id` column. Dashboard queries scope by company_id
-- (`audit_log_company_member_read` policy + .eq("company_id", myCompany)) so
-- audit rows written by sos-alert / dispatcher / trigger are INVISIBLE to
-- the very dashboard that's supposed to display them.
--
-- FIX: add an optional `p_company_id` argument (DEFAULT NULL for backward
-- compat). When NULL, derive from `profiles.active_company_id` for the
-- actor. When still NULL (civilian), leave NULL — those rows scope to
-- the actor's own audit view via existing actor_id policies.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_sos_audit(
  p_action      text,
  p_actor       text,
  p_actor_level text  DEFAULT 'worker'::text,
  p_operation   text  DEFAULT 'sos'::text,
  p_target      text  DEFAULT NULL::text,
  p_target_name text  DEFAULT NULL::text,
  p_metadata    jsonb DEFAULT '{}'::jsonb,
  p_company_id  uuid  DEFAULT NULL                       -- W3-18 new param
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
BEGIN
  v_id := 'AUD-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISSMS')
       || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  -- W3-18: derive company_id from actor's profile when caller didn't pass one.
  -- Skip if actor isn't a parseable uuid (e.g., the literal string "system").
  IF v_resolved_company IS NULL AND p_actor IS NOT NULL THEN
    BEGIN
      v_actor_uuid := p_actor::uuid;
      SELECT active_company_id INTO v_resolved_company
        FROM public.profiles WHERE id = v_actor_uuid LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_actor_uuid := NULL;  -- p_actor wasn't a uuid; civilian path
    END;
  END IF;

  INSERT INTO public.audit_log
    (id, action, actor, actor_role, operation, target, target_name,
     metadata, created_at,
     category, severity, actor_name, detail, target_id, client_timestamp,
     company_id)
  VALUES
    (v_id,
     p_action,
     COALESCE(p_actor, 'system'),
     COALESCE(p_actor_level, 'worker'),
     COALESCE(p_operation, 'sos'),
     p_target,
     p_target_name,
     COALESCE(p_metadata, '{}'::jsonb),
     now(),
     'emergency',
     COALESCE(p_metadata->>'severity', 'info'),
     p_actor,
     COALESCE(p_metadata->>'reason', p_metadata->>'detail', null),
     p_target,
     now(),
     v_resolved_company);
END;
$function$;
