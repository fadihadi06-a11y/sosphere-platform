# SOSphere — خطة إعادة تصميم شاملة للإطلاق
# Civilian App · Comprehensive Pre-Launch Redesign

> **الهدف:** جعل التطبيق مترابطاً بعمق، مع تحرير مرن لكل بيانات المستخدم في أي مكان تظهر فيه، بدون كسر الكود الحالي، وجاهزاً للإطلاق.

> **Goal:** Deep cross-screen coherence, contextual editing of every shared entity wherever it appears, zero regressions on working code, launch-ready.

> **القاعدة:** لن ألمس أي سطر كود قبل موافقتك على هذه الوثيقة.

---

## الجزء 1 — المبادئ · Design Principles

| # | المبدأ | Principle |
|---|--------|-----------|
| 1 | **مصدر واحد للحقيقة** — كل كيان (كونتاكت، صورة، طبي) مخزّن مرة واحدة ومقروء من كل الشاشات | Single source of truth for every shared entity |
| 2 | **تحرير سياقي** — أي مكان تُعرض فيه بيانات يمكن تعديلها من نفس المكان، بدون الذهاب لشاشة منفصلة | Contextual editing — edit in-place, not via a separate admin screen |
| 3 | **صدق البوابات (Gating)** — ميزات Pro/Elite مخفية أو معلّبة بوضوح، لا نعد بشيء ثم لا ننفذ | Honest gating — hide or clearly gate premium features, no fake toasts |
| 4 | **زر رجوع صادق** — يعود دائماً للشاشة السابقة الحقيقية، لا للـHome | Honest back — always returns to previous screen in history |
| 5 | **لا بيانات زائفة** — لا contacts افتراضية، لا notifications زائفة، لا incidents مفبركة تظهر عند التثبيت | No shipped-as-default fake data |
| 6 | **اتساق بصري** — نفس primitives (Card / Button / Modal / Sheet) عبر كل الشاشات | Same visual primitives across all screens |
| 7 | **تصميم آمن لـAndroid WebView** — لا `backdrop-filter`، استخدام `inset boxShadow` بدل `border` | WebView-safe rendering — no backdrop-filter, prefer inset boxShadow |
| 8 | **احترام safe-area-inset** — كل padding علوي/سفلي يحسب `env(safe-area-inset-*)` | Always respect safe-area-inset on all padding |

---

## الجزء 2 — طبقة البيانات المشتركة · Shared Data Architecture

### 2.1 مصادر الحقيقة في localStorage · Sources of Truth

| المفتاح Key | ماذا يحوي Contents | يُقرأ من Read by | يُكتب من Written by |
|---|---|---|---|
| `sosphere_emergency_contacts` | SafetyContact[] (name, countryCode, phone, relation, type, priority, isFavorite…) | Home, Family Circle, Safety Contacts, Emergency Packet, SOS flow, Safe Walk | Safety Contacts (CRUD), Family Circle invite, Home quick-add |
| `sosphere_user_profile` | `{ name, avatarUrl, dateOfBirth, zone, phone }` | Home header, Profile, Family Circle, Medical ID, Incident reports | Profile (edit), Home avatar tap |
| `sosphere_medical_id` | Blood type, height, weight, conditions, allergies, medications, medicalContact | Medical ID, SOS alert, Emergency Packet, QR code | Medical ID (only) |
| `sosphere_incident_history` | IncidentRecord[] | Incident History, Profile stats, Notifications, SOS report | SOS flow (append only) |
| `sosphere_notifications` | Notification[] | Notifications Center, bell badge on Home | Broadcast store, SOS flow, Check-in flow |
| `sosphere_subscription` | `{ tier: "free"\|"pro"\|"elite", expiresAt }` | EVERYWHERE — gating | Subscription flow |
| `sosphere_privacy_*` | `{ locationHistory, analytics, showProfile }` | Privacy screen, data collection points | Privacy screen |
| `sosphere_consent_*` | ToS / privacy consent timestamps | Login flow, legal modals | Consent flow |

### 2.2 الملف الجديد — `civilian-store.ts` · New Shared Store

