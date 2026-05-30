# Supabase Drift Audit Report
*Generated 2026-05-30 — SOSphere*

## Headline Numbers
| Source | Tables | RPCs |
|---|---|---|
| Code references | 71 | 42 |
| Local migration files | 33 | 107 |
| Remote database (production) | 115 | (not enumerated) |

## CRITICAL #1: Un-applied Migrations (5)
These tables have migration files in `supabase/migrations/` AND are referenced
by application code, but **do not exist in the production database**. Calls to
them at runtime will return PostgREST 404. **Highest priority — apply now.**

- `investigations`
- `journeys`
- `playbook_usage`
- `risk_register`
- `training_records`

## CRITICAL #2: Missing Everywhere (24)
Referenced in code, but no migration file AND not in remote. Either dead code,
naming bugs (e.g. `incident` vs `civilian_incidents`), or truly missing features.

- `addons`
- `admin_performance`
- `admin_ratings`
- `call_events`
- `checkin`
- `dispatch_attempts`
- `email_deliveries`
- `emergency_events`
- `employee_invites`
- `employee_profiles`
- `incident`
- `individual_plans`
- `invoices`
- `ire_history`
- `message`
- `neighbor_responses`
- `plans`
- `report_schedules`
- `responders`
- `shifts`
- `sos`
- `system_health`
- `user_2fa`
- `user_pins`

## DRIFT: Remote-only Tables (88)
Production has these but no committed migration. **No audit trail, no
reproducibility, no safe rollback.** Backfill by `supabase db pull`.

- `_migration_rollback_snapshots`
- `announcement_responses`
- `announcements`
- `audit_logs`
- `broadcasts`
- `buddy_pairs`
- `call_chains`
- `call_logs`
- `chat_messages`
- `checkin_events`
- `checkins`
- `commands`
- `companies`
- `company_checkin_sessions`
- `company_employees`
- `company_invitations`
- `company_invites`
- `company_memberships`
- `company_message_recipients`
- `company_message_rsvps`
- `company_messages`
- `company_settings`
- `company_working_hours`
- `contacts`
- `direct_messages`
- `duty_status`
- `emergencies`
- `emergency_call_attempts`
- `emergency_claims`
- `emergency_contacts`
- `emergency_locations`
- `emergency_logs`
- `emergency_recipients`
- `employee_checkins`
- `employees`
- `evidence`
- `evidence_actions`
- `evidence_audio`
- `evidence_photos`
- `families`
- `family_contacts`
- `family_memberships`
- `feature_flags`
- `files`
- `geofences`
- `gps_trail`
- `handover_notes`
- `individual_users`
- `invitations`
- `invites`
- `ire_records`
- `medical_profiles`
- `mission_gps`
- `mission_heartbeats`
- `missions`
- `notification_broadcasts`
- `notifications`
- `outbox_messages`
- `process_instances`
- `process_steps`
- `processes`
- `profile_trigger_logs`
- `profiles`
- `push_tokens`
- `risk_scores`
- `safe_trips`
- `safety_timers`
- `sar_missions`
- `sensor_events`
- `sos_dispatch_logs`
- `sos_events`
- `sos_logs`
- `sos_outbox`
- `sos_public_links`
- `sos_queue`
- `sos_requests`
- `sos_sessions`
- `sos_timers`
- `step_activity`
- `system_logs`
- `tasks`
- `trip_checkins`
- `user_contacts`
- `user_permissions`
- `workspace_members`
- `workspaces`
- `zone_reports`
- `zones`

## Missing RPC Functions (0)
Code calls these via `.rpc()`, but no `CREATE FUNCTION` in migrations.


