# ROOT AUDIT — Wave 9, Batch F5 — Test Suite + SQL Audit
**ID range:** R-2161 → R-2400
**Date:** 2026-05-23
**Scope:** 95 test files in `src/app/components/__tests__/` + 4 production-DB SQL files
**Special angle:** broken tests = false sense of safety — every defect listed below is a hole in the safety net of a LIFE-SAFETY emergency-response platform.

---

## EXECUTIVE SUMMARY

The dominant pattern across the 95-file test suite is **"source-pinning" via `readFileSync` + `.toMatch(regex)`**. Roughly 76 of 95 test files (80%) NEVER run the system under test — they read the .ts/.sql file as a STRING and assert it contains certain substrings or regex patterns. This is a CATEGORICAL safety-net gap: any defect that leaves the magic strings intact but breaks the runtime behavior (logic bug, wrong order of operations, swallowed exception, wrong column referenced inside a working-looking string) PASSES THESE TESTS while production breaks. The grep hit-count on `.toMatch(`/`readFileSync` was **1,888 occurrences across 76 files**.

In addition, several specific defects were found in the SQL files (cross-tenant `USING(true)`, public storage bucket, nullable `company_id`, hardcoded prod project ID, etc.) and in individual test files (mocked-away SUT, hardcoded production project ID, fragile globalThis mutation, missing teardown).

**Totals**
- DISABLED/SKIPPED: 1 (`duress-service.test.ts`)
- FAKE/NO-OP-LEANING ASSERTIONS: 5 (`.toBeTruthy()` on regex match objects)
- MOCKED-AWAY SUT / dependency-of-SUT: 10 files
- HARDCODED SECRETS / leaked prod identifiers: 1 leaked production Supabase project ID across 17 files (test + scripts + docs)
- "STRING-PINNING" COVERAGE GAPS (test asserts source text, never runs code): ~76 files
- SQL SETUP DEFECTS (cross-tenant leak, public bucket, nullable tenant, prod project ID in repo, mutating prod): 8 distinct findings

---

## CATEGORY INDEX

### DISABLED / SKIPPED TESTS
- **R-2161** — duress-service.test.ts:48 — `describe.skip` if SubtleCrypto missing (silently passes on older Node)

