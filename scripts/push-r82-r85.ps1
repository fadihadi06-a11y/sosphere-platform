$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Combined push: R-82 (avatar) + R-83 (phone editor) + R-84 (modal stability)
# + R-85 (RTL phone-row overflow fix). All four built on top of the same
# R-81 commit and form a single coherent UX batch.
$expectedModified = @(
    "src/app/components/emergency-contacts.tsx",
    "src/app/components/individual-register.tsx",
    "src/app/components/profile-settings.tsx"
)

Write-Host ""
Write-Host "-- Sanity-check --" -ForegroundColor Yellow
foreach ($f in $expectedModified) {
    if (-not (Test-Path $f)) { Write-Host "MISSING: $f" -ForegroundColor Red; exit 1 }
}

Write-Host ""
Write-Host "-- verify-before-push --" -ForegroundColor Yellow
& node scripts/verify-before-push.mjs 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Write-Host "verify failed."; exit $LASTEXITCODE }

Write-Host ""
foreach ($f in $expectedModified) { git add -- "$f"; Write-Host "  staged: $f" }
git add -- "scripts/push-r82-r85.ps1" 2>$null

git diff --cached --stat

$commitMsg = @"
R-82 + R-83 + R-84 + R-85 (mobile UX batch from real-device testing)

R-82: tappable avatar -> @capacitor/camera Prompt
  - ProfileSettings avatar wrapper now a <button>
  - onClick imports @capacitor/camera and calls Camera.getPhoto with
    source: Prompt (user picks camera or gallery)
  - Result data URL saved to sosphere_avatar_dataurl + rendered live
  - Web fallback: hidden <input type=file accept=image/*>

R-83: inline phone editor on Profile
  - 'Add phone' is now a <button> opening a bottom-sheet modal
  - Modal contains CountrySheet + local-number input + Save/Cancel
  - Save writes sosphere_user_phone localStorage + UPDATE profiles SET
    phone via Supabase, then reloads the session to pick up the value

R-84: Safety Contact modal stability under keyboard
  - position: fixed (not absolute) so parent flex reflow does not move
    the modal when the Android keyboard opens
  - height: 100dvh + maxHeight: 85dvh anchor the panel to the
    keyboard-visible viewport on Chrome Android 108+
  - paddingBottom: max(24px, env(safe-area-inset-bottom)) for
    gesture-bar devices

R-85: RTL phone-row overflow fix (root cause of "input bleeds past
  the border" reported on every phone-input screen)
  - Arabic UI is RTL; flex rows reverse children, so [dial-code][input]
    became [input][dial-code]. The phone input had direction: ltr to
    keep digits LTR, but its FIELD BOX was right-aligned by the flex
    reverse - typed digits then visually pushed past the box's left
    edge.
  - Universal fix: wrap every phone-input row in dir="ltr". Phone
    numbers are LTR universally (E.164), and Apple/Google/WhatsApp all
    keep the phone row LTR regardless of UI language.
  - Applied to: profile-settings phone editor, emergency-contacts
    AddEditContactForm, individual-register main phone + contact phone.

Validation: TypeScript parse 3/3, verify-before-push all green.

Closes #R-82 #R-83 #R-84 #R-85.
"@

$tmp = [System.IO.Path]::GetTempFileName()
try {
    Set-Content -Path $tmp -Value $commitMsg -Encoding UTF8
    git commit -F $tmp
    if ($LASTEXITCODE -ne 0) { Write-Host "commit failed"; exit $LASTEXITCODE }
} finally {
    Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
}

git push
if ($LASTEXITCODE -ne 0) { Write-Host "push failed"; exit $LASTEXITCODE }

Write-Host ""
Write-Host "Pushed. Mandatory clean rebuild:" -ForegroundColor Green
Write-Host "  npm run build" -ForegroundColor Cyan
Write-Host "  npx cap sync android" -ForegroundColor Cyan
Write-Host "  cd android; .\gradlew clean assembleDebug; cd .." -ForegroundColor Cyan
Write-Host ""
Write-Host "On phone: UNINSTALL old + install new. Then test:" -ForegroundColor Cyan
Write-Host "  - Add phone modal: digits stay inside the field box (R-85)" -ForegroundColor Cyan
Write-Host "  - Add Safety Contact: digits stay inside, modal stays still (R-84 + R-85)" -ForegroundColor Cyan
Write-Host "  - Tap avatar: camera/gallery picker (R-82)" -ForegroundColor Cyan
