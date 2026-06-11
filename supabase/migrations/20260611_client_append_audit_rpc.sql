-- ═══════════════════════════════════════════════════════════════════════
-- client_append_audit (2026-06-11) — authenticated, server-validated audit
-- append path. Replaces the client's direct audit_log upsert that W3-8 grant
-- lockdown correctly blocks (403). Without this, client-originated audit
-- events were silently lost and the browser spammed 403s + a never-draining
-- retry queue.
--
-- SECURITY MODEL (does NOT reopen the W3-8 hole):
--   • actor_id is FORCED to auth.uid() — clients cannot forge the actor.
--   • company_id is validated via is_company_member() — no cross-company writes.
--   • ON CONFLICT (id) DO NOTHING — append-only; cannot mutate existing rows.
--   • INSERT only; no UPDATE/DELETE capability.
--   • Owned by postgres (bypassrls) so the FORCE-RLS append-only table accepts
--     the controlled insert, exactly as log_auth_event / log_sos_audit already do.
--   • Tamper-evidence intact: audit_log_hash_chain + actor-normalize triggers fire.
--
-- ROLLBACK: DROP FUNCTION IF EXISTS public.client_append_audit(jsonb);
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.client_append_audit(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_uid     text := auth.uid()::text;
  r         jsonb;
  v_company uuid;
  v_action  text;
  v_count   int := 0;
  v_total   int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;  -- no authenticated session → caller keeps entries locally
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_total := v_total + 1;
    EXIT WHEN v_total > 500;  -- per-call abuse cap

    v_action := NULLIF(r->>'action', '');

    BEGIN
      v_company := NULLIF(r->>'company_id', '')::uuid;
    EXCEPTION WHEN others THEN
      v_company := NULL;
    END;

    CONTINUE WHEN v_action IS NULL;
    CONTINUE WHEN v_company IS NULL;
    CONTINUE WHEN NOT public.is_company_member(v_company);

    BEGIN
      INSERT INTO public.audit_log (
        id, company_id, actor_id, actor_name, actor_role,
        category, action, detail, target_id, target_name, target_role,
        before_value, after_value, zone, severity, verified_2fa,
        device_info, client_timestamp
      ) VALUES (
        COALESCE(NULLIF(r->>'id', ''), gen_random_uuid()::text),
        v_company,
        v_uid,                                   -- FORCED server actor id
        NULLIF(r->>'actor_name', ''),
        NULLIF(r->>'actor_role', ''),
        NULLIF(r->>'category', ''),
        v_action,
        NULLIF(r->>'detail', ''),
        NULLIF(r->>'target_id', ''),
        NULLIF(r->>'target_name', ''),
        NULLIF(r->>'target_role', ''),
        NULLIF(r->>'before_value', ''),
        NULLIF(r->>'after_value', ''),
        NULLIF(r->>'zone', ''),
        COALESCE(NULLIF(r->>'severity', ''), 'info'),
        COALESCE((r->>'verified_2fa')::boolean, false),
        NULLIF(r->>'device_info', ''),
        NULLIF(r->>'client_timestamp', '')::timestamptz
      )
      ON CONFLICT (id) DO NOTHING;
      IF FOUND THEN
        v_count := v_count + 1;
      END IF;
    EXCEPTION WHEN others THEN
      NULL;  -- one malformed row must not abort the batch
    END;
  END LOOP;

  RETURN v_count;
END;
$func$;

REVOKE ALL ON FUNCTION public.client_append_audit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_append_audit(jsonb) TO authenticated;

COMMENT ON FUNCTION public.client_append_audit(jsonb) IS
  'Authenticated server-validated batch append to audit_log. actor_id forced to auth.uid(); company validated via is_company_member; ON CONFLICT DO NOTHING (append-only). Replaces client direct upsert blocked by W3-8.';
