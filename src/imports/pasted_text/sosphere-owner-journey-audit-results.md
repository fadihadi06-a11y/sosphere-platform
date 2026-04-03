# SOSphere Owner Journey Audit — Full Results
## Date: March 16, 2026

---

## JOURNEY 1 — Company Owner First Visit

---

### Step 1: Landing Page

| Field | Status |
|-------|--------|
| **Component** | None (no dedicated landing page) |
| **File** | `/` route = `mobile-app.tsx` (MobileApp), `/dashboard` = `dashboard-web-page.tsx` (Login) |
| **What Owner Sees First** | If `/` — sees MOBILE app welcome screen (not a company landing page). If `/dashboard` — sees enterprise login page with "Demo Mode" banner, stats ticker, phone/email login tabs. |
| **Clear CTA to Sign Up** | YES — "Start Free Trial" button at bottom of `/dashboard` login form (line 932) navigates to `register` step |
| **Demo/Trial Option** | YES — "Start Free Trial" button + demo accounts (3 phone, 3 email) that auto-login with OTP `123456` |
| **Product Info Shown** | MINIMAL — only rotating stats ticker (Active Workers, SOS Events, Zones, Uptime). No feature list, no screenshots, no testimonials |
| **Pricing Before Signup** | NO — pricing only visible INSIDE registration wizard (Step 5) or after login in dashboard |

**What Works:**
- Login page has polished glassmorphism design, animated stats, phone+email tabs
- Demo accounts with quick-select buttons
- OTP flow (mock with hardcoded `123456`)
- "Contact Sales" button opens mailto link

**What's Broken:**
- Nothing technically broken

