#Requires -Version 5.1
<#
.SYNOPSIS
  SOSphere - deploy + rebuild + install + trace in one shot.

.DESCRIPTION
  Runs the full fix-and-test sequence safely:
    1. Preflight: verifies supabase CLI, node, npx, adb, and the target device.
    2. Deploys the sos-alert Edge Function (applies the E.164 server-side fix).
    3. Builds the Vite client.
    4. Syncs + installs the APK on the OPPO device (UCEUKRY9RCYDE6TC).
    5. Clears logcat, launches the app, and captures the key events
       (phone-utils migration, directCall bridge, SOS fan-out diagnostics).

  Safe to re-run. Stops on the first failing step and prints a clear
  diagnostic instead of cascading into more errors.

  ASCII-only by design so PowerShell 5.1 (Windows-1252 default) loads it
  without mojibake.

.PARAMETER Device
  adb device serial. Defaults to UCEUKRY9RCYDE6TC (OPPO / Realme).

.PARAMETER SkipDeploy
  Skip the supabase functions deploy step.

.PARAMETER SkipBuild
  Skip npm run build + cap sync + install steps; just relaunch + trace.

.EXAMPLE
  .\sosphere-fix-and-test.ps1
    Run the full chain.

.EXAMPLE
  .\sosphere-fix-and-test.ps1 -SkipDeploy

.EXAMPLE
  .\sosphere-fix-and-test.ps1 -SkipDeploy -SkipBuild
#>

[CmdletBinding()]
param(
  [string]$Device = "UCEUKRY9RCYDE6TC",
  [switch]$SkipDeploy,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# --- helpers -----------------------------------------------------------------

function Write-Section([string]$text) {
  Write-Host ""
  Write-Host ("=" * 72) -ForegroundColor Cyan
  Write-Host $text -ForegroundColor Cyan
  Write-Host ("=" * 72) -ForegroundColor Cyan
}

function Write-Step([string]$text) {
  Write-Host "  > $text" -ForegroundColor Yellow
}

function Write-Ok([string]$text) {
  Write-Host "  [OK] $text" -ForegroundColor Green
}

function Write-Fail([string]$text) {
  Write-Host "  [FAIL] $text" -ForegroundColor Red
}

function Require-Cmd([string]$name, [string]$install) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Fail "$name not found in PATH."
    Write-Host ("    Install: " + $install) -ForegroundColor Gray
    exit 1
  }
  $src = $cmd.Source
  Write-Ok ("{0} at {1}" -f $name, $src)
}

function Require-File([string]$path, [string]$hint) {
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Fail ("Missing: " + $path)
    Write-Host ("    " + $hint) -ForegroundColor Gray
    exit 1
  }
}

# --- step 1: preflight -------------------------------------------------------

Write-Section "1/5  Preflight"

$projectRoot = $PSScriptRoot
if (-not $projectRoot) { $projectRoot = (Get-Location).Path }
Set-Location -LiteralPath $projectRoot
Write-Ok ("project root: " + $projectRoot)

Require-File "package.json"                       "Run this script from the sosphere-platform root."
$capConfig = @("capacitor.config.ts","capacitor.config.js","capacitor.config.json") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $capConfig) {
  Write-Fail "Missing Capacitor config (capacitor.config.ts/js/json)."
  Write-Host "    Not in a Capacitor project root?" -ForegroundColor Gray
  exit 1
}
Write-Ok ("capacitor config: " + $capConfig)
Require-File "supabase/functions/sos-alert/index.ts" "Edge Function source missing."

Require-Cmd "node"     "https://nodejs.org/ (LTS)"
Require-Cmd "npx"      "Comes with Node.js"
Require-Cmd "adb"      "Android Platform Tools - https://developer.android.com/tools/releases/platform-tools"

# Soft-check for supabase CLI: auto-skip deploy instead of hard-failing.
if (-not $SkipDeploy) {
  $supabaseCmd = Get-Command supabase -ErrorAction SilentlyContinue
  if (-not $supabaseCmd) {
    Write-Host "  [WARN] supabase CLI not found - skipping Edge Function deploy." -ForegroundColor Yellow
    Write-Host "         To deploy later: scoop install supabase  (or see supabase.com/docs/guides/local-development/cli)" -ForegroundColor Gray
    $SkipDeploy = $true
  } else {
    Write-Ok ("supabase at " + $supabaseCmd.Source)
  }
}

