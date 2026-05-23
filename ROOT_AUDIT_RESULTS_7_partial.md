# SOSphere — Root Audit Results, Wave 7 (PARTIAL — D2 + D5 only)

**Audit date:** 2026-05-22 (late)
**Status:** PARTIAL — 2 of 5 agents completed before session limit reset
**Method:** 5 dedicated subagents (D1-D5) launched in parallel for line-by-line read of the remaining 159 files in src/. Three agents (D1 api/, D3 ui/, D4 components-half-1) hit the session limit before producing output. D2 and D5 returned full reports.

---

## Coverage in this partial file

| Batch | Files | Status | Defects |
|---|---:|---|---:|
| D1 api/ (Supabase/Stripe/Twilio/FCM/MFA/RLS — **THE BACKBONE**) | 23 | ❌ **NOT READ** | TBD |
| D2 utils/+stores/+workers/+hooks/+app root | 20 | ✅ Complete | **119** |
| D3 ui/ shadcn primitives | 48 | ❌ **NOT READ** | TBD |
| D4 main components, half 1 | 35 | ❌ **NOT READ** | TBD |
| D5 main components, half 2 | 33 | ✅ Complete | **105** |
| **TOTAL THIS FILE** | **53 of 159 (33%)** | | **224** |

**Re-runs needed:** D1, D3, D4 — to be re-launched once session resets. Until then, this file holds the only line-read coverage we have from Wave 7.

R-IDs reserved this wave (sequential continuation from R-799 of Wave 6): **R-800 → R-1023**.

---

## SECTION D2 — Shared foundation (utils + stores + workers + hooks + app root) (R-800 → R-918)

20 files line-read:
- `utils/age-verification.ts`, `utils/consent-server.ts`, `utils/country-from-phone.ts`, `utils/dashboard-auth-guard.ts`, `utils/emergency-services.ts`, `utils/fetch-with-timeout.ts`, `utils/lifecycle-guards.ts`, `utils/network-status.ts`, `utils/phase-watchdog.ts`, `utils/safe-tel.ts`, `utils/subscription-server.ts`, `utils/validation.ts`
- `stores/dashboard-store.ts`, `workers/evidence-hash-worker.ts`, `hooks/use-shake.ts`, `constants/pricing.ts`, `figma/ImageWithFallback.tsx`
- `App.tsx`, `routes.ts`, `main.tsx`

### Validation gaps
- **R-800** `utils/validation.ts:24-28` — `isValidE164Phone` makes leading `+` optional (`/^\+?[1-9]\d{7,14}$/`). Any 8–15-digit local-format number passes despite function name claiming E.164. Twilio dispatch then gets malformed `To` → silently drops with `21211 invalid To`. Emergency contact never alerted.
- **R-801** `utils/validation.ts:27` — Off-by-one in range `\d{7,14}` excludes some valid E.164 (max 15 incl. country code) and accepts 7-digit pure-local junk after strip when `+` absent.
- **R-802** `utils/validation.ts:40` — Email regex requires TLD of 2–24 ASCII letters. Modern IDN/Unicode TLDs (`.السعودية`, `.中国`, `.рф`) rejected silently. Regional users (KSA/UAE/China) can't register with native-script email.
- **R-803** `utils/validation.ts:34-41` — `isValidEmail` doesn't lowercase before regex; cross-screen drift creates duplicate accounts.
- **R-804** `utils/validation.ts:44-47` — `isValidUuid` enforces version 1-5. Postgres UUID v7 (timestamped, new pg-tools) rejected. Forward-incompat.
- **R-805** `utils/validation.ts` — **NO GPS coordinate validator anywhere**. SOS payloads, geofences, location updates pass raw `{lat,lng}` with no `NaN`/`±Infinity`/out-of-range guard. Every caller invents its own.
- **R-806** `utils/validation.ts` — **No date / ISO-8601 validator**. `trial_ends_at`, `loginAt`, `consent.at` blindly `new Date(...)` parsed. Invalid Date → NaN math → `isTrialActive` falsely true forever.
- **R-807** `utils/validation.ts:74-82` — `isValidHttpUrl` allows `localhost`, `127.0.0.1`, `169.254.169.254` (AWS metadata), `0.0.0.0`. **SSRF on any server fetching user-supplied "company website" / image / share URL**. No private-range blocker.

### safe-tel real-dial gaps
- **R-808** `utils/safe-tel.ts:86-110` — Native branch resolves promise after `await CallNumber.call(...)` succeeds. Plugin resolves when ACTION_CALL is **dispatched**, not when phone connects. UI flips to `callDone=true` while OS may still be deciding or silently refusing (Android 11+ without CALL_PHONE permission). Wave-1 sync-setCallDone bug, unchanged.
- **R-809** `utils/safe-tel.ts:88` — Dynamic `import("capacitor-call-number")` unawaited at boot. FIRST tap (most life-critical, e.g. dispatcher during active SOS) pays import+initialize roundtrip while user panics.
- **R-810** `utils/safe-tel.ts:48-50` — `isEmergencyShortCode = /^\d{3,4}$/`. `cleaned` strips spaces/`-`/`(`/`)` but NOT leading `+`. So `+997` → `cleaned="+997"` → not a short code → no tel: fallback. Emergency dial silently fails when prefixed.
- **R-811** `utils/safe-tel.ts:77` — `cleaned` strip set `[\s\-\(\)]` only. Doesn't remove `.` (EU style "+966.50.123…") or non-breaking space (` `) from copy-paste. Plugin rejects, no fallback because emergency-shortcode test is digits-only.
- **R-812** `utils/safe-tel.ts:114-117` — Mobile-web branch uses `window.open("tel:...")`. Android Chrome PWA may treat tel: in window.open as popup-blocked → silent exit, no toast.
- **R-813** `utils/safe-tel.ts:120-130` — Desktop branch shows a `toast` with Copy button. **NO actual dial attempt** — function returns success-shaped. Callers can't distinguish "dialed" from "shown toast". R-368 pattern unfixed for desktop.
- **R-814** `utils/safe-tel.ts:108` — Non-emergency CallNumber throw → toast.error and return. No retry, no `window.location.href=tel:` fallback. Family-member dial silently dies if plugin uninstalled.

