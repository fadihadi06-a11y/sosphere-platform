# SOSphere Audit — GitHub Issues (17 findings)

> Generated: 2026-05-07
> Reviewer: Claude
> Companion document: [SOSphere_Audit_Report_2026-05-07.docx](./SOSphere_Audit_Report_2026-05-07.docx)

This file contains one issue per audit finding, ready to paste into GitHub or batch-create with the `gh` CLI script at the bottom.

**Severity levels:**

- 🔴 **Critical** — block production push until fixed
- 🟠 **High** — block GA launch until fixed
- 🟡 **Medium** — fix within 30 days
- 🟢 **Low** — opportunistic cleanup

---

## 🔴 F-01 [Critical] Bundle splitting — dashboard-web-page is 2.2MB

**Labels:** `audit`, `critical`, `performance`, `bundle`

### Problem

`dist/assets/dashboard-web-page-*.js` is **2.2 MB uncompressed**. The codebase contains:

- **0** `React.lazy()` calls
- **0** `<Suspense>` boundaries

Everything ships in the main bundle.

### Impact

- First load >5s on 3G mobile connections
- Unacceptable for an emergency-response platform — emergencies happen on bad networks
- High bandwidth cost for the customer

### Fix

```tsx
// Before
import { DashboardWebPage } from "./components/dashboard-web-page";

// After
const DashboardWebPage = React.lazy(() => import("./components/dashboard-web-page"));

<Suspense fallback={<LoadingScreen />}>
  <DashboardWebPage />
</Suspense>
```

**Targets to lazy-load:**

- `dashboard-web-page` (2.2 MB)
- `mobile-app` (767 KB)
- `emergency-chat` (381 KB)
- `jspdf` (385 KB) — only on PDF download
- `twilio` (177 KB) — only when video call needed
- `html2canvas` (198 KB) — only on screenshot/PDF flows

**Goal:** initial bundle <500 KB.

### Verification

```bash
npm run build && du -sh dist/assets/*.js | sort -h | tail
```

---

## 🟠 F-02 [High] DOMPurify moderate vulnerability in production

**Labels:** `audit`, `high`, `security`, `dependencies`

### Problem

Production dependency `dompurify` has 4 known CVEs:

- ADD_TAGS bypass via short-circuit evaluation
- FORBID_TAGS bypassed by function-based ADD_TAGS predicate
- SAFE_FOR_TEMPLATES bypass in RETURN_DOM mode
- Prototype Pollution → XSS via CUSTOM_ELEMENT_HANDLING fallback

### Impact

If any user-controlled content passes through DOMPurify (e.g. incident comments, chat messages), an attacker may execute arbitrary JS in the victim's session.

### Fix

```bash
npm audit fix
# OR
npm install dompurify@latest
```

Then re-audit every `dangerouslySetInnerHTML` to confirm sanitization is still applied.

### Verification

```bash
npm audit --omit=dev   # should show 0 vulnerabilities
```

---

## 🟠 F-03 [High] onAuthStateChange leak — 7 subscriptions, only 1 unsubscribe pattern

**Labels:** `audit`, `high`, `memory-leak`, `auth`

### Problem

`supabase.auth.onAuthStateChange()` is called in 7 places, but only `sentry-client.ts` (W3-43) properly unsubscribes:

- `src/app/components/api/subscription-realtime.ts:110`
- `src/app/components/dashboard-web-page.tsx:656`
- `src/app/components/mobile-app.tsx:875`
- `src/app/components/sos-audio-upload.ts:292`
- `src/app/components/sos-server-trigger.ts:1203`
- `src/app/components/sentry-client.ts:123` ✅ (already fixed)

### Impact

- Memory leak — listeners accumulate across re-mounts
- Duplicate handlers — every login re-fires N callbacks instead of 1
- Eventually trips Supabase rate limits

### Fix

Use the same pattern from `sentry-client.ts`:

```ts
// Capture subscription
if ((globalThis as any).__myAuthSub) {
  try { (globalThis as any).__myAuthSub.unsubscribe(); } catch {}
}
const { data } = supabase.auth.onAuthStateChange(...);
(globalThis as any).__myAuthSub = data?.subscription ?? null;
```

Or in React components, store in `useRef` and unsubscribe in `useEffect` cleanup.

### Verification

```bash
grep -rn "onAuthStateChange" src/app/ --include="*.ts" --include="*.tsx"
# every match should be accompanied by a corresponding unsubscribe
```

---

## 🟠 F-04 [High] 23+ packages major versions behind

**Labels:** `audit`, `high`, `dependencies`, `maintenance`

### Problem