بدل أن كل شاشة تقرأ وتكتب localStorage مباشرة (كما الحال الآن → يسبب تضارب وتحديثات بطيئة)، ننشئ ملفاً مركزياً:

```
src/app/components/shared-stores/civilian-store.ts
```

يصدّر React hooks:

```ts
useContacts()   → [contacts, { add, update, delete, setPrimary, setTracking }]
useProfile()    → [profile,  { updateName, updateAvatar, updateZone }]
useMedical()    → [medical,  { update, addCondition, addAllergy, addMedication }]
useIncidents()  → [incidents, { log, delete }]
useSubscription() → [tier, expiresAt, isPro, isElite]
```

الفوائد:
- أي شاشة تعدّل → كل الشاشات الأخرى تتحدث فوراً بدون reload
- واجهة واحدة للـvalidation (E.164، bloodType، إلخ)
- سهولة الانتقال مستقبلاً من localStorage إلى Supabase (كل الاستدعاءات في مكان واحد)

### 2.3 زر التحرير السياقي · ContextualEditButton

كل مكان تُعرض فيه بيانات مشتركة → زر `⋯` أو tap على الكارد → يفتح نفس الـmodal المشترك:

| المكان الذي يظهر فيه | النوع | الـmodal الذي يفتح |
|---|---|---|
| Home quick-contact pill | Contact | `<ContactEditSheet contact={...} />` |
| Family Circle member card | Contact | `<ContactEditSheet contact={...} />` |
| Safety Contacts list | Contact | `<ContactEditSheet contact={...} />` |
| Emergency Packet contact row | Contact | `<ContactEditSheet contact={...} />` |
| SOS alert confirmation screen | Contact | `<ContactEditSheet contact={...} />` (read-only) |
| Home header avatar | Profile photo | `<AvatarEditSheet />` (upload/camera/remove) |
| Profile screen avatar | Profile photo | `<AvatarEditSheet />` (same) |
| Family Circle avatar (self) | Profile photo | `<AvatarEditSheet />` (same) |
| Medical ID screen | Medical data | inline edit toggle (already exists — keep) |

**هذا جوهر طلبك:** "أينما تظهر الأشياء يجب أن أستطيع تعديلها" — كل البطاقات تستدعي نفس ورقة التحرير.

---

## الجزء 3 — خريطة التنقل · Navigation Graph

```
┌─────────────────────────────────────────────────────────┐
│                  Welcome / Onboarding                   │
│          (ToS consent → Phone → OTP → Plan pick)        │
└─────────────────────┬───────────────────────────────────┘
                      ▼
          ┌───────────────────────────┐
          │    IndividualLayout       │
          │    Bottom Tab Bar:        │
          │    [Home]  [Family]       │
          │    [Map]   [Profile]      │
          └───────┬───────┬───────┬───┘
                  │       │       │
    ┌─────────────┘       │       └──────────────┐
    ▼                     ▼                      ▼
  HOME               FAMILY CIRCLE             MAP SCREEN
  ├─ SOS button      ├─ Members list           ├─ Live GPS
  ├─ Check-in tab    ├─ Member detail sheet    ├─ Category chips
  ├─ Quick actions   │   ├─ Call (tel:)        ├─ Place list
  │   ├─ Family ────►│   ├─ Message (sms:)     └─ Place detail card
  │   ├─ Safe Walk   │   ├─ Request check-in       ├─ Directions (geo:)
  │   ├─ Check-in    │   └─ EDIT CONTACT           └─ Call (tel:)
  │   └─ Medical     ├─ Invite Modal
  ├─ Emergency       │   ├─ Code + Copy
  │   Contacts       │   ├─ SMS Invite
  ├─ Notifications   │   └─ Share Link
  └─ Security PIN    └─ Check All modal

                             PROFILE
                             ├─ Avatar (EDIT SHARED)
                             ├─ Subscription
                             ├─ Medical ID ────────► Medical ID screen
                             ├─ Incident History ──► History screen
                             ├─ Emergency Packet ──► Packet screen
                             ├─ Emergency Services ─► Services screen
                             ├─ Emergency Contacts ► Safety Contacts
                             ├─ Language
                             ├─ Privacy
                             ├─ Connected Devices
                             ├─ Help
                             ├─ Elite Features
                             └─ Log Out
```