Write-Step "adb devices"
$rawDevices = & adb devices 2>&1
$devMatch = $rawDevices | Where-Object { $_ -match "^\S+\s+device$" }
if (-not $devMatch -or ($devMatch -notmatch [regex]::Escape($Device))) {
  Write-Fail ("Device '" + $Device + "' not connected / authorized.")
  Write-Host "    Visible devices:" -ForegroundColor Gray
  $rawDevices | ForEach-Object { Write-Host ("      " + $_) -ForegroundColor Gray }
  Write-Host "    Fix: plug device in, approve USB debugging prompt, then re-run." -ForegroundColor Gray
  exit 1
}
Write-Ok ("device " + $Device + " connected")

# --- step 2: deploy edge function -------------------------------------------

if (-not $SkipDeploy) {
  Write-Section "2/5  Deploy sos-alert Edge Function"
  Write-Step "supabase functions deploy sos-alert"
  & supabase functions deploy sos-alert
  if ($LASTEXITCODE -ne 0) {
    Write-Fail ("Edge Function deploy failed (exit " + $LASTEXITCODE + ").")
    Write-Host "    Common causes:" -ForegroundColor Gray
    Write-Host "      * Not logged in: run -> supabase login" -ForegroundColor Gray
    Write-Host "      * No linked project: run -> supabase link --project-ref <ref>" -ForegroundColor Gray
    exit 1
  }
  Write-Ok "sos-alert deployed"
} else {
  Write-Section "2/5  Deploy (skipped)"
}

# --- step 3: build client ----------------------------------------------------

if (-not $SkipBuild) {
  Write-Section "3/5  Build client + sync Android"

  Write-Step "npm run build"
  & npm run build
  if ($LASTEXITCODE -ne 0) { Write-Fail "npm run build failed"; exit 1 }
  Write-Ok "vite bundle built"

  Write-Step "npx cap sync android"
  & npx cap sync android
  if ($LASTEXITCODE -ne 0) { Write-Fail "cap sync failed"; exit 1 }
  Write-Ok "android assets synced"

  Write-Step ("npx cap run android --target " + $Device)
  & npx cap run android --target $Device
  if ($LASTEXITCODE -ne 0) { Write-Fail "cap run failed"; exit 1 }
  Write-Ok "APK installed + launched"
} else {
  Write-Section "3/5  Build (skipped)"
  Write-Step "relaunching installed app"
  & adb -s $Device shell am force-stop com.sosphere.app | Out-Null
  & adb -s $Device shell monkey -p com.sosphere.app -c android.intent.category.LAUNCHER 1 | Out-Null
  Write-Ok "launched"
}

# --- step 4: inspect stored contacts ----------------------------------------

Write-Section "4/5  Stored emergency contact (after migration)"

# Give the app a moment to mount + run the phone-utils migration.
Start-Sleep -Seconds 5

Write-Step "pulling localStorage snapshot from WebView"
$snapshotDir = Join-Path $projectRoot ".sosphere-debug"
if (Test-Path $snapshotDir) { Remove-Item -Recurse -Force $snapshotDir }
New-Item -ItemType Directory -Force -Path $snapshotDir | Out-Null