### FAKE / NO-OP-LEANING ASSERTIONS
- **R-2162** — l5-sec-1-audit-actor-forgery-invariants.test.ts:113 — `expect(insertMatch).toBeTruthy()`
- **R-2163** — l5-sec-2-3-5-8-twilio-status-hardening.test.ts:41,77 — `expect(m).toBeTruthy()`
- **R-2164** — consent-legacy-migration.test.ts:91,122 — `expect(localStorage.getItem(...)).toBeTruthy()` (doesn't validate parsed shape)
- **R-2165** — r9-edge-function-anti-pattern-audit.test.ts:126,150 — `expect(<computed>).toBe(true)` is technically real but masks WHICH file failed
- **R-2166** — Bulk: 1,888 `.toMatch()` source-pin assertions across 76 files (see COVERAGE-GAP section)

### MOCKED-AWAY DEPENDENCIES OF SUT (test runs against mock; real client/store never exercised)
- **R-2167** — audit-log-ua.test.ts:25 — mocks `../api/supabase-client` (no real write path)
- **R-2168** — audit-log-ua.test.ts:34 — mocks `../shared-store` to return `null` for `getCompanyId` (forces NULL-tenant code path; never exercises real tenant path)
- **R-2169** — duress-service.test.ts:29 — mocks `../subscription-service` `hasFeature → true` so tier gate never tested
- **R-2170** — complete-logout.test.ts:41-66 — mocks 6 modules including supabase-client + dashboard-store; only verifies the mocks were called, not that real cache/IDB clears work
- **R-2171** — shared-store-cdc-tenant-filter.test.ts:64-76 — mocks supabase, sentry-client, audit-log-store; verifies the mock channel name string, not actual realtime subscription
- **R-2172** — shared-store-tenant-scope.test.ts:52-67 — same pattern as R-2171
- **R-2173** — subscription-realtime.test.ts:49-63 — mocks supabase-client + safe-rpc; cannot detect a real RPC schema drift
- **R-2174** — safe-tel.test.ts:25,31 — mocks `sonner` and `capacitor-call-number`; never exercises real CallNumber plugin behavior on a device
- **R-2175** — l4a-db-retry-unit.test.ts:1787 — `vi.useFakeTimers()` for backoff; legitimate but means backoff CAP behavior is never observed in real wall-clock

### HARDCODED SECRETS / LEAKED PRODUCTION IDENTIFIERS
- **R-2176** — l1d-phase2-twilio-drift-unit.test.ts:865-867 — hardcoded production project ID `rtfhkbskgrasamhjraul.functions.supabase.co` baked into ExpectedConfig fixture
- **R-2177** — apply-p1-security-migrations.sql:7 — comment leaks production project ID + display name `rtfhkbskgrasamhjraul (fadiiiiiii)`
- **R-2178** — Prod project ID `rtfhkbskgrasamhjraul` is checked into git across 17 files (tests, scripts, docs, .env.example, workflow). Anyone cloning the repo learns the exact attack target.

### WRONG ENV TARGET (test hits or pins production URL)
- **R-2179** — l1d-phase2-twilio-drift-unit.test.ts:865-867 — unit test asserts drift comparison against PRODUCTION URLs; if Supabase migrates the project to a new ref, this test passes locally but production drift detection silently classifies live URLs as drift

### globalThis MUTATION / SHARED-STATE LEAKS BETWEEN TESTS
- **R-2180** — r50-network-status.test.ts:47 — `delete globalThis.navigator` (no afterEach restore in the snippet shown; if test fails between delete and reset, downstream tests in same worker run with missing navigator)
- **R-2181** — r66-lang-autodetect.test.ts:53,55,57 — `delete globalThis.localStorage / navigator / window` — same risk class
- **R-2182** — audit-log-ua.test.ts:42-55 — `Object.defineProperty(globalThis, "navigator", {...})` inside helper; if `fn()` throws, restore in `finally` runs, but the helper redefines navigator value=undefined and the original was a getter — a vitest worker reused across files may end up navigator-less
- **R-2183** — complete-logout.test.ts:22-34 — installs `window` + `CustomEvent` onto globalThis WITHOUT teardown — leaks into any subsequent test file in the same vitest worker
- **R-2184** — Every test file that uses `(globalThis as any).localStorage = ... ?? new MemoryStorage()` shares ONE Map across tests in the same worker — `beforeEach localStorage.clear()` mitigates, but tests that forget `clear()` (or use `clear()` after seed) inherit prior state

### COVERAGE GAPS (test claims to verify X but never asserts X actually happens)
Each file below READS source code and PINS regex strings — it does NOT execute the code under test. A bug that leaves the strings intact (e.g., logic swap, wrong column name embedded inside a working-looking string, missing await, comment-only references) PASSES the test while production fails.

- **R-2185** — android-deep-links.test.ts — pins AndroidManifest substrings; never installs the APK or fires a real intent
- **R-2186** — audit-log-rls-hardening.test.ts — pins REVOKE/GRANT regex; never executes the migration nor asserts an authenticated user CANNOT actually `INSERT INTO audit_log` at runtime
- **R-2187** — auth-listener-cleanup.test.ts — counts `onAuthStateChange` vs `.unsubscribe()` in source text; can't detect a missing cleanup that's hidden in a conditional branch
- **R-2188** — auth5-architectural-invariants.test.ts — explicit comment "file-grep over importing + executing" — admits this is not a behavior test
- **R-2189** — ccpa-disclosure.test.ts — pins `data-testid="ccpa-disclosure-section"` substring; doesn't render the page, doesn't verify the section is reachable or visible
- **R-2190** — civilian-trial-server.test.ts — pins `CRIT-#12` marker in source comment + RPC name regex; never actually CALLS `start_civilian_trial` or asserts an unauthenticated user is rejected
- **R-2191** — data-retention-cron.test.ts — pins migration substrings; never runs the cron, never asserts a row >90d is deleted
- **R-2192** — delete-account-stripe-cancel.test.ts — pins edge-function source strings; never asserts a Stripe DELETE actually fires
- **R-2193** — evidence-vault-reachability.test.ts — pins `import("./evidence-vault-service")` substring; doesn't verify the dynamic import resolves at runtime
- **R-2194** — fcm-push-edge-function.test.ts — pins JWT-auth / VAPID / audit substrings; never sends a real push
- **R-2195** — gdpr-sar-export.test.ts — pins migration + edge-fn substrings; doesn't assert all 47 PII tables are walked nor that integrity hash matches export bytes
- **R-2196** — incident-history-retroactive-pdf.test.ts — pins source strings; never renders a PDF or verifies tier-gating actually blocks a free user
- **R-2197** — individual-pdf-report-tier-gate.test.ts — same source-pin pattern; doesn't render or compare PDFs
- **R-2198** — l1-observability-invariants.test.ts — pins client + edge-fn + migration substrings; never sends a real SOS with a trace_id through the stack
- **R-2199** — l1c-pipeline-metrics-invariants.test.ts — pins schema column names + RPC strings; never calls `record_sos_pipeline_started`
- **R-2200** — l1d-phase2-twilio-probe-invariants.test.ts — pins probe source; doesn't exercise probe
- **R-2201** — l1d-phase3-inbound-probe-invariants.test.ts — same
- **R-2202** — l1d-phase3.5-probe-workflow-invariants.test.ts — pins YAML cron string; never runs the workflow
- **R-2203** — l1d-synthetic-probe-invariants.test.ts — pins SECURITY DEFINER regex; never asserts at runtime that an authenticated user is denied EXECUTE
- **R-2204** — l1e-pipeline-health-invariants.test.ts — pins RPC source; never calls `get_pipeline_health_summary`
- **R-2205** — l2a-twilio-breaker-invariants.test.ts — pins migration grants; never opens the breaker by injecting failures and confirming next call is rejected
- **R-2206** — l2b-dispatch-attempts-invariants.test.ts — same; never actually inserts a dispatch attempt and asserts idempotency
- **R-2207** — l2c-sos-replay-single-source-invariants.test.ts — pins absence-of-`supabase.from("sos")`; can't detect the existence-of in a string template or dynamic build
- **R-2208** — l2c2-broken-sync-stubs-invariants.test.ts — same
- **R-2209** — l2d-audit-hash-chain-invariants.test.ts — pins migration; never inserts a row and verifies row_hash is computed and chain holds
- **R-2210** — l2e-free-tier-call-invariants.test.ts — pins source strings; doesn't trigger an actual free-tier SOS and observe call attempts
- **R-2211** — l2e-phase2-retry-cascade-invariants.test.ts — pins retry budget constants in source
- **R-2212** — l2f-sms-inbound-invariants.test.ts — pins inbound-fn source + migration
- **R-2213** — l2f-ui-sms-reply-listener-invariants.test.ts — pins React component source
- **R-2214** — l2g-forensic-photo-invariants.test.ts — pins capture-fn source; never asserts a real photo is captured + hashed + uploaded
- **R-2215** — l2h-admin-emergency-response-invariants.test.ts — pins admin-fn source
- **R-2216** — l2h-evidence-chain-invariants.test.ts — pins migration; never inserts an evidence event and asserts the `evidence.` prefix check actually rejects bad input
- **R-2217** — l2h-ui-debrief-surface-invariants.test.ts — pins debrief-component source
- **R-2218** — l3a-lazy-pages-invariants.test.ts — pins React.lazy substrings; doesn't measure bundle size
- **R-2219** — l3b-mobile-lazy-invariants.test.ts — same
- **R-2220** — l4a-sos-alert-retry-invariants.test.ts — pins withDbRetry import; doesn't actually inject a transient error and observe retry
- **R-2221** — l4b-sos-health-invariants.test.ts — pins health-fn source + config.toml `verify_jwt=false`; never HTTP-hits the endpoint
- **R-2222** — l5-sec-1-audit-actor-forgery-invariants.test.ts — pins migration; r5-forgery-probe is the only thing that exercises this for real, and it's gated on PROBE_SECRET being set in CI (out-of-band)
- **R-2223** — l5-sec-2-3-5-8-twilio-status-hardening.test.ts — pins comment marker `L5-SEC-2`; substring-only assertion that the comment exists is documentation-checking, not behavior-verifying
- **R-2224** — l5-sec-3-sos-bridge-twiml-signature.test.ts — pins regex source-position of validateTwilioSignature; doesn't actually POST an unsigned request
- **R-2225** — l5-sec-4-geofences-sensor-events-rls.test.ts — pins migration grants; never inserts a row and verifies cross-tenant SELECT returns 0
- **R-2226** — l5-sec-5-6-sms-inbound-hardening.test.ts — pins `constantTimeEquals(...)` substring; can't prove the timing channel is actually closed
- **R-2227** — l5-sec-7-sar-completeness.test.ts — pins `column: 'id'` substring; doesn't fetch the user's actual PII and verify the row count > 0
- **R-2228** — l5-sec-8b-audit-null-company-admin.test.ts — pins policy regex; never inserts a NULL-company audit row and confirms a non-admin can't read it
- **R-2229** — l5-sec-9-evidence-channel-chain-guard.test.ts — pins channel-name pattern
- **R-2230** — mission-supabase.test.ts — pins data-layer source
- **R-2231** — pin-gate.test.ts — explicit "vitest doesn't render React in this CI" comment; admits this is source-pinning not behavior
- **R-2232** — r1-geofences-sensor-events-tenancy.test.ts — pins SECDEF RPC source + migration
- **R-2233** — r11-client-anti-pattern-audit.test.ts — pins component source for cleanup patterns
- **R-2234** — r12-secdef-grant-lockdown-invariants.test.ts — pins migration grants; never runs `has_function_privilege(...)` at test time
- **R-2235** — r13-pipeline-metrics-probe-classification.test.ts — pins sos-alert authenticate() signature substring
- **R-2236** — r15-deploy-wrapper-invariants.test.ts — pins script source
- **R-2237** — r16-apk-build-invariants.test.ts — pins build-apk.yml + build.gradle
- **R-2238** — r17-load-probe-invariants.test.ts — pins probe-fn source
- **R-2239** — r19-phase2-missing-events.test.ts → r19-phase5-test-probe-alerts-dpa.test.ts — 5 files all pin stripe-webhook source strings; none send a real signed webhook payload
- **R-2240** — r19-stripe-webhook-atomicity.test.ts — pins DbHandlerError class declaration; doesn't simulate a DB outage and verify Stripe gets 503
- **R-2241** — r2-evidence-channel-company-scope.test.ts — pins migration + evidence-store source
- **R-2242** — r20-automation-gate-invariants.test.ts — pins hook script source
- **R-2243** — r22-plan-catalog-invariants.test.ts — `expect(catalogSrc.length).toBeGreaterThan(1000)` — file-size assertion is theatre
- **R-2244** — r24-orphans-cleanup.test.ts — pins migration + inventory file
- **R-2245** — r3-twilio-url-form-b-unification.test.ts — pins fnUrl import strings
- **R-2246** — r4-sos-dispatch-probe-invariants.test.ts — pins probe source + workflow
- **R-2247** — r5-forgery-probe-invariants.test.ts — pins probe source; the runtime probe lives elsewhere, this is shape-pinning only
- **R-2248** — r6-function-drift-probe-invariants.test.ts — pins drift-script source
- **R-2249** — r8-no-void-async-in-edge-functions.test.ts — actually a real sweep but only over comment-stripped source; an `eval`-encoded `void async` would pass
- **R-2250** — r9-edge-function-anti-pattern-audit.test.ts — same; sweeps stripped source for patterns
- **R-2251** — sar-demo-banner.test.ts — admits in header comment that the SAR engine is NOT WIRED to any real dispatch; the test only asserts the **banner** disclaiming this fact exists
- **R-2252** — sos-alert-tier-resolution.test.ts — pins resolveCompanyOwnerUserId helper name
- **R-2253** — sos-server-trigger-userid.test.ts — pins shape of a LOCAL helper that mirrors the SUT — admits in comment "the production file ever sends `userId: opts.userId` again, the wire-level behaviour this test documents will regress" but it tests the MIRROR not the production code

### TESTS THAT NEVER INVOKE THE SYSTEM UNDER TEST (subset of COVERAGE GAPS, highlighted)
- **R-2254** — auth5-architectural-invariants.test.ts — header explicitly: "file-grep over importing + executing"
- **R-2255** — pin-gate.test.ts — header explicitly: "vitest doesn't render React in this CI"
- **R-2256** — civilian-trial-server.test.ts:331 — first test literally `expect(serviceSrc).toContain("CRIT-#12")` — checks for a comment marker, not behavior. A future PR that removes the implementation but keeps the comment passes.
- **R-2257** — sar-demo-banner.test.ts — admits the SAR engine is unwired; test guards only the disclaimer text
- **R-2258** — sos-server-trigger-userid.test.ts — uses an inline COPY of the production payload-builder; production drift undetected

### TIMING-DEPENDENT / FAKE-TIMER DEFECTS
- **R-2259** — l4a-db-retry-unit.test.ts:1787 — `vi.useFakeTimers()` + `vi.useRealTimers()` in afterEach — if a test throws after `useFakeTimers` but before `afterEach`, the next file's timers are fake (cross-file leak in same worker)
- **R-2260** — No test in this suite uses a hardcoded `await new Promise(r => setTimeout(r, N))` literal; this category is clean (matched by `setTimeout(resolve, ...)` grep returning 0 hits)

### PROCESS / WORKER STATE MUTATION
- **R-2261** — r6-function-drift-probe-invariants.test.ts:114-115 — comments reference `process.exitCode` vs `process.exit`; the test asserts the **script** uses `process.exitCode` but vitest doesn't sandbox; if the script were executed (it isn't here), `process.exitCode` mutation would persist
- **R-2262** — None of these tests call `process.exit` directly (clean)

