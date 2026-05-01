// ═══════════════════════════════════════════════════════════════
// SOSphere — Service Worker
// ─────────────────────────────────────────────────────────────
// B-14 (2026-04-25): hardened cache policy.
//
// Pre-fix: a single fetch handler intercepted EVERY GET, fetched
// from network, then stored every response in CACHE_NAME. That
// included Supabase /rest /auth /realtime /functions /storage
// responses, which contained auth tokens, GPS coordinates, SOS
// state, and other PII. A stale cached response could be served
// during a NEW emergency (e.g., user resolves an SOS, retriggers
// minutes later, the SW returns the old "resolved" payload).
//
// Fix: allow-list the exact paths we WANT cached (static assets +
// app shell). Everything else — APIs, auth, realtime, functions,
// storage objects, cross-origin URLs (Stripe / Twilio), Authorization-
// bearing requests, video Range requests, and any response with
// `Cache-Control: no-store` or `private` — bypasses the SW
// entirely. We never call event.respondWith() for those, so the
// browser handles the fetch natively without any SW interference.
//
// Verified by 30 scenarios in scripts/test-b14-sw-cache-policy.mjs.
// ═══════════════════════════════════════════════════════════════

// 2026-05-01: bumped CACHE_NAME to force activate of SW with new
// push handler (lifesaving fix — see push handler comment).
const CACHE_NAME = 'sosphere-v4-lifesaving-push-2026-05-01';
const STATIC_PRECACHE = [
  '/',
  '/app',
  '/dashboard',
  '/manifest.json',
];

// Paths under self.origin that MUST NEVER be cached. These map to
// Supabase + internal API endpoints whose responses contain
// per-user tokens or live emergency state.
const NEVER_CACHE_PATH_PREFIXES = [
  '/rest/',       // PostgREST
  '/auth/',       // GoTrue
  '/realtime/',   // Realtime websocket fallback
  '/functions/',  // Supabase Edge Functions
  '/storage/v1/', // Storage objects (evidence, etc.)
  '/api/',        // Any internal HTTP API on this origin
];

// Path patterns that ARE safe to cache (static assets + manifests).
//
// W3-45 (B-20, 2026-04-26): `json` removed from extension regex.
// Pre-fix: ANY .json (e.g. /flags.json, /version.json, /config.json) was
// cached forever. A single transient bad response (MITM, misroute, stale
// edge) could permanently lock the user on bad config. PWA manifests use
// .webmanifest which is preserved below; for a specific .json that must
// be cached, add a precise path pattern here.
const STATIC_PATH_PATTERNS = [
  /^\/assets\//,
  /^\/icons?\//,
  /^\/fonts?\//,
  /^\/(?:icon|favicon)/,
  /\.(?:css|js|mjs|map|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|ico|webmanifest)$/i,
];

// App-shell pages we want to serve offline.
const SHELL_PATHS = new Set(['/', '/app', '/dashboard']);

function isSameOrigin(url, selfOrigin) {
  try { return new URL(url).origin === selfOrigin; } catch { return false; }
}

function shouldIntercept(request, selfOrigin) {
  if (request.method !== 'GET') return false;
  // Range requests (video chunks) — let the browser stream natively.
  if (request.headers.has('range')) return false;
  // Authorization-bearing requests are per-user state — never cache.
  if (request.headers.has('authorization')) return false;
  // Cross-origin requests (Stripe, Twilio, Supabase host directly,
  // anything else) — let the browser handle them natively. We do NOT
  // touch the cache for cross-origin URLs.
  if (!isSameOrigin(request.url, selfOrigin)) return false;
  const path = new URL(request.url).pathname;
  if (NEVER_CACHE_PATH_PREFIXES.some(p => path.startsWith(p))) return false;
  if (SHELL_PATHS.has(path)) return true;
  if (STATIC_PATH_PATTERNS.some(re => re.test(path))) return true;
  return false;
}

