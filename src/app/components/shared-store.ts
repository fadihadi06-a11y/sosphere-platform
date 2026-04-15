// ═══════════════════════════════════════════════════════════════
// SOSphere — Shared Data Bridge (Cross-Device Communication)
// Transport: Supabase Realtime (primary) + localStorage (offline fallback)
//
// API is IDENTICAL to the localStorage version.
// Components don't need to change — only this file changed.
// ═══════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";

// ── Supabase Realtime Channels ──────────────────────────────
// One channel per company — isolated from other companies
let _companyId: string | null = null;
let _syncChannel: ReturnType<typeof supabase.channel> | null = null;
let _adminChannel: ReturnType<typeof supabase.channel> | null = null;
let _evacChannel: ReturnType<typeof supabase.channel> | null = null;

/** Call this once after login with the company ID */
export function initRealtimeChannels(companyId: string) {
  // Validate companyId before creating channels
  if (!companyId || companyId.trim().length < 3) {
    console.warn("[Realtime] initRealtimeChannels called with invalid companyId:", companyId);
    return;
  }
  if (_companyId === companyId) return; // already initialized
  _companyId = companyId;

  // Cleanup old channels
  if (_syncChannel) supabase.removeChannel(_syncChannel);
  if (_adminChannel) supabase.removeChannel(_adminChannel);
  if (_evacChannel) supabase.removeChannel(_evacChannel);

  _syncChannel = supabase.channel(`sync:${companyId}`);
  _adminChannel = supabase.channel(`admin:${companyId}`);
  _evacChannel = supabase.channel(`evac:${companyId}`);

  _syncChannel.subscribe((status) => {
    if (status === "CHANNEL_ERROR") console.warn("[Realtime] sync channel error — retrying on next event");
  });
  _adminChannel.subscribe((status) => {
    if (status === "CHANNEL_ERROR") console.warn("[Realtime] admin channel error — retrying on next event");
  });
  _evacChannel.subscribe((status) => {
    if (status === "CHANNEL_ERROR") console.warn("[Realtime] evac channel error — retrying on next event");
  });

  console.log(`[Realtime] Channels initialized for company: ${companyId}`);

  // P3-#11 — drain any audit events that were logged before a company
  // was bound (e.g. during login) or while the network was unavailable.
  // Fire-and-forget: we don't block the realtime setup on it.
  void (async () => {
    try {
      const mod = await import("./audit-log-store");
      const flushed = await mod.flushAuditRetryQueue();
      if (flushed > 0) console.log(`[audit] flushed ${flushed} queued event(s)`);
    } catch { /* optional — never fatal */ }
  })();
}

export function getCompanyId() { return _companyId; }


export interface SyncEvent {
  type:
    | "SOS_TRIGGERED" | "SOS_CANCELLED" | "SOS_DURESS_TRIGGERED"
    | "CHECKIN" | "HAZARD_REPORT"
    | "STATUS_CHANGE" | "LOCATION_UPDATE"
    // Admin → Employee signals
    | "ADMIN_UNREACHABLE"    // Admin didn't answer 3 attempts → employee sees photo report
    | "ADMIN_ACKNOWLEDGED"   // Admin confirmed call connected
    | "INCIDENT_REPORT_RECEIVED" // Employee submitted photo/comment report
    // Advanced safety features
    | "FALL_DETECTED"        // Phone accelerometer detected a fall
    | "ESCALATION_UPDATE"    // Smart escalation level changed
    // Round 1 features
    | "SHAKE_SOS"            // Shake-to-SOS triggered
    | "EMERGENCY_CHAT"       // Emergency chat message
    | "AUDIO_EVIDENCE"       // Audio recording evidence uploaded
    // SOS Live Intelligence
    | "GPS_TRAIL_UPDATE"     // GPS trail point recorded during active SOS
    | "SOS_RECORDING_STARTED" // Ambient recording started after call ended
    | "SOS_CONTACT_ANSWERED" // First contact answered → location shared
    | "SOS_EVIDENCE_SUBMITTED" // Worker submitted photos/comment/recording as evidence
    | "STATUS_UPDATE"        // Employee status update (safe/busy/break)
    // SAR Protocol
    | "SAR_ACTIVATED"        // SAR mission started for missing worker
    | "SAR_WORKER_FOUND"     // Missing worker located
    | "CONNECTION_LOST"      // Worker connection lost (watchdog)
    // Buddy System
    | "BUDDY_ALERT"          // SOS triggered → alert buddy partner
    // FIX E: Post-Incident Monitoring
    | "MONITORING_ACTIVATED"  // Admin activated monitoring mode after minor incident
    | "MONITORING_CHECKIN"    // Employee submitted check-in during monitoring
    | "MONITORING_MISSED"     // Employee missed check-in (auto-escalate)
    | "MONITORING_CLEARED"    // Monitoring period ended successfully
    // Individual Safety
    | "PERSONAL_SOS"          // Individual (non-employee) SOS — notify emergency contacts
    // Safe Walk Mode
    | "SAFE_WALK_STARTED"     // Employee started safe walk with guardian
    | "SAFE_WALK_ENDED"       // Employee ended safe walk (arrived or cancelled)
    // Buddy System — Locate
    | "BUDDY_LOCATE_REQUEST"; // Admin requested GPS locate of a buddy
  employeeId: string;
  employeeName: string;
  zone?: string;
  timestamp: number;
  data?: Record<string, any>;
}

export interface AppActivity {
  id: string;
  employeeName: string;
  action: string;
  timestamp: number;
  zone?: string;
  severity?: "critical" | "high" | "medium" | "low";
  icon: string; // icon name key
}

const STORE_KEY = "sosphere_sync";
const ACTIVITY_KEY = "sosphere_activity";
const ADMIN_KEY = "sosphere_admin_signal"; // NEW: admin → employee channel

// FIX 12: localStorage quota protection — prune stale data when approaching limit
const KNOWN_KEYS_TO_PRUNE = [STORE_KEY, ACTIVITY_KEY, "sosphere_attendance", "sosphere_broadcasts", "sosphere_gps_zones"];
const QUOTA_THRESHOLD = 4 * 1024 * 1024; // 4MB — prune before hitting 5-10MB hard limit

// ── Shared Zone Names (single source of truth across all files) ─
export const ZONE_NAMES = {
  A: "Zone A - North Gate",
  B: "Zone B - Control Room",
  C: "Zone C - Warehouse",
  D: "Zone D - Warehouse",
  E: "Zone E - Outdoor",
} as const;

/* SUPABASE_MIGRATION_POINT: safety_kpi_source
   These KPI values are currently hardcoded mock data.
   Replace with real Supabase queries as noted below. */
export const SAFETY_KPI_SOURCE = {
  avgSafetyScore: "employees.safety_score average",
  complianceRate: "checkin_logs.compliance_rate",
  avgResponseTime: "emergencies.response_time average",
  note: "These values must come from Supabase queries — not hardcoded",
} as const;

// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// C4 FIX: IndexedDB fallback for SOS events when localStorage is full
// Priority: localStorage → IndexedDB → memoryFallbackQueue → banner
// SOS events are NEVER silently dropped — they survive page reload via IDB
// ═══════════════════════════════════════════════════════════════
const IDB_NAME = "sosphere_emergency";
const IDB_STORE = "sos_fallback";
const IDB_VERSION = 1;

let _idb: IDBDatabase | null = null;

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (_idb) { resolve(_idb); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => { _idb = (e.target as IDBOpenDBRequest).result; resolve(_idb!); };
    req.onerror = () => reject(req.error);
  });
}

/** Save SOS event to IndexedDB (survives page reload) */
async function saveToIDB(key: string, value: string): Promise<boolean> {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      store.add({ key, value, ts: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/** Read all pending IDB events (call on app start to replay missed SOS events) */
export async function drainIDBFallback(): Promise<{ key: string; value: string; ts: number }[]> {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const items: { key: string; value: string; ts: number }[] = [];
      store.openCursor().onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          items.push(cursor.value);
          cursor.delete(); // clear after reading
          cursor.continue();
        } else {
          resolve(items);
        }
      };
    });
  } catch {
    return [];
  }
}

// FIX AUDIT-3.4: Memory fallback queue + emergency banner
// If localStorage.setItem fails (quota exceeded), data is held
// in memory and a visible banner warns the user to call 911/999.
// ═══════════════════════════════════════════════════════════════
export const memoryFallbackQueue: { key: string; value: string; ts: number }[] = [];
const MAX_MEMORY_QUEUE = 100;

let _storageBannerVisible = false;
const _storageBannerCallbacks: ((visible: boolean, message: string) => void)[] = [];

/** Subscribe to storage failure banner state (used by UI components) */
export function onStorageBanner(cb: (visible: boolean, message: string) => void) {
  _storageBannerCallbacks.push(cb);
  return () => {
    const idx = _storageBannerCallbacks.indexOf(cb);
    if (idx >= 0) _storageBannerCallbacks.splice(idx, 1);
  };
}

function showStorageBanner(message: string) {
  _storageBannerVisible = true;
  for (const cb of _storageBannerCallbacks) cb(true, message);
}

export function isStorageBannerVisible() { return _storageBannerVisible; }

/** Safe wrapper around localStorage.setItem
 *  Priority: localStorage → IndexedDB (C4 FIX) → memoryQueue → banner
 *  SOS events are NEVER silently dropped.
 */
function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_e) {
    // localStorage full — try IndexedDB first (survives page reload)
    saveToIDB(key, value).then((saved) => {
      if (saved) {
        console.warn("[Storage] localStorage full — event saved to IndexedDB:", key);
        return;
      }
      // IDB also failed — last resort: memory queue
      if (memoryFallbackQueue.length < MAX_MEMORY_QUEUE) {
        memoryFallbackQueue.push({ key, value, ts: Date.now() });
      }
      showStorageBanner(
        "⚠️ Alert could not be saved — storage full. Please call emergency services directly (911/999/112)."
      );
    });
    // Return false so callers know localStorage failed
    return false;
  }
}

function checkAndPruneStorage(): void {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) total += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
    const estimatedBytes = total * 2; // UTF-16 = 2 bytes/char
    if (estimatedBytes > QUOTA_THRESHOLD) {
      for (const key of KNOWN_KEYS_TO_PRUNE) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 10) {
            localStorage.setItem(key, JSON.stringify(parsed.slice(-Math.ceil(parsed.length / 2))));
          }
        } catch { /* skip unparseable keys */ }
      }
    }
  } catch { /* localStorage unavailable */ }
}

