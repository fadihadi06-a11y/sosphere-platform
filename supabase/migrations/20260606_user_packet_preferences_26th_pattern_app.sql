-- ═══════════════════════════════════════════════════════════════
-- 2026-06-06 — user_packet_preferences (26th pattern application)
-- ─────────────────────────────────────────────────────────────
-- Privacy-consent toggles for the SOS Emergency Packet — which
-- categories of personal data (medical, contacts, device, recording,
-- incident comments) get included when the worker's SOS triggers
-- and the packet is shared with responders.
--
-- Previous storage: localStorage key `sosphere_packet_modules` ONLY.
-- This was a real GDPR Art.7 problem: when a worker explicitly
-- withdrew consent (e.g. medical = false), the opt-out was tied to
-- that single device. Bought a new phone / cleared the app / signed
-- in on a shared device → consent reset to default-true. The SOS
-- packet then included medical data the user thought they'd opted
-- out of, with no audit trail of the regression.
--
-- This migration creates the server-side source of truth. The
-- mobile emergency-packet.tsx dual-writes: localStorage stays for
-- zero-latency UI (toggle reflects instantly) AND the RPC mirrors
-- to the server so the next device sees the same opt-out state.
--
-- PK = user_id (one preferences row per user, UPSERT on conflict).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_packet_preferences (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  modules    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_packet_prefs_updated
  ON public.user_packet_preferences (updated_at);

ALTER TABLE public.user_packet_preferences ENABLE ROW LEVEL SECURITY;

-- Self-only RLS — privacy preferences are personal, nobody else
-- (not even company admin) reads or writes them. Consolidated one
-- policy per cmd to avoid the stacking pitfalls cleaned up in Tier 3C.

CREATE POLICY user_packet_prefs_select ON public.user_packet_preferences
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY user_packet_prefs_insert ON public.user_packet_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_packet_prefs_update ON public.user_packet_preferences
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_packet_prefs_delete ON public.user_packet_preferences
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ─── RPCs ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_user_packet_preferences(
  p_modules jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  IF jsonb_typeof(p_modules) <> 'object' THEN
    RAISE EXCEPTION 'modules must be a JSON object' USING errcode = '22023';
  END IF;
  INSERT INTO public.user_packet_preferences (user_id, modules, updated_at)
  VALUES (v_uid, p_modules, now())
  ON CONFLICT (user_id) DO UPDATE SET
    modules    = EXCLUDED.modules,
    updated_at = now();
  RETURN v_uid;
END $$;
REVOKE EXECUTE ON FUNCTION public.upsert_user_packet_preferences(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_user_packet_preferences(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_packet_preferences()
RETURNS TABLE (modules jsonb, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  RETURN QUERY
    SELECT p.modules, p.updated_at
    FROM public.user_packet_preferences p
    WHERE p.user_id = v_uid
    LIMIT 1;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_user_packet_preferences() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_packet_preferences() TO authenticated;
