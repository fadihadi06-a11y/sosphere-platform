# SOSphere — Mobile Deployment Guide

**From Tethered Debug to Standalone Android Build**

---

## 1. Current Mobile Framework

SOSphere uses **Capacitor 6** to wrap the React + Vite web app inside a native Android shell. This is not Flutter or React Native — it's your existing web codebase running inside a native WebView with access to device APIs.

**Current configuration:**

| Component | Status |
|---|---|
| Framework | Capacitor 6 via `@capacitor/app ^6.0.0` |
| Android project | Present at `/android` — Gradle, MainActivity, manifest all generated |
| iOS project | Not yet generated (run `npx cap add ios` when ready) |
| `capacitor.config.ts` | **Missing** — must be created (instructions below) |
| Native plugins | Stubs only — `capacitor-bridge.ts` has fallback implementations |
| PWA fallback | Fully configured — manifest.json, service worker, offline caching |
| Package ID | `com.sosphere.app` |
| Min SDK | 24 (Android 7.0) |
| Target SDK | 36 (Android 15) |

**Key insight:** The Android project folder exists and has the correct Gradle structure, but the critical `capacitor.config.ts` file (which tells Capacitor where to find your built web assets) was never created. That's the first fix.

---

## 2. Why the App Only Worked While Connected

When you ran the app on your phone via USB, it worked because Capacitor was serving the app from your PC's **Vite dev server** (`http://localhost:5173` or similar) through a network bridge. The moment you disconnected the cable or the dev server stopped, the WebView had no content to load.

There are three contributing factors:

**A. Live Reload / Dev Server Dependency.** During `npx cap run android`, Capacitor injects a `server.url` pointing to your PC's local IP (e.g., `http://192.168.1.x:5173`). The phone loads all HTML/JS/CSS from that address over the local network. Unplug the cable or stop the Vite dev server, and the WebView shows a blank page.

**B. No Built Assets in the Android Shell.** For a standalone build, Capacitor copies the contents of your `dist/` folder into `android/app/src/main/assets/public/`. If you never ran `npx cap sync` after `vite build`, that assets folder is empty — the app has nothing to render on its own.

**C. Debug Build Expiration.** Android debug APKs signed with the auto-generated debug keystore don't "expire" per se, but they cannot be installed from outside Android Studio easily, and certain APIs (like Google Maps or Firebase Cloud Messaging) reject requests from debug-signed apps if the debug SHA-1 fingerprint isn't registered in the respective console.

---

## 3. Transition to Standalone Build

### Step 1: Create `capacitor.config.ts`

This file must exist in the project root. Create it:

```typescript
// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sosphere.app',
  appName: 'SOSphere',
  webDir: 'dist',
  server: {
    // REMOVE or comment out for standalone builds.
    // Only uncomment during active development with USB:
    // url: 'http://192.168.1.XXX:5173',
    // cleartext: true,

    androidScheme: 'https',
  },
  android: {
    buildOptions: {
      signingType: 'apksigner',
    },
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#05070E',
      showSpinner: false,
    },
  },
};

export default config;
```

**Critical:** The `server.url` line must be **commented out** for standalone builds. When it's active, the app tries to reach your PC instead of using its own bundled files.

### Step 2: Build and Sync

```bash
# 1. Build the web assets
npm run build

# 2. Copy built assets into the Android project
npx cap sync android
```

After `cap sync`, verify the assets are in place:

```bash
ls android/app/src/main/assets/public/
# Should show: index.html, assets/, manifest.json, sw.js, icons, etc.
```

### Step 3: Generate a Standalone APK

**Option A — Debug APK (quick testing):**

```bash
cd android
./gradlew assembleDebug
```

The APK will be at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

Transfer this APK to your phone (via USB, Google Drive, email, etc.) and install it. It will run fully standalone — no PC connection needed.

**Option B — Release APK (production-grade):**

First, generate a signing keystore (one-time):

```bash
keytool -genkey -v -keystore sosphere-release.keystore \
  -alias sosphere -keyalg RSA -keysize 2048 -validity 10000
```

Then configure signing in `android/app/build.gradle` by adding inside the `android {}` block:

```gradle
signingConfigs {
    release {
        storeFile file('../../sosphere-release.keystore')
        storePassword 'YOUR_STORE_PASSWORD'
        keyAlias 'sosphere'
        keyPassword 'YOUR_KEY_PASSWORD'
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

Then build:

```bash
cd android
./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

### Step 4: Install on Device

```bash
# Via ADB (USB connected):
adb install android/app/build/outputs/apk/debug/app-debug.apk

# Or for release:
adb install android/app/build/outputs/apk/release/app-release.apk
```

Or simply transfer the `.apk` file to your phone and tap to install (enable "Install from Unknown Sources" in Android settings).

---

