# SOSphere — خطة الغد (28 أبريل 2026)
**صباح الخير** 👋 هذه الخطة جاهزة للتنفيذ بأقصى دقة وأقل مخاطر.

---

## 🌅 الترتيب الأمثل للجلسة

```
[1] 5 دقائق   ─── status check (هل الإصلاحات الحالية على الإنتاج؟)
[2] 30 دقيقة  ─── verification runbook (إن لم تشغّليه أمس)
[3] 2-3 ساعات ─── BLOCKER #11 (Stripe cancel)
[4] 3-4 ساعات ─── BLOCKER #12 (trial exploit)
[5] 2-3 ساعات ─── BLOCKER #16 (retention cron)
[6] 30 دقيقة  ─── batch commit + push + deploy + verify
─────────────────────
المجموع: 8-11 ساعة
```

---

## 📋 [1] Status Check (نُقطة البدء)

### قبل أي شيء، شغّلي:

```powershell
cd C:\Users\user\Downloads\sosphere-platform

# 1. حالة git — يجب 0 modified files
git status

# 2. آخر commit
git log --oneline -5

# 3. آخر deploy على Vercel
vercel ls --scope fadihadi06-a11ys-projects | Select -First 3

# 4. tests pass؟
npm test
```

**النتيجة المتوقعة**:
- `git status`: clean working tree (كل شيء منشور)
- آخر commits: تشمل CRIT-#1, #2, #3, #4, #5, #6, #7, #8, #9 (regression guard), #10 (regression guard), tsconfig cleanup, #13, #22
- Vercel: آخر deploy `● Ready Production`
- npm test: **225 passed** (211 + 14 جديدة من الجلسة الماضية)

**إذا أي شيء غير متوقع**: راسليني فوراً قبل بدء العمل الجديد.

---

## 📋 [2] Verification Runbook

افتحي `VERIFICATION_RUNBOOK.md` ومشي خطوة بخطوة. **تأكدي من القسم 0.4 (audit_log FORCE RLS)** — هذا الـ migration قد لا يكون مطبَّقاً.

---

## 🔧 [3] BLOCKER #11 — Stripe cancel on delete-account

### الفحص المسبق:
- ✅ Real blocker (delete-account لا يستدعي Stripe API)
- ✅ Schema جاهز (`subscriptions.stripe_subscription_id` موجود)
- ✅ env vars جاهزة (`STRIPE_SECRET_KEY` مستخدم بالفعل في stripe-checkout)
- ✅ ~40 سطر تغيير + tests

### الترتيب المُحكم:
1. تعديل `supabase/functions/delete-account/index.ts`:
   - قبل سطر 95 (`admin.rpc("delete_user_completely")`)
   - أضيفي: lookup `subscriptions.stripe_subscription_id`
   - إن وُجد: `POST https://api.stripe.com/v1/subscriptions/{sid}` بـ `status=canceled`
   - **FAIL DELETION** إن فشل Stripe (لا تُكمل DB delete — GDPR risk)
2. أضيفي audit_log entry بعد نجاح Stripe cancel
3. اكتبي test: `delete-account-stripe-cancel.test.ts` (mock fetch, verify ordering)
4. Deploy: `supabase functions deploy delete-account`

### تحذيرات:
- لا تطلقي 200 OK لو Stripe فشل — اعطي 503 (User Retry Safe لأن Stripe API idempotent)
- مستخدم Free (no subscription) → no-op آمن (`stripe_subscription_id IS NULL`)
- audit_log entry يحفظ subscription_id ووقت الإلغاء

---

## 🔧 [4] BLOCKER #12 — Trial restart exploit

### الفحص المسبق:
- ✅ Real blocker (trial state في localStorage فقط)
- ✅ يحتاج migration جديد + RPC SECURITY DEFINER
- ✅ ~225 سطر إجمالاً (migration 70 + frontend 55 + tests 100)

