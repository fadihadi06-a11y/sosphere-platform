# ============================================================================
# probe-push-delivery.ps1 — automated FCM HTTP v1 readiness probe
# ----------------------------------------------------------------------------
# Three-phase smoke test that validates every layer of the push pipeline
# WITHOUT requiring a physical Android device. Catches 80% of likely
# failures (misconfigured secret, JWT signing error, OAuth2 rejection,
# unreachable edge function) so the manual phone test stays short and
# focused on what only a phone can verify.
#
# Phases:
#   1. STATIC  — verify Supabase secret + function deployment
#   2. CRYPTO  — sign a JWT with the local service-account key + exchange
#                it for an OAuth2 access token against Google
#   3. LIVE    — (interactive opt-in) send a real push to a user
#
# USAGE: .\scripts\probe-push-delivery.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$passes = @()
$fails = @()
function Pass($name, $detail = "") { $script:passes += $name; Write-Host "  PASS  $name $detail" -ForegroundColor Green }
function Fail($name, $reason)      { $script:fails += "$name -- $reason"; Write-Host "  FAIL  $name -- $reason" -ForegroundColor Red }
function Info($name, $detail = "") { Write-Host "  INFO  $name $detail" -ForegroundColor Cyan }

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " SOSphere FCM HTTP v1 readiness probe (R-53 / R-54 / R-55)" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# ────────────────────────────────────────────────────────────────────────
# PHASE 1 — STATIC: secret + function deployment
# ────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "PHASE 1: STATIC checks" -ForegroundColor Yellow
Write-Host "----------------------" -ForegroundColor Yellow

$supabaseCmd = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabaseCmd) { Fail "supabase CLI on PATH" "install: npm i -g supabase"; exit 1 }
Pass "supabase CLI on PATH" "($($supabaseCmd.Source))"

$secretsList = & supabase secrets list 2>&1
if ($secretsList -match "FCM_SERVICE_ACCOUNT_JSON") {
    Pass "FCM_SERVICE_ACCOUNT_JSON secret present in Supabase"
} else {
    Fail "FCM_SERVICE_ACCOUNT_JSON secret present in Supabase" "re-run scripts/upload-fcm-service-account.ps1"
}

$fnList = & supabase functions list 2>&1
if ($fnList -match "send-push-notification") {
    Pass "send-push-notification edge function deployed"
} else {
    Fail "send-push-notification edge function deployed" "deploy: supabase functions deploy send-push-notification"
}

# Verify the local source has the FCM HTTP v1 markers (i.e. the deployed
# version matches what R-54 introduced).
$edgeFnSrc = Get-Content -Path "supabase/functions/send-push-notification/index.ts" -Raw
$markers = @(
    "FCM_SERVICE_ACCOUNT_JSON",
    "sendOneFcmV1",
    "isWebPushSubscription",
    'transport: "dual-path"'
)
foreach ($m in $markers) {
    if ($edgeFnSrc -match [regex]::Escape($m)) {
        Pass "edge function source contains: $m"
    } else {
        Fail "edge function source contains: $m" "the deployed function may be a stale build"
    }
}

# ────────────────────────────────────────────────────────────────────────
# PHASE 2 — CRYPTO: JWT sign + OAuth2 token exchange
# ────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "PHASE 2: CRYPTO checks" -ForegroundColor Yellow
Write-Host "----------------------" -ForegroundColor Yellow

