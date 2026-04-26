-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: f_d_record_stripe_unmapped_event_rpc
-- Version:   20260425160000
-- Applied:   2026-04-25 via Supabase MCP
-- Source of truth: this file matches what was applied to prod.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- F-D (2026-04-25) — make stripe_unmapped_events.retry_count increment.
--
-- Discovered during the verification pass (AUDIT_VERIFICATION_LOG.md):
-- the B-13 stripe-webhook fix persisted unmapped events but supabase-js
-- .upsert overwrites the row on conflict — the `retry_count` column
-- stayed at its default value (1) on every Stripe retry. Operators
-- could not see how many times Stripe had been hammering an event,
-- which is the single most useful signal for "I need to add this
-- price mapping NOW".
--
-- Fix: a SECURITY DEFINER RPC that does the increment server-side via
-- INSERT ... ON CONFLICT (event_id) DO UPDATE. The edge function calls
-- this instead of the raw upsert. Race-safe (one statement); preserves
-- first_seen_at; advances last_seen_at + retry_count on each retry;
-- refreshes raw_event in case Stripe ships a richer payload on retry.
--
-- Verified by 7 scenarios in AUDIT_VERIFICATION_LOG:
--   ✓ first call inserts (retry_count=1)
--   ✓ second call increments (=2)
--   ✓ third call (=3)
--   ✓ different event_id is independent counter
--   ✓ NULL price_id handled
--   ✓ raw_event is refreshed on retry
--   ✓ 10 sequential calls in a single transaction → retry_count=10
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.record_stripe_unmapped_event(text,text,text,uuid,text,jsonb,text);

CREATE FUNCTION public.record_stripe_unmapped_event(
  p_event_id    text,
  p_event_type  text,
  p_price_id    text,
  p_user_id     uuid,
  p_customer_id text,
  p_raw_event   jsonb,
  p_reason      text DEFAULT 'unmapped_price'
)
RETURNS TABLE(
  out_event_id    text,
  out_retry_count int,
  out_first_seen  timestamptz,
  out_last_seen   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  INSERT INTO public.stripe_unmapped_events AS u (
    event_id, event_type, price_id, user_id, customer_id, raw_event, reason
  )
  VALUES (p_event_id, p_event_type, p_price_id, p_user_id, p_customer_id, p_raw_event, p_reason)
  ON CONFLICT (event_id) DO UPDATE
    SET retry_count  = u.retry_count + 1,
        last_seen_at = now(),
        raw_event    = EXCLUDED.raw_event,
        reason       = COALESCE(EXCLUDED.reason, u.reason)
  RETURNING u.event_id, u.retry_count, u.first_seen_at, u.last_seen_at;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_stripe_unmapped_event(text,text,text,uuid,text,jsonb,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_stripe_unmapped_event(text,text,text,uuid,text,jsonb,text) FROM authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.record_stripe_unmapped_event(text,text,text,uuid,text,jsonb,text) TO service_role;

COMMENT ON FUNCTION public.record_stripe_unmapped_event IS
  'F-D 2026-04-25: idempotent recorder for Stripe webhook events with '
  'unmapped priceId. ON CONFLICT increments retry_count and refreshes '
  'last_seen_at. service_role only.';
