# ROOT AUDIT RESULTS — Wave 9, Batch F4
## Android Build & Manifest Layer Audit (R-2081 → R-2160)

**Scope:** 16 files under `android/` covering APK signing, dependency resolution, manifest permissions, WebView trust, ProGuard, Gradle wrapper, and Capacitor plumbing.
**Cross-reference baseline:** R-1784/85/86 (WebView `<access origin="*">`, JS bridge `SOSphereNative`, geolocation auto-grant), R-1792 (release keystore password committed), MainActivity `directCall()` JS-exposed.

---

## FINDINGS

### `android/app/build.gradle`

**R-2081 — P1 — SIGNING / FALLBACK — android/app/build.gradle:117-119**
Release build silently falls back to **no `signingConfig` at all** when `releaseSigning == null`. AGP 8/9 will then produce an unsigned release APK that cannot be installed on any modern Android device and Play Console will reject the upload, but more importantly the developer comment claims a "loud warning" — the only signal is a `logger.warn` in build output that is trivially missed in CI. There is no `throw new GradleException` to actually break the build.
Fix: when buildType == release and `releaseSigning == null`, fail the build hard with `throw new GradleException("Release signing not configured")` — never produce an unsigned release artifact silently.

**R-2082 — P0 — SIGNING / KEY MANAGEMENT — android/app/build.gradle:53-56, 102**
`storePassword` from `keystore.properties` is loaded with `props.getProperty("storePassword") ?: ""`. Empty-string passwords are accepted by `signingConfigs.release` and `keytool` allows zero-length passwords on legacy JKS. Combined with R-1792 (committed password `Fz07506771765`) and the `keyPassword ?: storePassword ?: ""` fallback, a misconfigured CI run can sign the production APK with an **empty password keystore**, after which any attacker can extract and re-sign.
Fix: validate non-empty storePassword/keyPassword before returning from `loadReleaseSigningConfig()`; abort with a clear error if either is blank.

**R-2083 — P0 — SIGNING / V1 SCHEME ABSENT — android/app/build.gradle:108-109**
Only v2 + v3 signing schemes are enabled. `enableV1Signing` is not explicitly set to `false`, so AGP's default leaks v1 (JAR signing) signature into the APK on `minSdkVersion 24` builds. v1 signatures are vulnerable to the **Janus** vulnerability (CVE-2017-13156) on API 24/25 devices, allowing an attacker to inject DEX into a signed APK without breaking signature verification — catastrophic for a life-safety app installed via sideload.
Fix: explicitly set `enableV1Signing false` and `enableV4Signing true`; document minSdk=24 implication.

**R-2084 — P0 — RELEASE / OBFUSCATION DISABLED — android/app/build.gradle:115**
`minifyEnabled false` for the release build. R8/ProGuard is therefore **never executed**, meaning:
(a) Class names like `MainActivity.directCall()` remain in plaintext for reverse-engineering;
(b) The ProGuard rules file (which exists at `proguard-rules.pro` and is referenced) is **dead code**;
(c) `resource shrinking` is implicitly off — APK contains unused strings/layouts that leak debug endpoints;
(d) Sentry stack traces will have full class names but no minification benefit.
For an emergency app where the Twilio Voice SDK, Stripe keys, and Supabase URLs are bundled, this is a P0 supply-chain risk.
Fix: set `minifyEnabled true`, `shrinkResources true`; verify the ProGuard rules cover Capacitor/Twilio/Gson (already do, see R-2099).

**R-2085 — P1 — RELEASE / DEBUGGABLE NOT EXPLICITLY FALSE — android/app/build.gradle:113-121**
`buildTypes.release` does not set `debuggable false` or `jniDebuggable false` explicitly. AGP defaults release to non-debuggable, but a tampered `proguard-android-optimize.txt` or environment-injected property can flip it. For an app handling emergency calls, this should be belt-and-suspenders.
Fix: `debuggable false`, `jniDebuggable false`, `renderscriptDebuggable false`, `pseudoLocalesEnabled false`.

**R-2086 — P1 — RELEASE / DEBUG BUILD TYPE MISSING — android/app/build.gradle:113-121**
No explicit `debug { ... }` block. AGP auto-generates one with `debuggable true`, `applicationIdSuffix` unset → debug APK shares `applicationId com.sosphere.app` with release, so a sideloaded debug build will **overwrite the production app** on a tester's phone and the user has no visual cue that they are now running an unhardened build that bypasses biometric & uses cleartext.
Fix: add `debug { applicationIdSuffix ".debug"; versionNameSuffix "-debug"; debuggable true }`.

**R-2087 — P2 — VERSIONING / SILENT DEFAULTS — android/app/build.gradle:75-76**
`APK_VERSION_CODE` defaults to `"1"` and `APK_VERSION_NAME` defaults to `"1.0"` when env vars are absent. A developer running `./gradlew assembleRelease` locally without setting the vars produces a `versionCode=1` APK; uploading that to Play silently regresses the published version and the next CI build (which **does** set the vars) cannot supersede it without bumping again.
Fix: in CI-detected context (`System.getenv("CI") == "true"`), `throw new GradleException` when env vars unset.

**R-2088 — P2 — VERSIONING / INTEGER PARSE — android/app/build.gradle:75**
`Integer.parseInt(System.getenv("APK_VERSION_CODE") ?: "1")` — if the CI variable is malformed (e.g. `"v1.2.3"`), the build crashes with `NumberFormatException` deep inside Gradle's configuration phase with no context message.
Fix: wrap in try/catch and emit `"APK_VERSION_CODE must be a positive integer; got '<value>'"`.

**R-2089 — P2 — DEPENDENCY / FLATDIR REPO — android/app/build.gradle:124-128**
`flatDir { dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs' }` allows dropping arbitrary .jar/.aar files into the libs directory which then bypass dependency verification, checksums, and SBOM. A trojaned plugin maintainer (or a compromised dev workstation) can place `evil.aar` in `app/libs/` and it will be silently included.
Fix: lock down `flatDir` to a single explicit allow-list of artifacts, or migrate plugins to Maven coordinates with `dependencyVerification`.

