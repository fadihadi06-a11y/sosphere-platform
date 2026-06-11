# دليل المالك الكامل — SOSphere
**كل خطوة، كل حقل، كل مسار — مستخرج من كود التطبيق الفعلي**
آخر تحديث: 2026-06-10

---

## ٠. سلسلة الدخول (مكتملة ومُختبَرة ✅)

ترتيب الشاشات في آلة الحالة (`dashboard-web-page.tsx`):

```
form (البريد)  →  email-otp (رمز ٦ أرقام عبر Resend)  →
mfa-challenge (Google Authenticator، إن وُجد عامل TOTP)  →
pin-setup / pin-verify (رمز PIN من ٦ أرقام للوحة)  →
register (إن لا توجد شركة)  أو  dashboard (إن وُجدت)
```

بعد التحقّق من البريد يستدعي الكود `loadCanonicalIdentity`. القرار:
- **يوجد `active_company`** → يدخل الداشبورد مباشرةً.
- **لا توجد شركة** → ينتقل إلى خطوة **register** (معالج إنشاء الشركة أدناه).

> ملاحظة: رمز PIN يُنشأ **بعد** تسجيل الشركة وليس قبله.

---

## ١. إنشاء الشركة — معالج من ٦ خطوات (`company-register.tsx`)

العنوان: **"SOSphere / FREE TRIAL"**، وزر **"Back to Login"**. شريط تقدّم (٥ أو ٦ مقاطع — يُحذف باني المناطق إن اخترت "لا مناطق"). الزر السفلي **"Continue"** في كل الخطوات، ويصبح **"Start 14-Day Free Trial"** في الخطوة ٥.

### الخطوة ١ — "Company Profile"
*"Tell us about your organization & owner account"*

| الحقل | اللصاقة في الواجهة | إلزامي؟ | ملاحظات |
|---|---|---|---|
| اسم المالك | **OWNER FULL NAME** | نعم (≥٢ حرف) | مثال: `Abdullah Al-Rashid` |
| بريد العمل | **BUSINESS EMAIL** | **اختياري** | عند صحّته يظهر "Business email verified"؛ الدعوات تُرسل من `noreply@{نطاقك}` |
| اسم الشركة | **COMPANY NAME** | نعم (≥٢) | مثال: `ARAMCO Safety Division` |
| القطاع | **INDUSTRY** | نعم | ٦ خيارات: Construction · Oil & Gas · Manufacturing · Healthcare · Logistics · Other |
| حجم الفريق | **ESTIMATED TEAM SIZE** | — | شريط ١–٣٥٬٠٠٠ (افتراضي ٢٥) |
| الدولة | **COUNTRY** | — | افتراضي SA؛ (SA, AE, QA, KW, BH, OM, EG, US, GB, Other) |

### الخطوة ٢ — "Field Zones"
*"Does your company operate in designated field zones?"* — بطاقتان: **"Yes, We Have Zones"** أو "No". اختيار "No" يتخطّى الخطوة ٣.

### الخطوة ٣ — باني المناطق (Zone Builder)
لكل منطقة: الاسم (`Zone A - North Gate`)، **ZONE_TYPE** (Office/Warehouse/Production/Outdoor/Restricted)، مستوى الخطر (low/medium/high)، نقطة الإخلاء (`Assembly Point A`)، والموقع عبر **لصق رابط Google Maps** أو إدخال Latitude/Longitude + نصف القطر يدوياً. الزر: **"Add Zone"** / **"Add Another Zone"**.

### الخطوة ٤ — إعداد الموظفين
ثلاثة تبويبات: **manual** / **csv** / **"Add Employees Later"**.
- **يدوي** لكل موظف: `Full Name *` · `Phone *` · `Role` · `Department` (+ بريد/منطقة).
- **CSV** الأعمدة المطلوبة: employee_id, full_name, phone (WhatsApp), email, department, role + (اختياري: zone, emergency_contact, blood_type).

### الخطوة ٥ — "Choose Plan"
بطاقات خطط (starter/growth/business/enterprise)، تبديل شهري/سنوي، وتوصية تلقائية حسب الحجم.
**بوابة DPA إلزامية للمتابعة:** "Data Processing Agreement"، حقل المنصب (افتراضي "Owner")، رابط **"Read full DPA →"**، وخانة اختيار:
> *"I, {اسمك} ({المنصب}), accept the SOSphere DPA v2026-05-07 on behalf of {اسم الشركة}."*

### الخطوة ٦ — النجاح والإطلاق
*"Company Created Successfully! 14-day trial activated."* — بطاقة **Invite Code** مع **"Copy Invite Code"**، ثم زر **"Launch Company Dashboard"**.

**ما يحدث عند الضغط على Launch (في قاعدة البيانات):**
1. `register_company_full` — يُنشئ الشركة + عضوية المالك (role=`owner`) + المناطق + الدعوات (عملية ذرّية واحدة).
2. `accept_company_dpa` — يسجّل توقيع الـ DPA (يجب أن ينجح قبل إرسال الدعوات).
3. `start_company_trial` — تجربة ١٤ يوماً.
4. `enqueue_job("bulk_invite")` — إرسال دعوات الموظفين بالبريد.