كل سهم ← يعود بـ`goBack()` إلى الشاشة السابقة (ليس الـHome).

---

## الجزء 4 — ورقة تصميم لكل شاشة · Per-Screen Design Sheets

### 4.1 Home — الصفحة الرئيسية

| الحقل | التفاصيل |
|---|---|
| **الغرض** | نقطة الوصول الأسرع للـSOS + الميزات السريعة + معلومات الوضع الحالي |
| **الدخول من** | Tab bar (Home) — نقطة البداية بعد Login |
| **الخروج إلى** | Notifications (bell) · Security PIN modal · Medical ID (via quick action) · Safe Walk · Check-in Timer · Family Circle · Emergency Contacts |
| **البيانات المعروضة** | `profile.name` (header) · `contacts.filter(isFavorite)` (quick access) · `notifications.unread.count` (badge) · `incidents.active` (status) |
| **الأحداث المستجيبة لها** | Shake detection (3x) · Hold SOS (3s) · Tap quick action |
| **الأحداث التي تطلقها** | `sos.trigger()` · `checkin.start()` · `recording.toggle()` · `emit("sos-triggered")` إلى إدارة الإعلام |
| **Pro/Free gating** | Recording mode: Free = "after only"، Pro = "during/both/after" · Shake: مجاني · Hold: مجاني |
| **الأزرار الحالية ومشاكلها** | "Hold 3s" pill حالياً `<div>` بلا onClick (يبدو زر) — نغيّره `<span>` غير تفاعلي أو نضيف helper tooltip |
| **التعديل المطلوب** | 1. Avatar header قابل للتعديل (tap → AvatarEditSheet) 2. Quick contacts (أول 3 favorites) — tap = call، long-press = edit 3. Hold 3s تصبح tag ثابتة لا زر |
| **الترابط مع التقارير** | SOS trigger → يدفع إلى `incidents` + `notifications` |

### 4.2 Safety Contacts — جهات الأمان

| الحقل | التفاصيل |
|---|---|
| **الغرض** | CRUD كامل لـemergency contacts — المصدر الرسمي |
| **الدخول من** | Profile → Emergency Contacts · Home quick-card "Add Contact" · Home "View All" · Family Circle "Invite" |
| **الخروج إلى** | زر Back → الشاشة السابقة (ليس Home) |
| **البيانات** | يقرأ/يكتب `sosphere_emergency_contacts` عبر `useContacts()` |
| **الأحداث** | تعديل كارد → emit event → Home + Family Circle + SOS flow تستقبل التحديث فوراً |
| **Pro/Free gating** | Free: 1 tracking + 1 ghost. Pro: غير محدود. **الواجب:** إخفاء زر "Add" عند الوصول للحد، إظهار upsell |
| **المشاكل الحالية** | (أُصلحت في الجولة السابقة) stats tiles شخوط · `overflow: hidden` معطّل `paddingBottom` sheet · priority badge خارج الأفاتار |
| **التعديل** | 1. ContactCard الجديد مع زر ⋯ 2. زر "Favorite" يُحوّل الكونتاكت إلى Primary (أعلى الأولوية في SOS) 3. Ghost contact: يولّد Safety Link + QR — لا يتطلب تطبيق 4. Drag-to-reorder priority (Pro) |

### 4.3 Family Circle — دائرة العائلة

