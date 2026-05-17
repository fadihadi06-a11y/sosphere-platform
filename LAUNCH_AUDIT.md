# SOSphere Pre-Launch Audit — R-26 Findings

**Generated:** 2026-05-17 by R-26 (Layer 3 functional walkthroughs)
**Scope:** B2C civilian flow, B2B company flow, SOS pipeline, Billing state-machine
**Method:** 4 parallel deep-investigation agents, depth-first code trace, ~60 findings

---

## TL;DR — Top Pre-Launch Blockers (must fix before v1)

These are the **HIGH-severity** defects that will result in revenue loss, broken UX, or safety failures the moment a real customer arrives.

### Cluster A — Tier vocabulary fragmentation (root cause of ~6 HIGHs)

R-22 unified the Stripe catalog at the edge-function layer with `personal`. The rest of the codebase still uses three competing vocabularies:
- UI: `free | personal` (correct)
- Client utils: `free | pro | employee` (`mobile-app.tsx`)
- Server tier mapping: `free | basic | elite | <company tier>` (`sos-alert/index.ts:424`)

Every code path that bridges these vocabularies has a divergence bug. Specific cases below.

1. **HIGH — civilian Upgrade hits dead Stripe price**
   - `src/app/components/subscription-plans.tsx:101` hardcodes `planId: "elite"`.
   - Pricing page shows "Personal $4.99/mo" but the actual checkout request asks Stripe for legacy `elite`. Either HTTP 500 (price env unset) or wrong-amount charge.
   - **Root fix:** change to `planId: "personal"`.

2. **HIGH — paid Personal user runs free-tier SOS fanout**
   - `supabase/functions/sos-alert/index.ts:424` `mapTierString` does not include `"personal"`. Paid users fall through to `"free"` → 1 contact only, 45s call, no AI script.
   - **Root fix:** add `if (t === "personal") return "elite"` (or build a real shared tier model).

3. **HIGH — Personal subscriber stuck on Free in mobile app entitlement**
   - `src/app/components/utils/subscription-server.ts:48` `PRO_TIERS = new Set(["basic", "elite"])` — missing `"personal"`. After Stripe writes `tier="personal"`, the mobile app reads it back and downgrades to Free.
   - **Root fix:** add `"personal"` to `PRO_TIERS`.

4. **HIGH — civilian Personal-trial RPC rejects the only paid plan**
   - `supabase/migrations/20260428100000_crit12_civilian_trial_history_rpc.sql:94` accepts only `'elite'`/`'basic'` for `start_civilian_trial`. The marketed "7-day Personal trial" cannot start.
   - **Root fix:** update RPC IN-list to include `'personal'`.

5. **HIGH — Personal price not in `PAID_PLANS` set**
   - `src/app/components/stripe-service.ts:149` `PAID_PLANS` excludes `personal`. Toggling to Personal in `dashboard-billing-page` bypasses Stripe entirely (writes localStorage as if paid).
   - **Root fix:** add `"personal"` to `PAID_PLANS` and `StripePlanId` union.

6. **HIGH — Personal/Elite features ungated**
   - `src/app/components/family-circle.tsx` rendered for ALL civilians, no tier gate.
   - `src/app/components/fall-detection.tsx:62` accepts `enabled` prop with no tier check.
   - `safe-walk-mode.tsx:75` accepts `isPro` from parent — internal `hasFeature("walkMe")` check absent.
   - Marketing claims these are Personal-only.
   - **Root fix:** wrap each with `hasFeature("X")` check inside the component itself, not at parent navigation.

### Cluster B — Security / privilege escalation

7. **HIGH — `accept_invitation` role injection**
   - `supabase/migrations/20260430040000_blocker_a_accept_invitation_rpc.sql:34` uses `COALESCE(v_invitation.role, 'employee')` with no whitelist. The wizard's "role" is a free-text job title field (`company-register.tsx:1431`), so any owner who CSV-imports a row with `role='admin'` or `role='owner'` grants admin/owner at acceptance.
   - **Root fix:** whitelist `role IN ('admin','member','employee')` server-side; default to `'employee'` otherwise.

8. **HIGH — `dashboard-actions` no role check**
   - `supabase/functions/dashboard-actions/index.ts:90-104` requires only "active member". Any junior employee can `resolve`, `acknowledge`, `assign`, `broadcast`, `forward_to_owner`. Combined with #7, escalation → full SOS lifecycle control.
   - **Root fix:** add `is_company_admin_or_owner_v2(callerCompanyId)` check before action switch.

9. **HIGH — DPA bypass via direct Stripe checkout**
   - `stripe-checkout/index.ts` does NOT verify DPA acceptance before creating the Stripe session. R-19 #16 closed the webhook-side but a customer's card is charged + funds held even if DPA was never signed.
   - **Root fix:** add `dpa_accepted` check in stripe-checkout returning HTTP 412 if missing.

