# SOSphere — Pre-Launch Checklist

> **Last updated:** 2026-04-29
> **Status:** Code-side ready. Awaiting user-side ops + smoke-tests before flipping the switch.
> **Owner:** FZ (fadihadi06@gmail.com)

This document is the single source of truth for "are we ready to launch?". It consolidates everything that landed in the run-up to launch (BLOCKERs #1 through #21 + several CRITs + 3 Beehive audits + the FCM push wiring + the CCPA disclosure) and lists the remaining manual steps the user must do before the public flip.

---

## 1. Code & Feature Readiness — DONE

### Frontend (React + Vite + Tailwind)
- BLOCKER #1 — IndexedDB cleared on `complete-logout`
- BLOCKER #4 — `dashboard-store` cleanup on logout / tenant switch
- BLOCKER #5 — `localStorage` keys scoped per company
- BLOCKER #7 — Tier resolution reads from employee row (not company row) for employees
- BLOCKER #8 — Civilian userId is a real UUID (no more `EMP-{name}` mismatch)
- BLOCKER #11 — `delete-account` cancels active Stripe subscription
- BLOCKER #21 — AndroidManifest deep links + intent-filters wired (5 entries)
- CRIT (SAR) — Demo banner + Live/Training toggle + audit_log on scenario load
- 3-tier reports — Free=audit-only, Basic=basic-pdf, Elite=full-pdf
- Retroactive PDF (#53) — IncidentHistoryPage + per-incident download
- Polish #3 / #5 / #9 — StorageEvent merge, retention-aware errors, getTier() consistency
- Deep-link handlers (5) — `/auth/callback`, `/reset-password`, `/payment-success`, `/payment-cancelled`, `/shared-sos/:id`
- Phase 4 (this PR) — CCPA / CPRA disclosure section in `privacy-page.tsx`

### Backend (Supabase Edge Functions + Postgres + RLS)
- BLOCKER #2 — `tel:` fallback allowed in `sos-emergency`
- BLOCKER #3 — Realtime tier sync via Stripe webhook → `subscription-realtime`
- BLOCKER #6 — `audit_log` CDC filtered by `company_id`
- BLOCKER #9 — `evidence-vault-service.ts` wired (no more dead code)
- BLOCKER #10 — `audit_log` `FORCE ROW LEVEL SECURITY` + `WITH CHECK` guards
- BLOCKER #12 — Trial restart anti-replay (`civilian_trial_history` + RPCs); migration applied to production
- BLOCKER #14 — GDPR Art. 15 SAR endpoint (`export-my-data`) + 47-table walk + 30-day rate limit
- BLOCKER #16 — Data retention cron (8 jobs, 7+1 cleanup functions); migration applied
- BLOCKER #19 — FCM push notification edge function (`send-push-notification`, OAuth2 RS256, HTTP v1)
- Beehive Audit #3 fixes — `SUPA_KEY` var, `sosphere_tier_refresh` event, `is_active: true` on push_tokens upsert

### Mobile (Capacitor + Android)
- `google-services.json` committed (Firebase project `sosphere-809bb`)
- AndroidManifest deep-link intent-filters with `autoVerify` for Universal Links
- `firebase` npm dep added for Web FCM SDK

### Testing & Quality
- Source-pinning tests for every BLOCKER fix
- TypeScript `tsc --noEmit` clean
- 96 tasks closed in the project tracker

---

## 2. User-Side Manual Steps — TODO BEFORE LAUNCH

These are things you (FZ) need to do from your local PowerShell or your dashboards. I cannot do them on your behalf because they touch credentials, app stores, or legal artefacts.

### 2.1 Push the latest commits (1 min)

```powershell
cd C:\Users\user\Downloads\sosphere-platform
git push origin main
```

This pushes:
- `bbffa4c` Beehive Audit #3 fixes (SUPA_KEY, tier_refresh, is_active)
- `547b368` CCPA disclosure section + source-pinning test

### 2.2 Redeploy `sos-alert` to Supabase (2 min)

The self-confirmation push wiring (BLOCKER #19) lives in this function and needs to be redeployed:

```powershell
supabase functions deploy sos-alert
```

Verify:
```powershell
supabase functions list
```
Look for `sos-alert` showing version > 1 and status `ACTIVE`.

### 2.3 Confirm the 3 FCM secrets are set on Supabase (1 min)

```powershell
supabase secrets list
```
You should see:
- `FCM_PROJECT_ID = sosphere-809bb`
- `FCM_SERVICE_ACCOUNT_EMAIL = …@sosphere-809bb.iam.gserviceaccount.com`
- `FCM_SERVICE_ACCOUNT_KEY = -----BEGIN PRIVATE KEY-----…`

If any are missing, the function will return `503 fcm_not_configured` — the SOS still fires, the user just doesn't get the self-confirm push.

### 2.4 Confirm the 6 Vercel env vars (1 min)

In the Vercel dashboard → Project → Settings → Environment Variables, confirm these are present and marked as **sensitive**:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_VAPID_KEY`

### 2.5 Build + deploy the Android APK (15 min)

```powershell
cd C:\Users\user\Downloads\sosphere-platform
npm install @capacitor-community/keep-awake     # if not already
npm run build
npx cap sync android
npx cap open android                             # opens Android Studio
```
In Android Studio: Build → Build Bundle(s) / APK → Build APK(s).

The signed APK then goes to the Play Console for the internal track first.

### 2.6 Sign legal docs with your DPO / legal counsel (variable)

Three artefacts the platform references but the user must finalize externally:
- **DPA** (Data Processing Agreement) — for the B2B/company tier
- **SCCs** (Standard Contractual Clauses) — for any non-EU sub-processors (Twilio, Firebase)
- **Cookie banner copy** — currently absent on the marketing site if you have one

### 2.7 (Optional) Verify Universal Links domain ownership

The AndroidManifest declares `android:autoVerify="true"` for `sosphere-platform.vercel.app`. This requires a `assetlinks.json` at:
```
https://sosphere-platform.vercel.app/.well-known/assetlinks.json
```
If that file is missing, deep links still work but will show a chooser dialog instead of opening directly. Generate via Android Studio → App Links Assistant.

---

## 3. Environment Snapshot

| Layer        | Service       | Status   | Notes                                                |
|--------------|---------------|----------|------------------------------------------------------|
| Hosting      | Vercel        | ✅ Live  | Auto-deploys on push to `main`                       |
| DB / Auth    | Supabase      | ✅ Live  | All migrations applied, RLS forced on `audit_log`    |
| Edge Funcs   | Supabase      | 🟡 Mostly| `sos-alert` needs redeploy (see §2.2)                |
| Push (web)   | Firebase Web  | ✅ Live  | VAPID key in Vercel env                              |
| Push (and)   | FCM HTTP v1   | ✅ Live  | Service account on Supabase secrets                  |
| SMS / voice  | Twilio        | ✅ Live  | Used by `sos-alert` fanout                           |
| Payments     | Stripe        | ✅ Live  | Webhook → `subscription-realtime`                    |
| Native shell | Capacitor 6   | 🟡 Pending| APK build + Play Console upload (see §2.5)           |

---

## 4. Smoke Tests (run after §2.1–§2.4)

Run each manually from a real device or browser, in this order:

1. **Sign-up + email verify** → land in dashboard, no console errors
2. **Tap SOS** → SMS arrives at the test contact within 10 s
3. **(if §2.2 is done)** → push notification "🚨 SOS sent — N/M contacts" arrives on the device that triggered SOS
4. **Stripe checkout** (Basic plan, test card `4242 4242 4242 4242`) → redirected to `/payment-success` → tier badge updates from "Free" to "Basic" within 2 s
5. **Settings → Download my data** → JSON file downloads, contains > 30 categories
6. **Settings → Delete account** → confirmation dialog → account deleted + Stripe sub cancelled
7. **Privacy page → scroll to bottom** → CCPA disclosure visible with the 7 rights and "We do not sell or share" statement
8. **SAR Protocol page** → "NOT CONNECTED TO LIVE RESCUE SERVICES" banner present, Live toggle is locked

---

## 5. Day-1 Monitoring (first 24 h)

Watch these signals:

- **Supabase logs** (Functions tab) — filter for `sos-alert` errors. Expect zero 5xx.
- **Supabase logs** (Database) — `SELECT count(*) FROM audit_log WHERE created_at > now() - interval '1 hour'`. Expect non-zero growth proportional to active users.
- **Stripe webhook deliveries** — Dashboard → Developers → Webhooks → `subscription-realtime`. Expect 100% success.
- **Vercel runtime logs** — filter for unhandled promise rejections. Expect zero.
- **Sentry** (if wired) — net-new error fingerprints.

---

## 6. Rollback Plan

If a critical bug surfaces in the first 24 h:

1. **Frontend bug** → in Vercel dashboard, promote the previous deployment back to production. ~30 s.
2. **Edge function bug** → `supabase functions deploy sos-alert --import-map …` from a previous git tag. ~2 min.
3. **DB migration bug** → migrations are forward-only. If a `cron` function misbehaves, disable it via SQL: `SELECT cron.unschedule('job-name');`
4. **FCM bug** → unset `FCM_PROJECT_ID` on Supabase secrets — function then 503s gracefully and the rest of the SOS continues to work.

---

## 7. Known Limitations (acceptable for v1)

- SAR Console (Search & Rescue dispatcher) is `Demo / Training Mode` only. Live mode requires a real `gps_trail` realtime subscription + a `sos_outbox` dispatch path + a Twilio bridge — none of which exist yet. The `sar-demo-mode-banner` makes this clear to anyone using the page.
- Push to **contacts** (people you'd send an SOS to) requires a phone→user_id resolver that doesn't exist yet. SMS is the universal fallback for non-platform-user contacts.
- Cookie consent banner: not implemented on the marketing site (in-app pages don't set cookies that need consent).

---

## 8. Sign-off

When all items in §2 are green and all smoke tests in §4 pass, the platform is ready to flip. Update this section with the launch date + your initials when you go live:

- **Launched:** ____ ___, 2026
- **Initials:** ____
