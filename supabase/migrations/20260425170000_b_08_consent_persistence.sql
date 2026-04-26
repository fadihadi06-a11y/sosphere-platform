-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: b_08_consent_persistence
-- Version:   20260425170000
-- Applied:   2026-04-25 via Supabase MCP
-- Source of truth: this file matches what was applied to prod.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- B-08 (2026-04-25) — server-authoritative consent (GDPR Art. 7).
--
-- The prior code stored ToS + GPS consent only in localStorage. Anyone
-- with shell access to the browser profile (or a malicious script in a
-- shared device) could write `sosphere_tos_consent` and skip the
-- consent flow. Consent that cannot be DEMONSTRATED on demand is no
-- consent at all under Art. 7.
--
-- Fix:
--   1) profiles gains `tos_consent_at`, `tos_consent_version`,
--      `gps_consent_at`, `gps_consent_decision`.
--   2) record_consent(kind, version?, decision?) RPC stamps the
--      relevant column with now() for the authenticated caller.
--      kind ∈ ('tos','gps'); decision ∈ ('granted','declined') for gps.
--      Returns jsonb {ok, ...} so the client can branch cleanly.
--   3) get_consent_state() returns the caller's record so client code
--      can decide whether the consent flow is needed.
--
-- Verified by 7 RPC scenarios + 12 client helper scenarios in
-- AUDIT_VERIFICATION_LOG.md and scripts/test-b08-consent-server.mjs.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tos_consent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS tos_consent_version  text,
  ADD COLUMN IF NOT EXISTS gps_consent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS gps_consent_decision text
    CHECK (gps_consent_decision IS NULL
        OR gps_consent_decision IN ('granted','declined'));

COMMENT ON COLUMN public.profiles.tos_consent_at IS
  'B-08 2026-04-25: server-authoritative timestamp of ToS+Privacy acceptance.';
COMMENT ON COLUMN public.profiles.gps_consent_at IS
  'B-08 2026-04-25: server-authoritative timestamp of the GPS-permission decision.';

CREATE OR REPLACE FUNCTION public.record_consent(
  p_kind     text,
  p_version  text DEFAULT NULL,
  p_decision text DEFAULT 'granted'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF p_kind NOT IN ('tos','gps') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_kind');
  END IF;
  IF p_kind = 'gps' AND p_decision NOT IN ('granted','declined') THEN
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
  ELSE
    UPDATE public.profiles
       SET gps_consent_at       = now(),
           gps_consent_decision = p_decision
     WHERE id = v_uid OR user_id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', p_kind,
    'version', p_version,
    'decision', CASE WHEN p_kind='gps' THEN p_decision ELSE 'granted' END,
    'recorded_at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_consent(text,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_consent(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_consent_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'tos', jsonb_build_object(
      'at',      p.tos_consent_at,
      'version', p.tos_consent_version
    ),
    'gps', jsonb_build_object(
      'at',       p.gps_consent_at,
      'decision', p.gps_consent_decision
    )
  )
  FROM public.profiles p
  WHERE p.id = auth.uid() OR p.user_id = auth.uid()
  LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_consent_state() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_consent_state() TO authenticated;

COMMENT ON FUNCTION public.record_consent IS
  'B-08 2026-04-25: persist a single consent decision (kind=tos|gps) for the '
  'authenticated caller. Idempotent — overwriting a decision rewrites the '
  'timestamp, which is the legally meaningful event. Returns jsonb {ok, ...}.';

COMMENT ON FUNCTION public.get_consent_state IS
  'B-08 2026-04-25: read-only consent state for the caller. Returns nulls for '
  'unset fields so the client can detect "no consent yet" cleanly.';
