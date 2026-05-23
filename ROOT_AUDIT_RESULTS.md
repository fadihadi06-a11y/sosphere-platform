# ROOT AUDIT RESULTS — 6 Deep Agents
**Date:** 2026-05-21
**Scope:** SOSphere (Saudi/Iraqi life-safety SOS) — pre-launch deep audit
**Compliance target:** SOC 2 Type II + ISO 27001 + Saudi PDPL + GDPR
**Method:** 6 parallel agents reading actual code/migrations/edge functions

## Severity Summary

| Severity | Count | Examples |
|----------|-------|----------|
| CRITICAL | 14 | OTP resend is fake, audit_log CASCADE, medical PHI plaintext, avatars public, SOS Path B silent |
| HIGH | 18 | webhook reconcile cron missing, withDbRetry 2/29, Twilio no fallback, PIN audit silent |
| MEDIUM | 12 | cold start latency, Sentry email, audit_log PII, optimistic UI |
| LOW | 9 | runbook gaps, localStorage PII, generic CORS |

**Total real defects requiring code change: ~53**
**Pretend-tested ratio: 72/95 vitest files (76%) are source-regex regex against text, do not exercise the system**

## TOP 10 BLOCKERS (must-fix before any production traffic)

### 1. [CRIT-E-2] OTP resend is a complete lie
**File:** `src/app/components/otp-verify.tsx:111-116`
**Issue:** The `resend()` function only does `console.log("[SUPABASE_READY] otp_resent")` and resets the visual timer. **It never calls Supabase.** User clicks "Resend", sees a new countdown, no new SMS arrives → user locked out of their own account.
**Fix:** Call the real `resendOTP(phone)` from `./api/supabase-client`. On error → `setVerifyError`; on success → toast.
**Risk if shipped:** Account-lockout for every user whose first OTP didn't arrive. This is a P0 production bug.

### 2. [CRIT-E-1] SOS Path B (server) failure shows NO user error
**File:** `src/app/components/sos-emergency.tsx:2293-2304`
**Issue:** When the server-side SOS fails, only `console.warn` fires; the watchdog toast `"server is alerting your contacts"` runs regardless. **User is affirmatively told the alert was sent, even when it was not.**
**Fix:** Replace console.warn with `toast.error` + red banner tied to `serverResult.success === false`. Add manual retry button.
**Risk if shipped:** Life-safety failure. People believe help is coming, it isn't.

### 3. [CRIT-D-5] Medical info stored as plaintext at rest
**Tables:** `medical_profiles`, `sos_sessions.blood_type`, `sos_queue`
**Files:** `supabase/migrations/20260424162918_rls_phase2_top10_pii_tables.sql:42`, `f_a_sos_sessions_to_queue_projection.sql:69`
**Issue:** PHI (blood_type, allergies, conditions, medications) sits in plaintext columns. PDPL Art. 19 + GDPR Art. 9(2)(h) require encryption for special-category data.
**Fix:** Enable `pgsodium`, wrap PHI columns with `crypto_aead_det_encrypt`; add `medical_profile_decrypt(user_id)` SECDEF RPC limited to self + active SOS responders.
**Risk if shipped:** Direct GDPR Art. 9 + PDPL Art. 19 violation. Cannot pass SOC 2 readiness review.

### 4. [CRIT-D-4] Avatars exposed via `getPublicUrl` + binary in localStorage plaintext
**Files:** `src/app/components/employee-quick-setup.tsx:385,397`, `profile-settings.tsx:76,92`, `evidence-store.ts:137`, `sos-audio-upload.ts:313`
**Issue:** `supabase.storage.from(...).getPublicUrl(path)` returns unsigned URL that bypasses RLS for public buckets. Avatar binaries also stored in `localStorage` as data-URLs.
**Fix:** Switch to `createSignedUrl(path, 300)`; flip avatar bucket to `public:false`; remove avatar data-URL from localStorage (store path only).
**Risk if shipped:** Any URL guess leaks any user photo. localStorage XSS → all avatars stolen.

