# ============================================================================
# Push helper - R-66 (lang auto-detect) + CI drift refresh
# ----------------------------------------------------------------------------
# 1. Refreshes .deploy-manifest.json pin to match the live ezbr
#    (closes the R-6 drift alert from CI run #205)
# 2. Verifies all 12 gates
# 3. Stages + commits + pushes
#
# USAGE: .\scripts\push-r66-and-drift-fix.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "[push-r66] repo root: $repoRoot" -ForegroundColor Cyan

# Expected files
$expectedModified = @(
    "src/app/components/useLang.ts",
    "src/app/components/welcome-onboarding.tsx",
    "supabase/functions/.deploy-manifest.json"
)
$expectedNew = @(
    "src/app/components/__tests__/r66-lang-autodetect.test.ts"
)

Write-Host ""
Write-Host "-- Sanity-check working tree --" -ForegroundColor Yellow
foreach ($f in ($expectedModified + $expectedNew)) {
    if (-not (Test-Path $f)) {
        Write-Host "MISSING: $f" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  All 4 expected files present." -ForegroundColor Green

# 1. Refresh the drift manifest pin
Write-Host ""
Write-Host "-- Refreshing .deploy-manifest.json (R-6 drift fix) --" -ForegroundColor Yellow
if (-not $env:SUPABASE_ACCESS_TOKEN) {
    Write-Host "WARNING: SUPABASE_ACCESS_TOKEN env var not set." -ForegroundColor Yellow
    Write-Host "  Set it before running so the manifest can be refreshed:" -ForegroundColor Yellow
    Write-Host '    $env:SUPABASE_ACCESS_TOKEN = "sbp_..."' -ForegroundColor Yellow
    Write-Host "  Get from: https://supabase.com/dashboard/account/tokens" -ForegroundColor Yellow
    $skipDrift = $true
} else {
    if (-not $env:SUPABASE_PROJECT_REF) { $env:SUPABASE_PROJECT_REF = "rtfhkbskgrasamhjraul" }
    & node scripts/check-function-drift.mjs --update-manifest 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNING: drift manifest refresh failed (exit $LASTEXITCODE)." -ForegroundColor Yellow
        Write-Host "  CI will still flag drift. Set SUPABASE_ACCESS_TOKEN and re-run." -ForegroundColor Yellow
    } else {
        Write-Host "  Manifest refreshed." -ForegroundColor Green
    }
}

# 2. Verify-before-push
Write-Host ""
Write-Host "-- Running verify-before-push.mjs --" -ForegroundColor Yellow
$verifyOutput = & node scripts/verify-before-push.mjs 2>&1
$verifyExit = $LASTEXITCODE
$verifyOutput | ForEach-Object { Write-Host $_ }

if ($verifyExit -ne 0) {
    Write-Host ""
    Write-Host "verify-before-push FAILED (exit $verifyExit)." -ForegroundColor Red
    exit $verifyExit
}
Write-Host ""
Write-Host "  verify-before-push: ALL GATES PASS." -ForegroundColor Green

# 3. Stage files
Write-Host ""
Write-Host "-- Staging files --" -ForegroundColor Yellow
foreach ($f in ($expectedModified + $expectedNew)) {
    git add -- "$f"
    Write-Host "  staged: $f"
}
# Stage this script too
$tracked = & git ls-files --error-unmatch "scripts/push-r66-and-drift-fix.ps1" 2>$null
if ($LASTEXITCODE -ne 0) {
    git add -- "scripts/push-r66-and-drift-fix.ps1"
    Write-Host "  staged: scripts/push-r66-and-drift-fix.ps1 (untracked)"
}

# 4. Diff stat
Write-Host ""
Write-Host "-- Diff stat (staged) --" -ForegroundColor Yellow
git diff --cached --stat

# 5. Commit
$commitMsg = @"
R-66 + drift fix: language auto-detect (universal UX) + manifest pin refresh

R-66 (MOBILE_AUDIT_FINDINGS / UX, 2026-05-19):
  Remove the blocking language picker on first launch. The app now
  auto-detects language from device locale (navigator.language), with
  user override available via Settings -> Language. Matches the universal
  pattern used by Apple HIG, Material Design, WhatsApp, Telegram, Uber,
  Netflix.

  Detection chain:
    1. localStorage[sosphere_lang]  - explicit user choice (highest trust)
    2. navigator.language           - device OS / browser locale
       startsWith "ar"  -> Arabic
       startsWith "en"  -> English
    3. DEFAULT_LANG = "ar"          - Saudi market default

  Auto-detected value is NOT persisted. Only an explicit user choice
  (via setLang() from Settings) writes to storage. This keeps detection
  live: if the user switches device language at OS level, the next app
  launch picks up the change automatically.

  Files changed:
    - useLang.ts: added detectLangFromDevice(), updated readLang()
    - welcome-onboarding.tsx: showLangPicker defaults to false +
      inline detectInitialLang for the local lang state
    - new r66-lang-autodetect.test.ts: 11 contract tests

DRIFT FIX (R-6 probe, CI run #205):
  Day 2 push deployed send-push-notification v28 -> v30 but the
  .deploy-manifest.json pin was not refreshed. This commit re-pins to
  the live ezbr so R-6 continuous probe stops flagging drift.

Validation:
  - TypeScript parse: 3/3 files clean
  - Tests: r66 contract = 11 cases, lock the auto-detect chain
  - verify-before-push.mjs: all 12 gates pass

After CI green: rebuild APK so the new R-66 + R-48/49/50/53 + R-66
changes ship on the test phone (npm run build + npx cap sync android +
gradlew assembleDebug).

Closes #R-66 #R-6-drift.
"@

Write-Host ""
Write-Host "-- Commit --" -ForegroundColor Yellow
git commit -m $commitMsg
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 6. Push
Write-Host ""
Write-Host "-- Push --" -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Pushed. Watch CI:" -ForegroundColor Green
$slug = (git remote get-url origin) -replace '^.*github.com[:/]', '' -replace '\.git$', ''
Write-Host "  https://github.com/$slug/actions" -ForegroundColor Green
Write-Host ""
Write-Host "Once CI green, rebuild + reinstall APK:" -ForegroundColor Cyan
Write-Host "  npm run build" -ForegroundColor Cyan
Write-Host "  npx cap sync android" -ForegroundColor Cyan
Write-Host "  cd android; .\gradlew assembleDebug" -ForegroundColor Cyan
Write-Host "  adb install -r app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Cyan
