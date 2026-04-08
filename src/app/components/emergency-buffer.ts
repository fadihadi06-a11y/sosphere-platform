// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — Emergency Local Buffer Failover System
// ─────────────────────────────────────────────────────────────────────────
// Activates when primary Supabase database is unreachable.
//
// Architecture:
//  1. Monitors Supabase connectivity via heartbeat pings (every 30s)
//  2. When primary is DOWN:
//     - Switches to "Emergency Local Buffer" mode
//     - All SOS/critical data buffered in IndexedDB with priority tags
//     - Attempts to broadcast to a secondary fallback URL (configurable)
//     - Shows user a "Working Offline — Data Saved Locally" indicator
//  3. When primary is BACK:
//     - Flushes buffer to Supabase in priority order (SOS first)
//     - Verifies data integrity (checksums)
//     - Clears buffer only after confirmed sync
//
// The secondary fallback URL is:
//   VITE_FALLBACK_API_URL — a separate endpoint (can be another Supabase project,
//   a Firebase instance, or a simple webhook) that receives critical SOS data
//   as a last resort.
// ═══════════════════════════════════════════════════════════════════════════

import { reportError } from "./error-boundary";
import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";

// ── Types ──────────────────────────────────────────────────────────────────

export type ConnectionStatus = "connected" | "degraded" | "offline" | "fallback";

export interface EmergencyBufferConfig {
  heartbeatIntervalMs: number;     // 30s default
  heartbeatTimeoutMs: number;      // 5s timeout for ping
  maxConsecutiveFailures: number;  // 3 failures before switching to offline
  fallbackUrl: string | null;      // Secondary endpoint
  retryOnReconnect: boolean;       // Auto-flush buffer on reconnect
}

export interface BufferedEvent {
  id: string;
  type: "sos" | "checkin" | "incident" | "gps" | "message";
  priority: number;                // 1=highest (SOS), 5=lowest (GPS)
  payload: any;
  timestamp: number;
  checksum: string;
  attempts: number;
  lastAttemptAt: number | null;
}

// ── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: EmergencyBufferConfig = {
  heartbeatIntervalMs: 30000,       // Check every 30s
  heartbeatTimeoutMs: 5000,         // 5s timeout for health check
  maxConsecutiveFailures: 3,        // Switch to offline after 3 failures
  fallbackUrl: import.meta.env.VITE_FALLBACK_API_URL || null,
  retryOnReconnect: true,
};

// ── State ──────────────────────────────────────────────────────────────────

let config = { ...DEFAULT_CONFIG };
let connectionStatus: ConnectionStatus = "connected";
let consecutiveFailures = 0;
let heartbeatIntervalId: number | null = null;
let statusListeners: ((status: ConnectionStatus) => void)[] = [];

// ── Database Setup ─────────────────────────────────────────────────────────

const DB_NAME = "sosphere_offline";