ثم ينتقل إلى **pin-setup** لإنشاء رمز PIN للوحة.

---

## ٢. خريطة الداشبورد — الشريط الجانبي (`company-dashboard.tsx`)

مرتّب حسب "أولوية الخطر". كل "Hub" يفتح شريط تبويبات فرعية:

**🔴 Live Threat**
- **Emergency Hub** — تبويبات: Live Alerts · Reports · History · Command · SAR · Playbook. مركز قيادة النداءات والحوادث.
- **Risk Map** — خريطة الخطر الحيّة. *(مقيّدة بالخطة)*

**🧠 Intelligence**
- **Safety Intelligence** — رادار تنبّؤي للمخاطر.
- **Overview** — الصفحة الرئيسية / مؤشرات الأداء.

**🔵 Operations**
- **Operations Hub** — Missions · Journeys · Workforce (حضور/ورديات) · Comms Hub (بث/إخلاء) · Connectivity (دون اتصال).
- **People & Teams** — Directory (الموظفون) · Buddy System · Pre-Shift · Safety Score · Jobs.
- **Drones**.

**🟢 Compliance**
- **Incident & Risk** — Investigation · Risk Register.
- **Reports & Analytics** — Reports · Analytics · Leaderboard · Scheduler. *(بعضها مقيّد بالخطة)*

**⚙️ System**
- **Governance** — Audit Trail · Roles & Access · Pipeline Health. *(يظهر للمالك/الأدمن فقط — صلاحية `settings:view`)*
- **Settings** — دائم في أسفل الشريط.
- **Billing** — داخل Settings كتبويب فرعي (وعبر أزرار "Upgrade").

أعلى الشريط زر **"Guide Me"** يفتح لوحة إرشاد سياقية (يصبح **"GUIDE ME NOW"** أحمر أثناء حالة طوارئ نشطة).

> **RBAC:** الصفحات المحميّة تظهر رسالة *"This page requires a higher permission level…"* لمن لا يملك الصلاحية. صفحات الخطة تعرض بوابة ترقية (PlanGate) تقود إلى Billing.

---

## ٣. الموظفون والأدوار

### الأدوار (٩ أدوار — `mobile-auth.ts`)
| المعرّف | اللصاقة | المستوى |
|---|---|---|
| `company_owner` | **Owner** | ١ (كل الصلاحيات) |
| `super_admin` | Super Admin | ١ |
| `company_admin` | Company Admin | ٢ |
| `safety_manager` | Safety Manager | ٣ |
| `shift_supervisor` | Shift Supervisor | ٤ |
| `dispatcher` | Dispatcher | ٥ |
| `field_medic` | Field Medic | ٦ |
| `security_guard` | Security Guard | ٧ |
| `employee` | Employee | ٨ |

المالك (`company_owner`) يملك **كل** الصلاحيات الـ٢٨.

### مسارات دعوة الموظفين (٣)
1. **أثناء التسجيل** (الخطوة ٤) → تُرسل بالبريد عبر `bulk_invite`.
2. **"Invite Employees"** (`employee-invite-manager.tsx`) — النموذج: *"SOSphere يجهّز رسالة الدعوة — وشركتك ترسلها من بريدها أو واتساب."* يعرض رمز الدعوة ورابط `https://sosphere.app/join/{code}` وقوالب بريد/واتساب جاهزة. الإرسال الجماعي عبر `create_employee_invitations_bulk`.
3. **Settings → Access Control → "Invite User"** — لإضافة مستخدمين بأدوار إدارية.

### تفعيل الموظف (`welcome-activation.tsx`)
رابط الدعوة `‎/welcome#access_token=…&type=invite` → الخطوات: `loading → set-password → success`. يحدّد الموظف كلمة مرور (≥٨، حرف كبير/رقم/رمز)، ثم `accept_invitation` يربطه بالشركة كعضوية نشطة. الروابط المنتهية تعرض *"Invitation link has expired…"*.

---

## ٤. المناطق والـ Geofences (Hub: Location & Zones)

- **Zones** (`ZonesPage`) — *"Site zones with risk levels & employee counts"* — عرض ومراقبة، مؤشرات (إجمالي المناطق / عالية الخطر / الأفراد)، وبثّ مباشر لعبور الحدود.
- **Geofencing** (`GeofencingPage`) — **المحرّر الفعلي**: رسم دائرة/مضلّع، نصف القطر، الخطر، اللون، قواعد التنبيه، قفل/إظهار، وزر **"Save All"**. الحفظ عبر `upsert_geofence` (يثبّت `company_id` في الخادم ويرفض غير الأدمن)، والحذف عبر `delete_geofence`.
- **GPS Compliance** — *"مراقبة الالتزام بالمناطق كل ١٥ دقيقة"*.

