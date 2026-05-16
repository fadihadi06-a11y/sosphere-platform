# 📦 SOSphere — Launch Inventory (R-21 Layer 1)

**Generated:** 2026-05-16
**Purpose:** Complete surface map of every page, screen, function, table, RPC, and workflow.
**Scope:** Inventory only — no quality judgment. Feeds Layer 2 (Connectivity Map).

---

## 1. Web Routes (React Router) — 17

| # | Path | Component | Purpose | Auth |
|---|---|---|---|---|
| 1 | `/` | LandingPage | Public marketing homepage; redirects to `/app` on native | Public |
| 2 | `/app` | MobileApp | Mobile app container (state-machine routing) | Protected |
| 3 | `/dashboard` | DashboardWebPage | B2B admin dashboard (OTP + MFA) | Protected |
| 4 | `/welcome` | WelcomeActivation | Enterprise onboarding wizard | Protected |
| 5 | `/demo` | WowDemo | Live product demo | Public |
| 6 | `/training` | TrainingCenter | Admin training & certification | Protected |
| 7 | `/dev/stress-test` | DiagnosticStressTest | Dev-mode stress harness | Dev only |
| 8 | `/privacy` | PrivacyPage | Privacy policy | Public |
| 9 | `/terms` | TermsPage | Terms of service | Public |
| 10 | `/legal/dpa` | DpaPage | Data Processing Agreement (B2B) | Public/Auth |
| 11 | `/compliance` | ComplianceDashboard | ISO 27001 auditor view (admin PIN) | Protected+ |
| 12 | `/auth/callback` | AuthCallbackHandler | Supabase OAuth/reset deep-link | Public |
| 13 | `/reset-password` | ResetPasswordHandler | Password reset handler | Public |
| 14 | `/payment-success` | PaymentSuccessHandler | Stripe success redirect | Public |
| 15 | `/payment-cancelled` | PaymentCancelledHandler | Stripe cancel redirect | Public |
| 16 | `/shared-sos/:emergencyId` | SharedSosViewerHandler | Public SOS share link | Public |
| 17 | `*` | NotFoundPage | 404 catch-all | Public |

---

## 2. Mobile Screens (Capacitor) — 35

| Screen State | Title | Purpose |
|---|---|---|
| welcome | Welcome | Role picker, account-type selector |
| role-select | Role Selection | Choose civilian vs employee |
| login | Login | Phone + OTP authentication |
| login-welcome | Welcome Back | Post-login greeting |
| terms-consent | Terms Consent | Accept ToS first-time |
| gps-consent | GPS Consent | Enable location tracking |
| onboarding | Onboarding | Guided setup wizard |
| individual-register | Register | Civilian profile creation |
| company-join | Join Company | Employee code verification |
| pending-approval | Pending Approval | Await admin approval |
| employee-welcome | Employee Welcome | First-login greeting |
| employee-quick-setup | Quick Setup | Onboarding checklist |
| individual-home | Home | Civilian dashboard (SOS button) |
| employee-dashboard | Employee Dashboard | Workforce view |
| sos-emergency | SOS Emergency | Live emergency call screen |
| post-emergency-debrief | Debrief | Post-SOS assessment + forensic evidence |
| emergency-record | Record | Incident details fallback |
| checkin-timer | Check-in | Periodic mandatory work check-in |
| medical-id | Medical ID | Emergency medical profile |
| subscription | Subscription Plans | Upgrade flow |
| incident-history | Incident History | Past emergencies + logs |
| emergency-packet | Emergency Packet | Pre-configured contacts |
| emergency-services | Emergency Services | Quick-dial 911/999/112 |
| emergency-contacts | Manage Contacts | Edit contact list |
| notifications | Notifications | SOS alerts + broadcasts |
| evacuation | Evacuation | Admin-triggered mass alert |
| language | Language Settings | i18n locale |
| privacy | Privacy Settings | Biometric, consent, devices |
| connected-devices | Connected Devices | Active sessions mgmt |
| help | Help Center | FAQ + troubleshooting |
| elite-features | Elite Features | Feature flag showcase |
| mission-tracker | Mission Tracker | SAR mission coordination |
| safe-walk | Safe Walk | Real-time GPS + audio beacon |
| mfa-challenge | MFA Challenge | 2FA code entry |