## 4. Service Hardening for Disconnected Operation

Once the app is standalone on the phone, it connects directly to your cloud services over the internet — not through your PC. Here's what to verify:

### Supabase

Your Supabase credentials are baked into the build via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables. These are embedded at build time, so the standalone app connects directly to Supabase's cloud servers. No changes needed — **this already works**.

Verify by checking that your `.env` file has production Supabase values before running `npm run build`.

### Firebase (Push Notifications)

For Firebase Cloud Messaging to work on the standalone Android app:

1. Go to [Firebase Console](https://console.firebase.google.com) → Project Settings → General
2. Under "Your apps" → Android app, verify the package name is `com.sosphere.app`
3. Add your **release signing certificate SHA-1**:
   ```bash
   keytool -list -v -keystore sosphere-release.keystore -alias sosphere
   ```
   Copy the SHA-1 fingerprint and add it in Firebase Console.
4. Download the updated `google-services.json` and place it at:
   ```
   android/app/google-services.json
   ```
5. Rebuild and sync:
   ```bash
   npm run build && npx cap sync android
   ```

The `VITE_FIREBASE_*` environment variables are already embedded at build time for the web-side Firebase SDK. The `google-services.json` handles the native Android side.

### Sentry (Error Tracking)

Sentry uses the `VITE_SENTRY_DSN` environment variable, which is embedded at build time. The standalone app sends errors directly to Sentry's cloud servers over HTTPS. No additional configuration needed — **this already works**.

Verify your `.env` contains:
```
VITE_SENTRY_DSN=https://your-key@o12345.ingest.sentry.io/67890
```

### Offline Resilience

SOSphere already has comprehensive offline support built in:

- **Service Worker** (`public/sw.js`): Caches static assets and provides offline fallback
- **IndexedDB** (`offline-database.ts`): Stores SOS events, GPS trails, and audio locally
- **Emergency Buffer** (`emergency-buffer.ts`): Queues critical events when offline, auto-syncs on reconnect
- **Dead-Sync Detector** (`dead-sync-detector.ts`): Monitors connection and alerts the user

These all work in the standalone build because they use browser APIs available inside the Capacitor WebView.

---

## 5. Execution Plan — Complete Command Sequence

Run these commands from your project root (`Downloads\sosphere-platform`):

```bash
# ── PHASE 1: Prepare ──────────────────────────────────

# Ensure you're on latest code
git pull origin main

# Install Capacitor CLI if not present
npm install @capacitor/cli --save-dev

# Verify .env has production values
# (edit manually — ensure VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
#  VITE_FIREBASE_*, VITE_SENTRY_DSN are all set)

# ── PHASE 2: Create Config ────────────────────────────

# Create capacitor.config.ts (see Section 3, Step 1 above)
# IMPORTANT: Make sure server.url is COMMENTED OUT

# ── PHASE 3: Build ────────────────────────────────────

# Build the production web bundle
npm run build

# Sync web assets into the Android project
npx cap sync android

# Verify assets were copied
dir android\app\src\main\assets\public\
# (should see index.html, assets folder, etc.)

# ── PHASE 4: Generate APK ─────────────────────────────

# Navigate to Android project
cd android

# Build debug APK (no signing key needed)
gradlew assembleDebug

# The APK is now at:
# android\app\build\outputs\apk\debug\app-debug.apk

# ── PHASE 5: Install ──────────────────────────────────

# Option A: Via ADB (USB connected)
adb install app\build\outputs\apk\debug\app-debug.apk

# Option B: Transfer the APK file to your phone manually
# and tap to install (enable Unknown Sources first)

# ── PHASE 6: Verify ───────────────────────────────────

# Open the app on your phone
# Disconnect USB
# Verify: app still loads, login works, map loads,
# SOS trigger sends to Supabase, GPS tracks
```

### Quick Re-deploy After Code Changes

After making code changes, the cycle is just three commands:

```bash
npm run build
npx cap sync android
cd android && gradlew assembleDebug
```

Then transfer the new APK to your phone.

---

## Quick Reference Table

| Question | Answer |
|---|---|
| Framework | Capacitor 6 wrapping React + Vite |
| Why it stopped working | Dev server dependency — app loaded from PC, not from bundled assets |
| Fix | `npm run build` → `npx cap sync android` → `gradlew assembleDebug` |
| Config needed | `capacitor.config.ts` with `webDir: 'dist'` and no `server.url` |
| Firebase fix | Add release SHA-1 to Firebase Console, place `google-services.json` in `android/app/` |
| Sentry fix | None needed — DSN baked in at build time |
| Supabase fix | None needed — URL and anon key baked in at build time |
| APK location | `android/app/build/outputs/apk/debug/app-debug.apk` |
| For Play Store | Use `assembleRelease` with a signing keystore |