### الترتيب المُحكم:
1. **Migration**: `20260428_civilian_trial_history.sql`:
   - CREATE TABLE `civilian_trial_history (user_id PK, trial_plan, started_at, used, expires_at, ...)`
   - CREATE FUNCTION `start_civilian_trial(p_plan text)` SECURITY DEFINER:
     - يفحص history → إن وُجد → `{success: false, reason: "trial_already_used"}`
     - إن جديد → INSERT + `{success: true, ...}`
   - REVOKE من PUBLIC + GRANT EXECUTE لـ authenticated
2. **Frontend**:
   - `trial-service.ts`: أضيفي `startTrialAsync()` async — تستدعي RPC، تكتب localStorage فقط لو RPC نجح
   - `trial-card.tsx`: استبدلي `startTrial()` → `await startTrialAsync()`
3. **Tests**: 5 سيناريوهات (first time, second time same device, localStorage wipe, network error, expired trial)

### تحذيرات:
- **FAIL CLOSED على network error** — لا تمنحي trial بدون server check
- احتفظي بـ `startTrial()` القديم للـ backward compat (للـ offline path) لكن مع warning comment
- expires_at + 7 days لكن RPC تمنع restart حتى بعد expiration (one-shot per lifetime)

---

## 🔧 [5] BLOCKER #16 — Data retention cron

### الفحص المسبق:
- ✅ Real blocker (لا cron jobs، Privacy promises 90/30 يوم غير منفَّذة)
- ✅ pg_cron NOT enabled — يحتاج migration
- ✅ ~300 سطر (functions + cron schedules + tests)
- ⚠️ **pg_cron قد لا يكون متاحاً على Supabase Free plan** — تحققي قبل التطبيق

### الترتيب المُحكم:
1. **Migration A**: `20260428_pg_cron_enable.sql`:
   - `CREATE EXTENSION IF NOT EXISTS pg_cron;`
2. **Migration B**: `20260428_data_retention_cleanup.sql`:
   - 6 SECURITY DEFINER functions: `cleanup_sos_sessions`, `cleanup_sos_queue`, `cleanup_gps_trail`, `cleanup_evidence_vaults`, `cleanup_processed_stripe_events`, `cleanup_idempotency_cache`
   - 6 cron schedules (يومياً 2:00-2:25 AM UTC، كل function في minute مختلف لتجنب القفل)
   - **DO NOT add audit_log cleanup** (compliance: indefinite retention مطلوب لـ ISO 27001 / SOC 2)

### الجداول والمدد:
| جدول | المدة | شرط الحذف |
|---|---|---|
| sos_sessions | 90 يوم | status IN ('ended','resolved','cancelled','timeout') |
| sos_queue | 90 يوم | status IN ('resolved','cancelled') |
| gps_trail | 30 يوم | (لا شرط — كل GPS قديم يُحذف) |
| evidence_vaults | 90 يوم | locked_at IS NOT NULL (احفظي vaults النشطة) |
| processed_stripe_events | 30 يوم | (Stripe replay window 5 دقائق فقط) |
| idempotency_cache | الفور | expires_at < now() |
| **audit_log** | **لا حذف** | **compliance: indefinite** |

### تحذيرات:
- `pg_cron` على Free Supabase **غير متاح** — تحققي بـ `SELECT * FROM pg_extension WHERE extname='pg_cron';`
- إن غير متاح: ارفعي إلى Pro plan (~$25/شهر) أو ابني edge function + GitHub Actions cron (بديل)
- تجنبي حذف audit_log حتى لو الـ table كبير — استخدمي archiving (move إلى cold storage) لاحقاً

---

## 📋 [6] Final Batch Commit + Deploy + Verify

```powershell
cd C:\Users\user\Downloads\sosphere-platform

# Commits منفصلة (واحد لكل blocker للـ git history الواضح)
git add supabase/functions/delete-account/index.ts `
        src/app/components/__tests__/delete-account-stripe-cancel.test.ts
