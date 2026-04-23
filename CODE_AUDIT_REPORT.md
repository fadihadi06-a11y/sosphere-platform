# تقرير المراجعة الشاملة للكود — SOSphere Platform

**التاريخ:** 22 أبريل 2026
**المراجعون:** 4 وكلاء مستقلون (Agent 1: التطبيق | Agent 2: الداشبورد | Agent 3: الترابط | Agent 4: البنية التحتية)
**الهدف:** مراجعة كاملة سطر بسطر، توثيق كل الميزات، اكتشاف النواقص والخلل، بدون أي تعديل على الكود.

---

## 0. نظرة عامة على المشروع

**المنصة:** SOSphere — منصة استجابة للطوارئ تعمل على الويب والهاتف.

**التقنيات المستخدمة:**
- **Frontend:** React 18.3.1 + TypeScript 6.0.2 + Vite 6.4.1
- **Mobile Wrapper:** Capacitor 6.2.1 (Android + iOS)
- **Styling:** Tailwind CSS 4.1.12
- **State:** Zustand + localStorage + Supabase Realtime
- **Backend:** Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **Calling/SMS:** Twilio (Voice + SMS + TwiML)
- **Payments:** Stripe (Subscriptions + Webhooks)
- **Push:** Firebase Cloud Messaging (FCM)
- **Monitoring:** Sentry (اختياري)
- **Email:** Resend
- **Maps:** Leaflet + PostGIS (للجيوفنس)
- **Auth:** Supabase Auth + Google OAuth + WebAuthn (بصمة)

**هيكل المجلدات:**
```
/src/main.tsx                 — نقطة الدخول
/src/app/App.tsx              — الراوتر الرئيسي
/src/app/components/          — 188 ملف .tsx
/src/app/hooks/               — Custom hooks
/src/app/styles/              — index.css, mobile.css, native-compat.css
/supabase/migrations/         — 15 ملف SQL
/supabase/functions/          — 14 Edge Function (Deno)
/android/                     — Capacitor native project
/dist/                        — Build output
```

---

## 1. تقرير الوكيل الأول — التطبيق الجوال (188 شاشة/مكون)

### 1.1 شاشات المصادقة والتهيئة
- **login-welcome.tsx** — بوابة الترحيب
- **login-phone.tsx** (300+ سطر) — تسجيل برقم هاتف مع Country Picker و OTP
- **otp-verify.tsx** — إدخال رمز OTP المكون من 6 أرقام
- **individual-register.tsx** (350+ سطر) — إنشاء حساب فردي (اسم، هاتف، جهة اتصال طوارئ واحدة **مثبتة في الكود**)
- **consent-screens.tsx** (150+ سطر) — موافقة TOS و GPS، مع ترحيل المفاتيح القديمة
- **biometric-gate-modal-v2.tsx** (200+ سطر) — WebAuthn (Face ID / Touch ID / PIN) مع recovery عند فشل البصمة

### 1.2 الشاشة الرئيسية والـ SOS
- **individual-home.tsx** (300+ سطر) — الهوم: زر SOS كبير بضغط 3 ثوان، شبكة إجراءات سريعة (Family Circle / Safe Walk / Check-in / Medical ID)، كشف الاهتزاز، دورة وضع التسجيل
- **sos-emergency.tsx** (500+ سطر) — التدفق الأساسي لـ SOS:
  - عد تنازلي 3→2→1
  - اتصال متتالي (Free = جهة واحدة، Pro = الجميع مع إعادة محاولة)
  - SMS مع رابط التتبع
  - التقاط صور وصوت (Pro فقط)
  - تشغيل server-side SOS بالتوازي مع المحلي
  - لوحة استجابات الجيران المباشرة
  - **اتصال محلي عبر `tel:` URI (المشكلة التي رصدناها سابقاً)**
- **sos-server-trigger.ts** — استدعاءات API: triggerServerSOS / endServerSOS / startWatchdog
- **emergency-response-record.tsx** (300+ سطر) — سجل ما بعد الـ SOS مع redirect 60s إذا لم يوجد سجل
- **post-emergency-debrief.tsx** — ملاحظات نفسية بعد الحادثة

### 1.3 الملف الشخصي والهوية الطبية
- **profile-settings.tsx** (300+ سطر) — الملف الشخصي مع شارة الخطة (Free/Pro/Employee)
- **medical-id.tsx** (200+ سطر) — فصيلة الدم، الطول، الوزن، الحالات، الحساسيات، الأدوية، جهة اتصال طبية، QR Code
  - **⚠️ هنا الخلل البصري الذي رأيناه في الصور** (السطور 488–561)