### Emergency-number resolution (R-368 family)
- **R-815** `utils/emergency-services.ts:33-54` — Hardcoded country table. **Missing**: PK, IN, NG, MA, TN, DZ, ID, MY, PH, ZA, BR, MX, AR, KR, JP, CN, TR, IR, IL, RU, UA. All silently fall to "112" which is **not connected** in US, Canada, Australia, Brazil, many others.
- **R-816** `utils/emergency-services.ts:34-35` — KSA = "997" (medical only). Fire/intrusion SOS still dials 997 instead of 998 (civil defense) or 999 (police). **Emergency-type → number mapping does not exist anywhere.**
- **R-817** `utils/emergency-services.ts:39` — Oman "9999" needs verification — varies by region.
- **R-818** `utils/emergency-services.ts:41` — Iraq "122" — Kurdistan has separate numbers (101, 102, 103, 122); no region sub-lookup.
- **R-819** `utils/emergency-services.ts:42` — Lebanon "140" is **Civil Defense specifically**. Medical emergency → wrong dispatcher.
- **R-820** `utils/emergency-services.ts:84-97` — `resolveDispatcherCountry` reads `browserLocale`, takes `parts[1]` after split. Locale `"en"` returns undefined; `"en-x-piglatin"` extracts `"x"`. No ISO-3166 validation.
- **R-821** `utils/emergency-services.ts:71-75` — No telemetry on 112 fallback. Operators have no signal that KSA users are getting INTL fallback because their profile country is missing.
- **R-822** `utils/country-from-phone.ts:51-56` — Sort comparator returns 0 for equal `dial.length`; Array.sort instability for two entries of length 4 (e.g. +1268 vs +1242). Fragile.
- **R-823** `utils/country-from-phone.ts:38-40` — Phone with `‎+` (LRM unicode) or full-width `＋` won't match `.startsWith("+")` → undefined → emergency number falls back to 112.

### Network / offline race
- **R-824** `utils/network-status.ts:45-65` — No mutex around `loadCapacitor`. Two concurrent `await refreshNetworkStatus()` before `_capMod` set → both call `import("@capacitor/network")` → both `addListener` → two listeners, two `_cached` writes per event.
- **R-825** `utils/network-status.ts:98-104` — `isOnline()` cache TTL 1500ms. When stale, falls back to `navigator.onLine` — the very Android-Capacitor unreliability this module was built to fix.
- **R-826** `utils/network-status.ts:103` — Returns `true` for "SSR / unknown env" — Capacitor WebView is NOT SSR. SOS code paths gating on `isOnline()` always proceed even when truly offline.
- **R-827** `utils/network-status.ts:113-156` — `subscribeNetworkStatus` polls every 2000ms. CPU-wake tick every 2s on hot path. Battery hit on mobile.
- **R-828** `utils/network-status.ts:121-128` — `handleOnline/Offline` overwrites `_cached.source = "navigator"` even if a fresher `"capacitor"` reading exists. Wrong telemetry.
- **R-829** `utils/network-status.ts:140` — `lastConnected = null` so first poll emits, duplicate emission on subscribe.

### Phase watchdog correctness
- **R-830** `utils/phase-watchdog.ts:94-99` — Battery FORCE threshold (≤5%) blocks transition only for non-emergency, non-closing phases. **Device at 3% in `search` phase cannot be escalated to emergency from search.**
- **R-831** `utils/phase-watchdog.ts:102-107` — Battery PANIC (≤10%) fires only in `EARLY_PHASES`. `search`, `documentation`, `closing` ignore battery panic. Dying searcher's phase budget exhausts only after 10 minutes.
- **R-832** `utils/phase-watchdog.ts:110-113` — Stale check uses `!state.hasAdminActed`. Single button click resets stale check forever. Dispatcher acks, walks away → emergency goes stale, watchdog never re-fires.
- **R-833** `utils/phase-watchdog.ts:148-162` — Reason dedup against string, but reasons include `Math.floor(elapsed/1000)` — seconds increment every tick → SAME decision emitted every second after exceeding budget. Spam.
- **R-834** `utils/phase-watchdog.ts:144-146` — Constructor freezes `rules` reference; no defensive copy → remote-config mutation affects existing instances unpredictably.
- **R-835** `utils/phase-watchdog.ts:165-168` — `setPhase` resets `hasAdminActed=false` mid-tick → race with `decidePhaseAction` that already captured `nowMs`.
- **R-836** `utils/phase-watchdog.ts:72` — `emergency` phase has `isTerminal:true` AND `budgetMs:5*60_000`. Budget never triggers because terminal — misleading documentation.

### Auth guard bypass — **CRITICAL**
- **R-837** `utils/dashboard-auth-guard.ts:12,46` — `AUTH_KEY = "sosphere_dashboard_auth"` stored in localStorage. Loader trusts it. **An attacker with XSS, hostile browser extension, or shared device can `localStorage.setItem("sosphere_dashboard_auth", JSON.stringify({version:4, role:"super_admin", loginAt:Date.now()}))` and access /dashboard with full privileges. No signature, no server cross-check. THE HEADLINE AUTH BYPASS.**
- **R-838** `utils/dashboard-auth-guard.ts:79-81` — `isSessionExpired` rejects sessions with `version < 4`. Attacker just sets `version=4`. No HMAC.
- **R-839** `utils/dashboard-auth-guard.ts:84-95` — `dashboardAuthLoader` does NOT call Supabase to verify session exists. A revoked user (admin disabled, password changed) keeps full dashboard for remaining TTL (8h).
- **R-840** `utils/dashboard-auth-guard.ts:46` — `loginAt: Date.now()` is client-controlled. Set future `loginAt` to extend TTL indefinitely.
- **R-841** `utils/dashboard-auth-guard.ts:140-171` — `canAccessPage` is CLIENT-SIDE only. Permission check in browser; no server confirmation. XSS or tampered build patches to `return {allowed:true}`.
- **R-842** `utils/dashboard-auth-guard.ts:144-147` — Unknown page returns deny — but pages inferred from string union; typo (`emergencyhub` vs `emergencyHub`) silently locks out instead of warning.
- **R-843** `utils/dashboard-auth-guard.ts:115-131` — Permission strings (`"users:view"`, `"emergency:broadcast"`) matched against `session.permissions` ARRAY — also localStorage-controlled. Add any permission to bypass per-page checks.
- **R-844** `utils/dashboard-auth-guard.ts:32-48` — `setDashboardSession` swallows localStorage errors. Private-mode Safari → session "succeeds" but isn't saved → immediate redirect with no diagnostic.

