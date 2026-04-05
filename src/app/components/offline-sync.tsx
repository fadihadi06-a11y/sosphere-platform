// ═══════════════════════════════════════════════════════════════
// SOSphere — Offline Mode UI + Full Integration
// ─────────────────────────────────────────────────────────────
// Visual layer for the offline system:
//  • Floating status pill (Online/Offline/Syncing)
//  • Full-screen offline banner with safety guarantees
//  • Expanded panel: storage stats, sync progress, GPS trail
//  • Sync progress animation per category
//  • Storage quota meter
//  • Integration with IndexedDB + GPS Tracker + Sync Engine
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Wifi, WifiOff, RefreshCw, Check, X,
  AlertTriangle, MapPin, Clock, Database,
  Shield, Zap, ChevronDown, ChevronUp,
  Radio, Satellite, BatteryLow, BatteryMedium,
  BatteryFull, HardDrive, Send,
  MessageSquare, Navigation, Power,
} from "lucide-react";

import { getStorageStats, type OfflineStorageStats } from "./offline-database";
import { storeJSONSync, loadJSONSync } from "./api/storage-adapter";
import {
  subscribeToTracker, getTrackerState, startGPSTracking,
  stopGPSTracking, activateEmergencyTracking,
  type GPSTrackerState, ZONE_PRESETS,
} from "./offline-gps-tracker";
import {
  startSync, abortSync, enableAutoSync,
  subscribeToSyncProgress, getSyncProgress, isSyncRunning,
  getQuickSyncStats, type SyncProgress, type QuickSyncStats,
} from "./offline-sync-engine";

// ── Backward-compat exports (used by old code) ────────────────
// Keep these so existing imports don't break

export interface OfflineQueueItem {
  id: string;
  type: "sos" | "checkin" | "location" | "hazard" | "incident_report";
  timestamp: number;
  data: Record<string, any>;
  retries: number;
  synced: boolean;
}

const OFFLINE_QUEUE_KEY = "sosphere_offline_queue";

export function getOfflineQueue(): OfflineQueueItem[] {
  return loadJSONSync<OfflineQueueItem[]>(OFFLINE_QUEUE_KEY, []);
}