### LEAKED REAL EMAIL / OWNER IDENTITY
- **R-2263** — apply-p1-security-migrations.sql:7 — comment includes `fadiiiiiii` (operator handle), pairing the production project ref with an identifiable account; reconnaissance vector

---

## SQL SETUP DEFECTS

### supabase-setup.sql
- **R-2264 — P0 — STORAGE / DATA EXFIL — supabase-setup.sql:77**
  Problem: `INSERT INTO storage.buckets (id, name, public) VALUES ('evidence', 'evidence', true)` — bucket is PUBLIC. Any object URL is world-readable, bypassing the SELECT RLS policy. Life-safety evidence (photos, audio) leaks.
  Fix: set `public=false`; serve via signed URLs only.

- **R-2265 — P0 — STORAGE / TENANT — supabase-setup.sql:84**
  Problem: storage INSERT policy `WITH CHECK (bucket_id = 'evidence')` — any authenticated user can upload anywhere in the bucket. No path/tenant scoping. Attacker can poison or overwrite another tenant's evidence.
  Fix: scope to `(storage.foldername(name))[1] = (SELECT id::text FROM employees WHERE user_id = auth.uid())`.

- **R-2266 — P0 — RLS / TENANT — supabase-setup.sql:32, 38**
  Problem: `company_id UUID` declared NULLABLE and `ADD COLUMN IF NOT EXISTS company_id UUID` for pre-existing rows. NULL company_id rows are RLS-invisible to all tenants but also un-deletable via the policies and survive forever as orphans / forensic gaps.
  Fix: `NOT NULL` + backfill + add CHECK constraint.

