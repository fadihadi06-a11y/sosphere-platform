# ROOT_AUDIT_RESULTS — Wave 9, Batch F3 (scripts/ + root build helpers)

Audit scope: 32 files in `scripts\` plus `build-and-install.bat` + `sosphere-fix-and-test.ps1` (root).
Audit method: full line-by-line read of every file (no pattern-scan).
ID range: R-1981 → R-2080.

---

## Findings

### `backup-keystore.ps1`

- **R-1981 — P1 — Plaintext-secret backup, hard-coded path — `backup-keystore.ps1:13,44`**
  Problem: copies `keystore.properties` (plain-text release-signing password `Fz07506771765`) to a fixed unencrypted directory `C:\Users\user\SOSphere-Backups\<ts>\` with no ACL hardening.
  Fix direction: copy only the `.jks`, NOT the `keystore.properties` (or encrypt the props with DPAPI / GPG before write); set ACL to user-only via `icacls /inheritance:r /grant:r $env:USERNAME:F`.

- **R-1982 — P2 — Backup overwrite race / no GC of stale backups — `backup-keystore.ps1:38-40`**
  Problem: every run creates a new timestamped folder, nothing prunes old folders — disk fills, every plaintext-password copy lingers indefinitely.
  Fix direction: keep last N backups (e.g., 10) and `Remove-Item` older ones; or rotate to encrypted destination.

- **R-1983 — P3 — No SHA-256 sidecar for keystore.properties — `backup-keystore.ps1:46-53`**
  Problem: integrity hash only generated for `.jks`; tampered/corrupt properties file is silently restored later.
  Fix direction: compute SHA-256 for both files.

- **R-1984 — P3 — Backup path is hard-coded to one developer's machine — `backup-keystore.ps1:13`**
  Problem: `C:\Users\user\SOSphere-Backups` is hard-coded — script only works for that one user; other developers silently get garbage path or denial.
  Fix direction: read from `$env:SOSPHERE_BACKUP_ROOT` with sensible per-user fallback (`$env:USERPROFILE\SOSphere-Backups`).

### `check-function-drift.mjs`

- **R-1985 — P1 — Single-shot drift detection relies on env vars without scope check — `check-function-drift.mjs:54-56,72`**
  Problem: `SUPABASE_ACCESS_TOKEN` (personal access token) is accepted from any source and used to call the Management API; no warning when a SERVICE-ROLE key is fed by mistake — that would still authenticate against some endpoints.
  Fix direction: validate token prefix (`sbp_`); reject `sb_`/`service_role`-shaped tokens.

- **R-1986 — P2 — `process.exitCode = 0` for `--update-manifest` even when individual function fetch failed — `check-function-drift.mjs:124-149`**
  Problem: `mgmt()` throws would be caught by the outer `.catch`, but partial network failure during for-loop is not surfaced — manifest could be silently rewritten with stale entries.
  Fix direction: wrap each iteration in try/catch + fail loud if ANY function update fails.

- **R-1987 — P2 — Allowlist bypass for drift — `check-function-drift.mjs:177-184`**
  Problem: any slug present in `.deploy-drift-allowlist.json` is unconditionally treated as "orphan_deployed allowlisted" and never compared — attacker who can edit allowlist disables drift detection.
  Fix direction: require allowlist file to be signed / require CODEOWNERS approval; log every allowlisted slug at WARN; flag entries older than 90 days.

- **R-1988 — P3 — `foreign_entrypoint` triggers only warning, not failure when allowlisted — `check-function-drift.mjs:166-184`**
  Problem: a function whose entrypoint is on someone's foreign workstation `/Users/...` is reported but still counted under `orphan_deployed.allowlisted`, no separate fail-loud track.
  Fix direction: foreign entrypoint with allowlist hit should require periodic re-attestation (e.g., expiry date in allowlist entry).

### `check-migration-drift.mjs`

- **R-1989 — P2 — SHA computed on file content WITHOUT excluding headers, contradicting the comment — `check-migration-drift.mjs:56-67`**
  Problem: code comment says "Strip the header banner if present so the sha tracks the actual SQL", but implementation does NOT strip — `text` is hashed in full. Header-only edit triggers false-positive drift.
  Fix direction: implement what the comment says (skip leading comment lines) OR fix the comment.

- **R-1990 — P2 — No verification of timestamp uniqueness — `check-migration-drift.mjs:49-67`**
  Problem: two migrations with the same `\d+` prefix would silently collide in `lockMap`/`diskMap` Map keys and one would be lost.
  Fix direction: assert that each version appears exactly once on disk before building maps; fail loudly on dupe.

- **R-1991 — P3 — Default mode prints manifest but exits 0 even if missing dir — `check-migration-drift.mjs:46-48,136-144`**
  Problem: if MIGS_DIR is missing the script `exit(2)`, but the default printer doesn't tell user it can be invoked with `--check` or `--update` — easy to misuse.
  Fix direction: print short usage hint in default mode.

### `deploy-edge-function.mjs`

- **R-1992 — P0 — `--skip-verify` flag bypasses migration drift, ESLint, vitest before pushing live code — `deploy-edge-function.mjs:65-80`**
  Problem: any developer can run `npm run deploy:fn sos-alert -- --skip-verify` and deploy unverified code to PROD edge functions that handle SOS dispatch. Comment "if you know what you're doing" is not a control.
  Fix direction: gate `--skip-verify` on a separate `SOSPHERE_ALLOW_SKIP_VERIFY=yes` env flag plus an interactive `read y/N`; audit-log to file every use.

- **R-1993 — P1 — Hard-coded slug accepted as first non-flag arg without allowlist — `deploy-edge-function.mjs:44-51`**
  Problem: `slug` is whatever non-flag argv looks like — typos (`sos-aler`) call `supabase functions deploy sos-aler` which can create a NEW function in production.
  Fix direction: verify slug exists in `supabase/functions/<slug>/index.ts` before invoking deploy; or check the deployed list and confirm.

- **R-1994 — P1 — Auto-commit + auto-push gates on `current branch` with no main-branch protection check — `deploy-edge-function.mjs:146-161`**
  Problem: `--auto-commit` discovers current branch and pushes there. If developer is on `main`/`master`/`production` with branch protection, push silently fails; if no protection, push goes straight to default branch unreviewed.
  Fix direction: refuse to auto-push to protected branch names (`main|master|prod|production|release/*`) without an explicit `--allow-protected` flag.

- **R-1995 — P2 — `spawnSync npm` uses `shell: process.platform === "win32"` — command-injection vector via slug — `deploy-edge-function.mjs:68-72,82-87`**
  Problem: `slug` is interpolated into args; with `shell: true` on Windows, a slug like `sos-alert & del /F C:\important` would be executed by `cmd.exe`. `spawnSync` argv is safer than a string, but with `shell: true` PowerShell/cmd quoting can re-expand.
  Fix direction: validate slug against `^[a-z0-9-]{1,63}$` BEFORE spawn; never use `shell: true` when interpolating user-controlled tokens.

- **R-1996 — P2 — Deploy proceeds even if `git add` fails — `deploy-edge-function.mjs:107-110`**
  Problem: when `git add` returns non-zero, code only warns and continues; manifest stays unstaged, drift probe will fire next CI run, no audit trail.
  Fix direction: treat git-add failure as hard error in non-auto-commit mode; in auto-commit mode, abort before commit step.

- **R-1997 — P2 — No proof the deployed bundle equals the source — `deploy-edge-function.mjs:82-91`**
  Problem: script trusts `supabase functions deploy` exit code as success; it then asks the Management API for the new ezbr_sha256 — but the deploy could have shipped an older transient esbuild output.
  Fix direction: read manifest entry after deploy and assert `pinned.version > previous_pinned.version`.

### `fix-capacitor-gradle.cjs`

- **R-1998 — P0 — Postinstall script mutates node_modules contents (supply-chain risk) — `fix-capacitor-gradle.cjs:86-117`**
  Problem: rewrites `build.gradle` of any package that matches "capacitor" in its name. An attacker that publishes `@evil/capacitor-spy` automatically gets its gradle silently rewritten on every `npm install`; modification leaves no audit trail. Also breaks `npm ci --immutable` semantics.
  Fix direction: replace with `patch-package` (records canonical diffs in `patches/` directory, fails on drift); OR vendor the dependencies; OR file upstream PRs.

- **R-1999 — P1 — Plugin discovery loops the entire node_modules with `withFileTypes` recursion — DoS / race — `fix-capacitor-gradle.cjs:12-26,73-77`**
  Problem: `findGradleFiles` recurses into every plugin subdirectory; on a heavy install this walks tens of thousands of files holding the event loop. A malicious symlink in node_modules could cause infinite recursion (no symlink/realpath guard).
  Fix direction: depth-limit recursion; resolve symlinks; or `realpath` and dedup.

- **R-2000 — P1 — Blind AGP downgrade/upgrade to a single version constant — `fix-capacitor-gradle.cjs:106-110`**
  Problem: forces `com.android.tools.build:gradle:9.1.0` on every plugin without checking compatibility — a plugin that requires AGP 8.x is broken; APK silently builds with wrong AGP. Hardcoded `9.1.0` will rot in months.
  Fix direction: read AGP version from a single source-of-truth file (`android/build.gradle`) and mirror it.

- **R-2001 — P2 — `try { ... } catch (e) { /* skip unreadable dirs */ }` swallows ALL errors — `fix-capacitor-gradle.cjs:14-24`**
  Problem: any IO error (including permission denied on a Windows symlink junction) is silently dropped — script reports success while leaving gradle files unpatched.
  Fix direction: log the path that failed; fail-loud on unexpected error codes (EPERM, EACCES).

### `install-git-hooks.mjs`

- **R-2002 — P2 — Silently swallows `git config core.hooksPath` failure — `install-git-hooks.mjs:48-55`**
  Problem: if setting `core.hooksPath` fails (e.g., git config locked, read-only), warns and exits 0, leaving developers with NO pre-push protections — they think hooks installed, they didn't.
  Fix direction: exit non-zero so `npm install` fails loudly; document recovery.

- **R-2003 — P2 — Postinstall hook executes without integrity check — `install-git-hooks.mjs:1-55` (also package.json wiring)**
  Problem: anything in `.githooks/` runs on every developer's `git push`; if an attacker lands a PR that adds a malicious pre-push hook, every developer who pulls + `npm install`s gets pwned on next push.
  Fix direction: enumerate hooks at install time and require `CODEOWNERS` review for `.githooks/`; verify each hook against a SHA list committed in repo.

### `lint-guard.mjs`

- **R-2004 — P1 — Bypass via per-line comment `lint-guard-allow:<id>` with no audit — `lint-guard.mjs:189-190`**
  Problem: attacker who can edit any TS file can disable lint rules with one comment; no logging, no expiry. The marker can hide an SQL `Math.abs(timestamp)` Stripe-bypass forever.
  Fix direction: emit a count of allow-markers in the summary; require markers to include `// lint-guard-allow:<id> reason: <text> owner: <handle> expires: <date>`; CI fails when markers expire.

