# ===========================================================================
# SOSphere - Keystore Backup Helper
# ---------------------------------------------------------------------------
# Copies your release keystore + properties to a FIXED backup location so
# you can always find them. Run this after every keystore change.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\backup-keystore.ps1
# ===========================================================================

$ErrorActionPreference = "Stop"

$BackupRoot = "C:\Users\user\SOSphere-Backups"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Source files
$JksSrc   = Join-Path $ProjectRoot "android\app\sosphere-release.jks"
$PropsSrc = Join-Path $ProjectRoot "android\app\keystore.properties"

Write-Host ""
Write-Host "===================================================================="
Write-Host "  SOSphere - Keystore Backup"
Write-Host "===================================================================="
Write-Host ""

# 1. Verify sources exist
if (-not (Test-Path $JksSrc)) {
    Write-Host "X  Keystore not found at: $JksSrc" -ForegroundColor Red
    Write-Host "   Run scripts\release-signing.ps1 first to generate it." -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path $PropsSrc)) {
    Write-Host "X  keystore.properties not found at: $PropsSrc" -ForegroundColor Red
    exit 1
}

# 2. Create backup folder with timestamp
$Timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$BackupDir = Join-Path $BackupRoot $Timestamp
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

# 3. Copy files + a sidecar SHA-256 so you can verify integrity later
Copy-Item $JksSrc   (Join-Path $BackupDir "sosphere-release.jks")
Copy-Item $PropsSrc (Join-Path $BackupDir "keystore.properties")

$JksHash = Get-FileHash $JksSrc -Algorithm SHA256
$Info = @"
SOSphere Keystore Backup
========================
Backed up: $(Get-Date)
From:      $ProjectRoot
Keystore:  sosphere-release.jks
SHA-256:   $($JksHash.Hash)

IMPORTANT:
  * This backup contains your Google Play signing identity.
  * Losing it means you can NEVER update the app on Play Store.
  * The keystore.properties file contains the password IN PLAIN TEXT.
  * Keep this folder off cloud sync unless the sync is end-to-end encrypted.

Build APK using these files:
  1. Copy both files back to android\app\
  2. cd android ; .\gradlew assembleRelease
"@

Set-Content -Path (Join-Path $BackupDir "BACKUP_INFO.txt") -Value $Info

Write-Host "OK  Backup saved to: $BackupDir" -ForegroundColor Green
Write-Host ""
Write-Host "Files in this backup:"
Get-ChildItem $BackupDir | ForEach-Object { Write-Host "  * $($_.Name) ($([math]::Round($_.Length/1024,1)) KB)" }
Write-Host ""
Write-Host "===================================================================="
Write-Host "  Next step: copy $BackupRoot to OFF-MACHINE storage"
Write-Host "===================================================================="
Write-Host ""
Write-Host "  Recommended: at least ONE of the following after EACH backup"
Write-Host "    1. USB drive kept in a drawer (simplest)"
Write-Host "    2. Password manager attachment (1Password, Bitwarden)"
Write-Host "    3. Encrypted cloud drive with 2FA"
Write-Host ""
Write-Host "  List all backups anytime with:"
Write-Host "     Get-ChildItem $BackupRoot"
Write-Host ""