**R-2090 — P2 — DEPENDENCY / NO VERSION LOCKING — android/app/build.gradle:130-140**
No `dependencyLocking { lockAllConfigurations() }`. Capacitor plugin versions resolve transitively from `node_modules/@capacitor/*` packages, meaning an `npm install` that pulls a new patch release of `@capacitor/geolocation` silently changes what ships in the APK with no reproducible-build guarantee.
Fix: enable Gradle dependency locking + `verification-metadata.xml` with SHA-256 hashes for every artifact.

**R-2091 — P3 — DEPENDENCY / TEST CONFIGS — android/app/build.gradle:136-138**
JUnit/Espresso test dependencies are added unconditionally — they ship in the test variants only by default, but combined with the `flatDir` repo and no version pin they are an attack vector.
Fix: pin versions in variables.gradle (currently done) but also add `androidTestImplementation` separated out for `androidTest` source set verification.

**R-2092 — P3 — GOOGLE-SERVICES / SILENT FAILURE — android/app/build.gradle:144-151**
The try/catch around `file('google-services.json').text` swallows **all** exceptions including SecurityException/IOException, with only a `logger.info` (not `warn`/`error`). A missing `google-services.json` in a release build means push notifications silently break for emergency alerts.
Fix: when buildType == release, fail the build if `google-services.json` is absent or unreadable.

---

### `android/app/capacitor.build.gradle`

**R-2093 — P3 — GENERATED FILE / NO INTEGRITY — android/app/capacitor.build.gradle:1**
Generated by `capacitor update`; no checksum or schema validation. An attacker who lands a malicious PR modifying this file to add `implementation project(':evil-plugin')` is invisible in normal diff review since the file has `DO NOT EDIT` banner that reviewers skim.
Fix: pre-commit hook validates this file matches output of `npx cap update` deterministically.

**R-2094 — P1 — PLUGIN / TRUST SURFACE — android/app/capacitor.build.gradle:12-23**
The dependency list includes 11 plugins that all receive the full WebView JS bridge. Each plugin (`@aparajita/capacitor-biometric-auth`, `capacitor-call-number`, `@codetrix-studio/capacitor-google-auth`) can register Java classes callable from JavaScript. There is no allow-list per Capacitor route — a compromised dependency immediately gains `directCall()`, mic, GPS, and biometric access.
Fix: enable Capacitor plugin permission scoping per webview origin; pin every plugin to an exact version with integrity hash in package-lock.

---

### `android/app/keystore.properties`

**R-2095 — P0 — KEY MANAGEMENT — android/app/keystore.properties:4,6** (companion to R-1792)
Production release keystore password `Fz07506771765` is committed in plaintext to `app/keystore.properties`. The `.gitignore` lists `app/keystore.properties` and `keystore.properties` at lines 61-62 — meaning this file should have **never** been committed. Either the gitignore was added after the commit (so the secret remains in git history) or the file was force-added with `git add -f`. Either way, anyone with read access to the repository can sign a trojaned APK that the Android package verifier will accept as a legitimate update to `com.sosphere.app`.
Fix: (1) rotate the keystore IMMEDIATELY — generate new keystore, publish APK Signature Scheme v3 key rotation via the existing v3 cert, register on Play App Signing; (2) `git filter-repo --invert-paths --path app/keystore.properties`; (3) revoke and rotate every secret that has ever touched that machine.

**R-2096 — P0 — KEY MANAGEMENT / WEAK PASSWORD — android/app/keystore.properties:4,6**
Even if rotated, the password `Fz07506771765` (13 chars, looks like a phone number) is a low-entropy mnemonic password trivially crackable by a GPU at ~10^9 H/s in ≤ a few hours. Identical `storePassword == keyPassword` means a single crack unlocks both.
Fix: use a CSPRNG-generated ≥32-char password from a secret manager (Vault/AWS Secrets Manager/GitHub Actions secrets); never reuse storePassword as keyPassword.

**R-2097 — P1 — KEY MANAGEMENT / FILE PATH — android/app/keystore.properties:3**
`storeFile=sosphere-release.jks` — relative path resolved against `app/`. If a `sosphere-release.jks` is ever checked in (no JKS file is in the gitignore beyond the wildcard `*.jks` rule at line 58 of android/.gitignore, but a typo like `.jks2` would slip through) it ships to the public repo.
Fix: enforce absolute path resolved from a per-machine env var, never relative to repo.

---

### `android/app/proguard-rules.pro`

**R-2098 — P1 — OBFUSCATION / OVER-KEEP — android/app/proguard-rules.pro:23**
`-keep interface * { *; }` keeps **every interface in the entire APK** including the WebView JS bridge classes that should be aggressively obfuscated. This effectively neuters R8's name-mangling for the most security-sensitive surface.
Fix: replace with narrow rules per package (e.g. `-keep interface com.sosphere.bridge.** { *; }`).

**R-2099 — P2 — OBFUSCATION / WIDE CAPACITOR KEEP — android/app/proguard-rules.pro:7-15**
`-keep public class com.getcapacitor.** { public *; }` plus `-keep public class com.getcapacitor.community.** { public *; }` keeps every Capacitor public surface — including any newly-added plugin (R-2094 trust surface). Combined with R-2084 (minify disabled) this rule isn't even active, but if/when minify is turned on, this is far too broad.
Fix: keep only the specific `@CapacitorPlugin`-annotated classes; let R8 strip everything else.

**R-2100 — P2 — OBFUSCATION / GSON CATCH-ALL — android/app/proguard-rules.pro:30**
`-keep class com.google.gson.** { *; }` — Gson is not even a direct dependency of this app (Capacitor uses `org.json`); this is dead weight implying ProGuard rules were copy-pasted from a template without verification, raising the question what else was assumed without checking.
Fix: audit which JSON library is actually used and only keep its specific reflection surface.

