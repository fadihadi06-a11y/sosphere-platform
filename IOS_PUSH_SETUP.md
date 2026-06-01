# iOS Push Notifications — Manual Setup (Phase 2 CRIT-5 Layer B)

**Status as of 2026-06-01:**
- ✅ **Layer A (code)**: `push-notifications-native.ts` now detects platform via `Capacitor.getPlatform()` and tags tokens correctly (was hardcoded `"android"`). The data plane is honest the moment iOS devices register.
- ⚠️ **Layer B (this doc)**: iOS native shell does not exist yet. Until the steps below are completed, iOS users running the web build get only Web Push (when permission granted in Safari), and iOS users on the native shell get nothing because the shell does not exist to receive.

This is **out of code scope** — it requires an Apple Developer account, Firebase console access, and a Mac to run `npx cap add ios` + Xcode. The steps are documented here so the work is reproducible and reviewable.

## Prerequisites

- macOS workstation with Xcode 15+
- Apple Developer Program membership ($99/yr) — needed for APNs auth key
- Firebase project already exists for the Android app (look in `.env` for `VITE_FIREBASE_PROJECT_ID`)
- Bundle identifier decision (default suggestion: `com.sosphere.app` — must match the Android `applicationId`)

## Step 1 — Add iOS Capacitor platform

```bash
cd /path/to/sosphere-platform
npx cap add ios
npx cap sync ios
```

This creates `ios/App/App.xcodeproj` and downloads Capacitor's iOS runtime. **Do not modify** the generated files by hand; Capacitor rewrites them on every `cap sync`.

## Step 2 — Enable Push capability in Xcode

```bash
npx cap open ios
```

In Xcode:

1. Select the **App** target → **Signing & Capabilities** tab
2. Click **+ Capability** → search **Push Notifications** → add it
3. Click **+ Capability** → search **Background Modes** → add it → check `Remote notifications`
4. Verify the bundle identifier matches `com.sosphere.app`

This writes `App.entitlements` with `aps-environment` and updates `Info.plist`.

## Step 3 — APNs Auth Key (in Apple Developer console)

1. Sign in to https://developer.apple.com/account → **Certificates, Identifiers & Profiles** → **Keys**
2. Click **+** to register a new key
3. Name it **SOSphere APNs Push Key**
4. Check **Apple Push Notifications service (APNs)**
5. **Continue** → **Register** → **Download** the `.p8` file (you can only download it once)
6. Note the **Key ID** (10 chars) and your **Team ID** (top-right in the developer console)

## Step 4 — Upload APNs Key to Firebase

1. Sign in to https://console.firebase.google.com → select the SOSphere project
2. **Project Settings** (gear icon) → **Cloud Messaging** tab
3. Under **Apple app configuration**, click **Upload** under APNs Authentication Key
4. Upload the `.p8` file from Step 3
5. Paste the **Key ID** and **Team ID**

Firebase now has everything it needs to relay FCM messages to APNs, which then delivers to iOS devices. No code change in the edge function — `send-push-notification` already calls FCM HTTP v1 which routes to APNs transparently when the target token is iOS.

## Step 5 — Register the iOS app in Firebase

1. Same Firebase project → **Add app** → iOS icon
2. Bundle ID: `com.sosphere.app` (must match Xcode)
3. App nickname: `SOSphere iOS`
4. Download `GoogleService-Info.plist`
5. Drag it into Xcode under **App/App** (NOT into a subfolder), check **Copy items if needed**, target **App**

## Step 6 — Verify

```bash
# Build + run on a physical iOS device (push does NOT work in the simulator)
npx cap sync ios
npx cap run ios --target=<your-device-udid>
```

After app launch + sign-in:

1. iOS should prompt for notification permission — accept
2. Check `push_tokens` table in Supabase:
   ```sql
   select user_id, platform, length(token) as token_len, created_at
   from public.push_tokens
   where platform = 'ios'
   order by created_at desc limit 5;
   ```
3. Trigger a test SOS or buddy alert — the iOS device should receive a banner notification

## Troubleshooting

| Symptom | Cause |
|---|---|
| No permission prompt | `Push Notifications` capability missing in Xcode |
| Token registers but no delivery | `GoogleService-Info.plist` wrong bundle ID, OR APNs key uploaded to wrong Firebase project |
| Delivery works in foreground only | `Background Modes → Remote notifications` not checked |
| `aps-environment` mismatch error in Console.app | Build configuration set to Release without distribution provisioning — use Debug build for development |

## Verification command for Capacitor platform detection (Layer A)

To confirm Layer A is working without setting up iOS:

```typescript
// In any TS file that runs in the mobile app:
import { Capacitor } from "@capacitor/core";
console.log("[Platform]", Capacitor.getPlatform());
// → "android" on Android shell
// → "ios"     on iOS shell
// → "web"     in any browser
```

After Layer B is complete, run a quick SQL check:

```sql
select platform, count(*) from public.push_tokens group by platform;
```

You should see rows for both `android` and `ios`, not just `android`.

---

## Why not auto-execute Step 1-6?

Steps 1-6 require:
- A physical Mac (Xcode is macOS-only) → cannot run from CI Linux
- Apple Developer membership tied to a real human Apple ID → not delegatable
- Firebase Console UI clicks → no public API for cert upload at the time of writing

These are operational tasks that fall under the human review surface of branch protection. Document + reproducibility is the world-class deliverable from code.