### Subscription tier client-side trust
- **R-845** `utils/subscription-server.ts:57-96` — Takes caller-provided thunk. Caller can pass stubbed RPC returning `{data:'elite',error:null}` → instant pro tier with no server traffic. "Server-authoritative" header comment is a lie.
- **R-846** `utils/subscription-server.ts:64-66` — Early-return on `currentUserPlan === "employee"` skips RPC entirely. Flip local `userPlan` to `"employee"` → never triggers server check.
- **R-847** `utils/subscription-server.ts:78-80` — `data === null` maps to `rpc_no_data → free`. Postgres function returning empty record set comes back as `data: []` — falls through to `String("")` → free. Contract not validated.
- **R-848** `utils/subscription-server.ts:48-49` — No `"trial"` or `"trialing"` enum. Stripe `subscription.status='trialing'` → unknown_tier → free. User mid-trial loses access until promotion.
- **R-849** `utils/subscription-server.ts:82` — `String(resp.data).toLowerCase().trim()` — `{tier:'pro'}` object → `"[object Object]"` → unknown → free. Shape mismatch silently denies.
- **R-850** Subscription module has **no cache**. Every session restore hits RPC; transient network glitch → "I just paid and see free tier."

### Shared-store cross-tenant leak — **CRITICAL**
- **R-851** `stores/dashboard-store.ts:494-884` — Single module-level zustand store reused across tenant switches. `reset()` was added (line 891-908) but only resets `companyState/trial/lang/dismissed` flags. **`auditLogs`, `emergencies`, `kpis`, `zoneClusters`, `employees` NOT explicitly wiped.** After tenant A logs out and tenant B logs in, B sees A's emergencies, KPIs, employee list, zones until `initDashboard()` returns. **PHI leak across tenants.**
- **R-852** `stores/dashboard-store.ts:332-340` — `buildInitialCompanyState` reads `sos_reg_result` localStorage without `sosphere_` namespace prefix. Cross-domain co-hosted app collision.
- **R-853** `stores/dashboard-store.ts:333` — JSON parse with try/catch swallowing → tampered value silently fallback to defaults; plan/employeeCount wrong.
- **R-854** `stores/dashboard-store.ts:349-350` — `_initialCompanyState` captured at module load. CRIT-#4 fix incomplete: `kpis`, `lastRefreshedAt`, `notifCount` etc. carry original module-load values, not fresh state on reset.
- **R-855** `stores/dashboard-store.ts:558-577` — `recordRRPSession` inside try/catch with empty `/* non-blocking */` → analytics failures swallow; lose telemetry.
- **R-856** `stores/dashboard-store.ts:539,546,675,...` — Every mutation logs `console.log("[SUPABASE_READY] ...")`. **Production console leaks PII (employee names, types)** to DevTools / Sentry breadcrumbs.
- **R-857** `stores/dashboard-store.ts:633-636` — `tickEmergencyTimers` no rate-limit; double-tick triggers false stale-escalations.
- **R-858** `stores/dashboard-store.ts:686-695` — `pinAsActive` catch returns `{}` → empty `set()` does nothing. Caller has no signal pin failed. Lost audit.
- **R-859** `stores/dashboard-store.ts:644-646` — `hasPermission(get().authState, permission as any)` — `as any` erases type guard; typo `"emergncy:view"` returns false silently.
- **R-860** `stores/dashboard-store.ts:735-738` — `refreshMissedCalls` re-reads from `shared-store` (another module-level singleton). Cross-tenant if shared-store not reset.
- **R-861** `stores/dashboard-store.ts:850-865` — `getStoredUser()?.email || "admin"` → empty localStorage logs actor as literal `"admin"`. Audit integrity broken.
- **R-862** `stores/dashboard-store.ts:975-990` — `useDashboardAutoRefresh` recreates `setInterval` on every render with inline `intervalMs`. Same useEffect-deps timer-recreation pattern.

### Hook lifecycle bugs
- **R-863** `hooks/use-shake.ts:31` — `lastAccelRef.current = {x:0,y:0,z:0}`. First motion event computes against (0,0,0); iOS sensor warmup spike → spurious shake fires the moment the page loads.
- **R-864** `hooks/use-shake.ts:35-70` — `handleMotion` recreated on `[enabled, threshold, minShakes, resetMs, cooldownMs]`. Inline literals → handler torn down/re-added every render → listener may be added twice on rapid enabled flip.
- **R-865** `hooks/use-shake.ts:32-33` — `onShakeRef.current = onShake` runs in render body, not useEffect. React 18 Strict Mode → ref overwrite races effect cleanup.
- **R-866** `hooks/use-shake.ts:64` — `setTimeout(() => { cooldownRef.current=false }, cooldownMs)` no ref to clear. Unmount during cooldown → timer survives → cross-mount mutation in StrictMode.
- **R-867** `hooks/use-shake.ts:76-88` — `requestAndListen` async. Cleanup `return () => removeEventListener(...)` may run BEFORE `addEventListener`. Listener leaks.
- **R-868** `hooks/use-shake.ts:79` — `typeof DeviceMotionEvent?.requestPermission === "function"` — environments where DeviceMotionEvent is constructor but lacks requestPermission → optional chain yields undefined → straight to addEventListener. iOS<13 may register and never get events.

### Hash worker integrity
- **R-869** `workers/evidence-hash-worker.ts:5` — No origin check, no sender authentication. Any code with worker reference can post arbitrary blobs and receive SHA-256.
- **R-870** `workers/evidence-hash-worker.ts:8-18` — Per-file hash only, no Merkle root / manifest hash. MITM can swap individual file bytes.
- **R-871** `workers/evidence-hash-worker.ts:9` — `await blobs[i].arrayBuffer()` loads FULL file into memory. Multi-megabyte body-cam → mobile OOM-kill → partial hash array posted as `done` = corrupted manifest.
- **R-872** `workers/evidence-hash-worker.ts:13` — No length assertion. If `crypto.subtle.digest` mocked/broken, wrong-length output passes silently.
- **R-873** `workers/evidence-hash-worker.ts:17` — Float drift on progress comparison (low-risk).
- **R-874** `workers/evidence-hash-worker.ts:20-22` — Catch collapses error to message string. Parent can't tell retryable vs fatal.
- **R-875** `workers/evidence-hash-worker.ts:5` — Missing `id`? Loop runs, postMessage echoes `id: undefined` → parent's id-correlated promise never resolves.

