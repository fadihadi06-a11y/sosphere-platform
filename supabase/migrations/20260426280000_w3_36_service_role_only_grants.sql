-- ═══════════════════════════════════════════════════════════════════════════
-- W3-36 (Wave 3 red-team, 2026-04-26): defense-in-depth for the 15 tables
-- documented as service-role only in G-31. RLS denies them, but anon and
-- authenticated still hold full DELETE/INSERT/UPDATE/SELECT/TRUNCATE
-- table-level grants. One mistaken DROP POLICY would expose everything.
--
-- Same family as W3-8 (audit_log grants tighten). Apply the same pattern:
--   • REVOKE ALL FROM anon, authenticated
--   • GRANT SELECT/INSERT/UPDATE/DELETE TO service_role
--   • ALTER TABLE ... FORCE ROW LEVEL SECURITY  (so even table-owner writes
--     hit the policies)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'sos_requests', 'sos_logs',
    'evidence_actions', 'evidence_audio', 'evidence_photos',
    'notification_broadcasts', 'outbox_messages',
    'process_instances', 'process_steps',
    'processed_stripe_events',
    'risk_scores',
    'sos_dispatch_logs', 'sos_public_links',
    'step_activity', 'system_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT  SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
    EXECUTE format('ALTER  TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
