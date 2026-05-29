# SOSphere — Git History Secret Cleanup
# Generated: 2026-05-29
#
# WHAT THIS DOES:
# - Rewrites every commit on every branch
# - Replaces leaked Firebase API keys with ***REDACTED*** markers
# - Force-pushes to GitHub (DESTRUCTIVE — anyone with a clone must re-clone)
#
# RISKS:
# - All commit SHAs change (your `main` history is rewritten)
# - Anyone who has the repo cloned MUST re-clone (their `git pull` will fail)
# - PRs/branches that reference old SHAs will be orphaned
# - GitHub's cached refs may still show the old keys for ~24 hours
#
# SAFETY:
# - The keys are ALREADY ROTATED. Even if attackers grab them from git history
#   right now, they get HTTP 403 because we deleted them in Cloud Console.
# - This script is purely cosmetic for Gitleaks compliance.

$ErrorActionPreference = "Stop"
$RepoRoot = "C:\Users\user\Downloads\sosphere-platform"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "SOSphere — Git History Secret Cleanup" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ── Pre-flight checks ──────────────────────────────────────
Write-Host "[1/7] Pre-flight checks..." -ForegroundColor Yellow

# Find git-filter-repo: prefer python -m (most portable on Windows)
$pythonCheck = python -c "import git_filter_repo; print('ok')" 2>&1
if ($pythonCheck -match "ok") {
    Write-Host "  ✓ git_filter_repo Python module available"
} else {
    Write-Host "  ERROR: git-filter-repo not installed." -ForegroundColor Red
    Write-Host "  Install with: pip install git-filter-repo" -ForegroundColor Yellow
    exit 1
}

# Check we're in the right repo
Set-Location $RepoRoot
$remoteUrl = git config --get remote.origin.url
if ($remoteUrl -notmatch "sosphere-platform") {
    Write-Host "  ERROR: Not in sosphere-platform repo." -ForegroundColor Red
    Write-Host "  Current remote: $remoteUrl" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Repo verified: $remoteUrl"

# Check uncommitted changes
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "  ERROR: Uncommitted changes detected. Commit or stash first." -ForegroundColor Red
    git status --short
    exit 1
}
Write-Host "  ✓ Working tree clean"

# Check we're on main
$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "main") {
    Write-Host "  ERROR: You're on '$branch'. Checkout main first." -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ On main branch"

# ── Confirm with user ──────────────────────────────────────
Write-Host ""
Write-Host "[2/7] FINAL CONFIRMATION" -ForegroundColor Yellow
Write-Host ""
Write-Host "This will rewrite ALL git history and force-push to GitHub." -ForegroundColor Red
Write-Host "Anyone who has cloned the repo will need to re-clone." -ForegroundColor Red
Write-Host ""
Write-Host "Secrets to redact:"
Get-Content scripts/secrets-to-redact.txt | ForEach-Object {
    Write-Host "  $_" -ForegroundColor Gray
}
Write-Host ""
$confirm = Read-Host "Type 'YES REWRITE HISTORY' to proceed"
if ($confirm -ne "YES REWRITE HISTORY") {
    Write-Host "Cancelled. Nothing was changed." -ForegroundColor Yellow
    exit 0
}

# ── Backup ──────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/7] Creating backup..." -ForegroundColor Yellow
$BackupPath = "C:\Users\user\Downloads\sosphere-platform-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -Recurse $RepoRoot $BackupPath
Write-Host "  ✓ Backup: $BackupPath"

# ── Run the rewrite ────────────────────────────────────────
Write-Host ""
Write-Host "[4/7] Rewriting history (this takes 1-5 minutes)..." -ForegroundColor Yellow
python -m git_filter_repo --replace-text scripts/secrets-to-redact.txt --force
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: git filter-repo failed. Restore from $BackupPath" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ History rewritten"

# ── Verify cleanup ──────────────────────────────────────────
Write-Host ""
Write-Host "[5/7] Verifying no secrets remain in history..." -ForegroundColor Yellow
$leaks = git log --all -p | Select-String -Pattern "***REDACTED-OLD-ANDROID-KEY-ROTATED-2026-05-29***|***REDACTED-OLD-BROWSER-KEY-ROTATED-2026-05-29***"
if ($leaks) {
    Write-Host "  WARNING: Some keys still found:" -ForegroundColor Yellow
    $leaks | Select-Object -First 5
} else {
    Write-Host "  ✓ Zero leaks remaining"
}

# ── Re-add remote (filter-repo removes it) ─────────────────
Write-Host ""
Write-Host "[6/7] Re-adding GitHub remote..." -ForegroundColor Yellow
git remote add origin "https://github.com/fadihadi06-a11y/sosphere-platform.git"
Write-Host "  ✓ Remote re-added"

# ── Force push ──────────────────────────────────────────────
Write-Host ""
Write-Host "[7/7] Force-pushing rewritten history to GitHub..." -ForegroundColor Yellow
Write-Host "  This is the irreversible step." -ForegroundColor Red
$pushConfirm = Read-Host "Type 'PUSH' to force-push, anything else to skip"
if ($pushConfirm -eq "PUSH") {
    git push origin --force --all
    git push origin --force --tags
    Write-Host "  ✓ Force-pushed all branches + tags"
} else {
    Write-Host "  Skipped. Local history is rewritten, but GitHub still has the old history." -ForegroundColor Yellow
    Write-Host "  Run 'git push origin --force --all' manually when ready." -ForegroundColor Yellow
}

# ── Done ────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Cleanup complete!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Wait ~24 hours for GitHub to refresh cached refs"
Write-Host "  2. Run Gitleaks deep scan to confirm 0 leaks"
Write-Host "  3. Notify any collaborators to re-clone the repo"
Write-Host "  4. Delete the backup once confident: $BackupPath"
Write-Host ""
