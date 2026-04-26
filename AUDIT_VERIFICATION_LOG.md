# Verification Log — Each BLOCKER Re-Tested
**Date:** 2026-04-25
**Method:** for each of the 9 BLOCKERs claimed complete, verify:
  - **C — Consumers:** every reader of the changed code path
  - **S — Schema:** column / RPC / table assumptions
  - **R — Runtime:** simulate actual scenario where possible
  - **D — Downstream:** change propagates to PDF / UI / audit chain

A finding is `PASS` only when all four checks succeed; otherwise `FAIL`/`PARTIAL` with the gap documented and a follow-up fix scheduled.

---

## Step 0 — Whole-project compile check

**Result:** PASS (modulo 3 pre-existing non-B errors documented separately).

In the process of running this check I discovered TWO real defects that
my B-05 work was supposed to address but didn't:

1. **`emergency-lifecycle-report.tsx` line 634:** `verifyChainIntegrity`
   was called WITHOUT `await`. Because the function is async it returns
   a Promise (always truthy). The PDF therefore claimed
   `Chain Hash Status: VERIFIED` regardless of the actual chain state.
   This was a pre-existing bug masked by my new typed return value.
   **Fixed:** added a sync companion `quickIntegrityCheck` that returns
   signed/unsigned counts + chain contiguity. The PDF now displays the
   real numbers and only claims "ALL SIGNED + CHAIN CONTIGUOUS" when
   `unsignedCount === 0` AND `chainContiguous === true`.

2. **`smart-timeline-tracker.ts` typeMap missing `evidence_hashed`:**
   the `TimelineEventType` union has the value but the `Record` mapping
   in `getTimelineForReport` did not, so any "evidence_hashed" event
   would have triggered a runtime fallback to `"system"` instead of
   the type-mapped category. **Fixed:** added `evidence_hashed: "system"`.

3. **`emergency-lifecycle-report.tsx` footer "ISO 45001:2018 Compliant":**
   discovered while restoring the file. **Fixed:** replaced with
   "Internal incident record — verify chain via SOSphere audit log".

---

## Step 1 — B-01: dashboard-actions cross-tenant lookup

**Static checks**
- `current_company_id()` exists, returns `uuid`, `SECURITY DEFINER` ✅
- `companies.owner_id` is `uuid`, matches `auth.uid()` type ✅
- All 23 columns dashboard-actions writes to actually exist on `sos_queue` ✅
- Regex `^[A-Za-z0-9_-]+$` blocks comma / quote / paren injection ✅

**Synthetic runtime test** (created 2 test companies + 2 sos_queue rows in different tenants)
- S1 — caller from company A reads EMG-A-001 with company-scoped lookup → row found ✅
- S2 — caller from company A reads EMG-B-001 with company-scoped lookup → 0 rows ⇒ 404 ✅
- S3 — without the company filter (proof of old bug) → finds EMG-B-001 ❌ (confirms vulnerability existed pre-fix)

**Verdict:** PASS — the B-01 fix correctly blocks cross-tenant access at the lookup stage.

---

## ⚠️ Step 1.5 — DISCOVERY (BEEHIVE BREAK, pre-existing)

While verifying B-02 by tracing the AI Co-Admin emergencyId flow, I discovered
that the dispatcher dashboard cannot work end-to-end **regardless of my fix**:

- `sos-alert` (the SOS trigger handler) writes to **`sos_sessions`** (9 columns,
  lifecycle table only — no zone, no employee_name, no acknowledged_by/at, no
  broadcast/forward/review fields).
- `dashboard-actions` (the dispatcher action handler) reads + updates
  **`sos_queue`** (40+ columns — the rich dispatcher view).
- **No trigger, no RPC, no other edge function or client code populates
  `sos_queue` from `sos_sessions` (or anywhere else).** Verified by:
  - `git grep` across `src/` and `supabase/`: zero `INSERT` into sos_queue.
  - `pg_proc` search for any function with `INSERT … sos_queue`: zero results.
  - `pg_trigger` search on sos_sessions / sos_queue: zero connecting triggers.
  - Live counts: `sos_queue = 0`, `sos_sessions = 0`, `audit_log = 0` (pre-launch).

**Implication:** the moment a real SOS arrives in production, `dashboard-actions`
will return `Emergency not found` for every action. My B-01 fix is correct
*for the table the code targets*, but that table is never populated.