| الحقل | التفاصيل |
|---|---|
| **الغرض** | عرض حالة الأحباء في الوقت الفعلي (online/offline/safe/SOS) + تواصل سريع |
| **الدخول من** | Tab bar (Family) · Home quick action "Family" |
| **الخروج إلى** | Member detail sheet (in-place) · Invite modal · Check-all modal · Back → Home tab |
| **البيانات** | يقرأ `contacts` من `useContacts()` (**تحذير:** حالياً يقرأ localStorage مباشرة → نقل للـstore) |
| **الأحداث** | tap member → sheet · call → `tel:` · message → `sms:` · request check-in → SMS مع نص جاهز |
| **Pro/Free gating** | Invite codes: مجاني · Live location tracking: Pro فقط |
| **المشاكل** | (أُصلحت) الأزرار الخمسة الميتة — الآن كلها مربوطة |
| **التعديل** | 1. Member card → tap يفتح detail sheet 2. Long-press يفتح **ContactEditSheet** (الجديد) 3. إضافة status dot واضح داخل الأفاتار 4. "Check on Everyone" → يرسل SMS لكل member بنص check-in |

### 4.4 Map Screen — الخريطة

| الحقل | التفاصيل |
|---|---|
| **الغرض** | عرض موقع المستخدم + خدمات طوارئ قريبة + توجيه |
| **الدخول من** | Tab bar (Map) · Home quick action "Live Location" |
| **الخروج إلى** | Place detail card (in-place) · Directions (geo: intent) · Call (tel:) · Back → Home tab |
| **البيانات** | GPS position (live) · Nearby places (Supabase or OSM) |
| **الأحداث** | GPS lock/loss · tap place · directions click |
| **Pro/Free gating** | Offline map caching: Pro فقط · Radius filter: Pro فقط |
| **المشاكل** | (أُصلحت) backdrop-filter على chips · Directions button |
| **التعديل** | 1. Category chips تحت top bar 2. GPS center button (FAB) 3. Distance في meters/km حسب المسافة 4. Place card → directions + call + save as favorite |

### 4.5 Profile — الملف الشخصي

| الحقل | التفاصيل |
|---|---|
| **الغرض** | بوابة كل إعدادات التطبيق + الاشتراك + تسجيل الخروج |
| **الدخول من** | Tab bar (Profile) |
| **الخروج إلى** | 11 شاشة فرعية (انظر Navigation Graph) |
| **البيانات** | `profile` + `subscription` + `contacts.length` + `companyName` (لموظفين) |
| **الأحداث** | tap avatar → `<AvatarEditSheet />` (**جديد**) · tap section → navigate |
| **Pro/Free gating** | Badges "PRO" على إيميلات القفل (Elite Features, Incident History extras) |
| **المشاكل** | (أُصلحت) Terms action missing |
| **التعديل** | 1. Avatar جديد قابل للتعديل من هنا 2. Pro badge ظاهر بوضوح بجانب الاسم 3. عداد الـcontacts يعكس الحد 4. زر "Upgrade" بارز إذا Free |

### 4.6 Medical ID — البطاقة الطبية

| الحقل | التفاصيل |
|---|---|
| **الغرض** | بيانات طبية يراها المسعف من باب القفل (QR) أو في SOS packet |
| **الدخول من** | Profile → Medical ID · Home quick action "Medical" |
| **الخروج إلى** | QR modal · Share · Back → Profile |
| **البيانات** | `sosphere_medical_id` عبر `useMedical()` |
| **الأحداث** | Edit toggle · Save (يتحقق من bloodType + phone) · QR → Pro upsell للـfree · Share → navigator.share |
| **Pro/Free gating** | QR code: Pro فقط (upsell toast للـfree) |
| **المشاكل** | (أُصلحت) fake default data · validation ضعيف |
| **التعديل** | 1. Blood type validation (A/B/AB/O × +/-) 2. E.164 validation للـmedical contact phone 3. Organ donor toggle واضح 4. QR يحوي فقط blood + allergies + 1 contact (لا notes — خصوصية) |

### 4.7 Emergency Packet — حزمة الطوارئ

| الحقل | التفاصيل |
|---|---|
| **الغرض** | معاينة ما يُرسل تلقائياً مع SOS (medical + contacts + last location) |
| **الدخول من** | Profile → Emergency Packet |
| **الخروج إلى** | Preview sheet · Share sheet · Back |
| **البيانات** | يجمع: `medical` + `contacts.favorites(3)` + `last GPS` + `profile.name` |
| **الأحداث** | Share SMS/Email/WhatsApp (أُصلحت، الآن تعمل) · Copy link |
| **Pro/Free gating** | Full packet: Pro · Free يرى medical + 1 contact فقط |
| **التعديل** | 1. معاينة 1:1 لما يراه المستلم 2. زر "Test send to myself" |

