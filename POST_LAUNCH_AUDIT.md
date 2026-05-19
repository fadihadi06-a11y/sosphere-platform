# SOSphere — Post-Launch Audit & Pending Work
**Created:** 2026-05-19
**Author:** Claude (continuation of LAUNCH_AUDIT.md after R-1 → R-47 closure)
**Status:** Living document — update as items close

> هذا الملف يجمع كل الفجوات المتبقية بعد إغلاق 47 من launch blockers (R-1 → R-47).
> الترتيب: من الأخطر إلى الأقل خطورة. كل بند يحوي السبب الجذري والحل المقترح والوقت التقديري.

---

## القسم 1 — فجوات هيكلية (Structural Gaps)

### G-1 : لا توجد طبقة اختبار End-to-End حقيقية
**الخطورة:** عالية جداً قبل launch عام.
**الواقع الحالي:** عندنا probes ومحاكاة (run-stripe-e2e-probe.ps1, vitest unit tests) لكن لا يوجد:
- اختبار يدوي مع Twilio ممول على أرقام حقيقية
- اختبار مع حسابات Stripe live مع subscription لحظية
- اختبار للـ mobile app على أجهزة Android/iOS حقيقية
- اختبار لمسار 911 fallback (R-34)

**الحل الجذري:**
1. تمويل Twilio بـ $20 على الأقل + شراء رقم تجريبي
2. إجراء الـ 6 سيناريوهات اليدوية المقترحة في نهاية جلسة R-47:
   - Forgot password (R-45)
   - 0-contacts SOS → 911 dial (R-34)
   - Free user PDF download → 402 (R-47)
   - Basic user PDF download → works (R-47)
   - Company register DPA ordering (R-41)
   - Multi-company portal (R-44)
3. soft launch مع 10-20 beta user لمدة 2-4 أسابيع قبل الإعلان العام

**الوقت التقديري:** 1 أسبوع اختبار + 4 أسابيع soft launch

---

### G-2 : لا يوجد Monitoring/Observability حقيقي
**الخطورة:** عالية. عند أول incident في production ستقرأ logs يدوياً.
**الواقع الحالي:**
- لا يوجد Sentry مهيأ
- لا توجد dashboards للـ Twilio breaker state
- لا توجد alerts إذا توقف `sweep_expired_abandoned_trials` cron
- لا توجد metrics لـ SOS p95 latency
- audit_log يكتب لكن لا أحد يقرأه إلا عند مشكلة

**الحل الجذري:**
1. إعداد Sentry على:
   - Mobile app (React Native / Capacitor)
   - Dashboard (React)
   - كل edge function (Deno Sentry SDK)
2. إنشاء Supabase Dashboard SQL views:
   - `v_breaker_open_count_24h` — Twilio breaker tripping rate
   - `v_sos_p95_latency_7d` — SOS dispatch latency
   - `v_cron_last_success_per_job` — متى نجح كل cron آخر مرة
   - `v_unmatched_sms_replies_pending` — R-40 backlog
3. PagerDuty أو Discord webhook على:
   - أي error بـ severity='critical' في audit_log
   - cron failure > 24h
   - breaker مفتوح > 15 دقيقة

**الوقت التقديري:** 3-5 أيام

---

### G-3 : Mobile App Audit — ✅ COMPLETED 2026-05-19
**النتيجة:** 18 ثغرة مكتشفة (7 🔴 CRITICAL, 8 🟡 MAJOR, 3 🟢 MINOR).
**التقرير الكامل:** `MOBILE_AUDIT_FINDINGS.md`

**أبرز الثغرات الحرجة:**
- R-48: hardcoded "911" في 0-contacts fallback (السعودية 997 — مكسور)
- R-53: `@capacitor/push-notifications` مثبت لكن غير مستخدم — Mobile لا يستلم push
- R-58: `navigator.geolocation` بدلاً من Capacitor — لا background GPS
- R-59: لا foreground service — App يموت في Doze mode
- R-63: deep links مُعرَّفة في manifest لكن لا handler في JS
- R-64: `assetlinks.json` غير منشور — App Links autoVerify معطّل
- R-56: iOS support غير موجود إطلاقاً

