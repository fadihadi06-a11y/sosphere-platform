# PHASE 0 STEP PLAN — Chained Execution Map

> **يُقرَأ مع `PHASE_0_DOCTRINE.md`.** كلّ خطوة هنا تتبع القالب في §4 من الدستور.
> **الترتيب مهم.** لا تبدأ خطوة قبل إغلاق كلّ `DEPENDS-ON` لها.
> **خطوة بدون GUARD = خطوة غير مكتملة.** الحارس قبل الإصلاح، الإصلاح قبل الـ commit.

**Total tickets in this file:** P0-Z0 + P0-Z1..Z20 = 21 foundation steps (Layer -1)
**After P0-Z20:** P0-A series begins (Layer 0 — Database/RLS/Edge), per MASTER_AUDIT §3.
**Estimated calendar time for P0-Z series:** 10-14 days with 2 engineers + 1 user (for keystore/secrets ops).

---

## CHAIN VIEW (read top-to-bottom)

```
P0-Z0  ─── install Lighthouse L1-L6 guards (does not fix any bug; protects all next fixes)
   │
   ├─→ P0-Z1  rotate Android keystore + scrub history
   │     └─→ P0-Z3  ship release-signed APK in CI (needs new key)
   │            └─→ P0-Z8  enable minifyEnabled true
   │            └─→ P0-Z9  migrate App Links off vercel.app (needs new cert fingerprint)
   │
   ├─→ P0-Z2  rotate Supabase + Vercel secrets
   │     └─→ P0-Z10 verify_jwt=true on edge functions (needs valid signing key)
   │            └─→ P0-Z11 block --skip-verify deploy (needs CI confidence)
   │
   ├─→ P0-Z4  CSP / HSTS / security headers
   │     └─→ P0-Z13 service-worker push-handler origin allow-list (needs CSP baseline)
   │
   ├─→ P0-Z5  strengthen npm-audit gate (parallel)
   │     └─→ P0-Z12 replace postinstall mutation with patch-package
   │
   ├─→ P0-Z6  WebView posture lockdown (parallel, before any frontend fix)
   │     └─→ P0-Z7  foregroundServiceType for SOS background services
   │
   ├─→ P0-Z14 storage bucket private + signed URLs
   ├─→ P0-Z15 fix root SQL USING(true) + nullable tenant
   ├─→ P0-Z16 remove DELETE FROM audit_log from test SQL
   ├─→ P0-Z17 rewrite source-pin tests starting with SAR
   ├─→ P0-Z18 install CI guards for foundational anti-patterns  (built into Z0; ratified here)
   ├─→ P0-Z19 Gradle reproducible build (wrapper SHA + verification-metadata)
   └─→ P0-Z20 scrub production project-ref from repo

[P0-Z0..Z20 closed]
       ↓
   [Layer 0 begins — P0-A series — DB/RLS surgery]
```

---

## P0-Z0 — Install the Lighthouse Network (foundation of everything)

**Severity:** P0 — blocks all other Phase 0 work
**Layer:** -1
**Defect refs:** N/A (this step prevents new defects)

**DEPENDS-ON:** none (this is the foundation)
**CHANGES:**
- `lefthook.yml` (new) — pre-commit + pre-push hook config
- `.gitleaks.toml` (new) — secret-scanning config + allowlist
- `scripts/lint-guard.mjs` (replace) — implement the forbidden-pattern list from Doctrine §3
- `.github/workflows/guards.yml` (new) — L3 CI workflow with all 14 gates
- `supabase/tests/rls/_scaffold.sql` (new) — pgTAP harness stub + first 5 RLS smoke tests
- `scripts/synthetic-sos-probe.mjs` (new) — runnable locally and scheduled in CI for now (L6 production probe wired in P0-Z10)
- `package.json` — add devDeps: `lefthook`, `gitleaks-action` ref, `@supabase/pgtap`
- `.github/workflows/codeql.yml` — expand to include `android/**` (closes R-1892)
- `PHASE_0_GUARDS_BASELINE.md` (new) — snapshot of every existing violation the guards detect (this is OUR starting punch list)

**ENABLES:** P0-Z1, P0-Z2, P0-Z3, P0-Z4, P0-Z5, P0-Z6, P0-Z7, P0-Z14, P0-Z15, P0-Z16, P0-Z17, P0-Z19, P0-Z20 (every fix from here on is checked by these guards)

**GUARD:** This step **IS** the guard. Meta-guard:
- Layer: L3
- Rule: A separate workflow `meta-guard.yml` runs `lint-guard --self-test` daily on a deliberately-broken fixture and fails if any forbidden pattern is missed
- Location: `.github/workflows/meta-guard.yml`