The user must decide between:
  (a) **Modify `sos-alert` to dual-write** — also INSERT into sos_queue with the
      richer columns. Cleanest data flow, slightly more SOS-trigger latency.
  (b) **Add a Postgres trigger** on `sos_sessions` AFTER INSERT that copies
      a normalized projection into `sos_queue`. Decouples writers from readers.
  (c) **Migrate `dashboard-actions` to operate on `sos_sessions`** + extend
      that table with the dispatcher columns it needs. Single source of truth,
      but a bigger schema migration.

Until this is resolved, **B-02 cannot be runtime-tested end-to-end** because
the AI Co-Admin's `dispatchResponseTeam`, `evacuateZone`, etc. all flow into
`dashboard-actions`, which finds nothing to act on.

**B-02 Verdict:** PARTIAL — the fix removes the toast-only lies and wires
real server calls (verified by code trace), but the resulting calls hit a
disconnected table. Fix-of-the-fix required.

---

## Step 2 — B-09: twilio-status gather signature bypass

**Static checks**
- `signGatherToken` + `verifyGatherToken` exist in `_shared/gather-token.ts` ✅
- HMAC-SHA256 + base64url, 30-min TTL ✅
- twilio-call v9 deployed; twilio-status v11 deployed ✅

**HMAC reference test** (Python implementation matches TS, all 6 scenarios)
- valid token + correct callId → ok ✅
- valid token + WRONG callId → mac_mismatch ✅
- expired token (manually forged with past expiry) → expired ✅
- tampered MAC tail → mac_mismatch ✅
- malformed (no dot) → malformed_token ✅
- empty string → missing_token ✅

**Verdict:** PASS — gather token correctly binds (callId, expiry); the
prior bypass (anyone forging a Digits=1 POST to twilio-status) is closed.

---

## Step 3 — B-07: age-gate response shape validation

**Static checks**
- `verify_user_age` RPC exists, returns jsonb, SECURITY DEFINER ✅
- `is_age_verified` RPC exists, returns boolean ✅
- All 5 age columns on `profiles` ✅
- `parseVerifyAgeResponse` (the new strict parser) covers every shape the
  RPC actually emits — verified by reading `pg_get_functiondef` of the RPC
  source and cross-checking each branch:
   - `{ok:false, reason:'unauthenticated'}` ↔ VerifyAgeInvalid ✅
   - `{ok:false, reason:'invalid_dob', message}` ↔ VerifyAgeInvalid ✅
   - `{ok:false, reason:'under13', message}` ↔ VerifyAgeUnder13 ✅
   - `{ok:true, category:'13to15', parental_consent_required:true, message}` ↔ VerifyAgeNeedsParent ✅
   - `{ok:true, category:'13to15', parental_contact_recorded:true, verified_at}` ↔ VerifyAgeRecorded ✅
   - `{ok:true, category:'16plus', verified_at}` ↔ VerifyAgeOk16Plus ✅

**Downstream gap discovered**
`mobile-app.tsx` lines 521–533: when `is_age_verified()` RPC throws
(network down / RPC unreachable), the catch branch sets
`ageVerified = true` and lets the user through. This **fail-OPEN**
pattern is the EXACT defect I fixed for sos-alert in B-10. The age
gate has the same hole.

**B-07 Verdict:** PASS for the parser; PARTIAL overall — needs a
matching fail-secure fix on session restore.

---

## Step 4 — B-10: sos-alert rate-limit fail-secure

**Static checks**
- `check_sos_rate_limit` RPC exists ✅
- `log_sos_audit` RPC exists (used by the audit branch when rate-limit fails) ✅
- Source code path returns 503 on RPC error with structured payload ✅

**Downstream gap discovered**
`sos-server-trigger.ts` line 238 retries on **429 only**. My B-10 fix
returns **503** for `rate_limit_check_failed` but the client has no
matching retry — the SOS will fail silently with no retry. This is a
gap in the beehive: server change + client unaware.

**Pending deploy:** sos-alert is 56KB; never pushed via MCP. Source-only.

**B-10 Verdict:** PARTIAL — server logic is correct (verified by reading
the new code path); client-side retry handling is missing.

---

## Step 5 — B-11 + B-12: invitation ownership

**Static checks**
- `companies.owner_id` is uuid ✅
- `company_invites` has {invite_code, company_id, created_by} (canonical) ✅
- `invites` (legacy) has {invite_code, company_id} ✅
- `company_invites.email` is NOT NULL — must be supplied (test caught this) ✅

**Synthetic runtime test**
- Created TEST_B11_COMPANY_A (owned by user_a) and TEST_B11_COMPANY_B (user_b).
- Inserted `company_invites(invite_code='TEST-INVITE-B', company_id=co_b, created_by=user_b)`.
- Simulated user_a sending invitations using TEST-INVITE-B:
  - canonical lookup `created_by=user_a` → 0 rows ✅
  - legacy fallback `companies.owner_id=user_a` for invites.company_id=co_b → 0 rows ✅
  - **verdict = REJECTED** (403) ✅