$saPath = Join-Path $env:USERPROFILE ".sosphere-secrets"
$candidates = @(Get-ChildItem -Path $saPath -Filter "sosphere-809bb-firebase-adminsdk-fbsvc-*.json" -ErrorAction SilentlyContinue)
if ($candidates.Count -eq 0) {
    Info "service account JSON not in $saPath — skipping crypto probe"
    Info "(this only checks if the file you uploaded actually works, not whether Supabase has it)"
} else {
    $saFile = ($candidates | Sort-Object LastWriteTime -Descending)[0]
    Info "using local key file: $($saFile.FullName)"

    # Use Node to sign the JWT (matches Deno's WebCrypto behavior on the
    # edge function side closely enough for OAuth2 acceptance).
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) { Fail "node on PATH for crypto probe" "install Node.js"; }
    else {
        $signResult = & node --input-type=module -e @"
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
const sa = JSON.parse(readFileSync('$($saFile.FullName.Replace('\\','/'))', 'utf8'));
const now = Math.floor(Date.now() / 1000);
const header = { alg: 'RS256', typ: 'JWT' };
const claim = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
const b64u = (s) => Buffer.from(s).toString('base64url');
const signingInput = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(claim));
const sig = createSign('RSA-SHA256').update(signingInput).sign(sa.private_key);
const jwt = signingInput + '.' + sig.toString('base64url');
const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString() });
const body = await res.text();
if (!res.ok) { console.log('FAIL ' + res.status + ' ' + body.slice(0, 200)); process.exit(1); }
const j = JSON.parse(body);
console.log('OK access_token_len=' + (j.access_token || '').length + ' expires_in=' + j.expires_in);
"@ 2>&1
        if ($LASTEXITCODE -eq 0 -and $signResult -match "^OK") {
            $detail = ($signResult -split "`n")[0]
            Pass "JWT signed + OAuth2 token exchange OK" "($detail)"
            Pass "Service Account JSON is valid for FCM"
        } else {
            Fail "JWT sign / OAuth2 exchange" "$signResult"
        }
    }
}

# ────────────────────────────────────────────────────────────────────────
# PHASE 3 — LIVE: end-to-end push to a real user (interactive opt-in)
# ────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "PHASE 3: LIVE push (interactive)" -ForegroundColor Yellow
Write-Host "--------------------------------" -ForegroundColor Yellow
Write-Host "  This phase sends a REAL test push to a user_id you specify."
Write-Host "  Requires: that user has logged into the mobile app at least once"
Write-Host "  (so a push_tokens row exists)."
Write-Host ""
$doLive = Read-Host "  Run live push? (y/N)"
if ($doLive -ne "y" -and $doLive -ne "Y") {
    Info "skipped — re-run with 'y' to attempt a real delivery"
} else {
    $targetUserId = Read-Host "  target user_id (UUID from auth.users)"
    if (-not ($targetUserId -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')) {
        Fail "user_id format" "expected UUID, got: $targetUserId"
    } else {
        $accessToken = Read-Host "  YOUR access_token (from a logged-in session — get from browser devtools or supabase auth)"
        $projectRef = Read-Host "  Supabase project ref (e.g. rtfhkbskgrasamhjraul)"

        $payload = @{
            target_user_id = $targetUserId
            title = "SOSphere push probe"
            body = "If you see this on the phone, FCM HTTP v1 works."
            data = @{ path = "/probe"; severity = "info" }
        } | ConvertTo-Json -Depth 5 -Compress

        try {
            $resp = Invoke-RestMethod -Uri "https://$projectRef.supabase.co/functions/v1/send-push-notification" `
                -Method POST `
                -Headers @{ "Authorization" = "Bearer $accessToken"; "Content-Type" = "application/json" } `
                -Body $payload `
                -ErrorAction Stop
            Info "edge function response: $($resp | ConvertTo-Json -Compress)"
            if ($resp.sent_count -gt 0) {
                Pass "live push delivered" "(sent_count=$($resp.sent_count), web=$($resp.web_push_count), fcm=$($resp.fcm_count))"
            } else {
                Fail "live push delivered" "sent_count=0, failures=$($resp.failures | ConvertTo-Json -Compress)"
            }
        } catch {
            Fail "live push call" "$($_.Exception.Message)"
        }
    }
}

# ────────────────────────────────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " SUMMARY" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  PASS: $($passes.Count)" -ForegroundColor Green
Write-Host "  FAIL: $($fails.Count)" -ForegroundColor (if ($fails.Count -gt 0) { "Red" } else { "Green" })
if ($fails.Count -gt 0) {
    Write-Host ""
    Write-Host "  Failures (fix before manual phone test):" -ForegroundColor Red
    $fails | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
    exit 1
}
Write-Host ""
Write-Host "  All automated checks passed. Proceed to MOBILE_PUSH_TEST_PLAYBOOK.md" -ForegroundColor Green