// ── Emit event (from Mobile App) ──────────────────────────────
export function emitSyncEvent(event: SyncEvent) {
  const newEvent = { ...event, _ts: Date.now() };

  // PRIMARY: Supabase Realtime (cross-device)
  if (_syncChannel) {
    _syncChannel.send({
      type: "broadcast",
      event: "sync",
      payload: newEvent,
    }).catch(() => {
      // Realtime failed — fallback to localStorage below
    });
  }

  // SECONDARY: localStorage (same-device fallback + offline)
  checkAndPruneStorage();
  let queue: any[];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    queue = raw ? (Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)]) : [];
  } catch { queue = []; }
  queue.push(newEvent);
  if (queue.length > 50) queue = queue.slice(-50);
  const payload = JSON.stringify(queue);
  safeSetItem(STORE_KEY, payload);

  // Activity log
  const activities: AppActivity[] = getActivityLog();
  activities.unshift({
    id: `ACT-${Date.now()}`,
    employeeName: event.employeeName,
    action: formatEventType(event.type),
    timestamp: event.timestamp,
    zone: event.zone,
    severity: (event.type === "SOS_TRIGGERED" || event.type === "SOS_DURESS_TRIGGERED") ? "critical" : event.type === "HAZARD_REPORT" ? "high" : undefined,
    icon: getIconKey(event.type),
  });
  safeSetItem(ACTIVITY_KEY, JSON.stringify(activities.slice(0, 50)));
  window.dispatchEvent(new StorageEvent("storage", { key: STORE_KEY, newValue: payload }));
}

// ── Admin → Employee signal ──────────────────────────────────
export function emitAdminSignal(
  type: "ADMIN_UNREACHABLE" | "ADMIN_ACKNOWLEDGED" | "SAR_ACTIVATED" | "SAR_WORKER_FOUND" | "BUDDY_ALERT",
  employeeId: string,
  extra?: Record<string, any>,
) {
  const data = { type, employeeId, _ts: Date.now(), ...extra };

  // PRIMARY: Supabase Realtime
  if (_adminChannel) {
    _adminChannel.send({
      type: "broadcast",
      event: "signal",
      payload: data,
    }).catch(() => {});
  }

  // SECONDARY: localStorage fallback
  const payload = JSON.stringify(data);
  safeSetItem(ADMIN_KEY, payload);
  window.dispatchEvent(new StorageEvent("storage", { key: ADMIN_KEY, newValue: payload }));
}

// ── Listen for Admin signals ─────────────────────────────────
let _adminSignalCallback: ((parsed: any) => void) | null = null;
let _adminRealtimeRegistered = false;

export function onAdminSignal(callback: (type: string, employeeId: string, extra?: Record<string, any>) => void) {
  const processSignal = (parsed: any) => {
    try {
      const { type, employeeId, _ts, ...rest } = parsed;
      callback(type, employeeId, Object.keys(rest).length > 0 ? rest : undefined);
    } catch (_) {}
  };
  _adminSignalCallback = processSignal;

  // PRIMARY: Supabase Realtime (register ONCE, delegate to callback ref)
  if (_adminChannel && !_adminRealtimeRegistered) {
    _adminRealtimeRegistered = true;
    _adminChannel.on("broadcast", { event: "signal" }, ({ payload }: any) => {
      if (payload && _adminSignalCallback) _adminSignalCallback(payload);
    });
  }

  // SECONDARY: localStorage fallback
  const handler = (e: StorageEvent) => {
    if (e.key === ADMIN_KEY && e.newValue) {
      try { processSignal(JSON.parse(e.newValue)); } catch (_) {}
    }
  };
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("storage", handler);
    _adminSignalCallback = null;
  };
}

// ── Listen for sync events ────────────────────────────────────
let _syncEventCallback: ((evt: SyncEvent) => void) | null = null;
let _syncRealtimeRegistered = false;

export function onSyncEvent(callback: (event: SyncEvent) => void) {
  let lastProcessedTs = Date.now();
  const processedIds = new Set<number>(); // prevent duplicates from both channels

  const processEvent = (evt: SyncEvent) => {
    const evtTs = (evt as any)._ts;
    if (typeof evtTs === "number") {
      if (evtTs <= lastProcessedTs && processedIds.has(evtTs)) return;
      processedIds.add(evtTs);
      if (evtTs > lastProcessedTs) lastProcessedTs = evtTs;
    }
    if (typeof evt.type === "string" && evt.type.startsWith("DEMO_")) return;
    callback(evt);
  };
  _syncEventCallback = processEvent;

  // PRIMARY: Supabase Realtime listener (register ONCE, delegate to callback ref)
  if (_syncChannel && !_syncRealtimeRegistered) {
    _syncRealtimeRegistered = true;
    _syncChannel.on("broadcast", { event: "sync" }, ({ payload }: any) => {
      if (payload && _syncEventCallback) _syncEventCallback(payload as SyncEvent);
    });
  }

  // SECONDARY: localStorage fallback (same-device / offline)
  const handler = (e: StorageEvent) => {
    if (e.key === STORE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        const events: SyncEvent[] = Array.isArray(parsed) ? parsed : [parsed];
        for (const evt of events) processEvent(evt);
      } catch (_) {}
    }
  };
  window.addEventListener("storage", handler);

  return () => {
    window.removeEventListener("storage", handler);
    if (realtimeUnsub) realtimeUnsub();
  };
}

// ── Get activity log ──────────────────────────────────────────
export function getActivityLog(): AppActivity[] {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || "[]");
  } catch {
    return [];
  }
}

// ── Clear activity log ────────────────────────────────────────
export function clearActivityLog() {
  localStorage.removeItem(ACTIVITY_KEY);
}

// ── Helpers ───────────────────────────────────────────────────
function formatEventType(type: SyncEvent["type"]): string {
  const map: Record<SyncEvent["type"], string> = {
    SOS_TRIGGERED: "SOS Emergency Triggered",
    SOS_CANCELLED: "SOS Emergency Cancelled",
    SOS_DURESS_TRIGGERED: "SOS Duress Signal",
    CHECKIN: "Check-in Completed",
    HAZARD_REPORT: "Hazard Reported",
    STATUS_CHANGE: "Status Changed",
    LOCATION_UPDATE: "Location Updated",
    ADMIN_UNREACHABLE: "Admin Unreachable",
    ADMIN_ACKNOWLEDGED: "Admin Acknowledged",
    INCIDENT_REPORT_RECEIVED: "Incident Report Received",
    FALL_DETECTED: "Fall Detected",
    ESCALATION_UPDATE: "Escalation Update",
    SHAKE_SOS: "Shake-to-SOS Triggered",
    EMERGENCY_CHAT: "Emergency Chat Message",
    AUDIO_EVIDENCE: "Audio Recording Evidence Uploaded",
    GPS_TRAIL_UPDATE: "GPS Trail Point Recorded",
    SOS_RECORDING_STARTED: "Ambient Recording Started",
    SOS_CONTACT_ANSWERED: "Emergency Contact Answered",
    SOS_EVIDENCE_SUBMITTED: "Field Evidence Submitted",
    STATUS_UPDATE: "Employee Status Update",
    SAR_ACTIVATED: "SAR Mission Activated",
    SAR_WORKER_FOUND: "Missing Worker Found",
    CONNECTION_LOST: "Worker Connection Lost",
  };
  return map[type];
}

function getIconKey(type: SyncEvent["type"]): string {
  const map: Record<SyncEvent["type"], string> = {
    SOS_TRIGGERED: "AlertTriangle",
    SOS_CANCELLED: "CheckCircle",
    SOS_DURESS_TRIGGERED: "ShieldAlert",
    CHECKIN: "CheckCircle2",
    HAZARD_REPORT: "ShieldAlert",
    STATUS_CHANGE: "RefreshCw",
    LOCATION_UPDATE: "MapPin",
    ADMIN_UNREACHABLE: "AlertCircle",
    ADMIN_ACKNOWLEDGED: "CheckCircle",
    INCIDENT_REPORT_RECEIVED: "FileText",
    FALL_DETECTED: "AlertTriangle",
    ESCALATION_UPDATE: "AlertTriangle",
    SHAKE_SOS: "AlertTriangle",
    EMERGENCY_CHAT: "MessageCircle",
    AUDIO_EVIDENCE: "Microphone",
    GPS_TRAIL_UPDATE: "MapPin",
    SOS_RECORDING_STARTED: "Mic",
    SOS_CONTACT_ANSWERED: "Phone",
    SOS_EVIDENCE_SUBMITTED: "Camera",
    STATUS_UPDATE: "RefreshCw",
    SAR_ACTIVATED: "Radar",
    SAR_WORKER_FOUND: "CheckCircle",
    CONNECTION_LOST: "WifiOff",
  };
  return map[type];
}

// ── Connected employees state ─────────────────────────────────
const CONNECTED_KEY = "sosphere_connected";

export function setEmployeeConnected(employeeId: string, name: string) {
  const connected = getConnectedEmployees();
  connected[employeeId] = { name, lastSeen: Date.now() };
  localStorage.setItem(CONNECTED_KEY, JSON.stringify(connected));
}

export function getConnectedEmployees(): Record<string, { name: string; lastSeen: number }> {
  try {
    return JSON.parse(localStorage.getItem(CONNECTED_KEY) || "{}");
  } catch {
    return {};
  }
}

// ── Hybrid Mode (Zone-based vs HQ-only) ──────────────────────
const HYBRID_KEY = "sosphere_hybrid_mode";

export function setHybridMode(enabled: boolean) {
  localStorage.setItem(HYBRID_KEY, JSON.stringify(enabled));
  window.dispatchEvent(new StorageEvent("storage", { key: HYBRID_KEY, newValue: JSON.stringify(enabled) }));
}

export function getHybridMode(): boolean {
  try {
    const v = localStorage.getItem(HYBRID_KEY);
    return v !== null ? JSON.parse(v) : true; // default: hybrid ON
  } catch { return true; }
}

export function onHybridModeChange(callback: (enabled: boolean) => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === HYBRID_KEY && e.newValue !== null) {
      try { callback(JSON.parse(e.newValue)); } catch {}
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// ── Zone GPS Data ─────────────────────────────────────────────
const ZONE_GPS_KEY = "sosphere_zone_gps";

export interface ZoneGPSData {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  address?: string;
  evacuationPoints?: EvacuationPoint[]; // نقاط الإخلاء لهذه المنطقة
}

// ── Evacuation Points ─────────────────────────────────────────
export interface EvacuationPoint {
  id: string;
  name: string; // مثل: "Assembly Point A" أو "نقطة التجمع A"
  description?: string; // تعليمات إضافية
  lat: number;
  lng: number;
  capacity?: number; // السعة القصوى
  zoneId: string; // المنطقة التابعة لها
}

const EVAC_POINTS_KEY = "sosphere_evac_points";

export function saveEvacuationPoints(points: EvacuationPoint[]) {
  localStorage.setItem(EVAC_POINTS_KEY, JSON.stringify(points));
  window.dispatchEvent(new StorageEvent("storage", { key: EVAC_POINTS_KEY, newValue: JSON.stringify(points) }));
}

export function getEvacuationPoints(): EvacuationPoint[] {
  try { return JSON.parse(localStorage.getItem(EVAC_POINTS_KEY) || "[]"); } catch { return []; }
}

export function getEvacuationPointsByZone(zoneId: string): EvacuationPoint[] {
  return getEvacuationPoints().filter(p => p.zoneId === zoneId);
}

// ── Active Evacuation State ───────────────────────────────────
const ACTIVE_EVAC_KEY = "sosphere_active_evacuation";

export interface ActiveEvacuation {
  id: string;
  zoneId: string;
  zoneName: string;
  triggeredAt: number;
  triggeredBy: string; // admin name
  reason: string;
  expectedDuration?: number; // minutes
  status: "active" | "completed" | "cancelled";
}

export function triggerEvacuation(evacuation: ActiveEvacuation) {
  // PRIMARY: Supabase Realtime — reaches all employee devices instantly
  if (_evacChannel) {
    _evacChannel.send({
      type: "broadcast",
      event: "evacuation",
      payload: evacuation,
    }).catch(() => {});
  }
  // SECONDARY: localStorage fallback
  localStorage.setItem(ACTIVE_EVAC_KEY, JSON.stringify(evacuation));
  window.dispatchEvent(new StorageEvent("storage", { key: ACTIVE_EVAC_KEY, newValue: JSON.stringify(evacuation) }));
}

export function getActiveEvacuation(): ActiveEvacuation | null {
  try {
    const data = localStorage.getItem(ACTIVE_EVAC_KEY);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

// ── Evacuation History (persisted) ───────────────────────────
const EVAC_HISTORY_KEY = "sosphere_evacuation_history";

export interface EvacuationHistoryEntry {
  id: string;
  zoneId: string;
  zoneName: string;
  triggeredAt: number;
  triggeredBy: string;
  reason: string;
  status: "completed" | "cancelled";
  duration?: number; // minutes
  employeesEvacuated?: number;
  completedAt?: number;
}

export function getEvacuationHistory(): EvacuationHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(EVAC_HISTORY_KEY) || "[]");
  } catch { return []; }
}

