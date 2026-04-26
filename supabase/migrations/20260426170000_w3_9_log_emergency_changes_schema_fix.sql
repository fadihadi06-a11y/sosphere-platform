-- ═══════════════════════════════════════════════════════════════════════════
-- W3-9 (Wave 3 red-team, 2026-04-26): repair `log_emergency_changes` trigger.
--
-- BUG: the trigger function inserted into `audit_log` using column names
-- (`table_name`, `record_id`, `user_id`, `new_data`, `old_data`) that
-- DO NOT EXIST in the actual `audit_log` table. The real columns are
-- (`id`, `action`, `actor`, `actor_role`, `operation`, `target`,
-- `target_name`, `metadata`, `actor_id`, `actor_name`, `category`,
-- `detail`, `target_id`, ...).
--
-- IMPACT (verified by live test):
--   INSERT INTO emergencies (...) VALUES (...);
--   → trigger fires log_emergency_changes()
--   → INSERT INTO audit_log (table_name, ...) VALUES ('emergencies', ...)
--   → ERROR 42703: column "table_name" of relation "audit_log" does not exist
--   → original emergencies INSERT rolls back
--
-- Every dashboard CRUD on `emergencies` (resolve / dispatch / acknowledge /
-- assign) was failing 500. The user-facing symptom: clicking "Resolve" in
-- the dispatcher dashboard returned an opaque error.
--
-- FIX: rewrite the trigger to use the real audit_log schema. Maps:
--   action      → 'emergency_insert' / 'emergency_update' (Point #43 convention)
--   actor       → NEW.user_id::text (the user whose emergency it is)
--   actor_role  → 'system' (the trigger is server-side)
--   operation   → TG_OP                        (INSERT / UPDATE)
--   target      → 'emergencies'
--   target_id   → NEW.id::text
--   metadata    → jsonb_build_object(old=..., new=...)
--   id          → 'AE-' || extract(epoch ...) || '-' || NEW.id::text  (unique)
--   created_at  → now()
--   category    → 'sos'
--   severity    → CASE WHEN NEW.is_active THEN 'high' ELSE 'info' END
--
-- Idempotent: replaces the function definition; trigger binding unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_emergency_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor   text := COALESCE(NEW.user_id::text, '');
  v_id      text := 'AE-' || EXTRACT(EPOCH FROM clock_timestamp())::bigint::text
                    || '-' || NEW.id::text
                    || '-' || substr(md5(random()::text), 1, 6);
  v_op      text := TG_OP;
  v_action  text := CASE
                      WHEN TG_OP = 'INSERT' THEN 'emergency_insert'
                      WHEN TG_OP = 'UPDATE' THEN 'emergency_update'
                      ELSE 'emergency_' || lower(TG_OP)
                    END;
  v_meta    jsonb;
  v_company uuid;
BEGIN
  -- Resolve company_id when present so dashboard reads can scope by tenant.
  v_company := NEW.company_id;

  IF TG_OP = 'INSERT' THEN
    v_meta := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_meta := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  ELSE
    v_meta := '{}'::jsonb;
  END IF;

  INSERT INTO audit_log (
    id, action, actor, actor_role, operation,
    target, target_name, target_id, metadata,
    category, severity, company_id, created_at
  ) VALUES (
    v_id,
    v_action,
    v_actor,
    'system',
    v_op,
    'emergencies',
    COALESCE(NEW.employee_name, ''),
    NEW.id::text,
    v_meta,
    'sos',
    CASE WHEN NEW.is_active THEN 'high' ELSE 'info' END,
    v_company,
    now()
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Defensive: an audit-write failure must NOT break the underlying SOS
  -- write. Log a NOTICE and continue. The audit gap is far less harmful
  -- than rolling back a real-time emergency record.
  RAISE WARNING '[log_emergency_changes] audit insert failed (id=% op=%): %',
    NEW.id, TG_OP, SQLERRM;
  RETURN NEW;
END;
$function$;