### 4.8 Emergency Services — أرقام الطوارئ

| الحقل | التفاصيل |
|---|---|
| **الغرض** | أرقام طوارئ رسمية حسب البلد (لا تعتمد على الـcontacts) |
| **الدخول من** | Profile → Emergency Services |
| **الخروج إلى** | Country picker sheet · Dial via tel: |
| **البيانات** | countries hardcoded (SA, IQ, US, UAE, GB, EG, JO, KW, QA) + localStorage favorites |
| **الأحداث** | tap number → tel: intent |
| **Pro/Free gating** | مجاني 100% — خدمة عامة |
| **التعديل** | 1. تلقائي استخدام GPS لتحديد البلد الافتراضي 2. قسم "Favorites" على القمة 3. عرض رقم الطوارئ الموحد (112) قبل البلد المحدد |

### 4.9 Incident History — سجل الحوادث

| الحقل | التفاصيل |
|---|---|
| **الغرض** | أرشيف كل SOS / Check-in trigger / DMS auto مع تفاصيل |
| **الدخول من** | Profile → Incident History |
| **الخروج إلى** | Expanded card (in-place) · Delete confirm · Back |
| **البيانات** | `sosphere_incident_history` + 5 mock (يُخفى في Production) |
| **الأحداث** | Expand → timeline · Share → navigator.share · Export PDF → text download (Pro) |
| **Pro/Free gating** | Free: آخر 7 أيام · Pro: غير محدود |
| **المشاكل** | (أُصلحت) hardcoded date · dead Share/Export buttons · layout overlap |
| **التعديل** | 1. Filter by type (SOS / DMS / Check-in) 2. Search by date 3. Delete swipe animation واضح |

### 4.10 Notifications — مركز الإشعارات

| الحقل | التفاصيل |
|---|---|
| **الغرض** | كل التنبيهات (broadcasts + SOS + check-in + system) |
| **الدخول من** | Home bell icon |
| **الخروج إلى** | Filter sheet · Clear all · Back |
| **البيانات** | `sosphere_notifications` + broadcast store (للموظفين) |
| **الأحداث** | Mark read · Delete · Clear all |
| **المشاكل** | Grouping يعتمد على string matching (`includes("d ago")`) بدل رقم — خطأ |
| **التعديل** | 1. حفظ `timestamp: number` على كل notification 2. Grouping: Today / Yesterday / This Week / Earlier بالـdiff الحقيقي 3. Badges للـurgent tags |

### 4.11 Safe Walk Mode — المشي الآمن

| الحقل | التفاصيل |
|---|---|
| **الغرض** | موقع مباشر يراه guardian أثناء المشي، تصعيد تلقائي عند الوقوف |
| **الدخول من** | Home quick action "Safe Walk" |
| **الخروج إلى** | Active walk state · Back |
| **البيانات** | contacts favorites = guardian candidates · GPS live · destination |
| **الأحداث** | Phase transitions (setup → active → arrived/escalated) · Stop detection (>120s) · Auto-SOS |
| **Pro/Free gating** | Free: guardian واحد، مدة أقصى 30د · Pro: متعدد، غير محدود |
| **المشاكل** | (أُصلحت) زر رجوع كان يفتح panel غير موجود · random simulator |
| **التعديل** | 1. Guardian picker يستخدم `useContacts().favorites` 2. Destination من Map screen (auto-link) 3. Distance hidden until GPS haversine يُبنى (لا fake) |

### 4.12 Check-in Timer — المؤقت