### Root error boundary / routes
- **R-876** `App.tsx:9-14` — Service worker registered `!isNativeApp()`. Sync check depends on `window.Capacitor` being injected (async). Cold Capacitor boot → SW registers anyway → conflicts with native file serving.
- **R-877** `App.tsx:17-19` — Single `<AppErrorBoundary>` wraps everything. No segment-level boundaries → bug in `/dashboard` kills landing too.
- **R-878** `App.tsx:1-21` — No try/catch around `registerServiceWorker()`. CSP throw bubbles up, not caught by boundary.
- **R-879** `main.tsx:46-50` and `:57-61` — `createRoot(...).render()` called TWICE if `initializeApp()` throws after first render. React warns; user sees blank then error boundary.
- **R-880** `main.tsx:9` — `initSentry()` awaited BEFORE render. Corporate networks blocking Sentry → splash hangs while Sentry's 5s internal timeout runs.
- **R-881** `main.tsx:14` — `initEnvShield()` sync, no try/catch. Bundler edge case → app fails to mount with no boundary.
- **R-882** `main.tsx:46-50` — `document.getElementById("root")!` non-null assertion. Modified `index.html` without `<div id="root">` → raw TypeError at startup, no fallback UI.
- **R-883** `main.tsx:54-69` — `__delayReactMount` global hack. Boot script throws → never set → mount runs immediately on blank screen. No timeout-bypass: 30s delay = 30s black screen.
- **R-884** `routes.ts:23` — `loader: () => isNative() ? redirect("/app") : null` — fresh Capacitor where `window.Capacitor` not yet attached → loader returns null → loads landing page → tenant briefly sees marketing site.
- **R-885** `routes.ts:14-58` — **`/dashboard` route does NOT include `loader: dashboardAuthLoader`**. Auth guard exists but isn't wired at route level — only inside component on mount. Unauthenticated user briefly sees dashboard skeleton + inflight network requests fire before in-component check redirects.
- **R-886** `routes.ts:33-36` — Dev route exposed via `import.meta.env.DEV`. Production bundle with DEV defined truthy (misconfig) → `/dev/stress-test` reachable in production.
- **R-887** `routes.ts:55` — `/shared-sos/:emergencyId` public deep-link. No auth on route; access control delegated to handler. URL enumeration could leak emergency state.
- **R-888** `routes.ts:6-8` — `RouteLoading` solid `#05070E` block. No timeout, no spinner, no escape. Stuck lazy import → black screen indefinitely.

### Hardcoded prices / VAT / currency
- **R-889** `constants/pricing.ts:36-118` — All prices bare numbers with NO currency unit. KSA users see USD priced as SAR (one-quarter of actual price).
- **R-890** `constants/pricing.ts:36-39` — Stripe price IDs NOT in this file → drift between client-displayed price and Stripe-charged amount possible.
- **R-891** `constants/pricing.ts:158,177` — Individual basic $7, elite $14. Hardcoded. Marketing changes pricing Friday → client shows new, Stripe charges old → silent fraud risk.
- **R-892** `constants/pricing.ts` — **Zero references to VAT**. KSA requires 15% line on invoices. Pre-tax displayed → invoice shock at checkout.
- **R-893** `constants/pricing.ts:230-250` — `calculateMonthlyBill` no VAT field. `total` is pre-tax.
- **R-894** `constants/pricing.ts:236-239` — `baseCost > 0 ? baseCost : 0` — `monthlyPrice = -1` (Enterprise custom) → returns 0 silently. Caller adds `extraEmployeeCost` to 0 base → bills "Contact Sales" customer for extras.
- **R-895** `constants/pricing.ts:217-222` — `recommendPlan(employeeCount)` no upper guard. `employeeCount = -1` or `NaN` → returns enterprise.
- **R-896** `constants/pricing.ts:153` — Free tier `sosPerMonth: 90` but comment says "1 per hour, 3 per day". UI drift: one screen "87 left this month", another "3/day". Confusion.
- **R-897** `constants/pricing.ts:208-214` — ADDONS prices bare numbers. Cycle (annual/monthly) ambiguous → billing disputes.

### ImageWithFallback XSS / referrer
- **R-898** `figma/ImageWithFallback.tsx:25` — `src` passed unsanitized. Modern browsers ignore `javascript:` in `<img src>`, but `data:` URIs leak via referer-tracking pixels.
- **R-899** `figma/ImageWithFallback.tsx:21` — `data-original-url={src}` writes raw URL to DOM attribute. Untrusted form input leaks to DOM scrapers.
- **R-900** `figma/ImageWithFallback.tsx:9-12` — Error handler re-spreads `...rest` on fallback image → caller's malicious onError runs again (re-error loop).
- **R-901** `figma/ImageWithFallback.tsx:13` — No defensive filter on `...rest`.
- **R-902** `figma/ImageWithFallback.tsx:6-27` — No `referrerPolicy` default. Evidence photo fail-over leaks `Referer: https://app.sosphere.io/dashboard?emergencyId=...` to third-party CDNs. **PII referer leak.**

### Consent / age verification
- **R-903** `utils/consent-server.ts:55-74` — `mirrorConsentToServer` returns `{ok:false}` on error; caller likely treats consent as "saved" by virtue of having called the function. Missing audit if consent never reached server.
- **R-904** `utils/consent-server.ts:148-167` — `rehydrateLocalConsent` writes `accepted:true` to localStorage. Attacker re-injects directly → `hasLocalTos()` returns true → consent flow skipped.
- **R-905** `utils/consent-server.ts:121-126` — When `hasSession=false`, `done` is purely local check. Unauthenticated user with tampered localStorage skips consent entirely.
- **R-906** `utils/consent-server.ts:62` — `p_version = opts.version ?? "1.0"` — client-supplied. Audit row says "agreed to TOS v9999.999" while displayed text was v1.0.
- **R-907** `utils/age-verification.ts:65-66` — Retry given `Math.max(50, remaining)` — second call quickly errors → false fail on slow but healthy connection.
- **R-908** `utils/age-verification.ts:75` — `setTimeout` no clearTimeout on winning race branch. Timer leaks until fired.
- **R-909** `utils/age-verification.ts:79-84` — `res.data === true` only "verified" path. Schema drift `{verified:true, dob:'...'}` → false fail → silent lockout.

