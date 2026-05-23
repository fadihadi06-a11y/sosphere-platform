# PHASE 0 DOCTRINE — Lighthouse Charter

> **هذا هو الدستور.** كلّ تغيير في الكود من هذه اللحظة فصاعداً ملتزَم بكلّ بند فيه.
> كلّ خطوة لا تستوفي كلّ المتطلّبات أدناه = **مرفوضة قبل تقديمها للمستخدم**.
> هذا الملفّ ليس توثيقاً اختياريّاً. إنّه عقد.

**Status:** Active — applies from 2026-05-23 onward
**Scope:** All code, infra, CI, scripts, migrations, native, tests, docs
**Owners:** Engineering (enforced); Product (informed)

---

## 1. The Seven Principles

### P1 — Chain Discipline
Every change declares its place in the chain. **No orphan changes.** Each step has:
- **DEPENDS-ON** — the IDs of prior steps that must already be closed
- **CHANGES** — the precise files / lines / configs touched
- **ENABLES** — the IDs of future steps unblocked by this change
- **GUARD** — the L1-L6 layer + exact rule that prevents future regression
- **TEST** — the real behavior test (not source-pinning) that proves it works
- **ROLLBACK** — documented reverse path
- **WORLD-CLASS** — the cited standard (OWASP / NIST / RFC / vendor canonical)
- **TELEMETRY** — what is logged + what triggers an alert

If any field is missing → the change is rejected by the author (me) before reaching review.

### P2 — World-Class Criterion
Every step cites a recognized standard or canonical reference. Allowable references:
- OWASP ASVS v4.0.3 (Application Security Verification)
- OWASP MASVS / MASTG (Mobile Security)
- NIST SP 800-53 / 800-63 / 800-57 / 800-115 / 800-207 (controls / digital identity / keys / pentest / zero trust)
- CWE/CAPEC (weakness / attack pattern IDs)
- RFC (specific, not just "uses HTTPS")
- Google SRE Workbook (SLO, error budget, postmortem)
- Stripe Security / Webhook Best Practices (canonical for our payment surface)
- Supabase RLS Best Practices + Postgres docs (canonical for DB)
- Twilio Voice/SMS Security (canonical for telecom surface)
- Android CDD / Play Integrity / Play App Signing (canonical for native)
- ISO/IEC 27001/27002, ISO 45001 (org-level)
- GDPR Art. 5/7/13/15/17/25/32 + PDPL KSA + CCPA + COPPA (compliance)

If no standard fits → the step is flagged **"homegrown — requires written justification + senior review."**

### P3 — Fail-Closed by Default
Any uncertainty resolves to **refuse the action**:
- Auth uncertain → deny session
- RLS uncertain → return empty
- SOS path uncertain → **escalate to higher tier, never swallow**
- Webhook signature unverifiable → reject + alert
- Rate limit lookup fails → reject (NOT bypass — `bypassOnError` is banned, see L3 rule)
- Circuit breaker DB query fails → trip the breaker (NOT continue — see R-1404/R-1408)

The only acceptable fail-open behavior is **delivery of an in-progress SOS to a degraded fallback channel**, and only when the fallback is itself observable and rate-limited.

### P4 — No Step Without a Guard
Every fix is paired with at least one permanent guard. A fix without a guard is **incomplete by definition**:
- Code fix → CI lint rule that rejects re-introduction
- DB fix → schema constraint OR pgTAP test
- Config fix → drift detector in CI
- Runtime fix → metric + alert
- Process fix → checklist in pre-push hook

If we cannot articulate a guard, we **redesign the fix** until we can.

### P5 — Real Tests, Not Source-Pinning
Source-pinning tests (`readFileSync` + `.toMatch`, `expect(src).toContain("MARKER")`) are **explicitly banned**. Any test must:
- Import the system under test
- Invoke its actual function
- Assert on its observable behavior (return value, DB row, network call, side effect)
- Mock only **external** dependencies, never the SUT itself

A CI lint rule (`scripts/lint-guard.mjs` rule `no-source-pin`) blocks any new test that reads its own source as input. Existing source-pin tests are tracked in a quarantine list with an explicit replacement ticket.

### P6 — Reversibility
Every step has a written rollback. Specifically:
- Migrations have explicit `DOWN` (or compensating migration if `DOWN` is impossible)
- Deployments are gated by a feature flag (kill-switch within 60 seconds)
- Secrets have a documented rotation runbook
- Native APK releases have a staged rollout (1% → 10% → 50% → 100%) with halt-rollback criteria