function pushEvacuationHistory(entry: EvacuationHistoryEntry) {
  try {
    const history = getEvacuationHistory();
    // Avoid duplicates
    if (!history.find(h => h.id === entry.id)) {
      history.unshift(entry); // newest first
      localStorage.setItem(EVAC_HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
    }
  } catch { /* ignore */ }
}

export function completeEvacuation(evacuationId: string) {
  const evac = getActiveEvacuation();
  if (evac && evac.id === evacuationId) {
    const completedAt = Date.now();
    const durationMin = Math.round((completedAt - evac.triggeredAt) / 60000);
    evac.status = "completed";
    localStorage.setItem(ACTIVE_EVAC_KEY, JSON.stringify(evac));
    window.dispatchEvent(new StorageEvent("storage", { key: ACTIVE_EVAC_KEY, newValue: JSON.stringify(evac) }));
    // Save to history
    pushEvacuationHistory({
      id: evac.id, zoneId: evac.zoneId, zoneName: evac.zoneName,
      triggeredAt: evac.triggeredAt, triggeredBy: evac.triggeredBy,
      reason: evac.reason, status: "completed",
      duration: durationMin, completedAt,
    });
  }
}

export function cancelEvacuation(evacuationId: string) {
  const evac = getActiveEvacuation();
  if (evac && evac.id === evacuationId) {
    evac.status = "cancelled";
    localStorage.setItem(ACTIVE_EVAC_KEY, JSON.stringify(evac));
    window.dispatchEvent(new StorageEvent("storage", { key: ACTIVE_EVAC_KEY, newValue: JSON.stringify(evac) }));
    // Save cancelled to history too
    pushEvacuationHistory({
      id: evac.id, zoneId: evac.zoneId, zoneName: evac.zoneName,
      triggeredAt: evac.triggeredAt, triggeredBy: evac.triggeredBy,
      reason: evac.reason, status: "cancelled",
      duration: Math.round((Date.now() - evac.triggeredAt) / 60000),
    });
  }
}

// ── Employee Evacuation Status ────────────────────────────────
const EVAC_STATUS_KEY = "sosphere_evac_status";

export interface EmployeeEvacuationStatus {
  employeeId: string;
  employeeName: string;
  evacuationId: string;
  status: "notified" | "acknowledged" | "evacuating" | "arrived" | "safe";
  acknowledgedAt?: number;
  arrivedAt?: number;
  currentLat?: number;
  currentLng?: number;
  targetPointId?: string;
}

export function updateEmployeeEvacuationStatus(status: EmployeeEvacuationStatus) {
  // PRIMARY: Supabase Realtime — admin sees employee evacuation progress instantly
  if (_evacChannel) {
    _evacChannel.send({
      type: "broadcast",
      event: "evac_status",
      payload: status,
    }).catch(() => {});
  }
  // SECONDARY: localStorage
  const allStatuses = getEvacuationStatuses();
  const index = allStatuses.findIndex(s => s.employeeId === status.employeeId && s.evacuationId === status.evacuationId);
  if (index >= 0) {
    allStatuses[index] = status;
  } else {
    allStatuses.push(status);
  }
  localStorage.setItem(EVAC_STATUS_KEY, JSON.stringify(allStatuses));
  window.dispatchEvent(new StorageEvent("storage", { key: EVAC_STATUS_KEY, newValue: JSON.stringify(allStatuses) }));
}

export function getEvacuationStatuses(evacuationId?: string): EmployeeEvacuationStatus[] {
  try {
    const all: EmployeeEvacuationStatus[] = JSON.parse(localStorage.getItem(EVAC_STATUS_KEY) || "[]");
    return evacuationId ? all.filter(s => s.evacuationId === evacuationId) : all;
  } catch { return []; }
}

export function onEvacuationChange(callback: () => void) {
  // PRIMARY: Supabase Realtime evacuation channel
  if (_evacChannel) {
    _evacChannel.on("broadcast", { event: "evacuation" }, ({ payload }: any) => {
      if (payload) {
        localStorage.setItem(ACTIVE_EVAC_KEY, JSON.stringify(payload));
        callback();
      }
    });
    _evacChannel.on("broadcast", { event: "evac_status" }, ({ payload }: any) => {
      if (payload) callback();
    });
  }

  // SECONDARY: localStorage fallback
  const handler = (e: StorageEvent) => {
    if (e.key === ACTIVE_EVAC_KEY || e.key === EVAC_STATUS_KEY || e.key === EVAC_POINTS_KEY) {
      callback();
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// ── Employee Status Management ────────────────────────────────
// Enhanced status system for smart GPS compliance
export type EmployeeWorkStatus = 
  | "on-duty"          // Active shift - GPS tracking ON
  | "off-duty"         // Outside work hours - GPS tracking OFF
  | "on-leave"         // Annual/vacation leave - GPS OFF, no alerts
  | "sick-leave"       // Medical leave - GPS OFF, no alerts
  | "holiday"          // Public holiday - GPS OFF, no alerts
  | "break"            // On break (lunch/rest) - GPS optional
  | "sos-active";      // Emergency - GPS tracking FORCED ON

export interface EmployeeStatusData {
  employeeId: string;
  workStatus: EmployeeWorkStatus;
  // GPS & Location
  gpsEnabled: boolean;              // Manual GPS toggle
  autoGpsEnabled: boolean;          // Auto-enabled during on-duty
  currentLat?: number;
  currentLng?: number;
  lastLocationUpdate?: number;
  // Shift info
  shiftStartTime?: string;          // e.g., "08:00"
  shiftEndTime?: string;            // e.g., "17:00"
  nextShiftStart?: number;          // timestamp
  // Leave info
  leaveType?: "annual" | "sick" | "emergency" | "unpaid";
  leaveStartDate?: number;          // timestamp
  leaveEndDate?: number;
  leaveReason?: string;
  // Battery & Signal (for dashboard map)
  batteryLevel?: number;            // 0-100
  signalStrength?: "excellent" | "good" | "fair" | "poor" | "none";
  // Compliance
  insideAssignedZone?: boolean;
  lastCheckin?: number;
  avatarUrl?: string;               // For map display
}

const EMP_STATUS_KEY = "sosphere_emp_status";

export function updateEmployeeStatus(status: EmployeeStatusData) {
  const allStatuses = getAllEmployeeStatuses();
  const index = allStatuses.findIndex(s => s.employeeId === status.employeeId);
  if (index >= 0) {
    allStatuses[index] = { ...allStatuses[index], ...status };
  } else {
    allStatuses.push(status);
  }
  localStorage.setItem(EMP_STATUS_KEY, JSON.stringify(allStatuses));
  window.dispatchEvent(new StorageEvent("storage", { key: EMP_STATUS_KEY, newValue: JSON.stringify(allStatuses) }));
}

export function getAllEmployeeStatuses(): EmployeeStatusData[] {
  try {
    return JSON.parse(localStorage.getItem(EMP_STATUS_KEY) || "[]");
  } catch { return []; }
}

export function getEmployeeStatus(employeeId: string): EmployeeStatusData | null {
  const all = getAllEmployeeStatuses();
  return all.find(s => s.employeeId === employeeId) || null;
}

export function onEmployeeStatusChange(callback: (statuses: EmployeeStatusData[]) => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === EMP_STATUS_KEY && e.newValue) {
      try {
        callback(JSON.parse(e.newValue));
      } catch {}
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// ── Helper: Should GPS Track Employee? ────────────────────────
export function shouldTrackGPS(status: EmployeeStatusData): boolean {
  // SOS always tracked
  if (status.workStatus === "sos-active") return true;
  // On leave/sick/holiday - NO tracking
  if (["on-leave", "sick-leave", "holiday"].includes(status.workStatus)) return false;
  // Off-duty - NO tracking (respects privacy)
  if (status.workStatus === "off-duty") return false;
  // On-duty - YES tracking
  if (status.workStatus === "on-duty") return true;
  // Break - optional (use manual GPS setting)
  if (status.workStatus === "break") return status.gpsEnabled;
  return false;
}

// ── Helper: Should Alert GPS Non-Compliance? ──────────────────
export function shouldAlertGPSNonCompliance(status: EmployeeStatusData): boolean {
  // Only alert if on-duty and GPS tracking is expected
  if (status.workStatus !== "on-duty") return false;
  if (!status.autoGpsEnabled) return false;
  // Check if outside zone
  return status.insideAssignedZone === false;
}

export function saveZoneGPS(zones: ZoneGPSData[]) {
  localStorage.setItem(ZONE_GPS_KEY, JSON.stringify(zones));
}

export function getZoneGPS(): ZoneGPSData[] {
  try { return JSON.parse(localStorage.getItem(ZONE_GPS_KEY) || "[]"); } catch { return []; }
}

// ── Employee Zone Assignment ──────────────────────────────────
const EMP_ZONE_KEY = "sosphere_emp_zones";

export function assignEmployeeZone(employeeId: string, zoneId: string) {
  const map = getEmployeeZoneMap();
  map[employeeId] = zoneId;
  localStorage.setItem(EMP_ZONE_KEY, JSON.stringify(map));
}

export function getEmployeeZoneMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(EMP_ZONE_KEY) || "{}"); } catch { return {}; }
}

// ── Proximity Attendance ─────────────────────────────────────
const ATTENDANCE_KEY = "sosphere_attendance";

export interface AttendanceRecord {
  employeeId: string;
  employeeName: string;
  zoneId: string;
  zoneName: string;
  timestamp: number;
  type: "enter" | "exit";
}

export function recordAttendance(record: AttendanceRecord) {
  const records = getAttendanceRecords();
  records.unshift(record);
  localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(records.slice(0, 100)));
  // Also emit sync event
  emitSyncEvent({
    type: "CHECKIN",
    employeeId: record.employeeId,
    employeeName: record.employeeName,
    zone: record.zoneName,
    timestamp: record.timestamp,
    data: { attendanceType: record.type },
  });
}

export function getAttendanceRecords(): AttendanceRecord[] {
  try { return JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || "[]"); } catch { return []; }
}

