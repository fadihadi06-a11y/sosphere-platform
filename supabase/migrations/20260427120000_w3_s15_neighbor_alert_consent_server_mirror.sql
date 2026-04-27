-- ═══════════════════════════════════════════════════════════════════════════
-- S-15 / W3 TIER 2 (2026-04-27): neighbor-alert consent server-mirrored.
--
-- BUG: civilians toggle "Receive Nearby SOS Alerts" / "Broadcast SOS to
-- Neighbors" client-side; values live in localStorage only. If a user
-- objects ("I never consented to receive other people's SOS broadcasts")
-- we cannot DEMONSTRATE their consent under GDPR Art. 7 — and a
-- malicious app/script with shell access could flip the toggle off in
-- localStorage to silently disable alerts for that user.
--
-- FIX (B-08 pattern, extended):
--   1. Two new columns on profiles:
--        neighbor_receive_at        timestamptz  (when consented)
--        neighbor_receive_decision  text         ('granted'|'declined')
--   2. record_consent() RPC extended to accept kind='neighbor_receive'
--      with a decision payload — same SECDEF + auth.uid() pattern.
--   3. get_consent_state() RPC returns the neighbor_receive fields too.
--   4. New helper RPC `is_neighbor_receive_granted(p_user_id uuid)`
--      that the broadcast path can call to filter recipients to only
--      those who have a server-recorded consent.
--
-- Demonstrability invariant: once record_consent('neighbor_receive',
-- 'granted') runs, the row on profiles has a non-null
-- neighbor_receive_at + 'granted' decision, immutable from the client
-- (RLS forbids UPDATE on these columns; only the SECDEF RPC writes).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS neighbor_receive_at        timestamptz,
  ADD COLUMN IF NOT EXISTS neighbor_receive_decision  text
    CHECK (neighbor_receive_decision IS NULL
        OR neighbor_receive_decision IN ('granted','declined'));

COMMENT ON COLUMN public.profiles.neighbor_receive_at IS
  'S-15 (2026-04-27): server-authoritative timestamp of the neighbor-alert receive decision.';
COMMENT ON COLUMN public.profiles.neighbor_receive_decision IS
  'S-15 (2026-04-27): granted|declined for receiving nearby-SOS alerts. NULL means user has not made a decision yet.';

CREATE OR REPLACE FUNCTION public.record_consent(
  p_kind     text,
  p_version  text DEFAULT NULL,
  p_decision text DEFAULT 'granted'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF p_kind NOT IN ('tos','gps','neighbor_receive') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_kind');
  END IF;
  IF p_kind IN ('gps','neighbor_receive')
     AND p_decision NOT IN ('granted','declined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  END IF;

  INSERT INTO public.profiles (id, user_id)
  VALUES (v_uid, v_uid)
  ON CONFLICT (id) DO NOTHING;

  IF p_kind = 'tos' THEN
    UPDATE public.profiles
       SET tos_consent_at      = now(),
           tos_consent_version = COALESCE(p_version, '1.0')
     WHERE id = v_uid OR user_id = v_uid;
  ELSIF p_kind = 'gps' THEN
    UPDATE public.profiles
       SET gps_consent_at       = now(),
           gps_consent_decision = p_decision
     WHERE id = v_uid OR user_id = v_uid;
  ELSE  -- neighbor_receive
    UPDATE public.profiles
       SET neighbor_receive_at        = now(),
           neighbor_receive_decision  = p_decision
     WHERE id = v_uid OR user_id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', p_kind,
    'version', p_version,
    'decision', CASE WHEN p_kind='tos' THEN 'granted' ELSE p_decision END,
    'recorded_at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_consent(text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_consent(text,text,text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.record_consent(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_consent_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'tos_consent_at',             p.tos_consent_at,
       'tos_consent_version',        p.tos_consent_version,
       'gps_consent_at',             p.gps_consent_at,
       'gps_consent_decision',       p.gps_consent_decision,
       'neighbor_receive_at',        p.neighbor_receive_at,
       'neighbor_receive_decision',  p.neighbor_receive_decision
     )
     FROM public.profiles p
     WHERE p.id = auth.uid() OR p.user_id = auth.uid()
     LIMIT 1),
    jsonb_build_object(
      'tos_consent_at', NULL,
      'tos_consent_version', NULL,
      'gps_consent_at', NULL,
      'gps_consent_decision', NULL,
      'neighbor_receive_at', NULL,
      'neighbor_receive_decision', NULL
    )
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.get_consent_state() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_consent_state() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_consent_state() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_neighbor_receive_granted(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE (p.id = p_user_id OR p.user_id = p_user_id)
      AND p.neighbor_receive_decision = 'granted'
      AND p.neighbor_receive_at IS NOT NULL
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.is_neighbor_receive_granted(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_neighbor_receive_granted(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_neighbor_receive_granted(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_neighbor_receive_granted(uuid) TO service_role;
