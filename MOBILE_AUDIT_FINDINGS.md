# SOSphere Mobile App — Deep Audit Findings (G-3)
**Audit date:** 2026-05-19
**Auditor:** Claude (continuation of G-3 from POST_LAUNCH_AUDIT.md)
**Scope:** React/Capacitor mobile codebase + Android native layer + plugin coverage
**Method:** Read-only static analysis of `src/`, `android/`, `capacitor.config.json`, `package.json`

> **Top-line verdict:** المنصة الخلفية (backend) في حالة ممتازة لكن طبقة الموبايل تحوي **7 ثغرات حرجة** تجعل التطبيق غير صالح لإطلاق على متجر التطبيقات قبل معالجتها. أخطرها: GPS الخلفي **لا يعمل**، Push على الموبايل **معطّل بالكامل**، وإصلاح R-34 يتصل بـ 911 في السعودية بدلاً من 997.

---

## 1. تصنيف الخطورة

- 🔴 **CRITICAL** = ثغرة قد تُفقد حياة في حالة الطوارئ. يجب الإصلاح قبل أي soft launch.
- 🟡 **MAJOR** = ثغرة UX / functional / store-rejection. يجب الإصلاح قبل launch عام.
- 🟢 **MINOR** = polish / nice-to-have.

---

## 2. النتائج التفصيلية

### R-48 🔴 — Hardcoded "911" in 0-contacts emergency fallback (Saudi market broken)

**الموقع:** `src/app/components/sos-emergency.tsx:2410`
```typescript
const EMERGENCY_NUMBER = "911"; // TODO: locale-aware (112 EU, 999 UK, etc.)
```

**المشكلة:** R-34 fix (close 0-contacts crash) يتصل بـ 911 hardcoded. السعودية (السوق الأساسي) رقم الطوارئ هو **997**. الاتصال بـ 911 في السعودية لا يصل لأي مكان.

**نفس المشكلة في الـ Critical Battery screen:**
- `sos-emergency.tsx:3152` → `directCall("997")` hardcoded
- `sos-emergency.tsx:3158` → `directCall("911")` hardcoded

**السبب الجذري:** `utils/emergency-services.ts` موجود ويحوي country-aware lookup (`getEmergencyNumber("SA")` → 997) لكنه **غير مستخدم** في `sos-emergency.tsx`.

**الإصلاح الجذري:**
```typescript
import { getEmergencyNumber, resolveDispatcherCountry } from "./utils/emergency-services";

// في 0-contacts fallback:
const country = resolveDispatcherCountry({
  profileCountry: localStorage.getItem(STORAGE_KEYS.countryCode) ?? undefined,
  browserLocale: navigator.language,
});
const { number: EMERGENCY_NUMBER } = getEmergencyNumber(country);
directCall(EMERGENCY_NUMBER);
```

---

### R-49 🔴 — `sosphere_country_code` defined but NEVER written

**الموقع:** `src/app/components/storage-keys.ts:38`

**المشكلة:** المفتاح معرّف في `STORAGE_KEYS.countryCode` لكن لا يوجد أي كود في المشروع يكتب القيمة. هذا يجعل R-48 fallback لـ `browserLocale` فقط — وعلى أجهزة Saudi users مع UI إنجليزي ستكون `en-US` → 911 (خاطئ).

**الإصلاح الجذري:** استخراج رمز الدولة من رقم الهاتف عند signup:
- `+966...` → `SA`
- `+971...` → `AE`
- `+1...` → `US`/`CA`

يُنفَّذ في `signup-personal.tsx` / `login-phone.tsx` بعد التحقق من OTP.

---

### R-50 🟡 — `navigator.onLine` غير موثوق على Capacitor WebView

**الموقع:** `offline-sync-engine.ts:400, 487, 526` + 4 ملفات أخرى

**المشكلة:** `navigator.onLine` يرجع `true` حتى لو الـ WiFi متصل بدون انترنت (captive portal scenario). على Capacitor WebView على Android، السلوك أقل موثوقية من المتصفح.

**الإصلاح الجذري:** استخدام `@capacitor/network` plugin:
```typescript
import { Network } from '@capacitor/network';
const status = await Network.getStatus();
if (status.connected) { /* ... */ }
```