- **R-2005 — P2 — Hard-coded `--max-warnings 1100` ESLint ceiling (PRE_PUSH.md gate 6) — `lint-guard.mjs` (referenced) / `PRE_PUSH.md:24`**
  Problem: high ceiling allows ~1100 lint warnings to accumulate; new safety regressions can slip in under the cap. Per `lint-guard.mjs`, rules with `severity: warn` (e.g., SECDEF-without-revoke) are counted as warnings — so a security regression doesn't trigger CI fail.
  Fix direction: ratchet `--max-warnings` downward; promote security-critical rules from `warn` → `error`.

- **R-2006 — P2 — `walk()` excludes `supabase/migrations` only by default but rules ARE meant to scan migrations — `lint-guard.mjs:144-153,131-138`**
  Problem: walker excludes `android`, `ios`, `build`, `.expo`, etc., but the rule `no-secdef-without-grant-revoke` targets `supabase/migrations` — works only because that dir isn't in the exclusion list. A future maintainer adding `supabase` to exclude would silently disable SECDEF checking.
  Fix direction: invert: walk rule.paths explicitly instead of walking everything then filtering.

- **R-2007 — P3 — Rule `no-direct-companies-upsert` only blocks `.upsert(` — misses `.insert(...).upsert()` chains — `lint-guard.mjs:62-68`**
  Problem: a coder writing `.from('companies').insert(...)` (not upsert) bypasses W3-16 silently.
  Fix direction: block any write verb (`.insert|.upsert|.update`) on `companies`.