**What's Missing:**
- No marketing landing page at `/` or `/landing` — owner lands on mobile app or raw login
- No product features/benefits section pre-signup
- No pricing visibility before committing to registration
- No "How it Works" section
- No testimonials or social proof
- No video demo link (the `/demo` route exists but isn't linked from login page)

**Critical for Life-Safety:** NO — marketing concern, not safety

---

### Step 2: Registration Flow

| Field | Status |
|-------|--------|
| **Component** | `CompanyRegister` |
| **File** | `/src/app/components/company-register.tsx` |
| **All Buttons Functional** | YES — all 6 steps work |
| **Data Persisted** | NO — state is React local state only, lost on refresh |

**Fields Required (Step 1):**
- Owner Full Name (text, min 2 chars) -- YES
- Business Email (validated against 21 free providers like gmail/yahoo) -- YES
- Company Name (text, min 2 chars) -- YES
- Industry (6 options: Construction, Oil & Gas, Manufacturing, Healthcare, Logistics, Other) -- YES
- Employee Estimate (slider 1-35,000) -- YES
- Country (10 options: SA, AE, QA, KW, BH, OM, EG, US, GB, Other) -- YES

**What Works:**
- Business email validation rejects free providers with helpful error message suggesting company domain
- Business email "verified" badge shows domain, relay info, and batch warnings for large teams (>5000 employees)
- Industry selector with icons
- Employee estimate slider with logarithmic-like steps
- Smart batching info: shows `5000/day` limit and batch count for large teams
- All validation gates work (canNext checks each step)

**What's Broken:**
- `handleNext` line 159-160: `if (step < 6) setStep((step + 1))` and `if (step === 5) setStep(6)` — redundant double-set for step 5. Works by accident but messy logic.
- No data persistence — closing tab loses ALL registration progress
- Business email "verification" is client-side domain check only — no actual email verification sent

**What's Missing:**
- Phone number NOT collected during registration at all
- No OTP/email verification — instant "verified" badge is visual-only
- No password creation — entire auth is simulated
- No "company size" selector (small/medium/large) — only numeric slider
- No email verification step after registration
- No duplicate company name check
- Owner phone not captured → can't send SMS/WhatsApp to owner later

**Critical for Life-Safety:** MEDIUM — no verified contact means owner identity is unverified in a safety-critical system

---

### Step 3: Company Setup Wizard

| Field | Status |
|-------|--------|
| **Component** | `CompanyRegister` Steps 1-6 |
| **File** | `/src/app/components/company-register.tsx` |

**Flow:**
1. Company Profile (name, email, industry, size, country)
2. Zone Toggle ("Yes, We Have Zones" / "No, Single Location")
3. Zone Builder (if yes) / skipped (if no → jumps to Step 4)
4. Employee Import (manual / CSV / later)
5. Plan Selection (Spark/Shield/Guardian/Enterprise)
6. Success (invite code, launch button)

**What Works:**
- 6-step wizard with animated progress bar
- Zone toggle cleanly skips Step 3 and adjusts progress dots (5 instead of 6)
- Back navigation handles skip correctly (Step 4 → Step 2 when no zones)
- Recommended plan auto-calculated from employee count
- Success screen shows invite code, employee journey steps, summary stats

**What's Broken:**
- Progress bar logic inconsistency: `totalSteps = hasZones ? 6 : 6` — dead code, always 6 (line 140)
- `actualStep` variable computed but never used (line 141)
- No data persistence — cannot save and return later. Closing tab = start over
- Step 6 "Bulk Invitation Engine" animation shows sending progress but nothing actually happens

**What's Missing:**
- No "Save Draft" / resume later capability
- No skip-step freedom — must go sequentially
- Minimum setup to dashboard: must complete Steps 1+2+4+5 (cannot skip plan selection)
- No "skip all and explore dashboard" option for evaluation

**Critical for Life-Safety:** LOW

---

### Step 4: Zone Creation

| Field | Status |
|-------|--------|
| **Component** | `CompanyRegister` Step 3 |
| **File** | `/src/app/components/company-register.tsx` lines 170-183 |

**Zone Fields:**
- Zone Name (text) — REQUIRED
- Zone Type (5 options: Office, Warehouse, Production, Outdoor, Restricted) — selector
- Evacuation Point (text) — defaults to "Main Gate" if empty
- Risk Level — AUTO-ASSIGNED: Restricted → High, Production → Medium, others → Low

**What Works:**
- Add/remove zones
- 5 zone types with color coding
- Auto risk assignment from zone type
- Zones listed with type badges and evacuation points
- Minimum 1 zone required to proceed (validation works)

**What's Broken:**
- Zone IDs are sequential (`Z-1`, `Z-2`) — not unique enough, will collide across companies
- No duplicate zone name check — can add "Zone A" twice

**What's Missing:**
- NO map interface — text input only for everything
- NO GPS coordinates / geofencing setup in registration (exists only in dashboard later)
- NO bulk zone import — one-by-one only
- NO minimum/maximum zones per plan enforced (all plans allow unlimited zones in registration)
- NO zone capacity (how many workers can be in a zone)
- Zone data not saved to any store — lost when leaving registration

**Critical for Life-Safety:** HIGH — zones are core to emergency response. Text-only setup without map/GPS means evacuation points are unverified text strings

---

### Step 5: Employee Onboarding Method

| Field | Status |
|-------|--------|
| **Component** | `CompanyRegister` Step 4 + `EnterpriseImportWizard` (dashboard only) |
| **Files** | `company-register.tsx` lines 120-200, `enterprise-import-wizard.tsx` |

**Methods Available in Registration:**
- a) Manual entry: name, phone, email, role, department, zone — YES
- b) CSV import — MOCK ONLY (no real file parsing)
- c) Invite via SMS/email — NOT in registration (only post-dashboard)
- d) "Skip for now" — YES

**CSV Fields Defined (line 70-79):**
```
employee_id (required) | full_name (required) | phone (required) | email (required) | department (required) | role (required) | zone (optional) | emergency_contact (optional) | blood_type (optional)
```

**What Works:**
- Manual entry form with all fields
- Manual employees listed with removal option
- Zone dropdown populated from zones created in Step 3
- CSV field guide showing all columns (CSV_FIELDS array, 9 columns)
- "Download CSV Template" button exists (line 788)
- Employee estimate auto-adjusts recommended plan
- Skip option ("Add Later") works

**What's Broken:**
- CSV upload is COMPLETELY FAKE: `handleCsvUpload` just sets `csvUploaded=true` and `csvCount=employeeEstimate` (line 196-200). No file input, no parsing, no validation.
- "Download CSV Template" shows a toast saying "Downloaded" but NO actual file is generated or downloaded (line 788)
- Manual entry requires only `name` and `phone` (line 187) but CSV defines 6 required fields — inconsistency

