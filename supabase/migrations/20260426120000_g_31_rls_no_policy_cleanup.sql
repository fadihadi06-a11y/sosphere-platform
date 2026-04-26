-- ═══════════════════════════════════════════════════════════════════════════
-- G-31 (B-20, 2026-04-26): RLS-enabled-no-policy cleanup.
-- See AUDIT_DEEP_2026-04-25.md G-31 for the audit note.
--
-- Adds read policies to 4 client-active tables (geofences, mission_gps,
-- mission_heartbeats, sensor_events) that were silently broken by RLS-
-- enabled-no-policy. Documents the remaining 14 tables as service-role
-- only via COMMENT so future auditors see they are intentional.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS geofences_authenticated_read ON public.geofences;
CREATE POLICY geofences_authenticated_read
  ON public.geofences FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS mission_gps_member_read ON public.mission_gps;
CREATE POLICY mission_gps_member_read
  ON public.mission_gps FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.missions m
             WHERE m.id = mission_gps.mission_id
               AND public.is_company_member(m.company_id))
  );

DROP POLICY IF EXISTS mission_heartbeats_member_read ON public.mission_heartbeats;
CREATE POLICY mission_heartbeats_member_read
  ON public.mission_heartbeats FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.missions m
             WHERE m.id = mission_heartbeats.mission_id
               AND public.is_company_member(m.company_id))
  );

DROP POLICY IF EXISTS sensor_events_authenticated_read ON public.sensor_events;
CREATE POLICY sensor_events_authenticated_read
  ON public.sensor_events FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.evidence_actions        IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.evidence_audio          IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.evidence_photos         IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.notification_broadcasts IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.outbox_messages         IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.process_instances       IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.process_steps           IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.risk_scores             IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.sos_dispatch_logs       IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.sos_logs                IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.sos_public_links        IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.sos_requests            IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.step_activity           IS 'G-31 (B-20): service-role only.';
COMMENT ON TABLE public.system_logs             IS 'G-31 (B-20): service-role only.';