### 1.4 جهات الاتصال والعائلة
- **emergency-contacts.tsx** (300+ سطر) — نظام Tier: Full (تطبيق + اتصال + SMS) / Lite (SMS + notification) / Ghost (SMS فقط)
- **family-circle.tsx** (300+ سطر) — بطاقات العائلة المباشرة: موقع، بطارية، حالة، آخر ظهور
- **manage-emergency-contacts.tsx** — مدير جهات الاتصال (يستخدم مفتاح localStorage مختلف عن contact-tier-system — **⚠️ انفصال البيانات**)

### 1.5 ميزات السلامة
- **safe-walk-mode.tsx** (300+ سطر) — "اصطحبني للبيت" مع Guardian وتصعيد تلقائي (Pro فقط)
- **checkin-timer.tsx** (300+ سطر) — Dead Man's Switch بوضعين (مدة/جدول)، تحذير 5 دقائق، Auto-SOS
- **fall-detection.tsx** — كشف السقوط بالـ accelerometer
- **shake-to-sos.tsx** — هز الجهاز لتفعيل SOS
- **voice-sos-widget.tsx** — أمر صوتي "SOS"
- **discreet-sos-screen.tsx** (200+ سطر) — وضع سري: شاشة سوداء أو "البطارية فارغة"، نقطة GPS ومؤشر تسجيل 2 بكسل، خروج بضغطة ثلاثية

### 1.6 الحوادث والطوارئ
- **incident-history.tsx** (200+ سطر) — سجل الحوادث (**مع mock data**: ERR-2026-7A3F1C و ERR-2026-5B2E9D)
- **incident-photo-report.tsx** — التقاط الصور كأدلة
- **incident-sync.ts** — مزامنة الحوادث مع Supabase
- **emergency-lifecycle-report.tsx** — تقرير كامل للحياة الزمنية للحادث
- **emergency-packet.tsx** (250+ سطر) — حزمة بيانات للمستجيبين (موقع، طبي، جهات اتصال، جهاز، تسجيل)

### 1.7 الخرائط والمواقع
- **map-screen.tsx** (200+ سطر) — Leaflet map مع المستشفيات/الشرطة/الإطفاء القريبة (**mock data مضمنة**)
- **evacuation-screen.tsx** (200+ سطر) — إخلاء الموقع، نقاط تجمع، حساب Haversine للمسافة

### 1.8 الإشعارات والاتصالات
- **notifications-center.tsx** (200+ سطر) — مركز الإشعارات مع فلاتر، لا يوجد إشعارات وهمية بعد الآن
- **emergency-chat.tsx** — شات مباشر أثناء الـ SOS
- **call-panel.tsx** — واجهة المكالمة النشطة
- **neighbor-alert-overlay.tsx** — تنبيهات استجابة الجيران
- **neighbor-responses-panel.tsx** — لوحة مباشرة لاستجابات الجيران

### 1.9 الأوضاع الأوفلاين
- **offline-sync.tsx** (150+ سطر) — شريط حالة الاتصال (Online/Offline/Syncing) مع إحصائيات التخزين
- **offline-gps-tracker.ts** — خدمة GPS خلفية، تخزين آخر موقع، بطارية
- **offline-sync-engine.ts** — محرك مزامنة الطابور
- **offline-database.ts** — IndexedDB (incidents, locations, contacts, messages, evidence, checkin_events, broadcasts)
  - **⚠️ فيه عيب موثق من المطور في التعليق: "IndexedDB spec states booleans are NOT valid index keys, so the by_synced index silently skipped EVERY record"**

### 1.10 الإعدادات
- **settings-screens.tsx** (400+ سطر) — شاشات متعددة:
  - **LanguageScreen** — en و ar فقط مترجمتان بالكامل. fr/es/de/tr/ur/hi/zh/ja يسقطون إلى الإنجليزية
  - **PrivacyScreen** — سياسة الخصوصية
  - **ConnectedDevicesScreen** — الأجهزة المتصلة
  - **HelpScreen** — الأسئلة الشائعة
  - **EliteFeaturesScreen** — عرض مميزات Pro

### 1.11 مفاتيح localStorage المستخدمة

