# SOSphere — Deep Architectural Audit
**Date:** 2026-05-19
**Scope:** Mobile app + Dashboard + Audit log coverage + i18n
**Method:** 4 parallel automated explore-agents + manual cross-check

> **Top-line verdict:** المنصة تحوي **38+ فجوة جذرية موثّقة** بعد الجلسات السابقة (R-48 → R-86). أبرزها: 25 admin action بدون audit log، 12 dashboard page شبه stubbed، Privacy screen غير مرئية، Medical ID لا يُحفظ على الخادم، و150+ نص إنجليزي مُجمَّد في الـ dashboard. هذا التقرير قائمة الـ "to-fix" قبل soft launch.

---

## A. Mobile App — Buttons & Dead Ends

### A.1 Critical (تمنع الاستخدام)

| ID | Bug | الموقع |
|----|-----|--------|
| **M-01** | **Privacy screen غير قابلة للوصول** — `navigate("privacy")` يوجد لكن `screen === "privacy"` لا تُرسَم في mobile-app.tsx | mobile-app.tsx |
| **M-02** | **Medical ID لا يُحفظ على الخادم** — localStorage فقط، فُقدان عند uninstall، invisible لـ emergency responders | medical-id.tsx:69-70 |
| **M-03** | **Emergency contact changes بدون audit_log** — add/edit/delete جميعها localStorage بدون أثر | emergency-contacts.tsx |

### A.2 High Priority

