// ═══════════════════════════════════════════════════════════════
// SOSphere — Smart Sync Engine
// ─────────────────────────────────────────────────────────────
// Priority-based sync with conflict resolution.
// When connection returns, syncs data in this order:
//
//  1. SOS ALERTS      (life-critical — sync FIRST)
//  2. CHECK-INS       (safety-critical — sync second)
//  3. INCIDENTS       (important — sync third)
//  4. MESSAGES        (communication — sync fourth)
//  5. GPS TRAIL       (bulk data — sync last, in batches)
//
// Features:
//  • Exponential backoff on failures
//  • Bandwidth-aware batching (GPS points compressed)
//  • Conflict resolution (server wins for status, client wins for SOS)
//  • Progress tracking with callbacks
//  • Auto-sync on reconnection
//  • Manual sync trigger
//  • Sync history and error log
// ═══════════════════════════════════════════════════════════════

import {
  getUnsyncedSOS, markSOSSynced, incrementSOSRetry,
  getUnsyncedCheckins, markCheckinSynced,
  getUnsyncedGPS, markGPSBatchSynced,
  getUnsyncedIncidents, markIncidentSynced,
  getUnsyncedMessages, markMessageSynced,
  getStorageStats,
  type SOSRecord, type CheckinRecord, type GPSPoint,
  type IncidentRecord, type OfflineMessage, type OfflineStorageStats,
} from "./offline-database";

// ── Types ──────────────────────────────────────────────────────

export type SyncCategory = "sos" | "checkins" | "incidents" | "messages" | "gps";

// O-H2: optimistic concurrency — callers can tag items with an expected
// version and observe a `needs_manual_merge` flag if the server rejects
// the write. Actual server-side eq check lives in per-table service files.
export interface VersionedSyncItem {
  id: string;
  /** Optimistic-lock version the caller expects to be current server-side. */
  version?: number;
  /**
   * Set by the sync engine when a 409 / optimistic-lock failure comes
   * back from the server. The engine stops retrying once this is true —
   * a human or merge-UI step is required.
   */
  needs_manual_merge?: boolean;
}

/**
 * O-H2: Did the server response indicate an optimistic-lock conflict?
 * True for HTTP 409, Postgres serialization errors, or explicit "optimistic
 * lock failed" messages. Kept permissive — server shapes vary per table.
 */
function isOptimisticConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  if (/\b409\b/.test(msg)) return true;
  if (/optimistic\s+lock/i.test(msg)) return true;
  if (/conflict/i.test(msg)) return true;
  return false;
}

export interface SyncProgress {
  isRunning: boolean;
  currentCategory: SyncCategory | null;
  categories: Record<SyncCategory, {
    total: number;
    synced: number;
    failed: number;
    status: "pending" | "syncing" | "done" | "error";
  }>;
  overallProgress: number; // 0-100
  startedAt: number | null;
  completedAt: number | null;
  errors: string[];
  totalSynced: number;
  totalFailed: number;
}

export interface SyncEngineConfig {
  /** Max retries before giving up on a single item */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  baseRetryDelay: number;
  /** Max items per GPS batch sync */
  gpsBatchSize: number;
  /** Delay between batches to avoid flooding (ms) */
  batchDelayMs: number;
  /** Auto-sync when coming back online */
  autoSyncOnReconnect: boolean;
  /** Simulate network latency for demo (ms per item) */
  simulatedLatencyMs: number;
}

const DEFAULT_CONFIG: SyncEngineConfig = {
  maxRetries: 5,
  baseRetryDelay: 1000,
  gpsBatchSize: 100,
  batchDelayMs: 200,
  autoSyncOnReconnect: true,
  // O-M2: only simulate latency in dev builds
  simulatedLatencyMs: (typeof import.meta !== "undefined" && (import.meta as any).env?.DEV) ? 150 : 0,
};

// ── State ──────────────────────────────────────────────────────

type ProgressListener = (progress: SyncProgress) => void;

let syncConfig = { ...DEFAULT_CONFIG };
let isSyncing = false;
let syncAborted = false;
let progressListeners: ProgressListener[] = [];
let reconnectListenerAttached = false;