- **R-2267 — P1 — RLS / TENANT — supabase-setup.sql (no UPDATE/DELETE policy on storage.objects)**
  Problem: No DELETE policy on storage.objects for the evidence bucket — only service_role can delete, but no DROP policy means evidence cannot be redacted via end-user GDPR Art 17 calls from the client.
  Fix: add owner-scoped DELETE policy or route deletes through an edge function.

- **R-2268 — P2 — DEFENSIVE — supabase-setup.sql:49-50, 58-59, 67-68, 71-72**
  Problem: subselects against `employees` use OR fallback to `companies.owner_id`. If both tables are accessed and one is RLS-restricted, the OR collapses inconsistently across tests. Should use a `SECURITY DEFINER` helper RPC like `get_my_company_id()` (mentioned in R-2 test) for single source of truth.
  Fix: replace the inline subselects with `company_id = get_my_company_id()`.

### supabase-neighbor-and-ai.sql
- **R-2269 — P0 — CROSS-TENANT LEAK / R-1600 PATTERN — supabase-neighbor-and-ai.sql:45**
  Problem: `CREATE POLICY "Authenticated can read neighbor_responses" ... USING (true)`. ANY authenticated user across ANY tenant can read every neighbor response — including `request_id`, `responder_id`, `status` (`calling_police` etc.), `note`. This leaks who responded to which civilian SOS across the entire user base. Same `USING(true)` class as the R-1600/L5-SEC-4 catastrophic pattern.
  Fix: `USING (responder_id = auth.uid() OR request_id IN (SELECT id::text FROM sos_sessions WHERE user_id = auth.uid()))`.