**يحتاج:** إضافة `@capacitor/network` إلى package.json (غير مثبّت حالياً).

---

### R-51 🟡 — لا SMS fallback عند فشل data network

**المشكلة:** عند انقطاع data network بشكل كامل (dead zone) لكن SMS لا يزال يعمل عبر cellular signal، التطبيق لا يحاول إرسال SOS عبر SMS لجهات الاتصال. يفقد فرصة "آخر طلقة" للإنقاذ.

**الإصلاح الجذري:** Capacitor plugin مثل `@capacitor-community/sms` أو native Java intent:
```java
Intent smsIntent = new Intent(Intent.ACTION_VIEW);
smsIntent.setData(Uri.parse("smsto:" + phoneNumber));
smsIntent.putExtra("sms_body", "🚨 SOS من " + name + " — موقعي: " + mapsUrl);
```

---

### R-52 🟢 — IndexedDB queue قد تُحذف على iOS Safari WebView

**المشكلة:** عند إضافة iOS لاحقاً (R-52 deferred until then), IndexedDB في Safari WebView قد تُحذف تحت ضغط التخزين (Apple's 7-day eviction). على Android Capacitor + `allowBackup=false` الوضع أكثر استقراراً.

**الإصلاح الجذري:** عند إضافة iOS، استخدام `@capacitor/preferences` (يستخدم Keychain على iOS، SharedPreferences على Android) للـ critical queue items بدلاً من IndexedDB.

---

### R-53 🔴 — `@capacitor/push-notifications` plugin غير مستخدم — Mobile app يتلقى ZERO push

**الموقع:** `package.json` يضم `@capacitor/push-notifications: ^6.0.5` لكن `Grep PushNotifications.register` عبر المشروع كاملاً = **0 matches**.

**المشكلة:** كل البنية التحتية موجودة (google-services.json present + gradle plugin applied) لكن JS side لا يستدعي `PushNotifications.register()` ولا يسجل أي listener. النتيجة:
- Admin يفتح موبايل التطبيق
- موظف يضغط SOS
- Server يرسل Web Push (R-54 below)
- Admin's phone في background = يستلم **NOTHING**

**الإصلاح الجذري:** إنشاء `src/app/components/push-notifications-native.ts` يستدعي عند login:
```typescript
import { PushNotifications } from '@capacitor/push-notifications';

await PushNotifications.requestPermissions();
await PushNotifications.register();
PushNotifications.addListener('registration', (token) => {
  // POST to push-tokens table with platform='android', token.value
});
PushNotifications.addListener('pushNotificationReceived', (notif) => {
  // handle foreground push (Android shows nothing by default for foreground)
});
PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
  // tap-to-open SOS screen with emergency_id deep link
});
```

ثم تعديل `send-push-notification` edge function ليرسل عبر FCM HTTP v1 للـ tokens المسجّلة كـ `platform='android'` (vs Web Push للـ `platform='web'`).

---

### R-54 🔴 — Web Push pivot كسر مسار الموبايل

**الموقع:** `src/app/components/api/fcm-push.ts:34` (تعليق "PIVOT 2026-04-30: replaced Firebase Cloud Messaging with native Web Push API")

**المشكلة:** الـ pivot من FCM لـ Web Push حلّ مشكلة على الـ web (401 errors) لكن:
- Web Push يعتمد على service worker (`/sw.js`) الذي **لا يعمل بشكل موثوق على Capacitor WebView** عندما يكون التطبيق مغلقاً أو في background
- على Android Capacitor: service worker لا يستلم push events بعد force-close
- الـ correct architecture: Web Push للـ web tab، FCM HTTP v1 للـ Android native (نفس الـ VAPID key لا يفيد هنا)

**الإصلاح الجذري:** dual-path send-push-notification edge function:
- `platform='web'` → Web Push (موجود ويعمل)
- `platform='android'` → FCM HTTP v1 (يحتاج Service Account JSON + `firebase-admin` Deno import)
- `platform='ios'` (مستقبلاً) → APNs

---

### R-55 🟡 — لا FCM Service Account للـ HTTP v1 API

**المشكلة:** لإرسال push للموبايل عبر FCM HTTP v1، نحتاج Firebase Service Account JSON كـ Supabase secret. الإعداد الحالي يستخدم VAPID key (Web Push only).

**الإصلاح الجذري:** Firebase Console → Project Settings → Service Accounts → Generate new private key → store في Supabase secret `FCM_SERVICE_ACCOUNT_JSON`.

---

### R-56 🟡 — لا iOS support بعد

**الموقع:** `package.json` ينقصه `@capacitor/ios`، ولا يوجد مجلد `ios/`.

**المشكلة:** التطبيق Android-only. السوق الخليجي تقريباً 50/50 Android/iOS. iPhone users لا يستطيعون استخدام التطبيق إطلاقاً.

**الإصلاح الجذري:** خطوة كاملة منفصلة (G-3 extended phase):
1. `npx cap add ios`
2. Apple Developer Account ($99/year)
3. Xcode على macOS (يحتاج جهاز Mac أو cloud Mac)
4. APNs configuration
5. App Store Connect setup
6. Privacy Nutrition Labels

التقدير: 2-3 أسابيع full-time أو 4-6 أسابيع part-time.

---

### R-57 🟢 — VITE_FIREBASE_VAPID_KEY يجب أن يكون موجود في build

**يحتاج تأكيد:** أن المفتاح موجود في `.env` أو CI env vars وقت بناء الإنتاج.

---

### R-58 🔴 — `offline-gps-tracker.ts` يستخدم Web API بدلاً من Capacitor Geolocation

**الموقع:** `src/app/components/offline-gps-tracker.ts:441, 553, 626`
```typescript
navigator.geolocation.getCurrentPosition(...)
navigator.geolocation.watchPosition(...)
navigator.geolocation.clearWatch(...)
```

**المشكلة:** `navigator.geolocation` على Capacitor WebView:
- يعمل في foreground فقط
- **يتوقف فور دخول التطبيق في background** على Android 10+
- Doze mode يقتل التطبيق بعد دقائق

**الإصلاح الجذري:** استبدال بـ `@capacitor/geolocation` (مثبت لكن غير مستخدم!):
```typescript
import { Geolocation } from '@capacitor/geolocation';
const watchId = await Geolocation.watchPosition({ enableHighAccuracy: true }, (pos, err) => { ... });
```

لكن هذا **لا يكفي** للـ background — راجع R-59.

---

### R-59 🔴 — لا Foreground Service لـ background GPS

**الموقع:** `AndroidManifest.xml:12` يحوي `FOREGROUND_SERVICE_LOCATION` permission، لكن:
- لا `<service>` declared في الـ manifest
- لا Java class implements `Service` في `android/app/src/main/java/com/sosphere/app/`
- فقط `MainActivity` و `CallStateReceiver`

**المشكلة (CRITICAL لتطبيق life-safety):**
- عامل يمشي في الصحراء، الشاشة مقفلة، التطبيق في الـ background
- بعد دقائق، Doze mode يقتل التطبيق
- GPS recording يتوقف
- إذا فقد العامل لاحقاً، **لا يوجد آخر موقع معروف للإنقاذ**

**الإصلاح الجذري (مهم جداً):** خياران:
1. **`@capacitor-community/background-geolocation` plugin** — يعالج foreground service تلقائياً، battery optimization, distance filter, GPS accuracy modes
2. **Native Java foreground service** — أكثر تحكماً لكن أعقد:
   - Class `SOSphereLocationService extends Service`
   - `startForeground(NOTIF_ID, persistentNotification)`
   - `LocationManager.requestLocationUpdates(...)` مع PendingIntent
   - تسجيل في AndroidManifest: `<service android:name=".SOSphereLocationService" android:foregroundServiceType="location" />`

**Recommendation:** Option 1 (plugin) — أسرع وأقل أخطاء.

---

### R-60 🔴 — لا battery optimization exemption prompt

**المشكلة:** Xiaomi (MIUI)، Huawei (EMUI)، Samsung، OnePlus — كلها تطبّق "aggressive killer" على أي تطبيق ليس على whitelist الخاصة بـ battery optimization. حتى foreground service يُقتل بعد دقائق.

**الإصلاح الجذري:** عند أول فتح، طلب من المستخدم:
```java
Intent intent = new Intent();
intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
intent.setData(Uri.parse("package:" + packageName));
startActivity(intent);
```
مع شرح: "لكي تعمل خدمة الإنقاذ في الخلفية، نحتاج استثناء من توفير البطارية".

ولـ Xiaomi/Huawei: deep-link لـ `Security Center → Battery Saver → AppName → No restrictions`.

---

### R-61 🟡 — Dead reckoning لا يعوّض عن قتل التطبيق

**الموقع:** `offline-gps-tracker.ts` يحوي dead reckoning logic.

**الواقع:** يعمل فقط عندما GPS sensor غير متاح **لكن التطبيق لا يزال يعمل**. لا يعوّض عن قتل التطبيق بالكامل من Doze/Killer.

---

### R-62 🟡 — `requestNativePermissions` معرّف لكن غير مستدعى أبداً

**الموقع:** `capacitor-bridge.ts` يصدّر `requestNativePermissions` لكن `Grep` يجد استدعاء واحد فقط في نفس الملف.

**المشكلة:** الـ permissions تُطلب جميعها عند `MainActivity.onCreate` (Android Java):
- ACCESS_FINE_LOCATION
- ACCESS_COARSE_LOCATION
- CALL_PHONE
- READ_PHONE_STATE

لكن **ينقص:**
- POST_NOTIFICATIONS (Android 13+ runtime)
- RECORD_AUDIO (للـ AI Voice Assistant)

و UX سيئ — يضرب المستخدم بـ 4 popups قبل أن يرى التطبيق.

**الإصلاح الجذري:** request contextual:
- Location: عند welcome-onboarding
- Microphone: قبل أول AI call
- Notifications: عند dashboard load

---

### R-63 🔴 — Deep links مُعرَّفة في Manifest لكن لا handler في JS

**الموقع:** `AndroidManifest.xml:80-148` (5 intent-filters بـ autoVerify=true).

**المشكلة:** `Grep appUrlOpen` في كامل المشروع = **0 matches**. عندما يفتح المستخدم رابط `sosphere://invite?code=ABC123` أو `https://sosphere-platform.vercel.app/auth?token=xyz`:
- التطبيق يُفتَح
- لكن `App.addListener('appUrlOpen', ...)` غير موجود
- المستخدم يرى الصفحة الرئيسية، الـ token مفقود
- مسار Supabase auth callback مكسور على الموبايل

**الإصلاح الجذري:** في `mobile-app.tsx` عند المرحلة المبكرة:
```typescript
import { App as CapApp } from '@capacitor/app';
CapApp.addListener('appUrlOpen', ({ url }) => {
  const parsed = new URL(url);
  if (parsed.pathname.startsWith('/auth')) handleAuthCallback(parsed);
  if (parsed.protocol === 'sosphere:' && parsed.host === 'invite') handleInvite(parsed);
  // etc.
});
```

---

### R-64 🔴 — `assetlinks.json` غير منشور — App Links autoVerify معطّل

**الموقع:** `AndroidManifest.xml:108` (`android:autoVerify="true"`) — يحتاج assetlinks.json منشور.

**المشكلة:** AndroidManifest comments تذكر "tracked as BLOCKER #21b" لكن لم يُحَلّ. النتيجة:
- App Links autoVerify يفشل عند install
- روابط `https://sosphere-platform.vercel.app/auth?...` تفتح في **المتصفح** بدلاً من التطبيق
- مسار password reset كسر على الموبايل
- مسار Supabase OAuth callback كسر

**الإصلاح الجذري:**
1. توليد SHA-256 fingerprint:
   ```bash
   keytool -list -v -keystore android/app/sosphere-release.jks -alias sosphere
   ```
2. إنشاء `public/.well-known/assetlinks.json`:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.sosphere.app",
       "sha256_cert_fingerprints": ["AB:CD:EF:..."]
     }
   }]
   ```
3. تأكد أن Vercel يخدم الـ `.well-known/` بدون redirect
4. اختبار: `adb shell pm verify-app-links --re-verify com.sosphere.app`

---

### R-65 🟡 — لا Privacy Nutrition Labels / Play Store Data Safety form

**المشكلة:** قبل Play Store submission، يجب ملء Data Safety form يصف:
- ما البيانات التي يجمعها التطبيق (Location, Phone number, Microphone)
- لماذا يجمعها
- هل تُشارَك مع third parties (Twilio, Stripe, Supabase = نعم)
- هل المستخدم يستطيع طلب الحذف

**الإصلاح الجذري:** ملف `PLAY_STORE_DATA_SAFETY.md` يجمع كل البيانات + privacy policy URL.

---

## 3. ملخص الإصلاحات بالأولوية

| # | ID | الخطورة | الوصف المختصر | الوقت التقديري |
|---|----|---------|---------------|----------------|
| 1 | R-48 | 🔴 | locale-aware emergency number (Saudi 997) | 2 ساعات |
| 2 | R-49 | 🔴 | كتابة `sosphere_country_code` من phone number | 1 ساعة |
| 3 | R-53 | 🔴 | تفعيل `@capacitor/push-notifications` register | 4 ساعات |
| 4 | R-54 | 🔴 | dual-path send-push (Web + FCM HTTP v1) | 6 ساعات |
| 5 | R-58 | 🔴 | استبدال `navigator.geolocation` بـ Capacitor Geolocation | 3 ساعات |
| 6 | R-59 | 🔴 | إضافة `@capacitor-community/background-geolocation` | 1 يوم |
| 7 | R-63 | 🔴 | `appUrlOpen` listener للـ deep links | 3 ساعات |
| 8 | R-64 | 🔴 | نشر `assetlinks.json` على `/.well-known/` | 2 ساعات |
| 9 | R-60 | 🟡 | battery optimization exemption prompt | 4 ساعات |
| 10 | R-50 | 🟡 | `@capacitor/network` بدلاً من `navigator.onLine` | 3 ساعات |
| 11 | R-62 | 🟡 | contextual permission requests | 4 ساعات |
| 12 | R-51 | 🟡 | SMS fallback عند فشل data | 6 ساعات |
| 13 | R-55 | 🟡 | FCM Service Account JSON setup | 1 ساعة |
| 14 | R-65 | 🟡 | Play Store Data Safety form | 4 ساعات |
| 15 | R-56 | 🟡 | iOS support (deferred — كبير جداً) | 2-3 أسابيع |

**المجموع للـ critical fixes (R-48 to R-64):** ~3-4 أيام عمل
**المجموع لكل الفئة الـ Android (Critical + Major):** ~1-1.5 أسبوع
**iOS منفصل تماماً:** 2-3 أسابيع إضافية

---

## 4. توصية الاستئناف

**خطة معركة مقترحة:**

**Day 1 (إصلاحات بسيطة سريعة):**
- R-48: locale-aware emergency
- R-49: country code from phone
- R-50: @capacitor/network
- R-64: assetlinks.json
- R-65: Play Store form

**Day 2 (Push notifications):**
- R-53: PushNotifications register
- R-54: dual-path push edge function
- R-55: FCM Service Account

**Day 3 (Background GPS):**
- R-58: Capacitor Geolocation
- R-59: background-geolocation plugin
- R-60: battery optimization prompt

**Day 4 (Deep links + permissions):**
- R-63: appUrlOpen listener
- R-62: contextual permissions
- R-51: SMS fallback

**Day 5 (testing + integration):**
- اختبار Android كامل على جهاز فيزيائي
- بناء release APK
- توقيع verification

**iOS:** خطة منفصلة بعد الـ Android stabilization.

---

## 5. ما هو سليم وقوي (لا تلمس)

- ✅ Offline-first SOS architecture (enqueueSOS قبل network)
- ✅ Heartbeat parallel recovery
- ✅ Deep links manifest declaration (الـ intent-filters صحيحة)
- ✅ Direct dialer call (R-2.x fix — لا chooser popup)
- ✅ Biometric auth setup (USE_BIOMETRIC + USE_FINGERPRINT)
- ✅ Release signing config (env-var first, gitignored keystore)
- ✅ targetSdkVersion 36 (Android 16 — current)
- ✅ minSdkVersion 24 (يغطي 99% من الأجهزة)
- ✅ versionCode من CI env vars (R-16 fix)
- ✅ Mixed content blocked + http scheme only

---

**نهاية التقرير. عند الاستئناف، نبدأ من R-48 (locale-aware emergency).**
