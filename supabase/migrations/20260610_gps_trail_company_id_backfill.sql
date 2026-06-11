-- ═══════════════════════════════════════════════════════════════════════
-- GPS trail company_id backfill (P0 life-safety) — 2026-06-10
-- ─────────────────────────────────────────────────────────────────────
-- GAP: every client gps_trail insert omitted company_id (NULL). The
-- dashboard realtime CDC filters company_id=eq.<id> and the read RLS
-- requires company_id IS NOT NULL, so the live location trail was NEVER
-- delivered to responders — a worker in distress showed a frozen position.
-- Confirmed live: 3/3 existing rows had company_id NULL.
--
-- FIX: BEFORE-INSERT trigger backfills company_id from the worker's
-- membership (employee_id = auth uid → company_memberships, employees
-- fallback). Fixes every client insert path at the DB level — no client
-- redeploy needed. Validated: a test insert with company_id omitted was
-- auto-filled to the correct company; existing rows backfilled.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_gps_trail_backfill_company ON public.gps_trail;
--   DROP FUNCTION IF EXISTS public.backfill_gps_trail_company_id();
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.backfill_gps_trail_company_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF NEW.company_id IS NULL AND NEW.employee_id IS NOT NULL THEN
    SELECT m.company_id INTO NEW.company_id
    FROM public.company_memberships m
    WHERE m.user_id = NEW.employee_id AND m.active = true
    LIMIT 1;
    IF NEW.company_id IS NULL THEN
      SELECT e.company_id INTO NEW.company_id
      FROM public.employees e
      WHERE e.user_id = NEW.employee_id
      LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_gps_trail_backfill_company ON public.gps_trail;
CREATE TRIGGER trg_gps_trail_backfill_company
  BEFORE INSERT ON public.gps_trail
  FOR EACH ROW EXECUTE FUNCTION public.backfill_gps_trail_company_id();

UPDATE public.gps_trail g
SET company_id = COALESCE(
  (SELECT m.company_id FROM public.company_memberships m WHERE m.user_id = g.employee_id AND m.active = true LIMIT 1),
  (SELECT e.company_id FROM public.employees e WHERE e.user_id = g.employee_id LIMIT 1)
)
WHERE g.company_id IS NULL AND g.employee_id IS NOT NULL;
