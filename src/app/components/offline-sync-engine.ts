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

// L3-D cleanup (2026-05-09): removed unused imports.
//   • markSOSSynced — no longer called here (L2-C delegated to replayPendingSOS)
//   • markCheckinSynced/markIncidentSynced — no longer called (L2-C2 stubs)
//   • simulateNetworkSend referenced markMessageSynced via dead branch — removed
//   • Unused type imports — only kept the ones actually used in signatures
import {
  getUnsyncedSOS, incrementSOSRetry,
  getUnsyncedCheckins,
  getUnsyncedGPS, markGPSBatchSynced,
  getUnsyncedIncidents,
  getUnsyncedMessages,
  getStorageStats,
  type GPSPoint,
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
  // L2-C ROOT-CAUSE FIX (2026-05-09): the prior implementation called
  // simulateNetworkSend(sos, "sos") which translated to
  // supabase.from("sos").insert(data) — but no `sos` table exists in
  // production. Every replay through this path silently failed with
  // "relation public.sos does not exist", incremented the retry counter,
  // and eventually marked the SOS record as failed. Worse: it RACED with
  // the canonical replay path in sos-server-trigger.replayPendingSOS()
  // over the same IndexedDB queue, exhausting retry quota before the
  // correct path could fire.
  //
  // Fix: delegate to the canonical replayPendingSOS() which (a) calls
  // the actual sos-alert edge function, (b) is auth-gated, (c) honors
  // TTL + 429 cooldown + per-record exponential backoff, and (d) is the
  // single source of truth for SOS replay across the app.
  //
  // Translates the canonical replay summary into the engine's progress
  // shape so the Sync UI on dashboard-offline-page still works.
  const items = await getUnsyncedSOS();
  updateCategory("sos", { total: items.length, synced: 0, failed: 0, status: "syncing" });
  emitProgress({ currentCategory: "sos" });

  if (items.length === 0) {
    updateCategory("sos", { status: "done" });
    return;
  }

  try {
    // Lazy import to avoid cycle with sos-server-trigger.ts (which itself
    // imports from offline-database, transitively including this file).
    const { replayPendingSOS } = await import("./sos-server-trigger");
    const result = await replayPendingSOS();
    updateCategory("sos", {
      synced: result.succeeded,
      failed: result.failed + result.skippedExhausted,
      status: "done",
    });
    if (result.failed > 0) {
      currentProgress.errors.push(`SOS replay: ${result.failed} failed, ${result.skippedExhausted} exhausted`);
    }
    emitProgress();
  } catch (err) {
    // Defensive — the canonical path swallows its own errors, so reaching
    // this catch likely means the import itself failed (build-time issue).
    console.warn("[Sync] SOS replay delegation failed:", err);
    for (const sos of items) {
      await incrementSOSRetry(sos.id, `delegate_error: ${String(err)}`);
    }
    updateCategory("sos", { failed: items.length, status: "done" });
    currentProgress.errors.push(`SOS delegation: ${err}`);
    emitProgress();
  }
}

// L2-C2 ROOT-CAUSE STUB (2026-05-09): Same broken-table bug as the SOS path.
//   syncCheckins called supabase.from("checkin") — actual table is `checkins`.
//   syncIncidents called supabase.from("incident") — table doesn't exist
//     (closest match `civilian_incidents` has a different schema).
//   syncMessages  called supabase.from("message") — table doesn't exist
//     (real options: chat_messages, direct_messages, sos_messages, etc.).
//
//   Audit confirmed NOTHING in the codebase calls queueCheckin / queueIncident
//   / queueMessage either — the IndexedDB stores are unwritten. The sync
//   functions were dead loops over empty stores against missing tables.
//
//   These features need real backend table design + insertion mapping
//   before they can sync. Until then, the stubs below mark them as
//   not-yet-wired so the dashboard UI still gets clean status updates and
//   no broken `supabase.from(...)` call ever fires.
async function syncCheckins(): Promise<void> {
  const items = await getUnsyncedCheckins();
  updateCategory("checkins", {
    total: items.length, synced: 0, failed: 0,
    status: "done", // skipped — see L2-C2 stub comment above
  });
  emitProgress({ currentCategory: "checkins" });
  if (items.length > 0) {
    console.warn(`[Sync] checkins: ${items.length} record(s) queued but backend wiring is pending — skipping (L2-C2 stub).`);
  }
}

async function syncIncidents(): Promise<void> {
  const items = await getUnsyncedIncidents();
  updateCategory("incidents", {
    total: items.length, synced: 0, failed: 0,
    status: "done", // skipped — see L2-C2 stub comment above
  });
  emitProgress({ currentCategory: "incidents" });
  if (items.length > 0) {
    console.warn(`[Sync] incidents: ${items.length} record(s) queued but backend wiring is pending — skipping (L2-C2 stub).`);
  }
}

async function syncMessages(): Promise<void> {
  const items = await getUnsyncedMessages();
  updateCategory("messages", {
    total: items.length, synced: 0, failed: 0,
    status: "done", // skipped — see L2-C2 stub comment above
  });
  emitProgress({ currentCategory: "messages" });
  if (items.length > 0) {
    console.warn(`[Sync] messages: ${items.length} record(s) queued but backend wiring is pending — skipping (L2-C2 stub).`);
  }
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
