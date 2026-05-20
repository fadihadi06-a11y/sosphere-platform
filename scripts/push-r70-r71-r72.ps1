# ============================================================================
# Push helper - R-70 + R-71 + R-72 (real-device feedback)
# ----------------------------------------------------------------------------
# 1. verify-before-push (all 12 gates)
# 2. stage + commit + push
# ============================================================================

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "[push-uxfix] repo root: $repoRoot" -ForegroundColor Cyan

$expectedModified = @(
    "src/app/components/mobile-app.tsx",
    "src/styles/native-compat.css"
)

Write-Host ""
Write-Host "-- Sanity-check --" -ForegroundColor Yellow
foreach ($f in $expectedModified) {
    if (-not (Test-Path $f)) { Write-Host "MISSING: $f" -ForegroundColor Red; exit 1 }
}
Write-Host "  All 2 expected files present." -ForegroundColor Green

Write-Host ""
Write-Host "-- verify-before-push --" -ForegroundColor Yellow
& node scripts/verify-before-push.mjs 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Write-Host "verify failed."; exit $LASTEXITCODE }

Write-Host ""
Write-Host "-- Staging --" -ForegroundColor Yellow
foreach ($f in $expectedModified) { git add -- "$f"; Write-Host "  staged: $f" }
git add -- "scripts/push-r70-r71-r72.ps1" 2>$null

Write-Host ""
Write-Host "-- Diff stat --" -ForegroundColor Yellow
git diff --cached --stat

$commitMsg = @"
ux-fix: R-70 + R-71 + R-72 (Iraqi-device real-test feedback)

R-70: deterministic routing for users who are BOTH owner + individual.
  Real-device evidence (fadihadi06@gmail.com): user owns a company
  (dell) AND has an individual profile (user_type='individual').
  On alternating Gmail logins they sometimes saw individual-home,
  sometimes the employee-dashboard with placeholder Car Guardian /
  Field Engineer data. Root cause: the existing fast-path checked
  primary_role for employee/dispatcher but did not explicitly guard
  the owner case before falling through, so a previous-session
  state could lead the routing to land on employee-dashboard via
  an indirect path.
  Fix: add an explicit owner-branch that logs and falls through
  to the individual flow on mobile. Owners use the WEB dashboard
  at /dashboard for admin work; on mobile they get the same
  personal-safety experience as any individual user.

R-71 + R-72: disable native text-selection / long-press callout
  on interactive elements.
  Real-device evidence: tapping a service card (e.g. حزمة الطوارئ)
  opened Android's Copy / Share / Select-all menu instead of
  triggering the card's onClick. The card also rendered with
  horizontal striping artifacts - the WebView was painting its
  text-selection highlight on RTL Arabic text inside the
  glassmorphic button background, producing a glitch-like effect.
  Same root cause: WebView treats <button> text as selectable, so
  a long-press (or even a held tap on a slow device) triggers
  selection UI before the click handler.
  Fix in src/styles/native-compat.css: disable user-select +
  -webkit-touch-callout + -webkit-tap-highlight-color on
  button, [role=button], a, motion buttons. Re-enabled selection
  on form inputs and .allow-select containers so users can still
  copy OTP codes or phone numbers from text fields.

Standard pattern (Apple HIG + Material Design + every shipping
safety app uses this approach).

Validation:
  - TypeScript parse: 1/1 file clean
  - verify-before-push.mjs: all 12 gates pass
  - mobile-app.tsx local tail truncation noticed during R-70 patch
    and restored from HEAD before re-applying the patch via python
    (mount-sync workaround already used in earlier R-XX work).

Closes #R-70 #R-71 #R-72.
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
Write-Host "  adb install -r android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Cyan
Write-Host ""
Write-Host "On phone, then clear data + retest:" -ForegroundColor Cyan
Write-Host "  Settings -> Apps -> SOSphere -> Storage -> Clear data" -ForegroundColor Cyan
Write-Host "  Open app -> sign in with Gmail" -ForegroundColor Cyan
Write-Host "  Expect: individual home only (no employee dashboard)" -ForegroundColor Cyan
Write-Host "  Tap cards: no text-selection menu, no visual glitch" -ForegroundColor Cyan
