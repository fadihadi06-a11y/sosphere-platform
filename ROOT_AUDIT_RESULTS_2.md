# SOSphere — Root Audit Results, Wave 2 (G→Q)

**Audit date:** 2026-05-21
**Trigger:** User directive — "كلاود قلتها مسبقا لك والان اعيدها اريد المنصة والتطبيق والكود البرمجي جميعا يفحص بطريقة عميقة جدا… انت ترقع وانا ارفض الترقيع هذه منصة انقاذ ارواح وليست للترقيع"
**Scope:** 11 parallel deep audits across 11 dimensions not covered in Wave 1 (A-F).
**Method:** 11 dedicated subagents, each given an exhaustive checklist; static analysis only (no runtime).

---

## Severity Totals — Wave 2

| Dimension | CRIT | HIGH | MED | LOW | Total |
|---|---:|---:|---:|---:|---:|
| **G** — Supply chain | 1 | 20 | 22 | 5 | **48** |
| **H** — Frontend quality | 6 | 9 | 9 | 6 | **30** |
| **I** — Backend behaviors | 6 | 18 | 21 | 11 | **56** |
| **J** — Money & Time | 9 | 10 | 10 | 7 | **36** |
| **K** — Auth & Session | 9 | 11 | 14 | 10 | **44** |
| **L** — Mobile / Capacitor | 7 | 12 | 12 | 13 | **44** |
| **M** — Compliance / Legal | 8 | 15 | 8 | 3 | **34** |
| **N** — Operations | 13 | 14 | 5 | 4 | **36** |
| **O** — A11y / i18n | 5 | 15 | 7 | 4 | **31** |
| **P** — Performance / Scale | 9 | 15 | 14 | 5 | **43** |
| **Q** — Pentest (static) | 5 | 10 | 9 | 14 | **38** |
| **TOTAL Wave 2** | **78** | **149** | **131** | **92** | **450** |

Combined with Wave 1 (A-F = 53 defects, of which 14 CRIT + 18 HIGH + 12 MED + 9 LOW):
**Grand Total = 503 distinct root-level defects** across 17 audit dimensions.

---

## STOP-SHIP — Top 25 (Wave 2)

These are the defects that, in the auditors' independent judgment, must be fixed before any production traffic. Each has direct file:line evidence and a clear life-safety / regulatory / financial blast-radius.

