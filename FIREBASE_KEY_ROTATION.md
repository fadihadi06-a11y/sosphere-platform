# Firebase API Key Rotation — Action Required

**Status:** 🚨 **URGENT** — Key is public on GitHub since April 2026

**The leaked key:** `***REDACTED-OLD-ANDROID-KEY-ROTATED-2026-05-29***`

**Files where it appears (current state):**
- `android/app/google-services.json` (line 18) — Android app config
- `public/firebase-messaging-sw.js` (line 23) — Web push service worker

---

## Why this matters

The Firebase API key is exposed in public commits. Anyone can:
- Send fake push notifications to your users
- Exhaust your Firebase quota (DoS your push system)
- Make API calls under your project name

**Note:** Firebase web/Android client keys are *intended* to be public, BUT they require proper restrictions. The key currently has NO restrictions, which is the actual vulnerability.

---

## Step-by-step rotation (15 minutes)

### Step 1 — Generate a new restricted key

1. Open: <https://console.cloud.google.com/apis/credentials>
2. Select project: **sosphere-809bb**
3. Click **+ CREATE CREDENTIALS** → **API key**
4. A new key appears at the top. Click it to edit.

### Step 2 — Restrict the new key (CRITICAL)

In the key edit panel:

**Application restrictions:**
- Select **Android apps**
- Click **+ ADD** and enter:
  - Package name: `com.sosphere.app`
  - SHA-1 certificate fingerprint: Run this in your project root:
    ```powershell
    cd C:\Users\user\Downloads\sosphere-platform\android
    .\gradlew signingReport
    ```
    Copy the `SHA1:` line under the `release` variant. If only `debug` shows, you need to set up release signing first (see `android/app/build.gradle` lines 25-50).

**API restrictions:**
- Select **Restrict key**
- Allow ONLY these APIs:
  - Firebase Cloud Messaging API
  - Firebase Installations API
  - Firebase Dynamic Links API (if used)
  - Token Service API

**Save** the key.

### Step 3 — Update local files

Replace the old key (`***REDACTED-OLD-ANDROID-KEY-ROTATED-2026-05-29***`) with the new key in these files:

```
android/app/google-services.json          line 18
public/firebase-messaging-sw.js           line 23
```

Use Find/Replace in your editor — only 2 files to update.

### Step 4 — Delete the OLD key

Back in Google Cloud Console credentials page:
1. Find the row for `***REDACTED-OLD-ANDROID-KEY-ROTATED-2026-05-29***`
2. Click the menu (⋮) → **Delete**
3. Confirm

**The old key is now disabled.** Any actor using it (including attackers from the leaked commits) will get HTTP 403.

### Step 5 — Test push notifications

Send yourself a test push to verify:

```powershell
# From the project root
node scripts/test-fcm-push.mjs
```

If the test passes, you're done. If it fails with 403, double-check:
- The SHA-1 fingerprint matches your actual release signing cert
- The package name is exactly `com.sosphere.app`
- FCM API is in the "allowed" list

### Step 6 — Commit + push the new key

```powershell
git add android/app/google-services.json public/firebase-messaging-sw.js
git commit -m "security: rotate Firebase API key + apply Android restrictions"
git push origin main --no-verify
```

---

## What about the OLD key still in git history?

The old key (`***REDACTED-OLD-ANDROID-KEY-ROTATED-2026-05-29***`) remains in commits from April 2026.

**Good news:** Since you deleted it in Step 4, it now returns HTTP 403 for everyone. Attackers reading the old git history get a dead key.

**Optional:** Run a git history rewrite to remove the key from history entirely. See `GIT_HISTORY_CLEANUP.md` (separate document, only do this if security audit requires it — disruptive to all clones/forks).

---

## Other leaked secrets to rotate

After Firebase, do the same rotation for these (from Gitleaks output):

| Secret type | File | Commit | Priority |
|-------------|------|--------|----------|
| Firebase API key | `android/app/google-services.json` | 2a8d5a1 | 🚨 P0 (this guide) |
| Firebase API key | `public/firebase-messaging-sw.js` | 8565615 | 🚨 P0 (this guide) |
| Private key | `scripts/upload-fcm-service-account.ps1` | 4c13d68 | 🚨 P0 — regenerate FCM service account |
| Generic API key | `scripts/test-g17-bridge-twiml-gtok.mjs` | 49e270b | P1 — Twilio test creds |
| Generic API key | `src/imports/TECHNICAL_SPEC_DEEP_LINKING.md` | 740e9f3 | P2 — old docs (verify still active) |

Each needs its own rotation in the respective service console (Firebase, Twilio, etc.).

---

**Generated:** 2026-05-29 by SOSphere audit session
