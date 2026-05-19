# ============================================================================
# R-55 — Upload FCM Service Account JSON to Supabase Secrets
# ----------------------------------------------------------------------------
# Reads the Firebase Admin SDK private-key JSON from Downloads, validates
# it matches our project, minifies to a single line, and stores it as
# Supabase secret FCM_SERVICE_ACCOUNT_JSON. Used by the FCM HTTP v1 path
# in send-push-notification edge function (R-54).
#
# SECURITY NOTES:
#   • The JSON file contains a PRIVATE KEY. Never commit it.
#   • This script does NOT echo the private key to the console.
#   • After upload it prompts you to MOVE the file to a secure location
#     (recommended) or DELETE it.
#
# USAGE: .\scripts\upload-fcm-service-account.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# ── 1. Locate the file ──────────────────────────────────────────────────
$downloadsPath = Join-Path $env:USERPROFILE "Downloads"
$pattern = "sosphere-809bb-firebase-adminsdk-fbsvc-*.json"
$candidates = @(Get-ChildItem -Path $downloadsPath -Filter $pattern -ErrorAction SilentlyContinue)

if ($candidates.Count -eq 0) {
    # Try without the .json extension (sometimes browser strips it)
    $pattern2 = "sosphere-809bb-firebase-adminsdk-fbsvc-*"
    $candidates = @(Get-ChildItem -Path $downloadsPath -Filter $pattern2 -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer })
}

if ($candidates.Count -eq 0) {
    Write-Host "ERROR: no service account file found in $downloadsPath matching $pattern" -ForegroundColor Red
    Write-Host "  Re-download from Firebase Console -> Project Settings -> Service Accounts -> Generate new private key" -ForegroundColor Yellow
    exit 1
}

if ($candidates.Count -gt 1) {
    Write-Host "Multiple candidates found — using the newest:" -ForegroundColor Yellow
    $candidates | Sort-Object LastWriteTime -Descending | ForEach-Object { Write-Host "    $($_.Name)  (last write: $($_.LastWriteTime))" }
    $jsonFile = ($candidates | Sort-Object LastWriteTime -Descending)[0]
} else {
    $jsonFile = $candidates[0]
}

Write-Host ""
Write-Host "── Found service account file ────────────────────────" -ForegroundColor Cyan
Write-Host "  Path:  $($jsonFile.FullName)"
Write-Host "  Size:  $($jsonFile.Length) bytes"

# ── 2. Parse and validate ───────────────────────────────────────────────
Write-Host ""
Write-Host "── Validating structure ──────────────────────────────" -ForegroundColor Cyan
$rawContent = Get-Content -Path $jsonFile.FullName -Raw -Encoding UTF8
$json = $null
try {
    $json = $rawContent | ConvertFrom-Json
} catch {
    Write-Host "ERROR: file is not valid JSON: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Required fields per Google's service account schema
$required = @("type", "project_id", "private_key_id", "private_key", "client_email", "client_id")
$missing = @()
foreach ($f in $required) {
    if ([string]::IsNullOrWhiteSpace($json.$f)) { $missing += $f }
}
if ($missing.Count -gt 0) {
    Write-Host "ERROR: required fields missing: $($missing -join ', ')" -ForegroundColor Red
    exit 1
}

if ($json.type -ne "service_account") {
    Write-Host "ERROR: expected type='service_account', got '$($json.type)'" -ForegroundColor Red
    exit 1
}

if ($json.project_id -ne "sosphere-809bb") {
    Write-Host "ERROR: expected project_id='sosphere-809bb', got '$($json.project_id)'" -ForegroundColor Red
    Write-Host "  Did you download a key from the wrong project?" -ForegroundColor Yellow
    exit 1
}

# Sanity-check the private key looks like a real PEM
if (-not $json.private_key.StartsWith("-----BEGIN PRIVATE KEY-----")) {
    Write-Host "ERROR: private_key does not look like a PEM-formatted RSA key" -ForegroundColor Red
    exit 1
}

Write-Host "  type         = $($json.type)" -ForegroundColor Green
Write-Host "  project_id   = $($json.project_id)" -ForegroundColor Green
Write-Host "  client_email = $($json.client_email)" -ForegroundColor Green
Write-Host "  private_key  = -----BEGIN PRIVATE KEY-----... (length=$($json.private_key.Length) chars)" -ForegroundColor Green

# ── 3. Minify (single line) for Supabase secret upload ──────────────────
Write-Host ""
Write-Host "── Minifying JSON for upload ─────────────────────────" -ForegroundColor Cyan
# ConvertTo-Json with -Compress and depth 10 keeps everything single-line.
# Important: re-serialize from parsed object, NOT regex on raw text — this
# guarantees a valid single-line JSON even if the source was pretty-printed.
$minified = $json | ConvertTo-Json -Depth 10 -Compress
Write-Host "  Minified length: $($minified.Length) chars (single line)" -ForegroundColor Green

# ── 4. Check supabase CLI is available ──────────────────────────────────
Write-Host ""
Write-Host "── Checking supabase CLI ─────────────────────────────" -ForegroundColor Cyan
$supabaseCmd = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabaseCmd) {
    Write-Host "ERROR: supabase CLI not on PATH. Install: npm install -g supabase" -ForegroundColor Red
    exit 1
}
$ver = & supabase --version 2>&1
Write-Host "  supabase CLI: $ver" -ForegroundColor Green