---

## ٥. إعدادات السلامة — شركة مقابل موظف

**المالك يضبط على مستوى الشركة** (Settings → Company، عبر `upsert_company_settings`):
- **"Hold-to-Activate SOS"** — *"اشتراط ضغط ٣ ثوانٍ لمنع التفعيل العرضي"*
- **Push & SMS Notifications** · **Geofencing** · **2FA** · **Auto-Escalation** · **Audit Log**
- فترة تسجيل الحضور (check-in) · **مهلة الجلسة** (30m/1h/8h/24h)
- مفاتيح الميزات: Zone Management · Geofencing Editor · Risk Map · Proximity Attend · Shift Scheduling · Zone Alerts.

**الموظف يضبط بنفسه** (من تطبيق الجوال، ليس لوحة المالك): **Medical ID** (فصيلة الدم…)، **Emergency Contacts**، **موافقة التسجيل** (recording consent)، و**رمز/أكواد الإكراه** (duress). المالك يضبط *السياسة*، والموظف يدخل *بياناته*.

---

## ٦. الإعدادات (`dashboard-settings-page.tsx`)

التبويبات: **Company** · **Access Control** · **Security** · **Billing** · **Email & Reports**.
- **Company**: ملف الشركة (Name, Industry, Size, Country, Time Zone, Contact Email — تظهر "Not configured" حتى تُملأ) + مفاتيح الميزات.
- **Access Control**: جدول الفريق + **"Invite User"** + مبدّل الأدوار.
- **Security**: حالة 2FA/SSO، تصدير سجل التدقيق (**"Export Log"**)، مهلة الجلسة.
- **DPA**: قسم `DpaSettingsSection` — أخضر إن كان سارياً، أو **"DPA v… requires acceptance"** مع زر **"Sign DPA"** (المالك فقط يوقّع).
- كل حفظ يسجّل حدث تدقيق `company_settings_updated`.

> لا يوجد حقل رفع شعار/branding في هذه الصفحة حالياً، ومسألة موقع البيانات (data residency) تُدار عبر الـ DPA/الدولة لا كمفتاح.

---

## ٧. الفوترة والاشتراك (`dashboard-billing-page.tsx`)

- التجربة (١٤ يوماً) تُنشأ عند التسجيل. يظهر شريط تجربة حيّ، وعند الانتهاء **تُقفل كل الصفحات عدا Settings و Billing**.
- **BillingPage** — *"Manage your plan, usage, and payment methods"* + `LiveBillingPanel` (يقرأ الحالة عبر `get_company_subscription_state`) وأزرار **Cancel Trial / Manage Payment / Upgrade**.
- **Stripe** عبر ٣ دوال طرفية: `stripe-checkout` · `stripe-portal` · `stripe-webhook` (يتحقّق من ملكيتك عبر `is_company_owner`). يتطلّب صلاحية `billing:manage` للتغيير.

---

## ٨. الإرشاد والحالات الفارغة

- **لا توجد** صفحة "setup checklist" مستقلّة — الإعداد الأولي يمرّ عبر معالج التسجيل ثم صفحة Settings (أُزيل شريط المعالج ودُمج في Settings).
- الإرشاد الأساسي هو لوحة **"Guide Me"** (زر الشريط الجانبي) — قائمة إجراءات سياقية، تصبح **"GUIDE ME NOW"** حمراء أثناء الطوارئ.
- شريط التجربة والتراكب عند انتهائها هما المُنبّهان الرئيسيان. الحقول غير المملوءة تظهر **"Not configured"**.

---

## ⚠️ تنبيهات إطلاق رصدتها أثناء الجلسة (خارج تدفّق المالك)

1. **Twilio غير مضبوط** → المكالمات الصوتية تعمل بين المتصفّحات فقط (WebRTC) **بلا اتصال هاتفي حقيقي (PSTN)**. لمنصّة طوارئ، الاتصال بأرقام جهات الطوارئ يحتاج ضبط Twilio. *(ظهر في الكونسول: `Twilio not configured — voice calls will use browser-only WebRTC`)*
2. **بريد Supabase**: تم حلّه عبر Resend SMTP ✅ — لكن للإطلاق وثّق نطاق `sosphere.co` في Resend واستخدم `noreply@sosphere.co` بدل `onboarding@resend.dev` (الذي يصل لبريدك فقط).
3. **طول OTP**: تأكّد من توحيده (الواجهة ٦، وكان Supabase ٨) لتجنّب أي عودة للمشكلة.

---

### الملفات المرجعية
`company-register.tsx` · `dashboard-web-page.tsx` · `company-dashboard.tsx` · `mobile-auth.ts` · `canonical-identity.ts` · `employee-invite-manager.tsx` · `welcome-activation.tsx` · `dashboard-geofencing-page.tsx` · `dashboard-settings-page.tsx` · `dashboard-billing-page.tsx` · `stripe-service.ts`
