// ═══════════════════════════════════════════════════════════════════════════
// utils/network-status — unified online/offline detection across web + native
// ─────────────────────────────────────────────────────────────────────────
// R-50 (MOBILE_AUDIT_FINDINGS.md, 2026-05-19) — `navigator.onLine` is well
// known to be unreliable on Android Capacitor WebView. Sibling fixes
// already worked around individual symptoms (W3-44 in sos-server-trigger
// added an "advisory only" treatment of navigator.onLine), but the
// underlying signal source was never upgraded. This module is the upgrade:
//
//   • On native (Capacitor): uses `@capacitor/network` getStatus() and
//     addListener('networkStatusChange'). This is the OS-supplied truth.
//   • On web (browser):     falls back to navigator.onLine + window
//     online/offline events. Same fidelity we had before.
//   • Cached for ~1.5s so call sites can read synchronously without
//     hammering the native bridge.
//
// Plugin import is lazy. If @capacitor/network is not installed yet (this
// happens during the R-50 rollout transition), we silently fall back to
// navigator.onLine — no runtime crash, no console noise beyond a single
// init log. After `npm install @capacitor/network`, the next call will
// pick up the plugin automatically.
// ═══════════════════════════════════════════════════════════════════════════

export type NetworkStatus = {
  connected: boolean;
  /** Where the answer came from. Useful for debug logging. */
  source: "capacitor" | "navigator" | "unknown";
};

type CapMod = {
  Network?: {
    getStatus: () => Promise<{ connected: boolean; connectionType?: string }>;
    addListener: (
      ev: "networkStatusChange",
      cb: (s: { connected: boolean; connectionType?: string }) => void,
    ) => Promise<{ remove: () => Promise<void> } | { remove: () => Promise<void> }>;
  };
};

let _capMod: CapMod | null | undefined = undefined; // undefined=not tried, null=tried+missing
let _cached: { connected: boolean; ts: number; source: NetworkStatus["source"] } | null = null;
const CACHE_TTL_MS = 1500;
let _listenerInstalled = false;

async function loadCapacitor(): Promise<CapMod | null> {
  if (_capMod !== undefined) return _capMod;
  try {
    // Use dynamic import so the bundler doesn't choke if the package isn't
    // installed yet. The string literal keeps Vite happy. The .catch fallback
    // handles both "module not found" and any other import error uniformly.
    const m = (await import("@capacitor/network").catch(() => null)) as CapMod | null;
    _capMod = m;
    if (m?.Network && !_listenerInstalled) {
      try {
        await m.Network.addListener("networkStatusChange", (s) => {
          _cached = { connected: !!s.connected, ts: Date.now(), source: "capacitor" };
        });
        _listenerInstalled = true;
      } catch { /* listener attach is best-effort; getStatus() still works */ }
    }
  } catch {
    _capMod = null;
  }
  return _capMod;
}

/**
 * Async — query the OS-level network status. Primes the sync cache.
 * Call this at app boot and from any non-hot path where you can await.
 */
export async function refreshNetworkStatus(): Promise<NetworkStatus> {
  const mod = await loadCapacitor();
  if (mod?.Network?.getStatus) {
    try {
      const s = await mod.Network.getStatus();
      _cached = { connected: !!s.connected, ts: Date.now(), source: "capacitor" };
      return { connected: !!s.connected, source: "capacitor" };
    } catch { /* fall through to navigator */ }
  }
  if (typeof navigator !== "undefined") {
    _cached = { connected: navigator.onLine, ts: Date.now(), source: "navigator" };
    return { connected: navigator.onLine, source: "navigator" };
  }
  return { connected: true, source: "unknown" };
}

/**
 * Synchronous — returns the best signal available right now, no await.
 * Use this from hot paths (render, intervals, retry loops) where async
 * would be invasive. Falls back to navigator.onLine if the Capacitor
 * cache is stale or unavailable.
 *
 * SAFETY NOTE: on real life-critical paths (SOS dispatch) treat any
 * "offline" answer as ADVISORY only — see sos-server-trigger.ts:1054
 * comment. Always try the network call anyway; just use this to skip
 * obviously-pointless retries.
 */
export function isOnline(): boolean {
  if (_cached && Date.now() - _cached.ts < CACHE_TTL_MS) {
    return _cached.connected;
  }
  if (typeof navigator !== "undefined") return navigator.onLine;
  return true; // SSR / unknown env — assume online (don't block on uncertainty)
}

/**
 * Subscribe to network status changes from BOTH sources (Capacitor +
 * window online/offline events). Returns an unsubscribe function.
 *
 * This is the right hook for "auto-sync when connection returns" — it
 * fires on either source, deduped by 250ms.
 */
export function subscribeNetworkStatus(cb: (s: NetworkStatus) => void): () => void {
  let lastFireAt = 0;
  const wrap = (s: NetworkStatus) => {
    const now = Date.now();
    if (now - lastFireAt < 250) return;
    lastFireAt = now;
    cb(s);
  };
  const handleOnline = () => {
    _cached = { connected: true, ts: Date.now(), source: "navigator" };
    wrap({ connected: true, source: "navigator" });
  };
  const handleOffline = () => {
    _cached = { connected: false, ts: Date.now(), source: "navigator" };
    wrap({ connected: false, source: "navigator" });
  };
  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
  }

  // Capacitor listener was already attached by loadCapacitor(); we hook
  // into the same cache it writes to by polling the cache on a 2s tick.
  // Cheap, no spin: only emits if state actually changed.
  let lastConnected: boolean | null = null;
  const poll = setInterval(() => {
    const current = isOnline();
    if (current !== lastConnected) {
      lastConnected = current;
      wrap({ connected: current, source: _cached?.source ?? "navigator" });
    }
  }, 2000);

  // Kick a refresh so the Capacitor listener gets installed if it isn't yet
  void refreshNetworkStatus();

  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    }
    clearInterval(poll);
  };
}

/** Test-only: clear caches so unit tests can simulate fresh state. */
export function __resetForTests() {
  _capMod = undefined;
  _cached = null;
  _listenerInstalled = false;
}