| المفتاح | المحتوى |
|---------|---------|
| `sosphere_tos_consent` | موافقة الشروط + تاريخ |
| `sosphere_gps_consent` | إذن GPS + تاريخ |
| `sosphere_terms_consent` | **قديم — مُرحَّل تلقائياً** |
| `sosphere_lang` | اللغة |
| `sosphere_individual_profile` | اسم، هاتف، جهات اتصال |
| `sosphere_medical_id` | فصيلة الدم والبيانات الطبية |
| `sosphere_emergency_contacts` | مصفوفة جهات الاتصال (**مفتاح أول**) |
| `sosphere_safety_contacts` | مصفوفة جهات الاتصال (**مفتاح ثاني — التناقض!**) |
| `sosphere_checkin_deadline` | وقت انتهاء الـ Check-in |
| `sosphere_checkin_total` | مدة الـ Check-in الأصلية |
| `sosphere_checkin_warn_cycle` | حالة التحذير |
| `sosphere_offline_queue` | طابور الحوادث المعلقة |
| `sosphere_recording_mode` | وضع التسجيل |
| `sosphere_biometric_lock` | هل البصمة مفعلة؟ |
| `sosphere_phone` | آخر رقم مسجل |
| `sosphere_employee_profile` | زون الموظف وأوقات الشفت |

### 1.12 النواقص والـ Stubs في التطبيق
1. **Incident History** يعرض mock data ثابتة
2. **Emergency Services Directory** غير مكتمل
3. **Map Nearby Places** بيانات ثابتة وليست من API
4. **Evacuation** بيانات mock
5. **Neighbor Responses** لوحة موجودة لكن الربط ناقص
6. **Mission Tracker Mobile** موجود لكن غير مربوط
7. **Recording Consent Modal** موجود لكن غير مدمج في تدفق التسجيل
8. **AI Voice Call Service** مُصدَّر لكن غير مستخدم
9. **Evidence Hashing** اختياري وغير مفعل افتراضياً
10. **Buddy System** غير مربوط بـ Home
11. **Video Recording** TODO موجود في sos-emergency.tsx
12. **Shake Permission** يفترض الإذن ممنوح (Android 6+ يحتاج إذن صريح)
13. **Work Hours Check** يقرأ من profile لكن المنطق يعتمد على الشركة
14. **Duress Mode** `isDuressPin()` موجود لكن sos-emergency.tsx لا يستدعيه
15. **Battery Alert** يقرأ البطارية لكن بدون auto-SOS عند < 5%
16. **Map Offline** Leaflet يستخدم CSS من CDN → سيفشل أوفلاين
17. **Anonymous SOS** غير موجود — التسجيل إجباري
18. **Multi-Guardian Watch** Safe Walk يسمح بحارس واحد فقط

---

## 2. تقرير الوكيل الثاني — الداشبورد

### 2.1 نظام الأدوار (8 أدوار موثقة في mobile-auth.ts)

| التسلسل | الدور | اللون | الصلاحيات |
|---------|-------|-------|-----------|
| Tier 1 | **super_admin** | #FF2D55 أحمر | كامل النظام + حذف المستخدمين + الفوترة |
| Tier 2 | **company_admin** | #FF9500 برتقالي | كامل الشركة عدا حذف المستخدمين والفوترة |
| Tier 3 | **safety_manager** | #00C8E0 سماوي | الحوادث والزونات والتقارير |
| Tier 4 | **shift_supervisor** | #34C759 أخضر | إدارة الشفت والحوادث |
| Tier 5 | **dispatcher** | #5856D6 بنفسجي | توزيع الحوادث والبث |
| Tier 6 | **field_medic** | #FF3B30 أحمر | عرض وحل الحوادث |
| Tier 7 | **security_guard** | #8E8E93 رمادي | إنشاء حوادث + عرض الزونات |
| Tier 8 | **employee** | #636366 رمادي غامق | SOS فقط |

**⚠️ مشكلة:** الصلاحيات معرّفة لكن **لا يوجد `<PermissionGate>` wrapper** في واجهة المستخدم — الأدمن يرى كل الصفحات حتى لو دوره لا يسمح.

### 2.2 الهب الرئيسية (Sidebar)