- **R-2270 — P1 — INTEGRITY — supabase-neighbor-and-ai.sql:14-22**
  Problem: `request_id TEXT NOT NULL` with no FK to any real table. A malicious responder can spam `request_id = 'whatever'` and pollute the table.
  Fix: FK to `sos_sessions(id)` (uuid cast) or add CHECK to validate format.

- **R-2271 — P2 — MISSING POLICY — supabase-neighbor-and-ai.sql**
  Problem: no UPDATE or DELETE policy declared. With RLS enabled and no policy, those ops are denied for authenticated — fine — but service_role still has full access. No audit trigger captures what service_role mutates.
  Fix: add an INSERT-only enforcement comment + an audit trigger.

- **R-2272 — P1 — INTEGRITY — supabase-neighbor-and-ai.sql:56-57**
  Problem: `ALTER TABLE sos_sessions ADD COLUMN IF NOT EXISTS ai_script JSONB;` — no CHECK constraint enforcing the `{ text, language, voice }` shape, no length cap on `text`. Elite users could submit 100 KB of TwiML payload that Twilio rejects mid-call, leaving the SOS audio silent.
  Fix: add CHECK (jsonb_typeof(ai_script) = 'object' AND length(ai_script->>'text') <= 500 AND ai_script->>'language' ~ '^(en-US|ar-SA)$').