**خطة المعالجة:** 5 أيام عمل لكل الـ Android critical/major (R-48 → R-65).
**iOS منفصل:** 2-3 أسابيع إضافية.

---

## القسم 2 — R-47 Deferred (Civilian Tier features ناقصة)

### R-47.1 : Monthly Summary PDF Generator (Elite-exclusive)
**الواقع الحالي:** `monthlySummaryPdf: true` في TIER_CONFIG، الـ UI يقول "Coming with v1.1"، الـ generator غير موجود.
**ما يحتاج بناءه:**
1. Edge function جديد: `supabase/functions/monthly-summary-report/index.ts`
   - يأخذ user_id + month
   - يجمع كل incidents الشهر من sos_emergencies
   - يجمع safe-walk sessions
   - يجمع fall detections
   - يولّد PDF منظم باستخدام pdf-lib (نفس مكتبة forensicPdf)
2. pg_cron job: أول كل شهر 03:00 UTC، يستدعي function لكل Elite subscriber
3. Email send via Resend/Postmark webhook
4. Storage في `monthly_summaries` bucket (RLS: المستخدم فقط)
5. تحديث pricing.ts: إزالة "(coming v1.1)" من الـ feature string

**الوقت التقديري:** 1 أسبوع

---

### R-47.2 : Free User 30-Day Data Retention UI
**الواقع الحالي:** الـ data محفوظ لكن UI لا يقول للـ Free user أن بياناته متاحة 30 يوم فقط قبل الترقية.
**ما يحتاج:**
1. Banner في Mobile App للـ Free users يقول "بياناتك محفوظة لـ 30 يوم — رقّ للحفظ الدائم"
2. countdown على كل incident: "ستُحذف خلال 23 يوم"
3. pg_cron sweep بعد 30 يوم (`sweep_free_tier_old_incidents`)
4. واجهة "Recover data" تظهر فقط إذا رقّى المستخدم خلال نافذة الـ 30 يوم

**الوقت التقديري:** 4-5 أيام

---

### R-47.3 : Preview-only PDF for Free Users
**الواقع الحالي:** Free user يحصل على 402 — لكن لا يرى ما يفقده.
**التحسين المقترح:**
- بدلاً من 402 صلب، أعِد PDF بصفحة واحدة blurred + watermark "UPGRADE TO UNLOCK"
- يزيد conversion rate vs hard-block

**الوقت التقديري:** 2 أيام

---

## القسم 3 — MEDIUM Severity Items من LAUNCH_AUDIT.md

> لم نعالجها في جلسات R-1 → R-47 لأنها ليست launch-blockers، لكنها tech debt حقيقي.

### الأولوية الأولى (top 7 يجب معالجتها قبل soft launch)

**M-1 : Stripe Customer Portal لا يدعم language switching**
- portal يفتح بـ English دائماً حتى لو المستخدم عربي
- الحل: استخدام `locale: 'ar'` في portal session create

**M-2 : لا يوجد rate-limit على forgot-password edge function**
- يمكن لـ attacker إرسال 1000 password reset email لنفس الـ email
- الحل: rate-limit RPC (5 محاولات/ساعة/email)

**M-3 : audit_log لا يدوَر (rotate)**
- سيصبح حجم الجدول 10GB خلال سنة
- الحل: partitioning شهري + سياسة retention 18 شهر (مع backup قبل الحذف)

**M-4 : Twilio breaker state لا ينعكس في UI**
- المسؤول لا يعرف أن SMS أو call معطّل حالياً
- الحل: badge أحمر في dashboard header إذا breaker مفتوح

**M-5 : Family Circle invite link لا ينتهي**
- لو سُرّب link، يبقى valid للأبد
- الحل: انتهاء صلاحية 72 ساعة + ربط بـ inviter user_id