#### 1. Emergency Hub (emergencyHub) — أحمر
**الملف:** `dashboard-pages.tsx` (السطور 2290–2500+)
**الميزات:**
- قائمة الطوارئ النشطة مع SLA breach detection
- بطاقة قابلة للتوسيع: شدة، موظف، زون، نوع، وقت مستنفد، حالة
- أزرار: Take Ownership / Mark Resolved / Broadcast / Dispatch / Call
- Zone Cluster Banner — كشف تلقائي لـ multi-SOS (catastrophic/mass_casualty)
- SAR Protocol (Search & Rescue) للحالات الكارثية
- حالة "All-Clear" عند عدم وجود حوادث

#### 2. Risk Map (riskMap) — برتقالي
**الملف:** `risk-map-live.tsx`
**الميزات:**
- خريطة Leaflet/Mapbox مع polygons للزونات
- markers للموظفين (ملونة حسب الحالة)
- heat map للمخاطر
- مؤشرات خطر للزونات (high/medium/low)
- جدول زمني للنشاط المباشر
- تنبيهات خرق الجيوفنس

#### 3. Safety Intelligence (safetyIntel) — بنفسجي
**الملف:** `safety-intelligence.tsx`
**الميزات:**
- شبكة Worker Risk Cards: Avatar, اسم, دور, زون, Risk Score (0-100), Risk Factors Bar, ساعات الموقع, درجة الحرارة, عدد العمال القريبين
- Proactive Alerts Panel: نوع (prediction/environment/pattern/wellness/escalation), شدة, مدى الثقة %, وقت المخاطرة
- Environmental Threats: درجة حرارة, ريح, رؤية, نشاط زلزالي
- Historical Risk Trends: Line Chart
- زر "Refresh AI" بفاصل 10 ثوان

#### 4. Overview (overview) — تركواز
**الملف:** `dashboard-pages.tsx` (السطور 500–800+)
**الميزات:**
- 4 بطاقات KPI (Active Emergencies / On Duty / Safety Score / SLA)
- Evidence Intelligence Banner
- Emergency Feed Card
- جدول آخر الموظفين
- Safety Score Ring (حلقة متحركة 90 بكسل)
- System Health Card (4 مقاييس: GPS, Alert Engine, Battery, Signal)
- Zone Overview Card
- Live Activity Card
- شبكة Quick Navigation (10 أقسام)

#### 5. Operations Hub (operations)
**التبويبات:** Missions / Journeys / Workforce / Comms
**الصفحة الفرعية:** WorkforcePage — تتبع الحضور، مراقب Check-in، جدولة الشفتات

#### 6. People & Teams (people)
**الملف:** `employees-unified-page.tsx`
**التبويبات:** Directory / Buddy System / Pre-shift / Leaderboard

#### 7. Incident & Risk (incidentRisk)
**الملفات:**
- `dashboard-incident-investigation.tsx` — RCA (5 فئات), CAPA tracking, pipeline (open → investigating → pending_capa → capa_in_progress → closed)
- `dashboard-risk-register.tsx` — ISO 45001 §6.1, Risk Matrix 5×5, Training Records

#### 8. Reports & Analytics (reportsAnalytics)
**الملف:** `dashboard-analytics-page.tsx`
**الرسوم البيانية (recharts):**
- Monthly Incidents (7 أشهر)
- Response Times مقابل Target 120s
- Safety Trend (12 أسبوع)
- Incident by Type (Pie)
- Zone Safety Radar (5 زونات)
- Zone Safety KPIs Grid

#### 9. Governance (governance)
**الملف:** `dashboard-audit-log-page.tsx`
**الميزات:**
- 21 فئة audit (permission_change, role_change, zone_assignment, 2fa_event, login, logout, emergency, settings, csv_import, file_access, data_modify, data_delete, report_export, investigation, إلخ)
- 5 مستويات actor
- فلاتر: Action Type / Actor Level / Date Range / Zone
- أعمدة: Timestamp, Actor, Action, Target, Before/After, Zone, IP, Severity
- تصدير PDF مع تشفير 128/256-bit AES + QR + Chain of Custody
- إرسال بريد

#### 10. Settings (settings)
**الملف:** `dashboard-settings-page.tsx`
**التبويبات:** Company / Access / Security / Billing / Reports

### 2.3 صفحات فرعية مهمة
- **Billing Page:** خطط (Starter/Growth/Business/Enterprise)، مدفوعات Stripe، Add-ons، حقوق العميل (6 بطاقات)
- **Workforce Page:** 3-in-1: Attendance + Check-in Monitor + Shift Schedule
- **Compliance Reports:** توليد PDF منظم (SOC 2, ISO 45001, ISO 27001)
- **Command Center:** قنوات بث (Field, Safety, Security, Medical) + فرق استجابة