| الحقل | التفاصيل |
|---|---|
| **الغرض** | Dead Man's Switch — إذا لم أضغط "I'm safe" خلال X دقيقة، يُفعّل SOS |
| **الدخول من** | Home quick action "Check-in" · Timer badge في nav (إذا نشط) |
| **الخروج إلى** | Active timer state · Back |
| **البيانات** | `sosphere_checkin_deadline` + `sosphere_checkin_total` |
| **الأحداث** | Tick every 1s · Warning at 5m remaining · Trigger SOS at 0 |
| **Pro/Free gating** | Free: مدة أقصى 2 ساعة · Pro: 8 ساعات |
| **المشاكل** | (أُصلحت) زر "Cancel" كان يلغي المؤقت بدل التحذير |
| **التعديل** | 1. Wheel picker واضح 2. Warning modal يوضّح "Extend vs Dismiss" 3. إشعار push كل 5د قبل النهاية (إذا FCM مفعّل) |

### 4.13 Settings sub-screens — الإعدادات الفرعية

| Screen | الغرض | البيانات | Gating |
|---|---|---|---|
| Language | تبديل ar/en (بقية اللغات قادمة) | `sosphere_language` | مجاني |
| Privacy | 3 toggles: location history, analytics, show profile | `sosphere_privacy_*` | مجاني |
| Connected Devices | يعرض UA للجهاز الحالي | navigator.userAgent | مجاني |
| Help | FAQ + Email support | hardcoded | مجاني |
| Elite Features | عرض/upsell لميزات Elite | subscription | Elite فقط |

### 4.14 Subscription — الاشتراك

| الحقل | التفاصيل |
|---|---|
| **الغرض** | عرض الخطة الحالية + الترقية |
| **الدخول من** | Profile → Subscription · Pro gates في كل الشاشات (toast "Upgrade") |
| **البيانات** | `sosphere_subscription` + plan features list |
| **الأحداث** | Upgrade → يفتح صفحة الدفع (خارج التطبيق حالياً) |
| **Gating** | شاشة نفسها مجانية، لكن الأزرار تختلف حسب الخطة |
| **التعديل** | 1. عرض مقارنة واضحة Free vs Pro vs Elite 2. "Current plan" badge 3. "Restore purchases" زر |

---

## الجزء 5 — التعديل المرن العابر للشاشات · Cross-Screen Flexibility

هذا الجزء الجوهري من طلبك.

### المشكلة الحالية
إذا أردت تعديل Omar Johnson (كونتاكت):
- في Family Circle → ليس هناك زر تعديل أصلاً
- في Home quick contacts → ليس هناك زر تعديل
- فقط في Safety Contacts → يوجد (مع الكارد الجديد)

نتيجة: المستخدم يجب أن يذهب لشاشة منفصلة كل مرة — بطيء وغير منطقي.

### الحل المقترح

**1. Shared primitives** (نبنيها مرة واحدة):

```
src/app/components/shared-edits/
  ├── ContactEditSheet.tsx     ← يُفتح من أي مكان، يكتب للـuseContacts()
  ├── AvatarEditSheet.tsx      ← camera / gallery / initials / remove
  ├── MedicalQuickEditSheet.tsx ← blood + allergies سريع
  └── shared-sheet-base.tsx    ← نفس الـbottom-sheet animation في كل الشاشات
```

**2. أنماط التحرير السياقي:**

| حركة المستخدم | المكان | الإجراء |
|---|---|---|
| Long-press على ContactCard | Family Circle / Home / Contacts list | يفتح `<ContactEditSheet contact={c} />` |
| Tap على ⋯ في ContactCard | كل مكان | يفتح menu → "Edit" → نفس الـsheet |
| Tap على Avatar في Home header | Home | يفتح `<AvatarEditSheet />` |
| Tap على Avatar في Profile | Profile | يفتح نفس الـsheet |
| Tap على Avatar في Family Circle (self) | Family Circle | يفتح نفس الـsheet |
| Swipe-left على Notification | Notifications | Delete inline |
| Swipe-right على Contact في قائمة | Contacts list | Favorite toggle |

**3. ضمان التحديث الفوري:**

عند حفظ تغيير في `<ContactEditSheet>`، نستخدم `useSyncExternalStore` في `civilian-store.ts` → كل الشاشات التي تستخدم `useContacts()` تُعاد render مع البيانات الجديدة.

---