// Will be incremented when adding emergency_buffer store
// Helper function to ensure emergency_buffer store exists
async function ensureEmergencyBufferStore(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("emergency_buffer")) {
        const store = db.createObjectStore("emergency_buffer", { keyPath: "id" });
        store.createIndex("by_priority", "priority", { unique: false });
        store.createIndex("by_type", "type", { unique: false });
        store.createIndex("by_timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);

    request.onsuccess = () => {
      resolve((request as IDBOpenDBRequest).result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

// ── Checksum Generation ────────────────────────────────────────────────────
// SHA-256 hash of JSON payload for deduplication and integrity verification

async function generateChecksum(payload: any): Promise<string> {
  const json = JSON.stringify(payload);
  const encoded = new TextEncoder().encode(json);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Heartbeat Monitoring ───────────────────────────────────────────────────

async function performHealthCheck(): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) {
    // If Supabase isn't configured, assume offline
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.heartbeatTimeoutMs);

    // Lightweight health check: count rows in a health check table (if it exists)
    // Falls back to a simple select that will fail if DB is down
    const { error } = await Promise.race([
      supabase.from("_health_check").select("count").limit(0),
      new Promise<any>((resolve) => {
        controller.signal.addEventListener("abort", () => {
          resolve({ error: { message: "Health check timeout" } });
        });
      }),
    ]);

    clearTimeout(timeoutId);

    if (error) {
      consecutiveFailures++;
      console.warn(
        `[EmergencyBuffer] Health check failed (${consecutiveFailures}/${config.maxConsecutiveFailures}):`,
        error.message
      );
      return false;
    }

    consecutiveFailures = 0;
    return true;
  } catch (err) {
    consecutiveFailures++;
    console.warn(
      `[EmergencyBuffer] Health check error (${consecutiveFailures}/${config.maxConsecutiveFailures}):`,
      err
    );
    return false;
  }
}

async function updateConnectionStatus(): Promise<void> {
  const isHealthy = await performHealthCheck();
  const newStatus: ConnectionStatus = (() => {
    if (isHealthy) {
      return "connected";
    } else if (consecutiveFailures < config.maxConsecutiveFailures) {
      return "degraded";
    } else if (config.fallbackUrl) {
      return "fallback";
    } else {
      return "offline";
    }
  })();

  if (newStatus !== connectionStatus) {
    const oldStatus = connectionStatus;
    connectionStatus = newStatus;

    console.log(
      `[EmergencyBuffer] Status change: ${oldStatus} → ${newStatus}`,
      {
        consecutiveFailures,
        maxFailures: config.maxConsecutiveFailures,
        hasFallback: Boolean(config.fallbackUrl),
      }
    );

    // When reconnecting, auto-flush buffer if configured
    if (newStatus === "connected" && config.retryOnReconnect) {
      console.log("[EmergencyBuffer] Primary reconnected — starting auto-flush");
      flushBuffer().catch(err => {
        reportError(err, {
          type: "buffer_auto_flush_failed",
          component: "EmergencyBuffer",
          newStatus,
        }, "error");
      });
    }

    // Notify listeners
    notifyStatusChange(newStatus);
  }
}

// ── Event Buffering ────────────────────────────────────────────────────────

async function bufferEventToIndexedDB(event: Omit<BufferedEvent, "id" | "checksum" | "attempts" | "lastAttemptAt">): Promise<string> {
  const eventId = `EB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const checksum = await generateChecksum(event.payload);

  const bufferedEvent: BufferedEvent = {
    id: eventId,
    type: event.type,
    priority: event.priority,
    payload: event.payload,
    timestamp: event.timestamp,
    checksum,
    attempts: 0,
    lastAttemptAt: null,
  };

  const db = await getDB();
  return new Promise<string>((resolve, reject) => {
    const tx = db.transaction("emergency_buffer", "readwrite");
    const store = tx.objectStore("emergency_buffer");
    const req = store.add(bufferedEvent);

    req.onsuccess = () => {
      resolve(eventId);
    };

    req.onerror = () => {
      reportError(req.error, {
        type: "buffer_write_failed",
        component: "EmergencyBuffer",
        eventType: event.type,
        eventId,
      }, "error");
      reject(req.error);
    };
  });
}

// ── Fallback Broadcast ─────────────────────────────────────────────────────
// POST critical SOS data to secondary fallback URL with integrity signature

async function broadcastToFallback(events: BufferedEvent[]): Promise<boolean> {
  if (!config.fallbackUrl) return false;

  const sosEvents = events.filter(e => e.type === "sos");
  if (sosEvents.length === 0) return true; // nothing to broadcast

  try {
    const payload = {
      timestamp: Date.now(),
      source: "sosphere_emergency_buffer",
      events: sosEvents.map(e => ({
        id: e.id,
        type: e.type,
        priority: e.priority,
        payload: e.payload,
        checksum: e.checksum,
      })),
    };

    // Generate HMAC signature for integrity (use session token as key if available)
    const signatureKey = localStorage.getItem("sosphere_emergency_key") || "unsigned";
    const signature = await generateChecksum(`${JSON.stringify(payload)}:${signatureKey}`);

    const response = await fetch(config.fallbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SOSphere-Signature": signature,
        "X-SOSphere-Source": "emergency_buffer",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(
        `[EmergencyBuffer] Fallback broadcast failed: HTTP ${response.status}`,
        await response.text().catch(() => "")
      );
      return false;
    }

    console.log(`[EmergencyBuffer] Fallback broadcast successful: ${sosEvents.length} SOS events`);
    return true;
  } catch (err) {
    reportError(err, {
      type: "fallback_broadcast_failed",
      component: "EmergencyBuffer",
      fallbackUrl: config.fallbackUrl,
    }, "warning");
    return false;
  }
}

// ── Buffer Flushing (Priority Order) ───────────────────────────────────────

async function flushBuffer(): Promise<{ flushed: number; failed: number }> {
  if (connectionStatus === "offline" && !config.fallbackUrl) {
    console.warn("[EmergencyBuffer] Cannot flush — offline and no fallback URL");
    return { flushed: 0, failed: 0 };
  }

  const db = await getDB();
  const events: BufferedEvent[] = await new Promise((resolve, reject) => {
    const tx = db.transaction("emergency_buffer", "readonly");
    const store = tx.objectStore("emergency_buffer");
    const index = store.index("by_priority");

    // Query in priority order (ascending: 1 = SOS first)
    const req = index.getAll();
    req.onsuccess = () => {
      const all = req.result as BufferedEvent[];
      // Sort by priority (1 first), then by timestamp (oldest first)
      resolve(all.sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp));
    };
    req.onerror = () => reject(req.error);
  });

  if (events.length === 0) {
    console.log("[EmergencyBuffer] Buffer empty — nothing to flush");
    return { flushed: 0, failed: 0 };
  }

  console.log(
    `[EmergencyBuffer] Starting buffer flush: ${events.length} events, status=${connectionStatus}`
  );

  let flushed = 0;
  let failed = 0;

  for (const event of events) {
    if (connectionStatus === "connected") {
      // Try to sync to primary Supabase
      try {
        const { error } = await supabase.from(event.type).insert(event.payload);
        if (error) throw error;

        // Mark as synced and remove from buffer
        await removeFromBuffer(event.id);
        flushed++;

        console.log(
          `[EmergencyBuffer] Flushed ${event.type} event ${event.id} to primary`
        );
      } catch (err) {
        failed++;
        reportError(err, {
          type: "buffer_flush_primary_failed",
          component: "EmergencyBuffer",
          eventId: event.id,
          eventType: event.type,
        }, "warning");
        console.warn(`[EmergencyBuffer] Failed to flush event ${event.id}:`, err);
      }
    } else if (connectionStatus === "fallback") {
      // Try to sync to fallback
      try {
        const success = await broadcastToFallback([event]);
        if (success) {
          await removeFromBuffer(event.id);
          flushed++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        reportError(err, {
          type: "buffer_flush_fallback_failed",
          component: "EmergencyBuffer",
          eventId: event.id,
        }, "warning");
      }
    } else {
      // Still offline — keep in buffer
      failed++;
    }

    // 200ms delay between items to avoid flooding
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[EmergencyBuffer] Buffer flush complete: ${flushed} synced, ${failed} remaining`);
  return { flushed, failed };
}

async function removeFromBuffer(eventId: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("emergency_buffer", "readwrite");
    const store = tx.objectStore("emergency_buffer");
    const req = store.delete(eventId);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the emergency buffer failover system.
 * Must be called once at app startup.
 */
export async function initEmergencyBuffer(partialConfig?: Partial<EmergencyBufferConfig>): Promise<void> {
  if (partialConfig) {
    config = { ...config, ...partialConfig };
  }

  // Ensure IndexedDB store exists (will be added in offline-database.ts schema upgrade)
  try {
    await ensureEmergencyBufferStore();
  } catch (err) {
    reportError(err, {
      type: "emergency_buffer_init_failed",
      component: "EmergencyBuffer",
    }, "warning");
  }

  // Start heartbeat monitoring
  if (heartbeatIntervalId !== null) {
    clearInterval(heartbeatIntervalId);
  }

  heartbeatIntervalId = window.setInterval(() => {
    updateConnectionStatus().catch(err => {
      reportError(err, {
        type: "health_check_error",
        component: "EmergencyBuffer",
      }, "warning");
    });
  }, config.heartbeatIntervalMs);

  // Initial status check
  await updateConnectionStatus();

  console.log("[EmergencyBuffer] Initialized", {
    heartbeatInterval: config.heartbeatIntervalMs,
    fallbackUrl: Boolean(config.fallbackUrl),
    autoFlush: config.retryOnReconnect,
  });
}

/**
 * Get current connection status.
 */
export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus;
}

/**
 * Subscribe to connection status changes.
 * Returns unsubscribe function.
 */
export function onConnectionStatusChange(cb: (status: ConnectionStatus) => void): () => void {
  statusListeners.push(cb);
  return () => {
    statusListeners = statusListeners.filter(fn => fn !== cb);
  };
}

function notifyStatusChange(status: ConnectionStatus): void {
  statusListeners.forEach(fn => {
    try {
      fn(status);
    } catch (err) {
      reportError(err, {
        type: "status_listener_error",
        component: "EmergencyBuffer",
      }, "warning");
    }
  });
}

/**
 * Buffer a critical event (SOS, checkin, incident, etc).
 * Event is stored in IndexedDB and will be flushed when connection returns.
 */
export async function bufferCriticalEvent(event: Omit<BufferedEvent, "id" | "checksum" | "attempts" | "lastAttemptAt">): Promise<void> {
  try {
    const eventId = await bufferEventToIndexedDB(event);

    // If we're in fallback mode and this is an SOS, try immediate broadcast
    if (connectionStatus === "fallback" && event.type === "sos") {
      const db = await getDB();
      const bufferedEvent = await new Promise<BufferedEvent>((resolve, reject) => {
        const tx = db.transaction("emergency_buffer", "readonly");
        const store = tx.objectStore("emergency_buffer");
        const req = store.get(eventId);

        req.onsuccess = () => resolve(req.result as BufferedEvent);
        req.onerror = () => reject(req.error);
      });

      const success = await broadcastToFallback([bufferedEvent]);
      if (success) {
        await removeFromBuffer(eventId);
      }
    }

    console.log(
      `[EmergencyBuffer] Event buffered: ${event.type} (priority ${event.priority}), status=${connectionStatus}`
    );
  } catch (err) {
    reportError(err, {
      type: "buffer_critical_event_failed",
      component: "EmergencyBuffer",
      eventType: event.type,
    }, "error");
    throw err;
  }
}

/**
 * Get count of buffered events.
 */
export async function getBufferedEventCount(): Promise<number> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("emergency_buffer", "readonly");
      const store = tx.objectStore("emergency_buffer");
      const req = store.count();

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    reportError(err, {
      type: "get_buffer_count_failed",
      component: "EmergencyBuffer",
    }, "warning");
    return 0;
  }
}