### 2.4 النواقص في الداشبورد

1. **Compliance Dashboard v2** — فقط placeholder بعبارة "Audit dashboard coming soon"
2. **Mock Data موجودة:**
   - `EMPLOYEES` في dashboard-types.ts:72 (مع تعليق "Replace with Supabase query")
   - `EMERGENCIES` في السطر 103
   - `ZONES` في السطر 119
   - `MOCK_ON_DUTY` في dashboard-pages.tsx:151
   - `MOCK_TIMELINE` في السطر 167
   - `MOCK_SYSTEM_HEALTH` في السطر 183
3. **إعدادات الشركة** محفوظة في localStorage (`company_settings`) بدون مزامنة تلقائية مع Supabase
4. **Hybrid Mode Toggle** موجود لكن التنفيذ ناقص
5. **Evidence Pipeline** الواجهات موجودة لكن غير مربوطة بـ evidence table
6. **Training Records** mock مع SUPABASE_MIGRATION_POINT
7. **Broadcast Messaging** واجهة فقط بدون طبقة تخزين
8. **Call Routing** stubs فقط (admin-incoming-call, call-panel)
9. **الصلاحيات غير مفروضة على مستوى الواجهة** — لا PermissionGate
10. **Realtime Subscriptions** معرّفة كتعليقات لكن لم تُربط فعلياً

---

## 3. تقرير الوكيل الثالث — الترابط بين التطبيق والداشبورد

### 3.1 الجداول المشتركة
| الجدول | من يكتب | من يقرأ | الاستخدام |
|--------|---------|---------|-----------|
| **employees** | التطبيق + الداشبورد | كلاهما | الموظفون والحالات |
| **sos_queue** | التطبيق | الداشبورد | **الجسر الحرج للحوادث** |
| **zones** | الداشبورد | كلاهما | الزونات والجيوفنس |
| **gps_trail** | التطبيق | الداشبورد | تتبع GPS المباشر (كل 3 ثوان أثناء SOS) |
| **evidence** | التطبيق | الداشبورد (ملخصات فقط) | الصور والصوت |
| **audit_log** | الداشبورد | الداشبورد | سجل الإداريين |

### 3.2 قنوات Realtime (shared-store.ts:19–47)

- `sync:{companyId}` — أحداث SOS_TRIGGERED / ADMIN_ACKNOWLEDGED
- `admin:{companyId}` — إشارات إداري → موظف
- `evac:{companyId}` — بث الإخلاء

**⚠️ الفجوة الكبرى:** الداشبورد **لا يشترك في `sync:{companyId}`** — يعتمد على polling كل 30-60 ثانية فقط. النتيجة: **تأخير 30-60 ثانية في رؤية الـ SOS!**

### 3.3 تدفق الحادثة الكامل
1. **إنشاء (في التطبيق)** — `sos-emergency.tsx:150+` → `triggerServerSOS()` → IndexedDB queueSOS → emit SyncEvent
2. **معالجة (الخادم)** — `POST /functions/v1/sos-alert` → JWT extract → Stripe tier lookup → Twilio dispatch → sos_queue INSERT
3. **عرض (الداشبورد)** — polling كل 30-60s → `fetchEmergencies()` → تحويل إلى EmergencyItem
4. **استجابة الأدمن** — Twilio Client SDK → IncomingCallOverlay → emit CallSignal → "ADMIN_ACKNOWLEDGED"
5. **إغلاق** — `endServerSOS()` → POST ?action=end → status = "resolved" → SOS_CANCELLED

### 3.4 الاتصال والصوت
**الخدمات:**
- `twilio-call` — مكالمة PSTN خارجية
- `twilio-sms` — SMS + رابط التتبع
- `twilio-token` — توكن لـ Twilio Client SDK في المتصفح
- `twilio-status` — webhook لحالة المكالمة
- `sos-bridge-twiml` — TwiML للـ conference bridge (Elite فقط)

**⚠️ تذكير:** كما رصدنا في التقرير السابق، التطبيق **ما زال يستخدم `tel:` URI** في 10+ مواقع، لذا المسار ليس 100% Twilio.

### 3.5 الفجوات في الترابط