### Cluster C — UX / revenue truthfulness

10. **HIGH — fake "Card •••• 4242" displayed to real users**
    - `src/app/components/dashboard-billing-page.tsx:519,520,898,901` hardcodes Stripe test-card numbers as if they were the customer's saved card. Embarrassing on a paid Customer Rights screen.
    - **Root fix:** remove the entire legacy Payment Method block; LiveBillingPanel's "Manage payment" button is the correct surface.

11. **HIGH — fake "Next renewal: Apr 1, 2026" displayed**
    - `dashboard-billing-page.tsx:451,729` hardcoded — wrong date for every customer.
    - **Root fix:** read from `state.currentPeriodEnd` (LiveBillingPanel:191 already does this correctly).

12. **HIGH — add-on toggles fake (revenue + feature integrity)**
    - `dashboard-billing-page.tsx:181-195` "Enable Advanced GPS" writes to localStorage only. UI adds `+$39/mo` to total. ZERO Stripe call. Customer thinks they're billed; they're not. Worse: any future PR wiring GPS frequency to localStorage grants premium GPS to everyone.
    - **Root fix:** disable / hide the entire add-ons section for v1 launch. Per R-22 commit: "out of scope for v1".

13. **HIGH — `charge.refunded` not handled in webhook**
    - Refund from Stripe Dashboard does NOT cancel the subscription. Customer keeps Elite features after getting their money back.
    - **Root fix:** handle `charge.refunded` event.

14. **HIGH — no automatic trial → inactive transition**
    - `start_company_trial` runs without Stripe involvement. If owner never adds a card, `status='trialing'` persists in DB forever. `get_my_subscription_tier` returns `trialing` → full Elite features perpetually free.
    - **Root fix:** pg_cron nightly: `UPDATE subscriptions SET status='inactive' WHERE status='trialing' AND trial_ends_at<now() AND stripe_subscription_id IS NULL`.

### Cluster D — Safety-critical (SOS pipeline)

15. **HIGH — Personal/employer cascade first-match, not max-tier**
    - `sos-alert/index.ts:488-541` returns the first matching tier. An employee whose Personal-Family plan is "basic" but who works for a Business-plan company will dispatch under Basic terms, not Business.
    - **Root fix:** compute `max(personalTier, companyTier)` (rank: `free < basic < elite`).

16. **HIGH — no Twilio breaker integration in sos-alert**
    - `sos-alert/index.ts:274-349` directly POSTs to Twilio without `checkBreaker`/`recordBreaker`. If Twilio is degraded, every fanout burns 8s/leg and reports null SIDs but the breaker stays closed (no failures recorded).
    - **Root fix:** wrap each twilioCall/twilioSMS in checkBreaker + recordBreaker; on `allow=false`, write `outcome="breaker_open"`.

17. **HIGH — dispatch ledger writes not retried**
    - `record_sos_dispatch_attempt` RPCs (`sos-alert:1760-1804`) lack `withDbRetry`. Single 200ms PG blip = forensic ledger gap.
    - **Root fix:** wrap in `withDbRetry({ maxAttempts: 2 })`.

18. **HIGH — Press-1 bridge accept not in audit chain**
    - `sos-bridge-twiml/index.ts:243-299` (the moment a contact accepts and joins the bridge with the user) writes `bridge_dialed_at` to the session row but does NOT call `log_sos_audit`. The L2-D chain has a gap exactly at the highest-value forensic event.
    - **Root fix:** add `log_sos_audit({action: "bridge_accepted", target: emergencyId})` after `claimBridgeDial` succeeds.

19. **HIGH — Inbound SMS reply 1-hour window**
    - `sos-sms-inbound/index.ts:213` only matches sessions started in the last 1 hour. A contact arriving on-scene 70 min later texts "I'm here" → UNMATCHED, broadcast goes to no one.
    - **Root fix:** extend window to 6h.

20. **HIGH — UNMATCHED inbound replies unreadable by admins**
    - `migrations/20260510210000_l2f_sos_sms_replies.sql:93-114` SELECT policy requires `company_id IS NOT NULL`. UNMATCHED rows have NULL → unreadable except service_role. The security team is supposed to see them.
    - **Root fix:** add third policy: rows with NULL company_id+user_id readable by `super_admin` / `audit_viewer` role.

21. **HIGH — Personal subscription race vs first SOS**
    - Between `checkout.session.completed` webhook arrival and the subscription row write, a user's first SOS reads `tier="free"`. Paid customer's first emergency is dispatched at Free quality.
    - **Root fix:** when an in-flight `processed_stripe_events` for this user exists in last 60s, treat as paid; or wait+retry the tier read once.

