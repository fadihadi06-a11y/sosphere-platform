$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$expectedModified = @(
    "src/app/components/individual-layout.tsx",
    "src/app/components/individual-register.tsx",
    "src/app/components/mobile-app.tsx",
    "src/app/components/profile-settings.tsx"
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
git add -- "scripts/push-r81.ps1" 2>$null

Write-Host ""
git diff --cached --stat

$commitMsg = @"
R-81: real avatar + phone on Profile, country picker on signup contact

User feedback (real device, 2026-05-19): the Profile card showed a
random stock photo of a man + "+966 5XX XXX XXXX" — two hardcoded
placeholders mistaken for real user data. Plus the signup Emergency
Contact phone field had no country selector.

Root fixes:

1. profile-settings.tsx:
   - Replaced hardcoded AVATAR_URL (Unsplash stock photo) usage with
     userAvatarUrl prop. Falls back to initials on a tinted background
     when no avatar URL is available.
   - Replaced literal "+966 5XX XXX XXXX" with userPhone prop. Empty
     phone shows "Add phone in Settings" / em-dash for company accounts.

2. individual-layout.tsx: added userPhone + userAvatarUrl props and
   passes them through to ProfileSettings.

3. mobile-app.tsx: caches Google profile picture URL on window
   (__sosphereGoogleAvatar) at Gmail sign-in. IndividualLayout reads
   it for the avatar prop. Phone comes from loginPhone state.

4. individual-register.tsx: added a country-code badge to the Emergency
   Contact phone field (uses the user's already-selected country).
   Mirrors R-80 pattern from emergency-contacts.tsx so signup-time
   contacts get the right dial-code prefix too. Placeholder cleaned up
   from "07701234567" to "7XX XXX XXXX".

Validation:
  - TypeScript parse: 4/4 files clean
  - verify-before-push.mjs: all 12 gates pass

Closes #R-81.
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
Write-Host "Pushed. Rebuild + reinstall with clean cache:" -ForegroundColor Green
Write-Host "  npm run build" -ForegroundColor Cyan
Write-Host "  npx cap sync android" -ForegroundColor Cyan
Write-Host "  cd android; .\gradlew clean assembleDebug; cd .." -ForegroundColor Cyan
Write-Host ""
Write-Host "Then on phone:" -ForegroundColor Cyan
Write-Host "  1. UNINSTALL the old app (not just clear data)" -ForegroundColor Cyan
Write-Host "  2. Install the fresh APK" -ForegroundColor Cyan
Write-Host "  3. Sign in with Gmail" -ForegroundColor Cyan
Write-Host "  4. Go to Profile tab -> avatar = your Google picture (or initials)" -ForegroundColor Cyan
Write-Host "     phone = your real phone (or 'Add phone' hint)" -ForegroundColor Cyan
Write-Host "  5. Signup Emergency Contact -> sees +964 flag badge next to input" -ForegroundColor Cyan