**TEST:**
- Type: behavior + integration
- Files:
  - `scripts/__behavior_tests__/lint-guard.spec.mjs` — feeds known-bad samples; asserts each pattern triggers
  - `supabase/tests/rls/scaffold.test.sql` — pgTAP confirms a forbidden-RLS migration is rejected
- Asserts: each forbidden pattern catches a real example AND does not false-positive a benign example

**ROLLBACK:**
- Action: `git revert <commit>` + `npm uninstall lefthook && lefthook uninstall`
- Time-to-rollback: < 5 min

**WORLD-CLASS-CRITERION:**
- OWASP ASVS V14.2 (Dependency), V14.5 (Configuration)
- SLSA Build L2 (build provenance for guards.yml)
- NIST SP 800-218 SSDF Practice PO.5 (implement secure software development practices)
- Google SRE Workbook ch. 4 (SLOs) — for synthetic-probe SLO baseline
- gitleaks (industry-standard secret scanner)
- lefthook (industry-standard polyglot hook manager)

**TELEMETRY:**
- Log event: `guard_violation` with fields `{layer, rule, file, line, commit_sha}`
- Metric: `guard_violations_total{layer, rule}` (counter)
- Alert: not yet (no prod hookup); CI failure is the alert during Z0

**EXECUTION:**
- [ ] Write `lefthook.yml` + `.gitleaks.toml` + `scripts/lint-guard.mjs` (full implementation)
- [ ] Write `.github/workflows/guards.yml` with all 14 gates per Doctrine L3
- [ ] Write `scripts/__behavior_tests__/lint-guard.spec.mjs` self-test
- [ ] Write `supabase/tests/rls/_scaffold.sql` + 5 smoke tests
- [ ] Write `scripts/synthetic-sos-probe.mjs` (local mode + CI mode)
- [ ] Add `PHASE_0_GUARDS_BASELINE.md` listing every existing violation the guards now detect (expect hundreds — that's the point)
- [ ] Run guards locally; capture baseline; commit baseline as the starting point
- [ ] Open PR → CI runs guards → guards detect baseline violations → PR is **expected to be RED** (this confirms the lighthouse is on)
- [ ] Merge PR with `--allow-pre-existing-violations` flag on guard runner (one-time bootstrap, removed after first cleanup wave)
- [ ] Verify rollback path: revert PR locally, confirm hooks uninstall cleanly

---

## P0-Z1 — Rotate Android Release Keystore + Scrub Git History

**Severity:** P0 — supply-chain compromise (R-1792 / R-2095 / R-1892 / R-1913)
**Layer:** -1

**DEPENDS-ON:** [P0-Z0]
**CHANGES:**
- User (offline, NOT in repo): generate new keystore via `keytool -genkeypair ...`
- User: register Play App Signing in Play Console (Google holds upload signing key)
- User: install BFG or git-filter-repo; scrub `android/app/keystore.properties` AND `*.jks` AND the literal password `Fz07506771765` from ALL history
- User: force-push scrubbed history to ALL branches; ALL collaborators re-clone
- `android/app/keystore.properties` → DELETED from working tree
- `.gitignore` → add `android/app/keystore.properties`, `*.jks`, `*.keystore`
- `android/app/build.gradle` → read signing config from environment vars only (`SOSPHERE_STORE_PWD`, `SOSPHERE_KEY_PWD`, `SOSPHERE_KEY_ALIAS`); fail build if any is missing
- `.github/workflows/build-apk.yml` → inject signing env from GitHub Secrets only
- `public/.well-known/assetlinks.json` → update `sha256_cert_fingerprints` to the NEW Play App Signing fingerprint

**ENABLES:** P0-Z3 (release-signed CI APK), P0-Z8 (minify with confidence), P0-Z9 (App Links migration)

**GUARD:**
- Layer: L1 + L3
- Rule (L1 lefthook): block any commit that creates/modifies `android/app/keystore.properties`, `*.jks`, `*.keystore`
- Rule (L3 CI): `gitleaks` rule matches literal pattern `storePassword\s*=\s*[^$]` (must be `$ENV_VAR` reference)
- Rule (L3 CI): build job fails if `keystore.properties` file is present in tree
- Location: `lefthook.yml` `pre-commit.deny-keystore-changes`; `.gitleaks.toml` rule `keystore-plaintext`

**TEST:**
- Type: behavior
- File: `scripts/__behavior_tests__/keystore-guard.spec.mjs`
- Asserts:
  - Sample commit adding `keystore.properties` → lefthook exits non-zero
  - CI build with missing env vars → gradle fails fast with clear message
  - CI build with env vars → APK signed; `apksigner verify --print-certs` returns the new fingerprint
  - `assetlinks.json` fingerprint matches the new Play App Signing fingerprint (verified via deep-link smoke test on staging device)

**ROLLBACK:**
- Action: keystore is irreplaceable once rotated; rollback means **using the new key indefinitely**. The OLD keystore is preserved in offline backup but must not be reused.
- Time-to-rollback: N/A (forward-only); contingency = Play App Signing key reset (Google process, ~7 days)

**WORLD-CLASS-CRITERION:**
- OWASP MASVS-CRYPTO-1 (key management)
- Google Play App Signing (canonical Android distribution)
- NIST SP 800-57 Part 1 Rev. 5 (Key Management lifecycle)
- CWE-798 (Use of Hard-coded Credentials)

**TELEMETRY:**
- Log event: `release_build_signed` with fields `{commit_sha, fingerprint, signer, build_id}`
- Metric: `release_builds_total{result}` (counter)
- Alert: fingerprint mismatch in `assetlinks.json` vs Play Console → PagerDuty critical

**EXECUTION (user-led + agent-assisted):**
- [ ] **User:** generate new keystore offline; store in 1Password/Vault (NOT repo)
- [ ] **User:** upload to Play App Signing; record new SHA-256 fingerprint
- [ ] **User:** add `SOSPHERE_STORE_PWD`, `SOSPHERE_KEY_PWD`, `SOSPHERE_KEY_ALIAS` to GitHub Secrets
- [ ] **Agent:** update `android/app/build.gradle` to read from env (commit)
- [ ] **Agent:** update `.gitignore` + delete `android/app/keystore.properties` from working tree
- [ ] **Agent:** update `assetlinks.json` with new fingerprint
- [ ] **User:** run BFG to scrub history; force-push to all branches; notify collaborators
- [ ] **Agent + User:** verify L1+L3 guards block any attempt to re-introduce the file
- [ ] **Agent:** run signed-build job in CI; verify APK signature; deep-link smoke test

---

## P0-Z2 — Rotate Supabase + Vercel Secrets

**Severity:** P0 (R-1806, R-1808)
**Layer:** -1

**DEPENDS-ON:** [P0-Z0]
**CHANGES:**
- User: rotate Supabase JWT signing secret in Supabase Studio (invalidates all sessions; deliberate)
- User: revoke Vercel OIDC session; issue a fresh CI-only token
- User: rotate Stripe webhook signing secret + restricted API key (CI deploy hook)
- User: rotate Twilio API key + auth token + messaging service SID
- User: rotate FCM service-account JSON
- `.env`, `.env.local` → DELETED from working tree
- `.env.example` → keep, with placeholder values only
- `.gitignore` → already covers `.env*` but ADD explicit `*.env`, `.env.*` patterns
- All secret references in code switched to runtime env reads (`process.env.X` / `Deno.env.get("X")`); fail-fast if missing
- BFG scrub of any past `.env` commits (if found in history)

**ENABLES:** P0-Z10 (verify_jwt requires valid signing key), P0-Z11 (CI confidence)

**GUARD:**
- Layer: L1 + L2 + L3
- Rule (L1): lefthook blocks commit touching `.env`, `.env.local`, `*.env`
- Rule (L2): gitleaks deep-scan on push
- Rule (L3): `scripts/lint-guard.mjs` catches literal JWT tokens (`eyJ` prefix > 100 chars) anywhere in repo
- Rule (L3): `scripts/lint-guard.mjs` catches `sk_live_*`, `AC<hex32>`, `xoxb-*`, `ghp_*`, etc.

**TEST:**
- File: `scripts/__behavior_tests__/secret-guard.spec.mjs`
- Asserts: each pattern triggers on bad sample, doesn't trigger on `.env.example` placeholders

**ROLLBACK:**
- Action: rotation is forward-only; rollback = re-rotate to a third secret
- Time-to-rollback: 10 min per service (documented runbook in `docs/runbooks/secret-rotation.md`)

**WORLD-CLASS-CRITERION:**
- OWASP ASVS V2.10 (Service Authentication)
- NIST SP 800-57 Part 1 Rev. 5 (key rotation cadence)
- CWE-798 + CWE-321 (Hard-coded Cryptographic Key)
- 12-Factor App: III. Config

**TELEMETRY:**
- Log event: `secret_rotation` with fields `{service, rotated_at, rotated_by, expires_at}`
- Metric: `secret_age_days{service}` (gauge); alert when age > 90
- Alert: any secret with age > 90 days → ticket auto-filed

**EXECUTION (user-led):**
- [ ] **User:** rotate each secret in its console (Supabase / Vercel / Stripe / Twilio / FCM)
- [ ] **User:** update GitHub Secrets + Vercel env + Supabase Edge Function env
- [ ] **Agent:** delete `.env`, `.env.local` from working tree; commit
- [ ] **Agent:** run guards; confirm secret-detect catches any reintroduction
- [ ] **User:** run BFG if any secret was ever committed to history
- [ ] **Agent:** verify all services still function after rotation (smoke tests against staging)

---

## P0-Z3 — Stop Publishing Debug APK to Public GitHub Releases

**Severity:** P0 (R-1821)
**Layer:** -1

**DEPENDS-ON:** [P0-Z1] (need rotated keystore + GitHub Secrets)
**CHANGES:**
- `.github/workflows/build-apk.yml`:
  - Replace debug-signing block with release-signing using env vars from secrets
  - Change `make_latest: true` → `draft: true`
  - Add manual approval step (`environment: release-approval`)
  - Add `prerelease: true` for internal builds
- New workflow `release-promotion.yml`: separate job to promote a draft release to `latest` after manual approval + integrity checks

**ENABLES:** Phase 0 closure for end-users (no more public debug APKs); supports P0-Z8 (release-signed minified build)

**GUARD:**
- Layer: L3
- Rule: workflow `guards.yml` parses `build-apk.yml` and rejects any occurrence of `make_latest: true` OR `androiddebugkey` outside the explicit local-dev-only block
- Location: `scripts/lint-guard.mjs` rule `workflow-release-safety`

**TEST:**
- File: `scripts/__behavior_tests__/release-workflow-guard.spec.mjs`
- Asserts: malformed workflow triggers guard; correct workflow passes

**ROLLBACK:**
- Action: `git revert` workflow change; releases continue with previous (debug) flow
- Time-to-rollback: < 5 min

**WORLD-CLASS-CRITERION:**
- SLSA Build Level 3 (hermetic, isolated, parameterless)
- Google Play "Closed testing tracks" model
- GitHub Actions `environment` protection rules
- OWASP MASVS-CODE-1 (signed builds)

**TELEMETRY:**
- Log event: `apk_released` with `{tag, sha256, signer_fingerprint, track}`
- Metric: `releases_total{track,promotion_path}`
- Alert: release published without going through draft → critical

**EXECUTION:**
- [ ] **Agent:** rewrite `build-apk.yml` per spec
- [ ] **Agent:** create `release-promotion.yml`
- [ ] **User:** configure `release-approval` environment in repo settings (require reviewer)
- [ ] **Agent:** add guard rule + test
- [ ] **User + Agent:** end-to-end test: tag commit → draft created → manual approval → promoted

---

## P0-Z4 — CSP / HSTS / Security Headers

**Severity:** P0 (R-1845, R-1901)
**Layer:** -1

**DEPENDS-ON:** [P0-Z0]
**CHANGES:**
- `vercel.json` — remove `'unsafe-inline'`; switch to strict CSP with per-build nonces
- `public/_headers` — add HSTS, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy denying mic/camera/geolocation by default (re-granted per-feature with explicit user gesture)
- `vite.config.ts` — generate nonce at build time and inject into `index.html`
- `index.html` — all inline scripts use nonce; remove any remaining inline event handlers

**ENABLES:** P0-Z13 (SW push-handler — needs CSP baseline to validate origin allow-list)

**GUARD:**
- Layer: L3
- Rule: `scripts/lint-guard.mjs` rejects `'unsafe-inline'` and `'unsafe-eval'` in any vercel.json or _headers file
- Rule: post-build check that `index.html` has no inline `<script>` without nonce attribute
- Additional: weekly external scan via securityheaders.com API → fails if grade < A

**TEST:**
- File: `scripts/__behavior_tests__/csp-guard.spec.mjs`
- Asserts: built `dist/index.html` has nonce on every inline script; CSP header matches policy

**ROLLBACK:**
- Action: revert `vercel.json` + `_headers`
- Time-to-rollback: < 5 min (Vercel re-deploy)

**WORLD-CLASS-CRITERION:**
- OWASP ASVS V14.4 (HTTP Security Headers)
- MDN Web Security Headers reference
- CSP Level 3 (W3C)
- HSTS preload list (Chromium + Mozilla)

**TELEMETRY:**
- Log event: `csp_violation` collected via `report-to` directive
- Metric: `csp_violations_total{directive, blocked_uri}`
- Alert: spike in violations → may indicate XSS attempt OR a missed nonce

**EXECUTION:**
- [ ] **Agent:** write new `vercel.json` + `_headers` + vite nonce plugin
- [ ] **Agent:** sweep `index.html` and src for inline handlers; refactor
- [ ] **Agent:** add CSP `report-to` endpoint (edge function)
- [ ] **User + Agent:** verify in staging via browser devtools + securityheaders.com
- [ ] **Agent:** add guard + test

---

## P0-Z5 through P0-Z20 — Summary Form (full template per ticket lives in expansion file)

The remaining 16 tickets follow the same template. Below is the **chain summary**; each will be expanded to full template form before execution (one-per-PR discipline).

| ID | Title | DEPENDS-ON | ENABLES | Guard layer | World-class ref |
|---|---|---|---|---|---|
| **P0-Z5** | Strengthen npm-audit gate (high + dev-deps) | Z0 | Z12 | L3 | OWASP A06:2021 |
| **P0-Z6** | WebView posture lockdown (drop `*`, add netsec config) | Z0 | Z7 | L3 + L5 | OWASP MASVS-NETWORK-1 |
| **P0-Z7** | `foregroundServiceType` for SOS background services | Z6 | (unblocks Android 14+ SOS reliability) | L3 + L4 (manifest lint) | Android 14 behavior changes |
| **P0-Z8** | `minifyEnabled true` (after removing `-keep interface * { *; }`) | Z1 | (downstream native fixes) | L3 | OWASP MASVS-CODE-2 |
| **P0-Z9** | Move App Links off vercel.app | Z1 | (route security) | L3 + L5 | Android App Links spec |
| **P0-Z10** | `verify_jwt = true` on sos-alert + 13 functions | Z2 | Z11 + all Layer 0 work | L3 + L5 | Supabase Edge Auth |
| **P0-Z11** | Block `--skip-verify` deploy + unconfirmed prod db push | Z2 + Z10 | (Phase-1 deploy confidence) | L3 | SLSA Build L2 |
| **P0-Z12** | Replace postinstall mutation with patch-package | Z5 | (supply-chain) | L3 | npm/patch-package canonical |
| **P0-Z13** | SW push-handler origin allow-list + Firebase SDK SRI | Z4 | (mobile web safety) | L3 + L5 | OWASP ASVS V14.4 + W3C SRI |
| **P0-Z14** | Storage bucket private + signed URLs + per-tenant path | Z0 | Layer-0 evidence work | L4 | Supabase Storage Best Practices |
| **P0-Z15** | Fix `USING(true)` + nullable tenant in root SQL | Z0 | All Layer-0 RLS work | L4 (pgTAP) | Postgres RLS docs + L5-SEC-4 internal |
| **P0-Z16** | Remove `DELETE FROM audit_log` from test SQL; sentinel-tenant gate | Z0 | (test integrity) | L3 + L4 | OWASP ASVS V14.6 |
| **P0-Z17** | Rewrite source-pin tests starting with SAR-banner | Z0 | (test integrity) | L3 (no-source-pin rule) | Google Testing Blog "Test Behavior, Not Implementation" |
| **P0-Z18** | (Built into Z0; ratified separately to log explicit acceptance of guard rules) | Z0 | All future fixes | L3 | self-referential |
| **P0-Z19** | Reproducible build (wrapper SHA + verification-metadata) | Z1 + Z5 | (supply-chain) | L3 | SLSA Build L3 + Gradle dep-verification |
| **P0-Z20** | Scrub production project-ref from repo | Z2 | (information disclosure closure) | L3 (lint-guard) | OWASP ASVS V14.3 |

---

## Exit gate from P0-Z series

Before opening P0-A (Layer 0 — Database/RLS surgery), all of the following must be true:

- All P0-Z0 → P0-Z20 closed per template
- Lighthouse Network is detecting (and blocking) every forbidden pattern in §3 of the Doctrine
- `PHASE_0_GUARDS_BASELINE.md` reduced from initial baseline to zero (every existing violation either fixed OR explicitly waived with an issue link)
- A green run of `guards.yml` exists on `main`
- Synthetic SOS probe runs locally and in staging (production wiring waits for Layer 0)
- Rollback drill executed for at least P0-Z1, P0-Z2, P0-Z3
- Sign-off comment from user: "P0-Z series accepted — proceed to Layer 0"

Only then does Layer 0 (P0-A series) begin.

---

**END OF STEP PLAN — v1.0**
**Every step below this file's level expands to the full template before execution.**