22. **HIGH — Free-tier user with zero contacts blocked**
    - `sos-emergency.tsx:3146` blocks SOS to launch a "add a contact" form when contacts.length === 0. In a real emergency this can cost 30+ seconds. No fallback to local 911.
    - **Root fix:** if `contacts.length === 0`, immediately `tel:` to local emergency number; do NOT block SOS pipeline.

23. **HIGH — Two company-resolution paths diverge**
    - `sos-alert/index.ts:2170-2202` uses `profiles.active_company_id` only; lines 1942-1968 fall back to `employees.company_id`. If active_company_id is stale/null but employees row exists: dashboard broadcast goes to civilian channel that no admin subscribes to, while owners DO get push.
    - **Root fix:** resolve `effectiveCompanyId` once at top of trigger, stamp `sos_sessions.company_id = <resolved>` on UPSERT, reuse everywhere.

### Cluster E — B2B-specific blockers

24. **HIGH — DPA/invite race**
    - `company-register.tsx:1531-1554` queues bulk-invite emails BEFORE `accept_company_dpa` (line 1574-1599) runs. DPA failure leaves invitations sent to thousands of employees for an unsigned-DPA company.
    - **Root fix:** call `accept_company_dpa` + `start_company_trial` BEFORE `enqueue_job`.

25. **HIGH — invite code length mismatch**
    - `company-register.tsx:206-211` generates 8-char invite codes; `company-join.tsx:25` only accepts 6 chars. Word-of-mouth code sharing fails.
    - **Root fix:** unify code length to 8 chars in company-join.

---

## Full Findings — by Functional Area

