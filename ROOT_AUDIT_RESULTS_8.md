# SOSphere — Root Audit Results, Wave 8 (Server-side: Edge Functions + Migrations + Android)

**Audit date:** 2026-05-23
**Trigger:** User asked what "out of scope" meant in MASTER_AUDIT and demanded coverage of the remaining server-side layers — the very layers all 2,518 frontend defects depend on.
**Method:** 5 dedicated subagents (E1-E5) reading line-by-line. All 5 finished in single pass.

---

## Coverage

| Batch | Files | Defects | R-ID range |
|---|---:|---:|---|
| **E1** Stripe + Twilio + Push edge functions | 13 | **117** | R-1309 → R-1425 |
| **E2** SOS + Dispatch + GDPR edge functions | 14 | **82** | R-1400 → R-1481 |
| **E3** `_shared/` + bulk-invite + send-invitations | 12 | **71** | R-1500 → R-1570 |
| **E4** SQL migrations PART 1 (chronological first ~55) | 55 | **78** | R-1600 → R-1677 |
| **E5** SQL migrations PART 2 + Android native | 79+17 | **106** | R-1700 → R-1805 |
| **TOTAL Wave 8** | **190 files** | **454** | R-1309 → R-1805 |

**Grand total Waves 1-8: 2,518 + 454 = 2,972 distinct defects.**

> Numbering note: E1 and E2 R-IDs partially overlap by accident of agent autonomy. The unique key is (file:line). Renumbering happens in MASTER_AUDIT.

---

## E1 — STRIPE + TWILIO + PUSH (117 defects)

### 🔴 CATASTROPHIC findings (immediate fix)

- **R-1309/1310** `stripe-webhook/index.ts:341,23-73` — Stripe-Signature length check is only truthy (1-char passes). Timestamp tolerance accepts **60s future-dated `t`** (Stripe spec rejects ALL future-dated). Replay window extension.
- **R-1326** `twilio-sms/index.ts:112-117` — **`to` field entirely client-controlled with NO allowlist.** Any logged-in user sends SMS to ANY phone on earth, billed to your Twilio account. $0.0079-per-text spigot.
- **R-1325** `twilio-sms/index.ts:100-117` — **`from` field client-controlled.** Cross-tenant impersonation: User A sends SMS appearing to come from Company B's Twilio number.
- **R-1332/1377/1421** `twilio-token/index.ts:101-107,169-179,212` — **`identity` parameter client-controlled, NOT bound to authenticated userId.** Any user mints Twilio capability token with `identity:"victim-user-id"` → makes calls AS the victim AND receives victim's inbound calls. Complete voice impersonation.
- **R-1334-1338** `send-push-notification/index.ts:464-492` — Cross-tenant push leak: shared company check has no role gating; `stringData` accepts arbitrary attacker-controlled keys; push tokens not filtered by company_id when target user belongs to multiple companies.
- **R-1368** `stripe-webhook-test-probe/index.ts` — **NO production guard.** Probe SIGNS WITH REAL WEBHOOK SECRET → if PROBE_SECRET leaks (CI logs), attacker injects "legitimately-signed" webhooks that pass real verification → free tier escalation, refund creation, anything.
- **R-1370** `twilio-config-fix/index.ts` — Destructive: PATCHes EVERY IncomingPhoneNumber on Twilio account with NO scope filter. Shared Twilio sub-account → other product's phones rewritten to our endpoints.
- **R-1374** `twilio-call/index.ts:226-233` — `mode=admin` has NO admin check on caller. Any worker can trigger TwiML-scripted calls to company owners.
- **R-1379** `stripe-webhook/index.ts:113` — Webhook trusts `metadata.planId` over actual `price.id`. **Stripe Customer Portal allows users to edit subscription metadata → set `planId:"enterprise"` on starter sub → free upgrade.**
- **R-1416** `stripe-webhook/index.ts:746-787` — `charge.refunded` cancels entire subscription on PARTIAL refunds (10% goodwill refund = full cancellation). Massive revenue defect.