### apply-p1-security-migrations.sql
- **R-2273 — P1 — LEAKED PROD IDENTIFIER — apply-p1-security-migrations.sql:7**
  Problem: comment `Project: rtfhkbskgrasamhjraul (fadiiiiiii)` leaks production project ref + operator identity in repo. Combined with the same string in `.env.example` + 15 other repo files = full attack-surface disclosure.
  Fix: remove operator name + project ref from comments; reference by env var name only.

- **R-2274 — P2 — DEFENSIVE — apply-p1-security-migrations.sql:58, 72**
  Problem: both `current_company_id()` and `verify_permission(TEXT)` use `SET search_path = public` (single schema). The hardening guide requires `SET search_path = public, pg_temp` to prevent a temp-schema function-shadowing attack against a SECURITY DEFINER routine.
  Fix: change to `SET search_path = public, pg_temp` (matches L5-SEC pattern enforced elsewhere).

- **R-2275 — P1 — RLS BYPASS — apply-p1-security-migrations.sql:26-29**
  Problem: `idempotency_cache_block_all` policy `FOR ALL TO authenticated USING (false) WITH CHECK (false)` is correct for authenticated; however no policy exists for `anon` and RLS is enabled — anon callers are denied by absence-of-policy, which is fine UNLESS the table's GRANTs were forgotten. The migration never explicitly `REVOKE`s privileges from anon/PUBLIC; if a future migration grants SELECT, the block_all policy lets it through.
  Fix: `REVOKE ALL ON public.idempotency_cache FROM PUBLIC, anon, authenticated;`.