### 5. [CRIT-B-1] audit_log.company_id ON DELETE CASCADE wipes compliance evidence
**File:** `supabase/migrations/20260415_p3_11_audit_log.sql:21`
**Issue:** Deleting a company removes its entire audit_log AND breaks the L2-D hash chain (prev_hash anchors disappear). Direct SOC 2 CC7.2 / ISO 27001 §A.12.4 / GDPR Art. 30 violation.
**Fix:** Change to `ON DELETE RESTRICT`; audit_log must outlive the company.
**Risk if shipped:** Failed SOC 2 audit. Any company deletion (legitimate or attack) destroys evidence.

### 6. [CRIT-D-2] audit_log.metadata stores raw PII (uneraseable)
**Files:** `supabase/functions/sos-alert/index.ts:1635`, `supabase/functions/delete-account/index.ts:201`
**Issue:** `log_sos_audit` stores caller-supplied `p_metadata jsonb` verbatim and accepts `p_target_name`. Names, partial emails, Stripe IDs, phone numbers flow into audit_log. audit_log is append-only → that data is uneraseable on GDPR Art. 17 requests.
**Fix:** Add `redact_pii(jsonb)` SQL helper called inside `log_sos_audit`. Replace target_name with tenant-scoped pseudo-id `user_<sha256(user_id||tenant_salt)[0:12]>`.
**Risk if shipped:** GDPR right-to-erasure violation.

### 7. [CRIT-E-3 + E-4] SOS dispatch ack + GPS trail errors silently swallowed
**Files:** `src/app/components/sos-emergency.tsx:2538-2540`, `2002-2007`
**Issue:** `emitSyncEvent` returning `delivered:false` → only `console.warn`. `gps_trail` insert error → only `console.warn`. Dashboard never sees the SOS, location is lost, user has no idea.
**Fix:** Toast + retry chip + offline queue for both paths.

### 8. [CRIT-B-2] Twilio spend cap is a TOCTOU race + twilio_sid not UNIQUE
**File:** `supabase/migrations/20260424195653_twilio_spend_protection.sql:104-159`
**Issue:** `check_company_twilio_budget` is STABLE (no lock); `record_twilio_spend` is plain INSERT. Concurrent SOS bursts each see daily_remaining > 0 → both insert → daily/monthly caps exceeded. Also `twilio_sid` index is NOT unique → webhook retries double-count.
**Fix:** Make budget check + insert one SECDEF function with `FOR UPDATE` on `company_twilio_budgets`. Add `CREATE UNIQUE INDEX twilio_spend_sid_uniq ON twilio_spend_ledger(twilio_sid) WHERE twilio_sid IS NOT NULL`.

### 9. [CRIT-B-3] subscriptions.stripe_subscription_id not UNIQUE
**File:** `supabase/migrations/20260415_p3_10_subscriptions.sql:43-44`
**Issue:** Index is non-unique. Webhook UPSERT keys on user_id/company_id only. Two rows can hold the same stripe_subscription_id.
**Fix:** `CREATE UNIQUE INDEX ... (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL` + add `CHECK (status IN ('active','trialing','past_due','canceled','inactive'))`.

### 10. [CRIT-F-1+2+3+4+5] Test infrastructure is pretend-tested
**File:** `src/app/components/__tests__/*` (~75 files of ~95)
**Issue:** Most "tests" do `readFileSync` of migration SQL or edge-function TS and `expect(src).toMatch(/regex/)`. They never exercise the system. Renaming a function but keeping the regex passes; a broken migration that fails to apply still passes. **Zero edge function tests. Zero migration apply tests. Zero coverage threshold. CI passes with 0 tests.**
**Critical paths MISSING actual tests:** SOS e2e, OTP, emergency contacts CRUD+RLS, hash-chain runtime, RBAC runtime, Twilio breaker runtime (6 of 10).
**Fix:** Add real Deno tests for edge functions; integration tests against `supabase start` for migrations; Playwright E2E for SOS happy path; coverage thresholds 70/60/70/70 with `--passWithNoTests=false`.

---

## All findings by agent