**What's Missing:**
- No real CSV file parsing, column mapping, or validation in registration wizard
- `EnterpriseImportWizard` (with real column mapping, validation, preview) exists but is ONLY accessible from dashboard's employee page — not from registration
- No real CSV template download (blob/file generation)
- No validation of phone number format during manual entry
- No duplicate employee check (same phone/email)
- No invite preview before sending
- Employee data not persisted to any store

**Critical for Life-Safety:** HIGH — employees are the people being protected. Mock CSV import means production onboarding would fail completely

---

### Step 6: Invitation System

| Field | Status |
|-------|--------|
| **Component** | `EmployeeInviteManager` (dashboard) + `CompanyRegister` Step 6 (registration success) |
| **Files** | `employee-invite-manager.tsx`, `company-register.tsx` lines 940-1100 |

**Registration Success (Step 6) Shows:**
- 6-character alphanumeric invite code
- Copy button (clipboard API)
- "Bulk Invitation Engine" animated progress bar (visual only)
- Employee journey description (5 steps)
- Summary: employee count, zone count, 14 trial days

**EmployeeInviteManager (Dashboard) Provides:**
- Email template with: company name, join link, invite code, app download links (Play Store, App Store, universal)
- WhatsApp template with same info
- Individual employee status tracking (pending/sent/delivered/joined/failed)
- "Mark as Sent" per employee
- Copy-to-clipboard for each template

**Invite Message Contains:**
- Company name — YES
- Join code — YES (6-char)
- App download links — YES (Play Store, App Store, Universal)
- Admin name — NOT shown in template
- Zone assignment — NOT in template

**What Works:**
- Invite code generation (random 6-char alphanumeric)
- Copy-to-clipboard functionality
- Email and WhatsApp message templates
- Individual employee tracking UI
- Template preview with expand/collapse

**What's Broken:**
- No actual invitation sending — relies on admin manually copying templates to their own email/WhatsApp client
- "Bulk Invitation Engine" in registration Step 6 is pure animation — nothing is sent
- Invite code has NO expiry — valid forever
- No rate limiting on invite codes

**What's Missing:**
- No real SMS/email sending infrastructure
- No bulk resend button
- No invite expiry (time-limited codes)
- No tracking of whether invite was actually opened/clicked
- No handling of wrong phone numbers
- Admin name not included in invite template
- Zone assignment not included in invite
- No "Resend All" for failed invites
- No invite revocation mechanism

**Critical for Life-Safety:** MEDIUM — if employees can't receive or use invites, they can't be protected by the system

---

### Step 7: Employee Receives Invitation

| Field | Status |
|-------|--------|
| **Component** | `CompanyJoin` (mobile) |
| **File** | `/src/app/components/company-join.tsx` |

**Mobile Flow:** Login → Welcome → Consent → Onboarding Select → "Join Company" → Company Join

**Company Join Screen:**
- Two modes: Paste invite link OR Enter 6-digit code
- On verification: shows company name, logo, employee count, zone, evacuation point, role, department, manager name
- If matched (CSV found): → EmployeeQuickSetup → EmployeeWelcome
- If not matched: → PendingApproval → (demo buttons) → EmployeeWelcome

**What Works:**
- Two join modes (link / code)
- Code input with auto-advance between 6 boxes
- Verification animation
- Match result display: company name, zone, manager, evacuation point
- Branching: matched → quick setup, unmatched → pending approval

**What's Broken:**
- Matching is MOCK: `MOCK_MATCH` hardcoded object (line 14-25) — always returns same company/zone/manager regardless of code entered
- Any 6 characters or any link > 8 chars will "verify" successfully
- No real code validation against company invites

**What's Missing:**
- Admin is NOT automatically set as emergency contact — manager shown as info only
- Employee cannot see zone on a map (text only)
- No validation that code/link is valid (any input works)
- No code expiry check
- Employee's emergency contacts are added manually in EmployeeQuickSetup (Step 3) — not auto-populated
- No push notification when employee joins — dashboard only sees it via localStorage sync

**Critical for Life-Safety:** HIGH — fake verification means anyone with any code can "join" a company in the prototype

---

### Step 8: Admin Approves Employee

