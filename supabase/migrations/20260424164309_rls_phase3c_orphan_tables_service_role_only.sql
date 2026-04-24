-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: rls_phase3c_orphan_tables_service_role_only_2026_04_24
-- Version:   20260424164309
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- RLS Reconcile — Phase 3c: orphan tables (no tenancy column)
-- ─────────────────────────────────────────────────────────────────────────
-- These tables have only `id` + domain-specific columns — no user_id,
-- no company_id, no emergency_id to scope against. Until a schema
-- migration adds tenancy columns, client access is too risky (cross-
-- tenant leak unavoidable without a join we don't have).
--
-- Strategy: drop all permissive policies → default-deny for clients.
-- Edge functions keep working (service_role bypasses RLS).
-- If the UI needs any of these, expose via a SECURITY DEFINER RPC
-- that does the scoping in its body.
-- ═══════════════════════════════════════════════════════════════════════════

-- evidence_actions (evidence chain-of-custody log)
drop policy if exists evidence_actions_all on public.evidence_actions;

-- evidence_photos (thumbnails)
drop policy if exists evidence_photos_all on public.evidence_photos;

-- geofences (per-company geofences — but no company_id on table!)
drop policy if exists "Users can delete geofences" on public.geofences;
drop policy if exists "Users can insert geofences" on public.geofences;
drop policy if exists "Users can read geofences"   on public.geofences;
drop policy if exists "Users can update geofences" on public.geofences;

-- outbox_messages (system queue)
drop policy if exists allow_all on public.outbox_messages;

-- process_instances, process_steps (workflow state)
drop policy if exists allow_all on public.process_instances;
drop policy if exists allow_all on public.process_steps;

-- sensor_events (device telemetry)
drop policy if exists "Users can insert sensor events" on public.sensor_events;
drop policy if exists "Users can read sensor events"   on public.sensor_events;
drop policy if exists "Users can update sensor events" on public.sensor_events;

-- sos_dispatch_logs (internal dispatch trace)
drop policy if exists allow_all on public.sos_dispatch_logs;

-- sos_public_links (short-link resolver — server-only)
drop policy if exists allow_all on public.sos_public_links;

-- sos_requests (legacy request table)
drop policy if exists allow_all on public.sos_requests;

-- step_activity (workflow activity log)
drop policy if exists allow_all on public.step_activity;

-- sos_logs — keep the service_role insert policy but verify it's role-scoped
-- (old name: allow_insert_from_edge with_check=true — public role)
drop policy if exists allow_insert_from_edge on public.sos_logs;
-- default-deny for client. Edge functions write via service_role.

-- evidence_audio, mission_gps, mission_heartbeats already had RLS on + 0
-- policies from before — no change needed. Already default-deny for clients.
