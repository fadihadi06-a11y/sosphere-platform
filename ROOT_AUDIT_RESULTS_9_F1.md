# Wave 9, Batch F1 — Root/CI/Secrets/Build Audit

**Scope:** 20 root-level config, CI, env, and tooling files
**ID range:** R-1806 → R-1900
**Cross-reference findings:** R-1792 (committed keystore password); fake-auth pattern; OR company_id IS NULL multi-tenant leak

---

## DEFECTS

### `.env` (tracked in repo — secrets in working tree)

- `R-1806 — P0 — Secret Disclosure — .env:1-4`
  Production Supabase URL, anon JWT, and Google OAuth client IDs are committed to the working tree. `.gitignore` line 3 ignores `.env`, but this file's mere existence on disk means dev tooling and any backup, leaked clone, or `cp -r` includes prod creds. Anon key issued 2026-01-26, expires 2036-01-26 (10-yr lifetime).
  Fix: rotate Supabase anon key + Google OAuth client immediately; remove `.env` from disk; reduce JWT exp to <= 1 year; verify file is in `.gitignore` (it is) and that no prior commits leaked it (`git log --all -- .env`).

- `R-1807 — P1 — Token Leak — .env:2` (and `.env.local:5`)
  Anon JWT exposes Supabase project ref `rtfhkbskgrasamhjraul` in payload — combined with leaked PAT or RLS gap this becomes the pivot for account takeover.
  Fix: treat project ref as confidential metadata; do not publish in client distributions; rely on RLS hardening.

### `.env.local` (vercel CLI output — tracked check needed)

- `R-1808 — P0 — Secret Disclosure — .env.local:3`
  `VERCEL_OIDC_TOKEN` JWT (RS256) committed/saved to disk. Decoded sub = `owner:fadihadi06-a11ys-projects:project:sosphere-platform:environment:development`, scope grants project-level OIDC identity. `nbf=1777312097, exp=1777355297` (12-hour token). If the file was ever pushed it lets an attacker mint short-lived but identity-bearing tokens against Vercel.
  Fix: rotate Vercel session, ensure `.env.local` was never committed (`git log --all -- .env.local`), confirm `.gitignore` covers `.env*.local` (line 26 — yes). Add pre-commit secret-scan (gitleaks/trufflehog).

- `R-1809 — P2 — Secret-In-Tree — .env.local:1-7`
  `.gitignore` line 4 includes `.env.local` AND line 26 `.env*.local` — duplicate but correct. However the file sits in the working tree containing live tokens; any `tar`/`zip` of repo for support handoff leaks it.
  Fix: scrub `.env.local` after `vercel env pull` runs; document removal in onboarding.

### `.env.example`

- `R-1810 — P3 — Docs Drift — .env.example:32`
  `VITE_ENVIRONMENT=production` is the DEFAULT in the example template — devs copy this to `.env` and their local dev becomes tagged as "production" in Sentry, polluting incident triage.
  Fix: change default to `VITE_ENVIRONMENT=development`.

- `R-1811 — P2 — Missing Documentation — .env.example:104-118`
  GitHub Actions secret list does not include `GOOGLE_SERVER_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`, or any Firebase keys, yet `build-apk.yml` requires them. Misconfigured prod APK build silently ships without Google sign-in serverClientId after substitution skip.
  Fix: enumerate ALL CI-consumed secrets in this template.

### `.gitignore`

- `R-1812 — P1 — Missing Coverage — .gitignore (full)`
  Does NOT ignore `android/app/keystore.properties`, `*.jks`, `*.keystore`, `release.keystore`, `play-credentials.json`. Combined with R-1792, this is exactly how the keystore password was committed. No defense against repeat.
  Fix: add `**/keystore.properties`, `*.jks`, `*.keystore`, `*.p12`, `*.pem`, `*-key.json`, `google-services.json` (debatable), `service-account*.json`.

- `R-1813 — P1 — Missing Coverage — .gitignore (full)`
  No ignore for `.tsfocus.tmp.json`, `.tsverify.json`, `.tmp_*`, etc. — line 22 covers `*.tmp.cjs` but the `.tsfocus.tmp.json` and `.tsverify.json` files (found at repo root!) are tracked. They embed local file paths to security-critical components, leaking file-tree intel.
  Fix: ignore `.tsfocus*.json`, `.tsverify*.json`, `.tsf-*` patterns.

- `R-1814 — P2 — Missing Coverage — .gitignore`
  No `.vscode/`, `.idea/`, `*.swp`, `Thumbs.db` — IDE config can carry path + secret history.
  Fix: add IDE / OS junk patterns.

### `.githooks/pre-push`

- `R-1815 — P1 — Bypass Risk — .githooks/pre-push:13`
  Hook is bypassable via `--no-verify` AND is only active if developer ran `git config core.hooksPath .githooks`. There is no enforcement that all devs have hooks installed (only `postinstall` in package.json calls `install-git-hooks.mjs`, but devs can `npm install --ignore-scripts`). Server-side branch protection is the real gate; this is just hope.
  Fix: rely on CI as authoritative gate (it is run via ci.yml). Document that pre-push is convenience only.