| Field | Status |
|-------|--------|
| **Component** | `employees-unified-page.tsx` (dashboard) + `PendingApproval` (mobile) |
| **Files** | `employees-unified-page.tsx` lines 408-443, `pending-approval.tsx`, `shared-store.ts` lines 1396-1430 |

**Dashboard Side:**
- "Pending Approvals" button with count badge in employees page
- Shows: employee name, phone, zone, timestamp
- Approve/Reject buttons per request
- Toast notification on approve/reject

**Mobile Side (PendingApproval):**
- Animated hourglass waiting screen
- "Contact Admin" button (non-functional — no action)
- "Demo: Enter as Supervisor" button (bypasses approval)
- "Demo: Enter as Employee" button (bypasses approval)

**Data Flow:**
- `submitJoinRequest()` → localStorage → `getJoinRequests()` → dashboard
- `approveJoinRequest(id, approvedBy)` → updates localStorage
- Dashboard listens via `StorageEvent`

**What Works:**
- JoinRequest CRUD in shared-store (submit, get, approve, reject)
- Dashboard approval UI with pending count
- localStorage-based cross-tab sync
- Approval toast notifications in dashboard

**What's Broken:**
- PendingApproval (mobile) has NO real-time listener for approval — no `StorageEvent` listener, no polling
- Employee NEVER gets notified when admin approves — only demo bypass buttons
- "Contact Admin" button is visual only (no mailto, no phone call, no action)
- No bulk approve option — one by one only

**What's Missing:**
- Real-time approval notification to employee (needs StorageEvent listener in PendingApproval)
- Push notification when employee is approved
- Waiting screen timeout — employee waits forever with no feedback
- What happens when admin rejects? Mobile has no rejection handler
- No "re-request" option after rejection
- Bulk approve not available
- Employee info shown to admin is minimal (no photo, no ID verification)

**Critical for Life-Safety:** HIGH — if employees can't complete onboarding due to broken approval flow, they can't use SOS features

---

### Step 9: Subscription and Billing

| Field | Status |
|-------|--------|
| **Components** | `CompanyRegister` Step 5, `BillingPage`, `PricingPage` |
| **Files** | `company-register.tsx`, `dashboard-billing-page.tsx`, `dashboard-pricing-page.tsx` |

**Registration Plans (company-register.tsx):**
| Plan | Range | Price |
|------|-------|-------|
| Spark | 1–15 | $39/mo |
| Shield | 16–50 | $99/mo |
| Guardian | 51–500 | $249/mo |
| Enterprise | 500+ | Custom |

**Dashboard Pricing (dashboard-pricing-page.tsx):**
| Plan | Range | Price |
|------|-------|-------|
| Spark | 1–15 | $39/mo |
| Shield | 16–50 | $99/mo |
| Guardian | 51–200 | $249/mo |
| Enterprise | 200+ | Custom |

**Dashboard Billing (dashboard-billing-page.tsx):**
| Plan | Range | Price |
|------|-------|-------|
| Starter | Up to 25 | $1.5/emp/mo |
| Professional | Up to 100 | $2.5/emp/mo |
| Enterprise | Unlimited | $4.0/emp/mo |

**What Works:**
- Registration: Plan selection with recommended badge based on employee count
- Registration: Monthly/Annual toggle (annual = 25% discount)
- 14-day free trial notice
- Dashboard Pricing: Full lifecycle management (trial_active, trial_ending, trial_expired, etc.)
- Dashboard Billing: Invoice history, add-ons section
- Dashboard Billing: Usage meter (employee % of plan limit)

**What's Broken:**
- CRITICAL PRICING INCONSISTENCY:
  - Registration uses flat pricing (Spark $39, Shield $99, Guardian $249)
  - Dashboard Billing uses per-employee pricing (Starter $1.5, Pro $2.5, Enterprise $4.0)
  - Different plan NAMES: Registration=Spark/Shield/Guardian/Enterprise vs Billing=Starter/Professional/Enterprise
  - Different employee RANGES: Registration Guardian=51-500 vs Pricing Guardian=51-200
  - Enterprise threshold: Registration=500+ vs Pricing=200+
- No actual payment processing — all mock
- Trial logic exists in pricing page types but no enforced timer/countdown