| # | Sev | Dim | Title | Evidence | Blast-radius |
|---|---|---|---|---|---|
| W2-01 | CRIT | Q | `twilio-token` mints Voice JWT with attacker-chosen identity | `supabase/functions/twilio-token/index.ts:169` — `identity` taken from body, never compared to caller `userId` | Any logged-in user can impersonate any other user on Twilio Voice. Place / receive their calls. |
| W2-02 | CRIT | Q | `twilio-sms` lets any authed user SMS any number with arbitrary body | `supabase/functions/twilio-sms/index.ts:100-117, 156-160` — `to` / `customMessage` from body, no allowlist | Unbounded Twilio bill + SOSphere-brand phishing SMS. |
| W2-03 | CRIT | Q+L | Storage upload RLS lets any user overwrite another user's SOS evidence | `supabase/migrations/20260424165119_storage_evidence_scoped_read_via_alter.sql:66-70` — upload policy checks only `owner=auth.uid()`, not path; `sos-audio-upload.ts:86` uses client-supplied `emergencyId` | Forensic chain-of-custody broken — life-safety evidence destroyable. |
| W2-04 | CRIT | Q | No CSP header anywhere; inline scripts on every page | `index.html:54-83`, `public/_headers` (no CSP); `vercel.json` (no CSP) | Any reflected XSS → full account takeover. |
| W2-05 | CRIT | Q+I | `push_tokens` UPSERT conflict on `(user_id,token)` — same token can be claimed by 2 users | `src/app/components/api/fcm-push.ts:179-188`, `push-notifications-native.ts:213` | Push-token theft → silent receipt of victim's SOS-confirm pushes. |
| W2-06 | CRIT | L | `capacitor-call-number@1.0.3` requires Capacitor v3; project on v6 | `package.json:67`; plugin peerDep `^3.1.1` | Direct dial during SOS will throw and likely crash JS bridge. |
| W2-07 | CRIT | L | No foreground service declared in AndroidManifest despite holding `FOREGROUND_SERVICE_LOCATION` | `android/app/src/main/AndroidManifest.xml:11-12` declares perm, no `<service>` block | Android 14+ SecurityException on startForegroundService; Play Console policy violation. |
| W2-08 | CRIT | L | GPS uses `navigator.geolocation` (web), NOT `@capacitor/geolocation` | `offline-gps-tracker.ts:441, 553` | On Xiaomi MIUI / Huawei EMUI / Samsung One UI, GPS stops within seconds of screen-off. SOS location dies. |
| W2-09 | CRIT | L | No battery-whitelist / Doze handling; no `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | grep returned 0 hits | App killed ~30 min after backgrounding on MENA-popular OEMs. #1 cause of "safety app didn't fire". |
| W2-10 | CRIT | L | TLS / cert pinning missing; `network_security_config.xml` absent | `android/app/src/main/res/xml/` — file does not exist | Rogue WiFi MITM steals Supabase JWT + live SOS location. |
| W2-11 | CRIT | L | Hardcoded keystore password = user's phone number "07506771765" | `android/app/keystore.properties:4-6` | If `keystore.properties` ever leaks, APK signing identity is fully compromised. |
| W2-12 | CRIT | L | `evidence` storage bucket is `public` with no MIME / size limit | `supabase-setup.sql:76-78`; `evidence-store.ts:134` trusts `blob.type` | Public CDN hosting of arbitrary attacker-controlled blobs; OOM on entry-level Android from huge HEIC uploads. |
| W2-13 | CRIT | N | Audit log is NOT append-only — service_role retains UPDATE/DELETE | `supabase/migrations/20260426190000_w3_8_audit_log_grants_tighten.sql:32-33` | SOC 2 CC7.2 / ISO 27001 §A.12.4.2 fail. A compromised edge function can erase forensic trail. |
| W2-14 | CRIT | N | The only file in `backups/` is **0 bytes** | `backups/backup-before-l1-2026-05-08.sql` — size 0 | No verifiable DR artifact. RTO cannot be met from this. |
| W2-15 | CRIT | N | No on-call rotation, no pager, no status page, no SLO doc | `.github/workflows/probes.yml:23-24` — only escalation channel is "GitHub repo-admin email" | 3am SOS outage has no human in the loop. SOC 2 CC7.3/CC7.4 fail. |
| W2-16 | CRIT | N | No deploy rollback procedure; CI builds but never deploys + no smoke-test gate | `docs/RUNBOOK.md:396-427` | A bad SOS-alert deploy cannot be rolled back without manual Supabase Studio intervention. |
| W2-17 | CRIT | N | No feature-flag system → every deploy is full blast-radius | grep returned 0 LaunchDarkly/GrowthBook/Unleash hits | Bad SOS-dispatch change hits 100% users instantly. |
| W2-18 | CRIT | J | Zero VAT / tax handling for Saudi (15%), UAE (5%), Iraq (0%) | Entire `src/` and `supabase/` — 0 vat/tax money-related hits | Cannot lawfully sell to SA/AE customers without ZATCA / FTA-compliant invoices. |
| W2-19 | CRIT | J | App is NOT currency-aware — pricing hardcoded as `$149` for SA/IQ/AE markets | `src/app/constants/pricing.ts:36-178`; no `Intl.NumberFormat` anywhere | Off-by-100× errors guaranteed on first SAR/IQD/AED Stripe price ID. |
| W2-20 | CRIT | J | Trial / session / Elite-feature gating uses `Date.now()` (device clock) | `src/app/components/trial-service.ts:98,144`, `subscription-service.ts:179`, 6 more files | Rolling device clock back grants free Elite forever / resets trial / extends session. |
| W2-21 | CRIT | J | SOS forensic PDF timestamps rendered device-local with NO timezone marker | `src/app/components/emergency-lifecycle-report.tsx:377-378` | Legal evidence chain compromised — incident PDFs not defendable in court. |
| W2-22 | CRIT | M | No DPIA, no ROPA, no executed SCCs, no SDAIA cross-border filing | grep — 0 matches anywhere | KSA PDPL Art. 29 direct violation (data hosted in India without authorization). Pre-sale enterprise audit fails instantly. |
| W2-23 | CRIT | M | No breach-notification playbook; KSA PDPL Art. 28 = 72h SDAIA filing | `docs/RUNBOOK.md` §5 is technical-only | First PII incident = uncoordinated response = additional regulator fine. |
| W2-24 | CRIT | K | SOS during long emergency: refresh-failure path silently drops the alert | `src/app/components/sos-server-trigger.ts:280-306` | Lost-hiker / 2h+ SOS loses contact when access token expires + refresh fails — bubbles 401 with no escalation. |
| W2-25 | CRIT | K | `check_rate_limit` RPC was REVOKED from `authenticated` but client still calls it as authenticated | `supabase/migrations/20260514230000_r12_secdef_grant_lockdown.sql:50-51` + `supabase-client.ts:301-321` | All server-side OTP/auth rate-limiting is dead. Falls back to in-memory client Map. SMS-pump fraud feasible. |

---

## Detailed Findings by Dimension

The full text of each subagent's report is preserved in the audit transcript. Below is a condensed index pointing each finding to its R-number for tracking (R-142 → R-591). The R-numbers are assigned sequentially in the merged plan; the original agent IDs (e.g., CRIT-M3, P-PERF-038) remain in the per-dimension sections.

### G — Supply Chain (48 findings)
- **G-CRIT**: G-1 Vercel OIDC token on disk in `.env.local`
- **G-HIGH** (20): includes 7 outstanding npm CVEs (tar/xmldom/postcss/protobufjs/brace-expansion/ws + @capacitor/cli v6→v8 fix-available), 20+ floating `^` ranges on auth/SOS-critical deps (`@capacitor/geolocation`, `@capacitor/push-notifications`, `@twilio/voice-sdk`, `capacitor-call-number`, `firebase`), `fix-capacitor-gradle.cjs` mutates node_modules with no hash verification, missing `permissions:` blocks in CI workflows, third-party Actions pinned by tag not SHA, secrets echoed via `echo` (visible if `set -x` ever added), `firebase-messaging-sw.js` loads gstatic.com without SRI, Supabase anon JWT in `.env`, Google OAuth ID in tracked `capacitor.config.json`, Firebase Web API key in tracked SW, Android FCM API key in tracked `google-services.json`, `capacitor-call-number@1.0.3` peerDep mismatch, `@codetrix-studio/capacitor-google-auth@3.4.0-rc.4` pre-release in prod auth path, no `deno.lock` / `import_map.json` for any edge function, `@supabase/supabase-js@2` floating major across 30+ functions, `deno.land/std@0.168.0` (unsupported) mixed with `@0.177.0`, no SRI on esm.sh imports.
- **G-MED** (22): npm CVE postcss/protobufjs/brace-expansion/ws, pre-release dep, `overrides` uses caret, postinstall runs arbitrary local scripts, `actions/*@v4` tag-pinned, version-drift v4 vs v5 across workflows, debug APKs retain 30d with secrets baked, LGPL-3.0 transitive via `@img/sharp` (no NOTICES file), Google Fonts CSS without SRI, `.env.example` lists privileged secret names, no gitleaks/trufflehog in CI, Capacitor core 6.x while CVE fix requires 8.x, lockfile preserves vulnerable transitives, `protobufjs` 7.5.6 transitive via firebase, `patch-google-auth.js` mutates node_modules without hash, `check-function-drift.mjs` uses PAT with no scope limit, `dist/` committed alongside source, `deploy-edge-function.mjs --auto-commit` self-pushes.
- **G-LOW** (5): `install-git-hooks.mjs` flips `core.hooksPath`, debug APK 30d retention, PowerShell script ACL not enforced, `npm audit --audit-level=critical` in CI suppresses high+moderate, `audit:check` script inconsistent at `--audit-level=high`.

### H — Frontend Quality (30 findings)
- **H-CRIT** (6): MediaRecorder + mic stream leak (`incident-photo-report.tsx:129-197` — 0 useEffect cleanup), battery-check race (`sos-emergency.tsx:1380-1402` no isCancelled), `watchPosition` GPS handle leak (`mission-tracker-mobile.tsx:142-234` cleanup never calls `clearWatch`), popstate handler accrues (`mobile-app.tsx:1383-1416`), SOS screen NOT wrapped in its own ErrorBoundary, Capacitor `addListener` async race (multiple files) — cleanup runs before promise resolves, listener orphaned permanently.
- **H-HIGH** (9): 4+ async setState races (otp-verify, welcome-activation, sos-emergency, forensic-photo-capture), `<Suspense fallback={null}>` flash-of-blank, lazy chunks without per-screen ErrorBoundary, stale closure in sos-emergency 553-line mega-effect with `[]` deps, base64 avatar (50-200KB) in localStorage non-tenant-scoped, plaintext PII across 7+ localStorage keys, `dangerouslySetInnerHTML` on server-supplied SVG (`mfa-enrollment-modal.tsx:231`), uncleared setTimeout in admin/SOS popups, fall-detection async permission race.
- **H-MED** (9): 535 `any`/`as any`/`@ts-ignore` across 125 files, 624 `console.log/warn/error` across 121 files with no `__DEV__` guard, 322 inline `style={{}}` in sos-emergency.tsx with only 11 useMemo/useCallback in 4586 lines, vite warning-limit raised to 600KB (masking ≥500KB chunks), `window.location.href = "tel:..."` 6 sites, `document.querySelector`/`getElementById` 5 sites, dashboard mountedRef pattern fragile, welcome-onboarding RAF chain, admin-incoming-call timer-cleanup ambiguous.
- **H-LOW** (6): 78 touch targets <44×44px across 20+ files, `Suspense fallback={null}` flash, OTP setTimeout-onVerify leak, inline JSX prop allocation in Suspense fallback, unused-export risk (`discreet-sos-mode-v2.ts` etc.), `dist/` not built at audit time so chunk sizes unverified.

### I — Backend Behaviors (56 findings)
- **I-CRIT** (6): No AbortController on Twilio dispatch fetch (twilio-call:297, twilio-sms:224), per-request `createClient` in SOS path (sos-bridge-twiml has FOUR), sequential N+1 RPC writes per contact in SOS (sos-alert:1849-1927), sequential spend-ledger N+1 (sos-alert:2185-2208), sequential push fanout per token (send-push:504), per-request Stripe webhook `createClient`.
- **I-HIGH** (18): No fetch timeouts on Stripe/FCM/twilio-status, no advisory lock on any pg_cron job (bulk-invite worker can overlap with 55s timeout), unindexed FKs on `ops_alerts.acknowledged_by`/`async_jobs.created_by`/`company_trial_dpa.signer_user_id`/`profiles.first_company_id`, RLS bare `auth.uid()` (not `(SELECT auth.uid())`) 8+ sites, RLS per-row nested EXISTS on `company_messages` + storage.objects, per-request createClient in 5+ critical functions, no jitter in `_shared/db-retry.ts`, fixed-interval probe retries, PII in `console.log` 8+ sites (twilio-status:685 logs adminPhone, twilio-sms:260 logs phone+IP+UUID, etc.), top-level `btoa` makes credential rotation require isolate recycle, sequential SQL loop in process-bulk-invite (N+1 selects before auth-admin call), sos-bridge-twiml 4 separate per-request createClient, idempotency missing on twilio-call/twilio-sms/send-push/invite-employees, owner fan-out push awaits in `backgroundOrAwait`, `resolveCompanyOwnerUserId` 2 sequential lookups, double-write on idempotency_cache, identity RPC has v1→v4 with `CREATE OR REPLACE` (env-drift risk), `DROP NOT NULL` on `sos_sessions.triggered_at`.
- **I-MED** (21): cold-start JSON parse, JSONB filter without GIN, leading-wildcard LIKE, 3-tier nested EXISTS on storage.objects, incident-report-data 4 createClient/request, twilio-token per-request createClient, advisory-lock missing on trial-sweep, 02:00 UTC = 05:00 KSA local timing, sequential admin SMS loop, twilio-config-fix retry loop, retention cron-count assertion brittle, prewarm upsert per heartbeat unrate-limited, audit_log row per push, Realtime channel setTimeout-close, `_cachedJwts` Map never evicts, `_fcmServiceAccount` cache null-latch on parse failure, `_cachedCronSecret` 5-min TTL no jitter, audit_chain_seq fix migration suggests prior fragility, Stripe webhook read-then-write TOCTOU, idempotency double-write.
- **I-LOW** (11): Top-level breakerClient at module load, heavy regex at module load, console.warn logs vault state, no storage bucket creation in migrations, zero pgsodium columns despite "evidence-bearing" positioning, claimBridgeDial fails-open, JSON parse before auth, archive then audit non-atomic, sequential fixture creation in stress probe, cron-cleanup re-schedules every migration, audit chain seq migration out-of-order.

### J — Money & Time (36 findings)
- **J-CRIT** (9): Hardcoded USD pricing in SA/IQ/AE markets, zero VAT/tax handling (ZATCA missing), Stripe amounts unit-unaware (`amount_due`/`upcoming_renewal_amount` stored as int with no currency tag), IQD subunit not modeled (no per-currency env vars), Twilio spend ledger `numeric(10,4)` float-USD only, `charge.refunded` flips sub to canceled even for partial refunds, `Date.now()` for trial/session/Elite-feature gating (8 sites), `toLocaleString()` everywhere without `timeZone` (15+ sites), SOS forensic PDF timestamps device-local (`emergency-lifecycle-report.tsx:377-378`).
- **J-HIGH** (10): No explicit `proration_behavior` in stripe-checkout/portal, `upcoming_renewal_amount` is `integer` not `bigint` (overflow at $21M), `seat_quantity` clamped to 1000 silently (Enterprise unlimited becomes 1000), `Intl.NumberFormat` never called anywhere, trial-start `+ 14 * 86400000` ms math, daily Stripe idempotency-key uses UTC date slice (timezone bug at midnight), webhook timestamp tolerance asymmetric vs NTP, webhook ordering guard same-second equality bug, wall-clock date math 12+ sites, trial-end client/server divergence.
- **J-MED** (10): `payment_method_types=[card]` (no mada/STC Pay), no ZATCA e-invoicing pipeline, no promo-code tracking, hardcoded English month in mock invoice, `formatTime` ago-strings device-clock, `.sort()` on Arabic without locale, Hijri calendar absent, SLA elapsed = wall-clock (no business-hours), live-billing date pinned `"en-US"`, gather-token clock-skew window.
- **J-LOW** (7): Process-bulk-invite TTL caching, trial-end cron UTC, mock invoice English month names, sweep_expired only sweeps NULL subscription_id, `processed_stripe_events` no TTL cleanup, `current_period_end` no plausibility check, `incident-history` day-diff DST-naive.

### K — Auth & Session (44 findings)
- **K-CRIT** (9): SOS refresh-failure silently drops alert, `check_rate_limit` RPC revoked from authenticated but client still calls it, SMS-OTP send path zero rate-limit, OTP verify attempt counter client-side only, `signOut()` local-only (other devices stay logged in), service-role client uses `!` non-null assertion at module load, `twilio-config-fix` wildcard CORS + bearer-secret-only, weak password policy (8 chars, no blocklist), JWT decoded client-side without re-validation for UI gating.
- **K-HIGH** (11): Active-SOS fingerprint-skip flag bypassable, refresh-token rotation race coalescer broken, no concurrent-session control (no device list), login error leaks account-enumeration info, email-verification gate exists for dashboard but NOT for mobile, biometric verify purely local, `accept_invitation` auto-called every dashboard mount (silent role grant), deep-link auth callback bypasses PKCE via hash, dashboard-actions admin gate in code not RLS, employees.role updatable via mass-assignment, mobile-auth.ts hardcoded demo identities can leak to prod.
- **K-MED** (14): Google idToken no nonce, idle-timeout suspended during active emergency forever, session fingerprint local-only (no server record), refresh coalescer `setTimeout(0)` doesn't truly coalesce, session-timeout setting is Zustand-only, welcome-activation silently keeps already-active sessions, phone-OTP not pinned to verified contact source, edge functions don't check `aud='authenticated'`, stripe webhook clock-skew asymmetric, role updates bypass audit-log row, `_auth_diag` localStorage history leaks across users, mobile-app.tsx bypasses `completeLogout`, OTP TTL not asserted in config, bindSessionToDevice write race on concurrent tabs.
- **K-LOW** (10): signInWithPhone returns error.message verbatim, OTP autocomplete only on first field, forgot-password redirectTo no origin allowlist, dev-only demo access still in bundle, `Math.random()` non-crypto IDs (20+ sites, none auth-critical), failed-login audit never recorded client-side, complete-logout keeps PIN salt across logout, 4+ auth listener subscriptions can leak on hot reload, verifyOTP doesn't bind phone-of-record, subscription-realtime channel keeps subscription across tenant switch.

### L — Mobile / Capacitor (44 findings)
- **L-CRIT** (7): `capacitor-call-number@1.0.3` on Capacitor 6, no `network_security_config.xml` / cert pinning, no foreground service declared, GPS uses `navigator.geolocation` not `@capacitor/geolocation`, no battery whitelist / Doze handling, hardcoded keystore password = phone number, `evidence` bucket public with no MIME/size validation.
- **L-HIGH** (12): `@aparajita/capacitor-biometric-auth@8` version-drift, `addJavascriptInterface` exposes `SOSphereNative.directCall` to any JS, `<access origin="*" />`, silent permission-denial UX (no settings deep-link), forensic photo no offline queue, splash 0ms produces black flash, no `allowNavigation`, geo auto-grant to any origin, no `FLAG_SECURE` (PHI / OTP / location screenshot-able), medical-ID + MFA to clipboard, R8/ProGuard `minifyEnabled=false`, no `setWebContentsDebuggingEnabled(false)`.
- **L-MED** (12): `registerReceiver` without exported flag (Android 14+ crash), `FLAG_KEEP_SCREEN_ON` always on, no HEIC convert path, static `MainActivity` reference leaks, hardcoded vercel deep-link host, 507 LTR-only Tailwind classes vs 3 RTL-safe, no `documentElement.dir` toggle at boot, no Arabic-shaping CSS, CapacitorApp dynamic-import race, network plugin fallback hides failure, FLAG_SECURE doc-only, aapt exclusions hygiene.
- **L-LOW** (13): splash flash, Android 15 prep, minSdk 24 excludes Iraq Android 6, no FCM notification icon meta, no high-priority SOS notification channel, dead `isEmergencyActive`, hardcoded host in 5 intent-filters, biometric static import bundle bloat, no root detection telemetry, premium-rate dial allowlist missing, no SMS fallback when network down, plugin pin can break gradle, RECEIVER export consistency.

### M — Compliance / Legal (34 findings)
- **M-CRIT** (8): ROPA missing, DPIA missing, executed SCCs missing, KSA cross-border / TIA missing (data hosted ap-south-1), SOC 2 control matrix missing, ISO SoA missing, breach-notification process missing, KSA data residency (Supabase Mumbai).
- **M-HIGH** (15): Privacy Policy not bilingual + missing SDAIA contact / DPO, ToS no jurisdiction, no granular cookie banner (Sentry loads unconditionally), 18+ parental-consent threshold wrong for KSA, vendor register lacks countersigned DPAs, public sub-processor list missing, cookie/storage inventory missing, data classification policy missing, access review process missing, no pentest report, no cyber liability insurance evidence, no BCP/DR plan, no ZATCA Phase 2 e-invoicing, KSA consumer protection (refund/complaint) missing, no Play Store / App Store privacy listing artifacts.
- **M-MED** (8): rectification fields incomplete, retention coverage misses 11 PII tables, AUP missing, background check policy missing, change-mgmt formal process missing, logging policy formal doc missing, encryption policy formal doc missing, vuln-mgmt patch-SLA missing.
- **M-LOW** (3): DPA template marked "counsel must review", DSAR audit_log carve-out disclosure missing, portability CSV alternative missing.

### N — Operations (36 findings)
- **N-CRIT** (13): No P0/P1/P2 severity matrix, no incident commander role, no on-call rotation / pager (only GitHub email), no public status page, no SLO/SLI doc, **backups/backup-before-l1-2026-05-08.sql is 0 bytes**, no DR plan (no RTO/RPO), no tabletop exercise log, audit_log NOT append-only (service_role retains UPDATE/DELETE), no security.txt / responsible disclosure, no deploy rollback, no feature-flag system, no Android staged rollout.
- **N-HIGH** (14): Alert rules not codified, no SLO burn-rate alerts, no external-system log retention policy, no IaC (Terraform/Pulumi), secret rotation has no schedule/log, no vendor SLA register, no capacity planning, Twilio cost runaway monitoring documented only in code, no customer support workflow / 3am SOS-failure escalation, no B2B KYC, no offboarding procedure, no privileged access management register, no CODEOWNERS / required PR review, no postmortem template.
- **N-MED** (5): No privacy-by-design checklist, no anniversary access review log, audit_log `actor_id` is `text` (forensic ambiguity), doc staleness pattern, no canonical escalation contact tree.
- **N-LOW** (4): Edge-function log retention by Supabase tier undocumented, solo-deploy push helpers indicate bus-factor=1, probe failures email-only, no pinned cost/billing ops doc.

### O — A11y / i18n (31 findings)
- **O-CRIT** (5): SOS hold button has NO `aria-label`/`role`/`onKeyDown` (`individual-home.tsx:346-403` — life-critical), discreet-sos-screen entirely unannotated, `<html lang="ar" dir="rtl">` hard-coded with no dynamic switch, SOS confirmation dialog hardcoded English ("End Emergency?"), form validation errors not announced and not associated.
- **O-HIGH** (15): 135 `<label>` across 30 files with only 1 file using `htmlFor=`, 138 `outline-none` w/o focus-ring across 52 files, icon-only buttons w/o aria-label (admin call-end button affected), 256 sub-4.5:1 contrast text occurrences, 507 LTR-only Tailwind classes vs 3 RTL-safe, language switch not persisted/propagated/written to `documentElement`, 271 `isAr ?` ternaries (other 10 langs unreachable from mobile), 12 `.toLocaleString("en-US")` sites force English in Saudi UI, naive English pluralization (Arabic has 6 forms), no `libphonenumber-js` (saudi/egypt/uae formatting breaks), multiple `<h1>` per component (heading-level skips), 2 informative `<img alt="">` on evidence photos, 299+ Framer Motion usages but only 2 `useReducedMotion`, 4709 inline `fontSize: <number>,` (OS font scaling ignored), no Skip-to-Main link.
- **O-MED** (7): `<div onClick>` w/o keyboard, only 4 `aria-live` regions (toast-library default polite, never assertive for SOS), `role="link"` on `<span aria-disabled="true">` contradictory, no tashkeel-aware search/sort, no bidi-control chars when mixing Arabic+English, `size-6` (24×24px) on close buttons, currency hardcoded USD.
- **O-LOW** (4): `hour12` mixed across components, `<html lang>` mismatch with `og:locale`, no `@media (forced-colors)` handling, two `<h1>` in `sos-emergency.tsx`.

### P — Performance / Scale (43 findings)
- **P-CRIT** (9): 7s hard `setTimeout` on primary-contact elite bridge in SOS hot path (`sos-alert/index.ts:1734-1745`), no custom pgbouncer pool sizing (default ~60 conns), cold-start cascade on SOS hot path (sos-alert→sos-bridge-twiml→twilio-status→send-push), no Twilio Messaging Service rate-shaper (10k SMS POSTs/sec at 1k concurrent SOS), FCM v1 sequential per-token loop (5000-employee fan-out = 12 min), zero virtualization across entire codebase (grep returned 0 react-window/react-virtual), `fetchEmployees` unbounded `select('*')` (silently truncated at supabase max_rows=1000), no map clustering (1100 DOM markers tanks pan/zoom), no SOS gateway throttle (rate-limit always allows SOS), client-side watchdog only — no server-side cron-watchdog despite UI claim.
- **P-HIGH** (15): Sequential ledger N+1 writes, 8 sequential DB hops before first Twilio packet, per-request createClient in every edge function, sequential owner-fanout push, no 1msg/sec throttle within Promise.all fanout, ~50 row writes per single SOS, no `(company_id,status,created_at)` composite index on sos_sessions, dashboard 4-6 sequential round-trips on initial paint, 22+ unbounded `.select('*')` queries across `src/`, Realtime channels per-user 5-7 (Pro ceiling ~50-100 concurrent admins), fetchEmployees ships 600+ bytes/row × 1k rows, heavy bundle (MUI + Radix + Tailwind + 22 carousel/DnD/PDF libs), mobile-app/sos-emergency/dashboard-pages NOT lazy-loaded, no PostGIS / geospatial index, no external k6/artillery load test ever run.
- **P-MED** (14): Heartbeat broadcast creates ephemeral channel/30s, VAPID key import on cold-start critical path, no PostGIS for "nearest responder", `fetchEmployeeById` re-fetches all employees, evidence upload paths beyond forensic-capture don't compress, duplicate router packages, MUI+Radix+Tailwind three UI systems, mobile-app eagerly imported, Sentry tracesSampleRate=0.05 with BrowserTracing off, GPS @ 15s highAccuracy + watchPosition simultaneously, Stripe webhook TOCTOU on ordering guard, `_cachedJwts` Map unbounded, ECDH/HKDF/AES on push hot path, server-watchdog claim not backed by cron job.
- **P-LOW** (5): Fanout parallelised correctly, no custom fonts (no FOIT), service worker present, Vercel CDN confirmed, no pbkdf2/bcrypt/scrypt on SOS path, no OpenTelemetry.

### Q — Pentest Static (38 findings)
- **Q-CRIT** (5): twilio-token mintable with arbitrary identity, twilio-sms arbitrary SMS, push-token IDOR via `(user_id,token)` conflict, no CSP + inline scripts, storage upload path-traversal IDOR.
- **Q-HIGH** (10): IDOR cross-company push severity=critical, mass-assignment on `employees.role`, raw error/DB messages in 500 paths (5+ functions leak `err.message`), 3600s signed-URL TTL too long, `redirect_to` open-redirect in invite-employees, `dangerouslySetInnerHTML` on MFA QR SVG, `dangerouslySetInnerHTML` in chart UI, token-in-URL on live-tracking page, per-instance rate-limiter bypassable via cold-start cycling, `delete_user_completely` takes user_id as parameter (defence-in-depth).
- **Q-MED** (9): ReDoS regex `/\bo+k+\b/i` per inbound SMS, audit-log `actorEmail` interpolated into broadcast `from_name`, sos-alert `payload.userId` weak type validation, PROBE_SECRET debug echo info leak, no XML parser (CSP missing instead), session-fixation via PKCE/hash-token chain, fail-soft rate-limit on SOS (intentional but exploitable), OTP/resend rate-limit relies on Supabase + bypassable Map, inline scripts amplify CSP gap.
- **Q-LOW** (14): No header injection vectors found, no backup files in public, Stripe webhook order tolerance edge-case, stripe-checkout 401 leaks JWT-verify reason, process-bulk-invite logs `expected_len`, sos-alert 500 leaks err.message, path validation on sos-audio-upload, OAuth state-fixation amplifier, qrCodeSvg trust boundary, dashboard-actions broadcast no per-day cap, incident-history GET allowed, welcome-activation no state nonce, evidence-store stores public-url unencrypted, info-only INFO items.

---

## Cross-Wave Synthesis — Highest-Leverage Patterns

These themes recur across multiple dimensions and represent the **root causes** of dozens of individual defects:

1. **The "client clock is trusted for security decisions" theme**
   Files: `trial-service.ts:98,144`, `subscription-service.ts:179`, `dashboard-auth-guard.ts:74`, `use-session-timeout.tsx:26`, `mobile-company.ts:131`, `plan-gate.tsx:473`, 8+ more.
   Affects: J (trial/feature-entitlement), K (session timeout), N (forensic timestamps), O (UX inconsistency).
   Root fix: introduce a single `serverTime()` utility backed by `gather-token`-style server clock + dpop-nonce; gate all entitlement on it.

2. **The "no rate-shaping anywhere" theme**
   Files: `rate-limiter.ts:72` (in-memory Map), `_shared/db-retry.ts:117` (no jitter), `sos-alert/index.ts:1648` (parallel Twilio with no shaper), `send-push-notification/index.ts:504` (sequential FCM no batch).
   Affects: I, K, P, Q. Combined effect: a single bad actor or mass incident burns Twilio budget AND crashes the DB pool AND fails Twilio MPS limits — all at once.
   Root fix: gateway-level Cloudflare/Vercel WAF rate-shaper + server-side `Redis ZADD`-style rate-limit (replacing in-memory Map) + Twilio Messaging Service + FCM `/batch` endpoint.

3. **The "no virtualization / no pagination" theme**
   Files: every `data-layer.ts` `.from(...).select('*')`, 22+ sites.
   Affects: P (scale ceiling ~2k employees), H (re-render storms).
   Root fix: every list query needs `.range()`; every list UI needs `react-window` or `react-virtual`.

4. **The "RLS uses `auth.uid()` bare, not `(SELECT auth.uid())`" theme**
   Files: 6+ migrations.
   Affects: I (per-row STABLE evaluation), P (10k-row queries 10000× slow).
   Root fix: single migration that rewrites every RLS USING/WITH CHECK clause to wrap `auth.uid()` in a `(SELECT ...)`.

5. **The "service_role used everywhere with `!` non-null assertion" theme**
   Files: every edge function module-load.
   Affects: I (per-request connect overhead), K (no aud check), Q (admin gate in code not DB).
   Root fix: shared `getServiceClient()` factory with isolate-scoped reuse + explicit `aud='authenticated'` enforcement.

6. **The "compliance artifact does-not-exist-yet" theme**
   Affects: M (ROPA/DPIA/SCCs/SDAIA filing), N (runbook/SLO/on-call/status).
   Root fix: a single dedicated 2-week compliance-writing sprint with a counsel review milestone. Cannot ship to SA/AE without these.

7. **The "Arabic/RTL incomplete despite being the primary market" theme**
   Affects: O, L. 507 LTR-only Tailwind classes; 271 ad-hoc `isAr?` ternaries that lock out 10 declared languages on mobile; `<html dir>` hardcoded.
   Root fix: codemod every `ml-*`/`mr-*`/`pl-*`/`pr-*` to `ms-*`/`me-*`/`ps-*`/`pe-*`; remove `isAr?` pattern in favor of `t()`/`useT()`; toggle `documentElement.lang/dir` at boot.

---

## Phase Plan (R-142 → R-591, sequenced)

The merged ticket plan is being appended to `POST_LAUNCH_AUDIT.md` Section 10.

**Phase 0 — STOP-SHIP (must complete before any traffic):** all 25 W2-* items above (R-142 → R-166) + remaining Wave-1 CRITs (R-109 → R-116, R-119, R-128).

**Phase 1 — Pre-launch security & life-safety (target: 3 weeks):**
- All remaining CRIT items (Wave 1 + Wave 2): 78 + 14 = 92 items.
- All Q-HIGH (pentest): 10 items.
- All K-HIGH (auth): 11 items.

**Phase 2 — Compliance & enterprise-readiness (target: 4 weeks; partial parallel with Phase 1):**
- M-CRIT (ROPA, DPIA, SCCs, SDAIA): 8 docs.
- N-CRIT (status page, on-call, SLO, runbook, rollback, IaC): 13 items.
- Counsel review of DPA / Privacy Policy / ToS.
- ZATCA Phase 2 e-invoicing pipeline.

**Phase 3 — Performance & scale (target: 3 weeks):**
- All P-CRIT + P-HIGH: 24 items.
- I-CRIT + I-HIGH: 24 items.
- Real k6 load test against staging at 1k concurrent SOS.

**Phase 4 — UX, A11y, i18n (target: 2 weeks):**
- O-CRIT + O-HIGH: 20 items.
- Mobile L-HIGH: 12 items.
- RTL Tailwind codemod.

**Phase 5 — Frontend quality + tech-debt (target: 2 weeks):**
- H-CRIT + H-HIGH: 15 items.
- Remaining MED/LOW backlog: ~223 items (triage; many become tech-debt, not blockers).

Total Phase 0-4 critical-path: **~14 weeks** assuming single-engineer (current bus-factor) and **~6 weeks** with 3 engineers.

---

## Files & Notes

- This document, combined with the existing `ROOT_AUDIT_RESULTS.md` (Wave 1, A-F) and the soon-to-be-updated `POST_LAUNCH_AUDIT.md`, is the authoritative source of truth for known defects as of 2026-05-21.
- No fix work has been started on Wave 2 yet, per the user's standing directive: "انت ترقع وانا ارفض الترقيع" — find everything first, fix once.
- Three audit dimensions remain UN-audited (would push grand total higher):
  - **AI / model behavior** (`ai-co-admin.tsx`, intelligent-guide.tsx) — not in original A-Q scope.
  - **Realtime broadcast correctness** under network partition — needs runtime testing.
  - **Voice / SIP** path (Twilio Voice SDK) — partially covered in K and Q but the bridge state-machine has not been formally modeled.
