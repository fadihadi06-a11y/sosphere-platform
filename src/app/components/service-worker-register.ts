// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SOSphere â€” Service Worker Registration + Offline App Shell
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Registers a service worker that:
//  â€¢ Caches the app shell for offline loading
//  â€¢ Enables Background Sync API for queued data
//  â€¢ Handles push notifications when app is closed
//  â€¢ Serves cached pages when offline
//
// NOTE: In production, the actual sw.js file must be in the
// public/ root. This module handles registration + messaging.
//
// In Figma Make sandbox, SW registration may not work due to
// scope restrictions â€” the logic is still valid for production.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface SWStatus {
  supported: boolean;
  registered: boolean;
  active: boolean;
  updateAvailable: boolean;
  backgroundSyncSupported: boolean;
  pushSupported: boolean;
  cacheSize: number | null;
  lastCacheUpdate: number | null;
  error: string | null;
  scope: string | null;
}

type SWStatusListener = (status: SWStatus) => void;

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let swStatus: SWStatus = {
  supported: "serviceWorker" in navigator,
  registered: false,
  active: false,
  updateAvailable: false,
  backgroundSyncSupported: "SyncManager" in window,
  pushSupported: "PushManager" in window,
  cacheSize: null,
  lastCacheUpdate: null,
  error: null,
  scope: null,
};

let statusListeners: SWStatusListener[] = [];
let swRegistration: ServiceWorkerRegistration | null = null;

function emitStatus(partial?: Partial<SWStatus>) {
  if (partial) swStatus = { ...swStatus, ...partial };
  statusListeners.forEach(fn => { try { fn({ ...swStatus }); } catch { /* */ } });
}

export function subscribeToSWStatus(listener: SWStatusListener): () => void {
  statusListeners.push(listener);
  listener({ ...swStatus });
  return () => { statusListeners = statusListeners.filter(fn => fn !== listener); };
}

export function getSWStatus(): SWStatus {
  return { ...swStatus };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Service Worker Registration
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export async function registerServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) {
    emitStatus({ supported: false, error: "Service Workers not supported" });
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    swRegistration = reg;
    console.info("[SW] Registered:", reg.scope);
    emitStatus({ supported: true, registered: true, active: !!reg.active, scope: reg.scope });
    reg.addEventListener("updatefound", () => emitStatus({ updateAvailable: true }));
    return true;
  } catch (err: any) {
    console.warn("[SW] Registration failed:", err.message);
    emitStatus({ error: err.message });
    return false;
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Background Sync Registration
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export async function requestBackgroundSync(tag: string = "sosphere-sync"): Promise<boolean> {
  if (!swRegistration || !("sync" in swRegistration)) {
    console.warn("[SW] Background Sync not available");
    return false;
  }

  try {
    await (swRegistration as any).sync.register(tag);
    console.log(`[SW] Background sync registered: ${tag}`);
    return true;
  } catch (err) {
    console.warn("[SW] Background sync registration failed:", err);
    return false;
  }
}

// â”€â”€ Periodic Sync (for regular check-ins when app is closed) â”€â”€

export async function requestPeriodicSync(tag: string = "sosphere-periodic-checkin", minInterval: number = 300000): Promise<boolean> {
  if (!swRegistration || !("periodicSync" in swRegistration)) {
    return false;
  }

  try {
    const permStatus = await navigator.permissions.query({ name: "periodic-background-sync" as any });
    if (permStatus.state !== "granted") return false;

    await (swRegistration as any).periodicSync.register(tag, { minInterval });
    console.log(`[SW] Periodic sync registered: ${tag}, interval: ${minInterval}ms`);
    return true;
  } catch {
    return false;
  }
}

// â•â•â•ï¿½ï¿½ï¿½â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Cache Management
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export async function getCacheStats(): Promise<{ names: string[]; totalSize: number }> {
  if (!("caches" in window)) return { names: [], totalSize: 0 };

  try {
    const names = await caches.keys();
    let totalSize = 0;

    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      // Rough size estimate
      totalSize += keys.length * 50000; // ~50KB per cached resource average
    }

    emitStatus({
      cacheSize: totalSize,
      lastCacheUpdate: Date.now(),
    });

    return { names, totalSize };
  } catch {
    return { names: [], totalSize: 0 };
  }
}