### Other E1 categories (107 more):
- **Webhook signature verification** (R-1309-1314): Length check, replay tolerance, JSON vs urlencoded shape, bare catches, port normalization, env miss silent
- **Stripe idempotency** (R-1315-1319): Day-boundary key collision, no retry/backoff on stripeGet, no idempotency on portal/probe
- **Twilio billing leaks** (R-1320-1331): Cowbell loop, MachineDetection latency billing, no satellite-phone allowlist cap, normalizePhone strips DTMF commas, no per-company spend ceiling, sendEscalationSMS bypasses breaker, no hanging-fetch timeout, token TTL fixed 1h no revocation
- **Service role exposure** (R-1339-1343): Non-constant-time service-role compare, env-name in error messages, admin client in probes leaks SDK config
- **CORS misconfiguration** (R-1344-1350): `Access-Control-Allow-Origin: "*"` on state-changing endpoints (Stripe/Twilio probes), CORS missing on stripe-webhook errors, Content-Type in wrong header section
- **Env var fail-open** (R-1351-1357): STRIPE_SECRET not checked at startup, non-null assertions crash with unhelpful trace, wrong status codes (401 vs 503), env names leaked in error responses (`vapid_not_configured`)
- **Error response leakage** (R-1358-1365): Auth error messages leaked ("invalid signature", "expired"), full Twilio API error text, request_id pattern inconsistent across functions
- **Probe-in-production exposure** (R-1366-1373): Multiple probes shipped to production with PROBE_SECRET-only auth; `stripe-e2e-stress-probe` creates real Stripe customers; cleanup uses bare catches leaving fixtures; `twilio-config-fix` lacks scope filter; `forgery-probe` creates real auth.users row
- **Auth/role bypass** (R-1374-1380): super_admin role inconsistently checked across functions; portal opens for client-supplied companyId
- **Race conditions** (R-1381-1392): Dedup INSERT then DELETE race, ordering guard SELECT-then-UPSERT race, SELECT-then-INSERT-or-UPDATE customer ID race, channel cleanup setTimeout zombie, sequential push-to-tokens loop 5s+ tail latency

---

## E2 — SOS + DISPATCH + GDPR (82 defects)

### 🔴 CATASTROPHIC findings

- **R-1405/1470/1471/1472** `sos-alert/index.ts:2272-2300,978-985,1138-1144` — **Realtime channels `sos-${emergencyId}` are NOT tenant-scoped despite comments claiming W3-3 fix.** Heartbeat / escalate / end broadcasts leak live GPS to any subscriber knowing the SOS UUID (which is in the SMS sent to every contact!).
- **R-1410** `sos-bridge-twiml/index.ts:298-345` — Bridge "accept" dials self-edited `profiles.phone` with NO verification it's the SOS owner's verified contact. **Edit your own profile phone to a premium-rate number → trigger SOS → press 1 → owner billed for premium call.**
- **R-1404 + R-1408** `sos-alert/index.ts:1356-1399,309-319` — DB outage = **unlimited Twilio spend** (rate-limit fail-soft + breaker fail-open).
- **R-1417** `delete-account/index.ts:285-294` — `auth.deleteUser` fails but data is already deleted → user can still LOG IN with stale JWT to find their account "wiped". **GDPR non-compliance.**
- **R-1430** `dashboard-actions/index.ts:264-272` — `broadcast scope:"all"` has NO recipient cap. Enterprise tenant with 10k+ employees → 10k INSERT in one request → DB block.
- **R-1429** `dashboard-actions/index.ts:244-311` — NO rate limit on broadcast — admin loops `scope:"all"` → DoS the dashboard.
- **R-1455** `dashboard-actions/index.ts` — **NO idempotency at all** across all actions. Retry of `broadcast scope:"all"` from a flaky network sends 10k recipients TWICE.

