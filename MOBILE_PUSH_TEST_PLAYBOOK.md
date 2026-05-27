# Mobile Push Notification — Manual Test Playbook
**Purpose:** Verify R-53/R-54/R-55 end-to-end on a physical Android device.
**Time:** 10-15 دقيقة.
**Prerequisite:** Day 2 push (R-53/R-54/R-55) merged + deployed (✅ done 2026-05-19).

---

## Step 0 — Run the automated probe first
لا تذهب للموبايل قبل أن يجتاز هذا:
```powershell
cd C:\Users\user\Downloads\sosphere-platform
.\scripts\probe-push-delivery.ps1
```
اختر **N** لـ Phase 3 (تكفي Phase 1 + 2 الآن). إذا فشل أي check، أصلحه قبل المتابعة.

---

## Step 1 — Build a fresh APK

```powershell
cd C:\Users\user\Downloads\sosphere-platform
npm run build
npx cap sync android
cd android
.\gradlew assembleDebug
```

النتيجة: `android\app\build\outputs\apk\debug\app-debug.apk` (~30-50MB).

---

## Step 2 — Install على الموبايل

**عبر USB (الأسهل):**
1. فعّل **USB debugging** على الموبايل (Settings → About → tap Build Number 7 times → Developer options → USB debugging)
2. وصّل الموبايل بـ USB
3. PowerShell:
   ```powershell
   adb devices                                      # تأكد الموبايل ظاهر
   adb install -r .\app\build\outputs\apk\debug\app-debug.apk
   ```

**إذا لا يوجد adb:**
- انقل الملف يدوياً إلى الموبايل (USB أو Google Drive)
- افتح الملف على الموبايل → Install

---

## Step 3 — تسجيل الدخول وتسجيل الـ FCM token

1. افتح التطبيق على الموبايل
2. سجّل دخول (أي حساب — يفضّل حساب test)
3. **مهم**: اقبل permission "Notifications" عندما يظهر
4. انتظر 5-10 ثوانٍ — `initNativePush()` يسجّل الـ FCM token تلقائياً

**تحقق أن الـ token حُفظ:**
في Supabase Dashboard → Table Editor → `push_tokens`:
- يجب أن ترى صف جديد بـ:
  - `user_id` = الـ user الذي سجّلت دخوله
  - `platform` = `android`
  - `token` = string طويلة (~163 char) لا تبدأ بـ `{`
  - `is_active` = true

إذا لم يظهر صف:
- افتح Chrome devtools على الموبايل (chrome://inspect/#devices)
- ابحث عن log: `[NativePush] received FCM token (len=…)`
- إذا لا يوجد log → الـ permission مرفوض. اذهب Settings → Apps → SOSphere → Permissions → Notifications → Allow

---

## Step 4 — اختبار التسليم الفعلي

**أبسط طريقة (من جهازك الحالي):**

شغّل الـ probe بـ Phase 3 = y:
```powershell
.\scripts\probe-push-delivery.ps1
```
- في Phase 3 اختر **y**
- أدخل الـ `user_id` (من Supabase → Auth → Users)
- أدخل `access_token` (من Chrome devtools → Application → Local Storage → `supabase.auth.token`)
- أدخل `project_ref` = `rtfhkbskgrasamhjraul`

**النتيجة المتوقعة:**
- response يحوي `sent_count: 1, fcm_count: 1, failed_count: 0`
- على الموبايل (شاشة قفل): **notification يظهر**:
  - عنوان: `SOSphere push probe`
  - body: `If you see this on the phone, FCM HTTP v1 works.`

✅ **إذا ظهر notification على شاشة القفل** = R-53/R-54/R-55 يعملان end-to-end. خاصية أهم gap في الـ life-safety architecture مغلقة.

---

## Step 5 — اختبار سيناريو SOS الحقيقي (الأهم)

1. على جهاز ثانٍ (موبايل آخر أو متصفح dashboard) سجّل دخول بحساب admin
2. أقفل شاشة الموبايل الأول
3. من الجهاز الثاني، اضغط زر SOS
4. **خلال 5 ثوانٍ يجب أن يصل notification على الموبايل الأول**:
   - severity: high (priority_max — يُيقظ الشاشة)
   - data.path = `/sos/<emergency_id>`
   - tap يفتح التطبيق مباشرة على شاشة SOS (deep link)

---

## Troubleshooting tree

### لا يظهر notification إطلاقاً

**1. هل الـ token مسجّل في `push_tokens`؟**
- لا → permission مرفوض. أعد تثبيت + اقبل النوتيفيكيشن
- نعم → اذهب 2

**2. هل `sent_count > 0` في probe response؟**
- لا → check failures[]:
  - `fcm_oauth_failed` → `FCM_SERVICE_ACCOUNT_JSON` خطأ. أعد upload-fcm-service-account.ps1
  - `HTTP 404 ... UNREGISTERED` → الـ token معطّل (المستخدم أزال التطبيق). أعد signup
  - `HTTP 403 ... SENDER_ID_MISMATCH` → google-services.json من مشروع Firebase خاطئ
- نعم لكن لا notification → اذهب 3

**3. notification يصل لكن لا يظهر على شاشة القفل**
- Battery optimization يقتل التطبيق → سيُعالَج في Day 3 (R-60)
- channel_id غير مسجّل → نحتاج NotificationChannel في MainActivity (يتم تلقائياً بـ Capacitor 6+)
- DND mode مفعّل على الموبايل → عطّله للاختبار

### Notification يظهر لكن tap لا يفتح التطبيق
- `pushNotificationActionPerformed` listener لم يُسجّل → تحقق log `[NativePush] notification tapped`
- `_deepLinkHandler` غير مُسجّل → سيُعالَج في Day 4 (R-63)

---

## Success criteria للـ Day 2 closure

- [x] Probe Phase 1 + 2 = PASS
- [ ] FCM token يظهر في `push_tokens` بـ `platform='android'`
- [ ] Probe Phase 3 = PASS مع `sent_count=1`
- [ ] Notification يظهر على شاشة القفل (Step 4)
- [ ] SOS real-flow notification يصل خلال 5s (Step 5)

عند إكمال 5/5، Day 2 مغلق رسمياً. ننتقل لـ Day 3 (Background GPS).
