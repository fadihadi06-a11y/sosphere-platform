# G-43 — Schema Duplication Catalog (B-20, 2026-04-26)

**Audit finding:** `AUDIT_DEEP_2026-04-25.md` G-43 — public schema has 95 tables, with multiple visible naming-collisions across audit logs, check-ins, and SOS lifecycle.

**Severity:** LOW / INFO — none of these are correctness bugs today, but every ambiguous name is a future bug magnet (developer writes to `audit_log` while a migration hardens `audit_logs`, or vice versa). This file is the canonical disambiguation so the next person doesn't add a 4th `*_log` table.

---

## Live data inventory (snapshot 2026-04-26)

| Table | Live rows | Policies | App refs (`.from()`) | Status |
|------|----------:|---------:|---------------------:|--------|
| `audit_log` | 0 | 1 | **9** | **CANONICAL — keep** |
| `audit_logs` | 0 | 2 | 0 | **DEAD — drop candidate** |
| `checkin_events` | 0 | 2 | 2 | duplicate (used in CI flow) |
| `checkins` | 0 | 3 | 0 | DEAD — drop candidate |
| `company_checkin_sessions` | 7 | 2 | 0 (RPC-only) | **CANONICAL — keep** |
| `employee_checkins` | 1 | 2 | 0 (RPC-only) | **CANONICAL — keep** |
| `trip_checkins` | 0 | 1 | 0 | DEAD — drop candidate |
| `sos_dispatch_logs` | 0 | 0 | 0 | DEAD — drop candidate |
| `sos_events` | 0 | 3 | 2 | duplicate (referenced) |
| `sos_logs` | 2 | 0 | 0 (trigger-only) | inferred dead — verify |
| `sos_messages` | 0 | 4 | 3 | duplicate (in use) |
| `sos_outbox` | 0 | 1 | 0 | DEAD — drop candidate |
| `sos_public_links` | 0 | 0 | 0 (RPC-only) | **CANONICAL — keep** |
| `sos_queue` | 0 | 2 | **14** | **CANONICAL — keep** |
| `sos_requests` | 5 | 0 | 0 (trigger-only) | inferred legacy — verify |
| `sos_sessions` | 0 | 3 | **15** | **CANONICAL — keep** |
| `sos_timers` | 0 | 1 | 0 | DEAD — drop candidate |

---

## Canonical write map (use these — do NOT create new tables)

| Domain | Use this table | Do NOT use |
|--------|---------------|-----------|
| Application audit log | `audit_log` (singular) | `audit_logs` |
| SOS lifecycle/state machine | `sos_sessions` + `sos_queue` projection | `sos_requests`, `sos_logs`, `sos_events` |
| SOS dispatcher messaging | `sos_messages` | `sos_outbox`, `sos_dispatch_logs` |
| SOS public packet links | `sos_public_links` | (none — single source) |
| SOS countdown timers | (managed in-process) | `sos_timers` |
| Company-wide check-in sessions | `company_checkin_sessions` | `checkins`, `trip_checkins` |
| Per-employee check-in events | `employee_checkins` | `checkin_events`, `checkins` |

---

## Why the duplicates exist (forensic)

The schema accreted across three iterations:

1. **v1 (Feb 2026):** generic `*_log`, `*_events`, `*_logs` — single-tenant prototype
2. **v2 (March 2026):** multi-tenant SOS state machine introduced `sos_sessions` + `sos_queue` projection (F-A migration). The v1 tables (`sos_requests`, `sos_logs`, `sos_events`, `sos_outbox`) were left in place because removing them would have meant rewriting RLS, RPCs, and triggers all at once.
3. **v3 (April 2026):** check-in subsystem split between client-driven `employee_checkins` (per-event) and admin-managed `company_checkin_sessions` (per-shift). Older `checkins`, `checkin_events`, `trip_checkins` were never wired back.

**No correctness bug today** because:
- The dead tables have no producers and no consumers (verified via `grep -rIE "\.from\(['\"]<table>['\"]\)"`).
- The "duplicate-but-in-use" tables (`sos_messages`, `sos_events`, `checkin_events`) are read by exactly one path each — verified by code search.

---

## Drop candidates (deferred — post-launch hygiene)

These are zero-row, zero-app-ref tables with policies attached. They are **NOT** dropped in this audit because:

1. Some have RLS policies that reference helper functions — dropping a table while a function references it can cascade.
2. Some have outbound FKs to live tables — dropping them changes the FK closure graph.
3. Storage is trivial (8KB or 0B each).

**Action plan when post-launch hygiene window opens:**

```sql
-- Phase 1 — drop unambiguously dead, no FK closure
DROP TABLE IF EXISTS public.audit_logs        CASCADE;  -- 0 rows, 0 refs
DROP TABLE IF EXISTS public.checkins          CASCADE;  -- 0 rows, 0 refs
DROP TABLE IF EXISTS public.trip_checkins     CASCADE;  -- 0 rows, 0 refs
DROP TABLE IF EXISTS public.sos_dispatch_logs CASCADE;  -- 0 rows, 0 refs, 0 policies
DROP TABLE IF EXISTS public.sos_outbox        CASCADE;  -- 0 rows, 0 refs
DROP TABLE IF EXISTS public.sos_timers        CASCADE;  -- 0 rows, 0 refs

-- Phase 2 — verify before dropping (have live rows but appear unused)
-- Run before drop:
--   SELECT * FROM sos_logs LIMIT 5;     (2 rows — what wrote them?)
--   SELECT * FROM sos_requests LIMIT 5; (5 rows — what wrote them?)
-- These may be DB-trigger projections from the F-A `sos_sessions` work.
-- Inspect `pg_trigger` references first.
```

---

## Lint rule recommendation

Add a pre-commit grep guard:

```bash
# Block reintroduction of legacy table names in app code
grep -rIE "\\.from\\(['\\\"](?:audit_logs|checkins|trip_checkins|sos_outbox|sos_timers|sos_dispatch_logs)['\\\"]\\)" src supabase/functions \
  && echo "ERROR: deprecated table reference (see G-43)" && exit 1
```

---

## Disposition

- **G-43 closed** as INFO. No DDL applied today; catalog committed for future hygiene.
- Future PRs that touch any of the "DEAD — drop candidate" tables must justify in PR description, otherwise reject.
- New audit/log/event/checkin/sos tables: must be reviewed against this catalog before merge.