// ── GPS Zone Compliance Engine ────────────────────────────────
// Checks every 15 minutes if employees are inside their assigned zones
// GPS from device = FREE ($0). Only reverse geocoding costs money.
// We use raw coordinates + Haversine distance = completely free.

const COMPLIANCE_KEY = "sosphere_compliance";
const COMPLIANCE_HISTORY_KEY = "sosphere_compliance_history";
const DEMO_CHECK_INTERVAL = 15; // seconds in demo (= 15 minutes real)

export interface EmployeeGPSSnapshot {
  employeeId: string;
  employeeName: string;
  assignedZoneId: string | null;
  assignedZoneName: string | null;
  currentLat: number;
  currentLng: number;
  zoneCenterLat: number | null;
  zoneCenterLng: number | null;
  zoneRadiusMeters: number | null;
  distanceMeters: number | null;
  status: "in-zone" | "out-of-zone" | "no-zone" | "offline";
}

export interface ComplianceCheckResult {
  id: string;
  timestamp: number;
  totalEmployees: number;
  inZone: number;
  outOfZone: number;
  noZone: number;
  offline: number;
  compliancePercent: number;
  snapshots: EmployeeGPSSnapshot[];
}

// Haversine formula — calculates distance between two GPS points in meters
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Simulated employee GPS positions (in real app, these come from device GPS)
const SIMULATED_GPS: Record<string, { lat: number; lng: number; drift: number }> = {
  "EMP-001": { lat: 24.7136, lng: 46.6753, drift: 0.001 },  // Ahmed - Near Zone A
  "EMP-002": { lat: 24.7140, lng: 46.6760, drift: 0.0005 }, // Fatima - Near Zone B
  "EMP-003": { lat: 24.7200, lng: 46.6850, drift: 0.008 },  // Khalid - Drifts far
  "EMP-004": { lat: 24.7100, lng: 46.6700, drift: 0.002 },  // Nasser - Offline/off-shift
  "EMP-005": { lat: 24.7145, lng: 46.6770, drift: 0.0008 }, // Sara - Near Zone C
  "EMP-006": { lat: 24.7160, lng: 46.6800, drift: 0.003 },  // Mohammed - SOS zone
  "EMP-007": { lat: 24.7148, lng: 46.6775, drift: 0.0006 }, // Lina - Near Zone C
  "EMP-008": { lat: 24.7135, lng: 46.6752, drift: 0.0004 }, // Omar - Near Zone A
  "EMP-009": { lat: 24.7155, lng: 46.6790, drift: 0.005 },  // Yusuf - Wanders
  "EMP-010": { lat: 24.7130, lng: 46.6745, drift: 0.0007 }, // Layla - Near Zone A
};

// Default zone GPS (if geofencing hasn't set custom ones)
const DEFAULT_ZONE_GPS: ZoneGPSData[] = [
  { id: "Z-A", name: "Zone A - North Gate", lat: 24.7136, lng: 46.6753, radiusMeters: 150 },
  { id: "Z-B", name: "Zone B - Control Room", lat: 24.7140, lng: 46.6760, radiusMeters: 100 },
  { id: "Z-C", name: "Zone C - Main Hall", lat: 24.7145, lng: 46.6770, radiusMeters: 200 },
  { id: "Z-D", name: "Zone D - Warehouse", lat: 24.7160, lng: 46.6800, radiusMeters: 120 },
  { id: "Z-E", name: "Zone E - Parking", lat: 24.7120, lng: 46.6730, radiusMeters: 250 },
];

// Default employee-zone assignments (if not set manually)
const DEFAULT_EMP_ZONES: Record<string, string> = {
  "EMP-001": "Z-A",
  "EMP-002": "Z-B",
  "EMP-003": "Z-A",
  "EMP-005": "Z-C",
  "EMP-006": "Z-D",
  "EMP-007": "Z-C",
  "EMP-008": "Z-A",
  "EMP-009": "Z-D",
  "EMP-010": "Z-A",
};

const EMPLOYEE_NAMES: Record<string, string> = {
  "EMP-001": "Ahmed Khalil",
  "EMP-002": "Fatima Hassan",
  "EMP-003": "Khalid Omar",
  "EMP-004": "Nasser Al-Said",
  "EMP-005": "Sara Al-Mutairi",
  "EMP-006": "Mohammed Ali",
  "EMP-007": "Lina Chen",
  "EMP-008": "Omar Al-Farsi",
  "EMP-009": "Yusuf Bakr",
  "EMP-010": "Layla Noor",
};

const OFF_SHIFT_EMPLOYEES = ["EMP-004", "EMP-011", "EMP-012", "EMP-013", "EMP-014", "EMP-015", "EMP-016", "EMP-017"];

export function runComplianceCheck(): ComplianceCheckResult {
  // Get zones (custom geofencing or defaults)
  const customZones = getZoneGPS();
  const zones = customZones.length > 0 ? customZones : DEFAULT_ZONE_GPS;

  // Get employee-zone map (custom assignments or defaults)
  const customMap = getEmployeeZoneMap();
  const empZoneMap = Object.keys(customMap).length > 0 ? { ...DEFAULT_EMP_ZONES, ...customMap } : DEFAULT_EMP_ZONES;

  const snapshots: EmployeeGPSSnapshot[] = [];
  const employeeIds = Object.keys(EMPLOYEE_NAMES);

  for (const empId of employeeIds) {
    const isOffShift = OFF_SHIFT_EMPLOYEES.includes(empId);
    const gps = SIMULATED_GPS[empId];
    const assignedZoneId = empZoneMap[empId] || null;
    const zone = assignedZoneId ? zones.find(z => z.id === assignedZoneId) : null;

    if (isOffShift || !gps) {
      snapshots.push({
        employeeId: empId,
        employeeName: EMPLOYEE_NAMES[empId],
        assignedZoneId,
        assignedZoneName: zone?.name || null,
        currentLat: 0, currentLng: 0,
        zoneCenterLat: zone?.lat || null, zoneCenterLng: zone?.lng || null,
        zoneRadiusMeters: zone?.radiusMeters || null,
        distanceMeters: null,
        status: "offline",
      });
      continue;
    }

    // Use real GPS from localStorage if available, otherwise use fixed SIMULATED_GPS (no drift)
    const realGpsList: any[] = (() => { try { return JSON.parse(localStorage.getItem("sosphere_gps_trail") || "[]"); } catch { return []; } })();
    const realGps = realGpsList.filter(p => p.employeeId === empId).slice(-1)[0];
    const currentLat = realGps ? realGps.lat : gps.lat;
    const currentLng = realGps ? realGps.lng : gps.lng;

    if (!zone) {
      snapshots.push({
        employeeId: empId,
        employeeName: EMPLOYEE_NAMES[empId],
        assignedZoneId: null, assignedZoneName: null,
        currentLat, currentLng,
        zoneCenterLat: null, zoneCenterLng: null,
        zoneRadiusMeters: null, distanceMeters: null,
        status: "no-zone",
      });
      continue;
    }

    const distance = haversineDistance(currentLat, currentLng, zone.lat, zone.lng);
    const isInZone = distance <= zone.radiusMeters;

    snapshots.push({
      employeeId: empId,
      employeeName: EMPLOYEE_NAMES[empId],
      assignedZoneId, assignedZoneName: zone.name,
      currentLat, currentLng,
      zoneCenterLat: zone.lat, zoneCenterLng: zone.lng,
      zoneRadiusMeters: zone.radiusMeters,
      distanceMeters: Math.round(distance),
      status: isInZone ? "in-zone" : "out-of-zone",
    });
  }

  const inZone = snapshots.filter(s => s.status === "in-zone").length;
  const outOfZone = snapshots.filter(s => s.status === "out-of-zone").length;
  const noZone = snapshots.filter(s => s.status === "no-zone").length;
  const offline = snapshots.filter(s => s.status === "offline").length;
  const trackable = inZone + outOfZone;

  const result: ComplianceCheckResult = {
    id: `CHK-${Date.now().toString(36).toUpperCase()}`,
    timestamp: Date.now(),
    totalEmployees: snapshots.length,
    inZone, outOfZone, noZone, offline,
    compliancePercent: trackable > 0 ? Math.round((inZone / trackable) * 100) : 0,
    snapshots,
  };

  // Save latest check
  localStorage.setItem(COMPLIANCE_KEY, JSON.stringify(result));

  // Append to history (keep last 20)
  const history = getComplianceHistory();
  history.unshift(result);
  localStorage.setItem(COMPLIANCE_HISTORY_KEY, JSON.stringify(history.slice(0, 20)));

  // Dispatch storage event for listeners
  window.dispatchEvent(new StorageEvent("storage", { key: COMPLIANCE_KEY, newValue: JSON.stringify(result) }));

  // Log out-of-zone employees as activity
  for (const s of snapshots) {
    if (s.status === "out-of-zone") {
      emitSyncEvent({
        type: "LOCATION_UPDATE",
        employeeId: s.employeeId,
        employeeName: s.employeeName,
        zone: s.assignedZoneName || "Unknown",
        timestamp: Date.now(),
        data: { distance: s.distanceMeters, status: "out-of-zone" },
      });
    }
  }

  return result;
}

