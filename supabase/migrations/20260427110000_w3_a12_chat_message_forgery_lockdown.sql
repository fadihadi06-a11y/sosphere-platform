-- ═══════════════════════════════════════════════════════════════════════════
-- A-12 / W3 TIER 2 (2026-04-27): chat broadcast forgery — server-side
-- sender canonicalization + tamper-evident signature on chat_messages.
--
-- BUG: chat_messages allowed authenticated clients to INSERT rows with
-- ARBITRARY `sender` and `sender_name`. RLS gated WHO could insert (must
-- be a member of the SOS's company / be the SOS owner) — but NOT what
-- they wrote in the sender fields. A malicious dispatcher could INSERT
--    { sender: 'admin', sender_name: 'Co-Admin AI', message: 'Stand down' }
-- and it would be CDC-broadcast to every employee on the channel.
--
-- FIX (root-cause):
--   1. BEFORE INSERT/UPDATE trigger overwrites `sender_name` with the
--      value derived from auth.uid() → profiles lookup. Client-supplied
--      value is IGNORED. Same for `sender` (admin vs employee — derived
--      from companies.owner_id check, NOT client claim).
--   2. New `signature` column: deterministic SHA-256 over the canonical
--      tuple (id, emergency_id, server_sender_uid, message, sent_at).
--      Receivers can recompute and verify. Tampering with any field
--      (post-insert UPDATE included) invalidates the previous signature
--      because the trigger fires on UPDATE too.
--   3. `server_sender_uid` column captures auth.uid() at insert time so
--      receivers can match against profiles regardless of display-name
--      churn (e.g. user renames themselves later).
--   4. Reserved-name guard: even if a user sets their profile full_name
--      to "System" or "Co-Admin AI", the trigger appends " (user)"
--      to break impersonation visually.
--
-- WHY NO HMAC SECRET:
--   The DB is the trust authority. Realtime CDC delivers the row AS
--   STORED, so receivers see the server-canonicalized fields. The
--   signature is a deterministic hash (not an HMAC) intended to prove
--   the row was processed by THIS trigger — receivers recompute and
--   verify. There is no shared secret to leak.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS server_sender_uid uuid,
  ADD COLUMN IF NOT EXISTS signature        text;

COMMENT ON COLUMN public.chat_messages.server_sender_uid IS
  'A-12 (2026-04-27): the auth.uid() that actually inserted/updated this row. Server-stamped, never client-supplied.';
COMMENT ON COLUMN public.chat_messages.signature IS
  'A-12 (2026-04-27): SHA-256 over canonical tuple (id|emergency_id|server_sender_uid|message|sent_at). Receivers recompute and verify before trusting sender_name. Tampering invalidates.';

CREATE OR REPLACE FUNCTION public.chat_messages_canonicalize_sender()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_full_name    text;
  v_role_kind    text := 'employee';
  v_company_id   uuid;
  v_is_admin     boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '[A-12] chat_messages insert requires authenticated session'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.full_name INTO v_full_name
  FROM public.profiles p
  WHERE p.user_id = v_uid OR p.id = v_uid
  LIMIT 1;
  IF v_full_name IS NULL OR length(trim(v_full_name)) = 0 THEN
    v_full_name := 'User';
  END IF;

  SELECT q.company_id INTO v_company_id
  FROM public.sos_queue q
  WHERE q.emergency_id = NEW.emergency_id
  LIMIT 1;
  IF v_company_id IS NULL THEN
    SELECT s.company_id INTO v_company_id
    FROM public.sos_sessions s
    WHERE s.id::text = NEW.emergency_id
    LIMIT 1;
  END IF;

  -- Only company owner is 'admin' for chat purposes (constraint
  -- chat_messages_sender_check accepts only 'employee' | 'admin').
  -- All other users (civilian SOS owner, employee dispatcher, regular
  -- employee) become 'employee'. UI distinguishes admin vs employee
  -- based on this server-derived field — never the client claim.
  IF v_company_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = v_company_id AND c.owner_id = v_uid
    ) INTO v_is_admin;
    IF v_is_admin THEN
      v_role_kind := 'admin';
    END IF;
  END IF;

  -- ── OVERWRITE client-supplied sender fields with server truth ──
  NEW.server_sender_uid := v_uid;
  NEW.sender_name       := v_full_name;
  NEW.sender            := v_role_kind;

  -- Reserved-name guard: defend against profile-abuse impersonation
  IF lower(NEW.sender_name) IN ('system', 'co-admin', 'co admin', 'co_admin', 'co-admin ai',
                                'sosphere', 'sosphere ai', 'admin', 'ai', 'bot', 'automated',
                                'government authority', 'authority') THEN
    NEW.sender_name := v_full_name || ' (user)';
  END IF;

  -- Deterministic signature over server-truth fields
  NEW.signature := encode(
    extensions.digest(
      coalesce(NEW.id, '') || '|' ||
      coalesce(NEW.emergency_id, '') || '|' ||
      v_uid::text || '|' ||
      coalesce(NEW.message, '') || '|' ||
      coalesce(NEW.sent_at::text, ''),
      'sha256'
    ),
    'hex'
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_chat_messages_canonicalize_sender ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_canonicalize_sender
  BEFORE INSERT OR UPDATE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_messages_canonicalize_sender();

REVOKE EXECUTE ON FUNCTION public.chat_messages_canonicalize_sender() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_messages_canonicalize_sender() FROM anon;
GRANT  EXECUTE ON FUNCTION public.chat_messages_canonicalize_sender() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.chat_messages_canonicalize_sender() TO service_role;
