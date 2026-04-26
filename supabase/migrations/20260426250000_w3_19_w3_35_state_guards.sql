-- ═══════════════════════════════════════════════════════════════════════════
-- W3-19 + W3-35 (Wave 3 red-team, 2026-04-26):
--   • W3-19: emergencies state-machine guard (mirror of W3-34 for emergencies)
--   • W3-35: sos_queue attribution-field protection
--
-- W3-19 BUG: emergencies.status had no transition guard. Dispatcher could
--   resolve → unresolve → resolve repeatedly, corrupting response_time + the
--   forensic timeline. Mirroring the W3-34 sos_sessions guard.
--
-- W3-35 BUG: sos_queue_company_write policy `is_company_member(company_id)`
--   lets ANY worker UPDATE attribution fields (acknowledged_by, resolved_by,
--   assigned_by, reviewed_by, broadcast_by, forwarded_by). A regular
--   employee can mark THEMSELVES as the resolver of a colleague's emergency,
--   forging the responder identity in the audit trail. Fix: BEFORE UPDATE
--   trigger blocks attribution-field changes for non-admin members.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── W3-19: emergencies state-machine guard ───────────────────────────
CREATE OR REPLACE FUNCTION public.emergencies_state_machine_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  -- Terminal states are permanent (allow same-terminal idempotency +
  -- terminal-to-other-terminal correction path).
  IF OLD.status IN ('resolved', 'canceled', 'cancelled', 'ended', 'archived')
     AND NEW.status NOT IN ('resolved', 'canceled', 'cancelled', 'ended', 'archived') THEN
    RAISE EXCEPTION
      'W3-19: emergencies state machine — cannot transition from terminal state % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_emergencies_state_machine ON public.emergencies;
CREATE TRIGGER trg_emergencies_state_machine
  BEFORE UPDATE ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.emergencies_state_machine_guard();

-- ── W3-35: sos_queue attribution protection ──────────────────────────
CREATE OR REPLACE FUNCTION public.sos_queue_attribution_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  -- Service role / no-auth context (e.g. migrations) bypasses.
  IF v_caller IS NULL THEN RETURN NEW; END IF;

  -- Determine if caller is an admin or owner of the row's company.
  -- This uses company_memberships (the canonical roles table) AND
  -- companies.owner_user_id as defense-in-depth.
  SELECT EXISTS (
    SELECT 1 FROM public.company_memberships m
     WHERE m.company_id = NEW.company_id
       AND m.user_id    = v_caller
       AND m.active     = true
       AND m.role       IN ('owner', 'super_admin', 'admin')
  ) OR EXISTS (
    SELECT 1 FROM public.companies c
     WHERE c.id = NEW.company_id
       AND (c.owner_user_id = v_caller OR c.owner_id = v_caller)
  ) INTO v_is_admin;

  IF v_is_admin THEN RETURN NEW; END IF;

  -- Non-admin caller: any change to attribution fields is forbidden.
  IF NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by
     OR NEW.assigned_by   IS DISTINCT FROM OLD.assigned_by
     OR NEW.assigned_to   IS DISTINCT FROM OLD.assigned_to
     OR NEW.resolved_by   IS DISTINCT FROM OLD.resolved_by
     OR NEW.reviewed_by   IS DISTINCT FROM OLD.reviewed_by
     OR NEW.broadcast_by  IS DISTINCT FROM OLD.broadcast_by
     OR NEW.forwarded_by  IS DISTINCT FROM OLD.forwarded_by
  THEN
    RAISE EXCEPTION
      'W3-35: only company admin/owner can change attribution fields on sos_queue (caller=%)', v_caller;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sos_queue_attribution_guard ON public.sos_queue;
CREATE TRIGGER trg_sos_queue_attribution_guard
  BEFORE UPDATE ON public.sos_queue
  FOR EACH ROW EXECUTE FUNCTION public.sos_queue_attribution_guard();