### Lifecycle guards
- **R-910** `utils/lifecycle-guards.ts:39-81` — `IntervalGuard.start` generation check inside callback; async cb continues even after `stop()` mid-await.
- **R-911** `utils/lifecycle-guards.ts:51-56` — `cb()` blocking sync; throw doesn't clear interval → exception every tick.
- **R-912** `utils/lifecycle-guards.ts:94-99` — `DisposeGuard.dispose` silently nulls controller; old AbortSignal holders unaware of new lifecycle.

### Misc / general
- **R-913** `utils/dashboard-auth-guard.ts:175-177` — `Object.entries(ROLE_CONFIG).find(...)` first-match; multiple roles at same tier → non-deterministic across builds.
- **R-914** `utils/consent-server.ts:51-52` — Properly namespaced TOS/GPS keys but **missing tenant scoping**. Multi-tenant shared device: B inherits A's consent timestamp.
- **R-915** `utils/emergency-services.ts:33-54` — No typed key set for table; typo `"sx"` not caught until runtime.
- **R-916** `stores/dashboard-store.ts:330-340` — Only reads `sos_reg_result`; real plan fetched async. Brief window where downgraded user sees higher-tier UI.
- **R-917** `App.tsx:5,11` — Static import means no fallback if SW-register module fails.
- **R-918** `routes.ts:6-8` — RouteLoading `100vw/100vh` overlaps system UI on notched devices.

**D2 Subtotal: 119 defects**

---

## SECTION D5 — Main components, half 2 (R-919 → R-1023)

33 files line-read:
- `individual-layout`, `individual-pdf-report`, `individual-register`, `manual-priority-modal`, `map-screen`, `medical-alert-banner`, `monitoring-mode-banner`, `native-safe-area-v2`, `not-found-page`, `notification-permission-banner`, `offline-sync`, `onboarding-select`, `pdf-email-modal`, `pdf-password-modal`, `pending-approval`, `post-emergency-debrief`, `pre-shift-checklist`, `privacy-page`, `profile-settings`, `recording-consent-modal`, `route-layout`, `rrp-analytics-page`, `safety-gamification`, `settings-screens`, `shift-handover-modal`, `terms-page`, `training-center`, `use-session-timeout`, `view-transitions`, `weather-alerts`, `welcome-activation`, `welcome-onboarding`, `wow-demo`

### Runtime crashes / TypeScript bugs
- **R-919** `individual-layout.tsx:148` — `MapScreen` does NOT receive `t` translator prop; Arabic user gets English-only map labels.
- **R-920** `individual-layout.tsx:124` — `terms` screen routes to `onNavigateToPrivacy?.()`. Privacy shown when user requests Terms. Legal misrepresentation.
- **R-921** `individual-register.tsx:311` — `addContact = () => {}` and `removeContact = (_id) => {}` are NO-OPs. UI claims contacts can be added/removed; handlers do nothing. Dead UX.
- **R-922** `profile-settings.tsx:134` — `savePhoneEdit` calls `window.location.reload()` — **destroys any in-flight SOS, evacuation broadcast, monitoring state. Catastrophic if user mid-emergency.**
- **R-923** `map-screen.tsx:124-127` — `placeMarkersRef.current` never cleared in cleanup. HMR/fast nav → dangling markers leak.
- **R-924** `map-screen.tsx:208-226` — `<style>` tag injected every mount but never removed; cumulative DOM bloat.
- **R-925** `native-safe-area-v2.tsx:45-91` — Reads `--safe-area-inset-*` CSS vars but no provider sets them. **Always returns 0 unless external native-compat.css present — content overlaps notch.**
- **R-926** `native-safe-area-v2.tsx:243-247` — `max(16px, 0px) = 16px` applied on non-notched devices → spurious whitespace.
- **R-927** `not-found-page.tsx:88` — Hardcoded route to `/demo` exposed in production 404 page.
- **R-928** `pdf-email-modal.tsx:138` — Comment "Always succeed when all stages complete (no fake failures)" — but **the entire flow is FAKE delivery anyway** (no real SMTP). Production says "Delivery Successful" with fake delivery ID for unsent email.
- **R-929** `offline-sync.tsx:103,107` — Hardcoded Riyadh fallback `{lat:24.7136, lng:46.6753, accuracy:999}` for `triggerOfflineSOS`. **Worker in Iraq/Egypt/anywhere triggers SOS without GPS → ambulance dispatched to Riyadh.** R-297 pattern.
- **R-930** `view-transitions.tsx:14` — `_isNativeApp` lazy detection. Capacitor lib loads AFTER first render → AnimatePresence on Android WebView → documented black-screen bugs.

### Auth bypass / Session timeout
- **R-931** `use-session-timeout.tsx:108-148` — Timer polls 5000ms. Tab backgrounded >timeout while suspended → emergency resolved → next interval finds `elapsed > timeoutMs` → **immediate logout WITHOUT the 60s warning window**.
- **R-932** `use-session-timeout.tsx:113-115` — During emergency, activity timestamp artificially reset every 5s. **No re-auth challenge post-emergency** even after 8h of idle.
- **R-933** `use-session-timeout.tsx:131-136` — `onLogout()` no token-revoke call.
- **R-934** `pending-approval.tsx:412-450` — **`Demo: Enter as Supervisor` and `Demo: Enter as Employee` buttons render in production.** Tapping bypasses pending-approval gate entirely. **CRITICAL auth bypass.**
- **R-935** `pending-approval.tsx:64-82` — Cross-tab StorageEvent handler trusts `e.newValue`. Another tab/extension writes `sosphere_join_requests` with `status:"approved"` to bypass admin approval.
- **R-936** `pending-approval.tsx:24` — Default `userPhone = "+966551234567"` — every pending approval matched against fake phone. Default fail-open.
- **R-937** `welcome-activation.tsx:121` — Recovery flow + invite + missing `password_set` all in same path. Stolen `?type=recovery&code=...` URL → reset password + add `password_set:true`. No 2FA / email confirm.
- **R-938** `welcome-activation.tsx:157-160` — `password_set` is CLIENT-controlled metadata. Attacker calls `updateUser({data:{password_set:true}})` without actual password. Server-side enforcement needed (DB trigger).
- **R-939** `route-layout.tsx:14` — `RouteTransitionLayout` does no auth check at route root.