Steps that are inherently irreversible (e.g., `DROP TABLE`, force-push to main) require **dual confirmation** + a backup snapshot.

### P7 — Observable from Day One
Every critical path emits:
- **Structured log** (JSON, with `trace_id`, `tenant_id`, `actor_id`, `action`, `outcome`)
- **Metric** (counter / histogram with low cardinality)
- **Trace span** (if it crosses a service boundary)
- **Alert** (PagerDuty/Opsgenie equivalent) when the metric breaches the SLO

Silent failures are bugs. If a guard fires and nothing alerts → the guard is incomplete.

---

## 2. The Six Guard Layers (Lighthouse Network)

These are the **always-on** mechanisms. Once installed, they outlive any single engineer or agent.

### L1 — Pre-commit (lefthook + gitleaks)
**Where:** Local developer machine, before `git commit`
**What:**
- `gitleaks protect --staged` — block any commit containing detected secrets
- `eslint --max-warnings 0` on staged TS/JS files
- `lint-guard.mjs --staged` — block forbidden patterns (see §3)
- `prettier --check` on staged files
- Block any commit that touches `android/app/keystore.properties`, `*.jks`, `.env`, `.env.local`

**Failure mode:** commit refused locally; developer sees the exact rule that blocked them.

### L2 — Pre-push (signed commits + deep secret scan)
**Where:** Local before `git push`, mirrored in CI as a check
**What:**
- Verify all commits in the pushed range are GPG-signed (`%G?` = `G`)
- `gitleaks detect --source . --redact --log-opts="-{n}"` over the new commits' full history
- `lint-guard.mjs --staged-range` on the full push range (catches commits committed via `--no-verify`)
- Block `git push --force` against `main`, `release/*` branches

**Failure mode:** push refused locally; CI also re-checks so a `--no-verify` doesn't escape.

### L3 — CI build-time (`.github/workflows/guards.yml`)
**Where:** GitHub Actions, on every PR + every push to `main`
**What (in order, each gate is a hard fail):**
1. `npm ci` (deterministic install; lockfile must be committed)
2. `npm audit --audit-level=high` AND a second pass for dev deps
3. `tsc --noEmit` (strict)
4. `eslint . --max-warnings 0`
5. `node scripts/lint-guard.mjs --full` (all forbidden patterns + AST checks)
6. `node scripts/check-migration-drift.mjs` (migrations match prod schema)
7. `node scripts/check-function-drift.mjs` (deployed edge functions match repo)
8. `gitleaks detect --source . --redact` (whole-tree)
9. `vitest run` (behavior tests only; source-pin tests excluded but counted in quarantine report)
10. **`supabase test db`** (pgTAP on RLS) — runs against ephemeral DB
11. `vite build` + bundle-size budget check (max 250KB initial JS gzip)
12. Android: `./gradlew lintRelease` + `./gradlew bundleRelease --no-daemon -Pminify=true`
13. SBOM generation (CycloneDX) + signature attestation (SLSA L3 target)
14. **No `verify_jwt = false`** scan of `supabase/config.toml` (allowlist mandatory comment-justification per function)

**Failure mode:** PR merge blocked; main branch protected by status checks.

### L4 — DB schema-level (Postgres constraints + pgTAP)
**Where:** Inside Supabase
**What:**
- Every tenant-scoped table has `company_id UUID NOT NULL` with `REFERENCES companies(id)`
- Every table has RLS enabled (`alter table ... enable row level security`); CI catches any new table without it
- `audit_log` has BEFORE UPDATE/DELETE triggers that `raise exception` (append-only)
- `SECURITY DEFINER` functions all have `SET search_path = public, pg_temp` (CI grep)
- pgTAP suite in `supabase/tests/rls/*.sql` runs in L3 against ephemeral DB; covers each table's positive + negative case
- Realtime channel naming convention enforced: `<table>:<company_id>:<...>` (server function rejects channels missing tenant scope)

**Failure mode:** migration refused or pgTAP fails → CI red.