**M-6 : sos_dispatch_attempts لا يحوي device_battery_level**
- forensic value: معرفة ما إذا كان الهاتف على وشك النفاد عند الـ SOS
- الحل: إضافة column + جمعه من Capacitor Device plugin

**M-7 : لا يوجد "Test SOS" mode للمستخدمين الجدد**
- المستخدم الجديد يخاف تجريب الزر
- الحل: زر "Test mode" في الـ onboarding يحاكي السيناريو بدون استدعاء حقيقي

### الأولوية الثانية (يمكن تأجيلها للـ v1.2)

من 8 إلى ~30 — انظر LAUNCH_AUDIT.md `[MED]` tags.
أمثلة:
- M-8 : Dashboard analytics لا تحوي time-zone filter
- M-9 : CSV export للـ incidents بدون encoding (يكسر Arabic)
- M-10 : Buddy System تذكير لا يدعم Push notification (Email فقط)
- M-11 : Pre-shift checklist لا يحفظ progress إذا أغلق المستخدم التطبيق
- M-12 : Zones map لا يدعم heatmap mode
- M-13 : profile photo upload بدون image compression
- M-14 : signin-phone لا يدعم WhatsApp OTP fallback (SMS فقط)
- M-15 : invite CSV import بدون validation للـ Saudi phone format
- ...إلخ

---

## القسم 4 — Launch Readiness Verdict

**التقدير الحالي:** 80% — كافٍ لـ soft launch مع 50-100 beta user تحت مراقبة.
**ليس كافياً لـ:** حملة marketing واسعة أو App Store featured listing.

**خطة الوصول لـ 95% (launch-ready):**

| الأسبوع | المهام | الموارد |
|--------|--------|---------|
| 1 | تمويل Twilio + 6 manual tests + إصلاح أي ثغرة تظهر | $50 |
| 2 | Sentry + Dashboards (G-2) | $0 (Sentry free tier) |
| 3 | Mobile app deep audit (G-3) — Android | جهاز اختبار |
| 4 | Mobile app deep audit — iOS + TestFlight setup | $99/year Apple Dev |
| 5-6 | Monthly Summary PDF (R-47.1) + 30-day retention UI (R-47.2) | - |
| 7-8 | معالجة M-1 → M-7 | - |
| 9-12 | Soft launch مع 50 user + جمع feedback | Twilio credits |

**ميزانية متوقعة لمدة 3 شهور:** $300-500 (Twilio + Apple Dev + Postmark + Sentry pro إذا لزم)

---

## القسم 5 — قواعد العمل القادمة

1. **لا band-aids** — كل إصلاح جذري كما في R-1 → R-47.
2. **كل إصلاح يحوي تعليق R-XX (تاريخ): why** — للـ traceability.
3. **قبل أي merge:** Gate 1-5 (verify-before-push.mjs) + Stripe E2E probe إذا تأثر billing.
4. **audit_log قبل وبعد** — كل تعديل سياسة أو RPC يكتب audit row.
5. **never trust client-side gating alone** — كل feature gate يجب أن يُفرَض server-side أيضاً (R-47 model).

---

## القسم 6 — كيف نبدأ من هذه النقطة

عند الاستئناف:
1. افتح هذا الملف
2. اختر أولوية (G-1 / G-2 / G-3 / R-47.x / M-x)
3. أنشئ branch: `git checkout -b fix/Gx-short-name`
4. نفّذ بنفس منهجية R-XX (إصلاح جذري + audit + tests + verify-before-push)
5. أغلق البند في هذا الملف بـ ✅ + commit SHA

---

**ملاحظة شخصية للمالك:**
المنصة الآن في حالة يمكن النوم بأمان وأنت تعرف أن backend resilient. الفجوات الموجودة طبيعية لمشروع بهذا الحجم، والترتيب أعلاه هو الطريق الأقصر للوصول لمستوى production-grade حقيقي.

نَم مرتاحاً. عند الاستئناف، نبدأ من G-1.
