// ═══════════════════════════════════════════════════════════════
// SOSphere — IndexedDB Offline Database Layer
// ─────────────────────────────────────────────────────────────
// Replaces localStorage for critical safety data storage.
// IndexedDB provides:
//  • 100MB-1GB+ storage (vs 5MB localStorage)
//  • Asynchronous non-blocking I/O
//  • Structured data with indexes for fast queries
//  • Transaction support (ACID-like)
//  • Works fully offline
//
// Stores:
//  1. sos_queue      — SOS alerts waiting to sync
//  2. checkins       — Check-in records
//  3. gps_trail      — GPS breadcrumbs (up to 50,000 points)
//  4. incidents      — Incident reports + photos
//  5. messages       — Emergency chat messages
//  6. sync_log       — Sync history + conflict resolution log
//  7. app_cache      — Cached API responses for offline reads
// ═══════════════════════════════════════════════════════════════

const DB_NAME = "sosphere_offline";
const DB_VERSION = 2;

// ── Store Schemas ──────────────────────────────────────────────

export interface SOSRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  zone: string;
  lat: number;
  lng: number;
  accuracy: number;
  triggerMethod: "manual" | "fall_detected" | "shake" | "missed_checkin" | "panic_word";
  severity: "critical" | "high" | "medium" | "low";
  timestamp: number;
  synced: boolean;
  syncAttempts: number;
  lastSyncAttempt: number | null;
  networkStatusAtTrigger: "online" | "offline";
  batteryLevel: number | null;
  metadata: Record<string, any>;
}

export interface CheckinRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  zone: string;
  type: "scheduled" | "manual" | "auto";
  status: "ok" | "help" | "missed";
  lat: number | null;
  lng: number | null;
  timestamp: number;
  synced: boolean;
  syncAttempts: number;
}

export interface GPSPoint {
  id: string;
  employeeId: string;
  lat: number;
  lng: number;
  altitude: number | null;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
  synced: boolean;
  batteryLevel: number | null;
  source: "gps" | "network" | "dead_reckoning";
}

export interface IncidentRecord {
  id: string;
  employeeId: string;
  type: string;
  description: string;
  severity: string;
  lat: number | null;
  lng: number | null;
  photoBlobs: string[]; // base64 encoded
  timestamp: number;
  synced: boolean;
  syncAttempts: number;
}

export interface OfflineMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  type: "text" | "location" | "sos_update" | "voice_note";
  timestamp: number;
  synced: boolean;
}

export interface SyncLogEntry {
  id: string;
  store: string;
  recordId: string;
  action: "push" | "pull" | "conflict_resolved";
  status: "success" | "failed" | "pending";
  timestamp: number;
  error: string | null;
  conflictResolution: string | null;
}

export interface CachedResponse {
  id: string; // url or cache key
  data: any;
  cachedAt: number;
  expiresAt: number;
  etag: string | null;
}

// ── Database Initialization ────────────────────────────────────

let dbInstance: IDBDatabase | null = null;
let dbInitPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // ── SOS Queue Store ──
      if (!db.objectStoreNames.contains("sos_queue")) {
        const sosStore = db.createObjectStore("sos_queue", { keyPath: "id" });
        sosStore.createIndex("by_synced", "synced", { unique: false });
        sosStore.createIndex("by_timestamp", "timestamp", { unique: false });
        sosStore.createIndex("by_severity", "severity", { unique: false });
        sosStore.createIndex("by_employee", "employeeId", { unique: false });
      }

      // ── Check-ins Store ──
      if (!db.objectStoreNames.contains("checkins")) {
        const ciStore = db.createObjectStore("checkins", { keyPath: "id" });
        ciStore.createIndex("by_synced", "synced", { unique: false });
        ciStore.createIndex("by_timestamp", "timestamp", { unique: false });
        ciStore.createIndex("by_employee", "employeeId", { unique: false });
      }

      // ── GPS Trail Store ──
      if (!db.objectStoreNames.contains("gps_trail")) {
        const gpsStore = db.createObjectStore("gps_trail", { keyPath: "id" });
        gpsStore.createIndex("by_synced", "synced", { unique: false });
        gpsStore.createIndex("by_timestamp", "timestamp", { unique: false });
        gpsStore.createIndex("by_employee", "employeeId", { unique: false });
      }

      // ── Incidents Store ──
      if (!db.objectStoreNames.contains("incidents")) {
        const incStore = db.createObjectStore("incidents", { keyPath: "id" });
        incStore.createIndex("by_synced", "synced", { unique: false });
        incStore.createIndex("by_timestamp", "timestamp", { unique: false });
      }

      // ── Messages Store ──
      if (!db.objectStoreNames.contains("messages")) {
        const msgStore = db.createObjectStore("messages", { keyPath: "id" });
        msgStore.createIndex("by_synced", "synced", { unique: false });
        msgStore.createIndex("by_timestamp", "timestamp", { unique: false });
        msgStore.createIndex("by_sender", "senderId", { unique: false });
      }

      // ── Sync Log Store ──
      if (!db.objectStoreNames.contains("sync_log")) {
        const logStore = db.createObjectStore("sync_log", { keyPath: "id" });
        logStore.createIndex("by_timestamp", "timestamp", { unique: false });
        logStore.createIndex("by_status", "status", { unique: false });
      }

      // ── App Cache Store ──
      if (!db.objectStoreNames.contains("app_cache")) {
        const cacheStore = db.createObjectStore("app_cache", { keyPath: "id" });
        cacheStore.createIndex("by_expires", "expiresAt", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;

      // Handle connection close (browser may close DB)
      dbInstance.onclose = () => {
        dbInstance = null;
        dbInitPromise = null;
      };

      resolve(dbInstance);
    };

    request.onerror = () => {
      dbInitPromise = null;
      console.error("[OfflineDB] Failed to open IndexedDB:", request.error);
      reject(request.error);
    };
  });

  return dbInitPromise;
}

