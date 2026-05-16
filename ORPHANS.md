# ORPHANS — Connectivity Scan Results

**Generated:** 2026-05-16
**Method:** Multi-pattern grep across `src/`, `supabase/functions/`, `supabase/migrations/`, `.github/workflows/`. Each surface checked against at least 3 patterns before being declared an orphan. False-positive guardrail: items with tests but no production caller are classed TEST-ONLY (separate from ORPHAN).

---

## A. Edge Functions (28)

| Function | src fetch | invoke() | GHA cron | DB/edge ref | Status |
|---|---|---|---|---|---|
| sos-alert | 1 (`sos-server-trigger.ts:38`) | 0 | indirect (R-4 dispatch probe) | – | CONNECTED |
| sos-health | 0 | 0 | 0 | – | TEST-ONLY (external uptime monitor by design) |
| sos-sms-inbound | 0 | 0 | indirect (sos-inbound-probe) | Twilio webhook | CONNECTED |
| sos-bridge-twiml | 0 | 0 | 0 | twilio-status.ts:559–566, twilio-config-fix | CONNECTED (Twilio voice TwiML) |
| twilio-call | 1 invoke (`admin-incoming-call.tsx:561`) | 1 | 0 | – | CONNECTED |
| twilio-sms | rls-policies.ts (doc) | 0 | 0 | called by sos-alert | CONNECTED |
| twilio-status | rls-policies.ts (doc) | 0 | 0 | Twilio status callback | CONNECTED |
| twilio-token | rls-policies.ts (doc) | 0 | 0 | Twilio voice SDK | CONNECTED |
| twilio-config-fix | 0 | 0 | 0 (manual RUNBOOK) | – | ON-DEMAND (RUNBOOK §227) |
| stripe-checkout | 1 fetch (`stripe-service.ts:25`) + 1 invoke (`subscription-plans.tsx:99`) | 1 | 0 | – | CONNECTED |
| stripe-portal | 1 fetch (`stripe-service.ts:26`) | 0 | 0 | – | CONNECTED |
| stripe-webhook | 0 | 0 | 0 | Stripe webhook (config.toml verify_jwt=false) | CONNECTED |
| dashboard-actions | 1 invoke (`api/dashboard-actions-client.ts:54`) | 1 | 0 | – | CONNECTED |
| delete-account | 1 fetch (`settings-screens.tsx:270`) | 0 | 0 | – | CONNECTED |
| export-my-data | 1 invoke (`privacy-page.tsx:72`) | 1 | 0 | – | CONNECTED |
| incident-history | 1 invoke (`incident-history.tsx:222`) | 1 | 0 | – | CONNECTED |
| incident-report-data | 1 invoke (`incident-history.tsx:287`) | 1 | 0 | – | CONNECTED |
| invite-employees | 1 fetch (`employees-unified-page.tsx:665`) | 0 | 0 | – | CONNECTED |
| process-bulk-invite | 0 | 0 | 0 | pg_cron via `trigger_bulk_invite_worker` (migration 20260503172156) | CONNECTED (pg_cron) |
| send-invitations | 0 | 0 | 0 | called by `invite-employees`/`process-bulk-invite` (RUNBOOK §330) | CONNECTED (internal) |
| send-push-notification | 0 | 0 | 0 | called from `sos-alert/index.ts:1876, 2019` | CONNECTED (internal) |
| forgery-probe | 0 | 0 | YES (probes.yml:161, every 15 min) | – | CONNECTED (cron) |
| sos-dispatch-probe | 0 | 0 | YES (probes.yml:201, every 6h) | – | CONNECTED (cron) |
| sos-inbound-probe | 0 | 0 | YES (probes.yml:93, every 15 min) | – | CONNECTED (cron) |
| twilio-config-probe | 0 | 0 | YES (probes.yml:123, every 15 min) | – | CONNECTED (cron) |
| sos-load-probe | 0 | 0 | 0 (workflow_dispatch only) | – | ON-DEMAND (config.toml:90 — by design) |
| stripe-webhook-test-probe | 0 | 0 | 0 (manual) | – | ON-DEMAND (R-19 Phase 5) |
| stripe-e2e-test-probe | 0 | 0 | 0 (manual) | – | ON-DEMAND (R-19 #18) |
| stripe-e2e-stress-probe | 0 | 0 | 0 (manual) | – | ON-DEMAND (R-19 #22) |

### A.1 Edge Function Orphans (deep evidence)
**None.** Every function has an entry point (direct fetch, `.invoke()`, scheduled probe, Twilio/Stripe webhook, pg_cron, internal edge-to-edge call, or explicit ON-DEMAND/RUNBOOK design). The four on-demand probes (`sos-load-probe`, `stripe-*-probe` ×3, `twilio-config-fix`) are intentionally not wired to cron — they are operator-triggered (LAUNCH_INVENTORY §4F + RUNBOOK).

---

## B. Web Routes (17)

| Route | Linked from | navigate() | window.location | Stripe URL | Status |
|---|---|---|---|---|---|
| `/` | router root | – | – | – | CONNECTED |
| `/app` | `welcome-activation.tsx:423,465,487` (href) | `deep-link-handlers.tsx:142,167` | – | – | CONNECTED |
| `/dashboard` | – | `landing-page.tsx:139,140`, `training-center.tsx:929`, `wow-demo.tsx:1026`, `deep-link-handlers.tsx:73,102,209` | `live-billing-panel.tsx:238` | – | CONNECTED |
| `/welcome` | `employees-unified-page.tsx:683` (redirect_to), `login-phone.tsx:62` (redirectTo) | – | `landing-page.tsx:176` | – | CONNECTED |
| `/demo` | – | `landing-page.tsx:309,512`, `dashboard-web-page.tsx:1669`, `training-center.tsx:935` | – | – | CONNECTED |
| `/training` | `company-dashboard.tsx:1846, 2452` (window.open) | `training-center.tsx:929` | – | – | CONNECTED |
| `/dev/stress-test` | `routes.ts:35` (DEV-only) | 0 | 0 | – | DEV-ONLY (by design) |
| `/privacy` | – | 0 | 0 | – | **ORPHAN candidate** |
| `/terms` | – | 0 | 0 | – | **ORPHAN candidate** |
| `/legal/dpa` | `company-register.tsx:1184`, `dpa-settings-section.tsx:187,341,346` (href) | – | – | – | CONNECTED |
| `/compliance` | – | 0 | 0 | – | **ORPHAN candidate** (hidden auditor route by design — `routes.ts:44`) |
| `/auth/callback` | Android intent-filter + Supabase OAuth | – | – | – | CONNECTED (external) |
| `/reset-password` | Android intent-filter, recovery link | – | – | – | CONNECTED (external) |
| `/payment-success` | Stripe `success_url` (`stripe-checkout/index.ts:244`) + Android intent | – | – | YES | CONNECTED |
| `/payment-cancelled` | Stripe `cancel_url` (`stripe-checkout/index.ts:245`) + Android intent | – | – | YES | CONNECTED |
| `/shared-sos/:emergencyId` | SOS share-link notifications (Android intent) | – | – | – | CONNECTED (external) |
| `*` (NotFound) | router catchall | – | – | – | CONNECTED |

### B.1 Web Route Orphans (deep evidence)
- **`/privacy`** — searched for `to="/privacy"`, `navigate("/privacy")`, `href="/privacy"`, `window.location.*"/privacy"` — **zero hits in `src/` outside `routes.ts:38`**. The `PrivacyPage` component IS used as an in-app overlay via `login-phone.tsx:153–154`, but the **standalone web route is unreachable from any in-product link**. Same content is reached via the modal, so the route is a public deep-link "back-door" only.
- **`/terms`** — same pattern. `TermsPage` is used as overlay in `login-phone.tsx:153`, but no link, navigate, or href targets `/terms` anywhere in `src/`. Settings screen even points to **external** `https://sosphere.app/legal/terms` (`settings-screens.tsx:485`) instead of the in-app route.
- **`/compliance`** — `routes.ts:44` comment says "Hidden ISO 27001 Auditor Dashboard". `compliance-dashboard-v2.tsx:4` is a placeholder (not the original live dashboard). No link. Confirmed **intentional hidden route**, but worth noting it's only useful if auditors are told the URL out-of-band.

Net: 0 unintentional route orphans. Three routes (`/privacy`, `/terms`, `/compliance`) are reachable only by typing the URL — `/privacy` + `/terms` are MEDIUM-confidence: same UX exists in-app modal, but legal best-practice is to link them in footers.

---

## C. Web Page Components (24)

All 19 dashboard pages import-verified in `company-dashboard.tsx` (lines 41–139) via `lazy(() => import(...))` or in `dashboard-comms-hub.tsx`/`dashboard-location-page.tsx`/`dashboard-workforce-page.tsx`.

| Page | Import site | Status |
|---|---|---|
| dashboard-web-page | `routes.ts:29` | CONNECTED |
| dashboard-analytics-page | `company-dashboard.tsx:49` | CONNECTED |
| dashboard-audit-log-page | `company-dashboard.tsx:77` | CONNECTED |
| dashboard-billing-page | `company-dashboard.tsx:43` | CONNECTED |
| dashboard-evacuation-page | `dashboard-comms-hub.tsx:9` | CONNECTED |
| dashboard-geofencing-page | `dashboard-location-page.tsx:9` | CONNECTED |
| dashboard-jobs-page | `company-dashboard.tsx:63` | CONNECTED |
| dashboard-leaderboard-page | `company-dashboard.tsx:129` | CONNECTED |
| dashboard-location-page | `company-dashboard.tsx:67` | CONNECTED |
| dashboard-offline-page | `company-dashboard.tsx:135` | CONNECTED |
| dashboard-pipeline-health-page | `company-dashboard.tsx:78` | CONNECTED |
| dashboard-pricing-page | `company-dashboard.tsx:42` | CONNECTED |
| dashboard-roles-page | `company-dashboard.tsx:74` | CONNECTED |
| dashboard-sar-page | `company-dashboard.tsx:139` | CONNECTED |
| dashboard-settings-page | `company-dashboard.tsx:41` | CONNECTED |
| dashboard-shift-scheduling-page | `dashboard-workforce-page.tsx:10` | CONNECTED |
| dashboard-workforce-page | `company-dashboard.tsx:68` | CONNECTED |
| employees-unified-page | `company-dashboard.tsx:62` | CONNECTED |
| rrp-analytics-page | `company-dashboard.tsx:133` | CONNECTED |
| landing-page | `routes.ts:3` | CONNECTED |
| privacy-page | `routes.ts:38` + `login-phone.tsx:2` | CONNECTED |
| terms-page | `routes.ts:39` + `login-phone.tsx:1` | CONNECTED |
| dpa-page | `routes.ts:43` | CONNECTED |
| not-found-page | `routes.ts:56` (catchall) | CONNECTED |

**0 orphan page components.**

---

## D. Stripe Prices (13 env vars)

Both readers use **dynamic key construction** — not a static env-var grep target:
- `stripe-checkout/index.ts:73` → `STRIPE_PRICE_${plan.toUpperCase()}_${cycle.toUpperCase()}`
- `stripe-webhook/index.ts:267–276` → iterates `["starter","growth","business","enterprise","basic","elite"] × ["monthly","annual"]`

| Env var | Producer (`stripe-test-setup.mjs`) | Consumer (`stripe-webhook` iteration) | Status |
|---|---|---|---|
| STRIPE_PRICE_STARTER_MONTHLY/ANNUAL | YES (line 138) | YES (starter in plans[]) | CONNECTED |
| STRIPE_PRICE_GROWTH_MONTHLY/ANNUAL | YES | YES | CONNECTED |
| STRIPE_PRICE_BUSINESS_MONTHLY/ANNUAL | YES | YES | CONNECTED |
| STRIPE_PRICE_PERSONAL_MONTHLY/ANNUAL | YES (line 148) | **NO** (plans[] lacks "personal" — only basic, elite) | **WRITE-ONLY → silent map-fail** |
| STRIPE_PRICE_ADDON_EXTRA_REPORTS_MONTHLY | YES (line 157) | **NO** (addon plans not in iteration) | **WRITE-ONLY** |
| STRIPE_PRICE_ADDON_TWILIO_SMS_MONTHLY | YES | NO | **WRITE-ONLY** |
| STRIPE_PRICE_ADDON_EXTRA_ZONES_MONTHLY | YES | NO | **WRITE-ONLY** |
| STRIPE_PRICE_ADDON_ADVANCED_GPS_MONTHLY | YES | NO | **WRITE-ONLY** |
| STRIPE_PRICE_ADDON_CUSTOM_BRANDING_MONTHLY | YES | NO | **WRITE-ONLY** |

### D.1 HIGH-impact finding
`stripe-test-setup.mjs` creates **STRIPE_PRICE_PERSONAL_*** and 5 **ADDON** env vars and instructs the operator to set them as Supabase secrets. But `stripe-webhook/index.ts:269` iterates only `["starter","growth","business","enterprise","basic","elite"]` — `"personal"` and `"addon_*"` are **never in the lookup loop**. Result:
- A paying Personal-plan civilian customer's `price_id` will fail `lookupPlanByPriceEnv()` → routed to `stripe_unmapped_events` (per B-13 design) → subscription never recorded → user stays on Free tier despite paying.
- Same for any add-on purchase.

This contradicts LAUNCH_INVENTORY §9 which lists Personal + 5 add-ons as part of the test-mode price catalog.

---

## E. Sample RPCs (20 high-value)

| RPC | JS callers | Edge function callers | SQL trigger | Status |
|---|---|---|---|---|
| start_company_trial | `company-register.tsx:1585` | – | – | CONNECTED |
| start_civilian_trial | `trial-service.ts:211` | – | – | CONNECTED |
| accept_company_dpa | `company-register.tsx:1575` | – | – | CONNECTED |
| get_my_subscription_tier | `mobile-app.tsx:786, 1038` | – | – | CONNECTED |
| log_sos_audit | `dashboard-sar-page.tsx:632`, `sos-emergency.tsx:1615` | 10+ edge functions | – | CONNECTED |
| request_sar_export | – | `export-my-data:228` | – | CONNECTED |
| complete_sar_export | – | `export-my-data:393` | – | CONNECTED |
| record_sos_pipeline_started | – | `sos-alert:1145` | – | CONNECTED |
| register_company_full | `company-register.tsx:1438` | – | – | CONNECTED |
| create_company_v (typo in inventory; real = `create_company_v2`) | `company-register.tsx:1453` | – | – | CONNECTED |
| mfa_generate_recovery_codes | `api/mfa-client.ts:213` | – | – | CONNECTED |
| twilio_breaker_check | – | `_shared/twilio-breaker.ts:52` | – | CONNECTED |
| enqueue_job | `company-register.tsx:1534` | – | – | CONNECTED |
| record_sensor_event | `fall-detection.tsx:40` | – | – | CONNECTED |
| upsert_geofence | `dashboard-geofencing-page.tsx:66` | – | – | CONNECTED |
| delete_user_completely | – | `delete-account:241` | – | CONNECTED |
| **verify_audit_chain** | 0 (tests only) | 0 | – | **ORPHAN candidate** |
| **verify_admin_pin** | 0 | 0 | – | **ORPHAN candidate** |
| **get_active_emergency** | 0 | 0 | – | **ORPHAN candidate** |
| **notify_emergency** | n/a (trigger function) | n/a | **NO `CREATE TRIGGER … notify_emergency` found** in current migrations | MEDIUM — function still grants `search_path`, but no live trigger reference in repo |

### E.1 RPC Orphans (deep evidence)
- **verify_audit_chain** — searched `\.rpc("verify_audit_chain"` and bare references across `src/` and `supabase/functions/`. Only 3 hits, all in `src/app/components/__tests__/`. The RPC is granted to `authenticated` (migration `20260509171843`) and the placeholder `compliance-dashboard-v2.tsx:4` notes "the original live compliance dashboard" was removed. This is the L2-D audit-chain verifier — it should be wired into the compliance dashboard or an admin diagnostic. Currently TEST-ONLY.
- **verify_admin_pin** — searched all of `src/`. Only `test-crit-batch-consolidated-fixes.mjs` (a synthetic test) references it. No production caller. Paired RPC `set_admin_pin` should be checked similarly (not in scope here).
- **get_active_emergency** — `REVOKE…FROM PUBLIC, anon, authenticated; GRANT…TO authenticated` (migration `20260425200000` line 62). 0 callers anywhere in `src/`, `supabase/functions/`, or scripts. Dead RPC.
- **notify_emergency** — function body expects `NEW.user_id, NEW.type, NEW.lat, NEW.lon`, clearly a trigger function on `public.emergencies`. Repo contains the function definition (`20260426180000_w3_9b_notify_emergency_schema_fix.sql`) but **no `CREATE TRIGGER … EXECUTE FUNCTION notify_emergency`** in any current migration. The trigger may exist live in production from a pre-repo migration that wasn't checked in, or may have been dropped. **Confirm in production with** `SELECT tgname FROM pg_trigger WHERE tgfoid = 'public.notify_emergency'::regproc;`

---

## SUMMARY

- Total surfaces scanned: **82** (28 edge fns + 17 routes + 24 pages + 13 prices + 20 RPCs — inventory lists 90 RPCs, 20 sampled)
- Connected: **69**
- Orphan candidates: **13** (3 routes intentional + 4 on-demand probes + 6 high-impact below)
- High-confidence orphans (safe to delete or wire): **3** RPCs (`verify_audit_chain`, `verify_admin_pin`, `get_active_emergency`)
- Medium confidence (needs deeper look): **7** — 6 unread Stripe price env-vars (PERSONAL + 5 ADDONS), 1 dormant trigger function (`notify_emergency`)
- Low-priority cosmetic: **3** routes (`/privacy`, `/terms`, `/compliance`) not linked in product nav

---

## RECOMMENDATIONS (sorted by impact)

1. **[HIGH — REVENUE BUG]** Fix `stripe-webhook/index.ts:269` to include `"personal"` and all 5 addon plans in the lookup iteration. **Without this, every Personal subscription and every add-on purchase falls into `stripe_unmapped_events` and the customer never gets entitlement.** Also unify `lookupPlanByPriceEnv` so addons (which use plan IDs like `addon_extra_reports`) are recognised. Confirms LAUNCH_INVENTORY §9 (13 prices) vs production-reachable plans (only 6 = starter/growth/business × monthly/annual + basic/elite if those exist).
2. **[HIGH — COMPLIANCE]** Wire `verify_audit_chain` into the `/compliance` dashboard (currently a placeholder at `compliance-dashboard-v2.tsx:4`). L2-D hash-chain verification is a core ISO 27001 evidence feature; shipping it dark defeats the purpose. Add a `<button onClick={() => supabase.rpc("verify_audit_chain", { p_company_id })}>` panel — RPC is already granted to `authenticated`.
3. **[MEDIUM — DEAD CODE]** `get_active_emergency(uuid)` RPC has zero callers. Either drop it (migration) or document its intended consumer. Same for `verify_admin_pin(text)` if `set_admin_pin` is also unused — investigate as a pair.
4. **[MEDIUM — TRIGGER AUDIT]** Run `SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgfoid = 'public.notify_emergency'::regproc;` against production. If empty, the function is dead and should be dropped. If a trigger exists, add an explicit `CREATE TRIGGER` migration to capture it in repo (currently a drift gap — function in git, trigger only in live DB).
5. **[LOW — UX]** Add footer links to `/privacy` and `/terms` from `landing-page.tsx` and the mobile app footer. Currently users can only see these via the in-app overlays in `login-phone.tsx`, which a returning user never traverses. Web crawlers (SEO + legal due-diligence) also need direct links. Note: `settings-screens.tsx:485` links to external `https://sosphere.app/legal/terms` — point this at the local `/terms` route or vice-versa.
6. **[LOW — DOC]** Inventory entry "`create_company_v`" in `LAUNCH_INVENTORY.md:273` is a typo; production RPC is `create_company_v2`. Fix the inventory.
7. **[LOW — ROUTE]** `/compliance` route is intentionally hidden but the component is a placeholder. Either restore the original live compliance dashboard (referenced in `compliance-dashboard-v2.tsx:4` comment) or remove the route until it's ready.
