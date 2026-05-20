# ============================================================================
# Push helper - R-67 + R-68 + R-69 (mobile UX fixes from real-device testing)
# ----------------------------------------------------------------------------
# 1. Verifies all 12 gates
# 2. Stages + commits + pushes
# 3. Applies the R-68 age-verify-bypass migration to Supabase
#
# USAGE: .\scripts\push-mobile-ux-batch.ps1
# ============================================================================

$ErrorActionPreference = "Continue"  # don't abort on transient stderr

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "[push-ux] repo root: $repoRoot" -ForegroundColor Cyan

$expectedModified = @(
    "src/app/components/login-phone.tsx",
    "src/app/components/individual-register.tsx",
    "supabase/migrations.lock.json",
    "vite.config.ts"
)
$expectedNew = @(
    "supabase/migrations/20260519100000_r68_age_verify_bypass.sql"
)

Write-Host ""
Write-Host "-- Sanity-check working tree --" -ForegroundColor Yellow
foreach ($f in ($expectedModified + $expectedNew)) {
    if (-not (Test-Path $f)) {
        Write-Host "MISSING: $f" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  All 5 expected files present." -ForegroundColor Green

# 1. Verify-before-push
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
Write-Host "  verify-before-push: ALL GATES PASS." -ForegroundColor Green

# 2. Stage files
Write-Host ""
Write-Host "-- Staging --" -ForegroundColor Yellow
foreach ($f in ($expectedModified + $expectedNew)) {
    git add -- "$f"
    Write-Host "  staged: $f"
}
# Stage this script too if untracked
git add -- "scripts/push-mobile-ux-batch.ps1" 2>$null

Write-Host ""
Write-Host "-- Diff stat (staged) --" -ForegroundColor Yellow
git diff --cached --stat

# 3. Commit
$commitMsg = @"
mobile-ux batch: R-67 + R-68 + R-69 (Iraqi user test feedback)

R-67: auto-detect country dial code in login-phone
  - Previously hardcoded SA, forcing every non-Saudi user to scroll
    200+ countries on first signup. Now reads navigator.language region
    (ar-IQ -> IQ, en-US -> US, etc.) and seeds the picker with the
    matching country. SA stays the fallback when locale is unknown.
  - Storage override (sosphere_country_code from R-49) still wins.

R-68: birth date screen - calendar picker + W3-37 bypass + digit fix
  - Calendar icon at top was decorative; now a real button that
    .showPicker() on the underlying input -> opens OS-native calendar.
  - Replaced 3 separate <input type="number"> boxes (which caused
    Arabic-Indic vs Western digit mixing and "which box is day/month/year?"
    RTL confusion) with a single <input type="date">. Single source of
    truth, OS-native UI on Android (Material) and iOS (wheel), no digit
    encoding issues. We still derive dobYear/Month/Day so the existing
    handleDobSubmit + verify_user_age RPC contract stays untouched.
  - NEW migration 20260519100000_r68_age_verify_bypass.sql: the W3-37
    trigger blocked verify_user_age from writing age_verified_at /
    age_category / parental_consent_at. Added app.allow_age_update
    bypass flag (same pattern as the existing role/membership bypasses).
    verify_user_age now sets the flag before its UPDATEs, then the
    trigger no-ops for that statement only. Other paths still hit the
    W3-37 exception - compliance posture preserved.

R-69: bundle splitting improvements (vite manualChunks)
  - vendor-icons (lucide-react alone) split from vendor-ui
  - vendor-sonner separated
  - vendor-capacitor groups the 9 @capacitor/* plugins so a single
    plugin upgrade does not bust the whole vendor cache
  - Cleaner cache invalidation across deploys

Real-device test report (2026-05-19, Iraqi Android user):
  v Language picker no longer blocks first launch (R-66 confirmed)
  x Country picker started on SA, not IQ                    -> R-67
  x OTP not delivered                                        -> Twilio billing (not code)
  x Google auth slow without is-this-you prompt                    -> Google security UI, not us
  x Calendar icon decorative, did not open picker             -> R-68
  x Mixed Arabic-Indic + Western digits in inputs            -> R-68
  x W3-37 'changing age fields' error on submit              -> R-68 migration
  x App navigation felt heavy                                -> R-69 (modest)

Validation:
  - TypeScript parse: 4/4 files clean
  - verify-before-push.mjs: all 12 gates pass

After CI green and APK rebuild, the user retests the full signup flow.

Closes #R-67 #R-68 #R-69.
"@
# Write commit message to temp file - git commit -F handles multi-line
# content with apostrophes / quotes / special chars without PowerShell
# argument-quoting issues that broke `git commit -m` on the first run.
$tmpMsgFile = [System.IO.Path]::GetTempFileName()
try {
    Set-Content -Path $tmpMsgFile -Value $commitMsg -Encoding UTF8
    git commit -F $tmpMsgFile
    if ($LASTEXITCODE -ne 0) { Write-Host "git commit failed."; exit $LASTEXITCODE }
} finally {
    Remove-Item -Path $tmpMsgFile -Force -ErrorAction SilentlyContinue
}

# 4. Push
Write-Host ""
Write-Host "-- Push --" -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) { Write-Host "git push failed."; exit $LASTEXITCODE }

# 5. Apply R-68 migration to Supabase (so the W3-37 bypass takes effect)
Write-Host ""
Write-Host "-- Applying R-68 migration to Supabase --" -ForegroundColor Yellow
$supabaseCmd = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabaseCmd) {
    Write-Host "WARNING: supabase CLI not on PATH. Apply manually:" -ForegroundColor Yellow
    Write-Host "  supabase db push" -ForegroundColor Yellow
} else {
    & supabase db push 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNING: supabase db push failed. Apply manually from Studio." -ForegroundColor Yellow
        Write-Host "  Migration file: supabase/migrations/20260519100000_r68_age_verify_bypass.sql" -ForegroundColor Yellow
    } else {
        Write-Host "  Migration applied OK." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Pushed. Watch CI:" -ForegroundColor Green
$slug = (git remote get-url origin) -replace '^.*github.com[:/]', '' -replace '\.git$', ''
Write-Host "  https://github.com/$slug/actions" -ForegroundColor Green
Write-Host ""
Write-Host "Once CI green, rebuild + reinstall APK:" -ForegroundColor Cyan
Write-Host "  npm run build" -ForegroundColor Cyan
Write-Host "  npx cap sync android" -ForegroundColor Cyan
Write-Host "  cd android; .\gradlew assembleDebug; cd .." -ForegroundColor Cyan
Write-Host "  adb install -r android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Cyan
Write-Host ""
Write-Host "Then on the phone retest:" -ForegroundColor Cyan
Write-Host "  1. Clear app data (Settings -> Apps -> SOSphere -> Storage -> Clear data)" -ForegroundColor Cyan
Write-Host "  2. Open app -> country picker should default to IQ (Iraq) for ar-IQ device" -ForegroundColor Cyan
Write-Host "  3. Sign in with email+password (Twilio still unfunded)" -ForegroundColor Cyan
Write-Host "  4. On birth-date screen: tap the calendar icon -> native picker opens" -ForegroundColor Cyan
Write-Host "  5. Pick a date -> W3-37 error should NOT appear; metabaa (continue) works" -ForegroundColor Cyan