### Cross-tenant / RLS gaps
- **R-940** `pdf-email-modal.tsx:34-43` — `MOCK_TEAM` HARDCODED with 8 individuals at `@sosphere.com`. **Every tenant's PDF email modal shows the SAME team picker.**
- **R-941** `pre-shift-checklist.tsx:97-103, 64-95` — `RECENT_SUBMISSIONS` and `DEFAULT_TEMPLATES` HARDCODED at module scope. **Every company sees same 5 employees + same templates.**
- **R-942** `safety-gamification.tsx:51-60, 40-49` — `LEADERBOARD` and `BADGES` HARDCODED. **Every company sees same 8 workers + same 8 badges.**
- **R-943** `weather-alerts.tsx:46-75` — `MOCK_ALERTS`/`ZONE_WEATHER` HARDCODED. On fetch fail, page shows fake "Zone A — North Gate" data which don't exist for actual tenants. **Dashboard lies to admin.**
- **R-944** `weather-alerts.tsx:159-164` — `getCompanyCoords()` falls back to Riyadh when localStorage missing. Multi-zone tenants outside Riyadh see Riyadh weather as "their" zones.
- **R-945** `weather-alerts.tsx:237-247` — `(z.zone.charCodeAt(0) % 3) - 1` synthetic ±1°C variance applied per zone. R-295 pattern.
- **R-946** `training-center.tsx:1439-1446` — `FALLBACK_ADMINS` hardcoded with names "Rania Al-Dosari", "Ahmed Al-Rashid". Empty audit_log tenants see same 6 fake admins.
- **R-947** `rrp-analytics-page.tsx:91` — `COMPARISON_ADMINS = buildComparisonAdmins()` computed at MODULE LOAD using shared hardcoded admins. **All tenants share same admin comparison data.**
- **R-948** `settings-screens.tsx:434` — Hardcoded WhatsApp support `https://wa.me/966500000000` — every tenant clicks same Saudi number.
- **R-949** `profile-settings.tsx:49` — Hardcoded Unsplash AVATAR_URL with `utm_source=figma` tracking pixels.

### Life-safety lies / synthetic data
- **R-950** `map-screen.tsx:91-97` — "Nearest Hospital/Medical/Police/Fire" — all 5 places HARDCODED with synthetic GPS offsets (`lat + 0.008`, `lng + 0.005`). **When user dies because "Nearest Hospital" doesn't exist there, this is a life-safety lie.** Phone `911` hardcoded → wrong for KSA/UAE/Iraq.
- **R-951** `map-screen.tsx:92` — Phone numbers `911`, `999`, `998` hardcoded for ALL countries. Calling these in MENA dials wrong service.
- **R-952** `offline-sync.tsx:104-107` — Geolocation fallback synthesizes Riyadh coords for SOS dispatch. **ANY worker globally without GPS triggers Riyadh dispatch.**
- **R-953** `safety-gamification.tsx:65-71` — Scoring rules promise "+50 buddy SOS response" / "+30 perfect week". **No implementation grants these points. XP gamification is purely cosmetic. Reward fraud potential when wired.**
- **R-954** `weather-alerts.tsx:46-75` — MOCK_ALERTS show "Severe Thunderstorm Warning" at fake zones. **Admin evacuates non-existent zones / not real ones.**
- **R-955** `weather-alerts.tsx:139-156` — `AbortSignal.timeout(5000)` only 5s. Iraqi 3G connections frequently fail → MOCK_ALERTS fallback → **life-safety misdirection.**
- **R-956** `individual-pdf-report.tsx:188-748` — Legal-grade PDF entirely client-side. Claims "court-admissible" and "tamper-evident" but **anyone with localStorage access can fabricate.** documentHash also client-computed.
- **R-957** `monitoring-mode-banner.tsx:30-38` — `setInterval(1000)` runs even after `monitorUntil` passed. Memory leak per banner.
- **R-958** `post-emergency-debrief.tsx:60-82` — `saveDebriefToHistory` writes localStorage only. **No server sync of "safe"/"unsure"/"need_help" answer.** User states need help → only local → no admin escalation.
- **R-959** `post-emergency-debrief.tsx:174-181` — When user picks `need_help`, save failure silently loses user-stated emergency.
- **R-960** `post-emergency-debrief.tsx:134-138` — Signed URL TTL 3600s (1h). User opens next morning → forensic photo URL broken → vanishes from legal record.

### Tier-gate bypass / PDF security — **CRITICAL**
- **R-961** `individual-pdf-report.tsx:179-182` — `resolveTier()` falls back to "basic" if `tier` undefined. **Caller calls `generateIndividualReport({tier:"elite",...})` from console → full Elite PDF regardless of subscription.** R-267 pattern.
- **R-962** `individual-pdf-report.tsx:912` — `generateDemoIndividualReport()` defaults to `tier:"elite"` and is exported. Anyone invokes from console.
- **R-963** `rrp-analytics-page.tsx:723` — `RRPAnalyticsPage` accepts no tier check; full analytics + PDF export gateless.
- **R-964** `pdf-password-modal.tsx:58-86` — jsPDF "encryption" uses **RC4-128**. RC4 broken since ~2013, NIST 800-131A forbidden. **Calling this "secure encryption" in legal PDF is a security lie.**
- **R-965** `pdf-password-modal.tsx:43-55` — 6-char password with one cap + one digit + one symbol = "Strong". Far below NIST 800-63B 8-char minimum.
- **R-966** `pdf-password-modal.tsx:179` — Accepts 4-char passwords. RC4-128 + 4-char = brute-forceable in <1s.
- **R-967** `pdf-password-modal.tsx:205` — Owner password = `password + "_sosphere_owner_" + Date.now().toString(36)`. **Brute-force user password (trivial at 4 chars) → reconstruct owner password from document metadata creation time.** Owner permission bypass.
- **R-968** `pdf-email-modal.tsx:221-227` — `includePassword:true` → password embedded in receipt displayed on screen + persisted to disk. **Cleartext leak.**
- **R-969** `pdf-email-modal.tsx:255` — Receipt file contains full recipient emails + delivery ID written to disk as `.txt`. Privacy leak.
- **R-970** `individual-pdf-report.tsx:801-818` — `computeIncidentHashAsync` caller-controlled canonical string. Hash meaningful only if caller follows same serialization.

