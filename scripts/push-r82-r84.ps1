$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$expectedModified = @(
    "src/app/components/emergency-contacts.tsx",
    "src/app/components/profile-settings.tsx"
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
git add -- "scripts/push-r82-r84.ps1" 2>$null

Write-Host ""
git diff --cached --stat

$commitMsg = @"
R-82 + R-83 + R-84: tappable avatar + inline phone editor + modal stability

User feedback (real device 2026-05-19):
  - Avatar shows initial 'F' for Fadi but is dead-static; tapping should
    open camera/gallery picker.
  - 'Add phone in Settings' is dead text; should be a tappable inline
    editor instead of a nonexistent Settings link.
  - Add Safety Contact modal moves up/down when keyboard appears.

R-82: tappable avatar -> Capacitor Camera picker.
  ProfileSettings avatar wrapper changed from <div> to <button>.
  onClick imports @capacitor/camera and calls Camera.getPhoto with
  source: Prompt (user chooses camera vs gallery), 80% quality,
  512x512 max, allowEditing. Result data URL saved to
  sosphere_avatar_dataurl localStorage and rendered immediately.
  Web fallback: hidden <input type=file accept=image/*> + FileReader.
  Custom avatar overrides the Google profile picture when set.

R-83: inline phone editor on Profile.
  'Add phone' is now a <button>. Tap opens a bottom-sheet modal with
  CountrySheet (same component used by login) + local-number input +
  Save/Cancel. On Save: writes sosphere_user_phone + UPDATE profiles
  SET phone = E.164 via Supabase. Re-renders via window.location.reload
  so loginPhone state picks up the new value (cleaner alternative
  needs prop drilling we will iterate on).

R-84: Safety Contact modal stability under keyboard.
  Root cause: the modal used position:absolute inside the flex column
  layout, so when the Android keyboard reflowed the parent the modal
  slid up/down with it. Universal fix:
    - position: fixed (decouples from parent reflow)
    - height: 100dvh (dynamic viewport - collapses to keyboard area
      on Chrome Android 108+ which is Capacitor's WebView baseline)
    - maxHeight: 85dvh on the inner panel so it stays comfortably
      above the keyboard with breathing room.
    - paddingBottom: max(24px, env(safe-area-inset-bottom)) for
      gesture-bar devices.

Validation:
  - TypeScript parse: 2/2 files clean
  - verify-before-push.mjs: all 12 gates pass
  - mount-sync truncations noticed and recovered from HEAD twice
    during these edits (familiar workaround now).

Closes #R-82 #R-83 #R-84.
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
Write-Host "Pushed. Rebuild with clean cache:" -ForegroundColor Green
Write-Host "  npm run build" -ForegroundColor Cyan
Write-Host "  npx cap sync android" -ForegroundColor Cyan
Write-Host "  cd android; .\gradlew clean assembleDebug; cd .." -ForegroundColor Cyan
Write-Host ""
Write-Host "On phone: UNINSTALL old + install new APK + sign in." -ForegroundColor Cyan
Write-Host "Tests:" -ForegroundColor Cyan
Write-Host "  - Profile -> tap avatar -> camera/gallery prompt appears" -ForegroundColor Cyan
Write-Host "  - Profile -> tap 'Add phone' -> editor opens with country picker" -ForegroundColor Cyan
Write-Host "  - Add Safety Contact -> form stays anchored when keyboard opens" -ForegroundColor Cyan
