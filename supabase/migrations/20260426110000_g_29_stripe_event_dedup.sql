-- ═══════════════════════════════════════════════════════════════════════════
-- G-29 (B-20, 2026-04-26): stripe-webhook idempotency dedup table.
-- See AUDIT_DEEP_2026-04-25.md G-29 for the audit note.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
  event_id     text        PRIMARY KEY,
  event_type   text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.processed_stripe_events IS
  'G-29 (B-20): event-id dedup for stripe-webhook idempotency.';

ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;
-- No policies = deny all (RLS-default). Service-role bypasses RLS naturally.

CREATE INDEX IF NOT EXISTS processed_stripe_events_processed_at_idx
  ON public.processed_stripe_events (processed_at DESC);
