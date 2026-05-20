$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$expectedModified = @(
    "src/app/components/emergency-contacts.tsx",
    "src/app/components/individual-register.tsx",
    "src/app/components/profile-settings.tsx"
)

Write-Host ""
foreach ($f in $expectedModified) {
    if (-not (Test-Path $f)) { Write-Host "MISSING: $f" -ForegroundColor Red; exit 1 }
}

Write-Host "-- verify-before-push --" -ForegroundColor Yellow
& node scripts/verify-before-push.mjs 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

foreach ($f in $expectedModified) { git add -- "$f"; Write-Host "  staged: $f" }
git add -- "scripts/push-r86.ps1" 2>$null

git diff --cached --stat

$commitMsg = @"
R-86: phone-input flex overflow true fix (minWidth:0 + box-sizing)

After R-85 (dir=ltr on phone rows) the visual ORDER was correct but
input fields still overflowed their box boundaries. Real-device
feedback showed digits bleeding past the field's right/left edge.

ROOT CAUSE (CSS):
  Flex items default to min-width: auto which prevents them from
  shrinking below their intrinsic content size. An <input flex:1>
  inside a constrained flex row therefore EXPANDS to fit its
  placeholder/value content, pushing past the parent's bounds.
  This is one of the most common flex-layout gotchas and is
  documented in Apple HIG / Material Design CSS guides.

FIX (universal CSS pattern):
  Every phone-input cell now uses:
    minWidth: 0                    // allow shrinking below content
    width: 100%                    // fill remaining flex space
    boxSizing: border-box          // include padding in width
    overflow: hidden (on wrapper)  // belt-and-braces clip

  Applied to:
    - profile-settings.tsx phone editor input (R-83 modal)
    - emergency-contacts.tsx phone input (R-80 form)
    - individual-register.tsx main phone wrapper (R-67 signup)
    - individual-register.tsx contact phone wrapper (R-81 signup)

This is the same fix used by every shipping mobile-form library
(react-hook-form, formik, etc.) for tel/number inputs in flex rows.

Validation: TypeScript parse 3/3, verify-before-push all green.

Closes #R-86.
"@

$tmp = [System.IO.Path]::GetTempFileName()
try {
    Set-Content -Path $tmp -Value $commitMsg -Encoding UTF8
    git commit -F $tmp
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
}

git push
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Pushed. After push:" -ForegroundColor Green
Write-Host "  git log -1 --oneline   # verify the commit landed locally" -ForegroundColor Cyan
Write-Host "  npm run build" -ForegroundColor Cyan
Write-Host "  npx cap sync android" -ForegroundColor Cyan
Write-Host "  cd android; .\gradlew clean assembleDebug; cd .." -ForegroundColor Cyan
Write-Host ""
Write-Host "Then UNINSTALL old + install new APK and test phone fields." -ForegroundColor Cyan