### Other E2 categories (76 more):
- **SOS dispatch correctness** (R-1400-1408): END action accepts unvalidated comment/photos/recordingSec from caller; trigger path doesn't validate lat/lng (NaN/Infinity reaches forensic record); `normalizeE164` returns null silently → ZERO outbound for 0-contact SOS; PREWARM tier:"free" race with TRIGGER tier override
- **Twilio webhook signature** (R-1409-1414): `claimBridgeDial` fail-open on DB error → double bridge calls; `join-user` path skips gather-token verification; SIG_MISMATCH logs leak signing canonicalization details; 6-hour lookup limit drops older sessions silently
- **GDPR delete completeness** (R-1415-1418): Cascade delegated to RPC not verified here; storage cleanup only scans `evidence` bucket (other buckets leak); half-delete leaves auth.users row; Stripe Idempotency-Key reused on retry
- **GDPR export completeness** (R-1419-1426): Former-employee data invisible (gps_trail/checkins missed); audit_log only by actor_id (target_id missed); 5000-row silent truncation; single JSON.stringify exhausts 6MB edge cap; user's appearance in OTHER users' family_contacts not exported (data the system holds about them)
- **Dashboard-action authorization** (R-1427-1434): Legacy `companies.owner_id` only path misses `company_memberships` owners; `.or()` with raw user IDs; broadcast actor email leaked to recipients; "owner" fallback string written to FK-validated column
- **Cross-tenant data leak** (R-1435-1439): RLS-only filtering on incident-history; `gps_trail.employee_id` uses wrong key; existence oracle in 410 response; `profiles` queried with wrong column name → blank PDFs
- **Invitation security** (R-1440-1445): Supabase default 24h TTL, no revoke endpoint; 500/request × no daily cap = 30k invites/min; companies.owner_id only check breaks for membership-only owners; email regex `a@b.c` accepted; role hardcoded but not verified during `accept_invitation`; admin client treats ANY token verifiable by Supabase Auth as valid (multi-project key sharing risk)
- **Probe-in-production** (R-1446-1452): Probes create real auth.users rows in production; `sos-load-probe` may fire real Twilio if probe contact phone misconfigured; cleanup uses wrong table name → leaves forensic ledger pollution every run
- **Idempotency** (R-1453-1456): idempotency_cache fail-soft → retried SOS triggers TWO fanouts; ESCALATE composite key changes when STAGE changes → re-fanouts; delete-account cascade has no idempotency wrapper
- **Audit log integrity** (R-1457-1463): log_sos_audit failures only console.warn; export-my-data uses direct INSERT bypassing hash chain; inconsistent `p_actor` vs `p_actor_user_id` param names
- **Cross-cutting** (R-1464-1481): Module-level non-null env assertions crash with unhelpful errors; 7s grace delay holds worker; bridge calls lack StatusCallbackEvent; phone numbers in audit log row IDs (GDPR pseudonymization violation)

---

## E3 — `_shared/` + bulk-invite + send-invitations (71 defects)

### 🔴 CATASTROPHIC findings

- **R-1501** `_shared/api-guard.ts` — **File is named "API Guard" but performs ZERO authentication.** No JWT verification, no `auth.uid()`, no RBAC. Every edge function must do its own auth; many do this inconsistently. **Misleading abstraction creates false impression of security.**
- **R-1527** `_shared/rate-limiter.ts:222-228` — `isUserOnSosPriority(key, now)` looks up by composite `${tier}:${user}` but `markSosPriority` STORES by raw `userId`. **SOS-priority boosts NEVER apply across all 39 edge functions** — latent functional bug.
- **R-1530** `_shared/twilio-breaker.ts:47-68,73-97` — Both `checkBreaker` and `recordBreaker` fail-OPEN on RPC error. **Pathological dead loop**: swallowed failure to record a Twilio FAILURE → breaker never trips → next 1000 requests all proceed → each fails silently.
- **R-1551** `process-bulk-invite/index.ts:192-198` — **`companyId = msg.message.company_id || job.company_id` DOES NOT VERIFY message matches job metadata.** Caller-controlled message field overrides job. Cross-tenant injection under service-role.
- **R-1565** `send-invitations/index.ts:193` — `from: "SOSphere <onboarding@resend.dev>"` **HARDCODED Resend sandbox sender.** Production emails almost certainly land in spam (not your verified domain).
- **R-1561** `_shared/api-guard.ts:170-178` — 32-bit FNV hash for payload-repeat detection. **Birthday paradox ~65k payloads → collision → false 429 block on real SOS distress signal.**

