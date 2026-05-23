# PHASE 0 TESTING PHILOSOPHY — How Smart

> ملحَق لـ `PHASE_0_DOCTRINE.md`. يحدّد ما تعنيه كلمة "اختبار" في هذا المشروع من الآن فصاعداً.
> **سبب الوجود:** اكتشفنا في الموجة 9 (R-2166) أنّ ~80% من اختبارات الـ repo الحالي هي source-pinning — لا تختبر شيئاً. هذا الملف يضمن أنّ ذلك لن يتكرّر.

---

## القاعدة الذهبيّة

> **الاختبار الذي لا يفشل عند كسر السلوك = ليس اختباراً.** سواء كان source-pin، أو يحتوي assertion عديم المعنى، أو يستخدم mock يستبدل ما يُفترض اختباره — فهو ليس موجوداً في رصيد التغطية. يُحسَب صفراً.

---

## 1) سلَّم ذكاء الاختبارات (من الأضعف إلى الأقوى)

كلّ اختبار في الـ repo يصنَّف على هذا السلَّم. هدفنا أن يكون كلّ اختبار جديد على الدرجة 5 أو أعلى.

| Tier | اسم | ما يفعله | يُقبَل؟ |
|---|---|---|---|
| 0 | **Source-pin** | يقرأ ملفّ المصدر و `.toMatch` | **محظور** — يُحذف ويُستبدل |
| 1 | **Marker-comment** | يؤكّد وجود تعليق مثل `// CRIT-#12` | **محظور** — يُحذف |
| 2 | **No-op assertion** | `expect(true).toBe(true)` أو `expect(x).toBeTruthy()` على match object | **محظور** |
| 3 | **Example-based** | يستدعي الدالّة بمثال واحد ويؤكّد المخرَج | مقبول لتغطية الحدود فقط |
| 4 | **Table-driven** | يشغّل الدالّة على جدول حالات | مقبول للقواعد المعروفة |
| 5 | **Property-based (fast-check)** | يولّد آلاف المدخلات عشوائيّاً ويؤكّد لها invariant | ✅ المعيار الأدنى للدوال النقيّة |
| 6 | **Mutation-tested** | فحص الـ mutants: نغيّر `>` إلى `<`، نحذف شرطاً، ونتأكّد أنّ الاختبارات تكسر | ✅ معيار "الاختبار قويّ" |
| 7 | **Integration على infra حقيقي** | testcontainers / pglite لـ Postgres حقيقي + RLS فعليّ | ✅ معيار طبقات DB/Edge |
| 8 | **Contract + Chaos** | عقد بين خدمات + كسر الشبكة/الـ DB أثناء الطلب | ✅ معيار طبقة Production |
| 9 | **Synthetic E2E** | يحاكي مستخدماً حقيقيّاً مع Twilio test creds و Stripe test mode | ✅ معيار طبقة L6 |

---

## 2) الأدوات المعتمَدة (industry-standard، ليست homegrown)