### L5 — Runtime production
**Where:** Inside running edge functions, frontend, native
**What:**
- `_shared/tenant-guard.ts` middleware: any Supabase query without `.eq("company_id", tenantId)` throws (frontend), and edge functions wrap supabase-js with a Proxy that rejects such queries
- `_shared/circuit-breaker.ts`: fails **closed** on lookup error (R-1404/R-1408 fix); circuit state persisted with idempotency
- `_shared/rate-limiter.ts`: lookup-key and write-key derived from the **same** function (R-222/228 fix)
- All edge functions require `verify_jwt = true` OR a manual override with a comment explaining why + a per-function authorization check
- Idempotency-Key header required on all retry-eligible actions (broadcast, dispatch, forward_to_owner)
- All admin actions write to `audit_log` via a SECURITY DEFINER RPC that derives `actor_id` from `auth.uid()` — never from client input
- WebView: `<access origin="https://*.sosphere.co"/>` only; no `*`; cleartext disabled; networkSecurityConfig pins CA
- Native JS bridge: `addJavascriptInterface` exposes only an allow-listed surface, with permission checks per method

**Failure mode:** production logs `guard_violation` + alert fires; user receives a clear error; no silent fallback.

### L6 — Always-on monitoring
**Where:** External (synthetic), internal (metrics), continuous
**What:**
- **Synthetic SOS probe** every 15 min from 3 geographic regions: hits `sos-alert`, asserts ack < 5s, ensures call/SMS dispatched to test number; pages if 2 consecutive failures
- **Error-budget SLOs:**
  - SOS dispatch success ≥ 99.9% (5-min window)
  - Auth flow success ≥ 99.95% (1-h window)
  - Webhook processing p95 < 2s
- **Suspicious-action detector:** alert on `role = super_admin` granted outside Supabase Studio, alert on `audit_log` INSERT volume spike
- **RLS-bypass dashboard:** any query that hits `auth.uid() IS NULL` path on tenant tables is logged + counted
- **Push delivery rate** per tenant (FCM + APNs); alert on >5% drop
- **Stripe webhook idempotency key collision** detector

**Failure mode:** PagerDuty page; runbook URL embedded in the alert payload.

---

## 3. Forbidden Patterns (Lint-Enforced)

`scripts/lint-guard.mjs` rejects any of the following anywhere in the repo (with file-level allowlist requiring written justification):

```
[AUTH]
- localStorage.setItem(['"]sosphere_dashboard_auth['"]
- atob\(.+\.split\(['"]\.['"]\)\[1\]\)               # decoding JWT without verification
- updateUser\(\{[^}]*data\s*:\s*\{[^}]*role           # client-side role write
- "Demo:?\s*Enter\s*as"                                # demo bypass buttons in production code

[RLS / DB]
- OR\s+company_id\s+IS\s+NULL
- USING\s*\(\s*true\s*\)
- WITH\s+CHECK\s*\(\s*TRUE\s*\)
- DELETE\s+FROM\s+(public\.)?audit_log
- CREATE\s+OR\s+REPLACE\s+FUNCTION[\s\S]+SECURITY\s+DEFINER(?![\s\S]+SET\s+search_path)
- GRANT\s+(?:EXECUTE|ALL)\s+ON\s+\w+\s+TO\s+(public|anon|authenticated)

[EDGE]
- verify_jwt\s*=\s*false                              # unless adjacent line is `# JUSTIFICATION: ...`
- bypassOnError\s*[:=]\s*true                         # fail-open in rate limiter or breaker

[XSS / WEB]
- dangerouslySetInnerHTML(?![\s\S]{0,200}DOMPurify)
- innerHTML\s*=                                       # raw assignment

