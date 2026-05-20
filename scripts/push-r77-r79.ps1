# ============================================================================
# Push helper - R-77 + R-78 + R-79 (real-device feedback batch 3)
# ============================================================================
$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "[push-uxfix3] repo root: $repoRoot" -ForegroundColor Cyan

$expectedModified = @(
    "src/app/components/emergency-contacts.tsx",
    "src/app/components/family-circle.tsx",
    "src/app/components/individual-layout.tsx",
    "src/app/components/view-transitions.tsx"
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
git add -- "scripts/push-r77-r79.ps1" 2>$null

Write-Host ""
Write-Host "-- Diff stat --" -ForegroundColor Yellow
git diff --cached --stat

$commitMsg = @"
ux-batch-3: R-77 + R-78 + R-79 (animation speed + family upgrade + country fallback)

R-77: reduce animation durations and bump spring stiffness
  Real-device feedback (Iraqi Android): transitions felt like slow motion.
  Apple HIG recommends <250ms; Material Design 150-300ms. Previous
  motionConfig.normal = 0.3s compounded with spring physics produced a
  perceived 400-500ms duration.
  Fix in view-transitions.tsx:
    fast      0.15 -> 0.10
    normal    0.30 -> 0.18  (most-used)
    slow      0.45 -> 0.28
    spring stiffness 300 -> 420 (settles ~30% faster, no overshoot)
    staggerDelay     0.05 -> 0.03
    listItemDelay    0.03 -> 0.02
  Net result: same smooth feel, ~40% faster perceived navigation.

R-78: wire FamilyCircle View-plans button to subscription nav
  Previously the upgrade prompt dispatched a custom event with no listener,
  so the button looked dead. Now the component accepts onUpgrade prop and
  individual-layout passes onNavigateToSubscription through. Custom-event
  dispatch kept as a fallback for call sites that have not adopted the
  prop yet (defense in depth).

R-79: country code fallback to navigator.language for Gmail users
  R-49 only writes sosphere_country_code on phone OTP signup. A user who
  signs in with Gmail never gets the storage flag, so R-76's dial-code
  seeding fell back to "" for them and the contact form started empty.
  Fix: if storage is empty, derive the country from navigator.language
  region (ar-IQ -> IQ -> +964) before falling back to "". Same algorithm
  used by R-67 for the country picker.

Validation:
  - TypeScript parse: 4/4 files clean
  - verify-before-push.mjs: all 12 gates pass

Closes #R-77 #R-78 #R-79.
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
Write-Host "Pushed. Now rebuild APK:" -ForegroundColor Green
Write-Host "  npm run build" -ForegroundColor Cyan
Write-Host "  npx cap sync android" -ForegroundColor Cyan
Write-Host "  cd android; .\gradlew assembleDebug; cd .." -ForegroundColor Cyan
Write-Host ""
Write-Host "Then transfer android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Cyan
Write-Host "to the phone (Google Drive or USB file transfer) and reinstall." -ForegroundColor Cyan
Write-Host ""
Write-Host "On phone retest:" -ForegroundColor Cyan
Write-Host "  - Page transitions should feel ~40% snappier" -ForegroundColor Cyan
Write-Host "  - Family tab View-plans button -> opens subscription screen" -ForegroundColor Cyan
Write-Host "  - Add emergency contact -> phone field starts with +964" -ForegroundColor Cyan