### Other E3 categories (65 more):
- **Auth guard bypass / token verification** (R-1500-1511): CORS reflects allowlisted origin on attacker-Origin requests (cache poisoning); `getSecret` silent fallback to TWILIO_AUTH_TOKEN; no upper TTL cap on gather-token; cron secret non-constant-time compare leaks length; 5min secret cache window of dual-acceptance on rotation
- **Background task race** (R-1512-1515): `backgroundOrAwait` blocks response in fallback mode; silent failure swallowing; double-execution risk; no timeout
- **Retry policy bugs** (R-1516-1521): `isTransientError` regex matches ANY 3-digit "5xx-shaped" number in error message (e.g., row ID with 503 in it → retried); no detection of class 40001 (serialization_failure) or 40P01 (deadlock_detected); no idempotency assertion; no jitter → thundering herd
- **Rate limit bypass** (R-1522-1529): In-memory per-isolate Map = multiply budget by isolate count; geo-distributed botnet bypass; `isSosRequest=true` claim bypasses ALL limits; `XFF` from attacker; off-by-one (effective limit = max+1)
- **Circuit breaker fail-open** (R-1530-1533): R-1530 above; fail-open returns false "closed"; no SOS-override; default "global" key trips for all targets
- **Webhook signature weakness** (R-1534-1538): No central verifier (per-function inline); no URL canonicalization; HMAC-SHA1 hardcoded
- **Email/SQL injection** (R-1539-1549): Header injection via `\r\n` in companyName; no length validation; sequential await loop hits 60s timeout; `batchSize:"all"` or `-1` slice edge case; case-sensitive email dedup misses; weak email regex
- **Service role exposure / Misc** (R-1550-1570): R-1551 above; `invited_by: createdBy` not verified; deprecated "personal" plan still in VALID_PLAN_IDS; no server-side validation that env-configured prices match expected catalog ($7, $14); self-hosted Supabase regex breakage (functions-host); twilio-config-drift port normalization gaps; `repeatTracker` Map unbounded leak

---

## E4 — SQL migrations PART 1 (78 defects, R-1600 → R-1677)

### 🔴 CATASTROPHIC findings

- **R-1600** (confirms Wave 7 R-920 pattern at SQL layer) — `audit_log` INSERT policy with `WITH CHECK (company_id in (caller's companies))` lets ANY company member forge arbitrary `actor_id`/`actor_name`/`actor_role`. **Policy binds tenant but not identity.**
- **R-1606, R-1607, R-1666** — `OR company_id IS NULL` short-circuits in policies on `audit_log`, `evidence`, `chat_messages` joins. Combined with `log_sos_audit` originally writing NULL company_id (R-1610, fixed W3-18 a week later) and projection trigger NULLing company_id when company deleted (R-1677), this created **mass cross-tenant audit leaks during pre-launch window**.
- **R-1611** — `geofences_authenticated_read` and `sensor_events_authenticated_read` in `g_31_rls_no_policy_cleanup` use literal **`USING (true)`**. Geofences (sensitive evacuation point coords) + sensor telemetry leak across tenants by design.
- **R-1620** — `log_sos_audit` SECURITY DEFINER granted to `authenticated` for days, allowing **direct audit forgery from any logged-in user**.
- **R-1617** — `promote_user_to_admin` had `IF auth.uid() IS NULL THEN NULL -- service role bootstrap` branch. Any path that could clear `auth.uid()` (or reach via leaked service_role key) gained **unconditional admin grant**.
- **R-1624** — Chat message `signature` column is plain SHA-256 (not HMAC). Anyone with DB read access can recompute valid signatures for arbitrary tuples. **Only at-rest tamper-detection, not forgery prevention.**
- **R-1663, R-1664** — Adding `audit_log` and `gps_trail` to `supabase_realtime` means **every NULL-company-id leak becomes a LIVE STREAM**.
- **R-1633-1636** — Cascade-delete on compliance tables: `audit_log.company_id`, `risk_register`, `training_records`, `investigations`, `civilian_incidents`, `subscriptions` all use `ON DELETE CASCADE` → wipes records required for **GDPR/ISO/insurance retention** when tenant or user removed.
- **R-1672** — `log_retention_cleanup` swallows errors via `EXCEPTION WHEN OTHERS THEN RAISE WARNING; RETURN NEW`. **GDPR Art. 5(1)(e) compliance becomes unprovable.**

