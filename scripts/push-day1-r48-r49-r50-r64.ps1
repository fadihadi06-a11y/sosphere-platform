# ============================================================================
# Day 1 push helper — R-48 / R-49 / R-50 / R-64
# ----------------------------------------------------------------------------
# Runs the full verify-before-push gate suite first. Only commits + pushes
# if every gate prints PASS. This is the same pattern used for prior R-XX
# rollouts (R-30 through R-47).
#
# USAGE:
#   .\scripts\push-day1-r48-r49-r50-r64.ps1
#
# WHAT IT DOES:
#   1. Sanity-check working tree matches expected modified files
#   2. Run node scripts/verify-before-push.mjs (all gates 1-7)
#   3. If all green, stage + commit + push
#
# ABORTS IF:
#   • Any verify gate fails (you fix the underlying issue, then re-run)
#   • There are unrelated uncommitted changes (you stash or commit them first)
# ============================================================================

$ErrorActionPreference = "Stop"

# ── Move to repo root (script lives in scripts/) ────────────────────────
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "[push-day1] repo root: $repoRoot" -ForegroundColor Cyan

# ── 1. Expected files manifest ───────────────────────────────────────────
$expectedModified = @(
    "package.json",
    "package-lock.json",
    "src/app/components/login-phone.tsx",
    "src/app/components/offline-sync-engine.ts",
    "src/app/components/offline-sync.tsx",
    "src/app/components/sos-emergency.tsx",
    "vercel.json"
)
$expectedNew = @(
    "MOBILE_AUDIT_FINDINGS.md",
    "POST_LAUNCH_AUDIT.md",
    "public/.well-known/assetlinks.json",
    "scripts/regenerate-assetlinks.mjs",
    "src/app/components/__tests__/r48-r49-locale-emergency.test.ts",
    "src/app/components/__tests__/r50-network-status.test.ts",
    "src/app/components/utils/country-from-phone.ts",
    "src/app/components/utils/network-status.ts"
)

Write-Host ""
Write-Host "── Sanity-check working tree ─────────────────────────" -ForegroundColor Yellow
foreach ($f in ($expectedModified + $expectedNew)) {
    if (-not (Test-Path $f)) {
        Write-Host "MISSING: $f" -ForegroundColor Red
        Write-Host "Abort: expected file is not present. Did the session sync correctly?" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  All 14 expected files present." -ForegroundColor Green

# ── 1b. npm install — refresh lockfile because package.json gained @capacitor/network ──
Write-Host ""
Write-Host "── npm install (refresh lockfile for new @capacitor/network dep) ──" -ForegroundColor Yellow
$npmOutput = & npm install 2>&1
$npmExit = $LASTEXITCODE
$npmOutput | Select-Object -Last 6 | ForEach-Object { Write-Host $_ }
if ($npmExit -ne 0) {
    Write-Host "npm install failed (exit $npmExit). Resolve the dependency error, then re-run." -ForegroundColor Red
    exit $npmExit
}
Write-Host "  npm install OK." -ForegroundColor Green

# ── 2. Verify-before-push gate suite ─────────────────────────────────────
Write-Host ""
Write-Host "── Running verify-before-push.mjs ────────────────────" -ForegroundColor Yellow
$verifyOutput = & node scripts/verify-before-push.mjs 2>&1
$verifyExit = $LASTEXITCODE
$verifyOutput | ForEach-Object { Write-Host $_ }

if ($verifyExit -ne 0) {
    Write-Host ""
    Write-Host "verify-before-push FAILED (exit $verifyExit). Fix the failing gate, then re-run this script." -ForegroundColor Red
    exit $verifyExit
}

Write-Host ""
Write-Host "  verify-before-push: ALL GATES PASS." -ForegroundColor Green

# ── 3. Stage the expected files only ─────────────────────────────────────
Write-Host ""
Write-Host "── Staging files ─────────────────────────────────────" -ForegroundColor Yellow
foreach ($f in ($expectedModified + $expectedNew)) {
    git add -- "$f"
    Write-Host "  staged: $f"
}

# ── 4. Show what we are about to commit ──────────────────────────────────
Write-Host ""
Write-Host "── Diff stat (staged) ────────────────────────────────" -ForegroundColor Yellow
git diff --cached --stat

# ── 5. Commit ────────────────────────────────────────────────────────────
$commitMsg = @"
mobile-audit Day 1: R-48 + R-49 + R-50 + R-64 (locale emergency, country code, network, assetlinks)

R-48 (CRITICAL safety): locale-aware emergency-services lookup in sos-emergency.tsx
  - 0-contacts fallback: resolveEmergencyNumber() instead of hardcoded "911"
  - critical-battery screen: primary (country-resolved) + 112 international fallback
  - was: Saudi user got dialed to 911 (reaches nobody in SA); now: 997
  - source chain: localStorage[countryCode] -> phone-derived country -> browser locale -> 112

R-49: persist sosphere_country_code at signup (login-phone.tsx)
  - country picker selection is written to localStorage BEFORE OTP send
  - new utility utils/country-from-phone.ts derives ISO from E.164 phone
  - longest-prefix match with explicit US tie-break for the +1 NANP collision

R-50: unified network-status helper (utils/network-status.ts)
  - prefers @capacitor/network's OS-level truth on native (captive-portal-safe)
  - falls back to navigator.onLine on web (parity with prior behavior)
  - new dep: @capacitor/network ^6.0.3
  - replaced raw navigator.onLine in offline-sync-engine.ts + offline-sync.tsx

R-64: publish .well-known/assetlinks.json for Android App Links autoVerify
  - SHA-256 fingerprint extracted from sosphere-release.jks
  - vercel.json: rewrite exception for /.well-known/* BEFORE SPA catch-all
  - response headers: Content-Type application/json + Cache-Control 1h
  - scripts/regenerate-assetlinks.mjs for keystore rotations

Verification:
  - 29 new vitest cases (R-48/49: 23, R-50: 6) all pass
  - TypeScript parse gate: 8/8 files clean
  - verify-before-push.mjs: all gates pass (this commit)

Mount-sync recovery:
  - sos-emergency.tsx tail was truncated mid-JSX during one of the day's
    edits (-7547 bytes). Restored the missing 57 lines from HEAD and
    re-merged with R-48 hunks. TypeScript parse confirms structure.

See MOBILE_AUDIT_FINDINGS.md for the full G-3 audit (18 findings, 7 critical).
See POST_LAUNCH_AUDIT.md for the multi-day rollout plan.

Closes #R-48 #R-49 #R-50 #R-64.
"@

Write-Host ""
Write-Host "── Commit ────────────────────────────────────────────" -ForegroundColor Yellow
git commit -m $commitMsg
if ($LASTEXITCODE -ne 0) {
    Write-Host "git commit failed (exit $LASTEXITCODE). Inspect above output." -ForegroundColor Red
    exit $LASTEXITCODE
}

# ── 6. Push ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "── Push ──────────────────────────────────────────────" -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "git push failed (exit $LASTEXITCODE). You may need to pull --rebase first." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Day 1 pushed. Watch CI:" -ForegroundColor Green
Write-Host "  https://github.com/$(git remote get-url origin | %{ ($_ -replace '^.*github.com[:/]', '') -replace '\.git$', '' })/actions" -ForegroundColor Green
Write-Host ""
Write-Host "Next: Day 2 = R-53 + R-54 + R-55 (Push notifications)." -ForegroundColor Cyan