- **R-2276 — P2 — RLS / SCOPE — apply-p1-security-migrations.sql:43-45**
  Problem: `biometric_verifications_self` policy is `FOR ALL` USING (user_id = auth.uid()) — admin/security cannot read another user's biometric verification history during incident review (chain-of-custody loss).
  Fix: add a separate SELECT policy gated on `is_admin()` for forensic readability.

### supabase/tests/l2-close-integration.sql
- **R-2277 — P0 — PROD DATA MUTATION RISK — l2-close-integration.sql:49-50**
  Problem: `SELECT id INTO v_company FROM public.companies LIMIT 1;` and `SELECT id INTO v_user FROM public.profiles LIMIT 1;` — the script picks an ARBITRARY real production tenant + user, attributes synthetic SOS events to them, then deletes audit/dispatch/metrics rows for that user. If a real SOS event is in flight for the picked user, the cleanup DELETEs may race and remove real rows.
  Fix: require the script to be run against a TEST schema only (refuse if `current_database() = 'postgres'` or pin a sentinel company name like `__INTEGRATION_TEST__`).

- **R-2278 — P0 — AUDIT-LOG MUTABILITY — l2-close-integration.sql:144**
  Problem: `DELETE FROM public.audit_log WHERE id IN (v_aud1, v_aud2);` — proves audit_log is delete-able from a SQL session that has DELETE grants. The L5-SEC-1 / W3-8 work hardened audit_log against authenticated DELETE, but a script run with service_role bypasses that. The fact that this script is checked in normalizes the pattern.
  Fix: route cleanup through a synthetic-only flag (`is_synthetic=true`) + cron purger; never `DELETE FROM audit_log` in a checked-in script.

- **R-2279 — P1 — TRANSACTIONAL SAFETY — l2-close-integration.sql:36-159**
  Problem: entire `DO $$ ... $$` block runs as a single PL/pgSQL anonymous block; if any RAISE EXCEPTION fires, the cleanup DELETEs at lines 144-147 are SKIPPED, and the test rows persist forever in production tables, polluting dashboards.
  Fix: wrap inserts in `BEGIN ... EXCEPTION WHEN OTHERS THEN cleanup; RAISE` or use a SAVEPOINT + always-run cleanup.

- **R-2280 — P2 — NOISE / FALSE POSITIVE — l2-close-integration.sql:53-61**
  Problem: each run inserts a NEW row in `sos_pipeline_metrics` tied to a real user_id (R-13 classification check would mark this synthetic only if `p_is_synthetic=true` AND email ends with `@sosphere.internal` — but here the user is picked from real `profiles`, not synthetic). R-13's downstream filter is bypassed and the row pollutes ops dashboards.
  Fix: pin `v_user` to a probe-domain user (`SELECT id FROM auth.users WHERE email LIKE '%@sosphere.internal' LIMIT 1`).

- **R-2281 — P2 — BREAKER STATE POLLUTION — l2-close-integration.sql:147**
  Problem: cleanup deletes `twilio_breaker_state WHERE key='integration-test'`. Fine for the test key, but if a future test passes a different key (typo, copy-paste), the breaker state row persists and affects all production calls keyed under the breaker.

---

## NOTABLE PATTERNS (META)
- **Source-pinning monoculture.** ~80% of the 95 test files use `readFileSync + regex.match` rather than importing + executing. This is FILE-DRIFT detection, not behavior-correctness verification. Several files acknowledge this explicitly in comments ("file-grep over importing + executing", "vitest doesn't render React in this CI"). The pattern is acceptable as a CHANGE-DETECTION net but is being LABELED as architectural-invariant / safety verification across the repo. This is mis-labeling that produces false confidence.
- **Marker-comment assertions.** Multiple tests assert that a string like `"CRIT-#11"` or `"L5-SEC-2"` appears in source as evidence the fix is "in place". A PR that removes the implementation but keeps the comment passes — the test is documentation-checking, not behavior-checking. (R-2190 / R-2223 / R-2256)
- **The 4 SQL files** are presented as routine setup, but each contains at least one P0 defect (public storage bucket, USING(true) cross-tenant read, production project ref leak, audit_log DELETE in a checked-in script). Treating them as "infrastructure" rather than "code" has bypassed normal review.

---

## TOP 10 P0 / P1 TICKETS (broken-safety-net items)