### Other E4 themes (69 more):
- **RLS policy holes**: `USING(true)`, `WITH CHECK(true)`, `OR company_id IS NULL` short-circuits, missing `ENABLE ROW LEVEL SECURITY` after policy drops, FORCE RLS lockout risk
- **SECURITY DEFINER without authz check**: 12+ functions rely on grant lockdown only; any GRANT regression = privilege escalation
- **Missing tenant scoping**: Tables created without `company_id` column then retrofitted with policies that fall back to `IS NULL`
- **Cascade delete missing or wrong**: ON DELETE CASCADE on retention-critical tables; ON DELETE SET NULL leaving orphans
- **Search_path injection**: Multiple SECURITY DEFINER functions missing `SET search_path = pg_catalog, public` → operator privilege escalation via schema injection
- **Anon GRANT**: `get_my_identity`, `log_auth_event`, `current_dpa_version`, `check_rate_limit` all granted to anon
- **Trigger error swallowing**: 5+ triggers with `EXCEPTION WHEN OTHERS THEN RAISE WARNING; RETURN NEW` — silently breaks audit/compliance
- **Type drift across migrations**: `delete_user_completely` had three sequential type-mismatch fixes (v1→v2→v3→W3-20). Multi-day windows when GDPR Art. 17 didn't actually work.

---

## E5 — SQL migrations PART 2 + Android native (106 defects)

### PART A — SQL PART 2 (74 defects, R-1700 → R-1773)

**🔴 CATASTROPHIC:**
- **R-1702** — `sos_sessions_self_write FOR ALL` lets civilians **DELETE their own active SOS row mid-emergency** (duress-erase).
- **R-1716** — `check_company_twilio_budget` granted to authenticated, NO caller-owner check → **cross-tenant financial info disclosure**.
- **R-1738** — Any company-membership with `super_admin` role reads ALL unmatched SMS replies platform-wide. **Trivially escalated.**
- **R-1739** — Under-13 user gets `ok:false` but session stays. They re-call with different DOB. **COPPA bypass.**
- **R-1742** — `gps_own_user` policy reads `auth.jwt() ->> 'company_id'` — JWT custom claim **never set by Supabase**. Dead policy. Forged JWT pins to any company.
- **R-1752** — Pre-R30 `accept_invitation` accepted ANY role from invitation incl. 'admin'. **~15 day privilege-escalation window.**
- **R-1763** — Whitelist fix in R30 doesn't clean up existing admin/owner rows granted via the bug. **Live privilege escalation rows persist.**

**Other themes (67 more)**: cast bugs in policies, RLS policy USING expressions that error on legacy data, ON DELETE CASCADE on emergencies (owner deletes own forensic chain), promotion to authenticated re-introducing post-lockdown gaps, hardcoded `extensions.digest()` paths that break on schema move, broken email/XSS regex, batch import single-bad-char rollback, no clock-skew tolerance, RPC granted to anon for fingerprinting/DoS surface.

### PART B — Android native (32 defects, R-1774 → R-1805)

**🔴 CATASTROPHIC findings:**

