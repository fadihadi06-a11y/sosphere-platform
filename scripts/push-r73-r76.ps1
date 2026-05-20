# ============================================================================
# Push helper - R-73 + R-74 + R-75 + R-76 (real-device feedback batch 2)
# ============================================================================
$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "[push-uxfix2] repo root: $repoRoot" -ForegroundColor Cyan

$expectedModified = @(
    "src/app/components/emergency-contacts.tsx",
    "src/app/components/family-circle.tsx",
    "src/app/components/individual-layout.tsx",
    "src/app/components/mobile-app.tsx"
)

Write-Host ""
Write-Host "-- Sanity-check --" -ForegroundColor Yellow
foreach ($f in $expectedModified) {
    if (-not (Test-Path $f)) { Write-Host "MISSING: $f" -ForegroundColor Red; exit 1 }
}
Write-Host "  All 4 expected files present." -ForegroundColor Green

Write-Host ""
Write-Host "-- verify-before-push --" -ForegroundColor Yellow
& node scripts/verify-before-push.mjs 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Write-Host "verify failed."; exit $LASTEXITCODE }

Write-Host ""
Write-Host "-- Staging --" -ForegroundColor Yellow
foreach ($f in $expectedModified) { git add -- "$f"; Write-Host "  staged: $f" }
git add -- "scripts/push-r73-r76.ps1" 2>$null

Write-Host ""
Write-Host "-- Diff stat --" -ForegroundColor Yellow
git diff --cached --stat

$commitMsg = @"
ux-batch-2: R-73 + R-74 + R-75 + R-76 (real-device Iraqi-user feedback)

R-73: re-login forces full onboarding loop
  Before: completeLogout wipes localStorage so the next Gmail login
  sees empty consent + profile flags and walks the user through
  terms-consent / gps-consent / individual-register again.
  Fix: handleGmailLogin now asks the SERVER (loadCanonicalIdentity +
  is_age_verified RPC) whether the user is already onboarded. If yes,
  rehydrate local flags from server state and navigate straight to
  individual-home. Matches the "server is canonical" principle the
  rest of the codebase follows.

R-74: Family Circle button shows black screen for Free users
  Before: family-circle.tsx returned null when getSubscription().tier
  === 'free' (R-46 internal gate). The bottom-nav Family tab pointed
  to a blank screen with no explanation.
  Fix: render a friendly upgrade prompt with explanation, copy, and a
  View-plans button (dispatches sosphere:open-subscription event).
  Universal SaaS pattern: never silently hide paid features.

R-75: bottom tabs unresponsive on Map screen
  Before: pb-8 (32px) was eaten by the Android gesture-bar / home
  indicator, leaving the actual tab buttons hidden behind system UI.
  Combined with leaflet's full-height container, taps on Home /
  Family / Profile while on Map tab hit the system bar instead of
  the nav.
  Fix: padding-bottom uses max(2rem, env(safe-area-inset-bottom)).
  Also bumped z-index from 20 to 50 and added explicit
  pointerEvents:auto as defense in depth above the map canvas.

R-76: emergency contact form - auto-prepend country dial code
  Before: phone input started empty; placeholder showed +966 even
  for non-Saudi users. Most users typed local number without country
  code and Twilio E.164 validation failed downstream.
  Fix: AddEditContactForm seeds the phone state with the user's
  saved country dial code (R-49 detection -> +964 for Iraq, +966 for
  SA, etc.). User can still edit but starts with the right prefix.

Validation:
  - TypeScript parse: 4/4 files clean
  - verify-before-push.mjs: all 12 gates pass
  - mount-sync truncations during edits noticed and recovered from
    HEAD via python (workaround already used in earlier R-XX work).

Closes #R-73 #R-74 #R-75 #R-76.
"@

Write-Host ""
Write-Host "-- Commit --" -ForegroundColor Yellow
$tmp = [System.IO.Path]::GetTempFileName()
try {
    Set-Content -Path $tmp -Value $commitMsg -Encoding UTF8
    git commit -F $tmp
    if ($LASTEXITCODE -ne 0) { Write-Host "commit failed"; exit $LASTEXITCODE }
} finally {
    Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "-- Push --" -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) { Write-Host "push failed"; exit $LASTEXITCODE }

Write-Host ""
Write-Host "Pushed. Now rebuild + reinstall APK:" -ForegroundColor Green
Write-Host "  npm run build" -ForegroundColor Cyan
Write-Host "  npx cap sync android" -ForegroundColor Cyan
Write-Host "  cd android; .\gradlew assembleDebug; cd .." -ForegroundColor Cyan
Write-Host ""
Write-Host "Then on phone:" -ForegroundColor Cyan
Write-Host "  1. Clear app data (Settings -> Apps -> SOSphere -> Clear data)" -ForegroundColor Cyan
Write-Host "  2. Open app -> sign in with Gmail" -ForegroundColor Cyan
Write-Host "  3. Expected:" -ForegroundColor Cyan
Write-Host "     - Login -> individual-home directly (no onboarding repeat)" -ForegroundColor Cyan
Write-Host "     - Tap Family tab -> shows upgrade prompt (not black screen)" -ForegroundColor Cyan
Write-Host "     - On Map, tap Home/Family/Profile -> works" -ForegroundColor Cyan
Write-Host "     - Add emergency contact -> phone field starts with +964" -ForegroundColor Cyan
