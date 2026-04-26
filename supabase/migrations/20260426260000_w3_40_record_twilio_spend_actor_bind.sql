-- ═══════════════════════════════════════════════════════════════════════════
-- W3-40 (Wave 3 red-team, 2026-04-26): record_twilio_spend actor-bind.
--
-- BUG: G-8 made the RPC service-role-only (revoked EXECUTE from anon /
-- authenticated). But INSIDE the function the (p_company_id, p_user_id)
-- pair was trusted blindly. A bug or RCE in any edge function with
-- service-role keys could pass arbitrary (company_id, user_id) and burn
-- the wrong company's Twilio budget.
--
-- FIX: enforce server-side that p_user_id is a member of p_company_id
-- before inserting. If not, raise an exception. Defense-in-depth on top
-- of the existing G-8 grant lock-down.
--
-- Rationale: even if a caller has service-role privileges, mismatched
-- (company_id, user_id) is *always* a programming error or an attack —
-- never a legitimate state. Failing fast surfaces the bug.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.record_twilio_spend(
  p_company_id   uuid,
  p_user_id      uuid,
  p_emergency_id text,
  p_channel      text,
  p_twilio_sid   text,
  p_cost_estimate numeric,
  p_duration_sec integer DEFAULT NULL::integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_member_ok boolean;
BEGIN
  -- Civilian path: company_id NULL is allowed (no company-scoped spend).
  IF p_company_id IS NOT NULL AND p_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.company_memberships m
       WHERE m.company_id = p_company_id
         AND m.user_id    = p_user_id
         AND m.active     = true
    ) OR EXISTS (
      -- Owner row may not be in company_memberships in some legacy schemas.
      SELECT 1 FROM public.companies c
       WHERE c.id = p_company_id
         AND (c.owner_user_id = p_user_id OR c.owner_id = p_user_id)
    ) OR EXISTS (
      -- And the canonical employees table — same defensive layered check.
      SELECT 1 FROM public.employees e
       WHERE e.company_id = p_company_id
         AND e.user_id    = p_user_id
    ) INTO v_member_ok;

    IF NOT v_member_ok THEN
      RAISE EXCEPTION
        'W3-40: user % is not a member of company % — refusing to charge spend',
        p_user_id, p_company_id;
    END IF;
  END IF;

  INSERT INTO public.twilio_spend_ledger
    (company_id, user_id, emergency_id, channel, twilio_sid, cost_estimate, duration_sec)
  VALUES
    (p_company_id, p_user_id, p_emergency_id, p_channel, p_twilio_sid, p_cost_estimate, p_duration_sec);
END;
$function$;