### B2C Civilian Flow
- **HIGH:** items #1, #2, #3, #6 above
- **HIGH:** `login-phone.tsx:61` — Forgot password throws ReferenceError (supabase not imported at top)
- **HIGH:** free-tier "3 SOS/month" advertised but server enforces only `perHour: 1, perDay: 3` (90/month possible)
- **HIGH:** `pricing.ts` says free `maxContacts: 3` but server clamps to 1 → 2 contacts silently never reached
- **HIGH:** `safe-walk-mode.tsx:75` accepts `isPro` from parent, no internal gate
- **HIGH:** `fall-detection.tsx:62` accepts `enabled` prop, no tier check
- **MEDIUM:** `login-phone.tsx:143-151` Google OAuth errors swallowed silently
- **MEDIUM:** `welcome-activation.tsx:108-115` non-employee recovery handled awkwardly
- **MEDIUM:** `subscription-plans.tsx:165` employees can't manage their personal billing
- **MEDIUM:** `subscription-plans.tsx:28-42` upgrade screen feature comparison contradicts pricing.ts
- **MEDIUM:** `trial-service.ts:35-37,212` hardcodes `tier: "elite"` for trial start (will fail server-side after fix #4)
- **MEDIUM:** `mobile-app.tsx:2063,2147` toast copy uses "Basic"/"Elite" which don't exist in pricing.ts
- **MEDIUM:** `sos-emergency.tsx` client-side `sosRateHistory` is module-level in-memory (resets on reload)
- **MEDIUM:** `fall-detection.tsx:175` `simulateFall` countdown timer not cleaned up on toggle-off (mid-window leak)
- **MEDIUM:** "Simulate Fall (Test)" button triggers REAL SOS dispatch — no `dryRun` flag

### B2B Company Flow
- **HIGH:** items #7, #8, #9, #24, #25 above
- **HIGH:** `invite-employees/index.ts:140` ownership check uses deprecated `owner_id`
- **HIGH:** `process-bulk-invite/index.ts:261-263` "already exists" misreported as "sent"
- **MEDIUM:** `enqueue_job` reads `companies.plan` (frozen at 'starter' during trial) for seat math → Growth trial owners capped at 25 seats
- **MEDIUM:** `dashboard-actions/index.ts:107-116` no state-machine guard on acknowledge/resolve — race overwrites
- **MEDIUM:** `dashboard-actions/index.ts:111` OR filter built by string concatenation (re-entry risk if validation loosens)
- **MEDIUM:** `dashboard-actions/index.ts:204-272` broadcast joins on zone_id OR department (collision risk for shared names)
- **MEDIUM:** trial duration RPC accepts 1-30 days — owner can extend to 30 directly
- **MEDIUM:** bulk-invite worker re-sends emails on chunk-mid-failure retry (`processed` count not per-row)
- **MEDIUM:** `accept_invitation` re-acceptance overwrites role with whatever invitation says (role-downgrade-via-reinvite)
- **MEDIUM:** TrialBanner promises "data deleted in N days" but no cron exists for company-trial-end deletion
- **LOW:** `company-dashboard.tsx:170-174` `generateEmergencyId` uses Math.random (collision-possible under high load)
- **LOW:** `dashboard-actions/index.ts:155-163` audit row hardcodes `actor_level: "dispatcher"` regardless of caller's actual role

### SOS Pipeline (safety-critical)
- **HIGH:** items #15, #16, #17, #18, #19, #20, #21, #22, #23 above
- **HIGH:** rate-limit RPC failure returns 503 with no SMS fallback (`sos-alert:1238-1322`)
- **HIGH:** ambiguous inbound — one phone on two SOS contact lists → first-match-wins, broadcast to wrong emergency
- **MEDIUM:** `sos-alert:1190-1194` empty contacts → 400 with no audit row (emergency effectively unrecorded)
- **MEDIUM:** auth failure during SOS gives no audit row (`sos-alert:1086-1099`)
- **MEDIUM:** `sos-alert:1543-1555` invalid_number contacts indistinguishable from "voicemail" in delivery summary
- **MEDIUM:** `twilio-status.ts:501-651` retry call suppressed if session ended → no SMS fallback either
- **MEDIUM:** retries hardcoded to 2 across all tiers — Free pays 2x cost for marginal benefit; no escalation to next contact on exhaustion
- **MEDIUM:** 20s race timeout swallows successful-but-slow Twilio calls (writes `outcome="failed"` while contact actually rings)
- **MEDIUM:** `sos-alert:976-1041` END flips status before evidence upload completes — depends on client timing
- **MEDIUM:** `sos-alert:1265-1282` rate-limit-fail audit row written with NULL company_id (invisible to dashboard)
- **MEDIUM:** `notify_emergency()` trigger captured in R-24 but functionally dead — function does NOT pg_notify (R-24 comment misleading)
- **LOW:** isolate-lifetime: `setTimeout(removeChannel, ...)` after response return — server-side channel leaks
- **LOW:** Realtime debounce: phase-churn during SOS retry causes rapid sub/unsub cycles

### Billing State-Machine
- **HIGH:** items #1, #5, #9, #10, #11, #12, #13, #14 above
- **HIGH:** `customer.subscription.paused/resumed` not handled — paused subscription user keeps paid features OR gets denied service permanently
- **HIGH:** `dashboard-billing-page.tsx:148-156` `switchPlan` doesn't thread companyId for B2B owners → routes to civilian webhook path
- **HIGH:** multi-company owner: portal/checkout looks up `first` row, doesn't disambiguate by `safeCompanyId` AND `is null` on user_id
- **HIGH:** legacy `dashboard-billing-page` "Current Plan" hero + Invoice History + Payment Method all show `companyState` from localStorage, NOT live server state
- **MEDIUM:** reactivation after cancel — `start_company_trial` returns 'already_used' for cancelled rows; UI has no "Re-subscribe" path
- **MEDIUM:** `invoice.upcoming` event not consumed (no in-app renewal notice banner)
- **MEDIUM:** `customer.updated` event not consumed (cached email drifts)
- **MEDIUM:** `customer.deleted` followed by late `subscription.deleted` becomes no-op (audit row suppressed)
- **MEDIUM:** `trial_ending_notified_at` column stamped but never consumed (dead code)
- **MEDIUM:** hardcoded invoice IDs `INV-2026-001/002/003` in legacy UI
- **MEDIUM:** Stripe Customer Rights advertises "7-day advance renewal notice" but no `invoice.upcoming` consumption to enforce
- **MEDIUM:** add-on prices in `pricing.ts:174-178` are display-only with no Stripe mapping or "Coming soon" label
- **LOW:** idempotency-key bucket is per-UTC-day — midnight boundary creates duplicate sessions during retry storm
- **LOW:** unknown webhook event types silently no-op without ops_alert row

---

## Triage Summary (R-27 starting point)

**Launch-blocker count by severity:**
- HIGH: 39 findings (must fix before v1 launch)
- MEDIUM: 30 findings (should fix; some can defer with explicit risk-accept)
- LOW: 7 findings (polish; defer)

**Top 3 root-cause clusters that resolve the most HIGHs at once:**

1. **Unify the tier-model** (resolves: #1, #2, #3, #4, #5, #6, #11 effects, #15, #21) — single shared `_shared/tier-model.ts` + `src/app/components/utils/tier-model.ts` that both checkout, webhook, sos-alert, mobile-app, and dashboard import. Add `personal` everywhere; deprecate the `pro|basic|elite` legacy names with explicit migration.

2. **Lock the role-injection chain** (resolves: #7, #8) — whitelist `role` values in `accept_invitation` + add admin/owner check to `dashboard-actions` request handler.

3. **Strip the localStorage legacy billing UI** (resolves: #10, #11, #12 + several MEDIUMs) — delete the entire `dashboard-billing-page.tsx:419-902` legacy block; route everything through LiveBillingPanel which already reads server state correctly.

**Estimated effort to ship v1:** ~15-20 hours of focused work to fix all 39 HIGHs.

---

*This document is auto-generated. See R-27 task for the next layer (defect triage + sequential fix order).*