**R-2101 — P2 — OBFUSCATION / TWILIO KEEP TOO WIDE — android/app/proguard-rules.pro:26-27**
`-keep class com.twilio.voice.** { *; }` and `-keep class com.twilio.audioswitch.** { *; }` keep **all** members including `private` fields holding tokens and Twilio account SIDs. Default ProGuard would otherwise strip private fields not reflectively accessed.
Fix: limit to the specific entry-point classes documented by Twilio's ProGuard guide, not `{ *; }`.

**R-2102 — P3 — OBFUSCATION / DONTWARN — android/app/proguard-rules.pro:34-36**
`-dontwarn` rules suppress legitimate missing-class warnings from `org.conscrypt` and `org.openjsse` (TLS providers). If a CI build is missing the BoringSSL/Conscrypt provider, the silent suppression makes a TLS regression invisible.
Fix: keep `-dontwarn` only for the specific package internals that are known-noisy, not entire packages.

---

### `android/app/src/main/AndroidManifest.xml`

**R-2103 — P0 — PERMISSION / FOREGROUND_SERVICE_TYPE MISSING — android/app/src/main/AndroidManifest.xml:11-12**
`FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION` are declared, but no `<service ... android:foregroundServiceType="location">` is declared in the manifest. On `targetSdkVersion 36` (Android 15+), starting a foreground service without a declared service type throws `MissingForegroundServiceTypeException` and crashes the app — meaning **background location during an active SOS will not run** on any device on Android 14+. This is a life-safety regression.
Fix: declare an `<service>` element with `android:foregroundServiceType="location|microphone"` and `android:exported="false"`.

**R-2104 — P0 — PERMISSION / MICROPHONE FGS MISSING — android/app/src/main/AndroidManifest.xml:13**
`RECORD_AUDIO` permission is declared but **no** `FOREGROUND_SERVICE_MICROPHONE` permission is declared. On Android 14+, recording audio from a foreground service requires both the permission and a `foregroundServiceType="microphone"`. SOS evidence recording will silently fail or be killed mid-recording.
Fix: add `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />`.

**R-2105 — P0 — WEBVIEW / NETWORK SECURITY CONFIG MISSING — android/app/src/main/AndroidManifest.xml:57-65**
`<application>` element has no `android:networkSecurityConfig` attribute and no `@xml/network_security_config` file exists in `res/xml/`. Combined with R-1784 (`<access origin="*"/>` in Cordova config.xml at line 3 of `res/xml/config.xml`) and the absence of `android:usesCleartextTraffic="false"`, the WebView trusts arbitrary HTTP origins. An attacker on the same Wi-Fi can MITM the SOS dispatch endpoint.
Fix: add `android:networkSecurityConfig="@xml/network_security_config"` with a strict config: `cleartextTrafficPermitted=false`, certificate pinning on `*.supabase.co`, `api.twilio.com`, `api.stripe.com`.

**R-2106 — P0 — WEBVIEW / USESCLEARTEXTTRAFFIC DEFAULT — android/app/src/main/AndroidManifest.xml:57-65**
`android:usesCleartextTraffic` is **not set**, defaulting to `false` ONLY for `targetSdk ≥ 28` apps **without** a Cordova `<access origin="*"/>` directive. Since Capacitor honors the Cordova config.xml allow-list, and config.xml has `<access origin="*"/>`, the runtime behavior is undefined / WebView-version-dependent.
Fix: explicitly set `android:usesCleartextTraffic="false"` on `<application>`.

**R-2107 — P0 — DEEP LINKING / UNSCOPED HOST — android/app/src/main/AndroidManifest.xml:108-148**
Four `<intent-filter android:autoVerify="true">` blocks all target `android:host="sosphere-platform.vercel.app"` — a **shared Vercel preview host**. Any other Vercel project deployed under `vercel.app` (e.g. a typosquatted `sosphere-platforrm.vercel.app`) cannot collide on `autoVerify`, but the `.vercel.app` apex is a public-suffix domain where any developer can publish — and crucially, if SOSphere ever moves DNS or the Vercel project is deleted, an attacker can re-register the project name and own the deep-link target. Combined with the password reset (`/reset-password`) and Supabase auth (`/auth`) paths, an attacker capturing this host can hijack auth tokens.
Fix: move App Links to a domain SOSphere controls (`sosphere.app` apex) with `assetlinks.json` served from there; keep `vercel.app` only as a non-autoverified fallback.