export function addToOfflineQueue(item: Omit<OfflineQueueItem, "id" | "retries" | "synced">) {
  const queue = getOfflineQueue();
  queue.push({
    ...item,
    id: `OQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    retries: 0,
    synced: false,
  });
  storeJSONSync(OFFLINE_QUEUE_KEY, queue);
  return queue.length;
}

export function markQueueItemSynced(id: string) {
  const queue = getOfflineQueue();
  const updated = queue.map(item => item.id === id ? { ...item, synced: true } : item);
  storeJSONSync(OFFLINE_QUEUE_KEY, updated);
}

export function clearSyncedItems() {
  const queue = getOfflineQueue().filter(item => !item.synced);
  storeJSONSync(OFFLINE_QUEUE_KEY, queue);
}

export function cacheLocation(lat: number, lng: number, accuracy: number) {
  const locs = loadJSONSync<Array<{ lat: number; lng: number; accuracy: number; ts: number }>>("sosphere_offline_locations", []);
  locs.push({ lat, lng, accuracy, ts: Date.now() });
  if (locs.length > 500) locs.splice(0, locs.length - 500);
  storeJSONSync("sosphere_offline_locations", locs);
  return locs.length;
}

export function getCachedLocationCount(): number {
  return loadJSONSync<Array<unknown>>("sosphere_offline_locations", []).length;
}

export function triggerOfflineSOS(employeeId: string, employeeName: string, zone: string) {
  const isOnline = navigator.onLine;
  const locationPromise = new Promise<{ lat: number; lng: number; accuracy: number }>((resolve) => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => resolve({ lat: 24.7136, lng: 46.6753, accuracy: 999 }),
        { timeout: 5000, enableHighAccuracy: true }
      );
    } else {
      resolve({ lat: 24.7136, lng: 46.6753, accuracy: 999 });
    }
  });
  locationPromise.then(location => {
    const sosData = {
      type: "sos" as const,
      timestamp: Date.now(),
      data: { employeeId, employeeName, zone, location, triggerMethod: "manual", networkStatus: isOnline ? "online" : "offline" },
    };
    if (!isOnline) {
      addToOfflineQueue(sosData);
      cacheLocation(location.lat, location.lng, location.accuracy);
    }
    // Also store in IndexedDB via new system
    import("./offline-database").then(db => {
      db.queueSOS({
        employeeId, employeeName, zone,
        lat: location.lat, lng: location.lng, accuracy: location.accuracy,
        triggerMethod: "manual", severity: "critical", timestamp: Date.now(),
        networkStatusAtTrigger: isOnline ? "online" : "offline",
        batteryLevel: null, metadata: {},
      });
    }).catch(err => {
      console.error("IndexedDB SOS queue failed:", err);
      addToOfflineQueue(sosData); // fallback to localStorage
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Battery Icon Helper
// ═══════════════════════════════════════════════════════════════

function BatteryIcon({ level }: { level: number | null }) {
  if (level === null) return <BatteryMedium className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />;
  if (level < 0.2) return <BatteryLow className="size-3" style={{ color: "#FF2D55" }} />;
  if (level < 0.5) return <BatteryMedium className="size-3" style={{ color: "#FF9500" }} />;
  return <BatteryFull className="size-3" style={{ color: "#00C853" }} />;
}

// ═══════════════════════════════════════════════════════════════
// Sync Category Progress Bar
// ═══════════════════════════════════════════════════════════════

const CATEGORY_META: Record<string, { label: string; icon: any; color: string; priority: string }> = {
  sos:       { label: "SOS Alerts",   icon: Zap,            color: "#FF2D55", priority: "P1" },
  checkins:  { label: "Check-ins",    icon: Clock,          color: "#FF9500", priority: "P2" },
  incidents: { label: "Incidents",    icon: AlertTriangle,  color: "#8B5CF6", priority: "P3" },
  messages:  { label: "Messages",     icon: MessageSquare,  color: "#00C8E0", priority: "P4" },
  gps:       { label: "GPS Trail",    icon: Navigation,     color: "#00C853", priority: "P5" },
};

function CategoryProgressRow({ category, data }: {
  category: string;
  data: { total: number; synced: number; failed: number; status: string };
}) {
  const meta = CATEGORY_META[category];
  if (!meta || data.total === 0) return null;

  const pct = data.total > 0 ? Math.round((data.synced / data.total) * 100) : 0;
  const Icon = meta.icon;

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="size-5 rounded flex items-center justify-center" style={{ background: `${meta.color}10` }}>
        <Icon className="size-2.5" style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-1.5">
            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>{meta.label}</span>
            <span className="px-1 rounded" style={{ fontSize: 6, fontWeight: 800, color: meta.color, background: `${meta.color}10` }}>{meta.priority}</span>
          </div>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", fontVariantNumeric: "tabular-nums" }}>
            {data.synced}/{data.total}
            {data.failed > 0 && <span style={{ color: "#FF2D55" }}> ({data.failed} failed)</span>}
          </span>
        </div>
        <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
          <motion.div
            className="h-full rounded-full"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.3 }}
            style={{ background: meta.color, opacity: data.status === "syncing" ? 1 : 0.5 }}
          />
        </div>
      </div>
      {data.status === "syncing" && (
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
          <RefreshCw className="size-3" style={{ color: meta.color }} />
        </motion.div>
      )}
      {data.status === "done" && data.failed === 0 && (
        <Check className="size-3" style={{ color: "#00C853" }} />
      )}
      {data.status === "done" && data.failed > 0 && (
        <AlertTriangle className="size-3" style={{ color: "#FF9500" }} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Storage Quota Meter
// ═══════════════════════════════════════════════════════════════

function StorageQuotaMeter({ stats }: { stats: OfflineStorageStats | null }) {
  if (!stats) return null;

  const usedMB = stats.estimatedSizeMB;
  const quotaMB = stats.storageQuotaMB || 500; // fallback estimate
  const pct = Math.min(100, Math.round((usedMB / quotaMB) * 100));
  const color = pct > 80 ? "#FF2D55" : pct > 50 ? "#FF9500" : "#00C8E0";

  return (
    <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)" }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <HardDrive className="size-3" style={{ color }} />
          <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>IndexedDB Storage</span>
        </div>
        <span style={{ fontSize: 8, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>
          {usedMB}MB / {quotaMB > 1000 ? `${(quotaMB / 1000).toFixed(1)}GB` : `${quotaMB}MB`}
        </span>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct, 1)}%`, background: color }} />
      </div>
      <div className="flex gap-3 mt-2">
        {[
          { label: "SOS", count: stats.sosUnsynced, color: "#FF2D55" },
          { label: "GPS", count: stats.gpsUnsynced, color: "#00C853" },
          { label: "Check-ins", count: stats.checkinsUnsynced, color: "#FF9500" },
          { label: "Messages", count: stats.messagesUnsynced, color: "#00C8E0" },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-1">
            <div className="size-1.5 rounded-full" style={{ background: item.color }} />
            <span style={{ fontSize: 7, color: "rgba(255,255,255,0.2)" }}>
              {item.label}: <span style={{ color: item.count > 0 ? item.color : "rgba(255,255,255,0.15)", fontWeight: 700 }}>{item.count}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GPS Tracker Status Mini
// ═══════════════════════════════════════════════════════════════

function GPSTrackerMini({ gpsState }: { gpsState: GPSTrackerState }) {
  return (
    <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)" }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Satellite className="size-3" style={{ color: gpsState.isTracking ? "#00C853" : "rgba(255,255,255,0.15)" }} />
          <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>GPS Tracker</span>
          {gpsState.deadReckoningActive && (
            <span className="px-1 rounded" style={{ fontSize: 6, fontWeight: 800, color: "#FF9500", background: "rgba(255,149,0,0.1)" }}>
              DEAD RECKONING
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {gpsState.isTracking && (
            <motion.div
              animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="size-1.5 rounded-full"
              style={{ background: "#00C853" }}
            />
          )}
          <span style={{ fontSize: 8, fontWeight: 600, color: gpsState.isTracking ? "#00C853" : "rgba(255,255,255,0.15)" }}>
            {gpsState.isTracking ? "Active" : "Stopped"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <p style={{ fontSize: 7, color: "rgba(255,255,255,0.15)" }}>Points</p>
          <p style={{ fontSize: 11, fontWeight: 800, color: "#00C8E0", fontVariantNumeric: "tabular-nums" }}>
            {gpsState.totalPointsRecorded.toLocaleString()}
          </p>
        </div>
        <div>
          <p style={{ fontSize: 7, color: "rgba(255,255,255,0.15)" }}>Unsynced</p>
          <p style={{ fontSize: 11, fontWeight: 800, color: gpsState.unsyncedPoints > 0 ? "#FF9500" : "#00C853", fontVariantNumeric: "tabular-nums" }}>
            {gpsState.unsyncedPoints.toLocaleString()}
          </p>
        </div>
        <div>
          <p style={{ fontSize: 7, color: "rgba(255,255,255,0.15)" }}>Interval</p>
          <p style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.4)" }}>
            {gpsState.currentInterval < 1000 ? `${gpsState.currentInterval}ms` : `${gpsState.currentInterval / 1000}s`}
          </p>
        </div>
      </div>

      {gpsState.lastPosition && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <MapPin className="size-2.5" style={{ color: "rgba(255,255,255,0.15)" }} />
          <span style={{ fontSize: 7, color: "rgba(255,255,255,0.15)", fontVariantNumeric: "tabular-nums" }}>
            {gpsState.lastPosition.lat.toFixed(6)}, {gpsState.lastPosition.lng.toFixed(6)}
            {" "}(±{Math.round(gpsState.lastPosition.accuracy)}m)
          </span>
        </div>
      )}

      {gpsState.isLowBattery && (
        <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded" style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.1)" }}>
          <BatteryLow className="size-3" style={{ color: "#FF2D55" }} />
          <span style={{ fontSize: 8, color: "#FF2D55", fontWeight: 600 }}>
            Low battery — tracking every {gpsState.currentInterval / 1000}s
          </span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Offline Indicator Component
// ═══════════════════════════════════════════════════════════════

interface OfflineIndicatorProps {
  compact?: boolean;
}

export function OfflineIndicator({ compact = false }: OfflineIndicatorProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [expanded, setExpanded] = useState(false);
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress>(getSyncProgress());
  const [gpsState, setGpsState] = useState<GPSTrackerState>(getTrackerState());
  const [storageStats, setStorageStats] = useState<OfflineStorageStats | null>(null);
  const [quickStats, setQuickStats] = useState<QuickSyncStats | null>(null);
  const initialized = useRef(false);

  // Initialize systems
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Enable auto-sync
    enableAutoSync();

    // Subscribe to GPS tracker
    const unsubGPS = subscribeToTracker(setGpsState);

    // Subscribe to sync progress
    const unsubSync = subscribeToSyncProgress((progress) => {
      setSyncProgress(progress);
      if (!progress.isRunning && progress.completedAt && progress.totalSynced > 0) {
        setJustSynced(true);
        setTimeout(() => setJustSynced(false), 3000);
      }
    });

    return () => {
      unsubGPS();
      unsubSync();
    };
  }, []);

  // Monitor network
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowOfflineBanner(false);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setShowOfflineBanner(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Refresh stats when expanded
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const [stats, quick] = await Promise.all([getStorageStats(), getQuickSyncStats()]);
        if (!cancelled) {
          setStorageStats(stats);
          setQuickStats(quick);
        }
      } catch { /* ignore */ }
    };

    refresh();
    const interval = setInterval(refresh, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [expanded]);

  const handleSync = useCallback(async () => {
    if (isSyncRunning()) {
      abortSync();
    } else {
      await startSync();
    }
  }, []);

  const handleToggleGPS = useCallback(() => {
    if (gpsState.isTracking) {
      stopGPSTracking();
    } else {
      startGPSTracking({ employeeId: "EMP-001", ...ZONE_PRESETS.high });
    }
  }, [gpsState.isTracking]);

  const formatLastSync = (ts: number | null | undefined) => {
    if (!ts) return "Never";
    const diff = Math.round((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    return `${Math.round(diff / 3600)}h ago`;
  };

  const totalUnsynced = quickStats?.totalUnsynced || 0;
  const isSyncing = syncProgress.isRunning;

  // ── Minimal pill when online + nothing pending ──────────────
  if (isOnline && totalUnsynced === 0 && !isSyncing && !justSynced && !expanded) {
    if (compact) return null;
    return (
      <button onClick={() => setExpanded(true)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
        style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.08)" }}>
        <div className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: "#00C853" }}>Online</span>
        {gpsState.isTracking && (
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Satellite className="size-2.5" style={{ color: "rgba(0,200,83,0.5)" }} />
          </motion.div>
        )}
      </button>
    );
  }

  return (
    <>
      {/* ═══ Offline Banner — Full Width Alert ═══ */}
      <AnimatePresence>
        {!isOnline && showOfflineBanner && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="absolute top-12 left-3 right-3 z-[60] rounded-2xl overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(255,149,0,0.12), rgba(255,45,85,0.08))",
              border: "1px solid rgba(255,149,0,0.2)",
              backdropFilter: "blur(20px)",
            }}
          >
            <div className="p-3.5">
              <div className="flex items-start gap-3">
                <div className="size-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(255,149,0,0.12)" }}>
                  <WifiOff className="size-4" style={{ color: "#FF9500" }} />
                </div>
                <div className="flex-1">
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>You're Offline</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, marginTop: 2 }}>
                    All safety features still work. Data is stored in IndexedDB and will auto-sync when connection returns.
                  </p>
                </div>
                <button onClick={() => setShowOfflineBanner(false)}
                  className="size-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "rgba(255,255,255,0.05)" }}>
                  <X className="size-3" style={{ color: "rgba(255,255,255,0.3)" }} />
                </button>
              </div>

              {/* Protection Status */}
              <div className="flex gap-2 mt-3">
                {[
                  { icon: Shield, label: "SOS Active", color: "#00C853" },
                  { icon: Satellite, label: gpsState.isTracking ? "GPS Recording" : "GPS Off", color: gpsState.isTracking ? "#00C8E0" : "#FF9500" },
                  { icon: Clock, label: "Timer Active", color: "#FF9500" },
                  { icon: Database, label: `${totalUnsynced} Queued`, color: "#7B5EFF" },
                ].map(item => (
                  <div key={item.label} className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
                    style={{ background: `${item.color}08`, border: `1px solid ${item.color}12` }}>
                    <item.icon className="size-3" style={{ color: item.color }} />
                    <span style={{ fontSize: 8, fontWeight: 600, color: item.color }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Auto-sync countdown */}
            <div className="px-3.5 py-2" style={{ background: "rgba(0,200,224,0.04)", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
              <div className="flex items-center gap-2">
                <Radio className="size-3" style={{ color: "#00C8E0" }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                  Auto-sync will start immediately when connection is restored
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Floating Status Pill ═══ */}
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
          style={{
            background: !isOnline
              ? "rgba(255,149,0,0.06)"
              : justSynced
                ? "rgba(0,200,83,0.06)"
                : isSyncing
                  ? "rgba(0,200,224,0.06)"
                  : totalUnsynced > 0
                    ? "rgba(255,149,0,0.06)"
                    : "rgba(0,200,83,0.04)",
            border: `1px solid ${!isOnline ? "rgba(255,149,0,0.15)" : justSynced ? "rgba(0,200,83,0.12)" : totalUnsynced > 0 ? "rgba(255,149,0,0.12)" : "rgba(0,200,83,0.08)"}`,
          }}
        >
          {!isOnline ? (
            <>
              <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
                <WifiOff className="size-3" style={{ color: "#FF9500" }} />
              </motion.div>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#FF9500" }}>Offline</span>
              {totalUnsynced > 0 && (
                <span className="px-1 py-0.5 rounded" style={{ background: "rgba(255,149,0,0.12)", fontSize: 8, fontWeight: 800, color: "#FF9500" }}>
                  {totalUnsynced}
                </span>
              )}
            </>
          ) : isSyncing ? (
            <>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                <RefreshCw className="size-3" style={{ color: "#00C8E0" }} />
              </motion.div>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0" }}>
                Syncing {syncProgress.overallProgress}%
              </span>
            </>
          ) : justSynced ? (
            <>
              <Check className="size-3" style={{ color: "#00C853" }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: "#00C853" }}>Synced</span>
            </>
          ) : totalUnsynced > 0 ? (
            <>
              <Database className="size-3" style={{ color: "#FF9500" }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: "#FF9500" }}>{totalUnsynced} pending</span>
            </>
          ) : (
            <>
              <div className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
              <span style={{ fontSize: 9, fontWeight: 600, color: "#00C853" }}>Online</span>
            </>
          )}

          {expanded ? <ChevronUp className="size-2.5" style={{ color: "rgba(255,255,255,0.2)" }} /> : <ChevronDown className="size-2.5" style={{ color: "rgba(255,255,255,0.2)" }} />}
        </button>

        {/* ═══ Expanded Details Panel ═══ */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              className="absolute top-full right-0 mt-2 rounded-2xl overflow-hidden z-50"
              style={{
                width: 310,
                background: "rgba(10,18,32,0.97)",
                border: "1px solid rgba(255,255,255,0.06)",
                backdropFilter: "blur(24px)",
                boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
              }}
            >
              <div className="p-3 space-y-2.5">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="size-3.5" style={{ color: "#00C8E0" }} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.7)" }}>Offline Safety Center</span>
                  </div>
                  <button onClick={() => setExpanded(false)}>
                    <X className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
                  </button>
                </div>

                {/* Connection Status */}
                <div className="flex items-center gap-2 p-2 rounded-lg" style={{
                  background: isOnline ? "rgba(0,200,83,0.04)" : "rgba(255,149,0,0.04)",
                  border: `1px solid ${isOnline ? "rgba(0,200,83,0.08)" : "rgba(255,149,0,0.1)"}`,
                }}>
                  {isOnline ? <Wifi className="size-3.5" style={{ color: "#00C853" }} /> : <WifiOff className="size-3.5" style={{ color: "#FF9500" }} />}
                  <div className="flex-1">
                    <span style={{ fontSize: 10, fontWeight: 700, color: isOnline ? "#00C853" : "#FF9500" }}>
                      {isOnline ? "Connected" : "Disconnected"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <BatteryIcon level={gpsState.batteryLevel} />
                    {gpsState.batteryLevel !== null && (
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>
                        {Math.round(gpsState.batteryLevel * 100)}%
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>
                    Sync: {formatLastSync(quickStats?.lastSyncTime)}
                  </span>
                </div>

                {/* GPS Tracker Status */}
                <GPSTrackerMini gpsState={gpsState} />

                {/* Sync Progress (when syncing) */}
                {isSyncing && (
                  <div className="p-2 rounded-lg" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.08)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ fontSize: 9, fontWeight: 800, color: "#00C8E0" }}>SYNC IN PROGRESS</span>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0" }}>{syncProgress.overallProgress}%</span>
                    </div>
                    {/* Overall bar */}
                    <div className="h-1.5 rounded-full mb-2 overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <motion.div
                        className="h-full rounded-full"
                        animate={{ width: `${syncProgress.overallProgress}%` }}
                        style={{ background: "linear-gradient(90deg, #00C8E0, #00C853)" }}
                      />
                    </div>
                    {/* Per-category */}
                    {(["sos", "checkins", "incidents", "messages", "gps"] as const).map(cat => (
                      <CategoryProgressRow key={cat} category={cat} data={syncProgress.categories[cat]} />
                    ))}
                  </div>
                )}

                {/* Storage Quota */}
                <StorageQuotaMeter stats={storageStats} />

                {/* Action Buttons */}
                <div className="flex gap-2">
                  {/* Sync Button */}
                  <button
                    onClick={handleSync}
                    disabled={!isOnline && !isSyncing}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                    style={{
                      background: isSyncing ? "rgba(255,45,85,0.06)" : "rgba(0,200,224,0.06)",
                      border: `1px solid ${isSyncing ? "rgba(255,45,85,0.12)" : "rgba(0,200,224,0.12)"}`,
                      opacity: !isOnline && !isSyncing ? 0.3 : 1,
                    }}
                  >
                    {isSyncing ? (
                      <>
                        <X className="size-3" style={{ color: "#FF2D55" }} />
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#FF2D55" }}>Abort Sync</span>
                      </>
                    ) : (
                      <>
                        <Send className="size-3" style={{ color: "#00C8E0" }} />
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0" }}>
                          {totalUnsynced > 0 ? `Sync ${totalUnsynced} Items` : "Force Sync"}
                        </span>
                      </>
                    )}
                  </button>

                  {/* GPS Toggle */}
                  <button
                    onClick={handleToggleGPS}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
                    style={{
                      background: gpsState.isTracking ? "rgba(0,200,83,0.06)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${gpsState.isTracking ? "rgba(0,200,83,0.12)" : "rgba(255,255,255,0.05)"}`,
                    }}
                  >
                    <Power className="size-3" style={{ color: gpsState.isTracking ? "#00C853" : "rgba(255,255,255,0.2)" }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: gpsState.isTracking ? "#00C853" : "rgba(255,255,255,0.2)" }}>
                      GPS
                    </span>
                  </button>
                </div>

                {/* Safety Guarantee */}
                <div className="p-2 rounded-lg" style={{ background: "rgba(0,200,83,0.03)", border: "1px solid rgba(0,200,83,0.06)" }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Shield className="size-3" style={{ color: "#00C853" }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: "#00C853" }}>Offline Safety Guarantee</span>
                  </div>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", lineHeight: 1.6 }}>
                    SOS, check-ins, GPS tracking, and incident reports work fully offline.
                    Data is stored in IndexedDB (up to {storageStats?.storageQuotaMB ? `${Math.round(storageStats.storageQuotaMB / 1000)}GB` : "hundreds of MB"}) and auto-syncs with priority ordering when connected.
                    SOS alerts always sync first.
                  </p>
                </div>

                {/* Sync Errors */}
                {syncProgress.errors.length > 0 && (
                  <div className="p-2 rounded-lg" style={{ background: "rgba(255,45,85,0.03)", border: "1px solid rgba(255,45,85,0.06)" }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="size-3" style={{ color: "#FF2D55" }} />
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#FF2D55" }}>
                        {syncProgress.errors.length} Sync Error{syncProgress.errors.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="space-y-0.5 max-h-16 overflow-y-auto">
                      {syncProgress.errors.slice(-3).map((err, i) => (
                        <p key={i} style={{ fontSize: 7, color: "rgba(255,45,85,0.5)" }}>{err}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}
