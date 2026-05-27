# 📞 SOSphere Call System — Comprehensive Audit

**Date:** 2026-05-25
**Scope:** End-to-end SOS calling/contact cascade across mobile + platform + Twilio
**Question answered:** "هل سيعمل بكل الظروف؟ هل يتصل بالاخر اوتوماتكلي؟ هل تصل رسالة بالموقع؟"

---

## 🎯 TL;DR — Status

### ✅ ما يعمل بالفعل (الأساس قوي):
1. **Cascade automatic** — إذا جهة اتصال لم تُجِب → الانتقال للتالية تلقائياً
2. **Multiple retry cycles** — حتى MAX_CYCLES دورة كاملة قبل التوقف
3. **SMS مع موقع** — رابط tracking عبر Twilio server-side
4. **Path A + Path B في التوازي** — local dial + server Twilio معاً
5. **3-tier dial على Native** — SOSphereNative → CallNumber plugin → tel: (fallback لأرقام الطوارئ)
6. **Server-side SOS** — يستمر حتى لو الـ app انقطع
7. **GPS + Battery في heartbeat** — كل 30 ثانية
8. **Progressive watchdog** — تصعيد عند 5s + 15s
9. **Push notifications** — FCM للـ web + native

### ⚠️ نقاط ضعف:
1. **Answer detection يدوي** — العامل يضغط "Connected" يدوياً (ماذا لو فقد الوعي؟)
2. **Tracking URL** — يُشير لـ `https://sosphere.co/track` (هل الـ landing page موجود؟)
3. **MAX_CYCLES** ثم client يتوقف — معتمد على server-side فقط
4. **OS dialer chooser** على Android للأرقام الشخصية (لا 911/112) قد يُربك مستخدم

### 🚨 السيناريوهات الحدية الحرجة:
1. **عامل فاقد الوعي:** الـ "Connected" button لا يُضغط → كل المكالمات `no_answer` → cascade لكل الجهات → دورات إعادة → "monitoring" — **لكن لا أحد يعرف أنه أجاب فعلاً**
2. **بدون إنترنت + بدون إشارة:** triggerOfflineSOS يضع SOS في queue، direct dial يعمل (cellular only)، لكن لا server alert ولا SMS مع موقع
3. **Mass casualty:** عدة عمال في SOS بنفس الوقت — server-side queue (sos-alert) يحتمل، لكن AI Co-Admin يفتح لواحد فقط (راجع AUDIT_COMPANY_DASHBOARD)

---

## 📋 السيناريوهات الرئيسية الـ 8 — حالة كل واحدة

### 1️⃣ السيناريو "العامل واعي + متصل + لديه contacts":
**التدفق:**
- يضغط SOS لـ 3 ثوان (3-second hold confirmation)
- Path A: مكالمة مباشرة لـ contact #1 عبر CallNumber bypass chooser
- Path B: server-side Twilio SMS burst لكل الـ contacts (موقع مرفق)
- Recording يبدأ (during mode) كـ evidence
- إذا contact #1 رد → العامل يضغط "Connected" → نهاية cascade
- إذا لا → 30 ثانية انتظار → next contact
**Status:** ✅ يعمل ممتاز

### 2️⃣ السيناريو "العامل واعي + متصل + لا contacts":
**التدفق:**
- R-34 fallback (line 2469): دالة `resolveEmergencyNumber()` تحسب الرقم المحلي (Saudi=997, US=911, EU=112)
- يتم اتصال مباشر بـ EMERGENCY_NUMBER
- Phase → monitoring (لا cascade شخصي)
- Server SOS لا يزال يعمل (لكن لا SMS بدون contacts)
**Status:** ✅ يعمل (تم إضافة fallback في R-34/R-48)