export function getLatestCompliance(): ComplianceCheckResult | null {
  try {
    const v = localStorage.getItem(COMPLIANCE_KEY);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

export function getComplianceHistory(): ComplianceCheckResult[] {
  try { return JSON.parse(localStorage.getItem(COMPLIANCE_HISTORY_KEY) || "[]"); } catch { return []; }
}

export function onComplianceUpdate(callback: (result: ComplianceCheckResult) => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === COMPLIANCE_KEY && e.newValue) {
      try { callback(JSON.parse(e.newValue)); } catch {}
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export const GPS_CHECK_INTERVAL_DEMO = DEMO_CHECK_INTERVAL;

// ═══════════════════════════════════════════════════════════════
// Broadcast Messaging System — Hybrid Chat + Emergency Alerts
// Cost: $0 (In-App Push via localStorage bridge, no SMS/WhatsApp)
// ═══════════════════════════════════════════════════════════════

const BROADCAST_KEY = "sosphere_broadcasts";
const BROADCAST_NOTIFY_KEY = "sosphere_broadcast_notify";

export type BroadcastAudience =
  | { type: "all" }
  | { type: "role"; roles: ("admin" | "supervisor" | "employee")[] }
  | { type: "zone"; zoneIds: string[] }
  | { type: "department"; departments: string[] }
  | { type: "custom"; employeeIds: string[] };

export type BroadcastPriority = "emergency" | "urgent" | "normal" | "info";

export type BroadcastSource =
  | "manual"           // Admin typed it
  | "auto_gps"         // GPS compliance out-of-zone
  | "auto_sos"         // SOS triggered
  | "auto_hazard"      // Hazard report
  | "auto_geofence"    // Geofence breach
  | "auto_checkin";    // Missed check-in

export interface BroadcastMessage {
  id: string;
  title: string;
  body: string;
  priority: BroadcastPriority;
  audience: BroadcastAudience;
  audienceLabel: string;         // human-readable: "Zone A", "All Company", etc.
  source: BroadcastSource;
  senderName: string;
  senderRole: string;
  timestamp: number;
  expiresAt?: number;            // optional auto-expire
  readBy: string[];              // employee IDs who read it
  actionUrl?: string;            // deep link (e.g., navigate to emergency)
  relatedEmergencyId?: string;   // link to emergency if auto-generated
  attachments?: { type: "location"; lat: number; lng: number; label: string }[];
}

// ── Send Broadcast ────────────────────────────────────────────
export function sendBroadcast(msg: Omit<BroadcastMessage, "id" | "readBy">): BroadcastMessage {
  const broadcast: BroadcastMessage = {
    ...msg,
    id: `BC-${Date.now().toString(36).toUpperCase()}-${(crypto.randomUUID ? crypto.randomUUID().slice(0,5).toUpperCase() : Date.now().toString(36).slice(-5).toUpperCase())}` ,
    readBy: [],
  };
  const all = getBroadcasts();
  all.unshift(broadcast);
  localStorage.setItem(BROADCAST_KEY, JSON.stringify(all.slice(0, 200)));

  // Notify listeners
  const payload = JSON.stringify(broadcast);
  window.dispatchEvent(new StorageEvent("storage", { key: BROADCAST_NOTIFY_KEY, newValue: payload }));

  // Also log as activity
  emitSyncEvent({
    type: "STATUS_CHANGE",
    employeeId: "SYSTEM",
    employeeName: msg.senderName,
    zone: msg.audienceLabel,
    timestamp: msg.timestamp,
    data: { broadcastId: broadcast.id, broadcastTitle: msg.title, broadcastPriority: msg.priority },
  });

  return broadcast;
}

// ── Auto-Broadcast Helpers (called from GPS compliance, SOS, etc.)
export function autoBroadcastOutOfZone(employeeName: string, zoneName: string, distance: number) {
  return sendBroadcast({
    title: `⚠️ Employee Out of Zone`,
    body: `${employeeName} is ${distance}m outside ${zoneName}. GPS compliance check flagged this position.`,
    priority: "urgent",
    audience: { type: "role", roles: ["admin", "supervisor"] },
    audienceLabel: "Admins & Supervisors",
    source: "auto_gps",
    senderName: "GPS System",
    senderRole: "Automated",
    timestamp: Date.now(),
    expiresAt: Date.now() + 3600000, // 1 hour
  });
}

export function autoBroadcastSOS(employeeName: string, zone: string, emergencyId: string) {
  return sendBroadcast({
    title: `🚨 SOS EMERGENCY`,
    body: `${employeeName} triggered SOS in ${zone}. Immediate response required!`,
    priority: "emergency",
    audience: { type: "all" },
    audienceLabel: "All Company",
    source: "auto_sos",
    senderName: "SOS System",
    senderRole: "Automated",
    timestamp: Date.now(),
    relatedEmergencyId: emergencyId,
  });
}

export function autoBroadcastHazard(employeeName: string, zone: string, hazardType: string) {
  return sendBroadcast({
    title: `⚠️ Hazard Report: ${hazardType}`,
    body: `${employeeName} reported a ${hazardType} hazard in ${zone}. Avoid the area until cleared.`,
    priority: "urgent",
    audience: { type: "zone", zoneIds: [zone] },
    audienceLabel: zone,
    source: "auto_hazard",
    senderName: "Hazard System",
    senderRole: "Automated",
    timestamp: Date.now(),
  });
}

export function autoBroadcastGeofenceBreach(employeeName: string, zone: string) {
  return sendBroadcast({
    title: `🔒 Geofence Breach`,
    body: `${employeeName} has entered restricted zone: ${zone}.`,
    priority: "urgent",
    audience: { type: "role", roles: ["admin", "supervisor"] },
    audienceLabel: "Security Team",
    source: "auto_geofence",
    senderName: "Geofence System",
    senderRole: "Automated",
    timestamp: Date.now(),
  });
}

// ── Read / Query ─────────────────────────────────────────────
export function getBroadcasts(): BroadcastMessage[] {
  try { return JSON.parse(localStorage.getItem(BROADCAST_KEY) || "[]"); } catch { return []; }
}

export function getBroadcastsForEmployee(employeeId: string, role: string, zoneId?: string, department?: string): BroadcastMessage[] {
  return getBroadcasts().filter(b => {
    // Check expiry
    if (b.expiresAt && b.expiresAt < Date.now()) return false;
    // Check audience
    const a = b.audience;
    if (a.type === "all") return true;
    if (a.type === "role" && a.roles.includes(role as any)) return true;
    if (a.type === "zone" && zoneId && a.zoneIds.includes(zoneId)) return true;
    if (a.type === "department" && department && a.departments.includes(department)) return true;
    if (a.type === "custom" && a.employeeIds.includes(employeeId)) return true;
    return false;
  });
}

export function markBroadcastRead(broadcastId: string, employeeId: string) {
  const all = getBroadcasts();
  const msg = all.find(b => b.id === broadcastId);
  if (msg && !msg.readBy.includes(employeeId)) {
    msg.readBy.push(employeeId);
    localStorage.setItem(BROADCAST_KEY, JSON.stringify(all));
  }
}

export function getUnreadCount(employeeId: string, role: string, zoneId?: string, department?: string): number {
  return getBroadcastsForEmployee(employeeId, role, zoneId, department)
    .filter(b => !b.readBy.includes(employeeId)).length;
}

export function onBroadcastReceived(callback: (msg: BroadcastMessage) => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === BROADCAST_NOTIFY_KEY && e.newValue) {
      try { callback(JSON.parse(e.newValue)); } catch {}
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export function deleteBroadcast(broadcastId: string) {
  const all = getBroadcasts().filter(b => b.id !== broadcastId);
  localStorage.setItem(BROADCAST_KEY, JSON.stringify(all));
}

// ═══════════════════════════════════════════════════════════════
// Smart Escalation Engine
// If an EMERGENCY broadcast goes unread for X minutes → auto-escalate
// Escalation chain: Zone → Role (admins+supervisors) → All Company
// ═══════════════════════════════════════════════════════════════

const ESCALATION_LOG_KEY = "sosphere_escalation_log";
const ESCALATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (production)
export const ESCALATION_TIMEOUT_DEMO_MS = 30 * 1000; // 30s for demo

export interface EscalationEntry {
  originalBroadcastId: string;
  escalatedBroadcastId: string;
  level: number; // 1 = first escalation, 2 = second (all company)
  reason: string;
  timestamp: number;
}

export function getEscalationLog(): EscalationEntry[] {
  try { return JSON.parse(localStorage.getItem(ESCALATION_LOG_KEY) || "[]"); } catch { return []; }
}

function saveEscalationLog(log: EscalationEntry[]) {
  localStorage.setItem(ESCALATION_LOG_KEY, JSON.stringify(log.slice(0, 100)));
}

/**
 * Check all emergency/urgent broadcasts for unread escalation.
 * Returns number of new escalations triggered.
 */
export function checkEscalations(demoMode = true): number {
  const timeout = demoMode ? ESCALATION_TIMEOUT_DEMO_MS : ESCALATION_TIMEOUT_MS;
  const broadcasts = getBroadcasts();
  const log = getEscalationLog();
  const alreadyEscalated = new Set(log.map(e => e.originalBroadcastId));
  let count = 0;

  for (const b of broadcasts) {
    // Only escalate emergency + urgent
    if (b.priority !== "emergency" && b.priority !== "urgent") continue;
    // Skip if already escalated to level 2
    const existingEscalations = log.filter(e => e.originalBroadcastId === b.id);
    const maxLevel = existingEscalations.length > 0
      ? Math.max(...existingEscalations.map(e => e.level))
      : 0;
    if (maxLevel >= 2) continue;

    // Check if enough time passed with no reads
    const elapsed = Date.now() - b.timestamp;
    const readCount = b.readBy.length;

    if (elapsed > timeout && readCount === 0 && maxLevel === 0) {
      // Level 1: Escalate zone/role → admins+supervisors
      const esc = sendBroadcast({
        title: `🔺 ESCALATED: ${b.title}`,
        body: `[AUTO-ESCALATION] No response in ${demoMode ? "30s" : "5min"}. Original: ${b.body}`,
        priority: "emergency",
        audience: { type: "role", roles: ["admin", "supervisor"] },
        audienceLabel: "Admins & Supervisors (Escalated)",
        source: b.source,
        senderName: "Escalation Engine",
        senderRole: "Automated",
        timestamp: Date.now(),
        relatedEmergencyId: b.relatedEmergencyId,
      });
      log.push({
        originalBroadcastId: b.id,
        escalatedBroadcastId: esc.id,
        level: 1,
        reason: `No reads after ${demoMode ? "30s" : "5min"}`,
        timestamp: Date.now(),
      });
      count++;
    } else if (elapsed > timeout * 2 && readCount === 0 && maxLevel === 1) {
      // Level 2: Escalate → ALL COMPANY
      const esc = sendBroadcast({
        title: `🚨 CRITICAL ESCALATION: ${b.title}`,
        body: `[FINAL ESCALATION] No response after ${demoMode ? "60s" : "10min"}! ${b.body}`,
        priority: "emergency",
        audience: { type: "all" },
        audienceLabel: "ALL COMPANY (Final Escalation)",
        source: b.source,
        senderName: "Escalation Engine",
        senderRole: "Automated",
        timestamp: Date.now(),
        relatedEmergencyId: b.relatedEmergencyId,
      });
      log.push({
        originalBroadcastId: b.id,
        escalatedBroadcastId: esc.id,
        level: 2,
        reason: `No reads after ${demoMode ? "60s" : "10min"} — final escalation`,
        timestamp: Date.now(),
      });
      count++;
    }
  }

  if (count > 0) saveEscalationLog(log);
  return count;
}

// ═══════════════════════════════════════════════════════════════
// Scheduled Broadcasts — Future-dated messages
// ═══════════════════════════════════════════════════════════════

const SCHEDULED_KEY = "sosphere_scheduled_broadcasts";

export interface ScheduledBroadcast {
  id: string;
  scheduledFor: number; // timestamp when to fire
  message: Omit<BroadcastMessage, "id" | "readBy">;
  status: "pending" | "sent" | "cancelled";
  createdAt: number;
  createdBy: string;
}

export function scheduleBroadcast(
  scheduledFor: number,
  message: Omit<BroadcastMessage, "id" | "readBy" | "timestamp">,
  createdBy = "Admin"
): ScheduledBroadcast {
  const entry: ScheduledBroadcast = {
    id: `SCH-${Date.now().toString(36).toUpperCase()}`,
    scheduledFor,
    message: { ...message, timestamp: scheduledFor },
    status: "pending",
    createdAt: Date.now(),
    createdBy,
  };
  const all = getScheduledBroadcasts();
  all.push(entry);
  localStorage.setItem(SCHEDULED_KEY, JSON.stringify(all));
  return entry;
}

export function getScheduledBroadcasts(): ScheduledBroadcast[] {
  try { return JSON.parse(localStorage.getItem(SCHEDULED_KEY) || "[]"); } catch { return []; }
}

export function cancelScheduledBroadcast(id: string) {
  const all = getScheduledBroadcasts().map(s =>
    s.id === id ? { ...s, status: "cancelled" as const } : s
  );
  localStorage.setItem(SCHEDULED_KEY, JSON.stringify(all));
}

/**
 * Process due scheduled broadcasts. Call this on interval.
 * Returns number of broadcasts sent.
 */
export function processScheduledBroadcasts(): number {
  const all = getScheduledBroadcasts();
  const now = Date.now();
  let count = 0;

  const updated = all.map(s => {
    if (s.status === "pending" && s.scheduledFor <= now) {
      sendBroadcast({ ...s.message, timestamp: now });
      count++;
      return { ...s, status: "sent" as const };
    }
    return s;
  });

  if (count > 0) {
    localStorage.setItem(SCHEDULED_KEY, JSON.stringify(updated));
  }
  return count;
}

// ── Zone & Role labels for UI ─────────────────────────────────
export const ZONE_OPTIONS = [
  { id: "Z-A", name: "Zone A - North Gate" },
  { id: "Z-B", name: "Zone B - Control Room" },
  { id: "Z-C", name: "Zone C - Main Hall" },
  { id: "Z-D", name: "Zone D - Warehouse" },
  { id: "Z-E", name: "Zone E - Parking" },
];

export const ROLE_OPTIONS = [
  { id: "admin", label: "Admins" },
  { id: "supervisor", label: "Supervisors" },
  { id: "employee", label: "Employees" },
];

export const DEPT_OPTIONS = [
  "Engineering", "Safety", "Operations", "Security",
  "Maintenance", "R&D", "Admin", "Logistics", "Medical",
];

// ═══════════════════════════════════════════════════════════════
// Call Signal System — Employee ↔ Admin Direct Call Bridge
// Uses localStorage events for cross-tab real-time communication
// Flow: Employee triggers SOS → emits EMPLOYEE_CALLING
//       Admin answers → emits ADMIN_ANSWERED
//       Either side ends → emits CALL_ENDED
// ═══════════════════════════════════════════════════════════════

const CALL_SIGNAL_KEY = "sosphere_call_signal";
const ADMIN_CALL_KEY  = "sosphere_admin_active_call";

export type CallSignalType =
  | "EMPLOYEE_CALLING"   // Employee → Admin: SOS incoming call
  | "ADMIN_ANSWERED"     // Admin   → Employee: call accepted
  | "ADMIN_DECLINED"     // Admin   → Employee: call rejected / missed
  | "ADMIN_CALLING_BACK" // Admin   → Employee: outgoing callback
  | "CALL_ENDED";        // Either side: call terminated

export interface CallSignal {
  type: CallSignalType;
  employeeId: string;
  employeeName: string;
  zone?: string;
  timestamp: number;
  data?: {
    emergencyId?: string;
    lastGPS?: { lat: number; lng: number };
    bloodType?: string;
    battery?: number;
  };
}

export interface AdminActiveCall {
  employeeId: string;
  employeeName: string;
  employeeRole?: string;
  zone?: string;
  startedAt: number;
}

// ── Emit call signal (any participant) ──────────────────────
export function emitCallSignal(signal: Omit<CallSignal, "timestamp">) {
  const full: CallSignal = { ...signal, timestamp: Date.now() };
  const payload = JSON.stringify(full);
  // FIX AUDIT-3.4: Use safeSetItem — call signals are SOS-critical
  safeSetItem(CALL_SIGNAL_KEY, payload);
  window.dispatchEvent(new StorageEvent("storage", { key: CALL_SIGNAL_KEY, newValue: payload }));
}

// ── Read current call signal ─────────────────────────────────
export function getCallSignal(): CallSignal | null {
  try {
    const v = localStorage.getItem(CALL_SIGNAL_KEY);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

// ── Clear call signal ────────────────────────────────────────
export function clearCallSignal() {
  localStorage.removeItem(CALL_SIGNAL_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: CALL_SIGNAL_KEY, newValue: null }));
}

// ── Subscribe to call signal changes ────────────────────────
export function onCallSignal(callback: (signal: CallSignal | null) => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === CALL_SIGNAL_KEY) {
      try {
        callback(e.newValue ? JSON.parse(e.newValue) : null);
      } catch { callback(null); }
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// ── Admin-initiated active call (from Call Panel) ────────────
export function startAdminCall(call: AdminActiveCall) {
  const payload = JSON.stringify(call);
  localStorage.setItem(ADMIN_CALL_KEY, payload);
  window.dispatchEvent(new StorageEvent("storage", { key: ADMIN_CALL_KEY, newValue: payload }));
}

export function endAdminCall() {
  localStorage.removeItem(ADMIN_CALL_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: ADMIN_CALL_KEY, newValue: null }));
}

export function getAdminActiveCall(): AdminActiveCall | null {
  try {
    const v = localStorage.getItem(ADMIN_CALL_KEY);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

export function onAdminCallChange(callback: (call: AdminActiveCall | null) => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === ADMIN_CALL_KEY) {
      try {
        callback(e.newValue ? JSON.parse(e.newValue) : null);
      } catch { callback(null); }
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// ═══════════════════════════════════════════════════════════════
// Employee Invitation & Approval Bridge
// Dashboard → Employee notification via localStorage events
// Flow: Admin approves → emits EMPLOYEE_APPROVED → Employee gets welcome
// ════════════════════════════════════════════════════════════════

const INVITE_KEY = "sosphere_invitations";
const INVITE_SIGNAL_KEY = "sosphere_invite_signal";
const JOIN_REQUEST_KEY = "sosphere_join_requests";

export interface EmployeeInvitation {
  id: string;
  employeeId: string;
  employeeName: string;
  phone: string;
  email: string;
  role: string;
  department: string;
  zone?: string;
  companyName: string;
  inviteCode: string;
  status: "pending" | "sent" | "delivered" | "joined" | "expired";
  sentAt: number;
  sentVia: "email" | "whatsapp" | "both";
  joinedAt?: number;
}

export interface JoinRequest {
  id: string;
  employeeName: string;
  phone: string;
  email?: string;
  companyCode: string;
  requestedAt: number;
  status: "pending" | "approved" | "rejected" | "auto-approved";
  matchedCSVRecord?: boolean; // phone matches CSV → auto-approve
  approvedAt?: number;
  approvedBy?: string;
  assignedZone?: string;
  assignedRole?: string;
}

// ── Save & Get Invitations ──────────────────────────────────
export function saveInvitations(invitations: EmployeeInvitation[]) {
  localStorage.setItem(INVITE_KEY, JSON.stringify(invitations));
  window.dispatchEvent(new StorageEvent("storage", { key: INVITE_KEY, newValue: JSON.stringify(invitations) }));
}

export function getInvitations(): EmployeeInvitation[] {
  try { return JSON.parse(localStorage.getItem(INVITE_KEY) || "[]"); } catch { return []; }
}

export function updateInvitationStatus(inviteId: string, status: EmployeeInvitation["status"]) {
  const all = getInvitations();
  const inv = all.find(i => i.id === inviteId);
  if (inv) {
    inv.status = status;
    if (status === "joined") inv.joinedAt = Date.now();
    saveInvitations(all);
  }
}

// ── Join Requests (Employee → Dashboard) ────────────────────
export function submitJoinRequest(request: Omit<JoinRequest, "id" | "status" | "requestedAt">): JoinRequest {
  const req: JoinRequest = {
    ...request,
    id: `JR-${Date.now().toString(36).toUpperCase()}`,
    status: request.matchedCSVRecord ? "auto-approved" : "pending",
    requestedAt: Date.now(),
    approvedAt: request.matchedCSVRecord ? Date.now() : undefined,
  };
  const all = getJoinRequests();
  all.unshift(req);
  localStorage.setItem(JOIN_REQUEST_KEY, JSON.stringify(all.slice(0, 100)));
  window.dispatchEvent(new StorageEvent("storage", { key: JOIN_REQUEST_KEY, newValue: JSON.stringify(all) }));
  return req;
}

export function getJoinRequests(): JoinRequest[] {
  try { return JSON.parse(localStorage.getItem(JOIN_REQUEST_KEY) || "[]"); } catch { return []; }
}

export function approveJoinRequest(requestId: string, approvedBy = "Admin") {
  const all = getJoinRequests();
  const req = all.find(r => r.id === requestId);
  if (req) {
    req.status = "approved";
    req.approvedAt = Date.now();
    req.approvedBy = approvedBy;
    localStorage.setItem(JOIN_REQUEST_KEY, JSON.stringify(all));
    // Emit approval signal to mobile app
    emitInviteSignal("EMPLOYEE_APPROVED", req.employeeName, req.phone);
  }
}

export function rejectJoinRequest(requestId: string) {
  const all = getJoinRequests();
  const req = all.find(r => r.id === requestId);
  if (req) {
    req.status = "rejected";
    localStorage.setItem(JOIN_REQUEST_KEY, JSON.stringify(all));
    emitInviteSignal("EMPLOYEE_REJECTED", req.employeeName, req.phone);
  }
}

// ── Invite Signals (Dashboard → Mobile) ─────────────────────
type InviteSignalType = "EMPLOYEE_APPROVED" | "EMPLOYEE_REJECTED" | "INVITES_SENT" | "BULK_AUTO_APPROVED";

function emitInviteSignal(type: InviteSignalType, employeeName: string, phone: string) {
  const payload = JSON.stringify({ type, employeeName, phone, _ts: Date.now() });
  localStorage.setItem(INVITE_SIGNAL_KEY, payload);
  window.dispatchEvent(new StorageEvent("storage", { key: INVITE_SIGNAL_KEY, newValue: payload }));
}

export function onInviteSignal(callback: (type: InviteSignalType, employeeName: string, phone: string) => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === INVITE_SIGNAL_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        callback(parsed.type, parsed.employeeName, parsed.phone);
      } catch {}
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// ── Bulk Auto-Approve (CSV matched employees) ───────────────
export function bulkAutoApprove(): number {
  const requests = getJoinRequests();
  let count = 0;
  for (const req of requests) {
    if (req.status === "pending" && req.matchedCSVRecord) {
      req.status = "auto-approved";
      req.approvedAt = Date.now();
      req.approvedBy = "System (CSV Match)";
      emitInviteSignal("EMPLOYEE_APPROVED", req.employeeName, req.phone);
      count++;
    }
  }
  if (count > 0) {
    localStorage.setItem(JOIN_REQUEST_KEY, JSON.stringify(requests));
    emitInviteSignal("BULK_AUTO_APPROVED", `${count} employees`, "");
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════
// Emergency Chat System (Cross-Tab)
// Mobile ↔ Dashboard real-time messaging during emergencies
// ═══════════════════════════════════════════════════════════════
const CHAT_KEY = "sosphere_emergency_chat";

export interface EmergencyChatMessage {
  id: string;
  emergencyId: string;
  sender: "employee" | "admin";
  senderName: string;
  message: string;
  timestamp: number;
  isPreset: boolean;
  type: "text" | "location" | "status" | "audio";
}

export function sendChatMessage(msg: Omit<EmergencyChatMessage, "id" | "timestamp">) {
  const full: EmergencyChatMessage = {
    ...msg,
    id: `MSG-${Date.now().toString(36).toUpperCase()}`,
    timestamp: Date.now(),
  };

  // 1) Always save to localStorage (instant local update)
  const all = getChatMessages(msg.emergencyId);
  all.push(full);
  const payload = JSON.stringify(all);
  localStorage.setItem(`${CHAT_KEY}_${msg.emergencyId}`, payload);
  window.dispatchEvent(new StorageEvent("storage", { key: `${CHAT_KEY}_${msg.emergencyId}`, newValue: payload }));

  // 2) Background: save to Supabase DB + broadcast via Realtime
  if (SUPABASE_CONFIG.isConfigured) {
    (async () => {
      try {
        // Insert into chat_messages table
        await supabase.from("chat_messages").insert({
          id: full.id,
          emergency_id: full.emergencyId,
          sender: full.sender,
          sender_name: full.senderName,
          message: full.message,
          is_preset: full.isPreset,
          msg_type: full.type,
          sent_at: new Date(full.timestamp).toISOString(),
        });

        // Broadcast to other devices via Realtime channel
        const channel = supabase.channel(`chat-${msg.emergencyId}`);
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            channel.send({
              type: "broadcast",
              event: "new_message",
              payload: full,
            });
            // Unsubscribe after sending (fire-and-forget)
            setTimeout(() => supabase.removeChannel(channel), 2000);
          }
        });
      } catch (e) {
        console.warn("[Chat] Supabase send failed, localStorage only:", e);
      }
    })();
  }

  return full;
}

export function getChatMessages(emergencyId: string): EmergencyChatMessage[] {
  try { return JSON.parse(localStorage.getItem(`${CHAT_KEY}_${emergencyId}`) || "[]"); } catch { return []; }
}

/** Load chat history from Supabase (called once on mount) */
export async function getChatMessagesAsync(emergencyId: string): Promise<EmergencyChatMessage[]> {
  if (!SUPABASE_CONFIG.isConfigured) return getChatMessages(emergencyId);
  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("emergency_id", emergencyId)
      .order("sent_at", { ascending: true });
    if (error || !data) throw error;
    const msgs: EmergencyChatMessage[] = data.map((row: any) => ({
      id: row.id,
      emergencyId: row.emergency_id,
      sender: row.sender,
      senderName: row.sender_name,
      message: row.message,
      timestamp: new Date(row.sent_at).getTime(),
      isPreset: row.is_preset,
      type: row.msg_type || "text",
    }));
    // Sync to localStorage cache
    localStorage.setItem(`${CHAT_KEY}_${emergencyId}`, JSON.stringify(msgs));
    return msgs;
  } catch (e) {
    console.warn("[Chat] Supabase load failed, using localStorage:", e);
    return getChatMessages(emergencyId);
  }
}

export function onChatMessage(emergencyId: string, callback: (messages: EmergencyChatMessage[]) => void) {
  // 1) localStorage listener (same-device, immediate)
  const handler = (e: StorageEvent) => {
    if (e.key === `${CHAT_KEY}_${emergencyId}` && e.newValue) {
      try { callback(JSON.parse(e.newValue)); } catch {}
    }
  };
  window.addEventListener("storage", handler);

  // 2) Supabase Realtime listener (cross-device)
  let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
  if (SUPABASE_CONFIG.isConfigured) {
    realtimeChannel = supabase.channel(`chat-${emergencyId}`);
    realtimeChannel
      .on("broadcast", { event: "new_message" }, (payload) => {
        const msg = payload.payload as EmergencyChatMessage;
        // Merge into localStorage to stay in sync
        const current = getChatMessages(emergencyId);
        if (!current.find((m) => m.id === msg.id)) {
          current.push(msg);
          localStorage.setItem(`${CHAT_KEY}_${emergencyId}`, JSON.stringify(current));
          callback(current);
        }
      })
      .subscribe();
  }

  // Return cleanup function
  return () => {
    window.removeEventListener("storage", handler);
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  };
}

// ═══════════════════════════════════════════════════════════════
// Missed Call System — Synced between Dashboard & Admin Phone
// ═══════════════════════════════════════════════════════════════
const MISSED_CALL_KEY = "sosphere_missed_calls";
const MISSED_CALL_NOTIFY_KEY = "sosphere_missed_call_notify";

export interface MissedCall {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole?: string;
  zone?: string;
  phone?: string;
  timestamp: number;
  missedOn: "desktop" | "phone" | "both";
  seen: boolean;
}

export function addMissedCall(call: Omit<MissedCall, "id" | "seen">): MissedCall {
  const full: MissedCall = {
    ...call,
    id: `MC-${Date.now().toString(36).toUpperCase()}`,
    seen: false,
  };
  const all = getMissedCalls();
  all.unshift(full);
  const payload = JSON.stringify(all.slice(0, 50));
  localStorage.setItem(MISSED_CALL_KEY, payload);
  window.dispatchEvent(new StorageEvent("storage", { key: MISSED_CALL_NOTIFY_KEY, newValue: JSON.stringify(full) }));
  window.dispatchEvent(new StorageEvent("storage", { key: MISSED_CALL_KEY, newValue: payload }));
  return full;
}

export function getMissedCalls(): MissedCall[] {
  try { return JSON.parse(localStorage.getItem(MISSED_CALL_KEY) || "[]"); } catch { return []; }
}

export function markMissedCallSeen(callId: string) {
  const all = getMissedCalls();
  const mc = all.find(c => c.id === callId);
  if (mc) {
    mc.seen = true;
    const payload = JSON.stringify(all);
    localStorage.setItem(MISSED_CALL_KEY, payload);
    window.dispatchEvent(new StorageEvent("storage", { key: MISSED_CALL_KEY, newValue: payload }));
  }
}

export function getUnseenMissedCalls(): MissedCall[] {
  return getMissedCalls().filter(c => !c.seen);
}

export function onMissedCallChange(callback: (calls: MissedCall[]) => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === MISSED_CALL_KEY && e.newValue) {
      try { callback(JSON.parse(e.newValue)); } catch {}
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export function onMissedCallNotify(callback: (call: MissedCall) => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === MISSED_CALL_NOTIFY_KEY && e.newValue) {
      try { callback(JSON.parse(e.newValue)); } catch {}
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// ═══════════════════════════════════════════════════════════════
// Audio Evidence Store
// ═══════════════════════════════════════════════════════════════
const AUDIO_KEY = "sosphere_audio_evidence";

export interface AudioEvidence {
  id: string;
  emergencyId: string;
  employeeName: string;
  durationSeconds: number;
  recordedAt: number;
  // In real app, this would be a URL to stored audio file
  // For prototype, we store a flag
  hasAudio: true;
}

export function saveAudioEvidence(evidence: Omit<AudioEvidence, "id">) {
  const full = { ...evidence, id: `AUD-${Date.now().toString(36).toUpperCase()}` };
  const all = getAudioEvidences();
  all.push(full);
  localStorage.setItem(AUDIO_KEY, JSON.stringify(all));
  window.dispatchEvent(new StorageEvent("storage", { key: AUDIO_KEY, newValue: JSON.stringify(all) }));
  return full;
}

export function getAudioEvidences(): AudioEvidence[] {
  try { return JSON.parse(localStorage.getItem(AUDIO_KEY) || "[]"); } catch { return []; }
}

export function getAudioByEmergency(emergencyId: string): AudioEvidence[] {
  return getAudioEvidences().filter(a => a.emergencyId === emergencyId);
}

// ═══════════════════════════════════════════════════���═══════════
// Trip Tracking & Route History — WIYAK GPS-style
// Records location breadcrumbs for each employee during shift
// ═══════════════════════════════════════════════════════════════

const TRIP_HISTORY_KEY = "sosphere_trip_history";

export interface TripWaypoint {
  lat: number;
  lng: number;
  timestamp: number;
  speed?: number;       // km/h
  heading?: number;     // degrees 0-360
  event?: "start" | "stop" | "checkpoint" | "geofence_enter" | "geofence_exit" | "sos" | "idle";
  zoneName?: string;
}

export interface EmployeeTrip {
  id: string;
  employeeId: string;
  employeeName: string;
  status: "active" | "completed" | "paused";
  startedAt: number;
  endedAt?: number;
  waypoints: TripWaypoint[];
  totalDistanceKm: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  idleTimeMinutes: number;
  checkpoints: number;
  zone: string;
}

// Simulated route paths (realistic GPS breadcrumbs in Riyadh)
const SIMULATED_ROUTES: Record<string, TripWaypoint[]> = {
  "EMP-001": [
    { lat: 24.7120, lng: 46.6730, timestamp: Date.now() - 7200000, speed: 0, event: "start", zoneName: "Zone A" },
    { lat: 24.7124, lng: 46.6738, timestamp: Date.now() - 6600000, speed: 5.2 },
    { lat: 24.7128, lng: 46.6742, timestamp: Date.now() - 6000000, speed: 4.8 },
    { lat: 24.7130, lng: 46.6748, timestamp: Date.now() - 5400000, speed: 3.1, event: "checkpoint" },
    { lat: 24.7133, lng: 46.6750, timestamp: Date.now() - 4800000, speed: 2.5 },
    { lat: 24.7135, lng: 46.6753, timestamp: Date.now() - 4200000, speed: 0, event: "idle" },
    { lat: 24.7135, lng: 46.6753, timestamp: Date.now() - 3600000, speed: 0 },
    { lat: 24.7136, lng: 46.6755, timestamp: Date.now() - 3000000, speed: 4.2 },
    { lat: 24.7138, lng: 46.6752, timestamp: Date.now() - 2400000, speed: 5.8 },
    { lat: 24.7140, lng: 46.6748, timestamp: Date.now() - 1800000, speed: 6.1, event: "checkpoint" },
    { lat: 24.7138, lng: 46.6745, timestamp: Date.now() - 1200000, speed: 4.3 },
    { lat: 24.7136, lng: 46.6750, timestamp: Date.now() - 600000, speed: 3.7 },
    { lat: 24.7136, lng: 46.6753, timestamp: Date.now(), speed: 0, event: "stop" },
  ],
  "EMP-002": [
    { lat: 24.7145, lng: 46.6790, timestamp: Date.now() - 5400000, speed: 0, event: "start", zoneName: "Zone B" },
    { lat: 24.7147, lng: 46.6795, timestamp: Date.now() - 4800000, speed: 3.5 },
    { lat: 24.7150, lng: 46.6800, timestamp: Date.now() - 4200000, speed: 4.2, event: "checkpoint" },
    { lat: 24.7152, lng: 46.6805, timestamp: Date.now() - 3600000, speed: 3.8 },
    { lat: 24.7148, lng: 46.6808, timestamp: Date.now() - 3000000, speed: 5.1 },
    { lat: 24.7146, lng: 46.6803, timestamp: Date.now() - 2400000, speed: 4.5, event: "checkpoint" },
    { lat: 24.7149, lng: 46.6798, timestamp: Date.now() - 1800000, speed: 3.2 },
    { lat: 24.7150, lng: 46.6800, timestamp: Date.now() - 600000, speed: 2.1 },
  ],
  "EMP-006": [
    { lat: 24.7100, lng: 46.6810, timestamp: Date.now() - 3600000, speed: 0, event: "start", zoneName: "Zone D" },
    { lat: 24.7098, lng: 46.6815, timestamp: Date.now() - 3000000, speed: 4.5 },
    { lat: 24.7095, lng: 46.6818, timestamp: Date.now() - 2400000, speed: 5.2, event: "checkpoint" },
    { lat: 24.7092, lng: 46.6822, timestamp: Date.now() - 1800000, speed: 3.8 },
    { lat: 24.7090, lng: 46.6825, timestamp: Date.now() - 1200000, speed: 6.5, event: "geofence_exit" },
    { lat: 24.7088, lng: 46.6828, timestamp: Date.now() - 600000, speed: 0, event: "idle" },
    { lat: 24.7090, lng: 46.6820, timestamp: Date.now() - 120000, speed: 12.4, event: "sos", zoneName: "Zone D" },
  ],
  "EMP-005": [
    { lat: 24.7165, lng: 46.6760, timestamp: Date.now() - 4200000, speed: 0, event: "start", zoneName: "Zone C" },
    { lat: 24.7167, lng: 46.6765, timestamp: Date.now() - 3600000, speed: 4.0 },
    { lat: 24.7170, lng: 46.6770, timestamp: Date.now() - 3000000, speed: 3.8, event: "checkpoint" },
    { lat: 24.7172, lng: 46.6775, timestamp: Date.now() - 2400000, speed: 5.0 },
    { lat: 24.7168, lng: 46.6772, timestamp: Date.now() - 1800000, speed: 2.5 },
    { lat: 24.7170, lng: 46.6770, timestamp: Date.now() - 600000, speed: 3.2 },
  ],
};

function calcTripDistance(waypoints: TripWaypoint[]): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const R = 6371;
    const toRad = (d: number) => d * Math.PI / 180;
    const dLat = toRad(waypoints[i].lat - waypoints[i-1].lat);
    const dLng = toRad(waypoints[i].lng - waypoints[i-1].lng);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(waypoints[i-1].lat)) * Math.cos(toRad(waypoints[i].lat)) * Math.sin(dLng/2)**2;
    total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  return Math.round(total * 100) / 100;
}

export function getActiveTrips(): EmployeeTrip[] {
  return Object.entries(SIMULATED_ROUTES).map(([empId, waypoints]) => {
    const speeds = waypoints.filter(w => w.speed != null && w.speed > 0).map(w => w.speed!);
    const idlePoints = waypoints.filter(w => w.event === "idle" || w.speed === 0);
    const checkpoints = waypoints.filter(w => w.event === "checkpoint").length;
    return {
      id: `TRIP-${empId}`,
      employeeId: empId,
      employeeName: EMPLOYEE_NAMES[empId] || empId,
      status: empId === "EMP-006" ? "active" as const : waypoints[waypoints.length - 1]?.event === "stop" ? "completed" as const : "active" as const,
      startedAt: waypoints[0].timestamp,
      endedAt: waypoints[waypoints.length - 1]?.event === "stop" ? waypoints[waypoints.length - 1].timestamp : undefined,
      waypoints,
      totalDistanceKm: calcTripDistance(waypoints),
      maxSpeedKmh: speeds.length > 0 ? Math.max(...speeds) : 0,
      avgSpeedKmh: speeds.length > 0 ? Math.round(speeds.reduce((a,b) => a + b, 0) / speeds.length * 10) / 10 : 0,
      idleTimeMinutes: idlePoints.length * 10,
      checkpoints,
      zone: waypoints[0]?.zoneName || "Unknown",
    };
  });
}

export function getTripHistory(): EmployeeTrip[] {
  try { return JSON.parse(localStorage.getItem(TRIP_HISTORY_KEY) || "[]"); } catch { return []; }
}

export function getEmployeeTrip(employeeId: string): EmployeeTrip | null {
  return getActiveTrips().find(t => t.employeeId === employeeId) || null;
}

// Get live GPS data for all employees (combines simulated + compliance)
export function getLiveWorkerPositions(): {
  id: string; name: string; role: string;
  lat: number; lng: number; status: "active" | "late" | "sos" | "offline";
  zone: string; battery: number; signal: "strong" | "medium" | "weak";
  speed: number; lastUpdate: number; hasTrip: boolean;
}[] {
  const roleMap: Record<string, string> = {
    "EMP-001": "Field Engineer", "EMP-002": "Safety Inspector",
    "EMP-003": "Operator", "EMP-005": "HSE Coordinator",
    "EMP-006": "Technician", "EMP-007": "Lab Technician",
    "EMP-008": "Site Manager", "EMP-009": "Electrician",
    "EMP-010": "Fire Marshal", "EMP-011": "Crane Operator",
    "EMP-013": "Welder",
  };
  const zoneMap: Record<string, string> = {
    "EMP-001": "Zone A", "EMP-002": "Zone B",
    "EMP-003": "Zone A", "EMP-005": "Zone C",
    "EMP-006": "Zone D", "EMP-007": "Zone C",
    "EMP-008": "Zone A", "EMP-009": "Zone B",
    "EMP-010": "Zone D", "EMP-011": "Zone E",
    "EMP-013": "Zone A",
  };
  const statusMap: Record<string, "active" | "late" | "sos" | "offline"> = {
    "EMP-001": "active", "EMP-002": "active",
    "EMP-003": "late", "EMP-005": "active",
    "EMP-006": "sos", "EMP-007": "active",
    "EMP-008": "active", "EMP-009": "active",
    "EMP-010": "active", "EMP-011": "active",
    "EMP-013": "active",
  };
  const trips = getActiveTrips();
  return Object.entries(SIMULATED_GPS).map(([empId, gps]) => {
    const trip = trips.find(t => t.employeeId === empId);
    const lastWaypoint = trip?.waypoints[trip.waypoints.length - 1];
    // Read real GPS from offline-gps-tracker store
    const liveGpsList: any[] = (() => { try { return JSON.parse(localStorage.getItem("sosphere_gps_trail") || "[]"); } catch { return []; } })();
    const liveGps = liveGpsList.filter(p => p.employeeId === empId).slice(-1)[0];
    const finalLat = lastWaypoint ? lastWaypoint.lat : (liveGps?.lat ?? gps.lat);
    const finalLng = lastWaypoint ? lastWaypoint.lng : (liveGps?.lng ?? gps.lng);
    // Battery from sync data store
    const syncBattery = (() => { try { const s = JSON.parse(localStorage.getItem(`sosphere_sync_${empId}`) || "{}"); return s.batteryLevel; } catch { return undefined; } })();
    return {
      id: empId,
      name: EMPLOYEE_NAMES[empId] || empId,
      role: roleMap[empId] || "Worker",
      lat: finalLat,
      lng: finalLng,
      status: statusMap[empId] || ("active" as const),
      zone: zoneMap[empId] || "Unassigned",
      battery: syncBattery ?? (gps.drift < 0.001 ? 85 : gps.drift < 0.003 ? 65 : 45),
      signal: (gps.drift < 0.001 ? "strong" : gps.drift < 0.003 ? "medium" : "weak") as "strong" | "medium" | "weak",
      speed: lastWaypoint?.speed || 0,
      lastUpdate: lastWaypoint?.timestamp || liveGps?.timestamp || Date.now() - 300000,
      hasTrip: !!trip,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// Employee Sync Data — Battery / Signal from last SOS or sync event
// Used by IRE + SOS Popup to show real device data instead of hardcoded values
// ═══════════════════════════════════════════════════════════════

const EMP_SYNC_KEY = "sosphere_emp_sync";

export interface EmployeeSyncData {
  employeeId: string;
  battery: number | null;
  signal: string;
  updatedAt: number;
}

export function saveEmployeeSync(data: EmployeeSyncData) {
  const all = getAllEmployeeSyncs();
  const idx = all.findIndex(s => s.employeeId === data.employeeId);
  if (idx >= 0) all[idx] = data; else all.push(data);
  safeSetItem(EMP_SYNC_KEY, JSON.stringify(all.slice(-100)));
}

export function getAllEmployeeSyncs(): EmployeeSyncData[] {
  try { return JSON.parse(localStorage.getItem(EMP_SYNC_KEY) || "[]"); } catch { return []; }
}

export function getLastEmployeeSync(employeeId: string): EmployeeSyncData | null {
  // Try exact match from sync store
  const syncs = getAllEmployeeSyncs();
  const match = syncs.find(s => s.employeeId === employeeId);
  if (match) return match;

  // Fallback: check SOS_TRIGGERED events in the sync queue for battery/signal
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const queue: any[] = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)];
      const sosEvents = queue
        .filter(e => (e.type === "SOS_TRIGGERED" || e.type === "LOCATION_UPDATE") && e.employeeId === employeeId && e.data)
        .sort((a, b) => (b._ts || b.timestamp || 0) - (a._ts || a.timestamp || 0));
      if (sosEvents.length > 0) {
        const latest = sosEvents[0];
        return {
          employeeId,
          battery: latest.data?.battery ?? null,
          signal: latest.data?.signal ?? "unknown",
          updatedAt: latest._ts || latest.timestamp || Date.now(),
        };
      }
    }
  } catch {}

  // Fallback: derive from live worker positions (simulated GPS data)
  const workers = getLiveWorkerPositions();
  const worker = workers.find(w => w.id === employeeId);
  if (worker) {
    return {
      employeeId,
      battery: worker.battery,
      signal: worker.signal === "strong" ? "excellent" : worker.signal === "medium" ? "good" : "poor",
      updatedAt: worker.lastUpdate,
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// Buddy System — Cross-feature buddy lookup
// Reads persisted pairs from localStorage (written by buddy-system.tsx)
// ═══════════════════════════════════════════════════════════════

const BUDDY_PAIRS_KEY = "sosphere_buddy_pairs";

export interface StoredBuddyPair {
  id: string;
  employee1Id: string;
  employee1Name: string;
  employee2Id: string;
  employee2Name: string;
  isActive: boolean;
}

/** Get the buddy partner for a given employee ID. Returns null if no active buddy. */
export function getBuddyFor(employeeId: string): { buddyId: string; buddyName: string } | null {
  try {
    const raw = localStorage.getItem(BUDDY_PAIRS_KEY);
    if (!raw) return null;
    const pairs: StoredBuddyPair[] = JSON.parse(raw);
    for (const p of pairs) {
      if (!p.isActive) continue;
      if (p.employee1Id === employeeId) return { buddyId: p.employee2Id, buddyName: p.employee2Name };
      if (p.employee2Id === employeeId) return { buddyId: p.employee1Id, buddyName: p.employee1Name };
    }
  } catch {}
  return null;
}

/** Save buddy pairs (called by buddy-system.tsx) */
export function saveBuddyPairs(pairs: StoredBuddyPair[]) {
  safeSetItem(BUDDY_PAIRS_KEY, JSON.stringify(pairs));
  console.log("[SUPABASE_READY] buddy_pairs:", JSON.stringify(pairs));
}

/** Load buddy pairs */
export function loadBuddyPairs(): StoredBuddyPair[] {
  try {
    const pairs: StoredBuddyPair[] = JSON.parse(localStorage.getItem(BUDDY_PAIRS_KEY) || "[]");
    console.log("[SUPABASE_READY] loading buddy_pairs, count:" + pairs.length);
    return pairs;
  } catch { return []; }
}