// ── Generic CRUD Operations ────────────────────────────────────

async function dbPut<T>(storeName: string, record: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGet<T>(storeName: string, id: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(value);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName: string, id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbCount(storeName: string, indexName?: string, value?: IDBValidKey | boolean): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const target = indexName ? store.index(indexName) : store;
    try {
      // IDB doesn't support boolean keys — convert to 0/1
      const key = typeof value === "boolean" ? (value ? 1 : 0) : value;
      const req = key !== undefined ? target.count(key) : target.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0); // graceful fallback
    } catch {
      // If index doesn't exist or key is invalid, return 0
      resolve(0);
    }
  });
}

async function dbClear(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Bulk Operations (for efficient GPS sync) ───────────────────

async function dbBulkPut<T>(storeName: string, records: T[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    records.forEach(r => store.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDeleteBulk(storeName: string, ids: string[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    ids.forEach(id => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── ID Generator ───────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ═══════════════════════════════════════════════════════════════
// Public API — SOS Queue
// ══════════════════════════════════════════════════════════════

export async function queueSOS(data: Omit<SOSRecord, "id" | "synced" | "syncAttempts" | "lastSyncAttempt">): Promise<string> {
  const id = genId("SOS");
  const record: SOSRecord = {
    ...data,
    id,
    synced: false,
    syncAttempts: 0,
    lastSyncAttempt: null,
  };
  await dbPut("sos_queue", record);
  await logSync("sos_queue", id, "push", "pending");
  return id;
}

export async function getUnsyncedSOS(): Promise<SOSRecord[]> {
  // Use index instead of loading all records — only fetches unsynced
  return dbGetByIndex<SOSRecord>("sos_queue", "by_synced", false);
}

export async function getAllSOS(): Promise<SOSRecord[]> {
  const all = await dbGetAll<SOSRecord>("sos_queue");
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

export async function markSOSSynced(id: string): Promise<void> {
  const record = await dbGet<SOSRecord>("sos_queue", id);
  if (record) {
    record.synced = true;
    record.lastSyncAttempt = Date.now();
    await dbPut("sos_queue", record);
    await logSync("sos_queue", id, "push", "success");
  }
}

export async function incrementSOSRetry(id: string, error: string): Promise<void> {
  const record = await dbGet<SOSRecord>("sos_queue", id);
  if (record) {
    record.syncAttempts += 1;
    record.lastSyncAttempt = Date.now();
    await dbPut("sos_queue", record);
    await logSync("sos_queue", id, "push", "failed", error);
  }
}

// ═══════════════════════════════════════════════════════════════
// Public API — Check-ins
// ═══════════════════════════════════════════════════════════════

export async function queueCheckin(data: Omit<CheckinRecord, "id" | "synced" | "syncAttempts">): Promise<string> {
  const id = genId("CI");
  await dbPut("checkins", { ...data, id, synced: false, syncAttempts: 0 });
  return id;
}

export async function getUnsyncedCheckins(): Promise<CheckinRecord[]> {
  // Use index — avoids loading synced records into memory
  return dbGetByIndex<CheckinRecord>("checkins", "by_synced", false);
}

export async function markCheckinSynced(id: string): Promise<void> {
  const record = await dbGet<CheckinRecord>("checkins", id);
  if (record) {
    record.synced = true;
    await dbPut("checkins", record);
  }
}

// ══════════════════════════════════════════════════════════════
// Public API — GPS Trail
// ═══════════════════════════════════════════════════════════════

const MAX_GPS_POINTS = 50000; // ~50K points before auto-cleanup

export async function recordGPSPoint(data: Omit<GPSPoint, "id" | "synced">): Promise<string> {
  const id = genId("GPS");
  await dbPut("gps_trail", { ...data, id, synced: false });

  // Auto-cleanup: remove oldest synced points if over limit
  const total = await dbCount("gps_trail");
  if (total > MAX_GPS_POINTS) {
    await pruneOldGPSPoints(Math.floor(MAX_GPS_POINTS * 0.2)); // remove 20% oldest synced
  }

  return id;
}

export async function recordGPSBatch(points: Omit<GPSPoint, "id" | "synced">[]): Promise<void> {
  const records = points.map(p => ({
    ...p,
    id: genId("GPS"),
    synced: false,
  }));
  await dbBulkPut("gps_trail", records);
}

export async function getUnsyncedGPS(): Promise<GPSPoint[]> {
  // Use index — critical for 50K+ GPS points, avoids loading everything
  return dbGetByIndex<GPSPoint>("gps_trail", "by_synced", false);
}

export async function markGPSBatchSynced(ids: string[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("gps_trail", "readwrite");
    const store = tx.objectStore("gps_trail");
    ids.forEach(id => {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          req.result.synced = true;
          store.put(req.result);
        }
      };
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getGPSTrailCount(): Promise<{ total: number; unsynced: number }> {
  // Use dbCount with index instead of loading all records
  const [total, unsynced] = await Promise.all([
    dbCount("gps_trail"),
    dbCount("gps_trail", "by_synced", false),
  ]);
  return { total, unsynced };
}

async function pruneOldGPSPoints(count: number): Promise<void> {
  // Use cursor on timestamp index — only loads synced records, oldest first
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("gps_trail", "readwrite");
    const store = tx.objectStore("gps_trail");
    const index = store.index("by_timestamp");
    const req = index.openCursor(); // ascending = oldest first
    let deleted = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || deleted >= count) { resolve(); return; }
      if (cursor.value.synced) {
        cursor.delete();
        deleted++;
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

// Get recent GPS trail for offline map display
export async function getRecentGPSTrail(limit: number = 200): Promise<GPSPoint[]> {
  // Use cursor in reverse on timestamp index — avoids loading all 50K points
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("gps_trail", "readonly");
    const store = tx.objectStore("gps_trail");
    const index = store.index("by_timestamp");
    const req = index.openCursor(null, "prev"); // descending = newest first
    const results: GPSPoint[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || results.length >= limit) { resolve(results); return; }
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// ═══════════════════════════════════════════════════════════════
// Public API — Incidents
// ═══════════════════════════════════════════════════════════════

export async function queueIncident(data: Omit<IncidentRecord, "id" | "synced" | "syncAttempts">): Promise<string> {
  const id = genId("INC");
  await dbPut("incidents", { ...data, id, synced: false, syncAttempts: 0 });
  return id;
}

export async function getUnsyncedIncidents(): Promise<IncidentRecord[]> {
  // Use index
  return dbGetByIndex<IncidentRecord>("incidents", "by_synced", false);
}

export async function markIncidentSynced(id: string): Promise<void> {
  const record = await dbGet<IncidentRecord>("incidents", id);
  if (record) {
    record.synced = true;
    await dbPut("incidents", record);
  }
}

// ═══════════════════════════════════════════════════════════════
// Public API — Offline Messages
// ═══════════════════════════════════════════════════════════════

export async function queueMessage(data: Omit<OfflineMessage, "id" | "synced">): Promise<string> {
  const id = genId("MSG");
  await dbPut("messages", { ...data, id, synced: false });
  return id;
}

export async function getUnsyncedMessages(): Promise<OfflineMessage[]> {
  // Use index
  return dbGetByIndex<OfflineMessage>("messages", "by_synced", false);
}

export async function markMessageSynced(id: string): Promise<void> {
  const record = await dbGet<OfflineMessage>("messages", id);
  if (record) {
    record.synced = true;
    await dbPut("messages", record);
  }
}

// ═══════════════════════════════════════════════════════════════
// Public API — Sync Log
// ═══════════════════════════════════════════════════════════════

async function logSync(store: string, recordId: string, action: SyncLogEntry["action"], status: SyncLogEntry["status"], error?: string): Promise<void> {
  await dbPut("sync_log", {
    id: genId("LOG"),
    store,
    recordId,
    action,
    status,
    timestamp: Date.now(),
    error: error || null,
    conflictResolution: null,
  });
}

export async function getRecentSyncLog(limit: number = 50): Promise<SyncLogEntry[]> {
  // Use cursor in reverse on timestamp index
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_log", "readonly");
    const store = tx.objectStore("sync_log");
    const index = store.index("by_timestamp");
    const req = index.openCursor(null, "prev");
    const results: SyncLogEntry[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || results.length >= limit) { resolve(results); return; }
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// ═══════════════════════════════════════════════════════════════
// Public API — App Cache (for offline reads)
// ═══════════════════════════════════════════════════════════════

export async function cacheResponse(key: string, data: any, ttlMs: number = 3600000): Promise<void> {
  await dbPut("app_cache", {
    id: key,
    data,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    etag: null,
  });
}

export async function getCachedResponse<T>(key: string): Promise<T | null> {
  const record = await dbGet<CachedResponse>("app_cache", key);
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    await dbDelete("app_cache", key);
    return null;
  }
  return record.data as T;
}

// ═══════════════════════════════════════════════════════════════
// Storage Stats — for UI display
// ═══════════════════════════════════════════════════════════════

export interface OfflineStorageStats {
  sosQueue: number;
  sosUnsynced: number;
  checkins: number;
  checkinsUnsynced: number;
  gpsPoints: number;
  gpsUnsynced: number;
  incidents: number;
  incidentsUnsynced: number;
  messages: number;
  messagesUnsynced: number;
  syncLogEntries: number;
  estimatedSizeMB: number;
  storageQuotaMB: number | null;
}

export async function getStorageStats(): Promise<OfflineStorageStats> {
  try {
    // Use dbCount + index queries instead of loading all records into memory
    // Previous implementation loaded ALL 50K+ GPS points just to count them
    const [
      sosTotal, sosUnsynced,
      ciTotal, ciUnsynced,
      gpsTotal, gpsUnsynced,
      incTotal, incUnsynced,
      msgTotal, msgUnsynced,
      logCount,
    ] = await Promise.all([
      dbCount("sos_queue"), dbCount("sos_queue", "by_synced", false),
      dbCount("checkins"), dbCount("checkins", "by_synced", false),
      dbCount("gps_trail"), dbCount("gps_trail", "by_synced", false),
      dbCount("incidents"), dbCount("incidents", "by_synced", false),
      dbCount("messages"), dbCount("messages", "by_synced", false),
      dbCount("sync_log"),
    ]);

    // Estimate storage via Storage API (fast, no serialization needed)
    // Previous impl serialized all data to JSON — O(n) memory + CPU for 50K records
    let estimatedSizeMB = 0;
    let storageQuotaMB: number | null = null;
    if ("storage" in navigator && "estimate" in (navigator.storage || {})) {
      try {
        const estimate = await navigator.storage.estimate();
        if (estimate.usage) {
          estimatedSizeMB = Math.round((estimate.usage / (1024 * 1024)) * 100) / 100;
        }
        if (estimate.quota) {
          storageQuotaMB = Math.round(estimate.quota / (1024 * 1024));
        }
      } catch { /* ignore */ }
    }
    // Fallback: rough estimate from record counts (~200 bytes per GPS point, ~500 per SOS/checkin/etc)
    if (estimatedSizeMB === 0) {
      const roughBytes = (gpsTotal * 200) + ((sosTotal + ciTotal + incTotal + msgTotal) * 500);
      estimatedSizeMB = Math.round((roughBytes / (1024 * 1024)) * 100) / 100;
    }

    return {
      sosQueue: sosTotal,
      sosUnsynced,
      checkins: ciTotal,
      checkinsUnsynced: ciUnsynced,
      gpsPoints: gpsTotal,
      gpsUnsynced,
      incidents: incTotal,
      incidentsUnsynced: incUnsynced,
      messages: msgTotal,
      messagesUnsynced: msgUnsynced,
      syncLogEntries: logCount,
      estimatedSizeMB,
      storageQuotaMB,
    };
  } catch (err) {
    console.error("[OfflineDB] Failed to get storage stats:", err);
    return {
      sosQueue: 0, sosUnsynced: 0,
      checkins: 0, checkinsUnsynced: 0,
      gpsPoints: 0, gpsUnsynced: 0,
      incidents: 0, incidentsUnsynced: 0,
      messages: 0, messagesUnsynced: 0,
      syncLogEntries: 0,
      estimatedSizeMB: 0,
      storageQuotaMB: null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// Danger Zone — Full Reset
// ═══════════════════════════════════════════════════════════════

export async function resetOfflineDatabase(): Promise<void> {
  await Promise.all([
    dbClear("sos_queue"),
    dbClear("checkins"),
    dbClear("gps_trail"),
    dbClear("incidents"),
    dbClear("messages"),
    dbClear("sync_log"),
    dbClear("app_cache"),
  ]);
}

// Initialize DB on import
openDB().catch(err => console.warn("[OfflineDB] Init warning:", err));