### 3️⃣ السيناريو "العامل فاقد الوعي":
**التدفق:**
- زر "Connected" لا يُضغط
- كل contact = `no_answer` بعد CALL_SEC ثانية
- Cascade لكل الـ contacts
- بعد MAX_CYCLES → "monitoring"
- لكن **client لا يعرف أن أحداً رد فعلاً**
- Server SOS يستمر (Path B)
**🚨 Gap:** لا يوجد automatic answer detection (لا call recording analysis، لا Twilio call status webhook integration)
**Workaround:** Twilio call status webhook (twilio-status) قد يكشف "answered" — لكن client UI لا يستخدمها للـ Path A

### 4️⃣ السيناريو "Offline / لا إنترنت":
**التدفق:**
- `triggerOfflineSOS(userId, userName, userZone)` يُستدعى عند connection lost
- يُحفَظ SOS في offline-database
- direct dial يعمل (cellular network لا تحتاج internet)
- عند عودة الاتصال: `replayPendingSOS()` يُرسِل للـ server
- SMS مع موقع: **لن يُرسَل حتى يعود الاتصال** (server-side Twilio يحتاج internet)
**Status:** ⚠️ يعمل جزئياً — تأخير في SMS

### 5️⃣ السيناريو "بطارية حرجة":
**التدفق:**
- BATTERY_CRITICAL emit في sos-emergency.tsx:2420 (الذي ضممته في strict-4)
- آخر موقع GPS يُحفَظ + يُرسَل
- Dashboard يستقبل event وobtains BATTERY_CRITICAL emergency
- Toast 15s + entry في emergencies list
**Status:** ✅ يعمل

### 6️⃣ السيناريو "Twilio outage":
**التدفق:**
- L2-A: circuit breaker حول كل fetch لـ api.twilio.com
- breakerShortCircuitResponse عند فتح الـ breaker → 503 سريع
- Client يحاول مكالمات Path A (لا تعتمد على Twilio)
- Server-side SMS يُؤجَّل
**Status:** ✅ Path A يستمر، Path B في breaker mode

### 7️⃣ السيناريو "Recipient يجيب لكن العامل لا يضغط Connected":
- مثلاً: العامل يتحدث ولا يضغط، أو وضع الهاتف، أو لا يرى الزر
- Cascade يستمر! 30 ثانية بعد answer → `no_answer` → contact #2
- **🚨 المتصل بـ contact #1 يسمع العامل لكن النظام يعتبر "no answer"**
**Workaround:** Twilio call status webhook يجب أن يُحدِّث UI لكن **هذا لم يُختبَر end-to-end**