### `patch-google-auth.js`

- **R-2008 — P0 — Same supply-chain risk: silent node_modules mutation at postinstall — `patch-google-auth.js:1-13`**
  Problem: hard-coded patch to `@codetrix-studio/capacitor-google-auth/android/build.gradle` runs every `npm install`. If the package is updated and its gradle path changes, patch silently no-ops; integrity check missing.
  Fix direction: convert to `patch-package` diff; OR check existence + content hash BEFORE patching, fail loud on missing/changed.

- **R-2009 — P1 — No content fingerprint before/after patch — `patch-google-auth.js:7-12`**
  Problem: assumes contents contain `jcenter()` / `proguard-android.txt`; if upstream removes those strings, the patch quietly succeeds with no changes — gradle build still uses something else; nobody notices until APK build fails in CI.
  Fix direction: assert at least one replacement happened, exit non-zero otherwise.

- **R-2010 — P2 — Path resolution assumes `__dirname/../node_modules` — fails in monorepos / pnpm — `patch-google-auth.js:5`**
  Problem: hoisted/pnpm/workspace setups put the package elsewhere; silent no-op then.
  Fix direction: use `require.resolve('@codetrix-studio/capacitor-google-auth/package.json')`.

### `PRE_PUSH.md`

- **R-2011 — P2 — Doc says "Never" skip verify — but `deploy-edge-function.mjs --skip-verify` exists (see R-1992) — `PRE_PUSH.md:36-39`**
  Problem: contradictory: doc claims gate is always run; reality has bypass. Audit/onboarding lies to developers.
  Fix direction: either remove `--skip-verify` or document it AND require approval.

- **R-2012 — P3 — Doc references "verify-before-push.mjs" but is named `lint-guard.mjs` / verify gates not enumerated in scripts/ — `PRE_PUSH.md` whole file**
  Problem: scripts referenced (`npm run verify`, `verify-before-push.mjs`) are not visible in this batch — assumed to exist but no audit; if missing, ALL push helpers fail catastrophically on first run.
  Fix direction: include path to verify-before-push.mjs in doc; reference single canonical entry.

### `probe-push-delivery.ps1`

- **R-2013 — P0 — Interactive prompt asks operator to paste their session `access_token` and POSTs it to a probe endpoint — `probe-push-delivery.ps1:143-156`**
  Problem: PowerShell `Read-Host` does NOT use `-AsSecureString`; token shows in process memory, scroll-back, and potentially shell history. The probe is documented as live and triggers a real push.
  Fix direction: use `Read-Host -AsSecureString` + zero memory; OR generate a short-lived probe token via a dedicated edge function; never reuse user JWT.

- **R-2014 — P1 — Build & inject service-account JSON path via string interpolation into Node `-e` script (command injection) — `probe-push-delivery.ps1:98-114`**
  Problem: `$($saFile.FullName.Replace('\\','/'))` is splatted into a Node template literal; a filename containing a single-quote/newline breaks out (`'); console.log(process.env)//`).
  Fix direction: pass the path via `--` argv or env var, not template interpolation; or run a real `.mjs` file.

- **R-2015 — P1 — Glob pattern hard-codes specific service-account filename prefix — `probe-push-delivery.ps1:85`**
  Problem: `sosphere-809bb-firebase-adminsdk-fbsvc-*.json` is hard-coded; rotation of the Firebase project key (different prefix) means probe silently skips the crypto phase. Operator thinks all is well; FCM is broken.
  Fix direction: read filename from config (`$env:SOSPHERE_FCM_SA_PATH`); fail loud if path empty/missing.

- **R-2016 — P2 — `Invoke-RestMethod` to user-supplied projectRef with no validation — `probe-push-delivery.ps1:144,154`**
  Problem: `projectRef = Read-Host` then `https://$projectRef.supabase.co/...` — attacker-controlled subdomain DNS hijack could redirect probe to evil endpoint receiving the bearer token.
  Fix direction: validate `^[a-z]{20}$` (supabase project ref shape); or hardcode `rtfhkbskgrasamhjraul`.

- **R-2017 — P2 — `if ($fails.Count -gt 0) {...}` ternary syntax mistake — runtime error — `probe-push-delivery.ps1:179`**
  Problem: PowerShell does not parse `(if ($fails.Count -gt 0) { "Red" } else { "Green" })` as a usable expression for `-ForegroundColor`; emits parser error.
  Fix direction: assign to a variable first: `$fc = if (...) {'Red'} else {'Green'}; Write-Host ... -ForegroundColor $fc`.

### `push-ci-fixes.ps1`

- **R-2018 — P1 — `git push` without `--force-with-lease` / `--no-verify` — fine, BUT no upstream check — `push-ci-fixes.ps1:129`**
  Problem: bare `git push` will fail on diverging branches; helper recovers poorly (just prints error). Worse: PS variables `$LASTEXITCODE` after `git push` can be checked but no `git pull --rebase` is offered.
  Fix direction: pre-flight `git fetch && git status -sb` and abort if `behind`; suggest rebase.