# ── 5. Upload via --env-file (safer than command-line arg with quoting) ─
Write-Host ""
Write-Host "── Uploading to Supabase as FCM_SERVICE_ACCOUNT_JSON ─" -ForegroundColor Cyan

# Write minified JSON to a temp env file (key=value format) then call
# supabase secrets set --env-file. This avoids any escaping issues with
# the special chars (\n, =, /, +) in the JSON.
$tmpEnvFile = [System.IO.Path]::GetTempFileName()
try {
    # Single line in env-file format. Wrap the value in literal single quotes
    # so the supabase CLI passes the JSON verbatim (no shell expansion of
    # $-signs etc.).
    "FCM_SERVICE_ACCOUNT_JSON=$minified" | Set-Content -Path $tmpEnvFile -Encoding UTF8 -NoNewline

    Write-Host "  Calling: supabase secrets set --env-file <temp>"
    & supabase secrets set --env-file $tmpEnvFile 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "supabase secrets set FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
} finally {
    # Always wipe the temp file
    Remove-Item -Path $tmpEnvFile -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "── Verifying upload ──────────────────────────────────" -ForegroundColor Cyan
$secretsList = & supabase secrets list 2>&1
$found = $secretsList -match "FCM_SERVICE_ACCOUNT_JSON"
if ($found) {
    Write-Host "  Verified: FCM_SERVICE_ACCOUNT_JSON present in Supabase secrets list" -ForegroundColor Green
} else {
    Write-Host "  WARNING: secret not visible in 'supabase secrets list' output (may need a moment to propagate)" -ForegroundColor Yellow
}

# ── 6. Offer to secure the source file ──────────────────────────────────
Write-Host ""
Write-Host "── Source file disposition ───────────────────────────" -ForegroundColor Cyan
Write-Host "The file still on disk:"
Write-Host "  $($jsonFile.FullName)"
Write-Host ""
Write-Host "Options:"
Write-Host "  [M] Move to a secure folder (recommended for backup)"
Write-Host "  [D] Delete (you can always re-generate from Firebase Console)"
Write-Host "  [K] Keep where it is (NOT recommended — could be backed up to cloud)"
$choice = Read-Host "Choice (M/D/K)"
switch ($choice.ToUpper()) {
    "M" {
        $secureFolder = Join-Path $env:USERPROFILE ".sosphere-secrets"
        if (-not (Test-Path $secureFolder)) {
            New-Item -ItemType Directory -Path $secureFolder | Out-Null
        }
        $dest = Join-Path $secureFolder $jsonFile.Name
        Move-Item -Path $jsonFile.FullName -Destination $dest -Force
        Write-Host "  Moved to: $dest" -ForegroundColor Green
        Write-Host "  Keep this folder out of OneDrive/Dropbox/iCloud sync paths." -ForegroundColor Yellow
    }
    "D" {
        Remove-Item -Path $jsonFile.FullName -Force
        Write-Host "  Deleted." -ForegroundColor Green
    }
    default {
        Write-Host "  Left in place. WARNING: do not commit, do not screenshot, do not sync." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "FCM Service Account upload complete." -ForegroundColor Green
Write-Host "Next: I will build R-53 (register PushNotifications) and R-54 (dual-path send-push)." -ForegroundColor Cyan