| الغرض | الأداة | لماذا هي canonical |
|---|---|---|
| Test runner | **Vitest** | موجودة في الـ repo؛ سرعة، توافق Jest API |
| Property-based | **fast-check** | de-facto JS standard، مطبَّق في React، Lodash، Sentry |
| Mutation testing | **Stryker Mutator** (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`) | المعيار في JS لقياس قوّة الاختبارات |
| AST parsing (TS/JS) | **TypeScript Compiler API** + **@typescript-eslint/typescript-estree** | المعيار، لا regex |
| AST parsing (SQL) | **pgsql-ast-parser** | TypeScript Postgres AST parser |
| RLS testing | **pgTAP** (`@supabase/pgtap` images) | المعيار في Postgres لاختبارات الـ DB |
| Ephemeral Postgres | **testcontainers-node** أو **pglite** | المعيار للـ integration tests |
| HTTP replay / mock | **MSW** (Mock Service Worker) | المعيار لاختبارات external APIs بدون mock للـ SUT |
| Stripe testing | **stripe-mock** الرسمي + Stripe test mode | canonical |
| Twilio testing | **Twilio test credentials** الرسميّة (لا تكلِّف، لا تُرسِل فعلاً) | canonical |
| E2E browser | **Playwright** | المعيار |
| Chaos / fault injection | **toxiproxy** (للشبكة) + `vi.useFakeTimers()` للزمن | المعيار |
| Coverage | **v8 coverage** (مدمج في Vitest) | المعيار |
| SARIF reporter | **@microsoft/eslint-formatter-sarif** كنموذج | المعيار في GitHub Code Scanning |

---

## 3) عتبات قابليّة للقياس (CI Gates)

كلّ PR يجب أن يجتاز:

| Gate | العتبة | كيف يُقاس |
|---|---|---|
| Coverage (line) | ≥ 80% على الكود المُعدَّل في PR | `vitest --coverage` |
| Coverage (branch) | ≥ 90% على الكود المُعدَّل في PR | نفسه |
| Coverage (المسارات الحرجة) | **100%** على `src/api/sos-*`, `supabase/functions/sos-alert`, `supabase/functions/stripe-webhook`, `supabase/functions/twilio-*` | تعليم paths في `vitest.config.ts` |
| Mutation score | ≥ 75% على الكود المُعدَّل (≥ 85% للحرج) | Stryker nightly |
| Property tests | ≥ واحد لكلّ دالّة نقيّة جديدة | `lint-guard` rule `require-property-test` |
| No-source-pin | 0 ملفّات جديدة تُطابق نمط source-pin | `lint-guard` rule `no-source-pin` |
| Behavior assertion ratio | ≥ 1 assertion سلوكي حقيقي لكلّ `it()` | AST check على ملفّات الاختبار |
| Test isolation | كلّ test مستقلّ (لا globalThis، لا فايل-سكوب state غير معزول) | Stryker survival report يكشف التداخل |

---

## 4) قاعدة "اختبار قبل الإصلاح" (TDD-locked)

كلّ إصلاح في Phase 0 يتبع هذه الخطوات بالترتيب — والـ CI يتحقّق من الترتيب عبر تحليل commit messages:

1. **Commit 1 — `test:` يضيف اختباراً يفشل على الكود الحالي** (يُثبت أنّ العيب موجود)
   - CI يُشغِّل الاختبار → يجب أن يفشل
   - إن لم يفشل → الاختبار ليس صحيحاً
2. **Commit 2 — `fix:` يُصلِح الكود**
   - CI يُشغِّل نفس الاختبار → يجب أن ينجح
3. **Commit 3 — `guard:` يضيف الحارس** (lint rule / DB constraint / monitor)
   - CI يحاول إعادة إدخال العيب → يجب أن يرفضه الحارس
4. **Commit 4 — `chore: mutation-score`** يُثبِّت أنّ Stryker score ≥ العتبة على الكود المُعدَّل

هذا الترتيب نفسه يُعتبَر "Definition of Done" لكلّ ticket في `PHASE_0_STEP_PLAN.md`.

---

## 5) الـ Self-Testing — الاختبارات تختبر نفسها

كلّ rule في `lint-guard` تحتوي على:

- `fixtures.bad[]` — عيّنات يجب أن تُنتِج violation
- `fixtures.good[]` — عيّنات يجب ألّا تُنتِج violation
- `fixtures.properties[]` — مولِّدات `fast-check` مع invariants

في كلّ CI build:
- `lint-guard --self-test` يشغّل كلّ rule على fixtures الخاصّة بها أوّلاً
- إن فشل أيّ self-test → CI red **قبل** أن يبدأ فحص أيّ ملفّ في الـ repo

نفس المبدأ لكلّ pgTAP smoke test ولكلّ contract test.

---

## 6) Mutation-resistant Assertions

الـ assertion الذكيّة تُكتَب بحيث "لو تغيّر سطر واحد من الـ SUT، الـ assertion يكسر بطريقة واضحة":

```ts
// ❌ ضعيف — يمرّ حتى لو الـ SUT أرجع خطأ مختلف
expect(result).toBeTruthy()

// ❌ ضعيف — يمرّ على أيّ string فيها "ok"
expect(result.status).toContain('ok')

// ✅ قويّ — يكسر إن تغيّر أيّ حقل
expect(result).toEqual({
  status: 'ok',
  emergencyId: expect.stringMatching(/^em_[0-9a-f]{32}$/),
  dispatchedAt: expect.any(Number),
  recipientCount: 3,
})

// ✅ الأقوى — invariant سلوكي يضمن semantics لا يمكن mock-ها
const before = await db.query('SELECT count(*) FROM audit_log')
await fn(input)
const after = await db.query('SELECT count(*) FROM audit_log')
expect(after - before).toBe(1)            // exactly one audit row
expect(await db.query('SELECT actor_id FROM audit_log ORDER BY ts DESC LIMIT 1'))
  .toBe(authenticatedUserId)              // actor not spoofable
```

---

## 7) Fixtures الحقيقيّة — لا قِيَم وهميّة

| نوع | المصدر |
|---|---|
| Supabase JWT | يُنتَج من جلسة `supabase.auth.signInWithPassword` على ephemeral instance — لا نَكتُب JWT يدويّاً |
| Stripe webhook payload | يُلتقَط من `stripe events resend` على account اختبار حقيقي |
| Twilio TwiML response | يُلتقَط من Twilio test SID، يُحفَظ في `__fixtures__/twilio/*.xml` |
| FCM token | يُولَّد من Firebase test project |
| Geo coordinates | جدول real bounding boxes (KSA: lat 16–33, lng 34–56) + invalid (NaN, ∞, swapped) |
| RLS scenarios | جدول من 12 نوع actor × 8 جدول × CRUD = 384 حالة، يُختبَر كلّها في pgTAP |

---

## 8) Anti-patterns محظورة في الاختبارات

كلّ rule هنا له فحص AST في `lint-guard`:

| Anti-pattern | السبب | الـ Rule |
|---|---|---|
| `readFileSync(...).toMatch` | source-pin | `no-source-pin` |
| `expect(src).toContain("CRIT-#")` | marker-comment | `no-marker-comment` |
| `expect(true).toBe(true)` | no-op | `no-trivial-assertion` |
| `expect(x).toBeTruthy()` على regex match | يمرّ على أيّ truthy | `no-truthy-on-match` |
| `vi.mock(<SUT>)` | mock للـ SUT نفسه | `no-mock-sut` |
| `it.skip` بدون ticket comment | skip صامت | `require-skip-justification` |
| `setTimeout` في test (ليس `vi.advanceTimersByTime`) | flake | `no-real-setTimeout` |
| `Math.random()` في test (ليس fast-check) | non-deterministic | `no-math-random-in-test` |
| `process.env.X = ...` mutation عالميّ | يلوّث tests أخرى | `no-process-env-mutation` |
| test يستدعي real network (ليس MSW) | flake + cost | `no-real-network` |

---

## 9) الـ DoD لكلّ rule في `lint-guard`

كل rule جديدة لا تُدمَج حتى:

- [ ] تحتوي على ≥ 3 `fixtures.bad` و ≥ 3 `fixtures.good`
- [ ] تحتوي على ≥ 1 property test مع invariant واضح
- [ ] تجتاز self-test في CI
- [ ] تجتاز Stryker بـ score ≥ 90% (الـ rule نفسها كود صغير ومركَّز — العتبة أعلى)
- [ ] لها `worldClassRef[]` يستشهد بمعيار خارجي
- [ ] لها `doctrineRef` يستشهد بفقرة في `PHASE_0_DOCTRINE.md`
- [ ] لها رسالة خطأ تشرح السبب + رابط الـ doctrine + اقتراح إصلاح

---

**END — v1.0**
**كلّ سطر اختبار من الآن مقاسٌ بهذا الـ ladder. لا اختبار من الـ Tier 0/1/2 يُقبَل في الـ repo.**