**What's Missing:**
- No payment gateway (Stripe, etc.)
- No credit card entry form
- No trial countdown anywhere in the dashboard
- No "trial expired" enforcement — app continues working
- No mid-cycle upgrade flow
- No downgrade/cancellation flow
- No smart pricing suggestion based on company size during registration (recommendation exists but it's basic range matching)
- No refund policy
- No proration logic for plan changes

**Critical for Life-Safety:** MEDIUM — pricing inconsistency would confuse real customers, but mock payment is expected for a prototype

---

## SUMMARY TABLE

| Step | Component | Status | What Works | Critical Breaks | Missing for Production |
|------|-----------|--------|------------|-----------------|----------------------|
| 1. Landing | None | MISSING | Dashboard login page exists | No landing/marketing page | Product page, pricing, features, testimonials |
| 2. Registration | CompanyRegister | PARTIAL | 6-step wizard, email validation | No persistence, no real verification | Phone field, OTP, email verify, password |
| 3. Setup Wizard | CompanyRegister | PARTIAL | Sequential wizard, zone skip logic | Progress lost on refresh | Save draft, skip freedom, resume later |
| 4. Zone Creation | CompanyRegister Step 3 | PARTIAL | Add/remove zones, 5 types, auto-risk | Text-only, no map, no GPS | Map interface, geofencing, bulk import |
| 5. Employee Import | CompanyRegister Step 4 | BROKEN | Manual entry UI, CSV fields defined | CSV is 100% fake, no file parsing | Real CSV parser, validation, template download |
| 6. Invitations | EmployeeInviteManager | PARTIAL | Templates, invite code, copy-to-clipboard | No actual sending, no expiry | Real send, expiry, tracking, bulk resend |
| 7. Employee Join | CompanyJoin | PARTIAL | Two join modes, verification UI | Mock matching (any code works) | Real validation, admin as emergency contact |
| 8. Admin Approval | employees-unified-page | BROKEN | Dashboard approve/reject, localStorage sync | Employee never notified of approval | Real-time notification, bulk approve, rejection handling |
| 9. Billing | 3 separate files | BROKEN | Plans UI in 3 places | Plan names/prices/ranges inconsistent across files | Payment gateway, trial enforcement, unified pricing |

---

## TOP 10 CRITICAL FINDINGS (Ordered by Life-Safety Impact)

1. **Employee never notified of approval** — PendingApproval has no StorageEvent listener. Employee stuck forever unless they press demo bypass buttons.

2. **CSV import is 100% fake** — Registration wizard pretends to import CSV but just sets a boolean. No file parsing, no validation, no data. `EnterpriseImportWizard` (real) only accessible post-dashboard.

3. **Any invite code works** — CompanyJoin mock-matches any 6 characters to same hardcoded company. No real code validation.

4. **3 inconsistent pricing systems** — Registration (flat pricing), Dashboard Pricing (flat pricing, different ranges), Dashboard Billing (per-employee pricing, different names). Would completely confuse production customers.

5. **Zero data persistence in registration** — All 6 steps of company setup lost on tab close/refresh. No localStorage, no draft save.

6. **No map interface for zones** — Zones are text-only. Evacuation points are strings like "Main Gate" with no GPS coordinates. In a real emergency, text directions don't save lives.

7. **Admin not set as emergency contact** — When employee joins company, manager/admin is shown as info but NOT added to employee's emergency contacts list.

8. **CSV template download is fake** — Button shows success toast but generates no actual file (line 788). Template download is the #1 thing an HR admin would try.

9. **No trial enforcement** — 14-day trial mentioned in 3 places but no countdown, no expiry check, no feature lockout. App works forever.

10. **"Contact Admin" on PendingApproval is dead** — Button exists but has zero onClick handler. Employee waiting for approval has no way to contact admin.

---

## CONCLUSION

The Owner Journey covers all 9 steps architecturally. The UI is polished and animations are production-quality. However, **5 of 9 steps have broken or fake core functionality** that would fail in any real deployment. The most dangerous gap is the broken approval notification loop (Finding #1) — an employee could download the app, enter a valid code, and wait indefinitely with no way to get approved or contact admin. The second most dangerous is fake CSV import (#2) — the primary enterprise onboarding method doesn't work at all.