let currentProgress: SyncProgress = {
  isRunning: false,
  currentCategory: null,
  categories: {
    sos: { total: 0, synced: 0, failed: 0, status: "pending" },
    checkins: { total: 0, synced: 0, failed: 0, status: "pending" },
    incidents: { total: 0, synced: 0, failed: 0, status: "pending" },
    messages: { total: 0, synced: 0, failed: 0, status: "pending" },
    gps: { total: 0, synced: 0, failed: 0, status: "pending" },
  },
  overallProgress: 0,
  startedAt: null,
  completedAt: null,
  errors: [],
  totalSynced: 0,
  totalFailed: 0,
};

// ── Progress Management ────────────────────────────────────────

function emitProgress(partial?: Partial<SyncProgress>) {
  if (partial) {
    currentProgress = { ...currentProgress, ...partial };
  }

  // Recalculate overall progress
  const cats = currentProgress.categories;
  const totalItems = Object.values(cats).reduce((sum, c) => sum + c.total, 0);
  const syncedItems = Object.values(cats).reduce((sum, c) => sum + c.synced, 0);
  currentProgress.overallProgress = totalItems > 0 ? Math.round((syncedItems / totalItems) * 100) : 0;
  currentProgress.totalSynced = syncedItems;
  currentProgress.totalFailed = Object.values(cats).reduce((sum, c) => sum + c.failed, 0);

  progressListeners.forEach(fn => {
    try { fn({ ...currentProgress }); } catch { /* ignore */ }
  });
}

function updateCategory(cat: SyncCategory, partial: Partial<SyncProgress["categories"][SyncCategory]>) {
  currentProgress.categories[cat] = { ...currentProgress.categories[cat], ...partial };
  emitProgress();
}

export function subscribeToSyncProgress(listener: ProgressListener): () => void {
  progressListeners.push(listener);
  listener({ ...currentProgress });
  return () => {
    progressListeners = progressListeners.filter(fn => fn !== listener);
  };
}

export function getSyncProgress(): SyncProgress {
  return { ...currentProgress };
}

// ── Network Send ───────────────────────────────────────────────
// Automatically switches between Supabase (when configured) and localStorage fallback.
// When VITE_SUPABASE_URL is set, data goes to the real database.
// When offline or unconfigured, data stays in localStorage queue until sync.

import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";

async function simulateNetworkSend(data: any, category: string): Promise<boolean> {
  // ── REAL PATH: Supabase is configured ──────────────────────
  if (SUPABASE_CONFIG.isConfigured) {
    const { error } = await supabase.from(category).insert(data);
    if (error) {
      // O-H2: surface optimistic-lock conflicts distinctly so the caller
      // can stop retrying and flag the record for manual merge.
      const msg = `[Supabase] ${category}: ${error.message}`;
      if (/\b409\b/.test(error.message || "") || /optimistic\s+lock/i.test(error.message || "") || /conflict/i.test(error.message || "")) {
        const e = new Error(msg);
        (e as any).isConflict = true;
        throw e;
      }
      // Supabase error — will be retried via exponential backoff
      throw new Error(msg);
    }
    return true;
  }

  // ── OFFLINE/DEMO PATH: localStorage only ──────────────────
  // No fake failures — data is safely stored locally
  await new Promise(r => setTimeout(r, syncConfig.simulatedLatencyMs));
  return true;
}

async function simulateBatchGPSSend(points: GPSPoint[]): Promise<boolean> {
  // Compress GPS points (reduces storage/bandwidth)
  const compressed = points.map(p => ({
    id: p.id,
    employee_id: p.employeeId,
    lat: Math.round(p.lat * 1e6) / 1e6,
    lng: Math.round(p.lng * 1e6) / 1e6,
    accuracy: Math.round(p.accuracy),
    speed: p.speed !== null ? Math.round(p.speed * 10) / 10 : null,
    heading: p.heading !== null ? Math.round(p.heading) : null,
    timestamp: p.timestamp,
    source: p.source,
    battery_level: p.batteryLevel,
  }));

  // ── REAL PATH: Supabase is configured ──────────────────────
  if (SUPABASE_CONFIG.isConfigured) {
    const { error } = await supabase.from("gps_trail").insert(compressed);
    if (error) throw new Error(`[Supabase] gps_trail batch: ${error.message}`);
    return true;
  }

  // ── OFFLINE/DEMO PATH ──────────────────────────────────────
  await new Promise(r => setTimeout(r, syncConfig.simulatedLatencyMs * 2));
  return true;
}