1. **R-2269 — P0 — CROSS-TENANT LEAK — supabase-neighbor-and-ai.sql:45**
   `USING (true)` on `neighbor_responses` SELECT lets any authenticated user across any tenant read every neighbor's SOS response (identity, status, free-text note). Identical pattern class to R-1600/L5-SEC-4. **Fix: scope to responder_id = auth.uid() OR request owner.**

2. **R-2264 — P0 — PUBLIC STORAGE BUCKET — supabase-setup.sql:77**
   Evidence bucket created with `public=true`. Photos + audio memos from real emergencies are world-readable via direct URL, bypassing the SELECT RLS policy. **Fix: `public=false` + signed URLs only.**

3. **R-2265 — P0 — STORAGE TENANT BYPASS — supabase-setup.sql:84**
   Storage INSERT policy has no path/tenant check — any authenticated user can upload/overwrite any path in the evidence bucket. **Fix: scope to per-tenant prefix.**

4. **R-2277 — P0 — INTEGRATION SCRIPT MUTATES PROD — l2-close-integration.sql:49-50**
   `LIMIT 1` selection of a real company + real user, with synthetic SOS rows + cleanup DELETEs attributed to them. **Fix: require sentinel test tenant; refuse on prod database.**

5. **R-2278 — P0 — CHECKED-IN AUDIT-LOG DELETE — l2-close-integration.sql:144**
   `DELETE FROM public.audit_log` in a script meant to run against prod normalizes the destructive operation that L5-SEC-1 / W3-8 spent migrations hardening against. **Fix: never delete from audit_log; flag synthetic rows for cron purge.**

6. **R-2266 — P0 — NULLABLE TENANT — supabase-setup.sql:32, 38**
   `evidence.company_id UUID` is NULLABLE; null rows are RLS-invisible to tenants but persist forever as orphan evidence. **Fix: NOT NULL + backfill + CHECK.**

7. **R-2176/R-2177/R-2178/R-2273 — P1 — PROD PROJECT REF LEAKED — repo-wide**
   `rtfhkbskgrasamhjraul` (with operator handle `fadiiiiiii`) is checked into the repo across 17 files including test fixtures, SQL comments, scripts, workflows, and .env.example. Anyone cloning the repo gets the production attack target. **Fix: replace every literal with an env-var reference; rotate the project if the leak is post-launch.**

8. **R-2166 — P1 — SOURCE-PINNING MONOCULTURE — 76 test files / 1,888 assertions**
   The L1/L2/L3/L4/L5/R-series "invariant" tests do not exercise their SUT. They `readFileSync + .toMatch`. A logic bug that leaves the magic strings intact (wrong column name baked into a working-looking string, missing await inside an existing await chain, wrong RPC parameter name, swapped argument order) passes all these tests. **Fix: each L#-letter family needs ONE end-to-end behavior test that actually executes the path against an ephemeral DB (or at least a unit-level test for the pure helper + a contract test against the real RPC).**

9. **R-2256 — P1 — MARKER-COMMENT ASSERTIONS — civilian-trial-server.test.ts:331 & similar**
   First test in CRIT-#11/CRIT-#12 suites: `expect(serviceSrc).toContain("CRIT-#12")` — asserts a code COMMENT marker. A PR that rips out `startTrialAsync` but leaves the comment passes. Same in delete-account-stripe-cancel.test.ts and several others. **Fix: remove marker-comment assertions; replace with a behavior assertion (call the function, observe the side effect).**

10. **R-2251/R-2257 — P1 — SAR DEMO BANNER IS THE ONLY GUARD — sar-demo-banner.test.ts**
    The test file itself documents that the SAR Protocol page (~2,800 lines) is wired to localStorage only and DOES NOT actually dispatch a rescue team. The ONLY safety net is a banner saying so, and the test only verifies the banner exists. Operators trusting the UI can press "Send Rescue Team" with zero real-world effect. **Fix: either wire the SAR engine to real dispatch (or admin-only feature-gate it) or replace the banner with a non-dismissible interstitial; either way, this is a life-safety issue, not a labeling issue.**