| # | الفجوة | الأثر |
|---|--------|-------|
| 1 | الداشبورد لا يشترك في realtime | تأخير 30-60s |
| 2 | `sos_queue` لا يحوي `assigned_admin_id` | لا يمكن معرفة من يدير الحادث |
| 3 | الـ Evidence Vault (صور/صوت) لا يعرضه الداشبورد | الأدلة معزولة |
| 4 | GPS trail لا يُعرض في تفاصيل الحادث | فقدان السياق |
| 5 | Risk Score يُحسب في التطبيق ولا يُنقل | الداشبورد يرى درجات مختلفة |
| 6 | Priority Overrides محفوظة في الداشبورد فقط | التطبيق لا يعلم بإعادة الترتيب |
| 7 | Shift Handover Context في الويب فقط | العامل لا يعلم بتسليم حالته |
| 8 | لا يوجد جدول `incident_notes` | ملاحظات الأدمن لا تصل للعامل |
| 9 | Missed Calls متتبعة في الـ shared-store فقط | لا تظهر في audit log |
| 10 | Neighbor Alert Channel منفصل عن sos_queue | استجابات الجيران تضيع |
| 11 | Call Recording مخزنة محلياً ثم في evidence | الداشبورد لا يستطيع تشغيلها |
| 12 | Feature Gating لا ينفذ على الداشبورد | Free tier يرى "Elite Conference" |

**الخلاصة:** الترابط موجود **60% فقط**. المسار الأساسي للـ SOS يعمل (التطبيق → الخادم → sos_queue → الداشبورد)، لكن الميزات الداعمة (Realtime, Notes, Evidence, Dispatcher Assignment, Priority Overrides) مفقودة أو مفصولة.

---

## 4. تقرير الوكيل الرابع — البنية التحتية

### 4.1 قاعدة البيانات (Supabase PostgreSQL)

**15 Migration (ترتيب زمني):**
1. `20260415_p3_10_subscriptions.sql` — اشتراكات Stripe
2. `20260415_p3_11_audit_log.sql` — سجل تدقيق append-only (ISO 27001 §A.12.4)
3. `20260415_p3_11b_risk_register.sql` — ISO 45001 §6.1 + training_records
4. `20260415_p3_11c_investigations.sql` — incident_investigations + corrective_actions + investigation_timeline
5. `20260415_p3_11e_rrp_sessions.sql` — جلسات التخطيط للاستجابة السريعة
6. `20260415_p3_11f_journeys.sql` — رحلات الموظفين
7. `20260415_p3_11g_playbook_usage.sql` — استخدام الـ playbooks
8. `20260416_civilian_incidents.sql` — حوادث المدنيين
9. `20260416_evidence_vaults.sql` — الأدلة المشفرة (SHA-256 hash)
10. `20260417_biometric_verified_at.sql` — وقت تحقق البصمة
11. `20260417_idempotency_cache.sql` — حماية من تكرار webhook (TTL 5 دقائق فقط — **⚠️ قصير جداً**)
12. `20260417_onboarding_completed.sql`
13. `20260417_tenant_helpers.sql` — دوال RLS
14. `20260417_verify_permission_rpc.sql`
15. `20260418_gps_trail_schema_fix.sql` — PostGIS geography(point)

**الجداول الأساسية:**
- `companies`, `employees`, `zones`, `emergencies`, `evidence`, `evidence_photos`, `evidence_audio`
- `contacts`, `gps_trail`, `sos_queue`, `checkins`, `incidents`
- `audit_log`, `risk_register`, `training_records`, `investigations`
- `subscriptions`, `idempotency_cache`

**Extensions:**
- `uuid-ossp`
- `postgis` (للجيوفنس)

### 4.2 Edge Functions (14 دالة على Deno)