- **R-2019 — P2 — Commit message is heredoc with hard-coded historical claims — `push-ci-fixes.ps1:85-116`**
  Problem: commit body claims "verify-before-push.mjs: ALL GATES PASS (this commit)" — but the heredoc is hard-coded — even if verify failed on a re-run, message still asserts ALL GATES PASS (it's never edited).
  Fix direction: compute message from current verify result at runtime.

- **R-2020 — P3 — Stages this script itself unconditionally if untracked — `push-ci-fixes.ps1:71-76`**
  Problem: helper scripts get committed alongside production changes; muddies history; can leak local notes/quirks into prod commits.
  Fix direction: keep helpers in a dedicated branch / opt-in.

### `push-day1-r48-r49-r50-r64.ps1`

- **R-2021 — P1 — Runs `npm install` inside push helper without lockfile freeze — `push-day1-r48-r49-r50-r64.ps1:63-70`**
  Problem: `npm install` (NOT `npm ci`) will update package-lock.json from registry — opens supply-chain window (dep replaced with malicious version since last commit). Push helper then commits the regenerated lockfile.
  Fix direction: use `npm ci` (refuses to touch lockfile) or commit dep change separately.

- **R-2022 — P2 — Heredoc commit message contains literal "Closes #R-48 #R-49 #R-50 #R-64" — irrelevant to GitHub — `push-day1...` (lines 102-142)**
  Problem: not really `Closes #` syntax for GitHub issues — these are not real issue numbers. False-positive: nothing auto-closes.
  Fix direction: clarify naming or use real issue refs.

- **R-2023 — P3 — Hard-coded expected-files list — every batch needs new helper; copy-paste rot — file-level**
  Problem: every push-rXX helper is a copy of the previous with file list updated; review burden + drift.
  Fix direction: single parameterized push-helper that reads file list from a manifest.

### `push-day2-r53-r54-r55.ps1`

- **R-2024 — P0 — Edge-function deploy without manifest pin refresh — `push-day2-r53-r54-r55.ps1:160-176`**
  Problem: after `git push`, helper runs `supabase functions deploy send-push-notification` but never refreshes `.deploy-manifest.json` — directly contradicts the design of `deploy-edge-function.mjs`. R-6 drift probe fires next CI; worse, the deploy bypasses the verify-then-deploy contract.
  Fix direction: call `scripts/deploy-edge-function.mjs send-push-notification --auto-commit` instead of raw `supabase functions deploy`.

- **R-2025 — P1 — Edge function deploy errors only "WARNING" — script reports success — `push-day2-r53-r54-r55.ps1:169-176`**
  Problem: if deploy fails, only warns; user thinks Day-2 push complete; live function still on old version; FCM live traffic broken silently.
  Fix direction: fail with non-zero exit; document recovery.

### `push-mobile-ux-batch.ps1`

- **R-2026 — P0 — `$ErrorActionPreference = "Continue"` — script proceeds past errors that should abort — `push-mobile-ux-batch.ps1:11`**
  Problem: comment says "don't abort on transient stderr" but the side-effect is that `git commit` / `git push` failures DO NOT halt execution as intended. Hidden silent failures push partial state.
  Fix direction: use `Stop` and explicitly suppress stderr only on the known-noisy commands.

- **R-2027 — P0 — `supabase db push` runs as part of helper without confirmation, applies migration directly to PROD — `push-mobile-ux-batch.ps1:136-150`**
  Problem: `supabase db push` invokes ALL pending migrations against the linked project (production by default). No `--dry-run`, no confirm, no test-project gate. Wrong migration → instant data loss / RLS bypass / triggers wired wrong on live data.
  Fix direction: require `SOSPHERE_DB_PUSH_CONFIRM=yes` env var + interactive confirm + show migration filenames before apply.

- **R-2028 — P1 — Migration push happens AFTER git push — non-atomic — `push-mobile-ux-batch.ps1:131-150`**
  Problem: git push succeeds, db push fails → schema drift; rollback git is hard once others rebased.
  Fix direction: db push BEFORE git push or use a deploy-pipeline tool.

### `push-r66-and-drift-fix.ps1`

- **R-2029 — P1 — Defaults `SUPABASE_PROJECT_REF = "rtfhkbskgrasamhjraul"` — production ref baked in — `push-r66-and-drift-fix.ps1:48`**
  Problem: env var auto-set to the live project ref if user forgot — silently runs against production with whatever token is present. A developer who left a different-project test token in env mixes test+prod traffic.
  Fix direction: never auto-default project ref; require explicit env var.

- **R-2030 — P2 — Drift manifest "refresh" makes whatever is live the new ground truth (closes audit window) — `push-r66-and-drift-fix.ps1:38-56`**
  Problem: helper unconditionally `--update-manifest`s, masking any drift that originated from outside the deploy pipeline (e.g., Studio UI hot-fix).
  Fix direction: `--check` first; if mismatch, refuse refresh without `--accept-live` flag.

### `push-r70-r71-r72.ps1`, `push-r73-r76.ps1`, `push-r77-r79.ps1`, `push-r80.ps1`, `push-r81.ps1`, `push-r82-r84.ps1`, `push-r82-r85.ps1`, `push-r86.ps1`

- **R-2031 — P0 — `$ErrorActionPreference = "Continue"` (same as R-2026) repeated in push-r70…r86 — `push-r70-r71-r72.ps1:8`, `push-r73-r76.ps1:4`, `push-r77-r79.ps1:4`, `push-r80.ps1:4`, `push-r82-r84.ps1:1`, `push-r82-r85.ps1:1`, `push-r86.ps1` (default)**
  Problem: same root cause: silent error suppression in CI-deploy-equivalent scripts.
  Fix direction: standardize on `$ErrorActionPreference = 'Stop'` across all push helpers.

- **R-2032 — P1 — `push-r82-r85.ps1` and `push-r82-r84.ps1` ship overlapping commit messages — risk of double-push duplicated work — files (full)**
  Problem: two helpers both claim to push R-82/R-83/R-84; running both creates duplicate commits or merge mess.
  Fix direction: delete the superseded helper; commit message in survivor references the consolidation.

- **R-2033 — P2 — push-r81.ps1 missing `$ErrorActionPreference` entirely — `push-r81.ps1:1-3`**
  Problem: PowerShell default behavior on errors is "Continue" — same risk as R-2031.
  Fix direction: add `$ErrorActionPreference = 'Stop'` at the top.

- **R-2034 — P2 — Every push helper executes `git push` with NO `--signed` / no GPG verification — file-level (all push-*.ps1)**
  Problem: deploy/push scripts produce unsigned commits — no cryptographic proof of author identity. For a LIFE-SAFETY platform with deploy access to live DB + edge functions, missing commit signing weakens attribution / non-repudiation.
  Fix direction: enforce signed commits (`git commit -S`); GH branch-protect "Require signed commits"; document Yubikey/GPG setup.

- **R-2035 — P2 — Commit message authored via temp file with `Remove-Item -Force -ErrorAction SilentlyContinue` — leaves temp file on disk if commit hangs — `push-mobile-ux-batch.ps1:120-127`, etc.**
  Problem: SilentlyContinue on cleanup; failure to delete leaves a `tmpNNNN` containing the message (with possibly sensitive metadata).
  Fix direction: clean up in a try/finally that throws on cleanup failure (above OK if not sensitive; explicit secure-erase if sensitive).

- **R-2036 — P3 — `git remote get-url origin | %{ ($_ -replace ...) -replace '\.git$', '' }` PowerShell-only — breaks if git remote uses SSH config aliases — push-day1, push-ci-fixes, push-r66, push-mobile-ux-batch**
  Problem: URL-derivation is fragile; pretty-prints a wrong "Watch CI" link.
  Fix direction: read remote via `git config remote.origin.url` and use a proper parser.

### `regenerate-assetlinks.mjs`

- **R-2037 — P0 — Plaintext keystore password injected into shell via execSync — command injection — `regenerate-assetlinks.mjs:57-60`**
  Problem: `props.storePassword` is interpolated directly into a shell command string (`-storepass "${props.storePassword}"`). If the password contains a double quote / backtick / `$()`, command breaks out OR fingerprint extraction silently produces wrong output that gets baked into assetlinks.json. The known password `Fz07506771765` is safe today, but rotation could include special chars.
  Fix direction: use `execFileSync(keytoolPath, ['-list','-v','-keystore',KEYSTORE,'-storepass',props.storePassword,'-alias',props.keyAlias])` — no shell.

- **R-2038 — P1 — Password leaks into child-process command line (visible via `ps -ef` / Windows `Get-Process -IncludeUserName`) — `regenerate-assetlinks.mjs:57-60`**
  Problem: `keytool -storepass <PLAINTEXT>` exposes secret to any local process inspector during the few hundred ms keytool runs. Standard Java mitigation: `-storepass:env` reading from env var.
  Fix direction: `keytool -storepass:env STORE_PASS -keypass:env KEY_PASS` with env vars set on the child.

- **R-2039 — P2 — keystore.properties parser blindly splits on `=` and trims — accepts malformed input — `regenerate-assetlinks.mjs:46-51`**
  Problem: a line `storePassword=foo=bar` becomes `["storePassword","foo","bar"]` → only `["storePassword","foo"]` after `.map([0],[1])` — silently truncated. Worse, blank lines or comments aren't fully handled (filter only checks `.startsWith("#")`).
  Fix direction: split on first `=` only: `const i = l.indexOf('='); const k = l.slice(0,i); const v = l.slice(i+1);`.

- **R-2040 — P2 — No verification that keystore SHA matches Google Play upload key — `regenerate-assetlinks.mjs:66-83`**
  Problem: if developer regenerated keystore locally (instead of using the Play-managed signing key), the assetlinks.json gets the WRONG SHA-256 → App Links autoVerify fails → deep-link / SOS link routing broken.
  Fix direction: cross-check against expected Play-signed SHA stored in repo (e.g., a `expected-play-sha256.txt`).

### `release-signing.ps1` and `release-signing.sh`

- **R-2041 — P0 — `keytool ... -storepass $KS_PASS` — same plaintext-on-command-line leak as R-2038 — `release-signing.ps1:92-102`, `release-signing.sh:99-109`**
  Problem: Newly created keystore password ends up in process listings.
  Fix direction: use `-storepass:env` / `-storepass:file`.

- **R-2042 — P0 — Generated `keystore.properties` written with no ACL hardening on Windows — `release-signing.ps1:113-122`**
  Problem: bash version chmods 600 (line 123). PowerShell version uses `Set-Content` with default ACLs — readable by any local user in the same group or with `READ` ACE.
  Fix direction: after write, `icacls $propsPath /inheritance:r /grant:r "$($env:USERNAME):F"`.

- **R-2043 — P1 — Password-confirmation loop has no maximum length / no complexity check — `release-signing.ps1:65-68`, `release-signing.sh:73-80`**
  Problem: only `Length >= 8`; "12345678" passes. Once compromised, app updates can't be issued.
  Fix direction: enforce 16+ chars and at least 3 of {upper,lower,digit,symbol} OR mandate password manager generation.

- **R-2044 — P1 — Secure-string conversion uses `PtrToStringAuto` which leaves password in managed heap — `release-signing.ps1:56-59`**
  Problem: secret material is exposed as PowerShell `String` for the rest of the script; not zero-ed; survives in memory across keytool call and file write.
  Fix direction: keep `SecureString` and use it via `-StreamArg` to `keytool` via stdin / temp file with secure delete.

- **R-2045 — P2 — Bash `chmod 600 ... || true` — silently continues if chmod fails — `release-signing.sh:123`**
  Problem: filesystem doesn't support chmod (Windows-mounted, FAT) → no error → file world-readable.
  Fix direction: fail-loud if chmod fails on non-Windows.

- **R-2046 — P3 — Default cert defaults (Riyadh / SOSphere / SA) embedded in script — `release-signing.ps1:71-77`, `release-signing.sh:83-89`**
  Problem: hard-coded jurisdiction may be wrong for some forks; cosmetic, but persists into APK metadata.
  Fix direction: make required.

### `run-stripe-e2e-probe.ps1`

- **R-2047 — P1 — `PROBE_SECRET` prompted via `Microsoft.VisualBasic.Interaction.InputBox` — visible WinForms popup, text echoed (not masked) — `run-stripe-e2e-probe.ps1:9-14`**
  Problem: secret typed in cleartext into a visible dialog; can be captured via screen recorder / shoulder-surf; stored in PowerShell variable for the rest of the run.
  Fix direction: use `Read-Host -AsSecureString` or read from env / secure-file path.

- **R-2048 — P2 — `Invoke-WebRequest` to hard-coded production URL with bearer secret — no TLS pin — `run-stripe-e2e-probe.ps1:28-34`**
  Problem: PowerShell honors system trust store; corporate MITM proxy would intercept the secret.
  Fix direction: optionally pin to known cert thumbprint via `-CertificateThumbprint` (or document risk).

- **R-2049 — P3 — Secret trimmed silently — typo with trailing space accepted — `run-stripe-e2e-probe.ps1:21`**
  Problem: minor — could mask wrong-secret diagnostics.
  Fix direction: warn when whitespace stripped.

### `stripe-setup-helper.ps1`

- **R-2050 — P0 — Stripe **secret key** (`sk_test_...`) prompted via plain InputBox + passed on command line — `stripe-setup-helper.ps1:6-36`**
  Problem: Key is splatted on the command line: `node scripts/stripe-test-setup.mjs $key`. On Windows the full cmdline is visible to any local process via `Get-WmiObject Win32_Process` / `tasklist /v` for the duration of `node` execution. Also stored in PowerShell history.
  Fix direction: pass via `$env:STRIPE_SECRET_KEY` for the child only; `Read-Host -AsSecureString`; never command-line.

- **R-2051 — P1 — No assertion that script is being run with the TEST key (sk_test_), just enforces prefix — `stripe-setup-helper.ps1:25-30`**
  Problem: regex enforces `sk_test_` prefix. Strong enough — but `stripe-test-setup.mjs` itself only checks the same prefix. A pasted `rk_test_` (restricted-key) or other Stripe key shape would fail; ok. However the *.mjs script then creates products in whichever Stripe account the test key controls — no guard the account is the SOSphere test account.
  Fix direction: after auth, GET `/v1/account` and require `account.id == acct_SOSPHERE_TEST_<expected>`.

### `stripe-test-setup.mjs`

- **R-2052 — P0 — Stripe key supplied as positional CLI arg — same cmdline leak as R-2050 — `stripe-test-setup.mjs:10-13`**
  Problem: documented usage: `node scripts/stripe-test-setup.mjs sk_test_xxxxx`. Same exposure to `ps aux` / `tasklist`.
  Fix direction: read from env-only; reject positional arg.

- **R-2053 — P1 — Token splatted into final command-line printed to stdout — `stripe-test-setup.mjs:150-153`**
  Problem: prints `npx supabase secrets set KEY1=val1 KEY2=val2 ...` for operator to paste. These are NEW price IDs (not secrets), but the OUTPUT pattern teaches operators it's OK to paste secrets via CLI args (same pattern would expose `STRIPE_SECRET_KEY` if a future change includes it).
  Fix direction: write to a file; or print as env-format export; recommend `supabase secrets set --env-file`.

- **R-2054 — P1 — Output file `stripe-test-setup-<ts>.txt` written to cwd, "gitignored by default" — no enforcement — `stripe-test-setup.mjs:156-161`**
  Problem: comment claims gitignored by default; not all forks have it gitignored. File contains all price IDs (low sensitivity) but precedent for future scripts saving secrets.
  Fix direction: write to `~/.sosphere-secrets/` instead of cwd; assert path is gitignored.

- **R-2055 — P2 — `stripeGet('/products?limit=100&active=true')` only fetches first 100 products — no pagination — `stripe-test-setup.mjs:78-83`**
  Problem: in a long-lived test account, existing product with same plan_id may be on page 2 → duplicate created.
  Fix direction: paginate via `starting_after`.

- **R-2056 — P2 — Asserts `STRIPE_KEY.startsWith("sk_test_")` AFTER first read but before any sanity round-trip with `/v1/account` — `stripe-test-setup.mjs:25-29`**
  Problem: a stolen sk_test_ from another Stripe account would pass; sets up wrong account silently.
  Fix direction: round-trip /v1/account, log the account ID, require operator OK.

- **R-2057 — P3 — Hardcoded project ref `rtfhkbskgrasamhjraul` in the final printed `npx supabase secrets set ... --project-ref rtfhkbskgrasamhjraul` — `stripe-test-setup.mjs:152`**
  Problem: forks / clones run with same ref → write into wrong project (or fail).
  Fix direction: read from env, fail loud if unset.

### `test-a12-chat-broadcast-forgery.mjs`

- **R-2058 — P1 — Test mirrors trigger logic in JS — drift between JS and SQL silently passes — `test-a12-chat-broadcast-forgery.mjs:35-55`**
  Problem: `canonicalizeSender()` is a JS reimplementation of the SQL trigger. Tests pass even if SQL trigger has DIFFERENT behavior in production. This is a green light without real coverage.
  Fix direction: run integration test against a live Postgres / supabase dev instance, NOT a JS mirror.

- **R-2059 — P2 — `RESERVED_NAMES` set in JS may diverge from SQL — only S8 regression weakly checks via regex — `test-a12-chat-broadcast-forgery.mjs:29-33,198-200`**
  Problem: S8.7 only greps for two strings in migration; a missed reserved name (e.g., `Authority`) silently slips through SQL while JS test reports OK.
  Fix direction: extract reserved-names list from SQL trigger source at test-time.

- **R-2060 — P3 — Linear-congruential RNG with deterministic seed — chaos test is the same 100 cases every run — `test-a12-chat-broadcast-forgery.mjs:213-218`**
  Problem: not random — same 100 cases; coverage is illusory.
  Fix direction: include `Date.now()` as seed offset or rotate seeds.

### `build-and-install.bat`

- **R-2061 — P1 — `git pull origin main` runs unconditionally without sign-off check or status check — `build-and-install.bat:12-16`**
  Problem: pulls latest main into developer's local working tree on every build; if developer has local uncommitted changes that conflict, build proceeds with warning ("continuing with local code") → outcome may be a partial-merge tree; resulting APK is an untracked Frankenstein.
  Fix direction: `git status -s` first; require clean tree OR explicit `--allow-dirty` flag.

- **R-2062 — P1 — `git pull` failure produces ONLY a "WARN" message — script continues to build — `build-and-install.bat:13-16`**
  Problem: developer may be offline / authentication fail → builds STALE main. APK shipped to phone is older than HEAD. Bug fix appears not present.
  Fix direction: prompt to abort or proceed.

- **R-2063 — P2 — `if not exist node_modules ( npm install )` — never refreshes deps when package.json changes — `build-and-install.bat:18-22`**
  Problem: a colleague updated package.json with a security fix, you pulled, but node_modules exists → npm install is skipped → vulnerable deps still resolved.
  Fix direction: check lockfile mtime vs node_modules mtime, or always `npm ci`.

- **R-2064 — P2 — Builds DEBUG APK and prompts adb install — debug build can be installed over a release-signed APK on test devices and confuse R-53 push-token path — `build-and-install.bat:35-40,62-68`**
  Problem: debug-signed APK is functionally distinct from release-signed (FCM token, app-links autoVerify), but the helper looks "production-grade" — operator may believe they're testing release behavior.
  Fix direction: separate `build-and-install-debug.bat` vs `build-and-install-release.bat`; label loud.

- **R-2065 — P3 — `setlocal enabledelayedexpansion` enabled but never used — `build-and-install.bat:2`**
  Problem: cosmetic.

### `sosphere-fix-and-test.ps1`

- **R-2066 — P0 — Hard-coded device serial `UCEUKRY9RCYDE6TC` and hard-coded app-package `com.sosphere.app` — `sosphere-fix-and-test.ps1:43,108,178-179`**
  Problem: developer-specific test device is hardcoded; running on another machine still ends up addressing same serial; if that serial happens to match another developer's device on the same adb daemon, commands hit WRONG device. `am force-stop`, `monkey -p ... LAUNCHER 1` exec on the wrong package would still be benign — but pulling leveldb from another package fails silently.
  Fix direction: require `-Device` to be supplied; abort if not set.

- **R-2067 — P0 — `supabase functions deploy sos-alert` runs without verify-before-push, without manifest update, without commit hash linkage — `sosphere-fix-and-test.ps1:140-151`**
  Problem: ANY local edit to `supabase/functions/sos-alert/index.ts` ships directly to production; no git commit required; no drift-manifest refresh. Catastrophic if dev was experimenting with a malicious or broken local change.
  Fix direction: deploy only from clean working-tree HEAD via `deploy-edge-function.mjs`; require commit SHA recorded.

- **R-2068 — P1 — `run-as com.sosphere.app cat ... | base64 -w0` pulled into PowerShell, decoded → can write file with attacker-controlled name — `sosphere-fix-and-test.ps1:230-240`**
  Problem: `$f` is a filename read from `adb shell ls`; if package were compromised to create file named `..\..\..\anything.ps1`, `Join-Path $snapshotDir $safe` would write outside snapshot dir (path traversal).
  Fix direction: sanitize `$safe` against `[a-zA-Z0-9._-]+` only.

- **R-2069 — P1 — `adb -s $Device shell "run-as com.sosphere.app ..."` interpolates $Device verbatim into shell-quoted string — command-injection — `sosphere-fix-and-test.ps1:230-235`**
  Problem: `$Device` is a user-supplied parameter; if `$Device = "X' ; rm -rf /sdcard ; echo '"`, the shell on the device executes `rm -rf /sdcard`.
  Fix direction: validate `$Device` against `^[A-Z0-9]+$`; use argv form, not string-shell.

- **R-2070 — P2 — `npx cap run android --target $Device` likewise interpolates $Device — `sosphere-fix-and-test.ps1:171-173`**
  Problem: same shape; npx passes $Device through to Gradle/adb; injection vector.
  Fix direction: same validation.

- **R-2071 — P2 — Pulls APK and inspects leveldb without authentication — `sosphere-fix-and-test.ps1:200-241`**
  Problem: leveldb may contain user PII / session data; helper writes it to `.sosphere-debug/` on disk in plaintext; no purge mechanism.
  Fix direction: warn; require `--allow-pii`; secure-delete after analysis.

- **R-2072 — P2 — `Remove-Item -Recurse -Force $snapshotDir` without confirming path — `sosphere-fix-and-test.ps1:192`**
  Problem: if `$projectRoot` resolution fails earlier (e.g. running from C:\\), `$snapshotDir = "C:\\\.sosphere-debug"` → still safe — but no abort if `$projectRoot` not actually the platform root.
  Fix direction: assert package.json/`capacitor.config.*` resolution succeeded before any destructive op.

- **R-2073 — P3 — `& adb -s $Device logcat -c` then unlimited tail — script hangs forever waiting for user Ctrl-C — `sosphere-fix-and-test.ps1:277-283`**
  Problem: cosmetic — but in CI pipelines this would hang the runner.
  Fix direction: timeout via `-T <seconds>`.

---

## Cross-cutting findings

- **R-2074 — P0 — No push helper enforces `git commit -S` / `--signed` — none of 13 push-*.ps1 files**
  Problem: all production-bound commits are unsigned. Audit-trail / non-repudiation broken for a LIFE-SAFETY platform.
  Fix direction: GH "Require signed commits" branch protection + helper enforces `git commit -S`.

- **R-2075 — P0 — Multiple scripts trust env vars for production credentials with no provenance / no scope check — global pattern**
  Problem: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `STRIPE_SECRET_KEY`, `FCM_SERVICE_ACCOUNT_JSON`, `PROBE_SECRET` all read from env with no validation that the binding matches an expected fingerprint.
  Fix direction: each script asserts token shape (prefix), scope (test vs live), and target account/project ref before any destructive call.

- **R-2076 — P1 — Postinstall scripts (`fix-capacitor-gradle.cjs`, `patch-google-auth.js`, `install-git-hooks.mjs`) run on every developer's `npm install` — supply-chain attack surface**
  Problem: any of these scripts (or any new sibling) could be modified by an attacker via a malicious PR and silently execute in every dev's shell. No code-owner gate documented in audit scope.
  Fix direction: CODEOWNERS on `scripts/**`; postinstall checksum manifest validated before run.

- **R-2077 — P1 — None of the scripts have `set -euo pipefail` equivalent enforcement uniformly; only `release-signing.sh` does — pattern**
  Problem: bash scripts (push helpers are mostly PS; bash `release-signing.sh` is correct). PowerShell scripts inconsistent on `$ErrorActionPreference`.
  Fix direction: lint rule for `.ps1` files requires `$ErrorActionPreference = 'Stop'` at top.

- **R-2078 — P2 — Push helpers stage themselves on first run (`push-day1-...`, `push-r66-...`, etc.) — git history pollution + privilege creep**
  Problem: each helper auto-adds itself if untracked; eventually the deploy machinery is committed to repo without code review.
  Fix direction: helpers excluded from auto-stage; reviewed separately.

- **R-2079 — P2 — No test/live separation of Stripe keys in helper scripts — pattern across stripe-*.ps1 / .mjs**
  Problem: helpers gate on `sk_test_` prefix only; no separate `_PROD` variants; no enforcement that a `sk_live_` key, if accidentally exported, can NEVER be used by setup scripts.
  Fix direction: env var split: `STRIPE_TEST_KEY` vs `STRIPE_LIVE_KEY`; scripts only ever read TEST variant.

- **R-2080 — P3 — None of the scripts log a structured audit trail (who, what, when) of destructive ops — pattern**
  Problem: deploys, db pushes, keystore regenerations all happen with no central audit log. Post-incident triage needs to reconstruct from shell history.
  Fix direction: every destructive helper appends a JSON line to `.sosphere-audit.log` (timestamp, user, host, action, target).

---

## Totals

- **Total findings: 100** (R-1981 → R-2080)
- **P0: 17**
- **P1: 28**
- **P2: 36**
- **P3: 19**

---

## TOP 5 P0 tickets (verbatim)

1. **R-1992 — P0 — Bypass Control — `deploy-edge-function.mjs:65-80`**
   Problem: `--skip-verify` flag bypasses migration drift, ESLint, vitest before pushing live SOS-dispatch edge function code.
   Fix direction: gate `--skip-verify` on a separate `SOSPHERE_ALLOW_SKIP_VERIFY=yes` env flag plus interactive `read y/N`; audit-log every use.

2. **R-1998 — P0 — Supply-Chain — `fix-capacitor-gradle.cjs:86-117`**
   Problem: postinstall script silently mutates node_modules contents of any package matching "capacitor" in its name; an attacker that publishes `@evil/capacitor-spy` gets its gradle silently rewritten on every `npm install`; modification leaves no audit trail.
   Fix direction: replace with `patch-package` (records canonical diffs, fails on drift); OR vendor dependencies; OR upstream PRs.

3. **R-2008 — P0 — Supply-Chain — `patch-google-auth.js:1-13`**
   Problem: Same risk — hard-coded patch to a 3rd-party package's `build.gradle` runs every `npm install` with no integrity check; if upstream changes, patch silently no-ops with no failure.
   Fix direction: convert to `patch-package` with diff verification; OR assert at least one replacement happened and exit non-zero otherwise.

4. **R-2013 — P0 — Credential Exposure — `probe-push-delivery.ps1:143-156`**
   Problem: interactive prompt asks operator to paste their live session access_token and POSTs it to a probe endpoint; `Read-Host` does NOT use `-AsSecureString`, so token shows in process memory, scroll-back, and potentially shell history.
   Fix direction: use `Read-Host -AsSecureString` + zero memory; OR generate a short-lived probe token via a dedicated edge function; never reuse user JWT.

5. **R-2027 — P0 — Production Migration Without Confirmation — `push-mobile-ux-batch.ps1:136-150`**
   Problem: `supabase db push` runs as part of helper without confirmation, applies migration directly to PROD; no `--dry-run`, no test-project gate. Wrong migration → instant data loss / RLS bypass on live data.
   Fix direction: require `SOSPHERE_DB_PUSH_CONFIRM=yes` env var + interactive confirm + show migration filenames before apply.

Additional ties for top P0s worth surfacing (R-2024 deploy-without-manifest-pin, R-2026/R-2031 ErrorActionPreference=Continue, R-2037 command-injection via keystore password, R-2041/R-2042 plaintext keystore password leak, R-2050/R-2052 Stripe sk_test_ key on command-line, R-2066/R-2067 sosphere-fix-and-test.ps1 hardcoded device + un-vetted edge-fn deploy, R-2074 unsigned commits, R-2075 token-provenance pattern).