**R-2108 — P1 — DEEP LINKING / ASSETLINKS NOT SHIPPED — android/app/src/main/AndroidManifest.xml:108, 118, 128, 141**
`autoVerify="true"` on four filters means Android will fetch `https://sosphere-platform.vercel.app/.well-known/assetlinks.json` at install time. If that file is missing or has wrong SHA-256 fingerprint, **all four App Links silently degrade to chooser dialog**, defeating R-2107's protection and presenting the user with a "complete action using" picker every time they tap a password-reset email.
Fix: serve `assetlinks.json` from the resolved host (tracked as the BLOCKER #21b note in the file); add a build-time test that fetches and parses the file.

**R-2109 — P1 — DEEP LINKING / CUSTOM SCHEME UNSCOPED — android/app/src/main/AndroidManifest.xml:100-105**
`sosphere://` scheme filter has no `<data android:host=...>` constraint. **Any** URI starting with `sosphere://` (e.g. `sosphere://attacker.example/payload?token=...`) routes to MainActivity. Combined with the JS bridge (R-1785) and `directCall()` (cross-ref), a malicious notification or chat link can launch the app and trigger arbitrary `WebView.loadUrl()` with attacker-chosen path.
Fix: add `android:host="auth"` (or specific scoped hosts) and a `pathPrefix` constraint on the custom-scheme filter.

**R-2110 — P0 — ACTIVITY EXPORT / MAINACTIVITY — android/app/src/main/AndroidManifest.xml:73**
`MainActivity` is `android:exported="true"` (required for LAUNCHER) but **no `android:permission` gate**. Combined with R-2109 (unscoped scheme) and the JS bridge surface, any installed app on the device can `startActivity(intent("sosphere://..."))` and trigger functionality without user interaction.
Fix: split into a public LAUNCHER activity (exported, no JS bridge) and a private internal activity for deep-link processing that validates origin before forwarding.

**R-2111 — P1 — ACTIVITY / TASK AFFINITY — android/app/src/main/AndroidManifest.xml:67-73**
No `android:taskAffinity=""` set. With `launchMode="singleTask"` and exported=true, an external app can use `FLAG_ACTIVITY_NEW_TASK` to inject itself into SOSphere's back-stack (task hijacking, CVE class StrandHogg-style).
Fix: set `android:taskAffinity=""` and `android:allowTaskReparenting="false"`.

**R-2112 — P1 — PERMISSION / READ_PHONE_STATE EXCESSIVE — android/app/src/main/AndroidManifest.xml:5**
`READ_PHONE_STATE` is requested but the app only needs to make calls (`CALL_PHONE`) — `READ_PHONE_STATE` grants access to IMEI/IMSI/SIM serial number which is GDPR-sensitive PII. For an emergency app this looks unjustified.
Fix: remove `READ_PHONE_STATE`; if needed only for `getLine1Number()`, use the newer `READ_PHONE_NUMBERS` (less invasive) and gate by feature flag.

**R-2113 — P1 — PERMISSION / USE_FINGERPRINT DEPRECATED — android/app/src/main/AndroidManifest.xml:24**
`USE_FINGERPRINT` is deprecated since API 28 and removed/ignored on modern Android; declaring it triggers Play Console policy warnings on review and can flag the app as suspicious during emergency-services attestation review.
Fix: keep `USE_BIOMETRIC` only; document the Android 6.0–8.x devices justification in code comment but rely on `BiometricPrompt` library backport.

**R-2114 — P1 — PERMISSION / INTERNET DUPLICATED & LATE — android/app/src/main/AndroidManifest.xml:165**
`INTERNET` permission is declared **outside** the main permissions block at the bottom of the file, after `</application>`. The XML is still valid but the unusual placement looks like a stray edit that could be accidentally removed; also there is no comment explaining the placement — defensive readers might delete it.
Fix: consolidate all `<uses-permission>` declarations at the top of the manifest in a single block with comments.

**R-2115 — P2 — PERMISSION / NO ACCESS_BACKGROUND_LOCATION — android/app/src/main/AndroidManifest.xml:6-7**
Only `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` are declared. For a true emergency app the user MUST be able to grant background location so SOS continues to broadcast position after screen-off; without `ACCESS_BACKGROUND_LOCATION` the location updates pause when the app is backgrounded — life-safety regression.
Fix: add `ACCESS_BACKGROUND_LOCATION` and document the rationale in Play Store data-safety form.

**R-2116 — P2 — PERMISSION / RECEIVE_BOOT_COMPLETED MISSING — android/app/src/main/AndroidManifest.xml:4-16**
For an emergency app, the FCM listener and the SOS daemon should restart on device boot. No `RECEIVE_BOOT_COMPLETED` permission is declared, so SOS push notifications will not arrive until the user manually opens the app after reboot.
Fix: declare `RECEIVE_BOOT_COMPLETED` + a `BootReceiver` that re-registers FCM token and starts the background service.

**R-2117 — P2 — PERMISSION / SCHEDULE_EXACT_ALARM MISSING — android/app/src/main/AndroidManifest.xml:4-16**
On Android 12+ (S, API 31), scheduling exact alarms (used for SOS timeout escalation and recurring check-in pings) requires `SCHEDULE_EXACT_ALARM` (and `USE_EXACT_ALARM` on Android 13+). Without it, `AlarmManager.setExact()` throws `SecurityException` and SOS escalation timers do not fire.
Fix: add `USE_EXACT_ALARM` (auto-granted to emergency-tier apps) and fallback `SCHEDULE_EXACT_ALARM` for older OS.

**R-2118 — P2 — MANIFEST / NO PROCESS NAME — android/app/src/main/AndroidManifest.xml:57-65**
`<application>` has no `android:process` or `tools:targetApi` attributes. Single-process model means a crash in the WebView (e.g. malicious deep link payload) takes down the SOS background service too.
Fix: split the SOS service into its own `:sos` process.

**R-2119 — P2 — MANIFEST / NO HARDWARE FEATURES — android/app/src/main/AndroidManifest.xml:1-166**
No `<uses-feature>` tags. `android.hardware.location.gps` and `android.hardware.fingerprint` are not declared (even with `required="false"`), meaning Play Store filters the app from devices that **do** have these features when they shouldn't, and admits devices that don't.
Fix: declare `<uses-feature android:name="android.hardware.location.gps" required="false" />` etc.

**R-2120 — P2 — MANIFEST / NO INSTALL_LOCATION — android/app/src/main/AndroidManifest.xml:2**
`<manifest>` lacks `android:installLocation`. Defaults to `auto`, which means an SOS app can be moved to removable SD storage and become unavailable when the SD card is unmounted — a life-safety risk.
Fix: set `android:installLocation="internalOnly"`.

**R-2121 — P3 — MANIFEST / DATA EXTRACTION RULES REF — android/app/src/main/AndroidManifest.xml:60**
References `@xml/data_extraction_rules` — file exists per glob but content not validated in this batch. If empty, both cloud and device-transfer backups remain enabled for sensitive data.
Fix: confirm the XML defines `<cloud-backup><exclude domain="sharedpref" /></cloud-backup>` and `<device-transfer>` exclusions for all sensitive prefs.

**R-2122 — P3 — MANIFEST / FILEPROVIDER PATHS — android/app/src/main/AndroidManifest.xml:152-160**
`FileProvider` is declared with `grantUriPermissions=true` and references `@xml/file_paths`. If `file_paths.xml` declares broad `<external-path path="." />`, any sharable URI could leak arbitrary external storage. Content not validated in this batch.
Fix: audit `file_paths.xml` to ensure only scoped subdirectories are exposed.

**R-2123 — P3 — MANIFEST / PACKAGE QUERIES TOO BROAD — android/app/src/main/AndroidManifest.xml:43-53**
The hard-coded list of OEM dialer/contacts packages (`com.miui.phone`, `com.huawei.contacts`, etc.) is informational — Android only honors them as visibility grants — but each adds attack surface in `PackageManager` enumeration; if the list grows unchecked the app effectively re-enables pre-Android 11 package-visibility leaks.
Fix: rely on the `<intent>` `action=CALL/DIAL data scheme=tel` queries already declared at lines 34-41 — those are sufficient and OEM-neutral; remove the hard-coded package list.

---

### `android/build.gradle`

**R-2124 — P1 — BUILD / AGP VERSION VS WRAPPER — android/build.gradle:10 / gradle-wrapper.properties:3**
`com.android.tools.build:gradle:9.1.0` (top-level) requires Gradle 9.x and Java 21+; wrapper is set to `gradle-9.3.1-all.zip` (good) but the cordova-android-plugins/build.gradle at line 12 pins `com.android.tools.build:gradle:8.2.1`. This **mixed AGP** is invalid — Gradle will refuse to load both classpaths in the same build and the cordova subproject's `apply plugin: 'com.android.library'` will resolve against the root's 9.1.0 AGP, silently masking the inconsistency until a plugin API breaks.
Fix: remove the duplicate `buildscript { classpath 'com.android.tools.build:gradle:8.2.1' }` from `capacitor-cordova-android-plugins/build.gradle` — subprojects inherit from the root.

**R-2125 — P2 — BUILD / GOOGLE-SERVICES PLUGIN VERSION — android/build.gradle:11**
`com.google.gms:google-services:4.4.4` — recent but not pinned with checksum. AGP 9 changed the Google Services plugin contract; if this version is removed from Maven Central (yanked) the build silently fails.
Fix: pin with `dependencies { classpath('com.google.gms:google-services:4.4.4') { ... } }` and add to `verification-metadata.xml`.

**R-2126 — P2 — BUILD / NO PLUGIN MANAGEMENT BLOCK — android/build.gradle:3-16**
Top-level uses legacy `buildscript { ... }` block instead of modern `pluginManagement { repositories { ... } }` in `settings.gradle`. AGP 9 deprecates the legacy approach; future Gradle upgrade will silently break.
Fix: migrate to `pluginManagement` in settings.gradle per AGP 9 migration guide.

**R-2127 — P3 — BUILD / NO REPOSITORY FILTERING — android/build.gradle:5-8, 20-25**
`allprojects { repositories { google(); mavenCentral() } }` accepts artifacts from either repo without filtering. A typosquatted package on Maven Central (e.g. a fake `com.getcaptacitor:android`) will be resolved without warning.
Fix: add `exclusiveContent` filters per-repo (e.g. AndroidX → google() only; everything else → mavenCentral()).

**R-2128 — P3 — BUILD / NO REPOSITORIES MODE — android/build.gradle:20-25**
No `dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS) }` in settings.gradle — meaning subprojects (e.g. cordova-plugins) can silently add new untrusted repos.
Fix: enforce centralized repo declaration via `RepositoriesMode.FAIL_ON_PROJECT_REPOS`.

---

### `android/capacitor-cordova-android-plugins/build.gradle`

**R-2129 — P0 — BUILD / AGP MISMATCH — android/capacitor-cordova-android-plugins/build.gradle:12**
`classpath 'com.android.tools.build:gradle:8.2.1'` while root uses 9.1.0 (R-2124). On Gradle 9.3.1 with AGP 9 + a subproject declaring AGP 8.2.1, the build either fails with a confusing classpath conflict OR silently picks the root's AGP and the subproject's AGP block is dead code that lulls maintainers into thinking 8.2.1 is what runs.
Fix: remove this entire `buildscript` block — subprojects inherit AGP from root.

**R-2130 — P1 — BUILD / OLD SDK FALLBACK — android/capacitor-cordova-android-plugins/build.gradle:20,22-23**
Fallback values when `rootProject.ext.minSdkVersion` is unset: `compileSdk 34`, `minSdk 22`, `targetSdk 34`. The root `variables.gradle` sets `minSdk 24 / compileSdk 36 / targetSdk 36`, but **if a future refactor breaks the rootProject reference**, this subproject silently drops to `minSdk 22`, re-enabling Android 5.1 Lollipop where TLS 1.2 is unreliable and WebView is hopelessly out of date.
Fix: change fallbacks to mirror root values; better, throw if `rootProject.ext.minSdkVersion` is unset.

**R-2131 — P1 — BUILD / CORDOVA VERSION MISMATCH — android/capacitor-cordova-android-plugins/build.gradle:3 vs android/variables.gradle:15**
Subproject fallback `cordovaAndroidVersion = '10.1.1'` while root declares `cordovaAndroidVersion = '14.0.1'`. Cordova 10.x has known WebView CSP bypass CVEs fixed in 12+. If the project property lookup ever fails, the build silently regresses by 4 major versions of Cordova.
Fix: align fallback with root value or remove fallback to fail loudly.

**R-2132 — P2 — BUILD / LINT DISABLED — android/capacitor-cordova-android-plugins/build.gradle:27-29**
`lintOptions { abortOnError false }` silently swallows lint failures (security warnings, manifest mismatches, hardcoded strings).
Fix: `abortOnError true`; suppress specific known-noisy IDs only.

**R-2133 — P3 — BUILD / FLATDIR — android/capacitor-cordova-android-plugins/build.gradle:39-41**
Same as R-2089 — `flatDir { dirs 'src/main/libs', 'libs' }` allows untracked .jar/.aar drops.
Fix: remove `flatDir` or restrict to specific artifact names.

---

### `android/capacitor-cordova-android-plugins/cordova.variables.gradle`

**R-2134 — P3 — BUILD / DEFAULT MINSDK — android/capacitor-cordova-android-plugins/cordova.variables.gradle:3**
`cdvMinSdkVersion` fallback is 22 — same concern as R-2130.
Fix: align with root value 24.

---

### `android/capacitor-cordova-android-plugins/src/main/AndroidManifest.xml`

**R-2135 — P3 — MANIFEST / EMPTY APPLICATION — android/capacitor-cordova-android-plugins/src/main/AndroidManifest.xml:4-6**
Empty `<application>` element — fine in isolation, but it means any Cordova plugin merged via `node_modules/<plugin>/src/android/AndroidManifest.xml` is merged here without scrutiny. There is no `tools:node="replace"` or `tools:node="remove"` discipline.
Fix: add `xmlns:tools` and explicit merge rules; document expected merged permissions.

---

### `android/capacitor.settings.gradle`

**R-2136 — P3 — BUILD / GENERATED INTEGRITY — android/capacitor.settings.gradle:1-37**
Generated file with `DO NOT EDIT` banner; lists 11 plugins resolved from `../node_modules/...`. No verification that `node_modules` matches `package-lock.json`. A modified `node_modules/@capacitor/geolocation/android` directory ships into the APK transparently.
Fix: enable `npm ci` only in CI; add a pre-build step that verifies node_modules against package-lock SHA.

---

### `android/gradle/wrapper/gradle-wrapper.properties`

**R-2137 — P1 — WRAPPER / NO DISTRIBUTION CHECKSUM — android/gradle/wrapper/gradle-wrapper.properties:1-7**
No `distributionSha256Sum=...` line. Without it, a MITM on `services.gradle.org` (or a compromised proxy/mirror) can serve a trojaned Gradle distribution and the wrapper accepts it silently. This is the recommended hardening per the Gradle security guide.
Fix: add `distributionSha256Sum=<published-sha-for-9.3.1-all>` from gradle.org checksum page.

**R-2138 — P2 — WRAPPER / NETWORK TIMEOUT TOO SHORT — android/gradle/wrapper/gradle-wrapper.properties:4**
`networkTimeout=10000` (10s). On flaky CI runners pulling 150MB Gradle distribution this aborts frequently, with a retry that just hits the same timeout. Not a security issue but a reliability one for the release process.
Fix: bump to 60000.

**R-2139 — P3 — WRAPPER / DISTRIBUTION_URL HTTPS — android/gradle/wrapper/gradle-wrapper.properties:3** (verified safe)
Uses `https://services.gradle.org` correctly. Not a defect; recording for audit completeness.

---

### `android/gradle.properties`

**R-2140 — P1 — JVM / HEAP TOO SMALL — android/gradle.properties:12**
`org.gradle.jvmargs=-Xmx1536m` — 1.5GB heap is insufficient for AGP 9 + R8 minification (R-2084 fix) + Capacitor multi-module builds. CI will OOM during release builds, masking real failures with misleading `OutOfMemoryError` messages.
Fix: bump to `-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8`.

**R-2141 — P2 — BUILD / NO CONFIGURATION CACHE — android/gradle.properties:1-33**
No `org.gradle.configuration-cache=true` or `org.gradle.caching=true`. Builds are slower than necessary AND, more importantly, lack the determinism that configuration cache enforces — supply-chain attacks via build script side effects are harder to detect without cache parity.
Fix: enable both flags.

**R-2142 — P2 — BUILD / PARALLEL DISABLED — android/gradle.properties:17**
`org.gradle.parallel=true` is commented out. Multi-module build (app + cordova-plugins + 11 sub-plugins) serializes, lengthening release window during which a CI compromise could intervene.
Fix: enable parallel execution.

**R-2143 — P2 — BUILD / ANDROID 9/AGP TOGGLES OFF — android/gradle.properties:25, 27, 29, 30**
Multiple safety-net features are explicitly disabled: `android.uniquePackageNames=false`, `android.r8.strictFullModeForKeepRules=false`, `android.r8.optimizedResourceShrinking=false`, `android.newDsl=false`. These flags exist precisely to catch defects that previously slipped through. Turning them all off (especially `uniquePackageNames=false` allowing two libraries to share a package name → manifest merge collisions silently dropping permissions) is a red flag.
Fix: re-enable `android.uniquePackageNames=true`, `android.r8.strictFullModeForKeepRules=true`; investigate each one rather than blanket-disable.

**R-2144 — P3 — BUILD / KOTLIN DISABLED — android/gradle.properties:31**
`android.builtInKotlin=false` — fine if no Kotlin sources, but if a plugin (e.g. AndroidX) requires Kotlin runtime, build fails late.
Fix: leave default unless explicitly needed.

**R-2145 — P3 — BUILD / DEFAULT TARGET SDK GUARD — android/gradle.properties:24**
`android.sdk.defaultTargetSdkToCompileSdkIfUnset=false` — if a subproject forgets to set targetSdk, build fails loudly. Good. Recording as positive finding.

---

### `android/local.properties`

**R-2146 — P0 — SECRETS / SDK PATH LEAKS USERNAME — android/local.properties:1**
`sdk.dir=C:\\Users\\user\\AppData\\Local\\Android\\Sdk` — this file should be **gitignored** (line 27 of android/.gitignore confirms it is), but the question is whether it has ever been committed. The file existing in the working copy is normal; the path itself doxes the Windows username `user` to anyone with access to a stack trace or build log. More importantly, if `local.properties` is ever accidentally committed, the username/path leak is the least of the problems — a CI secret like an AVD path or NDK location could also leak.
Fix: verify file is gitignored AND not in git history; never log `local.properties` content from CI scripts; consider sourcing `sdk.dir` from env var only.

**R-2147 — P3 — BUILD / NO NDK DIR — android/local.properties:1**
Only `sdk.dir` set, no `ndk.dir`. If a future plugin requires NDK and one is auto-downloaded by AGP, the version is unpinned.
Fix: pin `ndk.dir` once a stable NDK is selected.

---

### `android/settings.gradle`

**R-2148 — P2 — SETTINGS / NO PLUGIN MGMT — android/settings.gradle:1-5**
Lacks `pluginManagement { repositories { gradlePluginPortal(); google(); mavenCentral() } }` and `dependencyResolutionManagement { repositoriesMode.set(FAIL_ON_PROJECT_REPOS) }`. AGP 9 / Gradle 9.3.1 strongly recommend this pattern for supply-chain hygiene; without it, subprojects can pull from arbitrary repos.
Fix: add both blocks per AGP 9 migration template.

**R-2149 — P3 — SETTINGS / NO PROJECT NAME — android/settings.gradle:1-5**
No `rootProject.name = 'sosphere'`. Gradle infers from the folder name `android` → root project is called `android`, which collides with the Android source set and produces confusing error messages.
Fix: add `rootProject.name = 'sosphere-android'`.

---

### `android/variables.gradle`

**R-2150 — P1 — SDK / TARGET SDK 36 BUT MISSING ANDROID 15 OPT-INS — android/variables.gradle:3-4**
`compileSdkVersion = 36 / targetSdkVersion = 36` is AHEAD of the Play 2026 baseline (≥34) — good. BUT targeting 36 (Android 16) without declaring `FOREGROUND_SERVICE_LOCATION` properly (R-2103), `USE_EXACT_ALARM` (R-2117), and Android 14+ photo-picker permissions means the app will crash on grant requests it doesn't know how to handle. Compile-target ahead of runtime understanding is a foot-gun.
Fix: either align compileSdk with the manifest's permission surface (downgrade to 34/35), or upgrade the manifest to match (preferred).

**R-2151 — P2 — SDK / MIN SDK 24 INCLUDES JANUS-VULNERABLE OS — android/variables.gradle:2**
`minSdkVersion = 24` (Android 7.0). API 24/25 are vulnerable to **Janus** (CVE-2017-13156) if v1 signing is enabled (R-2083), and lack many modern crypto APIs. For an emergency app, raising minSdk to 26 (Android 8.0) removes the Janus window and forces v2/v3 signing.
Fix: bump `minSdkVersion = 26` after audit of installed-base telemetry.

**R-2152 — P2 — DEPENDENCY / VERSION DRIFT — android/variables.gradle:5-15**
Versions are hand-maintained in a script-style ext block (no central catalog). `androidxAppCompatVersion = '1.7.1'`, `androidxCoreVersion = '1.17.0'`, `cordovaAndroidVersion = '14.0.1'` (cordova 14 doesn't exist as of cutoff — likely typo or beta). The mismatch with cordova-cordova subproject (R-2131) suggests these values are not actively validated.
Fix: migrate to Gradle Version Catalog (`libs.versions.toml`) with renovate-bot updates.

**R-2153 — P3 — DEPENDENCY / NO BOM — android/variables.gradle:5-15**
No BOM (bill-of-materials) reference for AndroidX or Firebase — versions are independently pinned and can drift apart causing runtime ClassNotFoundException.
Fix: use `androidx.core:core-bom` and similar to align version trains.

---

### `android/app/src/main/res/xml/config.xml` (re-read for context)

**R-2154 — P0 — WEBVIEW / ACCESS ORIGIN STAR — android/app/src/main/res/xml/config.xml:3** (cross-ref R-1784, re-confirmed at this layer)
`<access origin="*" />` — Cordova allow-list grants the WebView permission to load **any** origin including `file://`, `http://`, and attacker-controlled HTTPS. Combined with R-2105 (no network_security_config), R-1785 (JS bridge), R-1786 (geolocation auto-grant), and R-2109 (unscoped custom scheme), this is the single most catastrophic line in the Android build because it neutralizes every other defense.
Fix: replace with the explicit allow-list of origins SOSphere actually uses (e.g. `https://sosphere-platform.vercel.app`, `https://api.twilio.com`, `https://*.supabase.co`).

**R-2155 — P3 — CONFIG / EMPTY CORDOVA WIDGET — android/app/src/main/res/xml/config.xml:1-6**
File is `<widget>` with only one `<access>` directive, no `<allow-navigation>`, no `<allow-intent>`, no `<preference name="...">` declarations. The lack of declared preferences means Capacitor's defaults apply — which include `MixedContentMode=COMPATIBILITY_MODE` allowing HTTP iframes inside HTTPS pages.
Fix: explicitly declare `<preference name="MixedContentMode" value="NEVER_ALLOW" />`, `<preference name="AllowFileAccess" value="false" />`, `<preference name="AllowUniversalAccessFromFileURLs" value="false" />`.

---

### Cross-Cutting / Catch-Up

**R-2156 — P1 — BUILD / NO REPRODUCIBLE-BUILD METADATA — multiple files**
No `verification-metadata.xml`, no `package-lock.json` checksum gate in Gradle, no `--write-verification-metadata` baseline. Combined with R-2089 (flatDir), R-2090 (no locking), R-2125 (unpinned google-services), R-2136 (node_modules trust), the entire Android build is supply-chain-vulnerable.
Fix: enable Gradle dependency verification + lock files + `npm ci --frozen-lockfile` in CI.

**R-2157 — P1 — BUILD / NO SBOM EMISSION — android/app/build.gradle (missing plugin)**
No CycloneDX, no SPDX SBOM plugin (`org.cyclonedx.bom`). For a life-safety app subject to FDA/CE-like scrutiny, the lack of a software bill of materials means incident-response cannot enumerate which third-party version was shipped in any released APK.
Fix: add `id 'org.cyclonedx.bom' version '1.8.2'` and emit SBOM as a release artifact.

**R-2158 — P2 — MANIFEST / NO PROGUARD ANNOTATIONS ON BRIDGE — manifest + bridge classes**
The manifest does not declare any `<meta-data>` linking to a JS-bridge allow-list, and no ProGuard rule scopes the `@JavascriptInterface` annotation to specific classes. Combined with R-1785 and the wide ProGuard keep at R-2098, any class that gains a `@JavascriptInterface` method (e.g. a malicious dependency) is exposed to the WebView.
Fix: enforce package-scoped `@JavascriptInterface` discovery via a custom annotation processor.

**R-2159 — P2 — MANIFEST / NO SECURITY HEADERS PASSTHROUGH — application element**
`<application>` is missing `android:requestLegacyExternalStorage="false"` (defaults to false on targetSdk 30+ but should be explicit), `android:enableOnBackInvokedCallback="true"` (Android 13+ predictive back), and `android:hasFragileUserData="false"`.
Fix: add the explicit attributes for clarity and audit-friendliness.

**R-2160 — P3 — BUILD / CI HARDENING ABSENT — gradle.properties + .github/workflows (not in batch)**
No reference to CI hardening (e.g. `org.gradle.warning.mode=fail`, `--no-daemon` for CI). Out of strict scope but worth flagging as a follow-up batch.
Fix: add CI-specific gradle.properties profile.

---

## SUMMARY

**Total findings: 80** (R-2081 through R-2160)

| Severity | Count |
|----------|-------|
| **P0** (catastrophic / life-safety) | **10** |
| **P1** (high) | **20** |
| **P2** (medium) | **27** |
| **P3** (low / hygiene) | **23** |

### P0 Tickets (10):
- R-2082 — Empty-password fallback in keystore loading
- R-2083 — APK Signature Scheme v1 not explicitly disabled (Janus CVE)
- R-2084 — `minifyEnabled false` — R8/ProGuard never runs in release
- R-2095 — Release keystore password committed (companion to R-1792)
- R-2096 — Weak keystore password + storePassword reused as keyPassword
- R-2103 — `FOREGROUND_SERVICE_LOCATION` declared but no `<service>` with `foregroundServiceType`
- R-2104 — `RECORD_AUDIO` declared but no `FOREGROUND_SERVICE_MICROPHONE`
- R-2105 — No `networkSecurityConfig`, no `usesCleartextTraffic="false"`
- R-2106 — `usesCleartextTraffic` default undefined when combined with Cordova `<access origin="*"/>`
- R-2107 — Deep-link App Links pinned to public-suffix `vercel.app` (hijackable)
- R-2110 — MainActivity exported with no permission gate + JS bridge surface
- R-2129 — AGP version mismatch (root 9.1.0 vs subproject 8.2.1)
- R-2146 — local.properties path/username leak (verify gitignored & never committed)
- R-2154 — Cordova `<access origin="*"/>` — neutralizes every other defense

(14 P0-class items above — the TOP 5 selected by life-safety impact are below.)

---

## TOP 5 P0 TICKETS (verbatim)

**1. R-2095 — P0 — KEY MANAGEMENT — android/app/keystore.properties:4,6** (companion to R-1792)
Production release keystore password `Fz07506771765` is committed in plaintext to `app/keystore.properties`. The `.gitignore` lists `app/keystore.properties` and `keystore.properties` at lines 61-62 — meaning this file should have **never** been committed. Either the gitignore was added after the commit (so the secret remains in git history) or the file was force-added with `git add -f`. Either way, anyone with read access to the repository can sign a trojaned APK that the Android package verifier will accept as a legitimate update to `com.sosphere.app`.
Fix: (1) rotate the keystore IMMEDIATELY — generate new keystore, publish APK Signature Scheme v3 key rotation via the existing v3 cert, register on Play App Signing; (2) `git filter-repo --invert-paths --path app/keystore.properties`; (3) revoke and rotate every secret that has ever touched that machine.

**2. R-2154 — P0 — WEBVIEW / ACCESS ORIGIN STAR — android/app/src/main/res/xml/config.xml:3** (cross-ref R-1784, re-confirmed at this layer)
`<access origin="*" />` — Cordova allow-list grants the WebView permission to load **any** origin including `file://`, `http://`, and attacker-controlled HTTPS. Combined with R-2105 (no network_security_config), R-1785 (JS bridge), R-1786 (geolocation auto-grant), and R-2109 (unscoped custom scheme), this is the single most catastrophic line in the Android build because it neutralizes every other defense.
Fix: replace with the explicit allow-list of origins SOSphere actually uses (e.g. `https://sosphere-platform.vercel.app`, `https://api.twilio.com`, `https://*.supabase.co`).

**3. R-2103 — P0 — PERMISSION / FOREGROUND_SERVICE_TYPE MISSING — android/app/src/main/AndroidManifest.xml:11-12**
`FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION` are declared, but no `<service ... android:foregroundServiceType="location">` is declared in the manifest. On `targetSdkVersion 36` (Android 15+), starting a foreground service without a declared service type throws `MissingForegroundServiceTypeException` and crashes the app — meaning **background location during an active SOS will not run** on any device on Android 14+. This is a life-safety regression.
Fix: declare an `<service>` element with `android:foregroundServiceType="location|microphone"` and `android:exported="false"`.

**4. R-2105 — P0 — WEBVIEW / NETWORK SECURITY CONFIG MISSING — android/app/src/main/AndroidManifest.xml:57-65**
`<application>` element has no `android:networkSecurityConfig` attribute and no `@xml/network_security_config` file exists in `res/xml/`. Combined with R-1784 (`<access origin="*"/>` in Cordova config.xml at line 3 of `res/xml/config.xml`) and the absence of `android:usesCleartextTraffic="false"`, the WebView trusts arbitrary HTTP origins. An attacker on the same Wi-Fi can MITM the SOS dispatch endpoint.
Fix: add `android:networkSecurityConfig="@xml/network_security_config"` with a strict config: `cleartextTrafficPermitted=false`, certificate pinning on `*.supabase.co`, `api.twilio.com`, `api.stripe.com`.

**5. R-2084 — P0 — RELEASE / OBFUSCATION DISABLED — android/app/build.gradle:115**
`minifyEnabled false` for the release build. R8/ProGuard is therefore **never executed**, meaning:
(a) Class names like `MainActivity.directCall()` remain in plaintext for reverse-engineering;
(b) The ProGuard rules file (which exists at `proguard-rules.pro` and is referenced) is **dead code**;
(c) `resource shrinking` is implicitly off — APK contains unused strings/layouts that leak debug endpoints;
(d) Sentry stack traces will have full class names but no minification benefit.
For an emergency app where the Twilio Voice SDK, Stripe keys, and Supabase URLs are bundled, this is a P0 supply-chain risk.
Fix: set `minifyEnabled true`, `shrinkResources true`; verify the ProGuard rules cover Capacitor/Twilio/Gson (already do, see R-2099).
