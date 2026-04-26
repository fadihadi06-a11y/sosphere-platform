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

// G-28 (B-20, 2026-04-26): generateServiceWorkerCode() removed.
// The function produced the OLD `sosphere-v1` service worker (before
// B-14 hardened the cache policy) and was never called — but its
// presence was a landmine: any code that registered the inline string
// would have re-introduced the unguarded caching that B-14 closed.
// The production SW lives ONLY in /public/sw.js — that is the single
// source of truth. See AUDIT_DEEP_2026-04-25.md G-28 for the audit note.

// Auto-init (try to register on import)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Don't auto-register â€” let the app decide when
// registerServiceWorker();