git commit -m "fix(CRIT-#11): cancel Stripe subscription on account deletion"

git add supabase/migrations/20260428_civilian_trial_history.sql `
        src/app/components/trial-service.ts `
        src/app/components/trial-card.tsx `
        src/app/components/__tests__/civilian-trial-server.test.ts
git commit -m "fix(CRIT-#12): server-side anti-replay check for civilian trial"

git add supabase/migrations/20260428_pg_cron_enable.sql `
        supabase/migrations/20260428_data_retention_cleanup.sql `
        src/app/components/__tests__/retention-cron-pinning.test.ts
git commit -m "fix(CRIT-#16): pg_cron retention jobs (90/30 day GDPR enforcement)"

git push

# Deploys منفصلة
supabase functions deploy delete-account

# Migrations يدوياً عبر Dashboard SQL Editor
# (نسخ-لصق محتوى الـ3 migrations)
```

### Verification بعد كل blocker:
- **#11**: حذف حساب test → تحققي في Stripe Dashboard أن subscription صار "Canceled"
- **#12**: ابدئي trial → امسحي localStorage → ابدئي مرة ثانية → يجب رفض
- **#16**: SQL: `SELECT * FROM cron.job WHERE jobname LIKE 'cleanup_%';` يجب 6 صفوف

---

## 🚦 معايير "النجاح الكامل" نهاية يوم الغد

- ✅ git status: clean
- ✅ npm test: **225 + 6 (CRIT-#11) + 5 (CRIT-#12) + 4 (CRIT-#16) = 240 passed**
- ✅ Vercel: آخر deploy ready
- ✅ supabase functions: delete-account v2 deployed
- ✅ Supabase Dashboard: 6 cron jobs scheduled
- ✅ Verification runbook: 10/10 + 3 جديدة (#11/#12/#16)

---

## ⚠️ التحذيرات الأهم لتجنب كسر الكود

1. **لا تستخدمي Edit tool على ملفات > 1000 سطر** — bidirectional sync يقطعها أحياناً. استخدمي Python heredoc بدلاً.
2. **بعد كل تعديل كبير**: شغّلي `npx tsc --noEmit` فوراً لكشف الـ truncation.
3. **بعد commit**: تحققي `git diff HEAD~1 HEAD --stat` — المتوقع insertions فقط، لا deletions كبيرة (deletions = ضرر sync).
4. **migration files**: اكتبيها عبر Python heredoc لتجنب CRLF/UTF-8 issues. Edit tool قطع SQL files من قبل.
5. **edge function deploy**: لو فشل `supabase functions deploy`، انسخي محتوى `index.ts` ولصقيه يدوياً عبر Supabase Dashboard → Edge Functions → Deploy.

---

## 📝 لوحة المستحقّات بعد الغد (16 BLOCKER + HIGH/MEDIUM)

سيتبقى بعد إنجاز #11 + #12 + #16:
- 🔴 **7 BLOCKERs**: #14 (SAR — أيام عمل)، #15 (SCC قانوني)، #17-22 (Firebase + native)
- 🟠 **24 HIGH**: لم تُلمَس بعد
- 🟡 **31 MEDIUM**: لم تُلمَس
- 🔵 **12 LOW**: 2 تم

**توصيتي**: بعد #11/#12/#16 ابدئي SAR (#14) — أهم blocker قانوني متبقٍ. الباقي يمكن تأجيله أو تفويضه لمطور دائم.

---

## 🤝 إن احتجتِ المساعدة بأي خطوة

أرسلي لي:
- نتيجة `git status` كاملة
- نتيجة `npm test` آخر سطر
- لو فشل deploy: stderr كامل
- لو SQL editor رفض migration: error من Dashboard

أنا متوفر طوال غد لإصلاح أي شيء بسرعة. ✨

**رايقي براحة الليلة. عمل ممتاز اليوم — 12/22 BLOCKER ✓ في يوم واحد.**