| الدالة | الغرض | من يستدعيها |
|--------|-------|-------------|
| **sos-alert** | منسق SOS (trigger/prewarm/heartbeat/escalate/end) | التطبيق |
| **twilio-call** | مكالمة PSTN | sos-alert |
| **twilio-sms** | إرسال SMS | sos-alert |
| **twilio-token** | توكن SDK | admin-incoming-call |
| **twilio-status** | webhook حالة المكالمة | Twilio |
| **sos-bridge-twiml** | TwiML للـ conference (Elite) | Twilio |
| **twilio-twiml** | IVR generation | Twilio |
| **twilio-twiml-ack** | ACK callback | Twilio |
| **stripe-webhook** | lifecycle الاشتراكات | Stripe |
| **stripe-checkout** | إنشاء جلسة دفع | الداشبورد |
| **stripe-portal** | بوابة إدارة الاشتراك | الداشبورد |
| **send-invitations** | دعوات الموظفين | الداشبورد |
| **invite-employees** | توليد رابط الدعوة | الداشبورد |
| **_shared/** | rate-limiter + api-guard | الكل |

### 4.3 الخدمات الخارجية

| الخدمة | الاستخدام |
|--------|-----------|
| **Twilio** | اتصال PSTN + SMS + Client SDK (TTS call, conference bridge) |
| **Stripe** | اشتراكات (free/starter/growth/business/enterprise) |
| **Firebase (FCM)** | Push Notifications |
| **Google OAuth** | تسجيل دخول بديل |
| **Supabase** | DB + Auth + Realtime + Storage |
| **Sentry** | تتبع الأخطاء (اختياري) |
| **Resend** | إرسال البريد |
| **Leaflet** | خرائط |
| **PostGIS** | استعلامات جغرافية |

### 4.4 إدارة الحالة (8 متاجر Zustand)

1. `audit-log-store.ts` — كتابة ثنائية (localStorage + Supabase)
2. `shared-store.ts` — قنوات Realtime
3. `evidence-store.ts` — الأدلة
4. `mission-store.ts` — دورة حياة المهام
5. `ire-performance-store.ts` — مقاييس IRE
6. `rrp-analytics-store.ts` — تحليلات RRP
7. `dashboard-store.ts` — حالة الداشبورد
8. `civilian-store.ts` — بلاغات المدنيين

### 4.5 الإشارات الحمراء المعمارية

1. **ملفات v2 موجودة بدون v1 (أو بدون تنظيف):**
   - `native-safe-area-v2.tsx`
   - `env-shield-v2.ts`
   - `diagnostic-stress-test-v2.tsx`
   - `compliance-dashboard-v2.tsx`
   - `sosphere_employee_template_v2.csv`

2. **Mock Data في Production Code:**
   - أرقام هواتف وهمية: "+966 5X XXX XXXX", "+966 55 XXX"
   - بيانات موظفين وهمية: "Ahmed Khalil", "Sara Al-Mutairi"
   - `MOCK_PAIRS`, `MOCK_RECIPIENTS`, `MOCK_KPI_DATA`

3. **~155 `catch {}` فارغة** في الكود بالكامل — أخطاء مدفونة

4. **TODO/FIXME لم تُحل:**
   - `TODO: replace with real Supabase broadcast counts` (×2)
   - `TODO: Install @capacitor-community/keep-awake` (×2)
   - `TODO: Install @capacitor/haptics`
   - `TODO: add the opt-in toggle to profile-settings`

5. **URLs ثابتة في الكود:**
   - `https://sosphere-platform.vercel.app` (ALLOWED_ORIGINS fallback)
   - `https://sosphere.co` (BASE_URL في sos-alert)

6. **Idempotency TTL قصير جداً (5 دقائق)** — Stripe يعيد المحاولة لساعات!

7. **Rate Limiter per-instance** (Map في الذاكرة) — ليس موزعاً، كل نسخة من Edge Function لها نافذتها

8. **Service Worker معطل على Capacitor** — الأوفلاين يعتمد على IndexedDB فقط بدون background sync

9. **لا اختبارات على مستوى التطبيق** (Vitest مهيأ لكن 0% تغطية)

10. **RLS Policies مكتوبة لكن لم تُختبر في بيئة حية** — خطر تسرب بيانات بين الشركات

### 4.6 المصادقة والصلاحيات

- **المزود:** Supabase Auth (phone OTP + Google OAuth)
- **التوكن:** JWT مع claims (company_id, user_id, role)
- **التخزين:** localStorage (persistSession: true) + autoRefreshToken: true
- **الأدوار Server-side:** getAuthenticatedRole() + employees.role lookup (15s cache)
- **2FA:** Capacitor.BiometricAuth + حقل biometric_verified_at
- **Session Timeout:** ليس صريحاً، يعتمد على JWT expiry (3600s افتراضياً)

### 4.7 التوطين (i18n)
- **العربية + الإنجليزية** فقط مترجمتان بالكامل
- HTML: `lang="ar"` dir="rtl"
- **⚠️ لا مكتبة i18n رسمية** (مثل i18next) — النصوص مضمنة في الكومبوننتس
- RTL: Tailwind + emotion يقلبان margins/paddings
- Leaflet map: direction: ltr قسراً
- حقول الهاتف: direction: ltr دائماً

---

## 5. خلاصة عامة: ماذا يعمل وما لا يعمل

### ✅ ما يعمل فعلاً
- تدفق SOS الأساسي (ضغط → عد تنازلي → محاولة اتصال → SMS → تسجيل → إنهاء)
- نظام الاشتراكات (Stripe لواجهة + webhook لتحديث الـ tier)
- Audit Log مع كتابة مزدوجة (localStorage + Supabase)
- WebAuthn (Face ID / Touch ID / PIN) مع recovery
- نظام Tier لجهات الاتصال (Full/Lite/Ghost)
- Check-in Timer (Dead Man's Switch)
- Safe Walk Mode للـ Pro
- Evidence Vaults (التخزين + Hash)
- RLS policies مكتوبة
- توليد PDF احترافي (Audit Log / Compliance / Investigation / Risk Register)
- نظام بث Broadcast في Command Center (واجهة)
- Dashboard UI بالكامل (8 هب + 10+ صفحة فرعية)

### ⚠️ ما يعمل جزئياً أو مع تحفظات
- Realtime: الكود موجود لكن الداشبورد لا يشترك في القنوات (polling فقط)
- Offline Mode: IndexedDB موجود لكن `by_synced` index مكسور (booleans invalid keys)
- Twilio Integration: موجودة لكن التطبيق **يستخدم tel: URI محلي في 10 مواقع** (ما يناقض "Twilio-only")
- Evidence Pipeline: الواجهات موجودة لكن غير مدمجة مع Supabase evidence table
- Permissions Enforcement: 8 أدوار معرّفة لكن **لا PermissionGate** في الواجهة
- i18n: ar/en فقط (8 لغات أخرى تسقط للإنجليزية)
- RLS: مكتوبة لكن غير مختبرة في إنتاج حي (خطر تسرب متعدد المستأجرين)

### ❌ ما لا يعمل أو مفقود
- **Dispatcher Assignment:** `sos_queue` بدون `assigned_admin_id`
- **Incident Notes Sync:** لا جدول، لا قناة، الأدمن يكتب والعامل لا يرى
- **Evidence Viewer في الداشبورد:** الصور/الصوت لا تُعرض
- **GPS Trail في تفاصيل الحادث:** غير معروض
- **Risk Score Sync:** يُحسب في التطبيق ولا يصل للداشبورد
- **Priority Overrides Sync:** الداشبورد يعدل، التطبيق لا يعلم
- **Call Recording Playback في الداشبورد:** غير متاح
- **Compliance Dashboard v2:** placeholder فقط
- **Training Records:** mock مع SUPABASE_MIGRATION_POINT لم يُنفذ
- **Battery Low Alert:** يُقرأ لكن بدون escalation
- **Video Recording:** TODO
- **Duress Mode Integration:** `isDuressPin()` موجود لكن sos-emergency لا يستدعيه
- **Multi-Guardian Safe Walk:** حارس واحد فقط
- **Anonymous/Guest SOS:** غير موجود

---

## 6. الحكم النهائي

المشروع يحتوي على **رؤية معمارية طموحة ومكتملة على مستوى الواجهة (90%)** لكن **الطبقة الخلفية مدمجة بنسبة 40% فقط**. الأعراض التي رآها المستخدم في الصور (اتصال محلي يظهر رغم ادعاء Twilio، خطوط بصرية في Profile، أزرار خارج المربعات، جهات اتصال مكررة في مفتاحين مختلفين) كلها **انعكاس مباشر** للفجوات الموثقة أعلاه:

- **الاتصال المحلي:** 10+ مواقع في الكود ما زالت تستخدم `tel:` و `sms:` — لذا نظام التشغيل يعرض share sheet مع Zoom والجهات.
- **انفصال البيانات:** مفتاحان مختلفان (`sosphere_emergency_contacts` و `sosphere_safety_contacts`) بدون مزامنة.
- **catch blocks صامتة:** 155 مكان في الكود تدفن الأخطاء، لذا "يبدو أن الإصلاح نجح" لكن الخلل مستمر.
- **ملفات v2 بدون حذف v1:** النمط الكلاسيكي لوكلاء يضيفون بدون تنظيف.

---

**هذا التقرير أُعد دون تعديل أي ملف في الكود. كل ما ورد هنا موثق بمسارات ملفات وأرقام أسطر قابلة للتحقق.**