68 packages outdated, **23+ MAJOR versions behind**:

- React 18 → 19
- Vite 6 → 8
- Vitest 3 → 4
- @mui/material 7 → 9
- Recharts 2 → 3
- lucide-react 0.x → 1.x
- date-fns 3 → 4
- All 10 `@capacitor/*` packages 6 → 8
- @vitejs/plugin-react 4 → 6

### Impact

- Cumulative security risk
- Locked out of new features and bug fixes
- Migration cost compounds with each version skipped

### Fix

Phased upgrade plan:

1. **Week 1:** Vitest (dev-only, low risk)
2. **Week 2:** Vite + @vitejs/plugin-react
3. **Week 3:** MUI + Recharts + lucide-react + date-fns
4. **Week 4:** React 19 (requires test sweep, breaking changes)
5. **Later:** Capacitor 8 — only after device testing

### Verification

```bash
npm outdated | wc -l   # expect <10
```

---

## 🟠 F-05 [High] 159 empty catch blocks swallow errors silently

**Labels:** `audit`, `high`, `error-handling`, `observability`

### Problem

```bash
grep -rEn "catch\s*\([^)]*\)\s*\{\s*\}" src/app/
# 159 occurrences
```

Hot spots:

- `dashboard-notifications-panel.tsx`
- `dashboard-web-page.tsx`
- `mobile-app.tsx`
- `shared-store.ts`

### Impact

- Sentry never sees these errors
- Silent failures hide real bugs
- Bad UX when something fails with no feedback

### Fix

Every `catch` should do at least one of:

```ts
catch (e) {
  // 1) log in dev
  if (import.meta.env.DEV) console.warn("[scope]", e);
  // 2) report to Sentry
  captureException(e, { tags: { area: "scope" } });
  // 3) re-throw with context
  throw new Error(`scope failed: ${(e as Error).message}`, { cause: e });
}
```

Lint rule:

```json
"no-empty": ["error", { "allowEmptyCatch": false }]
```

### Verification

```bash
grep -rEn "catch\s*\([^)]*\)\s*\{\s*\}" src/app/ | wc -l
# target: 0
```

---

## 🟠 F-06 [High] 184 console.log left in production source

**Labels:** `audit`, `high`, `info-leak`, `cleanup`

### Problem

184 `console.log` / `console.debug` calls visible in production devtools.

### Impact

- Information disclosure (user IDs, company_id, request bodies, internal state)
- Pollutes browser console — makes real issues harder to spot

### Fix

Replace with a `debug()` helper gated on `import.meta.env.DEV`:

```ts
// src/app/lib/debug.ts
export const debug = import.meta.env.DEV
  ? (...args: unknown[]) => console.log(...args)
  : () => {};
```

Add ESLint rule:

```json
"no-console": ["error", { "allow": ["warn", "error"] }]
```

### Verification

```bash
grep -rEn "console\.(log|debug)" src/app/ --include="*.ts" --include="*.tsx" | grep -v test | wc -l
# target: 0
```

---

## 🟡 F-07 [Medium] 848 unused-vars warnings

**Labels:** `audit`, `medium`, `code-quality`

### Problem

ESLint reports 848 `@typescript-eslint/no-unused-vars` warnings. CI cap is currently 1100 (intentional intermediate target; long-term goal <100).

### Impact

- Dead code hides bugs
- Harder to read
- Slightly larger bundle (tree-shaker handles most)

### Fix

Sustained cleanup campaign — 50 warnings per week, lower CI cap each sprint:

- Sprint 1: 1100 → 1000
- Sprint 2: 1000 → 700
- Sprint 3: 700 → 400
- Sprint 4: 400 → 100

### Verification

```bash
npx eslint src/app/ 2>&1 | grep -c "no-unused-vars"
```

---

## 🟡 F-08 [Medium] 242 `: any` types erode type safety

**Labels:** `audit`, `medium`, `type-safety`

### Problem

242 explicit `: any` annotations. Mostly in RPC response handlers and `catch` clauses.

### Impact

TypeScript can't catch shape changes in these paths.

### Fix

1. Create `src/app/types/rpc.ts` with typed responses for every RPC.
2. Replace `any` with `unknown` + type guards.
3. For `catch (e: any)` → `catch (e: unknown)` and narrow with `e instanceof Error`.

### Verification

```bash
grep -rEcn ":\s*any(\s|;|,|\)|\>|=)" src/app/ | awk -F: '{s+=$2}END{print s}'
```

---

## 🟡 F-09 [Medium] .env.example missing 4 documented variables

**Labels:** `audit`, `medium`, `config`, `ops`

### Problem

These are referenced in code but not in `.env.example`:

- `VITE_SENTRY_DSN`
- `VITE_ENVIRONMENT`
- `VITE_APP_VERSION`
- `VITE_TWILIO_ENABLED`

(`DEV`, `PROD`, `NODE_ENV` are built-in and don't need to be documented.)

### Impact

A new engineer cloning the repo doesn't know these exist. A production deploy might silently miss one (e.g. Sentry DSN → no error reporting).

### Fix

Append to `.env.example`:

```env
# Sentry — error monitoring (production only). Leave blank in dev.
VITE_SENTRY_DSN=

# Environment label for Sentry events (production / staging / preview)
VITE_ENVIRONMENT=production

# Release tag, set during CI build (e.g. via git rev-parse HEAD)
VITE_APP_VERSION=

# Toggle Twilio video bridge — set "true" only when entity + Twilio account ready
VITE_TWILIO_ENABLED=false
```

### Verification

```bash
diff <(grep -rEoh "import\.meta\.env\.VITE_[A-Z_]+" src/ | sort -u | sed 's/.*\.//') \
     <(grep -oE "^VITE_[A-Z_]+" .env.example | sort -u)
```

---

## 🟡 F-10 [Medium] 6 sites expose raw `err.message` to UI

**Labels:** `audit`, `medium`, `error-ux`, `info-leak`

### Problem

6 surfaces render `err.message` directly to the user without translation.

### Impact

- Leaks server detail (PostgreSQL error codes, RPC names, JWT internals)
- Bad UX — users see incomprehensible technical strings

### Fix

Single helper:

```ts
// src/app/lib/friendly-error.ts
export function friendlyError(e: unknown): string {
  captureException(e); // log raw to Sentry
  if (e instanceof Error) {
    if (e.message.includes("JWT")) return "انتهت صلاحية الجلسة. سجل دخولك مجددًا.";
    if (e.message.includes("network")) return "تعذر الاتصال بالشبكة.";
  }
  return "حدث خطأ غير متوقع. تواصل مع الدعم إذا تكرر.";
}
```

### Verification

```bash
grep -rEn "\{err\.message\}|\{e\.message\}" src/app/ --include="*.tsx"
# target: 0
```

---

## 🟡 F-11 [Medium] 2 `dangerouslySetInnerHTML` uses need review

**Labels:** `audit`, `medium`, `xss`, `security`

### Problem

1. `mfa-enrollment-modal.tsx:231` — injects an SVG QR code returned by the server
2. `ui/chart.tsx:83` — injects a stylesheet generated from a static `THEMES` constant

### Impact

- (1) If the API layer is ever compromised and `enrollData.qrCodeSvg` is mutated, → XSS
- (2) `THEMES` is compile-time constant → safe

### Fix

For `mfa-enrollment-modal.tsx`:

```ts
import DOMPurify from "dompurify";
const safeSvg = DOMPurify.sanitize(enrollData.qrCodeSvg, {
  USE_PROFILES: { svg: true, svgFilters: true },
});
// then use safeSvg in dangerouslySetInnerHTML
```

For `ui/chart.tsx` — document inline that input is compile-time constant, no action needed.

### Verification

Manual review post-fix.

---

## 🟡 F-12 [Medium] 8 RLS-enabled tables with 0 policies

**Labels:** `audit`, `medium`, `database`, `rls`

### Problem

These tables have `ENABLE ROW LEVEL SECURITY` but zero `CREATE POLICY` statements:

- `async_job_metadata`
- `civilian_trial_history`
- `company_dpa_acceptances`
- `mfa_recovery_attempts`
- `processed_stripe_events`
- `rate_limits`
- `sar_request_history`
- `user_mfa_recovery_codes`

### Impact

This is **deny-by-default** — likely intentional if these tables are only read/written via `SECURITY DEFINER` RPCs. Needs verification that no client path can bypass.

### Fix

For each table, add an integration test:

```sql
-- in supabase/tests/rls-deny-by-default.test.sql
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'some-uuid';

DO $$ BEGIN
  PERFORM 1 FROM async_job_metadata LIMIT 1;
  RAISE EXCEPTION 'should have failed but did not';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK: deny-by-default holds';
END $$;
```

Repeat for INSERT / UPDATE / DELETE.

### Verification

Run the integration test suite — every assertion should pass.

---

## 🟡 F-13 [Medium] 346 localStorage calls — PII walkthrough required

**Labels:** `audit`, `medium`, `gdpr`, `pii`

### Problem

346 `localStorage.setItem` / `getItem` calls. PII-bearing keys include:

- `sosphere_admin_phone`
- `sosphere_employee_avatar`
- `sosphere_employee_profile`
- `sosphere_emergency_contacts`
- `sosphere_gps_trail`
- `sosphere_individual_profile`

### Impact

- A single XSS = full PII exfiltration
- GDPR Right to Erasure: SAR flow must wipe these
- Logout flow must wipe these

### Fix

1. Catalog every key: `(key, dataType, isPII, lifetime)`
2. Confirm logout flow clears all PII keys
3. Confirm SAR flow clears all PII keys
4. Centralize via a wrapper: `secureStorage.set(key, value, { pii: true })` so PII keys are tracked in one place

### Verification

```ts
// after logout
const piiKeys = ["sosphere_admin_phone", ...];
piiKeys.forEach(k => console.assert(!localStorage.getItem(k)));
```

---

## 🟢 F-14 [Low] 3 dev-only npm vulnerabilities (tar / xmldom / postcss)

**Labels:** `audit`, `low`, `dependencies`

### Problem

- `tar` (transitive via `@capacitor/cli`)
- `@xmldom/xmldom`
- `postcss`

All dev-only — never shipped to production.

### Impact

Risk only on developer machines if a malicious file is processed during local build.

### Fix

```bash
npm audit fix
```

Or document as "Risk Accepted (dev-only)".

---

## 🟢 F-15 [Low] 27 useless escapes + 5 @ts-ignore

**Labels:** `audit`, `low`, `code-quality`

### Problem

- 27 `no-useless-escape` warnings in regex/strings
- 5 `@ts-ignore` annotations

### Impact

Small. Indicates unclear regex intent. `@ts-ignore` are blind spots.

### Fix

Fix opportunistically when touching the file. Replace `@ts-ignore` with `@ts-expect-error` so it errors when no longer needed.

---

## 🟢 F-16 [Low] 20 migrations without rollback hints

**Labels:** `audit`, `low`, `database`, `ops`

### Problem

20 of 98 migrations contain no `-- DOWN` comment and no `DROP` statement.

### Impact

Emergency rollback would require writing the down migration under pressure.

### Fix

New policy: every new migration starts with:

```sql
-- DOWN: how to roll this back
-- DROP TABLE foo;
-- DROP FUNCTION bar;
```

Optional CI guard.

---

## 🟢 F-17 [Low] 50 open TODO/FIXME/HACK markers

**Labels:** `audit`, `low`, `tech-debt`

### Problem

50 in-code debt markers.

### Impact

Collective memory of deferred intent. No direct risk.

### Fix

Triage:

1. Convert each to a GitHub issue
2. Delete from source
3. Add lint rule to forbid new ones

---

## Batch creation script (for `gh` CLI)

Save as `docs/create_audit_issues.sh`, run after `gh auth login`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Run from repo root
cd "$(dirname "$0")/.."

# Create labels first (idempotent)
gh label create "audit"        --color BFD4F2 --description "Audit finding"        2>/dev/null || true
gh label create "critical"     --color B60205 --description "Critical severity"   2>/dev/null || true
gh label create "high"         --color D93F0B --description "High severity"       2>/dev/null || true
gh label create "medium"       --color FBCA04 --description "Medium severity"     2>/dev/null || true
gh label create "low"          --color 0E8A16 --description "Low severity"        2>/dev/null || true

# Create one issue per finding from the markdown sections above.
# Each section can be extracted with `awk` between H2 markers.

awk '/^## /{if(t){print body > "/tmp/issue_"t".md"; body=""}; t=$0; sub(/^## [🔴🟠🟡🟢] /,"",t); next} {body=body $0 "\n"} END{if(t){print body > "/tmp/issue_"t".md"}}' docs/AUDIT_GITHUB_ISSUES.md

for f in /tmp/issue_F-*.md; do
  title=$(basename "$f" .md | sed 's|^/tmp/issue_||')
  # Extract first line of file as title context, label by severity in title
  case "$title" in
    *Critical*) labels="audit,critical" ;;
    *High*)     labels="audit,high"     ;;
    *Medium*)   labels="audit,medium"   ;;
    *Low*)      labels="audit,low"      ;;
    *)          labels="audit"          ;;
  esac
  gh issue create \
    --title "$title" \
    --body-file "$f" \
    --label "$labels" || echo "Failed: $title"
done
```

Or — simpler — paste the 17 sections one-by-one into the GitHub web UI; the markdown renders cleanly there.

---

## Companion document

The full audit narrative, methodology, "what's GOOD" section, and remediation roadmap (4 sprints) are in:

**[SOSphere_Audit_Report_2026-05-07.docx](./SOSphere_Audit_Report_2026-05-07.docx)**