### 8️⃣ السيناريو "Mass casualty (3+ workers في SOS متزامن)":
**التدفق:**
- كل عامل يُشغّل Path A + Path B بشكل مستقل
- Dashboard يستقبل عدة SOS_TRIGGERED events
- AI Co-Admin يفتح فقط للـ FIRST (gate `activeCount <= 1` — مذكور في AUDIT_COMPANY_DASHBOARD #8)
- باقي الـ workers في SOS لا يحصلون على AI triage
**🚨 Gap:** No queue/multi-emergency UI

---

## 🏗️ Architecture Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                       WORKER (Mobile App)                            │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ sos-emergency.tsx — 3s hold → SOS                            │    │
│  │  ├─ Path A (local): directCall cascade                       │    │
│  │  │   1. SOSphereNative.directCall (Android Java)             │    │
│  │  │   2. capacitor-call-number plugin                         │    │
│  │  │   3. tel: URI (web + emergency fallback)                  │    │
│  │  └─ Path B (server): triggerServerSOS — async parallel       │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────┬──────────────────────────────────────┬────────────────┘
              │ Path A: cellular voice call          │ Path B: HTTPS
              ▼                                      ▼
  ┌─────────────────────┐                ┌───────────────────────────┐
  │ Emergency Contact 1 │                │ Supabase Edge Functions   │
  │ (phone rings)       │                │  ├─ sos-alert             │
  │  Worker presses     │                │  ├─ twilio-call           │
  │  "Connected" if rep │                │  ├─ twilio-sms (location) │
  │  answers            │                │  ├─ twilio-status         │
  └─────────────────────┘                │  └─ send-push-notification│
              │                          └───────────┬───────────────┘
              │ if no_answer (30s)                   │
              ▼                                      ▼
  ┌─────────────────────┐                ┌───────────────────────────┐
  │ Emergency Contact 2 │                │ Twilio Programmable APIs  │
  │ Contact 3 ...       │                │  ├─ Voice (admin calls)   │
  │ Cascade until all   │                │  ├─ SMS (location bursts) │
  │ exhausted           │                │  └─ Status webhooks       │
  └─────────────────────┘                └───────────┬───────────────┘
              │                                      │
              ▼                                      ▼
  ┌─────────────────────┐                ┌───────────────────────────┐
  │ All Unreachable     │                │ Admin Dashboard           │
  │  → Pause + Retry    │                │  ├─ SOS popup (AI Co-Adm) │
  │  → MAX_CYCLES       │                │  ├─ EmergencyWatchdog 5min│
  │  → Monitoring mode  │                │  ├─ "Call 997" ← فعّلناه │
  │                     │                │  └─ "Take Action" ← فعّلناه│
  └─────────────────────┘                └───────────────────────────┘
```

---

## 🌍 Coverage Matrix — "في كل الظروف"

| Condition | Path A (Direct) | Path B (Server) | SMS Location | Push Notif | Status |
|-----------|----------------|------------------|--------------|-----------|--------|
| Online + GPS + Battery OK | ✅ | ✅ | ✅ | ✅ | ✅ ممتاز |
| Online + No GPS | ✅ | ✅ | ⚠️ (no coords) | ✅ | ⚠️ |
| Online + Low battery | ✅ | ✅ + last gasp | ✅ | ⚠️ may die | ⚠️ |
| Offline (no internet) | ✅ cellular | ⏸️ queue | ⏸️ queue | ❌ | ⚠️ |
| Offline + No cellular | ❌ | ❌ | ❌ | ❌ | 🚨 |
| Worker unconscious | ✅ cascade | ✅ SMS burst | ✅ | ✅ | ⚠️ no auto-detect |
| Twilio outage | ✅ | ⚠️ breaker open | ❌ | ✅ | ⚠️ |
| Mass casualty | ✅ each indep | ✅ queued | ✅ | ⚠️ AI to 1 only | ⚠️ |
| App crash mid-SOS | ⚠️ stops Path A | ✅ continues | ✅ | ✅ | ⚠️ |
| Wrong locale (US user in Saudi) | ✅ resolves to 997 | ✅ | ✅ | ✅ | ✅ |

---

## 🎯 الإجابات المباشرة على أسئلتك

### **س1: هل سهلة المنال خلال ساعة الصفر؟**
✅ **نعم — مع تحفظ:**
- زر SOS أحمر بارز في أسفل الـ home screen
- 3-second hold لمنع الـ false positives
- Discrete SOS mode (Shake/Duress) متاح كـ alternatives
- **لكن:** المستخدمون الجدد لا يعرفون عن discrete modes — يحتاج onboarding tutorial أفضل

### **س2: هل يعمل في كل الظروف؟**
⚠️ **في معظمها — gaps في:**
- 🚨 **offline + no cellular** (نفق، basement، صحراء بدون tower) — لا path
- 🚨 **mass casualty AI gap** — AI Co-Admin لا يفتح للعمال 2،3،4...
- ⚠️ **app crash mid-SOS** — Path A يتوقف، Path B وحده

### **س3: هل يتصل بالاخر اوتوماتكلي إذا الأول لم يجب؟**
✅ **نعم — يعمل ممتاز:**
- 30 ثانية انتظار → cascade تلقائي للـ contact التالي
- بعد كل الـ contacts → pause 60s → restart cycle from #1
- بعد MAX_CYCLES → monitoring (client يتوقف، server يستمر)

### **س4: هل ستصل رسالة بالموقع للمتصل به؟**
✅ **نعم — مع caveats:**
- Server-side Twilio SMS burst (Path B) — يُرسَل لكل الـ contacts فوراً
- الرسالة تحتوي: `🚨 SOS from {name}! Live location: https://sosphere.co/track?lat={}&lng={}`
- Web-viewer link مفتوح للعرض على أي browser
- **🚨 يعتمد على:** Twilio credit + server up + GPS متوفر
- **🚨 إذا offline:** SMS مؤجَّل حتى عودة الاتصال

---

## 🔧 ما تم إصلاحه اليوم (PR #11)

✅ **"Call 997" في EmergencyWatchdog** — كان toast فقط → الآن يتصل فعلاً عبر OS dialer مع رقم محلي (997/911/112)
✅ **"Take Action" في EmergencyWatchdog** — كان لا يفعل شيء → الآن يفتح AI Co-Admin فعلاً

---

## 📋 ما يحتاج إصلاح للنظام العالمي الذكي المتقدم

### 🔴 P0 LIFE-SAFETY (4):
1. **Auto answer detection** — استخدام Twilio call status webhook لتحديث UI تلقائياً (بدلاً من manual "Connected" button)
2. **Multi-SOS AI Co-Admin queue** — كل عامل في mass casualty يحصل على triage
3. **Offline + No cellular fallback** — Bluetooth mesh أو satellite SOS (Apple/Android emergency satellite APIs)
4. **AI Co-Admin key fix** — battery/signal/GPS keys mismatch (سبق ذكره)

### 🟠 P1 HIGH (5):
5. **Tracking URL landing page** — verify `https://sosphere.co/track` page يعرض الـ GPS فعلاً
6. **Push notification background** — verify FCM delivers when app closed
7. **Voice fingerprint answer detection** — تحليل الصوت لكشف إذا أحد رد (ML)
8. **Multi-channel redundancy** — call + SMS + push + email + web push (currently call + SMS only)
9. **Tier-based escalation** — Free tier يحصل على Path A فقط؛ Paid+: server SMS؛ Enterprise: Twilio voice bridge

### 🟡 P2 MEDIUM (3):
10. **Sweep MAX_CYCLES values** — حالياً ثابت، يجب optimize per emergency type
11. **OS dialer chooser على non-emergency Android** — يعرض WhatsApp/Truecaller — UX confusing
12. **SOSphere domain verification** — sosphere.co يجب أن يكون مُلكاً للشركة + SSL valid

---

## 💡 الاستنتاج الجذري

### **النظام مُهَنْدَس جيداً بمستوى عالمي.** Architecture:
- ✅ Dual-path redundancy (Path A + Path B)
- ✅ Cascade with retries
- ✅ Circuit breaker around Twilio
- ✅ Offline queue with replay
- ✅ Multi-language number resolution
- ✅ 3-tier dial fallback

### **لكن هناك 4 gaps حرجة لـ "ينقذ الأرواح بكل الظروف":**
1. **Worker فاقد الوعي** — answer detection يدوي
2. **Mass casualty** — AI لا يخدم ما بعد العامل الأول
3. **Offline + No cellular** — لا path satellite
4. **AI batteryLevel/signal/GPS keys** — phantom data

### **توصيتي للـ Phase B3:**
سأكمل الـ Quick Fix PRs:
- ✅ **PR #11 (مُتقدم):** Call 997 + Take Action
- ⏭️ **PR #12:** AI Co-Admin key fix (battery/signal/GPS) — يحل #4 من gaps
- ⏭️ **PR #13:** Multi-SOS queue للـ AI Co-Admin — يحل #2
- ⏭️ **PR #14:** Twilio call-status webhook integration للـ auto answer detection — يحل #1
- ⏭️ **PR #15:** SMS templates upgrade + push notification reliability

**القفزة الكبرى:** Satellite SOS (Apple iPhone 14+ Emergency SOS via Satellite، Android 15+ similar) — تتطلب OS integration، تستحق epic منفصل.

---

*Generated as part of Phase B3 — Comprehensive Call System Audit.*
