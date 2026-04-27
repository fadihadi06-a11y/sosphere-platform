# SOSphere — Verification Runbook (CRIT-#1 → CRIT-#8 + #13 + #22)
**آخر تحديث**: 2026-04-27
**الهدف**: smoke test متسلسل لكل إصلاح حرج بعد الـ deploy، يستغرق ~30 دقيقة من البداية للنهاية.

---

## 🚦 قبل البدء

افتحي **متصفح incognito** على `https://sosphere.vercel.app` + اضغطي **F12** لفتح DevTools (Console + Network + Application tabs).

أرسلي screenshot لأي فشل — أنا متوفر للمساعدة في التشخيص.

---

## ✅ مرحلة 0 — تأكد من النشر

### 0.1 — Frontend (Vercel)
```powershell
cd C:\Users\user\Downloads\sosphere-platform
vercel ls --scope fadihadi06-a11ys-projects | Select -First 3
```
**يجب**: آخر deploy `● Ready Production` بتاريخ اليوم.

### 0.2 — Edge function CRIT-#7 (sos-alert)
```powershell
supabase functions deploy sos-alert
# لو فشل: افتحي Dashboard → Edge Functions → sos-alert → Deploy
```
**كيف تتحققي**: افتحي Dashboard → Edge Functions → sos-alert → Logs → آخر سطر يجب أن يحتوي `resolveCompanyOwnerUserId`.

### 0.3 — Migration CRIT-#3 (subscriptions Realtime)
```powershell
# في Supabase Dashboard → SQL Editor:
SELECT tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='subscriptions';
```
**يجب**: يُرجع صف `subscriptions`. إذا فارغ → نفّذي migration `20260427160000`.

---

## 🧪 مرحلة 1 — اختبارات الـ blockers (الأهم)

### CRIT-#1 — Logout يمسح IndexedDB
1. سجلي دخول كحساب A
2. شغّلي SOS test → أنشئي بيانات (contacts, إلخ)
3. افتحي DevTools → Application → IndexedDB → يجب رؤية `sosphere_offline`, `sosphere_emergency`
4. اضغطي logout
5. **يجب**: IndexedDB فارغة (الثلاث databases مُحذوفة)
6. ✅ pass | ❌ fail → screenshot للـ Application tab

### CRIT-#2 — emergency tel: fallback
1. افتحي Console
2. على شاشة SOS → اضغطي زر "Call 911" (أو 112)
3. **يجب** (web): يطبع `[safeTelCall] using tel: fallback (chooser may appear) — emergency dial: 911`
4. **يجب** (Android APK): فعلياً يفتح dialer (لو CallNumber plugin فشل، يُفتح chooser)
5. اختبري نفس الزر مع رقم contact شخصي → **يجب** ظهور toast `Cannot call X` (لا chooser)
6. ✅ pass | ❌ fail → console output

### CRIT-#3 — Stripe Realtime tier sync
1. سجلي دخول كمدني free
2. اضغطي "Upgrade to Elite" → ستُحوَّلي إلى Stripe
3. أكملي الدفع (test card: `4242 4242 4242 4242`)
4. ستُعادي إلى `/billing?ok=1`
5. **يجب** (خلال 5 ثوان): toast `Payment received — updating your plan…`
6. **يجب** (خلال 30 ثانية): الـ UI تعرض Elite features
7. console يجب أن يطبع `[Tier] resync (post_checkout_success) free -> pro` و/أو `[Tier] resync (realtime_postgres_changes) ...`
8. ✅ pass | ❌ fail → console + Network tab

### CRIT-#4 — Dashboard store reset on logout
1. سجلي دخول كأدمن شركة A → افتحي employees page → لاحظي قائمة الموظفين
2. logout
3. سجلي دخول كأدمن شركة B (حساب مختلف)
4. افتحي employees page **مباشرة بعد login**
5. **يجب**: لا تظهر موظفي شركة A (حتى لو ثانية واحدة)
6. ✅ pass | ❌ fail → screenshot

### CRIT-#5 — Tenant local state purge on company switch
1. سجلي دخول كأدمن شركة A
2. console: `localStorage.getItem("sosphere_attendance")` → يحتوي بيانات
3. logout → login بشركة B
4. console: `localStorage.getItem("sosphere_attendance")` → يجب أن يكون `null`
5. console: ابحثي عن log `[Realtime] tenant switch ... purged N stale local key(s)`
6. ✅ pass | ❌ fail