### Consent / legal gaps (CALEA / GDPR / wiretap law)
- **R-971** `recording-consent-modal.tsx:286-289` — Disclaimer "company accepts no legal responsibility" — user accepts without confirming country. **Recording starts even in Germany (RESTRICTED per modal's own legal points).**
- **R-972** `recording-consent-modal.tsx:31-61` — "United States — Varies by state" doesn't enumerate two-party states (CA, FL, IL, MD, MA, MT, NV, NH, PA, WA). California user accepts → wiretap violation.
- **R-973** `recording-consent-modal.tsx:213` — Claims "Recording uploaded encrypted to our secure server" — but **audio capture/upload is NOT WIRED**. Consent obtained on false promise.
- **R-974** `privacy-page.tsx:11-17` — Privacy policy ARABIC-ONLY. **Non-Arabic users cannot read consent — violates GDPR Art. 7(2).**
- **R-975** `privacy-page.tsx:15` — 90-day retention hardcoded. DB triggers/cron to actually delete not referenced. **Legal-but-unenforced retention.**
- **R-976** `privacy-page.tsx:17` — Support email `sosphere.support@gmail.com` (gmail). GDPR Art. 13(1)(b) requires controller identity. Gmail is not a controller identity.
- **R-977** `terms-page.tsx:6-12` — Terms ARABIC-ONLY. Section 4 "في مرحلة التجربة لا يتحمل فريق SOSphere أي مسؤولية" UNENFORCEABLE under consumer protection in most jurisdictions.
- **R-978** `terms-page.tsx:12` — "تخضع هذه الشروط للقوانين المعمول بها في منطقة تشغيل الخدمة" — vague choice of law, unenforceable.
- **R-979** `recording-consent-modal.tsx:214` — Promises recording duration based on subscription with no enforcement code.

### Offline data loss / sync conflicts
- **R-980** `offline-sync.tsx:55-87` — localStorage read/write sync. Two concurrent SOS triggers → second `storeJSONSync` overwrites first. **Last-writer-wins data loss for queued SOS.**
- **R-981** `offline-sync.tsx:85` — `if (locs.length > 500) locs.splice(0, locs.length - 500)` — silently drops OLDEST. Worker offline 8h with 2s GPS → 14,400 entries → 13,900 dropped.
- **R-982** `offline-sync.tsx:121-132` — On reconnect, writes SOS to BOTH localStorage AND IndexedDB. Duplicate SOS sent to admin.
- **R-983** `offline-sync.tsx:412-418` — `handleSync` no confirmation. "Sync Now" while emergency pending could deprioritize SOS.
- **R-984** `offline-sync.tsx:711-716` — Claims "SOS works fully offline" but IndexedDB schema not verified — fallback to localStorage on throw silently swallowed.

### Hardcoded tenant / Production exposure
- **R-985** `wow-demo.tsx:49-170` — `WowDemo` route at `/demo` exposed in production. 404 page advertises it as "Cinematic showcase". Emits pretend SOS events (line 209: `SOS_TRIGGERED` with `demoMode:true`). DEMO_ prefix prevents real action, but reverse-engineerable to forge real SOS.
- **R-986** `wow-demo.tsx:201` — Demo emits `employeeName: "Ahmed Al-Rashidi"` — same hardcoded name as training. Demo events could pollute real telemetry if prefix stripped.
- **R-987** `not-found-page.tsx:88` — Dashboard route `/dashboard` publicly linked from 404. Combined with R-934, attacker path: bad URL → 404 → /demo → /dashboard.
- **R-988** `wow-demo.tsx` — No DEV-only guard. Ships in production bundle (200+ KB bloat).
- **R-989** `individual-register.tsx:293-306` — `countryCodes` hardcoded 12 countries. India/Pakistan/Indonesia/Nigeria missing. Workers can't register.
- **R-990** `pending-approval.tsx:24,26-27` — Default `adminName:"Company Admin"`, `userPhone:"+966551234567"` fake values if props missing.
- **R-991** `onboarding-select.tsx:102` — Hardcoded URL `sosphere.app/dashboard` single-tenant branded.

### Training expiry / cert pattern (R-532)
- **R-992** `training-center.tsx:1175-1188` — Progress stored in localStorage with NO expiry date. **Once worker completes drill, `completed=true` forever. Real life-safety: H2S training must re-cert annually.**
- **R-993** `training-center.tsx:872-876` — Search only checks `title.toLowerCase()`/`subtitle.toLowerCase()` — Arabic users searching Arabic find nothing.
- **R-994** `training-center.tsx:1290` — `streak: args.drills > 5 ? 3 : args.drills > 2 ? 1 : 0` — streak is tier threshold, not consecutive days.
- **R-995** `training-center.tsx:899-902` — `handleWatchDemo` navigates to `/demo?scene=${sceneId}&t=${timestamp}` — exposes wow-demo as training workflow.
- **R-996** `safety-gamification.tsx:52-59` — Mock `streak: 127` days hardcoded. R-532 pattern.

### Memory leaks / lifecycle
- **R-997** `monitoring-mode-banner.tsx:29-38` — `setInterval(1000)` re-mounts faster than dep array → multiple intervals coexist temporarily.
- **R-998** `map-screen.tsx:207-226` — Style tag never removed; original style permanent for page lifetime.
- **R-999** `recording-consent-modal.tsx:72` — `const [, setScrolled] = useState(false)` — `scrolled` discarded. setState triggers no-effect render. Dead state causing re-renders.
- **R-1000** `welcome-onboarding.tsx:44-62` — ParticleField rAF cancellation on unmount but canvas resize listener may double-attach in StrictMode dev.
- **R-1001** `weather-alerts.tsx:223-228` — `setInterval(fetchWeather, 600000)` 10min interval. Persists past logout (no cleanup tied to auth).
- **R-1002** `pdf-email-modal.tsx:131-136` — `await new Promise(setTimeout, duration)`. User closes modal mid-send → loop continues → `onSent?.()` on unmounted component.
- **R-1003** `pre-shift-checklist.tsx:98-103` — `RECENT_SUBMISSIONS` uses `new Date(Date.now() - 1800000)` at module load. **Timestamps FROZEN to module load time** — refresh shows same "30 min ago" indefinitely.
- **R-1004** `pre-shift-checklist.tsx:177-181` — `handleRemindAll` only calls `setRemindedWorkers(...)` + `toast.success`. **NO network call, no FCM push. Life-safety lie: admin clicks "Send Reminder to All", sees toast, no worker reminded. Workers enter shift without PPE.**
- **R-1005** `pre-shift-checklist.tsx:168-173` — `handleRemind` (single worker) same — no actual notification.
- **R-1006** `pre-shift-checklist.tsx:531-559` — Each submission's expanded panel shows `template.items` from defaults — wrong checklist if tenant customized.

### Profile / PII exposure
- **R-1007** `profile-settings.tsx:49` — Unused Unsplash URL with tracking params still in file.
- **R-1008** `profile-settings.tsx:55-58` — `customAvatar` loaded from localStorage. Full data URL avatars never scrubbed on logout — next user sees previous user's avatar.
- **R-1009** `profile-settings.tsx:120-134` — `savePhoneEdit` reloads → destroys in-flight SOS state.
- **R-1010** `profile-settings.tsx:123` — Phone written to localStorage without scrub on logout. PII leak shared devices.
- **R-1011** `profile-settings.tsx:128` — `update({phone}).eq("id", user.id)` no RLS check at client. No `.select()` verification.
- **R-1012** `individual-register.tsx:330` — `storeJSONSync("sosphere_individual_profile", profileData)` plaintext to localStorage. No encryption-at-rest.

### Misc / Routing
- **R-1013** `route-layout.tsx:14` — `_isNativeApp` underscore prefix suggests unused but IS used line 32. Confusing.
- **R-1014** `shift-handover-modal.tsx:259-277` — Native `confirm(...)` blocks JS event loop. **Emergency arriving DURING confirm prompt → all UI frozen until admin clicks.**
- **R-1015** `shift-handover-modal.tsx:220-225` — `localStorage.setItem("handover_notes", ...)` single key OVERWRITES previous. Audit trail lost on second handover.
- **R-1016** `shift-handover-modal.tsx:273-274` — `localStorage.setItem("emergency_logout_log", ...)` stored only on admin's device. **Last device retains proof of liability acceptance — should be server-synced before logout.**
- **R-1017** `shift-handover-modal.tsx:40` — `canComplete` requires `notes.length >= 20`. "aaaaaaaaaaaaaaaaaaaa" passes. Quality check missing.
- **R-1018** `welcome-activation.tsx:121` — `?type=invite` link expires LATER (no enforcement). Long-lived invite URL = phishing surface.
- **R-1019** `welcome-onboarding.tsx:84` — Defaults non-detected language to Arabic. Wrong language on first launch for non-Arabic users.
- **R-1020** `welcome-onboarding.tsx:115` — Onboarding completion local-only. No audit trail for compliance.
- **R-1021** `weather-alerts.tsx:202` — `WeatherAlertsPage` no responsive guard for mobile. `grid-cols-5` overflows.
- **R-1022** `medical-alert-banner.tsx` — Read end-to-end; minor findings rolled into above patterns.
- **R-1023** `notification-permission-banner.tsx` — Read end-to-end; minor findings rolled into above patterns.

**D5 Subtotal: 105 defects**

---

## Wave 7 PARTIAL Headline P0s

From the 224 defects logged in this file, the most critical for Phase 0 surgical list:

### Auth/identity bypass (critical)
1. **R-837** — `dashboard-auth-guard.ts` localStorage-only session, no signature. **Anyone with one localStorage write becomes super_admin.**
2. **R-934** — `pending-approval.tsx` "Demo: Enter as Supervisor" button **in production** bypasses admin approval entirely.
3. **R-938** — `password_set` is client-controlled metadata. Attacker calls updateUser without setting password.
4. **R-841/843** — Page-level role + permission check entirely client-side, permissions array in tamperable localStorage.

### Cross-tenant data leak (critical)
5. **R-851** — `dashboard-store.reset()` doesn't wipe emergencies/kpis/zones/employees/auditLogs. **PHI leak between tenants.**
6. **R-940-948** — Multiple modules ship hardcoded employee/admin names that render as live tenant data.

### Life-safety lies (critical)
7. **R-816/815** — Emergency-type → number mapping doesn't exist; KSA medical-only "997" dialed for fire/intrusion; ~20 countries fall back to "112" (not connected in US/Canada/Australia/Brazil).
8. **R-929/952/950** — Riyadh GPS fallback used globally. **Worker in Iraq → Saudi ambulance dispatched.**
9. **R-1004/1005** — Pre-shift checklist "Send Reminder" is a toast-only no-op. **Workers enter shift without PPE/buddy/medical kit.**
10. **R-973** — Recording consent obtained on false promise (encryption not wired).

### Tier-gate / PDF security
11. **R-961/962** — Client-controlled `tier:"elite"` self-promotion to forensic-grade PDF.
12. **R-964/966/967** — RC4-128 + 4-char passwords + derivable owner password. "Secure encryption" is a security lie.

### Foundational gaps (Phase 0 must-fix before any other surgery)
13. **R-805** — No GPS coordinate validator anywhere; NaN/Infinity reaches dispatch.
14. **R-806** — No date validator; Invalid Date → NaN math → `isTrialActive` falsely true forever.
15. **R-892** — Zero VAT support. KSA legal requirement unmet.
16. **R-885** — `/dashboard` route has no `dashboardAuthLoader`; unauthenticated reconnaissance window.

---

## Status of remaining Wave 7 batches (NOT line-read)

| Batch | Files | Risk | Status |
|---|---:|---|---|
| D1 api/ — **THE BACKBONE** | 23 | EXTREMELY HIGH | ❌ Re-run pending session reset |
| D3 ui/ shadcn | 48 | Medium | ❌ Re-run pending session reset |
| D4 main components half 1 | 35 | High | ❌ Re-run pending session reset |

The api/ batch is the single highest-risk uncovered area: it contains every Supabase RPC client, Stripe subscription client, Twilio voice provider, FCM push, MFA, TOTP, RLS policies. **Phase 0 cannot start until this is line-read.**

---

## Running totals after Wave 7 PARTIAL

- Waves 1-5: 1,541
- Wave 6: 469
- Wave 7 partial (D2 + D5): **224**
- **Running total: 2,234 distinct defects**
- Expected after Wave 7 complete (D1+D3+D4): **+200 to +400 more = ~2,500-2,650 total**

---

## Files

- `ROOT_AUDIT_RESULTS.md` → `ROOT_AUDIT_RESULTS_6.md` — Waves 1-6 (2,010 defects)
- `ROOT_AUDIT_RESULTS_7_partial.md` — this file (D2+D5, 224 defects)
- `ROOT_AUDIT_RESULTS_7.md` — TO BE WRITTEN after D1+D3+D4 complete (will merge this file's content + new findings)
- `MASTER_AUDIT.md` — TO BE WRITTEN after all of Wave 7 done
- `POST_LAUNCH_AUDIT.md` — still stale at R-99; will be rebuilt from MASTER_AUDIT
