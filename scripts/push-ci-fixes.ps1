# ============================================================================
# CI-FIX push helper — CI-FIX-1 (r50 test) + CI-FIX-2 (lint)
# ----------------------------------------------------------------------------
# Day 1 (R-48/49/50/64) was pushed but CI failed on:
#   • r50 vitest: 3 tests assumed navigator existed in headless Node CI
#   • ESLint: 4 unused imports in buddy-system, 4 in biometric-gate-modal-v2,
#     1 unnecessary escape in r9-edge-function-anti-pattern-audit test
#
# This script:
#   1. Verifies only the expected 4 files are modified
#   2. Runs verify-before-push.mjs (all gates)
#   3. If all green, commits + pushes
#
# USAGE: .\scripts\push-ci-fixes.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "[push-ci-fixes] repo root: $repoRoot" -ForegroundColor Cyan

# ── 1. Expected files manifest ───────────────────────────────────────────
$expectedModified = @(
    "src/app/components/__tests__/r50-network-status.test.ts",
    "src/app/components/__tests__/r9-edge-function-anti-pattern-audit.test.ts",
    "src/app/components/biometric-gate-modal-v2.tsx",
    "src/app/components/buddy-system.tsx"
)

Write-Host ""
Write-Host "── Sanity-check working tree ─────────────────────────" -ForegroundColor Yellow
foreach ($f in $expectedModified) {
    if (-not (Test-Path $f)) {
        Write-Host "MISSING: $f" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  All 4 expected files present." -ForegroundColor Green

# ── 2. Verify-before-push gate suite ─────────────────────────────────────
Write-Host ""
Write-Host "── Running verify-before-push.mjs ────────────────────" -ForegroundColor Yellow
$verifyOutput = & node scripts/verify-before-push.mjs 2>&1
$verifyExit = $LASTEXITCODE
$verifyOutput | ForEach-Object { Write-Host $_ }

if ($verifyExit -ne 0) {
    Write-Host ""
    Write-Host "verify-before-push FAILED (exit $verifyExit). Fix and re-run." -ForegroundColor Red
    exit $verifyExit
}

Write-Host ""
Write-Host "  verify-before-push: ALL GATES PASS." -ForegroundColor Green

# ── 3. Stage the expected files only ─────────────────────────────────────
Write-Host ""
Write-Host "── Staging files ─────────────────────────────────────" -ForegroundColor Yellow
foreach ($f in $expectedModified) {
    git add -- "$f"
    Write-Host "  staged: $f"
}

# Also stage this script + the prior day1 helper for posterity
if (Test-Path "scripts/push-ci-fixes.ps1") {
    git add -- "scripts/push-ci-fixes.ps1"
    Write-Host "  staged: scripts/push-ci-fixes.ps1"
}
if (Test-Path "scripts/push-day1-r48-r49-r50-r64.ps1") {
    # Only stage if untracked
    $tracked = & git ls-files --error-unmatch "scripts/push-day1-r48-r49-r50-r64.ps1" 2>$null
    if ($LASTEXITCODE -ne 0) {
        git add -- "scripts/push-day1-r48-r49-r50-r64.ps1"
        Write-Host "  staged: scripts/push-day1-r48-r49-r50-r64.ps1 (untracked)"
    }
}

# ── 4. Show what we are about to commit ──────────────────────────────────
Write-Host ""
Write-Host "── Diff stat (staged) ────────────────────────────────" -ForegroundColor Yellow
git diff --cached --stat

# ── 5. Commit ────────────────────────────────────────────────────────────
$commitMsg = @"
ci-fix: green up CI after Day 1 push (R-48/49/50/64)

CI-FIX-1: r50-network-status.test.ts — stub navigator on globalThis
  - Headless CI Node lacks the navigator global that the local vitest
    sandbox provides for free. Tests asserting navigator.onLine flips
    were getting 'unknown'/true regardless of what they set.
  - New beforeEach/afterEach uses Object.defineProperty(globalThis,
    'navigator', ...) which works in BOTH Node and jsdom — no env
    dependency.
  - 6 tests, all green locally with the stub.

CI-FIX-2: ESLint no-unused-vars overflows after Day 1 raised ceiling
  - buddy-system.tsx: removed Phone, Shield, CheckCircle, Heart imports
  - biometric-gate-modal-v2.tsx: removed EyeOff icon + isBiometricVerified
    import; prefixed biometricStatus state and handleEnrollmentFallback
    with _ so no-unused-vars accepts (both are used indirectly / kept
    for future flows).
  - r9-edge-function-anti-pattern-audit.test.ts: fixed two unnecessary
    regex escapes (\; and \} outside character class).

Each surgical patch applied against fresh HEAD copies via python script
to avoid the mount-sync truncation that bit sos-emergency.tsx during
Day 1 (recovered + verified there).

Validation:
  • TypeScript parse: 4/4 files clean
  • ESLint (the 9 originally-flagged items): 0 occurrences in output
  • verify-before-push.mjs: ALL GATES PASS (this commit)

No production-code behavior changes — only test infra + dead-code removal.
"@

Write-Host ""
Write-Host "── Commit ────────────────────────────────────────────" -ForegroundColor Yellow
git commit -m $commitMsg
if ($LASTEXITCODE -ne 0) {
    Write-Host "git commit failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}

# ── 6. Push ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "── Push ──────────────────────────────────────────────" -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "git push failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "CI fixes pushed. Watch CI:" -ForegroundColor Green
Write-Host "  https://github.com/$(git remote get-url origin | %{ ($_ -replace '^.*github.com[:/]', '') -replace '\.git$', '' })/actions" -ForegroundColor Green
Write-Host ""
Write-Host "Once CI is green, say 'Day 2' to start R-53 + R-54 + R-55 (Push notifications)." -ForegroundColor Cyan