## الجزء 6 — قائمة الإطلاق · Launch Checklist

### قبل الإطلاق (هذه الخطة)
- [ ] موافقتك على هذه الوثيقة (لا أبدأ قبلها)
- [ ] بناء `civilian-store.ts` + hooks
- [ ] بناء `ContactEditSheet` + `AvatarEditSheet`
- [ ] ربط كل شاشة بالـstore (دفعة 1)
- [ ] ربط كل شاشة بالـstore (دفعة 2)
- [ ] ربط كل شاشة بالـstore (دفعة 3)
- [ ] ربط كل شاشة بالـstore (دفعة 4)
- [ ] اختبار كل تدفق (QA list أدناه)
- [ ] بناء APK release signed
- [ ] Vercel deploy preview
- [ ] Supabase migrations مطبّقة

### QA list (يجب أن يمر كل شيء)
- [ ] Login → Home: لا حقول مملوءة مسبقاً بأسماء وهمية
- [ ] إضافة contact → تظهر في Family Circle فوراً بدون reload
- [ ] تعديل avatar في Home → يظهر في Profile و Family فوراً
- [ ] SOS hold 3s → يطلق فعلاً بعد 3 ثواني
- [ ] SOS → يرسل تنبيه لكل favorite contact
- [ ] Check-in timer → يعمل في الخلفية بعد قفل الشاشة
- [ ] Emergency services → tel: يفتح dialer
- [ ] Map Directions → يفتح Google Maps
- [ ] Medical ID QR → Pro فقط، free يرى upsell واضح
- [ ] Notifications → mark read + clear all يستمر بعد reload
- [ ] Back button في كل شاشة → يعود لسابقة، ليس Home
- [ ] Language switch ar ⇄ en → يعمل فوراً، لا reload
- [ ] Logout → يمسح كل مفاتيح `sosphere_*` من localStorage
- [ ] Offline mode → SOS يعمل ويُصطف للإرسال لاحقاً
- [ ] Safe area: لا شخوط في أي شاشة
- [ ] Pro/Free gating: لا toast كاذب

### المهام المؤجلة (لا تعطّل الإطلاق)
- ربط sosphere.co DNS بـVercel
- Twilio credentials على Supabase
- Firebase Push Notifications (google-services.json)
- نقل كل `localStorage` إلى Supabase (تدريجياً بعد الإطلاق)

---

## الجزء 7 — الخطوات التالية · Next Steps

### أحتاج منك قرارات محددة:

**1. هل توافق على التصميم العام؟**
- إذا نعم → أبدأ في بناء الـstore
- إذا لا → أي أجزاء تريد تغييرها؟

**2. أي شاشات عندك أولوية قصوى لإعادة تصميمها بصرياً (غير الإصلاحات التي تمت)؟**
- Home (يحتاج ترتيب جديد؟)
- Profile (يحتاج tiles بدل list؟)
- Subscription (يحتاج مقارنة أوضح؟)
- أخرى؟

**3. موضوع الـavatar:**
- هل تريد uploading من camera + gallery؟
- أم initials فقط (حرفان من الاسم) = أبسط وأسرع؟
- أم الاثنين كخيارات؟

**4. Ghost contact — الشخص الذي يستلم SOS بدون تطبيق:**
- حالياً: يستلم SMS برابط يفتح في المتصفح
- هل الرابط يجب أن يحوي GPS live؟ أو صورة ثابتة؟ أو خريطة؟

**5. ترتيب تطبيق الدفعات:**
- الدفعة 1 (Home + Family + Contacts) — الأهم، مترابط
- الدفعة 2 (Map + Medical + Profile)
- الدفعة 3 (Emergency Services/Packet + Incident + Notifications)
- الدفعة 4 (Safe Walk + Check-in + Settings)

هل هذا الترتيب جيد؟

---

> **ملاحظة مهمة:** لن ألمس أي سطر كود حتى تقرأ هذه الوثيقة وتعطيني رداً واضحاً على الأسئلة أعلاه. إذا أردت تعديلاً على الوثيقة نفسها، قلي أي جزء وسأعدّله.