- **R-1792** `android/app/keystore.properties:3-6` — **Release keystore password `Fz07506771765` AND key password committed in working tree alongside `sosphere-release.jks`. Anyone with repo access can sign malicious APKs impersonating official release. Supply-chain compromise.**
- **R-1785** `MainActivity.java:73-146` — `addJavascriptInterface(..., "SOSphereNative")` exposes `directCall(phoneNumber)` to ANY JS in WebView. **No origin check → attacker JS dials premium-rate numbers using the user's phone account.**
- **R-1786** `MainActivity.java:73-85` — JS bridge `setEmergencyActive(boolean)` lets attacker JS trigger immersive + lock-screen UI → **phishing.**
- **R-1802** `res/xml/config.xml:3` — `<access origin="*" />` lets WebView navigate to ANY origin. **Combined with R-1785 → attacker subdomain invokes `SOSphereNative.directCall`.**
- **R-1784** `MainActivity.java:65-70` — `onGeolocationPermissionsShowPrompt` auto-grants geolocation to ANY origin. **WebView XSS or MITM → attacker page gets GPS without user consent.**
- **R-1780** `CallStateReceiver.java` + `MainActivity.java:43-44` — Dynamically registered receiver. Android 13+ requires `RECEIVER_EXPORTED` or `RECEIVER_NOT_EXPORTED` flag, not specified → **defaults to EXPORTED. Any app broadcasts PHONE_STATE_CHANGED to spoof `notifyWebView('answered')`.**
- **R-1790** `CallStateReceiver.java:21-47` — Validates `intent.getAction()` only, not package origin. **Any app spoofs SOS-call lifecycle.**
- **R-1795** `android/app/build.gradle:114-115` — `release { minifyEnabled false }`. **APK trivially decompilable. All endpoints + JS bridge surface exposed.**
- **R-1778** `AndroidManifest.xml:73` — `MainActivity android:exported="true"` with 5 deep-link intent-filters. **Any installed app crafts Intent → WebView XSS/open-redirect.**
- **R-1805** `AndroidManifest.xml:11-12` — `FOREGROUND_SERVICE`/`FOREGROUND_SERVICE_LOCATION` declared but NO `<service>` element. **SOS monitoring stops on app swipe-from-recents.**

**Other themes (22 more)**: Over-broad `READ_PHONE_STATE` (IMEI/IMSI leak), missing `ACCESS_BACKGROUND_LOCATION` for 24/7 SOS app, missing `RECEIVE_BOOT_COMPLETED` (dead after reboot), `<external-path name="my_images" path="." />` exposes entire external storage root, no `setAllowFileAccessFromFileURLs(false)`, FLAG_KEEP_SCREEN_ON always-on thermal throttling, `static MainActivity activityRef` Activity leak, single permission prompt bundling fails on blanket deny, no `onRequestPermissionsResult` override → crash, minSdkVersion=24 (Android 7 EOL 2019) allows cleartext HTTP, missing `networkSecurityConfig`, debug uses public `~/.android/debug.keystore`.

---

## Wave 8 TOP 25 P0 STOP-SHIP (must close immediately)

These are the worst additions to the Phase 0 list. They join `MASTER_AUDIT.md` Phase 0 surgical order.

### Server-side data leaks (must fix BEFORE anything else)
1. **R-1600/1606/1607/1666** — NULL-company-id RLS short-circuit pattern across audit_log/evidence/chat_messages. Cross-tenant audit + evidence leak.
2. **R-1611** — `USING (true)` on geofences + sensor_events. Cross-tenant evacuation coords + telemetry.
3. **R-1620** — `log_sos_audit` was grantable to authenticated → audit forgery.
4. **R-1663/1664** — `audit_log` + `gps_trail` added to supabase_realtime → live stream of cross-tenant leaks.
5. **R-1405/1470/1471/1472** — Realtime channels `sos-${emergencyId}` not tenant-scoped → live GPS leak to anyone knowing the SOS UUID (which is in SMS to every contact!).

### Financial / billing fraud (must fix to avoid bankruptcy)
6. **R-1326** — `twilio-sms` lets any user SMS any phone on earth, on your tab.
7. **R-1332** — `twilio-token` identity impersonation → call/SMS as victim.
8. **R-1410** — Bridge accept dials self-edited `profiles.phone` → premium-rate fraud.
9. **R-1379** — Stripe Portal metadata edit → free tier escalation.
10. **R-1416** — Partial refund cancels entire subscription.
11. **R-1368** — `stripe-webhook-test-probe` signs with real webhook secret in prod.

