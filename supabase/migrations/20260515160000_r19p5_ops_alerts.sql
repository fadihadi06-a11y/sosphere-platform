-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — R-19 Phase 5: ops_alerts (#12 — operational visibility)
-- ─────────────────────────────────────────────────────────────────────────
-- WHY
--   When stripe_unmapped_events hits retry_count >= 24 (3-day Stripe retry
--   budget exhausted), the webhook returns 200 to Stripe to stop retries.
--   The event is "deferred" — sitting in stripe_unmapped_events waiting
--   for operator reconciliation.
--
--   Pre-R-19, there was NO surface for this to reach operations. A paying
--   customer could sit in free-tier limbo over an unattended weekend, with
--   the only signal being a row deep in a forensic table no one watches.
--
-- THE FIX
--   ops_alerts table — append-only, service_role-only. The webhook inserts
--   a row when the retry budget exhausts. Operators read it via a saved
--   dashboard query / scheduled email / pager wiring (out of webhook scope).
--
--   No retention policy here on purpose — these are HIGH-VALUE rows that
--   reflect un-reconciled revenue events. They should be reviewed and
--   acknowledged manually (set `acknowledged_at`).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ops_alerts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  severity        text        NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  source          text        NOT NULL,
  category        text        NOT NULL,
  title           text        NOT NULL,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.ops_alerts IS
  'R-19 #12 (2026-05-15): append-only operational alerts. Inserts come from edge functions / DB triggers when an automated process detects a condition needing operator attention (e.g., Stripe retry budget exhausted on an unmapped event). service_role-only.';

COMMENT ON COLUMN public.ops_alerts.acknowledged_at IS
  'When an operator marked this alert reviewed/handled. NULL = unacknowledged (still demands action).';

-- ── Indexes for the two most common operator queries ────────────────────
-- 1. "What unacknowledged alerts do I have, newest first?"
CREATE INDEX IF NOT EXISTS idx_ops_alerts_pending
  ON public.ops_alerts (created_at DESC)
  WHERE acknowledged_at IS NULL;

-- 2. "All alerts of category X, regardless of acknowledgement"
CREATE INDEX IF NOT EXISTS idx_ops_alerts_category
  ON public.ops_alerts (category, created_at DESC);

-- ── RLS: deny everyone, service_role bypasses ───────────────────────────
ALTER TABLE public.ops_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ops_alerts TO service_role;
