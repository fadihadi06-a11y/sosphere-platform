const CACHE_NAME = 'sosphere-v1';
const STATIC_ASSETS = [
  '/',
  '/app',
  '/dashboard',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
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
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Push Notifications (Web Push + FCM) ───────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch (e) {
    // Malformed push payload — use text fallback
    const text = event.data?.text?.() || 'Emergency notification';
    data = { title: 'SOSphere Alert', body: text };
  }

  // Determine severity for vibration pattern
  const severity = data.severity || data.data?.severity || 'medium';
  const vibrate = severity === 'critical'
    ? [300, 100, 300, 100, 300]  // Urgent triple buzz
    : severity === 'high'
    ? [200, 100, 200]             // Double buzz
    : [150, 80];                   // Single buzz

  // Tag prevents duplicate notifications
  const tag = data.tag || data.callId || `sosphere-${Date.now()}`;

  event.waitUntil(
    self.registration.showNotification(data.title || 'SOSphere Alert', {
      body: data.body || 'Emergency notification',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate,
      tag,
      renotify: true,
      requireInteraction: severity === 'critical',
      actions: severity === 'critical' ? [
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
    // Navigate to the emergency or dashboard
    if (data.callId) {
      targetUrl = `/emergency/${data.callId}`;
    } else if (data.url) {
      targetUrl = data.url;
    } else {
      targetUrl = '/dashboard';
    }
  }

  // Focus existing tab or open new one
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Try to focus an existing SOSphere tab
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
      // No existing tab — open new one
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Firebase Cloud Messaging (FCM) handler ────────────────
// FCM sends messages via the push event above.
// This handles FCM-specific background messages.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FCM_TOKEN') {
    // Store FCM token for later use
    console.log('[SW] FCM token received:', event.data.token?.substring(0, 20) + '...');
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