### AGENT A — Security/RLS (verdict: posture is good, 1 real fix)
1. [MED] Non-constant-time secret compare in process-bulk-invite (`supabase/functions/process-bulk-invite/index.ts:103`)
2. [LOW] geofences/sensor_events have no INSERT/UPDATE/DELETE policies — writes silently fail (documented Phase-2)
3. [LOW] sos-health wildcard CORS — acceptable for healthz
4. [INFO] lock_company_billing_columns trusts JWT claim — sound but defence-in-depth nit
5. [INFO] No hardcoded secrets; no service_role in client; storage policies scoped; app.allow_* flags fenced

**Stats:** 18 tables / 18 RLS-enabled / 0 USING(true) / 27 edge fns / 0 unauth'd by signature

### AGENT B — Data Integrity (verdict: 3 CRIT + 5 HIGH + 5 MED)
1. [CRIT] audit_log.company_id ON DELETE CASCADE
2. [CRIT] twilio_spend TOCTOU + twilio_sid not UNIQUE
3. [CRIT] subscriptions.stripe_subscription_id not UNIQUE + missing status CHECK
4. [HIGH] check_rate_limit racey
5. [HIGH] biometric_verifications.user_id ON DELETE CASCADE destroys auth evidence
6. [HIGH] subscriptions.updated_at no trigger
7. [HIGH] audit_log.id is text not uuid (forgeable)
8. [MED] rate_limits no UNIQUE on (bucket, identifier, attempted_at)
9. [MED] processed_stripe_events no FK to user/company
10. [MED] async_job_metadata.created_by ON DELETE SET NULL loses accountability
11. [MED] sos_dispatch_attempts/sms_replies FK CASCADE not verified
12. [LOW] Migration drift — direct apply_migration backfilled

### AGENT C — Disaster Recovery (verdict: 4 HIGH + 2 MED + 2 MED-MED)
1. [HIGH] No Stripe webhook reconciliation cron — drift permanent
2. [HIGH] stripe-portal missing Idempotency-Key
3. [HIGH] withDbRetry adopted in only 2/29 edge functions
4. [HIGH] L2-A breaker has no automatic fallback channel (SMS dropped on outage)
5. [MED] SOS cold-start 2-5s, no preheat
6. [MED] Offline SOS queue is localStorage+IDB dual-write → duplicates on reconnect
7. [MED] FCM + STRIPE rotation runbook missing
8. [MED] Backup/restore procedure undocumented + untested

### AGENT D — Privacy/PII (verdict: 2 CRIT + 4 HIGH + 4 MED)
1. [HIGH] PII in edge function logs (phone last-4, lat/lng, raw contact phone)
2. [HIGH] PII in audit_log.metadata uneraseable
3. [MED] Emergency UUID in plaintext SMS + referrer-leakable track URL
4. [CRIT] Avatars: data-URL in localStorage + getPublicUrl unsigned
5. [CRIT] Medical info plaintext at rest
6. [MED] sos_sessions retention only by created_at, not by status='ended'
7. [HIGH] Wildcard CORS on probe/health endpoints
8. [MED] Sentry receives full email per user (cross-border transfer)
9. [MED] Emergency contact B receives SMS without consent record
10. [LOW] localStorage holds plaintext PII
11. [LOW] dashboard `SELECT *` over-fetches employee phones/emails for list views
12. [LOW] Stripe receives customer_email (covered by DPA, document)

### AGENT E — Error Handling (verdict: 5 CRIT + 5 HIGH + ~5 MED — most severe surface)
1. [CRIT] SOS Path B fails silently, watchdog still says "alerting"
2. [CRIT] OTP resend is a console.log lie
3. [CRIT] SOS dispatch ack non-fatal
4. [CRIT] SOS GPS trail insert error swallowed
5. [CRIT] endServerSOS .catch(() => {})
6. [HIGH] PIN-verify audit insert silently dropped
7. [HIGH] sos-server-trigger fan-out failures all .catch(()=>{}) (6 sites)
8. [HIGH] sos-audio-upload replay markers swallowed
9. [HIGH] mobile-app resync caught into void
10. [HIGH] Empty catch {} blocks across SOS path (immersive lock, etc.)
11. [MED] Promise.all without per-call catch in critical loaders
12. [MED] `if (error)` falsy-on-empty-object risk
13. [MED] Network errors → generic "Connection error" with no offline branch
14. [MED] No AbortController in useEffect data fetches
15. [MED] Edge function error shape inconsistent ({error: string} vs {error: {code,message}})
16. [LOW] Optimistic UI without rollback in emergency contacts
17. [LOW] Battery API catch reports but no user signal (OK)

