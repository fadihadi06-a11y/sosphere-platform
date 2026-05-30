# Supabase Drift Audit Report
*Generated 2026-05-30 — SOSphere*

## Headline Numbers (initial)
| Source | Tables | RPCs |
|---|---|---|
| Code references | 71 | 42 |
| Local migration files | 33 | 107 |
| Remote database (production) | 115 | — |

---

## CRITICAL #1: Un-applied Migrations (5)
**Status: ✅ RESOLVED — 2026-05-30 P1 batch.**

Five tables had migration files in `supabase/migrations/` AND were referenced
by application code, but did not exist in production. Calls returned PostgREST
404. **Highest priority — applied via Supabase MCP with 7-layer per-table audit.**

| Table | Purpose | Status |
|---|---|---|
| `playbook_usage` | Emergency-response playbook execution counters | ✅ Applied |
| `risk_register` | ISO 45001 §6.1 risk-matrix register (5×5) | ✅ Applied |
| `training_records` | Certification + expiry tracking | ✅ Applied |
| `investigations` | ISO 45001 §10.2 CAPA lifecycle | ✅ Applied |
| `journeys` | Field-worker journey tracking + waypoints | ✅ Applied |

Hardening migration `20260530_p3_11_hardening_initplan_search_path_anon_revoke.sql`
also applied — fixed every WARN raised by Supabase advisors on these objects:
- `auth_rls_initplan`: wrapped `auth.uid()` in `(select ...)` for planner caching.
- `multiple_permissive_policies`: split `for all` into INSERT/UPDATE/DELETE.
- `function_search_path_mutable` on `touch_updated_at`: pinned to `public, pg_temp`.
- `anon_security_definer_function_executable` on `increment_playbook_use`: revoked.

---

## CRITICAL #2: Missing Everywhere — Triage (24 → resolved by category)
**Status: ✅ ANALYZED + LIVE BREAKS RESOLVED — 2026-05-30 P2 batch.**

Tables referenced in code, no local migration, not in remote. Split by triage:

### A. Live-broken, needed new migration (4) — ✅ FIXED
| Table | Source | Schema derived from | Risk |
|---|---|---|---|
| `user_2fa` | `totp-engine.ts:163,185` | TOTP enrollment + verification | 🔴 **2FA was silently broken** |
| `user_pins` | `pin-verify-modal.tsx:70` | PIN hash lookup | 🔴 **PIN auth was silently broken** |
| `call_events` | `twilio-status/index.ts:399` | Twilio call lifecycle log | 🟡 Telemetry lost |
| `neighbor_responses` | `neighbor-alert-service.ts:674` | Community alert ACKs | 🟡 Responses not durable |

All four created with day-1 hardening: split policies, cached `auth.uid()`,
appropriate RLS scope (user_2fa/user_pins per-user; call_events service-role
only; neighbor_responses per-responder with SECDEF RPC planned for requester
read-back).

### B. Live-broken, rename bug (1) — ✅ FIXED
| Bug | Correct target |
|---|---|
| `dispatch_attempts` in `sos-load-probe/index.ts:394` | `sos_dispatch_attempts` (exists in remote) |

Was 404'ing silently in a try/catch → probe cleanup leaked test rows forever.
Renamed in edge function source.

### C. Known-dead stubs (4) — no action needed
These are documented in code comments as known broken (offline-sync-engine
left-overs from L2-C2 cleanup). Stay as documented dead code:
- `checkin` (real: `checkins`)
- `incident` (no real equivalent — `civilian_incidents` has different shape)
- `message` (no direct match — `chat_messages`, `direct_messages`, `sos_messages` exist)
- `sos` (no `sos` table — canonical replay path bypasses this)

### D. TODO comment markers (15) — no runtime impact
Code contains `/* SUPABASE_MIGRATION_POINT: ... */` blocks describing future
migrations. The surrounding code still uses mock data, so no live breakage.
Tracked here for future feature work:

`addons`, `admin_performance`, `admin_ratings`, `email_deliveries`,
`emergency_events`, `employee_invites`, `employee_profiles`, `individual_plans`,
`invoices`, `ire_history`, `plans`, `report_schedules`, `responders`, `shifts`,
`system_health`.

---

## DRIFT: Remote-only Tables (88)
**Status: PENDING (P3 scope).**

Production has these but no committed migration. No audit trail, no
reproducibility, no safe rollback. Plan: `supabase db pull` to backfill each
into a per-table migration file.

(Full list in earlier section — unchanged from initial audit. Will be addressed
in a follow-up batch.)

---

## Missing RPC Functions (0)
Code calls 42 RPCs via `.rpc()`; all 42 exist in the 107-function local
inventory. **Clean** — no missing functions.

---

## Resolution Summary
| Phase | Items | Status |
|---|---|---|
| P1 (un-applied migrations) | 5 tables + 1 hardening | ✅ Done |
| P2.A (new live-broken migrations) | 4 tables | ✅ Done |
| P2.B (rename bug) | 1 edge fn fix | ✅ Done |
| P2.C (dead stubs) | 4 noted | ✅ No action |
| P2.D (TODO markers) | 15 tracked | ⏳ Future feature work |
| P3 (remote-only drift backfill) | 88 tables | ⏳ Next batch |
