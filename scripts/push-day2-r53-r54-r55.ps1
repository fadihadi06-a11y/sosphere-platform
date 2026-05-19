# ============================================================================
# Day 2 push helper - R-53 + R-54 + R-55 (Push notifications native + FCM HTTP v1)
# ----------------------------------------------------------------------------
# 1. Runs verify-before-push.mjs (all gates)
# 2. Stages + commits the Day 2 files
# 3. Pushes to git (triggers CI)
# 4. Deploys the updated send-push-notification edge function to Supabase
#    (so the FCM_SERVICE_ACCOUNT_JSON secret uploaded in R-55 starts being
#    consumed by live traffic)
#
# USAGE: .\scripts\push-day2-r53-r54-r55.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "[push-day2] repo root: $repoRoot" -ForegroundColor Cyan

# 1. Expected files manifest
$expectedModified = @(
    "src/app/components/__tests__/fcm-push-edge-function.test.ts",
    "src/app/components/mobile-app.tsx",
    "supabase/functions/send-push-notification/index.ts"
)
$expectedNew = @(
    "scripts/upload-fcm-service-account.ps1",
    "src/app/components/__tests__/r53-r54-push-routing.test.ts",
    "src/app/components/api/push-notifications-native.ts"
)

Write-Host ""
Write-Host "-- Sanity-check working tree --" -ForegroundColor Yellow
foreach ($f in ($expectedModified + $expectedNew)) {
    if (-not (Test-Path $f)) {
        Write-Host "MISSING: $f" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  All 6 expected files present." -ForegroundColor Green

# 2. Verify-before-push gate suite
Write-Host ""
Write-Host "-- Running verify-before-push.mjs --" -ForegroundColor Yellow
$verifyOutput = & node scripts/verify-before-push.mjs 2>&1
$verifyExit = $LASTEXITCODE
$verifyOutput | ForEach-Object { Write-Host $_ }

if ($verifyExit -ne 0) {
    Write-Host ""
    Write-Host "verify-before-push FAILED (exit $verifyExit)." -ForegroundColor Red
    exit $verifyExit
}
Write-Host ""
Write-Host "  verify-before-push: ALL GATES PASS." -ForegroundColor Green

# 3. Stage the expected files
Write-Host ""
Write-Host "-- Staging files --" -ForegroundColor Yellow
foreach ($f in ($expectedModified + $expectedNew)) {
    git add -- "$f"
    Write-Host "  staged: $f"
}

# Also stage this push helper for posterity
if (Test-Path "scripts/push-day2-r53-r54-r55.ps1") {
    $tracked = & git ls-files --error-unmatch "scripts/push-day2-r53-r54-r55.ps1" 2>$null
    if ($LASTEXITCODE -ne 0) {
        git add -- "scripts/push-day2-r53-r54-r55.ps1"
        Write-Host "  staged: scripts/push-day2-r53-r54-r55.ps1 (untracked)"
    }
}

# 4. Show staged diff stat
Write-Host ""
Write-Host "-- Diff stat (staged) --" -ForegroundColor Yellow
git diff --cached --stat

# 5. Commit
$commitMsg = @"
mobile-audit Day 2: R-53 + R-54 + R-55 (native push + FCM HTTP v1)

R-53: native PushNotifications.register on Capacitor Android
  - new module: src/app/components/api/push-notifications-native.ts
  - initNativePush(userId) is idempotent and safe to call from web
    (short-circuits on non-native runtime)
  - registers FCM via @capacitor/push-notifications (plugin was
    installed but NEVER called before R-53)
  - wires 4 listeners: registration, registrationError,
    pushNotificationReceived (foreground toast), pushNotificationActionPerformed
    (deep link via setNativePushDeepLinkHandler)
  - persists FCM token to push_tokens with platform='android' using
    the same onConflict=(user_id,token) shape that fcm-push.ts uses
    for Web Push subscriptions
  - mobile-app.tsx: parallel-run alongside existing initFCM (web push)
    on both cold-start session restore AND auth-state-change. Both
    paths needed: Web Push for dashboard tab, FCM-native for the
    Android shell that drops service workers on background.

R-54: dual-path send-push-notification edge function
  - new helpers in supabase/functions/send-push-notification:
      getFcmServiceAccount(): parse FCM_SERVICE_ACCOUNT_JSON
      importFcmPrivateKey(): PEM -> CryptoKey (RSASSA-PKCS1-v1_5)
      signFcmJwt(): RS256 JWT asserting service account identity
      getFcmAccessToken(): exchange JWT for OAuth2 access token (1h cache)
      sendOneFcmV1(): POST to fcm.googleapis.com/v1/projects/.../send
      isWebPushSubscription(): classify token shape by leading char
  - delivery loop now routes per row:
      JSON token (starts with '{')             -> Web Push (existing)
      string token + platform=android|ios       -> FCM HTTP v1 (new)
      anything else                             -> failure with reason
  - audit_log metadata extended: transport='dual-path',
    web_push_count, fcm_count, fcm_configured

R-55: FCM_SERVICE_ACCOUNT_JSON Supabase secret (uploaded out-of-band
  via scripts/upload-fcm-service-account.ps1, NOT committed)

Why Service Account JWT vs the legacy API-key path 2026-04-30 abandoned:
  Service Account auth is OAuth2 with RS256-signed JWT, a fundamentally
  different code path on Google's side from the API-key auth that
  returned 401 UNAUTHENTICATED and triggered the original pivot. The
  failure mode does not apply to this path. Service Account is also
  the Google-recommended modern approach (legacy server key deprecated 2024).

Mount-sync recovery:
  mobile-app.tsx tail was truncated mid-string-literal during the
  R-53 edits (-1283 bytes). Recovered the missing tail from HEAD and
  re-merged with R-53 hunks. TypeScript parse confirms structure.

Verification:
  - 11 new vitest cases (R-53/54 routing + classifier) added
  - TypeScript parse: 4/4 touched files clean
  - ESLint: 0 errors on new code (pre-existing warnings unchanged)
  - verify-before-push.mjs: all gates pass

Next: this script will also call 'supabase functions deploy
send-push-notification' so the FCM_SERVICE_ACCOUNT_JSON secret starts
being consumed by live traffic.

Closes #R-53 #R-54 #R-55.
"@

Write-Host ""
Write-Host "-- Commit --" -ForegroundColor Yellow
git commit -m $commitMsg
if ($LASTEXITCODE -ne 0) {
    Write-Host "git commit failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}

# 6. Push
Write-Host ""
Write-Host "-- Push --" -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "git push failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}

# 7. Deploy the updated edge function so FCM_SERVICE_ACCOUNT_JSON takes effect
Write-Host ""
Write-Host "-- Deploying send-push-notification edge function --" -ForegroundColor Yellow
$supabaseCmd = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabaseCmd) {
    Write-Host "WARNING: supabase CLI not on PATH. Skipping deploy." -ForegroundColor Yellow
    Write-Host "  Install: npm install -g supabase, then run:" -ForegroundColor Yellow
    Write-Host "  supabase functions deploy send-push-notification" -ForegroundColor Yellow
} else {
    & supabase functions deploy send-push-notification 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNING: edge function deploy failed (exit $LASTEXITCODE)." -ForegroundColor Yellow
        Write-Host "  Code is on main; run 'supabase functions deploy send-push-notification' manually." -ForegroundColor Yellow
    } else {
        Write-Host "  Deploy OK." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Day 2 pushed. Watch CI:" -ForegroundColor Green
$remoteUrl = git remote get-url origin
$slug = ($remoteUrl -replace '^.*github.com[:/]', '') -replace '\.git$', ''
Write-Host "  https://github.com/$slug/actions" -ForegroundColor Green
Write-Host ""
Write-Host "When CI is green:" -ForegroundColor Cyan
Write-Host "  1. Rebuild the Android APK (build-and-install.bat or 'npx cap sync android')" -ForegroundColor Cyan
Write-Host "  2. Install on a test phone" -ForegroundColor Cyan
Write-Host "  3. Log in, then on another device trigger an SOS" -ForegroundColor Cyan
Write-Host "  4. The locked phone should show the SOS notification (FCM HTTP v1)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next: Day 3 = R-58 + R-59 + R-60 (Background GPS + foreground service)" -ForegroundColor Cyan