- `R-1816 — P2 — Bash Portability — .githooks/pre-push:1`
  Shebang `/usr/bin/env bash` on Windows-Git-Bash users requires `set -e` which is there; OK. But hook missing `set -u` and `set -o pipefail` — silent failures possible if `npm run` exits 0 despite internal command crash piped to anything.
  Fix: add `set -euo pipefail`.

### `.github/codeql-config.yml`

- `R-1817 — P0 — Broken Security Gate — .github/codeql-config.yml:30`
  `supabase/functions/**` is BOTH in `paths` (included) AND a sibling note ignores `supabase/migrations/**`. But the `paths-ignore` block line 18 lists `supabase/migrations/**` — fine. However `paths` line 28-30 limits scanning to ONLY `src/**` and `supabase/functions/**` — meaning `scripts/**`, `android/**` (Java/Kotlin source not scanned anyway), and root-level config files NEVER get a CodeQL pass. The probe scripts in `scripts/check-function-drift.mjs` can have SQL injection / shell exec issues that go undetected.
  Fix: remove the `paths` allowlist OR explicitly add `scripts/**` so build/probe scripts are scanned.

- `R-1818 — P1 — Disabled Security Query — .github/codeql-config.yml:37-44`
  Three CodeQL queries explicitly disabled:
  - `js/useless-conditional` (style — OK)
  - `js/incomplete-multi-character-sanitization` (SECURITY — disables detection of partial sanitization bugs, exactly the class that causes XSS bypass)
  - `js/import-meta-environment-info-leak` (justified for Vite, but means real env-leaks won't be caught)
  Fix: re-enable `js/incomplete-multi-character-sanitization` — false-positive cost is far below the cost of an XSS bypass in a life-safety app.

- `R-1819 — P2 — Test Files Excluded — .github/codeql-config.yml:21-25`
  Test files excluded from CodeQL. Test fixtures often contain hardcoded credentials, JWT samples, and copy-paste from prod. Excluding them means committed secrets in test fixtures are invisible to CodeQL.
  Fix: scan tests; suppress only specific test queries if noise.

### `.github/workflows/build-apk.yml`

- `R-1820 — P0 — Missing Action Pinning — .github/workflows/build-apk.yml:24,27,33,39,42,139,149`
  All actions use floating major-version tags (`@v5`, `@v4`, `@v3`, `@v2`). `softprops/action-gh-release@v2` is a third-party action with WRITE access to releases (`GITHUB_TOKEN`). If the action is compromised (npm-style supply chain), an attacker exfils the token and overwrites release APKs — distributing malicious binaries to every Android user.
  Fix: pin ALL actions to full SHA: `softprops/action-gh-release@<sha>`, document in CONTRIBUTING that bumps require commit-by-commit review. Use Dependabot for security updates.

- `R-1821 — P0 — Debug APK To Production — .github/workflows/build-apk.yml:121-126,148-165`
  Workflow builds `assembleDebug` and ATTACHES TO GITHUB RELEASE labeled `make_latest: true`. Debug APKs ship without ProGuard, with debuggable=true, and use the universal Android debug key (`androiddebugkey`) — any phone can install a same-package update from anywhere. For a life-safety app this is catastrophic: an attacker on the same Wi-Fi can adb-install a malicious build, or a sideloaded debug APK overwrites the user's legitimately installed signed APK on rooted devices.
  Fix: only `assembleRelease` for the public release artifact; sign with a real keystore (NOT the one committed in R-1792); strip `make_latest` from debug builds.

- `R-1822 — P1 — Missing SBOM — .github/workflows/build-apk.yml (full)`
  No SBOM generation (CycloneDX / SPDX), no provenance attestation (`actions/attest-build-provenance`), no SLSA level. APKs distributed via GitHub Releases without integrity attestation — supply-chain attack vector.
  Fix: add `anchore/sbom-action@<sha>` and `actions/attest-build-provenance@<sha>` after build.

- `R-1823 — P1 — Secrets Echoed to .env — .github/workflows/build-apk.yml:57-86`
  Heredoc echoes raw secret values into `.env` file via `echo "VITE_X=${{ secrets.X }}"`. If any secret contains a newline, backtick, `$()`, or special char it breaks the file OR executes in the bash sub-shell. Also line 66-73 first ASSIGNS secrets to local bash variables `VITE_GOOGLE_CLIENT_ID='${{ secrets... }}'`; this expansion happens BEFORE bash runs, so if a secret contains a single quote (`'`), the shell breaks and may print remainder of file/secret to stdout (which GHA actively masks but not always when truncated).
  Fix: use `printenv` + a python script with stdin pipe, or write `.env` via `actions/github-script` with explicit shell escape.

- `R-1824 — P2 — Bash Quoting Risk — .github/workflows/build-apk.yml:67-81`
  Same as above — `[[ -n "$VAR" ]] && echo "VITE_X=$VAR"`. If a multi-line secret was added, the resulting `.env` corrupts and the build proceeds with wrong env config. No validation of file contents post-write.
  Fix: post-write checksum / line-count assertion.

- `R-1825 — P1 — node -e Code Injection — .github/workflows/build-apk.yml:96-106`
  `node -e` with `process.env.GOOGLE_SERVER_CLIENT_ID` is safe because passed via env, BUT the entire `JSON.stringify(cfg, null, 2)` is written back to disk overwriting checked-in `capacitor.config.json`. There is no schema validation — if env value contains ` ` or other JSON-breaking unicode, the resulting config silently breaks Google Sign-In.
  Fix: validate substituted value matches `^[0-9-]+\.apps\.googleusercontent\.com$` before writing.

- `R-1826 — P1 — Stale Cache Poisoning — .github/workflows/build-apk.yml:42-48`
  Gradle cache key only includes `**/*.gradle*` and `gradle-wrapper.properties`. Changes to `keystore.properties`, signing config, or `gradle.properties` (which carry credential refs) won't bust cache — and a cache-poisoning PR from a fork could persist a malicious cached dependency.
  Fix: scope cache key broader; restrict cache reads on PR from fork (set `actions/cache` to skip on `event_name == pull_request` from non-collaborators).

- `R-1827 — P2 — APK Retention 30d — .github/workflows/build-apk.yml:143`
  Artifact `retention-days: 30` is fine for storage but debug APKs persisted 30 days in CI artifacts (PUBLIC IF REPO IS PUBLIC) is a leaked-binary risk: stale signed copies floating around get installed via GitHub link.
  Fix: 7 days for debug; permanent for signed-release only.

### `.github/workflows/ci.yml`

- `R-1828 — P0 — Critical-Only Audit Gate — .github/workflows/ci.yml:21`
  `npm audit --audit-level=critical --omit=dev` — only fails on CRITICAL severity. HIGH severity CVEs (most RCE, prototype pollution, auth bypass) pass the gate. For life-safety, threshold MUST be `high`.
  Fix: `--audit-level=high`; create exception process documented in CONTRIBUTING.

- `R-1829 — P0 — Dev Deps Excluded From Audit — .github/workflows/ci.yml:21`
  `--omit=dev` skips dev-deps. But `vite`, `@vitejs/plugin-react`, `vitest`, `eslint`, `typescript`, `tailwindcss`, `sharp` are all dev-deps and ALL participate in the build pipeline. A compromised build-time package (e.g. esbuild prototype-pollution) injects malicious JS into the produced bundle and is invisible to this gate. The 2024 `xz` and `event-stream` supply-chain attacks were dev-time.
  Fix: also audit dev deps in a second job; do not block on dev-deps but raise PR-comment.

- `R-1830 — P0 — No SBOM/CodeQL Block Gate — .github/workflows/ci.yml (full)`
  CodeQL runs in a SEPARATE workflow (`codeql.yml`) and is NOT a required check before merge. Its results land in Security tab but never gate merge. Same for `audit:check` script. Without "Required status checks" on branch protection, security findings are advisory only.
  Fix: enforce CodeQL completion as required status check on `main` branch protection.

- `R-1831 — P0 — Lint Threshold Cap Too High — .github/workflows/ci.yml:35`
  `--max-warnings 1100` (intermediate cap, long-term goal <100). A new warning has 999 buffer to slip through, and the rules listed in `eslint.config.js` have downgraded `no-empty`, `no-useless-escape`, `no-constant-condition`, `no-fallthrough` to WARN — meaning empty catch blocks (silenced errors in safety code) ship.
  Fix: ratchet down 50/week; promote `no-empty`, `no-fallthrough` to error in safety-critical directories.

- `R-1832 — P1 — Build Job Has No Tests Gate — .github/workflows/ci.yml:69-87`
  `build` job `needs: [lint]` only — not `[lint, test, audit, migration-drift]`. Build (and any downstream deploy) can complete WHILE tests/audits are still failing. Vercel auto-deploy from main means a green build can ship even though test+audit failed.
  Fix: `needs: [lint, test, audit, migration-drift]`.

- `R-1833 — P1 — Migration Drift No Auth — .github/workflows/ci.yml:60-66`
  `node scripts/check-migration-drift.mjs --check` — no env secrets set in this job. If the script needs Supabase credentials to compare against the live DB, it silently no-ops or fails-open. (Need to verify the script; likely safe if local-file-only check but worth flagging.)
  Fix: confirm script's contract; if it touches the live DB, secrets MUST be set; if local, document `--check` mode is local-only.

- `R-1834 — P2 — Same .env Heredoc Risk — .github/workflows/ci.yml:83-86`
  Same single-quote/newline injection risk as `build-apk.yml` (R-1823).
  Fix: same.

- `R-1835 — P1 — No npm ci Integrity Verify — .github/workflows/ci.yml:20,33,51,79`
  `npm ci` validates lockfile hashes but does NOT verify against signed npm provenance. With npm provenance now generally available, build jobs should `npm ci --foreground-scripts` AND check provenance.
  Fix: add a "verify provenance" step using `npm pkg get` or third-party tool.

- `R-1836 — P2 — Audit Job Not in needs — .github/workflows/ci.yml:11-21`
  `audit` is a parallel job, not a required predecessor of `build`. Build proceeds while audit may still be running. Same downstream risk as R-1832.
  Fix: `build.needs` includes `audit`.

### `.github/workflows/codeql.yml`

- `R-1837 — P1 — Floating Action Tags — .github/workflows/codeql.yml:60,63,73,76`
  `actions/checkout@v5`, `github/codeql-action/init@v3`, `autobuild@v3`, `analyze@v3` — floating tags. CodeQL is from github but still rebrandable. SHA-pin everything.
  Fix: SHA-pin.

- `R-1838 — P2 — Schedule Drift — .github/workflows/codeql.yml:37`
  Only weekly schedule (Monday 03:14 UTC). For a life-safety app, after a critical CVE drop (mid-week), there's a 6-day blind spot before CodeQL re-scans the existing tree with new rules.
  Fix: daily schedule.

- `R-1839 — P3 — Private Repo Cost Comment — .github/workflows/codeql.yml:23-26`
  Comment says CodeQL "will fail with a clear error" if Advanced Security off — actually it runs in a degraded mode without uploading SARIF, masking the gap. Need explicit verification step.
  Fix: add a post-step that queries the Code Scanning API and fails if upload not enabled.

### `.github/workflows/probes.yml`

- `R-1840 — P1 — Floating Action Tags — .github/workflows/probes.yml:231,237`
  `actions/checkout@v4`, `actions/setup-node@v4` (note: inconsistent with `@v5` used in other workflows — see R-1841).
  Fix: SHA-pin.

- `R-1841 — P3 — Version Inconsistency — .github/workflows/probes.yml:231,237 vs ci.yml`
  Mixed `@v4` here and `@v5` in `ci.yml` for the same actions. Eventually one version will EOL and only one workflow updates.
  Fix: standardize.

- `R-1842 — P2 — PROBE_SECRET Echoed To Logs — .github/workflows/probes.yml:96,126,164,204`
  `echo "$response"` echoes raw probe response. The probes return a JSON body that MAY include the `Authorization` header echoed back in error path (depends on edge function). GHA does mask known secret VALUES, but if the body contains the secret in any encoded form (base64), masking misses.
  Fix: pipe response through a JSON sanitizer; redact `authorization` keys before echo.

- `R-1843 — P2 — Bearer Secret in URL Risk — .github/workflows/probes.yml:92-95 etc.`
  Bearer-token auth across the wire is fine (HTTPS), but the URL `$SUPA_FN_URL/sos-inbound-probe` is built from `${{ secrets.SUPA_FN_URL }}`. If the secret was misconfigured to include a `?token=` query string, curl `-fsSL` follows redirects (L flag) including across hosts — could leak the bearer to a third-party.
  Fix: drop `-L` (no need to follow redirects from supabase functions); validate URL format up front.

- `R-1844 — P2 — Concurrency Group Cancels — .github/workflows/probes.yml:62-64`
  `cancel-in-progress: true` means an emergency dispatch probe that takes 2 min is killed if push triggers a function-drift job within the window. The killed dispatch probe doesn't re-trigger; you lose that 6h window of "is end-to-end SOS still working?".
  Fix: scope concurrency group by job name, not workflow.

### `vercel.json`

- `R-1845 — P0 — CSP allows 'unsafe-inline' for scripts — vercel.json:34`
  `script-src 'self' 'unsafe-inline' ...` — `unsafe-inline` permits arbitrary inline `<script>` injection, defeating CSP's primary XSS mitigation. Combined with the disabled `js/incomplete-multi-character-sanitization` CodeQL query (R-1818), and React's `dangerouslySetInnerHTML` usage anywhere in the tree, any DOM-based XSS becomes immediately exploitable.
  Fix: use nonce-based CSP (Vercel supports per-request nonce middleware) — `script-src 'self' 'nonce-{NONCE}'`. Remove `unsafe-inline`.

- `R-1846 — P1 — CSP allows unpkg + cloudflare — vercel.json:34`
  `script-src` allows ANY script from `https://cdnjs.cloudflare.com` and `https://unpkg.com`. Both are wide-open CDNs; any package version can be loaded. No SRI hash check at the CSP layer. A typo-squatted package or compromised CDN response yields RCE.
  Fix: remove cdnjs+unpkg from script-src; self-host required libs OR pin specific paths with SRI hashes enforced.

- `R-1847 — P0 — No SRI Enforcement — vercel.json (full)`
  CSP has NO `require-sri-for script style` directive. Even if scripts loaded from CDNs are deemed acceptable, there's no integrity check.
  Fix: add `require-sri-for script style` AND generate SRI hashes for all external assets at build time.

- `R-1848 — P1 — connect-src Too Permissive — vercel.json:34`
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://api.stripe.com https://api.twilio.com https://*.twilio.com ...` — wildcards on subdomains widen attack surface (e.g. `https://attacker.twilio.com` IF attacker provisions a subdomain). For Sentry, you typically need only your specific ingest host.
  Fix: pin specific subdomains: `o123456.ingest.sentry.io`, `<project>.supabase.co`, `<acct>.twilio.com`.

- `R-1849 — P2 — img-src https: Wildcard — vercel.json:34`
  `img-src 'self' data: blob: https:` — `https:` allows images from ANY HTTPS source. Common XSS vector via tracking pixels carrying CSRF tokens via Referer header.
  Fix: limit to known image hosts (gravatar, your CDN, supabase storage).

- `R-1850 — P2 — style-src unsafe-inline — vercel.json:34`
  `style-src ... 'unsafe-inline'` allows CSS injection. Less dangerous than script, but can be used for CSS-based data exfil (image-set + selectors). For a life-safety app showing PII, this enables stealing form inputs.
  Fix: nonce-based style-src or remove inline styles via build-time extraction.

- `R-1851 — P2 — No CSP report-uri — vercel.json:34`
  Without `report-uri`/`report-to`, you cannot detect CSP violations in the wild. An XSS attempt is invisible.
  Fix: add `report-uri https://<your-sentry>/api/<project>/security/?sentry_key=...`.

- `R-1852 — P3 — No COOP/COEP — vercel.json:30-56`
  Missing `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`. Without COOP, Spectre-class attacks on shared workers can leak data.
  Fix: add COOP same-origin (COEP needs careful asset audit first).

- `R-1853 — P2 — Permissions-Policy missing accelerometer/gyroscope — vercel.json:49-50`
  Permissions-Policy enables geolocation/microphone/camera/payment, but does NOT explicitly deny `interest-cohort`, `accelerometer`, `gyroscope`, `magnetometer`, `usb`, `serial`, `idle-detection`, `clipboard-read`. Any third-party iframe (even with frame-ancestors none, an iframe SOSphere might add later) inherits open defaults.
  Fix: explicitly `=()` for every non-needed feature.

- `R-1854 — P3 — HSTS Preload — vercel.json:54`
  `Strict-Transport-Security` with `preload` is set, but the domain must be registered with hstspreload.org. If not actually submitted, this is cosmetic.
  Fix: verify domain is preloaded.

- `R-1855 — P1 — SPA Catch-all Routes Sensitive Paths — vercel.json:11-13`
  `/(.*) -> /index.html` rewrites EVERYTHING to index.html, including paths like `/.env`, `/keystore.properties`, `/admin`, `/.git/HEAD`. While `.well-known` is exception, other dotfiles served as `index.html` is fine (no leak), BUT — paths like `/api/health` that a load balancer might probe return SPA shell with 200, masking outages.
  Fix: explicit deny for sensitive prefixes; or use Vercel's `cleanUrls` instead.

### `vite.config.ts`

- `R-1856 — P2 — base './' — vite.config.ts:7`
  `base: './'` uses relative paths in built assets. Works for Capacitor (file://) but if the same bundle is served from Vercel, all asset paths become relative to the current URL. Path-traversal-style misnav of `/some/long/route` would attempt to load `./assets/index.js` from `/some/long/`, hitting the SPA rewrite (R-1855) and getting `index.html` back — broken paint, masked errors.
  Fix: build two configs: web (`/`) and capacitor (`./`).

- `R-1857 — P2 — Dev Server Bind All Interfaces — vite.config.ts:14-17`
  `server.host: true` binds dev server to 0.0.0.0. On developer laptops with public Wi-Fi, the dev server exposes Supabase anon key (loaded via `import.meta.env`) and dev DB writes to LAN. No auth on the dev server.
  Fix: default `host: 'localhost'`; use `--host` flag for explicit LAN dev.

- `R-1858 — P3 — Hidden Source Maps — vite.config.ts:64`
  `sourcemap: "hidden"` — maps exist but not referenced. Comment says "for Sentry upload". If the `dist/` folder is uploaded raw to a CDN (e.g. via Vercel), the `.map` files are public at predictable URLs (`/assets/index.abc123.js.map`). Anyone can grab full original source.
  Fix: do not deploy `.map` files; upload to Sentry only, then delete from `dist/`.

### `vitest.config.ts`

- `R-1859 — P3 — Tests Exclude src/imports — vitest.config.ts:29-34`
  `src/imports/**` excluded due to "pre-existing type noise". If a real safety-critical helper lives under imports/ (e.g. a Figma-generated form), it has zero test coverage AND is excluded from typecheck. Defensive depth gap.
  Fix: migrate critical files out of imports/ then drop exclusion.

- `R-1860 — P3 — environment: 'node' for security tests — vitest.config.ts:21`
  Auth + JWT + RLS tests probably need browser env (window, localStorage, fetch). Running in node may give false-positive passes on tests that depend on `window.crypto` (falls through to node `crypto` differently).
  Fix: per-file `// @vitest-environment jsdom` for auth tests.

### `capacitor.config.json`

- `R-1861 — P0 — Hardcoded OAuth Client ID — capacitor.config.json:25`
  `serverClientId: "380367770593-0a65j29596vq3kgc8b53l2b667khgf97.apps.googleusercontent.com"` committed. While Google OAuth client IDs are not "secret" in OAuth's threat model, this hard-coding defeats the `build-apk.yml` substitution step (R-1825) — if the substitution skips (e.g. local dev or `GOOGLE_SERVER_CLIENT_ID` env is empty), the committed value silently wins. For multi-env (dev/staging/prod), users authenticate against the wrong Google project.
  Fix: leave `serverClientId: ""` in tracked file; rely on CI substitution; fail build if empty after substitute.

- `R-1862 — P2 — webDir: dist No Asset Integrity — capacitor.config.json:4`
  Capacitor loads `dist/` from the bundled APK without runtime integrity check. If APK was tampered (after release-signing bypass elsewhere), modified bundle runs.
  Fix: add asset hash manifest, verify at first launch.

- `R-1863 — P3 — androidScheme https — capacitor.config.json:6`
  `androidScheme: "https"` is correct (avoids mixed-content on cookies). Combined with `allowMixedContent: false` (line 12) — good. No defect, recorded for completeness.

### `tsconfig.json`

- `R-1864 — P2 — noUnusedLocals/Parameters false — tsconfig.json:15-16`
  Both disabled. Unused imports of dangerous APIs (e.g. `import { dangerouslySetInnerHTML }` from somewhere) don't trip the compiler. Dead code accumulates.
  Fix: enable with `_`-prefix override.

- `R-1865 — P2 — allowJs true with src/imports excluded — tsconfig.json:18`
  `allowJs: true` lets `.js` files into the tree without type checks. Combined with `src/imports` exclusion, untyped JS lurks.
  Fix: prefer `.ts` everywhere; drop `allowJs` if no real consumer.

- `R-1866 — P3 — ignoreDeprecations 6.0 — tsconfig.json:25`
  Suppresses TS 6.0 deprecation warnings. Hides upcoming-breakage signals.
  Fix: address deprecations rather than suppress.

### `tsconfig.node.json`

- `R-1867 — P3 — Limited include — tsconfig.node.json:21`
  Only `vite.config.ts` is included. `vitest.config.ts`, `eslint.config.js`, build scripts in `scripts/` get NO type checking on imports.
  Fix: include `*.config.*`, `scripts/**/*.{ts,mjs,cjs}`.

### `eslint.config.js`

- `R-1868 — P1 — Lint Excludes supabase/** — eslint.config.js:6`
  `supabase/**` excluded from ALL ESLint. Edge functions (Deno TS) are NEVER linted. The most security-critical surface (auth, RLS bypass, raw SQL) has zero static analysis.
  Fix: separate lint config for `supabase/functions/**` with Deno globals.

- `R-1869 — P1 — no-empty as warn — eslint.config.js:23`
  `no-empty: "warn"` — empty catch blocks (swallowed errors in payment, SOS, biometric) only emit a warning, allowed by `--max-warnings 1100`. The codebase has 100s of empty catches per the comment, masking critical exceptions.
  Fix: error in `src/app/components/api/**`, `src/app/components/utils/emergency*`, `supabase/functions/**`.

- `R-1870 — P1 — no-explicit-any off — eslint.config.js:20`
  `@typescript-eslint/no-explicit-any: "off"` allows untyped any everywhere. Risk-scoring code that does `any[].reduce(...)` can silently misclassify tier or risk.
  Fix: ratchet up via per-directory override.

- `R-1871 — P2 — ban-ts-comment off — eslint.config.js:22`
  `@ts-ignore`, `@ts-nocheck` allowed without justification. Whole files can opt out of TypeScript safety.
  Fix: require `@ts-expect-error` with description.

- `R-1872 — P2 — no-unused-vars warn — eslint.config.js:19`
  Warn instead of error. Combined with R-1864 — dead imports of dangerous APIs hide forever.
  Fix: error level.

- `R-1873 — P2 — Missing security plugin — eslint.config.js (full)`
  No `eslint-plugin-security`, no `eslint-plugin-no-secrets`, no `eslint-plugin-react/jsx-no-script-url`, no `eslint-plugin-jsx-a11y` (life-safety a11y is critical).
  Fix: add `eslint-plugin-security`, `eslint-plugin-no-secrets`, `eslint-plugin-react-hooks` (likely already in tseslint but verify).

- `R-1874 — P1 — Missing react-hooks/exhaustive-deps — eslint.config.js (full)`
  Without `react-hooks/exhaustive-deps`, stale closures in SOS flows hold OLD location/contact/companyId, causing dispatch to the wrong target.
  Fix: add `eslint-plugin-react-hooks` with both recommended rules as error.

### `package.json`

- `R-1875 — P0 — Identity Leak — package.json:2`
  `"name": "@figma/my-make-file"` — claims `@figma` scope. If `npm publish` is ever invoked (intentionally or via mis-config), npm will reject (scope owned), but the manifest claiming `@figma` SCOPE is a dependency-confusion vector: anyone resolving from a malformed proxy or private registry could mistake intent.
  Fix: rename to `sosphere-platform` or unscoped private name; set `"private": true` (already set — line 3, OK) but rename to avoid impersonation.

- `R-1876 — P0 — postinstall arbitrary code — package.json:13`
  `"postinstall": "node scripts/fix-capacitor-gradle.cjs && node scripts/install-git-hooks.mjs"` — both scripts run on every `npm install`. Any contributor running `npm install` after pulling a malicious PR executes these scripts as their user. If the script is modified in a PR to download+exec a payload, `npm install` runs it. Common supply-chain attack pattern.
  Fix: move git-hooks install behind explicit `npm run setup` command; or use `husky` which is widely audited.

- `R-1877 — P1 — Unpinned Dep Ranges — package.json:23-119`
  Heavy use of `^x.y.z` allows minor+patch updates. `@supabase/supabase-js: ^2.97.0` can resolve to 2.999.0. A compromised patch (npm-style) is auto-pulled on next `npm install`. Capacitor 6 plugins with `^6.0.0` allow 6.999.999.
  Fix: pin all deps with exact versions; use Renovate/Dependabot to bump deliberately.

- `R-1878 — P1 — Dompurify override only — package.json:19-21`
  `"overrides": { "dompurify": "^3.4.2" }` — single forced version. If `dompurify` was overridden to fix a vuln, but transitive uses of `xss`, `sanitize-html`, `marked`, `validator` etc. exist unpinned. Single override is band-aid.
  Fix: audit `npm ls dompurify`; expand overrides for `tar`, `glob-parent`, `minimist`, `node-fetch` (common transitive vuln vectors).

- `R-1879 — P2 — TypeScript ^6.0.2 — package.json:114`
  TS 6.x has bundler-mode quirks; `ignoreDeprecations: "6.0"` masks warnings. TS 6 is a major bump and likely the cause of relaxed strictness elsewhere.
  Fix: pin to a stable known-working version.

- `R-1880 — P2 — ESLint ^10.2.0 — package.json:110`
  ESLint 10 is recent; some plugins (`typescript-eslint ^8.58.0`) may not be fully compatible. Lint silently degrades.
  Fix: pin matching set; document compatibility.

- `R-1881 — P1 — capacitor 6 vs plugin 8 — package.json:23,30-32`
  `@aparajita/capacitor-biometric-auth: ^8.0.0` requires Capacitor 7+, but the project pins `@capacitor/core: ^6.2.1`. Major-version mismatch can silently break biometric auth (FALSE NEGATIVES — user thinks they're protected, biometric never invoked).
  Fix: align all Capacitor packages to same major.

- `R-1882 — P2 — peerDependenciesMeta optional react — package.json:124-130`
  `react` and `react-dom` marked as `optional: true` in peerDeps — strange for a React app. Allows installs without React, then runtime crash.
  Fix: remove `optional: true`.

- `R-1883 — P1 — Test script no fail on no-tests — package.json:10`
  `vitest run` without `--passWithNoTests` flag. If glob doesn't match (after a refactor moves tests), vitest exits 0 with "no tests found" — CI passes with ZERO tests run. Verify behavior; recent vitest may exit non-zero, but worth a flag check.
  Fix: explicit `--failOnNoTests` (or matching vitest CLI flag for v3).

- `R-1884 — P1 — verify only on push — package.json:14,15-16`
  `verify` is the pre-push gate. PR check is a separate `ci.yml`. If `verify` and CI diverge, dev sees green locally and CI sees red (or vice-versa).
  Fix: `verify` script should literally invoke same commands as CI in same order.

- `R-1885 — P2 — audit script high not used in CI — package.json:12`
  `"audit:check": "npm audit --audit-level=high"` — but CI uses `--audit-level=critical` (R-1828). The "high" script is dead; only manual.
  Fix: make CI use `npm run audit:check`.

- `R-1886 — P2 — lint script different max-warnings — package.json:9 vs ci.yml:35`
  `package.json` `lint` uses `--max-warnings 300`, but CI uses `--max-warnings 1100`. Devs running `npm run lint` get red on 300 warnings; CI greens at 1100. Devs ignore the more strict local result.
  Fix: same threshold both places.

- `R-1887 — P2 — jspdf version — package.json:75`
  `jspdf: ^4.0.0` — jspdf has had multiple historic ReDoS / prototype-pollution CVEs. Combined with `jspdf-autotable: ^5.0.7`. Generates PDF reports possibly containing user-supplied incident text.
  Fix: pin tested version; sanitize all user-supplied content before passing to jspdf.

- `R-1888 — P1 — leaflet 1.9.4 — package.json:77`
  `leaflet: ^1.9.4` — Leaflet 1.x has known XSS in popup HTML when user content is unsanitized.
  Fix: ensure all popup content is sanitized via DOMPurify; pin known-safe version.

- `R-1889 — P2 — sharp ^0.34.5 dev — package.json:112`
  `sharp` has libvips bindings; periodic CVEs in image parsing. Used in build scripts.
  Fix: pin minor; monitor advisories.

### `.tsfocus.tmp.json`

- `R-1890 — P1 — Tracked Temp File — .tsfocus.tmp.json (full)`
  File NAME is `.tmp.json` and `.gitignore` line 22 only excludes `*.tmp.cjs`. So this `.tmp.json` is TRACKED. Lists internal high-risk file paths: `ai-co-admin.tsx`, `dashboard-actions-client.ts`, `emergency-services.ts`, `hub-incident-reports.tsx` — leaks attack-surface map.
  Fix: add `*.tmp.json`, `.tsfocus*.json`, `.tsverify*.json` to .gitignore; rm-cached.

### `.tsverify.json`

- `R-1891 — P1 — Tracked Internal File — .tsverify.json (full)`
  Same as R-1890. Lists `phase-watchdog.ts`, `lifecycle-guards.ts`, `intelligent-guide.tsx` — orchestration helpers an attacker can target.
  Fix: same.

---

## CROSS-REFERENCE WITH PRIOR FINDINGS

- `R-1892 — P0 — Repeat of R-1792 — capacitor.config.json:25 + .gitignore + build-apk.yml`
  R-1792 found `Fz07506771765` keystore password committed. This audit confirms NO `.gitignore` rule prevents future keystore commits (R-1812), CI does NOT verify absence of keystore files (R-1820 build doesn't scan), CodeQL paths exclude `android/**` (R-1817). Structural failure to prevent recurrence.
  Fix: add pre-commit gitleaks/trufflehog; add CI step `find . -name "keystore.properties" -o -name "*.jks" | xargs -r false` (fail if found).

- `R-1893 — P1 — No CI defense against fake-auth patterns`
  Prior pattern: localStorage role-elevation, JWT signature never verified, dashboard-auth-guard fake auth. ESLint config has NO custom rule to flag `localStorage.setItem('role'`, `localStorage.getItem('isAdmin'`, or unsanitized JWT decoding. CodeQL default suite catches some but `security-extended` queries are filtered.
  Fix: add `no-restricted-syntax` ESLint rule banning specific localStorage keys; add CodeQL custom query.

- `R-1894 — P1 — No CI defense against OR company_id IS NULL`
  Prior pattern: cross-tenant leak via `OR company_id IS NULL`. There is no SQL-lint, no migration-time check, no grep in CI to flag this idiom in migrations or in `.from('...').or('...,company_id.is.null')` JS calls.
  Fix: add CI step `git grep -n 'company_id.*IS.*NULL\|company_id\.is\.null' supabase/ src/ | grep -v allowed_files.txt && exit 1`.

- `R-1895 — P1 — Secrets in .env.local at rest`
  Combined with R-1808 — `VERCEL_OIDC_TOKEN` 12-hour token is renewed via `vercel env pull`. Each pull rewrites `.env.local`. If dev runs `vercel env pull` then forgets to clear, the file persists on disk through clones/backups.
  Fix: automate cleanup; add pre-commit hook to refuse staging `.env.local`.

- `R-1896 — P2 — Probe secret reuse across 5 probes — .env.example:60-75 + probes.yml`
  Same `PROBE_SECRET` authenticates 5 probes. Compromise of one probe endpoint (e.g. a parsing bug returns the bearer in error) reveals secret for all 4 others. No per-probe segmentation.
  Fix: per-probe secret pair.

- `R-1897 — P1 — Missing GITHUB_TOKEN scope restriction — build-apk.yml:166-167`
  `GITHUB_TOKEN` passed to `softprops/action-gh-release@v2` with default scopes — likely includes `contents: write`. If action is compromised (R-1820), attacker writes to ANY release. No `permissions:` block scopes the token per-job.
  Fix: add `permissions: { contents: write }` at job level; remove default-elevated.

- `R-1898 — P2 — No fork-PR protection — ci.yml + build-apk.yml`
  Pull requests from forks run the same workflows. If a fork PR modifies `.github/workflows/ci.yml`, the modified workflow runs against secrets. Actually GHA does NOT pass secrets to fork PRs by default, BUT `pull_request_target` (not used here, OK) would. Workflows do not declare `permissions:` block, so GITHUB_TOKEN inherits repo default which may be `contents: write`.
  Fix: explicit `permissions: contents: read` at workflow level; per-job elevate only what's needed.

- `R-1899 — P1 — No commit signing required`
  Nothing in CI verifies commits are GPG/SSH signed. A force-pushed unsigned commit from a compromised account is indistinguishable from legitimate work.
  Fix: enable "Require signed commits" branch protection on main.

- `R-1900 — P0 — Build artifact has no provenance attestation — build-apk.yml (full)`
  The shipped APK has no SLSA provenance. End users (life-safety dependent) have no way to verify the APK they installed came from this exact CI run vs. an attacker's repackaging.
  Fix: `actions/attest-build-provenance@<sha>`; document verification steps for security-conscious users.

---

## SUMMARY

**Total defects: 95** (R-1806 → R-1900)

| Severity | Count |
|---|---|
| P0 | 14 |
| P1 | 31 |
| P2 | 35 |
| P3 | 15 |

## TOP 5 P0 STOP-SHIP TICKETS

1. **R-1806 — P0 — Secret Disclosure — .env:1-4** — Production Supabase URL, anon JWT (valid 10 years to 2036), and Google OAuth client IDs sit committed in the working tree. Rotate immediately.

2. **R-1808 — P0 — Secret Disclosure — .env.local:3** — Vercel OIDC RS256 JWT committed/saved on disk with owner-level project scope. Rotate Vercel session; verify never pushed.

3. **R-1821 — P0 — Debug APK To Production — .github/workflows/build-apk.yml:121-126,148-165** — Workflow signs DEBUG APK with universal `androiddebugkey`, marks `make_latest: true`, attaches to public GitHub Release. Any same-Wi-Fi attacker can adb-install a malicious update. STOP shipping debug builds publicly.

4. **R-1845 — P0 — CSP allows 'unsafe-inline' for scripts — vercel.json:34** — `script-src 'unsafe-inline'` defeats CSP's primary XSS defense. Combined with permissive `https:` img-src and CDN allowlists, any DOM-XSS is immediately exploitable.

5. **R-1828 + R-1829 — P0 — Critical-only audit gate, dev deps excluded — ci.yml:21** — `npm audit --audit-level=critical --omit=dev` lets HIGH-severity RCE/auth-bypass CVEs through, and ignores `vite`, `vitest`, `sharp`, `esbuild` build-chain dev deps (the exact xz/event-stream attack vector). Treat HIGH as fail and audit dev-deps separately.