---

## 3. Web Page Components — 24

### B2B Dashboard Pages (19)
- `dashboard-web-page.tsx` — Admin login + dashboard shell
- `dashboard-analytics-page.tsx` — Real-time incident + safety analytics
- `dashboard-audit-log-page.tsx` — Audit trail + compliance logging
- `dashboard-billing-page.tsx` — Subscription, invoicing, seat mgmt
- `dashboard-evacuation-page.tsx` — Mass alert broadcast controls
- `dashboard-geofencing-page.tsx` — Geo-fence editor
- `dashboard-jobs-page.tsx` — Scheduled jobs / automation
- `dashboard-leaderboard-page.tsx` — Admin performance rankings
- `dashboard-location-page.tsx` — Zone / facility location mgmt
- `dashboard-offline-page.tsx` — Network sync status + offline queue
- `dashboard-pipeline-health-page.tsx` — SOS pipeline diagnostics
- `dashboard-pricing-page.tsx` — Pricing tier + trial status
- `dashboard-roles-page.tsx` — Roles, permissions, invitations
- `dashboard-sar-page.tsx` — Search & Rescue coordination
- `dashboard-settings-page.tsx` — Company config + integrations
- `dashboard-shift-scheduling-page.tsx` — Workforce shift / on-call
- `dashboard-workforce-page.tsx` — Active workers + location map
- `employees-unified-page.tsx` — Unified employee directory
- `rrp-analytics-page.tsx` — Response analytics + reporting

### Public / Special Pages (5)
- `landing-page.tsx` — Public homepage
- `privacy-page.tsx` — Privacy policy
- `terms-page.tsx` — Terms of service
- `dpa-page.tsx` — Data Processing Agreement
- `not-found-page.tsx` — 404 error

---

## 4. Edge Functions (Supabase) — 28

### A. SOS Pipeline (3)
| Slug | Purpose |
|---|---|
| `sos-alert` | SOS orchestrator (HARDENED v2) — triggers full dispatch pipeline |
| `sos-health` | Public health endpoint for uptime monitoring (L4-B) |
| `sos-sms-inbound` | Twilio inbound SMS webhook (replies during live SOS) |

### B. Twilio Integration (6)
| Slug | Purpose |
|---|---|
| `sos-bridge-twiml` | TwiML for SOS voice-call bridge |
| `twilio-call` | Outbound call orchestration |
| `twilio-sms` | Outbound SMS dispatch (HARDENED) |
| `twilio-status` | Status callback receiver (HARDENED) |
| `twilio-token` | Voice SDK token generator |
| `twilio-config-fix` | One-shot canonical webhook URL repair |

### C. Stripe Integration (3)
| Slug | Purpose |
|---|---|
| `stripe-checkout` | Create Stripe Checkout Session |
| `stripe-portal` | Open Stripe Billing Portal |
| `stripe-webhook` | Receive + process Stripe events (post R-19, 11 event types) |

### D. B2B User-Facing API (8)
| Slug | Purpose |
|---|---|
| `dashboard-actions` | Dispatcher action endpoints |
| `delete-account` | GDPR Art. 17 erasure |
| `export-my-data` | GDPR Art. 15 SAR export |
| `incident-history` | List civilian's past SOS incidents |
| `incident-report-data` | PDF report payload assembly |
| `invite-employees` | Send employee invitations |
| `process-bulk-invite` | Bulk invite worker (E1.4+ pipeline) |
| `send-invitations` | Tenant-safe invitation sender (XSS-hardened) |
| `send-push-notification` | Native Web Push (RFC 8030/8291/8292) |

### E. Continuous Probes — runs on cron (4)
| Slug | Cadence | Purpose |
|---|---|---|
| `forgery-probe` | hourly | R-5 PoC for actor-forgery defense |
| `sos-dispatch-probe` | hourly | R-4 end-to-end SOS verify |
| `sos-inbound-probe` | hourly | L1-D Phase 3 inbound SMS pipeline |
| `twilio-config-probe` | 6h | L1-D Phase 2 webhook URL drift |