function shouldCacheResponse(response) {
  if (!response || !response.ok) return false;
  // Opaque (cross-origin no-cors) and opaqueredirect responses can
  // poison the cache because we can't introspect them.
  if (response.type === 'opaque' || response.type === 'opaqueredirect') return false;
  const cc = response.headers.get('cache-control') || '';
  if (/\bno-store\b/i.test(cc)) return false;
  if (/\bprivate\b/i.test(cc))  return false;
  return true;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (!shouldIntercept(event.request, self.location.origin)) return; // browser native
  event.respondWith((async () => {
    try {
      const res = await fetch(event.request);
      if (shouldCacheResponse(res)) {
        // Don't await — caching is best-effort and must not delay
        // the response to the page.
        const clone = res.clone();
        caches.open(CACHE_NAME)
          .then((cache) => cache.put(event.request, clone))
          .catch(() => {});
      }
      return res;
    } catch {
      // Offline / network failure → serve cached version IF we have
      // one. We never invent fallbacks for non-static paths because
      // shouldIntercept already filtered them out.
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw new Error('Network failed and no cache available');
    }
  })());
});

// ── Push Notifications (Web Push + FCM) ───────────────────
//
// Audit 2026-05-01 (lifesaving fix): live test confirmed the FULL push
// pipeline works — server signs, FCM delivers, SW receives, Windows
// renders the toast. BUT non-critical notifications were vanishing in
// ~4 seconds before the owner could notice them. requireInteraction
// was gated on `severity === 'critical'` only. The owner SOS fan-out
// from sos-alert DOES set severity:"critical" (so it persists), but:
//   • sos_self_confirm (employee-facing "your SOS was sent") had no
//     severity → defaulted to "high" → vanished too quickly.
//   • Any forgotten/missing severity field anywhere up the chain meant
//     the owner could miss an emergency because they happened to look
//     away for 5 seconds.
// New rule: ANY notification whose `kind` starts with "sos_" OR whose
// severity is "critical" or "high" is treated as lifesaving and stays
// on screen until the user dismisses it. This is defense-in-depth — even
// if a future caller forgets to set severity:"critical", the kind alone
// keeps the notification visible.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch (e) {
    const text = event.data?.text?.() || 'Emergency notification';
    data = { title: 'SOSphere Alert', body: text };
  }

  const severity = data.severity || data.data?.severity || 'medium';
  const kind = data.kind || data.data?.kind || '';
  const isLifesaving = severity === 'critical' || severity === 'high' || (typeof kind === 'string' && kind.indexOf('sos_') === 0);

  const vibrate = severity === 'critical'
    ? [300, 100, 300, 100, 300]
    : severity === 'high'
    ? [200, 100, 200]
    : [150, 80];

  const tag = data.tag || data.callId || `sosphere-${Date.now()}`;

  event.waitUntil(
    self.registration.showNotification(data.title || 'SOSphere Alert', {
      body: data.body || 'Emergency notification',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate,
      tag,
      renotify: true,
      // requireInteraction now keyed on `isLifesaving`, not just
      // `severity === 'critical'`. Owner cannot afford to miss an
      // SOS toast that auto-dismissed in 4 seconds while they were
      // looking down at a phone.
      requireInteraction: isLifesaving,
      actions: isLifesaving ? [
        { action: 'view', title: 'View Emergency' },
        { action: 'dismiss', title: 'Dismiss' },
      ] : [],
      data: {
        url: data.url || data.data?.url || '/',
        callId: data.callId || data.data?.callId || '',
        type: data.type || data.data?.type || 'general',
        ...data,
      },
    })
  );
});

// ── Notification click handler ────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = '/';

  if (event.action === 'view' || !event.action) {
    if (data.callId) {
      targetUrl = `/emergency/${data.callId}`;
    } else if (data.url) {
      targetUrl = data.url;
    } else {
      targetUrl = '/dashboard';
    }
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('sosphere') || client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            data: data,
            targetUrl,
          });
          return;
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── FCM message handler ──────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FCM_TOKEN') {
    // FCM tokens are sent over a postMessage channel from the page;
    // we DO NOT log them (B-H6 — token leakage). The page is responsible
    // for persisting the token via its own server call.
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