### Authentication / identity bypass
12. **R-1551** — `process-bulk-invite` cross-tenant company_id injection under service role.
13. **R-1716** — `check_company_twilio_budget` no caller-owner check → cross-tenant financial info disclosure.
14. **R-1738** — `super_admin` role escalation reads all unmatched SMS replies platform-wide.
15. **R-1742** — `gps_own_user` policy reads non-existent JWT claim → dead policy → forged JWT pins to any company.
16. **R-1763** — Live admin/owner rows from R-30 privilege escalation bug never cleaned up.

### Android native (supply-chain + WebView attack chain)
17. **R-1792** — **Release keystore password committed in repo.** Immediately rotate AND scrub git history (BFG/git-filter-repo).
18. **R-1785 + R-1786 + R-1802 + R-1784** — WebView attack chain: `<access origin="*">` + JS bridge `directCall` + `setEmergencyActive` + auto-granted geolocation. Lock WebView origins; restrict JS bridge to verified origins; require permission prompt for geolocation.
19. **R-1795** — Enable `minifyEnabled true` for release.
20. **R-1805** — Implement actual `<service>` for foreground SOS monitoring (today permission declared but service missing → SOS dies on app swipe).

### SOS dispatch correctness
21. **R-1404 + R-1408** — DB outage = unlimited Twilio spend (rate-limit + breaker both fail-open during emergencies).
22. **R-1417** — `delete-account` partial-failure state strands auth.users row → GDPR violation.
23. **R-1430** — `broadcast scope:"all"` no recipient cap → 10k INSERT in one request.
24. **R-1455** — `dashboard-actions` has NO idempotency anywhere → retries double-broadcast.
25. **R-1672** — `log_retention_cleanup` swallows errors → GDPR Art. 5(1)(e) unprovable.

---

## Updated Phase 0 estimate

Wave 8 adds ~80 new P0 tickets to the existing 60 in MASTER_AUDIT (Layer 0 in particular grows significantly because the SQL audit found policy + grant + cascade bugs that the database team must own). New Phase 0 total: **~140 STOP-SHIP tickets across 8 layers** (added: Layer -1 = supply chain / build / keystore).

Revised timeline:
- 1 engineer full-time: **12-15 weeks**
- 3 engineers parallelized: **5-7 weeks**
- 5 engineers (split by layer + parallel pairs): **3-4 weeks**

---

## What this audit STILL doesn't cover

After Wave 8 the remaining gaps are:
1. **Penetration testing** — practical exploitation of the documented surfaces (XSS, IDOR, JWT trust, SSRF, webhook spoofing, JS bridge abuse). Requires live system + Burp Suite / similar.
2. **Load / chaos testing** — practical stress to expose races (k6, Artillery, fault injection).
3. **CI/CD workflows** — `.github/workflows/*.yml` not yet line-read (4 files: build-apk, ci, codeql, probes).
4. **vercel.json** — line-read for CSP/X-Frame-Options/HSTS headers.
5. **Test fixtures + e2e tests** — `src/app/components/__tests__/` (95 test files) — verifies behavior the audit assumed is buggy.

A small Wave 9 could close items 3-5 (~100 files, mostly small). Pentest + load test are tooling-bound and require live infra access.

---

## Files

- `ROOT_AUDIT_RESULTS.md` → `ROOT_AUDIT_RESULTS_7.md` — Waves 1-7 frontend (2,518 defects)
- `ROOT_AUDIT_RESULTS_8.md` — **this file** — Wave 8 server-side (454 defects, R-1309 → R-1805)
- `MASTER_AUDIT.md` — will be updated to add Layer -1 (supply chain) and integrate Wave 8 P0 tickets

**Total known static defects across the platform: 2,972** across 32+ audit dimensions and **429 files line-read** (239 frontend + 190 server-side).