### F. On-Demand Probes — manual / workflow_dispatch (4)
| Slug | Purpose |
|---|---|
| `sos-load-probe` | R-17 parallel SOS load test (up to 50/100) |
| `stripe-webhook-test-probe` | R-19 Phase 5: signature + dedup smoke test |
| `stripe-e2e-test-probe` | R-19 #18+#21: 6-phase Stripe e2e suite |
| `stripe-e2e-stress-probe` | R-19 #22: 5 advanced scenarios (upgrade/overflow/concurrent/ordering/payment-fail) |

---

## 5. DB Tables (Public Schema) — 100+

### Auth / Identity (9)
- `profiles` — user profiles (108 rows)
- `companies` — company records (1 row in dev)
- `company_memberships` — user↔company membership (4 rows)
- `company_invites`, `company_invitations`, `invitations`, `invites` — invite tracking
- `individual_users` — civilian users
- `workspaces`, `workspace_members` — workspace abstraction (108 rows each)

### SOS Pipeline (15)
- `sos_sessions` — active SOS sessions (3 rows)
- `sos_pipeline_metrics` — L1-C forensic telemetry (2162 rows)
- `sos_dispatch_attempts` — L2-B append-only ledger (324 rows)
- `sos_sms_replies` — L2-F inbound SMS during SOS (1 row)
- `sos_queue` — SOS work queue (182 rows)
- `sos_outbox`, `outbox_messages` — outgoing message queue
- `sos_public_links` — shareable share-link store
- `sos_timers` — SOS timer state
- `sos_requests`, `sos_logs`, `sos_dispatch_logs` — legacy SOS storage
- `sos_events`, `sos_messages` — SOS event stream + dispatcher messages
- `emergencies`, `emergency_contacts`, `emergency_recipients` — emergency entities
- `emergency_locations`, `emergency_claims`, `emergency_call_attempts` — emergency forensics
- `emergency_logs`, `safety_timers` — emergency support

### Audit / Forensic (8)
- `audit_log` — hash-chained L2-D audit log (1837 rows)
- `audit_logs` — legacy alias
- `evidence`, `evidence_photos`, `evidence_audio` — forensic evidence
- `evidence_vaults`, `evidence_actions`, `evidence_changes` — vault mgmt
- `civilian_incidents` — civilian incident history (7 rows)

### Subscription / Billing (8)
- `subscriptions` — current sub state per user/company (0 rows in dev)
- `processed_stripe_events` — webhook dedup (G-29)
- `stripe_unmapped_events` — unmapped-price forensic store
- `civilian_trial_history`, `user_trial_history` — trial abuse prevention (1 row)
- `company_dpa_acceptances` — DPA legal evidence
- `ops_alerts` — R-19 #12 operator alerts
- `company_twilio_budgets` — per-tenant Twilio spend caps

### Operational / Infra (10)
- `processes`, `process_steps`, `process_instances`, `step_activity` — IRE engine
- `idempotency_cache` — idempotency tokens (168 rows)
- `rate_limits` — rate-limit buckets
- `async_job_metadata` — job tracking (1 row)
- `commands` — command pattern
- `twilio_spend_ledger`, `twilio_breaker_state` — Twilio cost guard
- `system_logs` — internal ops logging

### Workforce / Check-in (7)
- `duty_status`, `employees`, `company_employees` — employee state
- `company_checkin_sessions`, `employee_checkins`, `checkins`, `checkin_events` — check-in tracking
- `tasks` — assignable tasks
- `company_working_hours` — shift hours
- `safe_trips`, `trip_checkins` — safe-walk feature

### Geofencing / Sensors (3)
- `zones`, `geofences` — geo-zone definitions
- `sensor_events` — IoT/phone sensor stream

### Messaging / Notifications (10)
- `chat_messages` — in-app chat
- `direct_messages` — 1:1 DM
- `company_messages`, `company_message_recipients`, `company_message_rsvps` — bulk dispatch
- `announcements`, `announcement_responses` — admin announcements
- `broadcasts`, `notification_broadcasts` — broadcast events
- `notifications`, `push_tokens` (6 rows) — notification delivery
- `call_logs`, `call_chains` — call tracking