- Simulated user_a sending invite-employees with employees[*].company_id=co_b:
  - Schema check: `companies.owner_id=user_a` for co_b → 0 → REJECTED ✅

**Verdict:** PASS for both — cross-tenant invite spam is closed.

---

## Step 6 — B-13: stripe-webhook unmapped-price recovery

**Static checks**
- `stripe_unmapped_events` table exists with 13 columns ✅
- RLS locks anon + authenticated to false (service-role only) ✅
- Indexes on (resolved_at WHERE NULL) + (price_id WHERE NOT NULL) ✅
- stripe-webhook v4 deployed, returns 503 on UnmappedPriceError ✅

**Synthetic runtime test**
- INSERT a fake unmapped event with ON CONFLICT (event_id) DO UPDATE retry_count++
- First insert: row created with retry_count=1
- Second insert (idempotent): retry_count updated to 2 ✅

**Defect discovered in deployed edge function**
The deployed edge function uses `supabase-js .upsert({...}, {onConflict})`,
which does NOT support `retry_count = retry_count + 1` expression-style
updates. The function therefore overwrites the row each retry but the
`retry_count` column stays at its default value (1). Operators won't
see how many times Stripe has retried. The forensic record is still
preserved (good), but the retry counter is inert (bad).

**B-13 Verdict:** PASS for "no silent drop" + persistence; PARTIAL for
operational visibility (retry_count is inert). Needs an RPC or trigger
to do the actual increment.

---

## Step 7 — B-05: smart-timeline FNV-1a removal

**Static checks**
- `sha256Sync` removed; `unsignedPlaceholderHash` exists with `UNSIGNED:` prefix ✅
- `TimelineEntry.signed: boolean` is now required ✅
- `loadTimelines` back-fills `signed` for cached pre-fix entries based on
  whether the stored hash looks like real SHA-256 (64 hex chars) ✅
- `typeMap` now includes `evidence_hashed: "system"` (was missing pre-fix) ✅
- `quickIntegrityCheck` (new sync helper) returns
  `{totalEntries, signedCount, unsignedCount, chainContiguous, brokenAt?}` ✅
- `verifyChainIntegrity` (async) now skips signed:false entries — they don't
  participate in the tamper-evidence claim ✅

**Downstream gaps discovered**
Three files import `TimelineEntry` but **none of them read `.signed`**:
- `emergency-lifecycle-report.tsx` — uses `quickIntegrityCheck` correctly ✅
- `dashboard-incident-investigation.tsx` — displays entries without
  differentiation. An investigator viewing the dashboard sees signed and
  unsigned entries with identical visual treatment.
- `individual-pdf-report.tsx` — same; uses `getTimelineForReport` which
  returns `{time, event, actor, type}` (no signature info).

**B-05 Verdict:** PASS for the chain logic + lifecycle PDF; PARTIAL
for the other two surfaces — they don't yet display the signed/unsigned
distinction.

---

## Aggregated finding inventory

| ID | Status | Defect | Recommended single-pass fix |
|---|---|---|---|
| F-A | NEW | sos-alert writes `sos_sessions`, dashboard-actions reads `sos_queue` — no link | Add `AFTER INSERT` Postgres trigger on `sos_sessions` that projects a row into `sos_queue` |
| F-B | NEW | mobile-app.tsx age-verified check fails-OPEN on RPC error | Mirror B-10 logic — fail-secure with retry banner |
| F-C | NEW | sos-server-trigger only retries 429, not 503 | Extend the retry guard to cover 503 (`rate_limit_check_failed`) |
| F-D | NEW | stripe_unmapped_events.retry_count never increments | Replace upsert with a small SECURITY DEFINER RPC that does `INSERT … ON CONFLICT DO UPDATE retry_count = retry_count + 1` |
| F-E | NEW | dashboard-incident-investigation + individual-pdf-report don't display signed/unsigned distinction | Add a small badge/column when `entry.signed === false` |
| F-F | DONE | verifyChainIntegrity Promise-truthy in PDF | already fixed via `quickIntegrityCheck` |
| F-G | DONE | typeMap missing `evidence_hashed` | already fixed inline |
| F-H | DONE | Lifecycle PDF footer claimed ISO 45001 | already fixed |

The 5 NEW defects (F-A through F-E) are the substance of "the tests
the user demanded I should have run from the start." Now I have them
in one place and a single coherent fix plan can address them.

