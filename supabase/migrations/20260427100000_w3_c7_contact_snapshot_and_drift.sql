-- ═══════════════════════════════════════════════════════════════════════════
-- C-7 / W3 TIER 2 (2026-04-27): phone staleness mid-SOS
--
-- BUG: sos_sessions stored only `contact_count` (an integer). When the
-- user (or admin) edited a contact's phone AFTER the SOS started but
-- BEFORE a retry / escalation / dispatcher manual call, the system had
-- no way to:
--   (a) know what number was actually dialed (audit gap), or
--   (b) detect that the contact's phone had since changed (silent stale).
-- A retry could dial the OLD number that the contact had already
-- abandoned, while the user assumed help was on the way.
--
-- FIX:
--   1. Add `contact_snapshot JSONB` to sos_sessions — the exact list of
--      {name, phone, relation} that was dialed at trigger time.
--      Forensic audit + retry stability.
--   2. RPC `get_emergency_contacts_with_drift(p_emergency_id uuid)`:
--      returns the snapshot AND the current contacts from
--      individual_users.emergency_contacts, plus a `drift[]` array
--      of contacts whose phone has CHANGED, been DELETED, or been
--      ADDED post-trigger.
--   3. Retry / escalation / dispatcher manual-call paths use this RPC:
--      use `current` (fresh phones) but display "originally dialed +X,
--      now dialing +Y" so the dispatcher knows. If a contact was deleted,
--      drift carries `{snapshot_phone, current_phone: null}` so we can
--      decide to skip vs. fall back to the snapshot.
--
-- AUTHORIZATION:
--   - The function is SECDEF + REVOKE PUBLIC + REVOKE anon + GRANT
--     authenticated, but uses auth.uid() inside the body to enforce:
--       * caller MUST be authenticated
--       * caller MUST be the SOS owner OR a member of the same company
--     This mirrors the W3-30 ownership pattern + W3-39 grant lockdown.
--
-- DEGRADED B2B PATH:
--   medical_profiles uses a bigint employee_id while employees.id is
--   uuid in the live schema — the join can't be made cleanly. For B2B
--   users (no individual_users row) the function returns
--   `current_source: 'fallback_to_snapshot'` and treats current as
--   equal to snapshot (no drift detected). UI can warn the dispatcher
--   that drift detection is unreliable for this path.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sos_sessions
  ADD COLUMN IF NOT EXISTS contact_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.sos_sessions.contact_snapshot IS
  'C-7 (2026-04-27): exact list of contacts dialed at trigger time. Each entry: {name, phone, relation, normalized_at}. Used for forensic audit AND for retry/escalation drift detection. Never mutated after the SOS starts.';

CREATE OR REPLACE FUNCTION public.get_emergency_contacts_with_drift(
  p_emergency_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_snapshot       jsonb;
  v_user_id        uuid;
  v_current        jsonb;
  v_drift          jsonb;
  v_caller_id      uuid := auth.uid();
  v_session_status text;
  v_company_id     uuid;
  v_current_source text := 'individual_users';
BEGIN
  SELECT s.user_id, s.status, s.company_id, s.contact_snapshot
    INTO v_user_id, v_session_status, v_company_id, v_snapshot
  FROM public.sos_sessions s
  WHERE s.id = p_emergency_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'emergency_not_found');
  END IF;

  -- Caller authorization: owner OR same-company dispatcher (W3-30)
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated');
  END IF;
  IF v_caller_id <> v_user_id THEN
    IF v_company_id IS NULL THEN
      RETURN jsonb_build_object('error', 'forbidden');
    END IF;
    PERFORM 1
    FROM public.company_memberships cm
    WHERE cm.user_id = v_caller_id
      AND cm.company_id = v_company_id
      AND coalesce(cm.active, true) = true;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'forbidden');
    END IF;
  END IF;

  -- Civilian path: individual_users keyed by user_id
  SELECT iu.emergency_contacts
    INTO v_current
  FROM public.individual_users iu
  WHERE iu.user_id = v_user_id
  LIMIT 1;

  IF v_current IS NULL OR jsonb_typeof(v_current) <> 'array' THEN
    v_current := '[]'::jsonb;
  END IF;
  IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'array' THEN
    v_snapshot := '[]'::jsonb;
  END IF;

  -- DEGRADED B2B PATH: empty current + non-empty snapshot → fall back
  -- to snapshot (no drift detected). UI gets `current_source` flag.
  IF jsonb_array_length(v_current) = 0 AND jsonb_array_length(v_snapshot) > 0 THEN
    v_current := v_snapshot;
    v_current_source := 'fallback_to_snapshot';
  END IF;

  WITH snap AS (
    SELECT
      lower(btrim(coalesce(s->>'name', ''))) AS k,
      s->>'name' AS name,
      s->>'phone' AS phone,
      s->>'relation' AS relation,
      ord
    FROM jsonb_array_elements(v_snapshot) WITH ORDINALITY AS x(s, ord)
  ),
  curr AS (
    SELECT
      lower(btrim(coalesce(c->>'name', ''))) AS k,
      c->>'name' AS name,
      c->>'phone' AS phone,
      c->>'relation' AS relation
    FROM jsonb_array_elements(v_current) AS x(c)
  ),
  changed AS (
    SELECT jsonb_build_object(
      'name', s.name,
      'snapshot_phone', s.phone,
      'current_phone', c.phone,
      'change_kind',
        CASE
          WHEN c.k IS NULL THEN 'deleted'
          WHEN c.phone IS DISTINCT FROM s.phone THEN 'phone_changed'
          ELSE 'unchanged'
        END
    ) AS row
    FROM snap s
    LEFT JOIN curr c ON c.k = s.k
  ),
  added AS (
    SELECT jsonb_build_object(
      'name', c.name,
      'snapshot_phone', NULL,
      'current_phone', c.phone,
      'change_kind', 'added_after_trigger'
    ) AS row
    FROM curr c
    LEFT JOIN snap s ON s.k = c.k
    WHERE s.k IS NULL
  )
  SELECT jsonb_agg(row)
    INTO v_drift
  FROM (
    SELECT row FROM changed WHERE (row->>'change_kind') <> 'unchanged'
    UNION ALL
    SELECT row FROM added
  ) all_drift;

  IF v_drift IS NULL THEN v_drift := '[]'::jsonb; END IF;

  RETURN jsonb_build_object(
    'snapshot', v_snapshot,
    'current',  v_current,
    'drift',    v_drift,
    'current_source', v_current_source,
    'session_status', v_session_status
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_emergency_contacts_with_drift(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_emergency_contacts_with_drift(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_emergency_contacts_with_drift(uuid) TO authenticated;