### MFA / Security (4)
- `user_mfa_recovery_codes` (8 rows), `mfa_recovery_attempts` (2 rows)
- `biometric_verifications` — biometric audit
- `user_permissions` — fine-grained perms

### GDPR / Compliance (3)
- `sar_missions`, `sar_request_history` — Subject Access Request mgmt
- `mission_gps`, `mission_heartbeats` — SAR mission tracking
- `medical_profiles` — emergency medical info

### Family / Social (4)
- `families`, `family_memberships`, `family_contacts` — family circles
- `buddy_pairs` — Buddy System pairs
- `missions` — Buddy System missions

### Operations / Cleanup-staged (4)
- `_gps_trail_legacy_text_backup_b15` — pre-B-15 backup (safe to drop post-launch)
- `_migration_rollback_snapshots` (1 row) — migration rollback ref
- `feature_flags` — feature toggles
- `profile_trigger_logs` — profile change audit

### Probe-specific (1)
- `sos_probe_session_cache` (50 rows) — R-18-G load probe JWT cache

### Risk / Analytics (4)
- `risk_scores` — computed risk scores (cron-written)
- `gps_trail` (3 rows) — GPS trail logging
- `handover_notes` — admin handover docs
- `zone_reports` — zone-level reporting

### Files / Documents (2)
- `files`, `ire_records` — internal records
- `contacts`, `user_contacts` — contact lists
- `rrp_sessions` — Response Planner sessions

---

## 6. SQL RPCs (SECDEF Functions) — 90

### Auth / Identity (10)
`accept_invitation`, `create_company_and_become_owner`, `create_company_v`, `current_company_id`, `get_my_company_id`, `get_my_identity`, `promote_first_admin`, `promote_user_to_admin`, `register_company_full`, `is_invite_valid`

### Subscription / Billing (9)
`accept_company_dpa`, `cancel_civilian_trial`, `cancel_company_trial`, `current_dpa_version`, `get_company_subscription_state`, `get_dpa_acceptance`, `get_my_subscription_tier`, `start_civilian_trial`, `start_company_trial`

### SOS Pipeline (11)
`get_active_emergency`, `log_sos_audit`, `notify_emergency`, `project_sos_session_to_queue`, `record_sos_dispatch_attempt`, `record_sos_pipeline_acked`, `record_sos_pipeline_dispatched`, `record_sos_pipeline_ended`, `record_sos_pipeline_escalated`, `record_sos_pipeline_started`, `update_sos_dispatch_attempt_outcome`, `record_sos_sms_reply`

### Audit / Verification (6)
`audit_auth_user_changes`, `log_auth_event`, `log_emergency_changes`, `log_evidence_event`, `verify_audit_chain`, `verify_permission`

### MFA / PIN (5)
`mfa_consume_recovery_code`, `mfa_generate_recovery_codes`, `mfa_recovery_status`, `set_admin_pin`, `verify_admin_pin`

### Operational / Cleanup (9)
`cleanup_evidence_vaults`, `cleanup_gps_trail`, `cleanup_idempotency_cache`, `cleanup_processed_stripe_events`, `cleanup_sos_messages`, `cleanup_sos_queue`, `cleanup_sos_sessions`, `cleanup_synthetic_pipeline_metrics`, `log_retention_cleanup`

### Worker / Job Queue (6)
`cancel_job`, `enqueue_job`, `get_my_jobs`, `worker_archive_job`, `worker_queue_depth`, `worker_read_jobs`, `worker_requeue_job_with_delay`

### Twilio Cost Guards (3)
`record_twilio_spend`, `twilio_breaker_check`, `twilio_breaker_record`

### Security (4)
`block_sensitive_profile_changes`, `chat_messages_canonicalize_sender`, `contains_xss_pattern`, `reject_xss_in_user_text`

### Geofencing / Sensors (3)
`delete_geofence`, `record_sensor_event`, `upsert_geofence`