### CRIT-#6 — audit_log CDC tenant filter
1. سجلي دخول كأدمن شركة A → افتحي Audit Log page
2. افتحي Network tab → فلتري `realtime` أو `websocket`
3. WebSocket message: `phx_join` للـ channel `cdc:<your-company-uuid>`
4. **يجب**: subscription على `audit_log` يحتوي `filter: company_id=eq.<your-company-uuid>`
5. ✅ pass | ❌ fail → screenshot Network tab

### CRIT-#7 — tier resolution server-side (الأهم تجارياً)
**يحتاج حساب B2B شركة على tier مدفوع.**
1. سجلي دخول كموظف في شركة B2B (paying tier: starter/growth/business/enterprise)
2. شغّلي SOS test
3. افتحي Supabase Dashboard → Edge Functions → sos-alert → Logs
4. **يجب** أن تجدي سطر: `[sos-alert] tier resolved via company chain: user=... company=... owner=... tier=elite`
5. **يجب ألا** تجدي سطر: `tier=free` لموظف هذه الشركة
6. ✅ pass | ❌ fail → log output

### CRIT-#8 — civilian userId real UUID
1. سجلي دخول كمدني
2. شغّلي SOS test
3. افتحي Supabase Dashboard → Edge Functions → sos-alert → Logs
4. **يجب ألا** تجدي سطر: `[sos-alert] userId differs from JWT (using JWT): payload=EMP-... jwt=<uuid>`
5. ✅ pass | ❌ fail → log output

### CRIT-#13 — company trial = 14 days (was defaulting to 9)
1. سجلي دخول كأدمن شركة جديدة (trial)
2. افتحي Pricing page (لا تمررِ trialDays prop)
3. **يجب**: شريط الحالة يعرض "14 days remaining" (ليس 9)
4. ✅ pass | ❌ fail

### CRIT-#22 — Capacitor StatusBar + Haptics (Android APK فقط)
**على Android APK، ليس web.**
1. افتحي التطبيق
2. شغّلي SOS test → اضغطي زر SOS
3. **يجب**: تشعرين باهتزاز قوي (haptic warning)
4. **يجب**: status bar (أعلى الشاشة) يتحوّل لون SOSphere الداكن
5. ✅ pass | ❌ fail
6. **KeepAwake** (الميزة الأهم): الشاشة لا تنطفئ خلال SOS طويل (>1 دقيقة).
   - لو الشاشة انطفأت → احتاج تثبيت plugin يدوياً:
     ```powershell
     npm install @capacitor-community/keep-awake
     npx cap sync
     ```

---

## 🛠️ مرحلة 2 — لو ظهر فشل

| الحالة | ماذا تفعلين |
|---|---|
| Vercel deploy فاشل | افتحي vercel logs، انسخي الخطأ، أرسليه لي |
| Edge function logs لا تظهر | تأكدي أن `supabase functions deploy sos-alert` نجح |
| Realtime لا يعمل | تأكدي أن migration `subscriptions_realtime_publication` مطبَّقة على dashboard |
| اختبار يعطي صفحة بيضاء | افتحي console، انسخي **أول error** + **stack trace** |
| `npm test` يعطي failures | انسخي الـ FAIL block كاملاً (السطور بعد `❯`) |

---

## 🚀 مرحلة 3 — لو كل شيء ✓

سجّلي في chat: **"runbook كامل ✓ (10/10)"** وسأبدأ BLOCKER #9 فوراً.

---

## 📋 المتبقّي بعد هذا الـ runbook

| # | الوصف | يحتاج |
|---|---|---|
| 9 | Evidence vault dead code | ساعة |
| 10 | audit_log FORCE RLS | migration |
| 11 | delete-account → Stripe cancel | edge function deploy |
| 12 | Trial restart exploit | migration + RPC جديدة |
| 14 | SAR (GDPR) من الصفر | يومان عمل |
| 15 | SCC/DPA | قانوني |
| 16 | Data retention cron | migration |
| 17 | KeepAwake plugin install | npm + cap sync |
| 18-22 | Firebase config, FCM server, deep-link, إلخ | مختلطة |
