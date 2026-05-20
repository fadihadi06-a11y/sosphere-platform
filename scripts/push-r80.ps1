# ============================================================================
# Push helper - R-80 (separate country picker for emergency contact form)
# ============================================================================
$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "[push-r80] repo root: $repoRoot" -ForegroundColor Cyan

$expectedModified = @("src/app/components/emergency-contacts.tsx")

Write-Host ""
Write-Host "-- Sanity-check --" -ForegroundColor Yellow
foreach ($f in $expectedModified) {
    if (-not (Test-Path $f)) { Write-Host "MISSING: $f" -ForegroundColor Red; exit 1 }
}
Write-Host "  File present." -ForegroundColor Green

Write-Host ""
Write-Host "-- verify-before-push --" -ForegroundColor Yellow
& node scripts/verify-before-push.mjs 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Write-Host "verify failed."; exit $LASTEXITCODE }

Write-Host ""
Write-Host "-- Staging --" -ForegroundColor Yellow
foreach ($f in $expectedModified) { git add -- "$f"; Write-Host "  staged: $f" }
git add -- "scripts/push-r80.ps1" 2>$null

Write-Host ""
git diff --cached --stat

$commitMsg = @"
R-80: separate country picker in emergency contact form

Real-device feedback (2026-05-19): the inlined-dial-code approach from
R-76/R-79 produced a single field that mixed the dial code with the
local number ("+964 7501234567"). Users found it confusing - the dial
code was easy to accidentally erase, and there was no visual cue that
the prefix could be changed.

Fix: replace the single <input type="tel"> with a row of two controls
matching the universal pattern used by WhatsApp / Telegram / our own
login screen:
  [Flag] [+964] dropdown  |  [local number input]

The country picker is the same CountrySheet component already used by
the login screen. Initial country picked via:
  1. existing contact's phone (longest-prefix match against COUNTRIES)
  2. localStorage[sosphere_country_code] (R-49)
  3. navigator.language region (R-79 fallback)
  4. SA (project default)

Local number input strips non-digits as the user types (max 15 chars,
ITU-T E.164 limit). The two parts are recombined into the canonical
E.164 string on save via the `phone` derived value, so downstream code
(Twilio dispatch, push tokens, etc.) is unchanged.

Validation:
  - TypeScript parse: 1/1 file clean
  - verify-before-push.mjs: all 12 gates pass

Closes #R-80.
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
Write-Host "Pushed. Rebuild + reinstall:" -ForegroundColor Green
Write-Host "  npm run build" -ForegroundColor Cyan
Write-Host "  npx cap sync android" -ForegroundColor Cyan
Write-Host "  cd android; .\gradlew assembleDebug; cd .." -ForegroundColor Cyan
Write-Host ""
Write-Host "About Family Circle 'View plans' + (+) buttons:" -ForegroundColor Yellow
Write-Host "  R-78 wiring is in main since the previous batch. If they still" -ForegroundColor Yellow
Write-Host "  do not respond, the most likely cause is the APK on the phone" -ForegroundColor Yellow
Write-Host "  is an older build. After this push, rebuild + reinstall once" -ForegroundColor Yellow
Write-Host "  more and clear app data, then retest both buttons." -ForegroundColor Yellow