### Consent / GDPR (5)
`complete_sar_export`, `get_consent_state`, `record_consent`, `request_sar_export`, `delete_user_completely`

### State Machine Guards (4)
`emergencies_state_machine_guard`, `enforce_invitation_inviter_owns_company`, `enforce_owner_membership_consistency`, `enforce_profile_active_company_match`, `sos_queue_attribution_guard`, `sos_sessions_state_machine_guard`

### Contacts / Drift (2)
`get_emergency_contacts_with_drift`, `get_user_contacts`

### Probes / Health (3)
`get_pipeline_health_summary`, `get_sos_delivery_summary`, `run_synthetic_sos_probe`

### Cron / Misc (5)
`check_rate_limit`, `get_cron_shared_secret`, `is_neighbor_receive_granted`, `lock_company_billing_columns`, `companies_sync_owner_columns`, `trigger_bulk_invite_worker`

---

## 7. Migrations — 128 files in `supabase/migrations/`

Grouped by ID range:
- **20260401–20260420**: P3 base schema (profiles, companies, subscriptions, audit_log)
- **20260421–20260430**: B-13/B-15/B-17/B-18 hardening (XSS, Stripe dedup, civilian trials)
- **20260501–20260510**: AUTH-5 + L1/L2 (DPA, RPC consolidation, SOS pipeline)
- **20260511–20260516**: L5-SEC + R-1..R-19 root fixes (security sweep, ordering, ops_alerts)

