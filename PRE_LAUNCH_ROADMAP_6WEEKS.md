# SOSphere — Pre-Launch Roadmap (6 weeks)

> **Created:** 2026-04-29 (after Beehive Audits #5 + #6)
> **Decision:** Delay launch. Wire all features to real backends. Launch professionally.
> **Target launch:** ~2026-06-10
> **Owner:** FZ (solo)

This roadmap supersedes `PRE_LAUNCH_CHECKLIST.md` for the launch date. The checklist remains valid for the day-of-launch ops; this document covers what needs to be DONE before that day arrives.

---

## Why we're delaying

Beehive Audit #6 found that 6 dashboard pages are pure UI mockups (no real backend), 10 more are partially wired, and only 4 are fully real. A paying customer would experience:

- **Mission Control** — never sees real SOS events
- **Risk Map Live** — shows 11 hardcoded fake employees
- **Geofencing** — saves canvas pixels, never triggers alerts
- **Shift Scheduling** — loses every change on tab close
- **Broadcast / Evacuation** — never reaches employee phones
- **Playback** — replays simulated routes, not real GPS

Plus Stripe KYC and bank account aren't set up, so any payment received cannot be paid out.

The decision: stop, fix, then launch with a product that delivers what it promises.

---

## Wave-by-wave plan

### Wave 1 — Backend wiring, week 1 (the highest-leverage fixes)

| # | Task | File(s) | Why |
|---|---|---|---|
| 1.1 | Mission Control → real Supabase | `mission-control.tsx`, `mission-store.ts` | Replace `getAllMissions()` with `supabase.from('sos_sessions')` + `.channel('missions')` realtime sub. Without this the entire B2B value proposition is fake. |
| 1.2 | Risk Map Live worker positions | `shared-store.ts:2316-2403`, `risk-map-live.tsx` | Source `getLiveWorkerPositions` from a Supabase view of `gps_trail` last point per employee. Drop the SIMULATED_GPS constants. |
| 1.3 | GPS Playback uses real `gps_trail` | `risk-map-live.tsx:812-856` | Feed `getEmployeeTrip(employeeId)` from `gps_trail` ORDER BY recorded_at ASC. UI controls (play/pause/speed/scrub) already work — just swap data source. |
| 1.4 | Broadcast / Evacuation push fanout | `shared-store.ts:1403-1428`, `dashboard-broadcast.tsx`, `dashboard-evacuation-page.tsx` | Add `broadcasts` table + RLS. Inside `sendBroadcast()`, also `supabase.from('broadcasts').insert` + invoke `send-push-notification` edge fn with audience resolved to `push_tokens`. |

Deliverable end of Wave 1: an SOS triggered from a phone shows up in Mission Control + Risk Map within 2 seconds. An admin "evacuate" button reaches employee phones via push.

### Wave 2 — Geofencing + offline, week 2

| # | Task | File(s) | Why |
|---|---|---|---|
| 2.1 | Geofencing coords: pixel → lat/lng | `dashboard-geofencing-page.tsx:104-129` | `GeoZone.center` is currently `{x, y}` canvas pixels. Convert via the map projection on save so the polygon is real geo. |
| 2.2 | Geofence enter/exit listener | new file `src/app/components/geofence-watcher.ts` + wire in `mobile-app.tsx` | On every GPS update, check polygon containment vs. `geofences` rows. Emit `audit_log` entry + push to admin on transition. |
| 2.3 | Offline fleet view → real data | `dashboard-offline-page.tsx` | Read from `sosphere_sync_status` localStorage + `audit_log` last-seen. Drop `MOCK_FLEET` + `MOCK_SYNC_HISTORY`. |

Deliverable end of Wave 2: when a real employee's phone leaves the warehouse polygon, the admin gets a push within 5 seconds + an audit row. The offline page shows true device counts.

### Wave 3 — Shifts + UX polish, week 3

| # | Task | File(s) | Why |
|---|---|---|---|
| 3.1 | Shift Scheduling → DB-backed | `dashboard-shift-scheduling-page.tsx` + new `shifts` table migration | Persist to `supabase.from('shifts')`. Add employee mobile view that lists today's shift. |
| 3.2 | Fix Audit Log useMemo dep | `dashboard-audit-log-page.tsx:486` | Add `allEntries` to the deps. New rows arriving via `onAuditEvent` will then render without filter touch. |
| 3.3 | DEV-gate all MOCK data in prod | `dashboard-incident-investigation.tsx`, `dashboard-risk-register.tsx`, `dashboard-employee-detail.tsx`, `dashboard-workforce-page.tsx`, `rrp-analytics-page.tsx` | Mirror the audit-log `import.meta.env.DEV` pattern. Customers should not see fake "Investigation #3" entries. |
| 3.4 | Workforce page Math.random() bug | `dashboard-workforce-page.tsx:128-129` | `lastCheckin` / `nextDue` jitter on every re-render. Derive from `getAttendanceRecords` instead. |
| 3.5 | Pricing page stale text | `dashboard-pricing-page.tsx:899, 931` | Drop "Stripe integration coming soon" copy — Stripe IS wired. |
| 3.6 | Settings page 6 placeholders | `dashboard-settings-page.tsx:188, 197, 660, 702, 949, 1078` | Replace `SUPABASE_MIGRATION_POINT` JSX with real reads or remove the section. |

Deliverable end of Wave 3: production-grade UI everywhere. No mock data visible to customers. All save buttons actually save.

### Wave 4 — Stripe + production hardening, week 4

| # | Task | Where | Time |
|---|---|---|---|
| 4.1 | KYC verification on Stripe | dashboard.stripe.com → Settings → Verification | 30 min + 1-3 days waiting |
| 4.2 | Bank payout setup (IBAN) | dashboard.stripe.com → Settings → Bank accounts | 5 min + 1-2 days bank confirm |
| 4.3 | VAT / Tax setup (15% KSA / 5% UAE) | dashboard.stripe.com → Tax | 15 min |
| 4.4 | Switch to Stripe LIVE mode | Vercel env vars: `VITE_STRIPE_PUBLISHABLE_KEY`, Supabase secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | 5 min |
| 4.5 | Test real $1 payment with personal card → refund | Test the live setup end-to-end | 5 min |
| 4.6 | Sentry DSN | sentry.io/signup → React project → Vercel env `VITE_SENTRY_DSN` | 10 min |
| 4.7 | 3 Supabase Auth settings | Confirm email ON, min password length 12, secure password change ON | 1 min |

Deliverable end of Wave 4: real money flows, monitoring is live, password security is reasonable.

### Wave 5 — Testing + beta, week 5

| # | Task |
|---|---|
| 5.1 | Run all source-pinning tests + tsc + vite build (Windows side) — must all pass |
| 5.2 | Manually run 8 smoke tests from PRE_LAUNCH_CHECKLIST.md §4 |
| 5.3 | Recruit 5-10 beta testers (friends/family). Give them a brief: "Try to break it" |
| 5.4 | Run Beehive Audit #7 on the now-fixed codebase (subagent) |
| 5.5 | Fix anything #7 finds |
| 5.6 | Final tsc + vite build + deploy to staging Vercel branch (`preview`) for 48h soak |

Deliverable end of Wave 5: a product that has been used by humans you trust, with no critical bugs reported.

### Wave 6 — Launch + mobile, week 6

| # | Task |
|---|---|
| 6.1 | Android APK build via Android Studio. Sign with your keystore. |
| 6.2 | Upload to Play Console "Internal Testing" track. Test on a real device. |
| 6.3 | Promote to "Closed Testing" with the 5-10 beta testers |
| 6.4 | After 14-day Play review, promote to Production |
| 6.5 | (Optional) Upgrade Supabase to Pro ($25/mo) → toggle HaveIBeenPwned ON |
| 6.6 | DPA + SCCs signed with legal counsel for B2B contracts |
| 6.7 | **Public launch** — flip the marketing site, post on social, email beta list |

---

## Total Stripe / Sentry / HIBP cost

- Stripe: 0 (no monthly fee, takes 2.9% + $0.30 per transaction)
- Sentry: $0 (free tier = 5k events/month, plenty)
- Supabase Pro: $25/month (only needed for HIBP — defer to month 2)
- Domain (if not done): ~$15/year

Total upfront: ~$0. Recurring: ~$25/month after month 2.

---

## What stays as-is (out of scope for v1)

- SAR Console live mode (training-only banner stays — real SAR needs Twilio bridge that ships v2)
- Tenant switching UI (`set_active_company` RPC ready, but no users have multi-company yet)
- Push to non-platform contacts (needs phone→user_id resolver — v2 feature)
- Custom branding (Enterprise tier feature — v2)
- AI Co-Admin (Business tier feature — v2)

These are documented as "Coming Soon" or removed from the marketing site.

---

## Daily rhythm

You're solo. Recommended:
- 4-6 hours focused dev per day
- 1-hour code review + commit message + git push at end of day
- 30-min beehive audit subagent run every Friday
- Weekend off (don't burn out)

Each Wave above is sized for ~5 work days. If a Wave runs over, that's fine — push the launch a week. **Do NOT cut corners** under time pressure. Every shortcut on a safety platform compounds into tomorrow's incident.

---

## Sign-off checklist before public launch

- [ ] All 6 BROKEN dashboards now read from real Supabase
- [ ] All 10 PARTIAL pages either fixed or DEV-gated
- [ ] Stripe LIVE mode + bank + KYC + VAT confirmed
- [ ] One real $1 test payment landed in your bank
- [ ] Sentry DSN in Vercel env, errors flowing
- [ ] 5+ beta testers ran a full SOS flow without issues
- [ ] Beehive Audit #7 passes with zero BROKEN findings
- [ ] Android APK live on Play internal testing
- [ ] Privacy + CCPA + GDPR pages reviewed by counsel
- [ ] Launched to: ____ ___, 2026 by ____

---

When you're ready, sit down with this document and we work through Wave 1, Day 1.