| ID | Bug |
|----|-----|
| **M-04** | Elite-features screen بدون tier gate — free users يتصفّحون قائمة الـ premium بدون upgrade prompt |
| **M-05** | Mission tracker بدون tier restriction واضحة (هل employee-only؟) |
| **M-06** | Checkin timer expiration بدون audit_log (dead-man's switch يفعّل بصمت) |
| **M-07** | Language preference changes بدون audit (إعداد accessibility غير مُتتبَّع) |
| **M-08** | Demo access (`onDemoAccess`) بدون audit trail |

### A.3 Medium (consistency)

| ID | Bug |
|----|-----|
| **M-09** | Tier gating غير متّسق: Home/Profile/Dashboard كل واحد يطبّق gates بشكل مختلف |
| **M-10** | Navigation clicks بدون audit (فقط logout يُسجَّل) |
| **M-11** | Post-emergency-debrief actions بدون audit |

---

## B. Dashboard — Admin Actions Without Backend

### B.1 CRITICAL — Phase 2 STUBS (UI exists, no persistence)

| ID | Page | Action | الحالة |
|----|------|--------|--------|
| **D-01** | dashboard-roles-page.tsx | Modify Custom Permissions | `console.log` فقط — لا API call فعلي |
| **D-02** | dashboard-roles-page.tsx | Change Role / Assign Zone | **frontend state فقط** — لا UPDATE في DB |
| **D-03** | dashboard-roles-page.tsx | Suspend/Activate/Create Role | "Coming in Phase 2" handlers stubbed |
| **D-04** | dashboard-incident-investigation.tsx | Update status / Add evidence / Change severity | **كل المحولات console.log فقط** — لا persistence |
| **D-05** | dashboard-risk-register.tsx | Create/Update/Close Risk | **completely stubbed** — register غير وظيفي |
| **D-06** | dashboard-settings-page.tsx | Company name / Logo / SMTP / 2FA policy / SCIM | كل forms بدون Save handlers |
| **D-07** | emergency-playbook.tsx | Create/Edit/Activate Playbook | لا CRUD backend |
| **D-08** | safety-gamification.tsx | Award badge / Reset score / Adjust multiplier | لا persistence |
| **D-09** | buddy-system.tsx | Assign/Swap/Break Pair | drag-drop UI بدون mutation |
| **D-10** | weather-alerts.tsx | Configure threshold / Test alert | لا integration مع API الطقس |
| **D-11** | journey-management.tsx | Create/Approve/Mark Complete journey | لا persistence |
| **D-12** | batch-email-scheduler.tsx | Schedule / Send broadcast | UI بدون backend |

### B.2 CRITICAL — Audit Log Missing on REAL actions

| ID | Action | الموقع |
|----|--------|--------|
| **D-13** | Create Emergency (manual) — `emergencyHub` | audit_log فارغ |
| **D-14** | Assign / Unassign Responder | audit_log فارغ |
| **D-15** | Resolve / Close Emergency | audit_log فارغ |
| **D-16** | Escalate Emergency | audit_log فارغ |
| **D-17** | Broadcast Alert (SMS/Push mass send) | لا تسجيل recipients/sender/content hash |
| **D-18** | Stripe checkout initiate | لا pre-action audit (webhook async) |
| **D-19** | Stripe portal access | لا تسجيل |
| **D-20** | Cancel trial / subscription | لا reason logged |
| **D-21** | Invite employee bulk (CSV) | jobs الـ async موجودة لكن لا audit_log per row |
| **D-22** | Revoke invitation | requester identity غير مُسجَّلة |
| **D-23** | GPS revocation (employee) | لا audit |
| **D-24** | Zone assignment | لا audit |
| **D-25** | Audit log EXPORT to PDF | لا تسجيل export event (data exfil risk) |
| **D-26** | Cancel async job | لا reason logged |
| **D-27** | Geofence boundary edit | stub — لا persistence |
| **D-28** | SAR activation | لا audit (lifesaving action!) |

### B.3 ARCHITECTURE — أعمق Bug في الـ Dashboard

| ID | المشكلة |
|----|---------|
| **D-29** | **dashboard-audit-log-page.tsx يعرض mock data ثابتة** (`MOCK_AUDIT` array). الـ RPC الحقيقي `getRealAuditLog()` مستورد لكن **لم يُستدعَ أبداً**. الصفحة الأهم للـ SOC 2/ISO تعرض بيانات مزيّفة! |
| **D-30** | **لا session timeout على Dashboard** — Owner مسجّل دخول للأبد إذا ترك الجهاز |
| **D-31** | **Dev fallback لـ Stripe لا يزال في production code** ("Stripe unavailable — DEV fallback only") — non-owners قد يستطيعون upgrade مزيّف |
| **D-32** | **Non-owners يرون أزرار Owner-only** (Upgrade / Manage Billing / Edit Roles) بدون RBAC check قبل عرض الأزرار |
| **D-33** | **saveUserPermissions() function عبارة عن console.log** — لا تصل لـ backend |

---

## C. Audit Log Coverage (SOC 2 / ISO 27001 readiness)

### C.1 ما هو مغطّى ✅

- Authentication (signup, login, logout, password reset, MFA events) — جيد
- SOS lifecycle trigger + end (عبر `log_sos_audit`)
- Emergency insert/update (DB trigger)
- DPA acceptance (`accept_company_dpa` RPC)
- Stripe webhook deduplication (لكن audit_log غير مكتوب)

### C.2 ما هو ناقص ❌ (تجمعت من Agents 1, 2, 3, 4)

**Profile & Identity (HIGH for SOC 2):**
- Emergency contact CRUD (localStorage only، invisible للـ audit)
- Biometric enroll/unenroll
- PIN change
- Avatar upload (R-82 جديد)
- Phone/name/email profile updates (R-81/R-83 incomplete on server-side)
- GPS consent toggle
- Neighbor alert consent toggle

**Subscription Lifecycle (HIGH for revenue compliance):**
- Stripe webhook events لا تُكتب في audit_log (فقط في stripe_events_dedup)
- subscription_create/update/cancel — لا audit
- refund (إذا أُضيف لاحقاً)

**Company Membership (CRITICAL for tenant integrity):**
- Member role promotion/demotion
- Member revocation
- Company deletion
- Bulk invite per-row tracking

**Push Notifications:**
- Token register (push_tokens INSERT)
- Token revoke (DELETE)
- Per-send delivery attempt

**SOS Heartbeat:**
- Heartbeat يُكتب في `sos_sessions` فقط لا `audit_log` (gap في forensic trail)

---

## D. i18n Coverage Gaps

### D.1 Dashboard (CRITICAL — 0% coverage)

كل ملفات dashboard التالية تستورد `dashboard-i18n` لكن **لا تستدعي `useT()` أبداً**:

| File | Hardcoded strings count |
|------|------------------------|
| dashboard-settings-page.tsx | ~30 |
| dashboard-billing-page.tsx | ~50 (Customer Rights, badges, toasts) |
| dashboard-roles-page.tsx | ~70 (Permission groups + actions + descriptions) |
| dashboard-pricing-page.tsx | ~25 (Lifecycle + expiry steps) |
| employees-unified-page.tsx | ~15 (Status + lastAction labels) |

**Total: ~190 hardcoded English strings في الـ admin/owner UI**

### D.2 Mobile (HIGH — partial)

| File | الوضع |
|------|------|
| individual-home.tsx | ✅ مترجم تماماً (uses `isAr`) |
| emergency-contacts.tsx | ❌ Safety Contacts, Edit/Add headers, all relation types, all toasts hardcoded |
| family-circle.tsx | ⚠️ يستخدم custom `tr()` بدل `useLang` (anti-pattern) — statusConfig hardcoded |
| safe-walk-mode.tsx | ❌ Quick messages + phase labels + escalation messages hardcoded |
| profile-settings.tsx | ❌ Plan labels + section titles + 20+ items hardcoded |

---

## E. Payment Path Gaps

| ID | المشكلة |
|----|---------|
| **P-01** | **No pre-checkout audit** — Stripe webhook async، فإذا فشل لا أحد يعرف admin الذي بدأ checkout |
| **P-02** | **No B2B vs B2C disambiguation logging** — أي tier تمّ checkout-ه غير واضح في audit |
| **P-03** | **No portal access audit** — أي owner فتح Stripe portal لا يُسجَّل |
| **P-04** | **Dev fallback في billing-page.tsx** — يجب حذفه قبل production |
| **P-05** | **Billing cycle في localStorage بدل user.metadata** — يفقد عند uninstall |
| **P-06** | **calculateMonthlyBill() يستخدم mock data** — لا server-side validation |
| **P-07** | **Refund button غير موجود** — لا UI لـ refund (R-42 webhook handler يدعم لكن لا UI trigger) |

---

## F. خطة الإصلاحات المقترحة (الأولوية)

### Phase 1: Critical Compliance (~2 أسابيع)

**Priority P0 — قبل soft launch:**

1. **R-87**: ربط `dashboard-audit-log-page.tsx` بـ `getRealAuditLog()` فعلياً — حذف MOCK_AUDIT
2. **R-88**: إضافة `audit_log.insert` على كل D-13 حتى D-28 (16 admin action)
3. **R-89**: حذف Dev Stripe fallback من billing-page.tsx
4. **R-90**: RBAC check قبل عرض أزرار Owner-only (D-32)
5. **R-91**: ربط `saveUserPermissions()` بـ backend فعلياً (D-33)
6. **R-92**: Privacy screen رسم في mobile-app.tsx (M-01)
7. **R-93**: Medical ID server persistence + audit (M-02)
8. **R-94**: Emergency contact CRUD → server table + audit (M-03 + Profile gaps)
9. **R-95**: Profile changes (avatar/phone/name/language) → server + audit_log via new `log_profile_change` RPC

### Phase 2: Robustness (~1 أسبوع)

10. **R-96**: Session timeout على dashboard (D-30) — 30min idle
11. **R-97**: Stripe webhook → log_sos_audit per event_id (P-01, P-02, P-03)
12. **R-98**: SAR activation audit (D-28)
13. **R-99**: Push notification send + register audit
14. **R-100**: Refund UI trigger (P-07)

### Phase 3: Stubs to Real (~2 أسابيع)

15. **R-101**: dashboard-roles-page real backend (D-01, D-02, D-03)
16. **R-102**: investigation/risk-register real backend (D-04, D-05)
17. **R-103**: settings page real backend (D-06)
18. **R-104**: playbook CRUD (D-07)

### Phase 4: i18n Cleanup (~1 أسبوع)

19. **R-105**: Dashboard files كلها → `useT()` (190 strings)
20. **R-106**: Mobile files المتبقّية → `useLang()` (50+ strings)
21. **R-107**: family-circle.tsx → استبدال custom `tr()` بـ standard pattern

### Phase 5: Architecture (1 جلسة معمارية)

22. **R-108**: Dual-role support — employee + individual في نفس Gmail (السؤال المعماري الذي طرحته)

---

## G. Recommendations

**قبل أي soft launch:** نفّذ Phase 1 كاملة (R-87 → R-95). هذا يجعل الـ audit_log صادقاً + RBAC حقيقي + الفجوات الأساسية مغلقة.

**اختبار end-to-end إجباري:** بعد كل R-XX، **uninstall + reinstall** فعلياً على جهاز Android، اختبر يدوياً، وأرسل لي تأكيداً.

**جلسة معمارية لـ Dual-Role (R-108):** هذه مهمة منفصلة كبيرة. تحتاج تصميم UX قبل الكود (شاشة اختيار role؟ زر switch؟ profile واحد بـ roles array؟).

---

**هذا التقرير حلّ محل تخمين الـ patches الفردية.** نسير من هنا بترتيب Phase 1 → 5، كل بند بـ R-XX number، مع test + push منفصل لكل واحد.