**Latest applied** (all live):
- `20260515120000_r18g_probe_session_cache.sql` (R-18-G)
- `20260515140000_r19_subscription_event_columns.sql` (R-19 #4, #5)
- `20260515150000_r19p3_ordering_guard_and_seats.sql` (R-19 #7, #10)
- `20260515160000_r19p5_ops_alerts.sql` (R-19 #12)

---

## 8. CI Workflows — 4

| File | Triggers | Purpose |
|---|---|---|
| `ci.yml` | push to main, PR | Lint + Audit + Tests + Migration drift + Vite build |
| `build-apk.yml` | push to main, manual | Android Debug APK build with env-driven config (R-16) |
| `probes.yml` | scheduled cron + push | 5 continuous probes (R-4/R-5/R-6/L1-D Phase 2+3) |
| `codeql.yml` | weekly + push | GitHub CodeQL security scanning |

---

## 9. Stripe Catalog (test mode) — 13 prices

### B2B Plans (6 prices)
| Plan | Monthly | Annual |
|---|---|---|
| Starter (25 employees) | $149 | $1,428 |
| Growth (100 employees) | $349 | $3,348 |
| Business (500 employees) | $799 | $7,668 |

### B2C Plans (2 prices)
| Plan | Monthly | Annual |
|---|---|---|
| Personal | $4.99 | $39.99 |

### Add-ons (5, monthly only)
| Add-on | Price |
|---|---|
| Extra PDF Reports | $15 |
| SMS Alerts | $19 |
| Extra Zones | $29 |
| Advanced GPS | $39 |
| Custom Branding | $49 |

**Source of truth:** `src/app/constants/pricing.ts`

---

## 10. NPM Scripts — Key Entry Points

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (localhost:5173) |
| `npm run build` | Production web bundle |
| `npm test` | Vitest run-once |
| `npm run test:watch` | Vitest watch mode |
| `npm run lint` | ESLint with 300 max warnings |
| `npm run verify` | R-7 8-gate pre-push verify |
| `npm run deploy:fn <slug>` | R-15 deploy wrapper (verify→deploy→manifest→commit) |
| `npm run drift:update` | R-6 refresh deploy manifest |
| `npm run stripe:setup-test` | R-19 one-shot Stripe test-mode product seeding |
| `npm run audit:check` | npm audit (high+) |
| `postinstall` | fix capacitor gradle + install git hooks |

---

## 11. Key Scripts (`scripts/`) — Top 20

| Script | Purpose |
|---|---|
| `verify-before-push.mjs` | R-7 8-gate verify (R-20 cross-platform) |
| `deploy-edge-function.mjs` | R-15 deploy wrapper |
| `check-function-drift.mjs` | R-6 manifest drift detection |
| `check-migration-drift.mjs` | Migration lockfile drift |
| `install-git-hooks.mjs` | R-20 hook auto-install |
| `stripe-test-setup.mjs` | Stripe products + prices bootstrap |
| `fix-capacitor-gradle.cjs` | Capacitor plugin Gradle patches |
| `release-signing.ps1` / `.sh` | Android keystore signing helper |
| `backup-keystore.ps1` | Keystore backup |
| `patch-google-auth.js` | Google Auth Capacitor plugin patch |
| `lint-guard.mjs` | Lint guard helper |
| `verify-fix-claims.mjs` | Fix-claim verification |

Plus ~50 `test-*.mjs` standalone integration tests (run manually).

---

## 12. Stack & Tooling

| Layer | Stack |
|---|---|
| **Web** | React 18 + Vite 6 + TailwindCSS 4 + shadcn/ui + Radix UI |
| **State** | Zustand 5, React hooks |
| **Mobile** | Capacitor 6 (Android only — iOS not built) |
| **Backend** | Supabase (Postgres + Edge Functions Deno + Auth + Realtime + Storage) |
| **Payments** | Stripe 2026-04-22.dahlia |
| **Telephony** | Twilio Voice + SMS |
| **Push** | Firebase Cloud Messaging (FCM) — currently optional |
| **Errors** | Sentry — currently optional |
| **Maps** | Leaflet 1.9 |
| **PDF** | jsPDF 4 + jspdf-autotable 5 |
| **Charts** | Recharts 2.15 |
| **Forms** | react-hook-form 7.55 |
| **Routing** | react-router 7 |
| **Date** | date-fns 3 |

---

## 13. Repo Structure (Top-Level)

```
sosphere-platform/
├── .github/workflows/    # 4 CI workflows
├── .githooks/            # Pre-push hook (R-20 Layer A)
├── android/              # Capacitor Android wrapper
├── docs/                 # RUNBOOK + architecture
├── scripts/              # 70+ ops scripts
├── src/app/
│   ├── components/       # 200+ React components + pages
│   │   ├── api/          # Supabase client wrappers
│   │   ├── api/__tests__/  # Vitest contract tests (143+ tests)
│   │   ├── ui/           # shadcn primitives
│   │   └── utils/        # Cross-component utils
│   ├── constants/        # pricing.ts + others
│   ├── lib/              # Lazy-load + Realtime + GPS helpers
│   └── styles/           # Tailwind globals
├── supabase/
│   ├── config.toml       # Edge function configs
│   ├── functions/        # 28 edge functions
│   └── migrations/       # 128 SQL migrations + lockfile
├── capacitor.config.json # Capacitor bundle config
├── package.json          # Single-source npm scripts
└── vite.config.ts        # Vite build config
```

---

## 14. Key Stats

| Metric | Count |
|---|---|
| Web routes | 17 |
| Mobile screens | 35 |
| Web page components | 24 |
| Edge functions | 28 |
| DB tables | 100+ |
| SQL RPCs (SECDEF) | 90 |
| Migrations | 128 |
| CI workflows | 4 |
| Stripe prices (test mode) | 13 |
| Contract tests (Vitest) | 147+ |
| Standalone test scripts | 50+ |
| Total LOC (estimate) | 70,000+ |

---

## 🔍 What This Document Is NOT

- ❌ Not a quality audit. No "this is broken / dead / unused" judgments.
- ❌ Not exhaustive on every file — focused on the SURFACE the user/admin/operator interacts with.
- ❌ Not the design doc — see `docs/SOS_FLOW_DESIGN.md`, `docs/LIFE_SAFETY_FOUNDATION.md` for architecture.

## ✅ What's NEXT — Layer 2 (Connectivity Map)

For each item above, the next pass answers:
1. **Who triggers it?** (URL, button, schedule, webhook)
2. **What does it call?** (RPCs, edge functions, DB tables)
3. **Who reads its output?** (UI, dashboard, Realtime broadcast)
4. **Is it connected at all?** Orphan candidates flagged.

Layer 2 output: `ORPHANS.md` — items with no entry point or dead-end paths. Targeted fixes follow.