export async function clearAllCaches(): Promise<void> {
  if (!("caches" in window)) return;
  const names = await caches.keys();
  await Promise.all(names.map(name => caches.delete(name)));
  emitStatus({ cacheSize: 0 });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SW Message Handler
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function handleSWMessage(event: MessageEvent) {
  const { type, payload } = event.data || {};

  switch (type) {
    case "SYNC_COMPLETE":
      console.log("[SW] Background sync completed:", payload);
      // Trigger UI refresh
      window.dispatchEvent(new CustomEvent("sosphere:sync-complete", { detail: payload }));
      break;

    case "CACHE_UPDATED":
      emitStatus({ lastCacheUpdate: Date.now() });
      break;

    case "OFFLINE_DETECTED":
      window.dispatchEvent(new CustomEvent("sosphere:offline"));
      break;

    case "ONLINE_RESTORED":
      window.dispatchEvent(new CustomEvent("sosphere:online"));
      break;
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Generate Service Worker Code (Inline)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// In production, this would be a separate sw.js file.
// For the prototype, we generate it dynamically.

function generateServiceWorkerCode(): string {
  return `
// SOSphere Service Worker v1.0
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CACHE_NAME = 'sosphere-v1';
const CRITICAL_CACHE = 'sosphere-critical-v1';

// Critical resources that MUST be cached for offline safety
const CRITICAL_URLS = [
  '/',
  '/index.html',
];

// â”€â”€ Install: Pre-cache critical resources â”€â”€
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CRITICAL_CACHE).then((cache) => {
      return cache.addAll(CRITICAL_URLS).catch(() => {
        // Silently fail â€” some resources may not be available in dev
      });
    })
  );
  self.skipWaiting();
});

// â”€â”€ Activate: Clean old caches â”€â”€
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter(n => n !== CACHE_NAME && n !== CRITICAL_CACHE).map(n => caches.delete(n))
      );
    })
  );
  self.clients.claim();
});

// â”€â”€ Fetch: Network-first with cache fallback â”€â”€
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API calls (they should use IndexedDB queue)
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline: serve from cache
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // If it's a navigation request, serve the app shell
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// â”€â”€ Background Sync: Sync queued data when online â”€â”€
self.addEventListener('sync', (event) => {
  if (event.tag === 'sosphere-sync') {
    event.waitUntil(doBackgroundSync());
  }
  if (event.tag === 'sosphere-sos-sync') {
    event.waitUntil(doSOSSync());
  }
});

async function doBackgroundSync() {
  // Notify the app to trigger sync
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_COMPLETE', payload: { tag: 'sosphere-sync', timestamp: Date.now() } });
  });
}

async function doSOSSync() {
  // SOS sync has highest priority
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_COMPLETE', payload: { tag: 'sosphere-sos-sync', timestamp: Date.now(), priority: 'critical' } });
  });
}

// â”€â”€ Periodic Sync: Regular check-ins â”€â”€
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sosphere-periodic-checkin') {
    event.waitUntil(doPeriodicCheckin());
  }
});

async function doPeriodicCheckin() {
  const clients = await self.clients.matchAll();
  if (clients.length > 0) {
    clients[0].postMessage({ type: 'PERIODIC_CHECKIN', payload: { timestamp: Date.now() } });
  }
}

// â”€â”€ Push Notifications â”€â”€
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'SOSphere Alert', body: 'Safety alert received' };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'SOSphere', {
      body: data.body || 'New safety alert',
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      vibrate: [200, 100, 200, 100, 400],
      tag: data.tag || 'sosphere-alert',
      data: data,
      actions: [
        { action: 'view', title: 'View Alert' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'view' || !event.action) {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        if (clients.length > 0) {
          clients[0].focus();
        } else {
          self.clients.openWindow('/dashboard');
        }
      })
    );
  }
});
`;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Auto-init (try to register on import)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Don't auto-register â€” let the app decide when
// registerServiceWorker();