# LocalStorage for Capacitor apps lives under:
#   /data/data/com.sosphere.app/app_webview/Default/Local Storage/leveldb/
# We stream a tar archive out of the app sandbox via run-as and extract it
# locally. This is the only way to read WebView leveldb on a user-build
# device without rooting.
$tarPath = Join-Path $snapshotDir "ls.tar"
# IMPORTANT: PowerShell 5.1's '>' adds BOM and does CRLF translation, which
# destroys binary tar output from adb exec-out. Use Start-Process with
# -RedirectStandardOutput which preserves raw bytes as-is.
$adbExe = (Get-Command adb).Source
$adbArgs = @(
  "-s", $Device,
  "exec-out",
  "run-as com.sosphere.app tar -c 'app_webview/Default/Local Storage/leveldb' 2>/dev/null"
)
try {
  $p = Start-Process -FilePath $adbExe -ArgumentList $adbArgs `
         -RedirectStandardOutput $tarPath -NoNewWindow -Wait -PassThru
  $tarInfo = Get-Item $tarPath -ErrorAction SilentlyContinue
  if ($tarInfo -and $tarInfo.Length -gt 0) {
    Write-Ok ("tar pulled: " + $tarInfo.Length + " bytes")
    Push-Location $snapshotDir
    try { & tar -xf $tarPath 2>$null } catch { }
    Pop-Location
  } else {
    Write-Host "  (tar archive empty - run-as may be blocked or tar missing on device)" -ForegroundColor DarkGray
  }
} catch {
  Write-Host ("  (exec-out failed: " + $_.Exception.Message + ")") -ForegroundColor DarkGray
}

# Fallback: if tar extraction produced nothing, try reading the leveldb log
# file directly via run-as cat + base64. Slower but works when tar is missing.
if (-not (Get-ChildItem -Path $snapshotDir -Recurse -Include "*.log","*.ldb" -ErrorAction SilentlyContinue)) {
  Write-Step "fallback: base64 read of leveldb files"
  $listRaw = & adb -s $Device shell "run-as com.sosphere.app ls 'app_webview/Default/Local Storage/leveldb' 2>/dev/null"
  $files = $listRaw -split "`r?`n" | Where-Object { $_ -match '\.(log|ldb)$' }
  foreach ($f in $files) {
    $safe = $f.Trim()
    if (-not $safe) { continue }
    $b64 = & adb -s $Device shell "run-as com.sosphere.app cat 'app_webview/Default/Local Storage/leveldb/$safe' 2>/dev/null | base64 -w0"
    if ($b64) {
      $bytes = [Convert]::FromBase64String(($b64 -join ""))
      [IO.File]::WriteAllBytes((Join-Path $snapshotDir $safe), $bytes)
    }
  }
}

$ldbFiles = Get-ChildItem -Path $snapshotDir -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in ".ldb", ".log" }

if ($ldbFiles) {
  $hits = $ldbFiles | Select-String -Pattern "sosphere_emergency_contacts" -List -ErrorAction SilentlyContinue
  if ($hits) {
    Write-Ok "found leveldb entry for sosphere_emergency_contacts"
    $bytes = [System.IO.File]::ReadAllBytes($hits[0].Path)
    $text  = -join ($bytes | ForEach-Object { if ($_ -ge 32 -and $_ -lt 127) { [char]$_ } else { " " } })
    $idx   = $text.IndexOf("sosphere_emergency_contacts")
    if ($idx -ge 0) {
      $winLen = [Math]::Min(600, $text.Length - $idx + 10)
      $window = $text.Substring([Math]::Max(0, $idx - 10), $winLen)
      Write-Host ""
      Write-Host "    -- localStorage window --" -ForegroundColor DarkGray
      Write-Host ("    " + $window) -ForegroundColor Gray
    }
  } else {
    Write-Host "  (key not found yet - app may still be initializing)" -ForegroundColor DarkGray
  }
} else {
  Write-Host "  (could not read leveldb - run-as may be blocked on release build)" -ForegroundColor DarkGray
}

# --- step 5: live logcat capture --------------------------------------------

Write-Section "5/5  Live trace - press SOS on the device now"

Write-Host ""
Write-Host "    Clearing logcat and capturing ONLY relevant tags." -ForegroundColor Gray
Write-Host "    Open the app -> long-press SOS -> wait 15s -> watch this window." -ForegroundColor Gray
Write-Host "    Press Ctrl-C here to stop." -ForegroundColor Gray
Write-Host ""

& adb -s $Device logcat -c
# Tags to watch:
#   SOSphere-Dialer    : ACTION_CALL / ACTION_DIAL bridge path
#   SOSphere.CallState : call pickup/hangup receiver
#   chromium           : WebView console.* (phone-utils migration, sos-server-trigger, Path B)
#   Capacitor          : plugin bridge errors
& adb -s $Device logcat SOSphere-Dialer:V SOSphere.CallState:V chromium:I Capacitor:V *:S