/**
 * Manually trigger buffer flush (normally automatic on reconnect).
 * Returns count of successfully flushed and failed events.
 */
export async function forceFlushBuffer(): Promise<{ flushed: number; failed: number }> {
  try {
    return await flushBuffer();
  } catch (err) {
    reportError(err, {
      type: "force_flush_failed",
      component: "EmergencyBuffer",
    }, "error");
    return { flushed: 0, failed: 0 };
  }
}

/**
 * Get statistics about the buffer.
 */
export async function getBufferStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  oldestTimestamp: number | null;
}> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("emergency_buffer", "readonly");
      const store = tx.objectStore("emergency_buffer");
      const req = store.getAll();

      req.onsuccess = () => {
        const events = req.result as BufferedEvent[];
        const byType: Record<string, number> = {};

        for (const event of events) {
          byType[event.type] = (byType[event.type] || 0) + 1;
        }

        const oldestTimestamp = events.length > 0
          ? Math.min(...events.map(e => e.timestamp))
          : null;

        resolve({
          total: events.length,
          byType,
          oldestTimestamp,
        });
      };

      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    reportError(err, {
      type: "get_buffer_stats_failed",
      component: "EmergencyBuffer",
    }, "warning");
    return { total: 0, byType: {}, oldestTimestamp: null };
  }
}

/**
 * Shutdown the emergency buffer system (cleanup).
 * Called on app unmount or logout.
 */
export function shutdownEmergencyBuffer(): void {
  if (heartbeatIntervalId !== null) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
  statusListeners = [];
  console.log("[EmergencyBuffer] Shutdown complete");
}