### AGENT F — Test Coverage (verdict: SOC 2 readiness blocker)
1. [CRIT] 72/95 vitest files are source-regex pseudo-tests
2. [CRIT] Zero edge function tests
3. [CRIT] Zero migration apply tests
4. [CRIT] No coverage threshold in vitest.config
5. [CRIT] CI does not enforce test count (`npm test` passes with 0 tests)
6. [HIGH] No E2E framework (Playwright/Cypress/Detox)
7. [HIGH] duress-service suite silently skips if SubtleCrypto absent
8. [HIGH] OTP login uncovered (0 matches signInWithOtp/verifyOtp in tests)
9. [HIGH] Emergency contacts CRUD + RLS uncovered
10. [MED] Hash-chain "passes" without DB
11. [MED] Mocks return only happy-path shape
12. [MED] Tests mock the thing under test
13. [MED] CI lint warning ceiling drift (1100 in CI vs 300 local)

**Critical flows status:** TESTED 1/10 (withDbRetry) · PARTIAL 3/10 (Stripe, push, cancellation) · MISSING 6/10 (SOS e2e, OTP, contacts+RLS, hash-chain runtime, RBAC runtime, breaker runtime)

---

## Proposed remediation — R-109 → R-141 (33 new tickets)

### Phase 1 — STOP-SHIP (must do before any user traffic)
- **R-109** Fix OTP resend (`otp-verify.tsx:111`) — call real `resendOTP()`
- **R-110** SOS Path B failure → toast + retry banner
- **R-111** SOS dispatch ack failure → user signal
- **R-112** SOS GPS trail failure → offline queue + final toast
- **R-113** endServerSOS catch → error reporting
- **R-114** audit_log.company_id ON DELETE → RESTRICT (migration)
- **R-115** audit_log.metadata PII redaction helper + apply in log_sos_audit
- **R-116** Medical info pgsodium encryption (migration + decrypt RPC)
- **R-117** Avatar bucket → private + signed URLs + remove localStorage data-URL
- **R-118** twilio_spend FOR UPDATE + twilio_sid UNIQUE (migration)
- **R-119** subscriptions.stripe_subscription_id UNIQUE + status CHECK (migration)

### Phase 2 — HIGH (within 2 weeks of launch)
- **R-120** Stripe webhook reconciliation cron (hourly)
- **R-121** stripe-portal Idempotency-Key
- **R-122** withDbRetry across all 27 critical edge functions
- **R-123** L2-A breaker → automatic push+email fallback
- **R-124** check_rate_limit advisory lock
- **R-125** subscriptions/company_twilio_budgets updated_at trigger
- **R-126** audit_log.id → uuid (migration)
- **R-127** biometric_verifications + civilian_trial_history → ON DELETE RESTRICT
- **R-128** PIN-verify audit failure → fail-closed
- **R-129** sos-server-trigger fan-out catches → reportError
- **R-130** Wildcard CORS on probes → allowlist
- **R-131** Constant-time compare in process-bulk-invite
- **R-132** Real edge function tests (Deno test, mocked HTTP)
- **R-133** Coverage threshold + CI fail-on-zero-tests
- **R-134** Playwright SOS happy path E2E

### Phase 3 — Robustness (within 4 weeks)
- **R-135** SOS preheat + client-direct insert for cold start
- **R-136** Collapse offline queue to single IDB with idempotency key
- **R-137** Sentry — drop email, send id only
- **R-138** Emergency contact consent table + STOP handler
- **R-139** sos_sessions retention by status=ended
- **R-140** Migration apply integration tests
- **R-141** RUNBOOK FCM+STRIPE rotation + backup/restore section

---

## What I did NOT audit (gaps in my own audit)

- iOS app — Capacitor iOS not yet added (deferred)
- Performance / load (P95 latencies, DB query plans)
- Accessibility (WCAG)
- Localization completeness (Arabic correctness, RTL bidirectional edges)
- Penetration testing (active attack)
- Mobile binary tampering / certificate pinning

These should be additional audits before SOC 2 Type II report.
