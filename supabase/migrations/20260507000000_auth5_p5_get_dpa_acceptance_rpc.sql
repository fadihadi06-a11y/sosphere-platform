-- ═══════════════════════════════════════════════════════════════════════════
-- AUTH-5 P5 (#175) — get_dpa_acceptance RPC
-- ═══════════════════════════════════════════════════════════════════════════
-- The signed-DPA download path on the new /legal/dpa page needs to render a
-- "Signed copy" banner with the signer name / title / email / IP / accepted_at.
-- The acceptance row already lives in company_dpa_acceptances (P1 migration
-- 20260506100000); this RPC just exposes it through a uniform jsonb shape that
-- matches the rest of the AUTH-5 client wrappers.
--
-- Read scope = active company members. Owners get the full IP for forensics;
-- non-owner members get the masked /24 prefix so they can verify provenance
-- without seeing every employee's exact IP. Defense in depth on top of the
-- existing RLS policy (company_dpa_member_read).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_dpa_acceptance(
  p_company_id  uuid,
  p_dpa_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_member  boolean;
  v_row     record;
  v_version text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.company_memberships
    WHERE company_id = p_company_id
      AND user_id    = v_user_id
      AND active     = true
  ) INTO v_member;
  IF NOT v_member THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_a_member');
  END IF;

  v_version := COALESCE(p_dpa_version, public.current_dpa_version());

  SELECT * INTO v_row
  FROM public.company_dpa_acceptances
  WHERE company_id = p_company_id
    AND dpa_version = v_version
  ORDER BY accepted_at DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'success',       true,
      'has_signature', false,
      'version',       v_version
    );
  END IF;

  RETURN jsonb_build_object(
    'success',         true,
    'has_signature',   true,
    'version',         v_row.dpa_version,
    'signer_full_name',v_row.signer_full_name,
    'signer_title',    v_row.signer_title,
    'signer_email',    v_row.signer_email,
    -- IP visibility tiered: owners see full host, non-owner members see /24.
    'signer_ip',       CASE
      WHEN public.is_company_owner(p_company_id) THEN host(v_row.signer_ip)
      ELSE CASE WHEN v_row.signer_ip IS NOT NULL
        THEN regexp_replace(host(v_row.signer_ip), '\.\d+$', '.***')
        ELSE NULL END
    END,
    'accepted_at',     v_row.accepted_at,
    'acceptance_id',   v_row.id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_dpa_acceptance(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dpa_acceptance(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.get_dpa_acceptance IS
  'AUTH-5 P5: read the signed DPA acceptance row for a company. Active members see signer name/title/email + masked IP; owners see the full IP. Returns has_signature=false when no acceptance for the version exists.';