[NATIVE]
- <access\s+origin\s*=\s*["']\*["']
- addJavascriptInterface\(                            # unless inside the audited allowlist
- usesCleartextTraffic\s*=\s*["']true["']

[SECRETS]
- storePassword\s*=\s*[^$]                            # literal in keystore.properties
- sk_live_[A-Za-z0-9]{20,}                            # Stripe live key
- AC[a-f0-9]{32}                                      # Twilio Account SID literal in code
- supabase\.co.*service_role                          # service_role in client bundle

[TESTS]
- readFileSync\([^)]*\.\.\/\.\.\/.*\)\.toString\(\)   # source-pin pattern
- expect\([^)]+\)\.toContain\(['"]CRIT-#               # marker-comment assertion
- expect\(true\)\.toBe\(true\)                         # no-op
- it\.skip\(|xit\(|xdescribe\(|describe\.skip\(        # silent disable (must have ticket comment)

[CRYPTO]
- Math\.random\(\)                                    # outside scripts/visual; require crypto.getRandomValues
- HMAC.*SHA-?1                                        # ban SHA-1
- RC4                                                 # ban RC4
```

Each forbidden pattern has a corresponding **fix-direction** documented in `PHASE_0_STEP_PLAN.md`.

---

## 4. The Step Template (Reference)

This is the form every step takes. The first 7 fields are mandatory.

```markdown
### P0-Z<n> — <one-line title>

**Severity:** P0 / P1 / P2
**Layer:** -1 / 0 / 1 / 2 / 3 / 4 / 5 / 6
**Defect refs:** R-xxxx, R-yyyy (from ROOT_AUDIT_RESULTS_*.md)

**DEPENDS-ON:** [P0-Z0, P0-Z1] — none if this is foundation
**CHANGES:**
  - file:path → exact diff intent
  - command → exact invocation
**ENABLES:** [P0-Z<m>, P0-A<k>] — what becomes safe after
**GUARD:**
  - Layer: L1 / L2 / L3 / L4 / L5 / L6
  - Rule: `<regex / AST check / constraint / monitor>`
  - Location: `<file path>` or `<workflow step>`
**TEST:**
  - Type: behavior / integration / pgTAP / synthetic
  - File: `<test path>`
  - Asserts: <what observable property is checked>
**ROLLBACK:**
  - Action: <exact command to undo>
  - Time-to-rollback: < 5 min target
**WORLD-CLASS-CRITERION:**
  - <standard ID + brief why>
**TELEMETRY:**
  - Log event: `<event_name>` with fields `<...>`
  - Metric: `<metric_name>` (counter/histogram)
  - Alert: fires when `<condition>`; runbook `<URL>`

**EXECUTION:**
  [ ] Step 1 (with command / file change)
  [ ] Step 2
  ...
  [ ] Verify guard fires on a deliberately-broken sample
  [ ] Verify test passes on the fixed code
  [ ] Verify telemetry emits in staging
```

---

## 5. Definition of Done — Phase 0

Phase 0 is complete when **all of the following are true** (and only then):

- All **140 P0** tickets (P0-Z + P0-A + P0-B + P0-C + P0-D + P0-E + P0-F + P0-G) are closed per template
- Every L1-L6 guard is installed AND proven failing on a deliberately-broken sample AND proven passing on the fixed code
- Source-pin tests quarantine list is empty (all replaced with behavior tests)
- Synthetic SOS probe is green in production for **7 consecutive days**
- One independent pentest report exists with all findings either fixed or accepted-residual-risk with sign-off
- Bundle size budget green
- `supabase test db` (pgTAP) green for every tenant-scoped table
- Forbidden-pattern grep on the whole repo returns zero hits
- A signed audit declaration: "Phase 0 closed — <date> — by <engineer>"

Anything less = Phase 0 is NOT done. Shipping is NOT authorized.

---

## 6. Operating Rules for the Engineer (Me)

When I (the agent / engineer) propose any change:

1. I write the step using the §4 template **before** writing the code.
2. I write the **guard first**, then the code.
3. I write the **test on the broken code first** (confirm it fails), then fix the code (confirm it passes).
4. I never bypass any guard. If a guard is wrong, I fix the guard via its own template (it's a meta-change).
5. I never propose a change that affects more than one layer simultaneously; each layer's change is a separate PR.
6. I always state which prior-step's ENABLES list contains this step (chain proof).
7. If a step's WORLD-CLASS standard does not exist, I say so and label the step "homegrown — pending senior review."

Violation of any of these rules by me = the change is reverted immediately; root-cause is documented in this file as an addendum.

---

## 7. Operating Rules for the User (FZ)

This part is your part. Without it the doctrine fails.

1. **Ratify the doctrine** by acknowledging it (or amending it before P0-Z0 starts).
2. **Never override a guard without writing the reason.** If a guard blocks you and the guard is wrong, file an issue; don't `--no-verify`.
3. **Run the rollback drill** for the first 3 P0-Z fixes — confirm you can undo them within the time budget.
4. **Read each step's "WORLD-CLASS" citation** before approving. If the standard doesn't fit your jurisdiction (e.g., KSA PDPL vs GDPR), say so.
5. **Hold me to this file.** If I ever submit a change that doesn't have all 7 mandatory fields, reject it.

---

**END OF DOCTRINE — v1.0**
**Reference everything else against this file.**