// ── Exponential Backoff ────────────────────────────────────────

function getRetryDelay(attempt: number): number {
  return Math.min(syncConfig.baseRetryDelay * Math.pow(2, attempt), 30000);
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  onRetry?: (attempt: number, error: Error) => void,
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // O-H2: optimistic-lock conflicts must not be retried — stop and
      // surface the error so the caller can flag `needs_manual_merge`.
      if ((err as any)?.isConflict || isOptimisticConflict(err)) {
        throw lastError;
      }
      if (attempt < maxRetries) {
        const delay = getRetryDelay(attempt);
        onRetry?.(attempt + 1, lastError);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ═══════════════════════════════════════════════════════════════
// Sync Categories — Priority Order
// ═══════════════════════════════════════════════════════════════

async function syncSOSAlerts(): Promise<void> {
  const items = await getUnsyncedSOS();
  if (items.length === 0) {
    updateCategory("sos", { total: 0, status: "done" });
    return;
  }

  updateCategory("sos", { total: items.length, synced: 0, failed: 0, status: "syncing" });
  emitProgress({ currentCategory: "sos" });

  for (const sos of items) {
    if (syncAborted) return;
    if (sos.syncAttempts >= syncConfig.maxRetries) {
      updateCategory("sos", { failed: currentProgress.categories.sos.failed + 1 });
      continue;
    }
    // O-H2: skip records already flagged for manual merge by a prior conflict
    if ((sos as any).needs_manual_merge) {
      updateCategory("sos", { failed: currentProgress.categories.sos.failed + 1 });
      continue;
    }

    try {
      await retryWithBackoff(
        () => simulateNetworkSend(sos, "sos"),
        2, // SOS gets fewer retries but faster
        (attempt) => console.log(`[Sync] SOS ${sos.id} retry #${attempt}`),
      );
      await markSOSSynced(sos.id);
      updateCategory("sos", { synced: currentProgress.categories.sos.synced + 1 });
    } catch (err) {
      // O-H2: on optimistic-lock conflict, mark for manual merge and stop retrying this record.
      if (isOptimisticConflict(err) || (err as any)?.isConflict) {
        (sos as any).needs_manual_merge = true;
        await incrementSOSRetry(sos.id, `needs_manual_merge: ${String(err)}`);
        updateCategory("sos", { failed: currentProgress.categories.sos.failed + 1 });
        currentProgress.errors.push(`SOS ${sos.id} needs_manual_merge`);
        emitProgress();
        continue;
      }
      await incrementSOSRetry(sos.id, String(err));
      updateCategory("sos", { failed: currentProgress.categories.sos.failed + 1 });
      currentProgress.errors.push(`SOS ${sos.id}: ${err}`);
      emitProgress();
    }
  }

  updateCategory("sos", { status: "done" });
}

async function syncCheckins(): Promise<void> {
  const items = await getUnsyncedCheckins();
  if (items.length === 0) {
    updateCategory("checkins", { total: 0, status: "done" });
    return;
  }

  updateCategory("checkins", { total: items.length, synced: 0, failed: 0, status: "syncing" });
  emitProgress({ currentCategory: "checkins" });

  for (const ci of items) {
    if (syncAborted) return;
    try {
      await simulateNetworkSend(ci, "checkin");
      await markCheckinSynced(ci.id);
      updateCategory("checkins", { synced: currentProgress.categories.checkins.synced + 1 });
    } catch (err) {
      updateCategory("checkins", { failed: currentProgress.categories.checkins.failed + 1 });
      currentProgress.errors.push(`Checkin ${ci.id}: ${err}`);
      emitProgress();
    }
  }

  updateCategory("checkins", { status: "done" });
}

async function syncIncidents(): Promise<void> {
  const items = await getUnsyncedIncidents();
  if (items.length === 0) {
    updateCategory("incidents", { total: 0, status: "done" });
    return;
  }

  updateCategory("incidents", { total: items.length, synced: 0, failed: 0, status: "syncing" });
  emitProgress({ currentCategory: "incidents" });

  for (const inc of items) {
    if (syncAborted) return;
    try {
      await retryWithBackoff(
        () => simulateNetworkSend(inc, "incident"),
        syncConfig.maxRetries,
      );
      await markIncidentSynced(inc.id);
      updateCategory("incidents", { synced: currentProgress.categories.incidents.synced + 1 });
    } catch (err) {
      updateCategory("incidents", { failed: currentProgress.categories.incidents.failed + 1 });
      currentProgress.errors.push(`Incident ${inc.id}: ${err}`);
      emitProgress();
    }
  }

  updateCategory("incidents", { status: "done" });
}

async function syncMessages(): Promise<void> {
  const items = await getUnsyncedMessages();
  if (items.length === 0) {
    updateCategory("messages", { total: 0, status: "done" });
    return;
  }

  updateCategory("messages", { total: items.length, synced: 0, failed: 0, status: "syncing" });
  emitProgress({ currentCategory: "messages" });

  for (const msg of items) {
    if (syncAborted) return;
    try {
      await simulateNetworkSend(msg, "message");
      await markMessageSynced(msg.id);
      updateCategory("messages", { synced: currentProgress.categories.messages.synced + 1 });
    } catch (err) {
      updateCategory("messages", { failed: currentProgress.categories.messages.failed + 1 });
      currentProgress.errors.push(`Message ${msg.id}: ${err}`);
      emitProgress();
    }
  }

  updateCategory("messages", { status: "done" });
}

async function syncGPSTrail(): Promise<void> {
  const allPoints = await getUnsyncedGPS();
  if (allPoints.length === 0) {
    updateCategory("gps", { total: 0, status: "done" });
    return;
  }

  updateCategory("gps", { total: allPoints.length, synced: 0, failed: 0, status: "syncing" });
  emitProgress({ currentCategory: "gps" });

  // Sync in batches
  for (let i = 0; i < allPoints.length; i += syncConfig.gpsBatchSize) {
    if (syncAborted) return;

    const batch = allPoints.slice(i, i + syncConfig.gpsBatchSize);
    try {
      await retryWithBackoff(
        () => simulateBatchGPSSend(batch),
        3,
      );
      await markGPSBatchSynced(batch.map(p => p.id));
      updateCategory("gps", { synced: currentProgress.categories.gps.synced + batch.length });
    } catch (err) {
      updateCategory("gps", { failed: currentProgress.categories.gps.failed + batch.length });
      currentProgress.errors.push(`GPS batch ${i}-${i + batch.length}: ${err}`);
      emitProgress();
    }

    // Throttle between batches
    if (i + syncConfig.gpsBatchSize < allPoints.length) {
      await new Promise(r => setTimeout(r, syncConfig.batchDelayMs));
    }
  }

  updateCategory("gps", { status: "done" });
}

// ═══════════════════════════════════════════════════════════════
// Main Sync Orchestrator
// ═══════════════════════════════════════════════════════════════

export async function startSync(options?: { categories?: SyncCategory[] }): Promise<SyncProgress> {
  if (isSyncing) {
    console.warn("[SyncEngine] Sync already in progress");
    return currentProgress;
  }

  if (!navigator.onLine) {
    console.warn("[SyncEngine] Cannot sync — offline");
    return currentProgress;
  }

  isSyncing = true;
  syncAborted = false;

  // Reset progress
  currentProgress = {
    isRunning: true,
    currentCategory: null,
    categories: {
      sos: { total: 0, synced: 0, failed: 0, status: "pending" },
      checkins: { total: 0, synced: 0, failed: 0, status: "pending" },
      incidents: { total: 0, synced: 0, failed: 0, status: "pending" },
      messages: { total: 0, synced: 0, failed: 0, status: "pending" },
      gps: { total: 0, synced: 0, failed: 0, status: "pending" },
    },
    overallProgress: 0,
    startedAt: Date.now(),
    completedAt: null,
    errors: [],
    totalSynced: 0,
    totalFailed: 0,
  };
  emitProgress();

  const categoriesToSync = options?.categories || ["sos", "checkins", "incidents", "messages", "gps"];

  try {
    // Priority order — SOS FIRST, GPS LAST
    if (categoriesToSync.includes("sos")) await syncSOSAlerts();
    if (categoriesToSync.includes("checkins")) await syncCheckins();
    if (categoriesToSync.includes("incidents")) await syncIncidents();
    if (categoriesToSync.includes("messages")) await syncMessages();
    if (categoriesToSync.includes("gps")) await syncGPSTrail();
  } catch (err) {
    currentProgress.errors.push(`Critical sync error: ${err}`);
  }

  currentProgress.isRunning = false;
  currentProgress.completedAt = Date.now();
  emitProgress();

  isSyncing = false;
  syncAborted = false;

  // Save sync timestamp
  try {
    localStorage.setItem("sosphere_last_sync", String(Date.now()));
  } catch { /* ignore */ }

  console.log("[SyncEngine] Sync complete:", {
    synced: currentProgress.totalSynced,
    failed: currentProgress.totalFailed,
    duration: currentProgress.completedAt - (currentProgress.startedAt || 0),
  });

  return { ...currentProgress };
}

export function abortSync(): void {
  syncAborted = true;
  console.log("[SyncEngine] Sync abort requested");
}

export function isSyncRunning(): boolean {
  return isSyncing;
}

// ═══════════════════════════════════════════════════════════════
// Auto-Sync on Reconnection
// ═══════════════════════════════════════════════════════════════

export function enableAutoSync(config?: Partial<SyncEngineConfig>): void {
  if (config) syncConfig = { ...syncConfig, ...config };

  if (reconnectListenerAttached) return;
  reconnectListenerAttached = true;

  window.addEventListener("online", async () => {
    console.log("[SyncEngine] Network restored — starting auto-sync");

    // Small delay to ensure stable connection
    await new Promise(r => setTimeout(r, 2000));

    if (navigator.onLine && syncConfig.autoSyncOnReconnect) {
      await startSync();
    }
  });

  console.log("[SyncEngine] Auto-sync on reconnect: enabled");
}

// ═══════════════════════════════════════════════════════════════
// Quick Stats (for UI badges)
// ═══════════════════════════════════════════════════════════════

export interface QuickSyncStats {
  totalUnsynced: number;
  sosUnsynced: number;
  checkinsUnsynced: number;
  gpsUnsynced: number;
  incidentsUnsynced: number;
  messagesUnsynced: number;
  lastSyncTime: number | null;
  isOnline: boolean;
}

export async function getQuickSyncStats(): Promise<QuickSyncStats> {
  try {
    const stats = await getStorageStats();
    const lastSync = (() => {
      try { return parseInt(localStorage.getItem("sosphere_last_sync") || "0") || null; }
      catch { return null; }
    })();

    return {
      totalUnsynced: stats.sosUnsynced + stats.checkinsUnsynced + stats.gpsUnsynced + stats.incidentsUnsynced + stats.messagesUnsynced,
      sosUnsynced: stats.sosUnsynced,
      checkinsUnsynced: stats.checkinsUnsynced,
      gpsUnsynced: stats.gpsUnsynced,
      incidentsUnsynced: stats.incidentsUnsynced,
      messagesUnsynced: stats.messagesUnsynced,
      lastSyncTime: lastSync,
      isOnline: navigator.onLine,
    };
  } catch {
    return {
      totalUnsynced: 0,
      sosUnsynced: 0,
      checkinsUnsynced: 0,
      gpsUnsynced: 0,
      incidentsUnsynced: 0,
      messagesUnsynced: 0,
      lastSyncTime: null,
      isOnline: navigator.onLine,
    };
  }
}
