// ═══════════════════════════════════════════════════════════════
// SOSphere — Dashboard Offline Monitoring Page
// ─────────────────────────────────────────────────────────────
// Admin view of the entire offline system:
//  • Fleet connectivity overview (who's online/offline)
//  • Sync queue dashboard (pending data across all workers)
//  • GPS tracker fleet status
//  • Storage health across devices
//  • Service Worker status
//  • Network resilience score
//  • Auto-sync history log
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Wifi, WifiOff, Shield, Database, MapPin, Clock,
  RefreshCw, Check, AlertTriangle, Satellite, Zap,
  Users, Signal, HardDrive, Activity, BarChart3,
  Download, Upload, TrendingUp,
  ChevronRight, Radio, BatteryLow, BatteryFull,
  Globe, Server, CheckCircle2, XCircle,
  Navigation, MessageSquare, Send,
} from "lucide-react";
import {
  TOKENS, TYPOGRAPHY, PageHeader, KPICard,
} from "./design-system";
import { getStorageStats, type OfflineStorageStats } from "./offline-database";
import {
  getSWStatus, registerServiceWorker, getCacheStats,
  type SWStatus,
} from "./service-worker-register";
import { getTrackerState, type GPSTrackerState } from "./offline-gps-tracker";
import { getSyncProgress, getQuickSyncStats, startSync, type SyncProgress, type QuickSyncStats } from "./offline-sync-engine";
import { useDashboardStore, useLang } from "./stores/dashboard-store";
import { useT } from "./dashboard-i18n";

// ── Mock Fleet Data ────────────────────────────────────────────
// In production, this comes from Supabase real-time subscriptions

interface WorkerConnectivity {
  id: string;
  name: string;
  zone: string;
  isOnline: boolean;
  lastSeen: number;
  pendingSync: number;
  gpsPointsCached: number;
  batteryLevel: number;
  networkType: "wifi" | "4g" | "3g" | "satellite" | "offline";
  lastSOS: number | null;
  signalStrength: number; // 0-100
}

const MOCK_FLEET: WorkerConnectivity[] = [
  { id: "EMP-001", name: "Ahmed Al-Rashidi", zone: "Zone A - North Rig", isOnline: true, lastSeen: Date.now() - 30000, pendingSync: 0, gpsPointsCached: 1247, batteryLevel: 0.82, networkType: "4g", lastSOS: null, signalStrength: 78 },
  { id: "EMP-002", name: "Mohammed Khalil", zone: "Zone B - Pipeline", isOnline: false, lastSeen: Date.now() - 1800000, pendingSync: 47, gpsPointsCached: 3892, batteryLevel: 0.34, networkType: "offline", lastSOS: null, signalStrength: 0 },
  { id: "EMP-003", name: "Omar Farooq", zone: "Zone A - North Rig", isOnline: true, lastSeen: Date.now() - 15000, pendingSync: 3, gpsPointsCached: 856, batteryLevel: 0.91, networkType: "wifi", lastSOS: null, signalStrength: 95 },
  { id: "EMP-004", name: "Yusuf Al-Harthi", zone: "Zone C - Desert Camp", isOnline: false, lastSeen: Date.now() - 7200000, pendingSync: 156, gpsPointsCached: 8934, batteryLevel: 0.12, networkType: "offline", lastSOS: Date.now() - 3600000, signalStrength: 0 },
  { id: "EMP-005", name: "Khalid Nasser", zone: "Zone D - Offshore", isOnline: true, lastSeen: Date.now() - 5000, pendingSync: 0, gpsPointsCached: 2103, batteryLevel: 0.67, networkType: "satellite", lastSOS: null, signalStrength: 42 },
  { id: "EMP-006", name: "Faisal Rahman", zone: "Zone B - Pipeline", isOnline: true, lastSeen: Date.now() - 60000, pendingSync: 12, gpsPointsCached: 1567, batteryLevel: 0.55, networkType: "3g", lastSOS: null, signalStrength: 31 },
  { id: "EMP-007", name: "Tariq Al-Amri", zone: "Zone E - Mine Shaft", isOnline: false, lastSeen: Date.now() - 10800000, pendingSync: 289, gpsPointsCached: 12450, batteryLevel: 0.08, networkType: "offline", lastSOS: Date.now() - 7200000, signalStrength: 0 },
  { id: "EMP-008", name: "Salem Bakri", zone: "Zone A - North Rig", isOnline: true, lastSeen: Date.now() - 10000, pendingSync: 0, gpsPointsCached: 943, batteryLevel: 0.73, networkType: "4g", lastSOS: null, signalStrength: 65 },
  { id: "EMP-009", name: "Hassan Qahtani", zone: "Zone F - Coastal", isOnline: true, lastSeen: Date.now() - 45000, pendingSync: 5, gpsPointsCached: 1876, batteryLevel: 0.88, networkType: "wifi", lastSOS: null, signalStrength: 92 },
  { id: "EMP-010", name: "Nabil Zahrani", zone: "Zone C - Desert Camp", isOnline: false, lastSeen: Date.now() - 5400000, pendingSync: 98, gpsPointsCached: 6721, batteryLevel: 0.21, networkType: "offline", lastSOS: null, signalStrength: 0 },
  { id: "EMP-011", name: "Rashid Al-Dosari", zone: "Zone D - Offshore", isOnline: true, lastSeen: Date.now() - 20000, pendingSync: 1, gpsPointsCached: 2340, batteryLevel: 0.59, networkType: "satellite", lastSOS: null, signalStrength: 38 },
  { id: "EMP-012", name: "Majid Otaibi", zone: "Zone E - Mine Shaft", isOnline: false, lastSeen: Date.now() - 14400000, pendingSync: 342, gpsPointsCached: 15200, batteryLevel: 0.05, networkType: "offline", lastSOS: Date.now() - 10800000, signalStrength: 0 },
];

// ── Sync History Mock ──────────────────────────────────────────

interface SyncEvent {
  id: string;
  timestamp: number;
  type: "auto" | "manual" | "background";
  itemsSynced: number;
  itemsFailed: number;
  durationMs: number;
  categories: { sos: number; checkins: number; gps: number; incidents: number; messages: number };
}

const MOCK_SYNC_HISTORY: SyncEvent[] = [
  { id: "S1", timestamp: Date.now() - 300000, type: "auto", itemsSynced: 234, itemsFailed: 2, durationMs: 4500, categories: { sos: 0, checkins: 8, gps: 220, incidents: 1, messages: 5 } },
  { id: "S2", timestamp: Date.now() - 1800000, type: "auto", itemsSynced: 567, itemsFailed: 0, durationMs: 8200, categories: { sos: 1, checkins: 12, gps: 540, incidents: 3, messages: 11 } },
  { id: "S3", timestamp: Date.now() - 3600000, type: "manual", itemsSynced: 89, itemsFailed: 5, durationMs: 2100, categories: { sos: 0, checkins: 4, gps: 78, incidents: 0, messages: 7 } },
  { id: "S4", timestamp: Date.now() - 7200000, type: "background", itemsSynced: 1234, itemsFailed: 12, durationMs: 15600, categories: { sos: 3, checkins: 24, gps: 1180, incidents: 8, messages: 19 } },
  { id: "S5", timestamp: Date.now() - 10800000, type: "auto", itemsSynced: 456, itemsFailed: 0, durationMs: 6300, categories: { sos: 0, checkins: 15, gps: 430, incidents: 2, messages: 9 } },
];

// ═══════════════════════════════════════════════════════════════
// Helper Components
// ═══════════════════════════════════════════════════════════════

const NETWORK_ICONS: Record<string, { icon: any; color: string; label: string }> = {
  wifi: { icon: Wifi, color: "#00C853", label: "WiFi" },
  "4g": { icon: Signal, color: "#00C8E0", label: "4G" },
  "3g": { icon: Signal, color: "#FF9500", label: "3G" },
  satellite: { icon: Satellite, color: "#8B5CF6", label: "SAT" },
  offline: { icon: WifiOff, color: "#FF2D55", label: "OFF" },
};

function formatTimeAgo(ts: number): string {
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function StatBox({ icon: Icon, label, value, color, sub }: { icon: any; label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div className="p-3 rounded-xl" style={{ background: `${color}04`, border: `1px solid ${color}10` }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="size-6 rounded-lg flex items-center justify-center" style={{ background: `${color}10` }}>
          <Icon className="size-3" style={{ color }} />
        </div>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{label}</span>
      </div>
      <p style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{value}</p>
      {sub && <p style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Worker Row Component
// ═══════════════════════════════════════════════════════════════

function WorkerRow({ worker, t }: { worker: WorkerConnectivity; t: (k: string) => string }) {
  const net = NETWORK_ICONS[worker.networkType];
  const NetIcon = net.icon;
  const isCritical = !worker.isOnline && (Date.now() - worker.lastSeen > 3600000);
  const hasSOS = worker.lastSOS !== null;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
      style={{
        background: hasSOS ? "rgba(255,45,85,0.03)" : isCritical ? "rgba(255,149,0,0.03)" : "rgba(255,255,255,0.01)",
        border: `1px solid ${hasSOS ? "rgba(255,45,85,0.08)" : isCritical ? "rgba(255,149,0,0.06)" : "rgba(255,255,255,0.03)"}`,
      }}
    >
      {/* Status dot */}
      <div className="relative">
        <div className="size-2 rounded-full" style={{ background: worker.isOnline ? "#00C853" : isCritical ? "#FF2D55" : "#FF9500" }} />
        {worker.isOnline && (
          <motion.div
            animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 size-2 rounded-full"
            style={{ background: "#00C853" }}
          />
        )}
      </div>

      {/* Name + Zone */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>{worker.name}</span>
          {hasSOS && (
            <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 800, background: "rgba(255,45,85,0.1)", color: "#FF2D55" }}>
              {t("off.sosQueued")}
            </span>
          )}
        </div>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{worker.zone}</span>
      </div>

      {/* Network type */}
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: `${net.color}08` }}>
        <NetIcon className="size-2.5" style={{ color: net.color }} />
        <span style={{ fontSize: 7, fontWeight: 700, color: net.color }}>{net.label}</span>
      </div>

      {/* Pending sync */}
      {worker.pendingSync > 0 && (
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: "rgba(255,149,0,0.06)" }}>
          <Upload className="size-2.5" style={{ color: "#FF9500" }} />
          <span style={{ fontSize: 8, fontWeight: 700, color: "#FF9500" }}>{worker.pendingSync}</span>
        </div>
      )}

      {/* GPS points */}
      <div className="flex items-center gap-1">
        <Navigation className="size-2.5" style={{ color: "rgba(255,255,255,0.15)" }} />
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", fontVariantNumeric: "tabular-nums" }}>
          {worker.gpsPointsCached.toLocaleString()}
        </span>
      </div>

      {/* Battery */}
      <div className="flex items-center gap-1">
        {worker.batteryLevel < 0.2 ? (
          <BatteryLow className="size-3" style={{ color: "#FF2D55" }} />
        ) : (
          <BatteryFull className="size-3" style={{ color: worker.batteryLevel > 0.5 ? "#00C853" : "#FF9500" }} />
        )}
        <span style={{ fontSize: 8, fontWeight: 600, color: worker.batteryLevel < 0.2 ? "#FF2D55" : "rgba(255,255,255,0.2)", fontVariantNumeric: "tabular-nums" }}>
          {Math.round(worker.batteryLevel * 100)}%
        </span>
      </div>

      {/* Last seen */}
      <span style={{ fontSize: 8, color: isCritical ? "#FF2D55" : "rgba(255,255,255,0.15)", fontWeight: isCritical ? 700 : 400 }}>
        {formatTimeAgo(worker.lastSeen)}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sync History Row
// ═══════════════════════════════════════════════════════════════

function SyncHistoryRow({ event, t }: { event: SyncEvent; t: (k: string) => string }) {
  const typeColors = { auto: "#00C8E0", manual: "#8B5CF6", background: "#00C853" };
  const color = typeColors[event.type];

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.02)" }}>
      <div className="size-6 rounded-lg flex items-center justify-center" style={{ background: `${color}08` }}>
        {event.type === "auto" ? <RefreshCw className="size-3" style={{ color }} /> :
         event.type === "manual" ? <Send className="size-3" style={{ color }} /> :
         <Radio className="size-3" style={{ color }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
            {event.type === "auto" ? t("off.autoSync") : event.type === "manual" ? t("off.manualSync") : t("off.backgroundSync")}
          </span>
          <span className="px-1 rounded" style={{ fontSize: 7, fontWeight: 700, background: `${color}08`, color }}>{event.type.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {event.categories.sos > 0 && <span style={{ fontSize: 8, color: "#FF2D55", fontWeight: 700 }}>SOS:{event.categories.sos}</span>}
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>CI:{event.categories.checkins}</span>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>GPS:{event.categories.gps}</span>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>INC:{event.categories.incidents}</span>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>MSG:{event.categories.messages}</span>
        </div>
      </div>
      <div className="text-right">
        <div className="flex items-center gap-1">
          <CheckCircle2 className="size-3" style={{ color: "#00C853" }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853" }}>{event.itemsSynced}</span>
          {event.itemsFailed > 0 && (
            <>
              <XCircle className="size-3" style={{ color: "#FF2D55" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "#FF2D55" }}>{event.itemsFailed}</span>
            </>
          )}
        </div>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.1)" }}>
          {formatTimeAgo(event.timestamp)} ({(event.durationMs / 1000).toFixed(1)}s)
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Page Component
// ═══════════════════════════════════════════════════════════════

export function OfflineMonitoringPage() {
  const [storageStats, setStorageStats] = useState<OfflineStorageStats | null>(null);
  const [swStatus, setSWStatus] = useState<SWStatus>(getSWStatus());
  const [gpsState, setGpsState] = useState<GPSTrackerState>(getTrackerState());
  const [quickStats, setQuickStats] = useState<QuickSyncStats | null>(null);
  const [filter, setFilter] = useState<"all" | "online" | "offline" | "critical">("all");
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<"fleet" | "sync" | "system">("fleet");
  const lang = useLang();
  const t = useT(lang);

  // Load stats
  useEffect(() => {
    const refresh = async () => {
      try {
        const [stats, quick] = await Promise.all([getStorageStats(), getQuickSyncStats()]);
        setStorageStats(stats);
        setQuickStats(quick);
        setSWStatus(getSWStatus());
        setGpsState(getTrackerState());
      } catch { /* */ }
    };
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, []);

  // CRIT #164/B: production owners with no offline workers should not
  // see 12 fake "Ahmed Al-Rashidi / Yusuf Al-Harthi" entries. The DISPLAY_FLEET
  // and DISPLAY_SYNC_HISTORY constants are kept as DEV-only fixtures so demos
  // and screenshot recording still render rich content. Production starts
  // empty and the existing filter/reduce/map plumbing renders 0-of-0 cards
  // and an empty list — the world-class day-1 state.
  const DISPLAY_FLEET = import.meta.env.DEV ? MOCK_FLEET : [];
  const DISPLAY_SYNC_HISTORY = import.meta.env.DEV ? MOCK_SYNC_HISTORY : [];

  // FIX 1: Sync SOS_QUEUED workers → shared emergency store
  const sosInjectedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const { addEmergency, emergencies } = useDashboardStore.getState();
    const existingIds = new Set(emergencies.map(e => e.id));
    DISPLAY_FLEET.filter(w => w.lastSOS !== null).forEach(worker => {
      const emgId = `SOS-QUEUE-${worker.id}`;
      if (!existingIds.has(emgId) && !sosInjectedRef.current.has(emgId)) {
        sosInjectedRef.current.add(emgId);
        addEmergency({
          id: emgId,
          employeeName: worker.name,
          zone: worker.zone,
          status: "active",
          severity: "critical",
          type: "offline_sos",
                    isOwned: false,
          elapsed: Math.round((Date.now() - (worker.lastSOS ?? Date.now())) / 1000),
          timestamp: new Date(worker.lastSOS ?? Date.now()),
        });
      }
    });
  }, []);

  // Fleet stats
  const onlineCount = DISPLAY_FLEET.filter(w => w.isOnline).length;
  const offlineCount = DISPLAY_FLEET.filter(w => !w.isOnline).length;
  const criticalCount = DISPLAY_FLEET.filter(w => !w.isOnline && (Date.now() - w.lastSeen > 3600000)).length;
  const totalPending = DISPLAY_FLEET.reduce((sum, w) => sum + w.pendingSync, 0);
  const totalGPS = DISPLAY_FLEET.reduce((sum, w) => sum + w.gpsPointsCached, 0);
  // CRIT #164/B: empty production fleet → divide-by-zero would render 'NaN%'.
  // Guard with a length check; the empty-state UI hides this card anyway.
  const avgBattery = DISPLAY_FLEET.length > 0
    ? Math.round(DISPLAY_FLEET.reduce((sum, w) => sum + w.batteryLevel, 0) / DISPLAY_FLEET.length * 100)
    : 0;
  const sosQueued = DISPLAY_FLEET.filter(w => w.lastSOS !== null).length;

  const filteredFleet = DISPLAY_FLEET.filter(w => {
    if (filter === "online") return w.isOnline;
    if (filter === "offline") return !w.isOnline;
    if (filter === "critical") return !w.isOnline && (Date.now() - w.lastSeen > 3600000);
    return true;
  }).sort((a, b) => {
    // SOS first, then offline critical, then offline, then online
    if (a.lastSOS && !b.lastSOS) return -1;
    if (!a.lastSOS && b.lastSOS) return 1;
    if (!a.isOnline && b.isOnline) return -1;
    if (a.isOnline && !b.isOnline) return 1;
    return b.pendingSync - a.pendingSync;
  });

  const handleForceSync = useCallback(async () => {
    setSyncing(true);
    await startSync();
    setSyncing(false);
  }, []);

  const handleRegisterSW = useCallback(async () => {
    await registerServiceWorker();
    setSWStatus(getSWStatus());
  }, []);

  // CRIT #164/B: 0/0 in the score formula would yield NaN. Skip the
  // calculation entirely when the fleet is empty.
  const networkScore = DISPLAY_FLEET.length === 0 ? 0 : Math.round(
    ((onlineCount / DISPLAY_FLEET.length) * 40) +
    ((1 - Math.min(totalPending / 1000, 1)) * 30) +
    ((avgBattery / 100) * 20) +
    ((sosQueued === 0 ? 1 : 0) * 10)
  );

  return (
    <div className="space-y-5 pb-8">
      {/* Page Header */}
      <PageHeader
        title={t("off.title")}
        subtitle={t("off.subtitle")}
      />

      {/* Network Resilience Score */}
      <div className="p-4 rounded-2xl" style={{
        background: "linear-gradient(135deg, rgba(0,200,224,0.04), rgba(0,200,83,0.02))",
        border: "1px solid rgba(0,200,224,0.08)",
      }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="size-4" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {t("off.networkResilienceScore")}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span style={{ fontSize: 40, fontWeight: 900, color: DISPLAY_FLEET.length === 0 ? "rgba(255,255,255,0.3)" : networkScore > 70 ? "#00C853" : networkScore > 40 ? "#FF9500" : "#FF2D55", letterSpacing: "-0.03em" }}>
                {DISPLAY_FLEET.length === 0 ? "—" : networkScore}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.15)" }}>/100</span>
            </div>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>
              {DISPLAY_FLEET.length === 0 ? t("off.noDevicesYet") : networkScore > 70 ? t("off.connectivityHealthy") : networkScore > 40 ? t("off.someWorkersAttention") : t("off.criticalDisconnected")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              { label: t("off.online"), value: onlineCount, total: DISPLAY_FLEET.length, color: "#00C853" },
              { label: t("off.offline"), value: offlineCount, total: DISPLAY_FLEET.length, color: "#FF9500" },
              { label: t("off.critical"), value: criticalCount, total: DISPLAY_FLEET.length, color: "#FF2D55" },
              { label: t("off.sosQueuedLabel"), value: sosQueued, total: null, color: "#FF2D55" },
            ].map(item => (
              <div key={item.label} className="px-3 py-2 rounded-lg text-center" style={{ background: `${item.color}04`, border: `1px solid ${item.color}08` }}>
                <p style={{ fontSize: 18, fontWeight: 800, color: item.color, fontVariantNumeric: "tabular-nums" }}>{item.value}</p>
                <p style={{ fontSize: 8, fontWeight: 600, color: `${item.color}80` }}>{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3">
        <StatBox icon={Upload} label={t("off.pendingSync")} value={totalPending.toLocaleString()} color="#FF9500" sub={t("off.itemsAcrossFleet")} />
        <StatBox icon={Navigation} label={t("off.gpsCached")} value={totalGPS.toLocaleString()} color="#00C8E0" sub={t("off.breadcrumbPoints")} />
        <StatBox icon={BatteryFull} label={t("off.avgBattery")} value={`${avgBattery}%`} color={avgBattery > 50 ? "#00C853" : "#FF9500"} sub={t("off.fleetAverage")} />
        <StatBox icon={HardDrive} label={t("off.localStorage")} value={`${storageStats?.estimatedSizeMB || 0}MB`} color="#8B5CF6" sub={`${t("off.of")} ${storageStats?.storageQuotaMB ? Math.round(storageStats.storageQuotaMB / 1000) + "GB" : "—"}`} />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
        {([
          { key: "fleet", label: t("off.fleetStatus"), icon: Users },
          { key: "sync", label: t("off.syncHistory"), icon: RefreshCw },
          { key: "system", label: t("off.systemHealth"), icon: Server },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg transition-all"
            style={{
              background: tab === t.key ? "rgba(0,200,224,0.06)" : "transparent",
              border: `1px solid ${tab === t.key ? "rgba(0,200,224,0.12)" : "transparent"}`,
            }}
          >
            <t.icon className="size-3.5" style={{ color: tab === t.key ? "#00C8E0" : "rgba(255,255,255,0.15)" }} />
            <span style={{ fontSize: 11, fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? "#00C8E0" : "rgba(255,255,255,0.25)" }}>
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {/* ═══ Fleet Status Tab ═══ */}
      {tab === "fleet" && (
        <div className="space-y-3">
          {/* Filter pills */}
          <div className="flex items-center gap-2">
            {([
              { key: "all", label: `${t("off.all")} (${DISPLAY_FLEET.length})`, color: "#00C8E0" },
              { key: "online", label: `${t("off.online")} (${onlineCount})`, color: "#00C853" },
              { key: "offline", label: `${t("off.offline")} (${offlineCount})`, color: "#FF9500" },
              { key: "critical", label: `${t("off.critical")} (${criticalCount})`, color: "#FF2D55" },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: filter === f.key ? `${f.color}08` : "transparent",
                  border: `1px solid ${filter === f.key ? `${f.color}15` : "rgba(255,255,255,0.03)"}`,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: filter === f.key ? 700 : 500, color: filter === f.key ? f.color : "rgba(255,255,255,0.2)" }}>
                  {f.label}
                </span>
              </button>
            ))}

            <div className="flex-1" />

            <button
              onClick={handleForceSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
              style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}
            >
              <RefreshCw className={`size-3 ${syncing ? "animate-spin" : ""}`} style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: "#00C8E0" }}>{syncing ? t("off.syncing") : t("off.forceSyncAll")}</span>
            </button>
          </div>

          {/* Column Headers */}
          <div className="flex items-center gap-3 px-3 py-1.5">
            <div className="w-2" />
            <span className="flex-1" style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{t("off.workerZone")}</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase", width: 40 }}>{t("off.net")}</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase", width: 40 }}>{t("off.queue")}</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase", width: 55 }}>{t("off.gps")}</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase", width: 40 }}>{t("off.batt")}</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase", width: 50 }}>{t("off.lastSeenCol")}</span>
          </div>

          {/* Worker Rows */}
          <div className="space-y-1.5">
            <AnimatePresence>
              {filteredFleet.map((worker, i) => (
                <motion.div
                  key={worker.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <WorkerRow worker={worker} t={t} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {filteredFleet.length === 0 && (
            <div className="text-center py-10" style={{ color: "rgba(255,255,255,0.15)" }}>
              <CheckCircle2 className="size-8 mx-auto mb-2" />
              <p style={{ fontSize: 12, fontWeight: 600 }}>{t("off.noWorkersCategory")}</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ Sync History Tab ═══ */}
      {tab === "sync" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>{t("off.recentSyncOps")}</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>{t("off.last24h")}</span>
          </div>

          {/* Sync stats summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl text-center" style={{ background: "rgba(0,200,83,0.03)", border: "1px solid rgba(0,200,83,0.06)" }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#00C853" }}>
                {DISPLAY_SYNC_HISTORY.reduce((sum, e) => sum + e.itemsSynced, 0).toLocaleString()}
              </p>
              <p style={{ fontSize: 9, color: "rgba(0,200,83,0.5)", fontWeight: 600 }}>{t("off.itemsSynced")}</p>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ background: "rgba(255,45,85,0.03)", border: "1px solid rgba(255,45,85,0.06)" }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: DISPLAY_SYNC_HISTORY.reduce((sum, e) => sum + e.itemsFailed, 0) > 0 ? "#FF2D55" : "#00C853" }}>
                {DISPLAY_SYNC_HISTORY.reduce((sum, e) => sum + e.itemsFailed, 0)}
              </p>
              <p style={{ fontSize: 9, color: "rgba(255,45,85,0.5)", fontWeight: 600 }}>{t("off.failed")}</p>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.06)" }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#00C8E0" }}>
                {DISPLAY_SYNC_HISTORY.length > 0 ? (DISPLAY_SYNC_HISTORY.reduce((sum, e) => sum + e.durationMs, 0) / DISPLAY_SYNC_HISTORY.length / 1000).toFixed(1) : '0.0'}s
              </p>
              <p style={{ fontSize: 9, color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>{t("off.avgDuration")}</p>
            </div>
          </div>

          {/* History list */}
          <div className="space-y-2">
            {DISPLAY_SYNC_HISTORY.map(event => (
              <SyncHistoryRow key={event.id} event={event} t={t} />
            ))}
          </div>

          {/* Data breakdown */}
          <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {t("off.syncPriorityOrder")}
            </span>
            <div className="mt-3 space-y-2">
              {[
                { priority: "P1", label: t("off.p1Label"), desc: t("off.p1Desc"), color: "#FF2D55", icon: Zap },
                { priority: "P2", label: t("off.p2Label"), desc: t("off.p2Desc"), color: "#FF9500", icon: Clock },
                { priority: "P3", label: t("off.p3Label"), desc: t("off.p3Desc"), color: "#8B5CF6", icon: AlertTriangle },
                { priority: "P4", label: t("off.p4Label"), desc: t("off.p4Desc"), color: "#00C8E0", icon: MessageSquare },
                { priority: "P5", label: t("off.p5Label"), desc: t("off.p5Desc"), color: "#00C853", icon: Navigation },
              ].map(item => (
                <div key={item.priority} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: `${item.color}03` }}>
                  <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 900, background: `${item.color}10`, color: item.color }}>{item.priority}</span>
                  <item.icon className="size-3.5" style={{ color: item.color }} />
                  <div className="flex-1">
                    <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{item.label}</span>
                    <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", marginLeft: 8 }}>{item.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ System Health Tab ═══ */}
      {tab === "system" && (
        <div className="space-y-3">
          {/* Service Worker Status */}
          <div className="p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Globe className="size-4" style={{ color: "#8B5CF6" }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>{t("off.serviceWorker")}</span>
              </div>
              <button
                onClick={handleRegisterSW}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                style={{ background: "rgba(139,92,255,0.06)", border: "1px solid rgba(139,92,255,0.12)" }}
              >
                <Download className="size-3" style={{ color: "#8B5CF6" }} />
                <span style={{ fontSize: 9, fontWeight: 600, color: "#8B5CF6" }}>
                  {swStatus.registered ? t("off.update") : t("off.register")}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: t("off.status"), value: swStatus.registered ? (swStatus.active ? t("off.active") : t("off.installed")) : t("off.notRegistered"), color: swStatus.active ? "#00C853" : swStatus.registered ? "#FF9500" : "rgba(255,255,255,0.15)" },
                { label: t("off.backgroundSyncLabel"), value: swStatus.backgroundSyncSupported ? t("off.supported") : t("off.notAvailable"), color: swStatus.backgroundSyncSupported ? "#00C853" : "#FF9500" },
                { label: t("off.pushNotifications"), value: swStatus.pushSupported ? t("off.supported") : t("off.notAvailable"), color: swStatus.pushSupported ? "#00C853" : "#FF9500" },
              ].map(item => (
                <div key={item.label} className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)" }}>
                  <p style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.15)", marginBottom: 2 }}>{item.label}</p>
                  <p style={{ fontSize: 10, fontWeight: 700, color: item.color }}>{item.value}</p>
                </div>
              ))}
            </div>

            {swStatus.error && (
              <div className="mt-2 p-2 rounded-lg" style={{ background: "rgba(255,149,0,0.04)", border: "1px solid rgba(255,149,0,0.08)" }}>
                <p style={{ fontSize: 9, color: "#FF9500" }}>{swStatus.error}</p>
              </div>
            )}
          </div>

          {/* IndexedDB Health */}
          <div className="p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Database className="size-4" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>{t("off.indexedDbStorage")}</span>
            </div>

            {storageStats ? (
              <>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[
                    { store: t("off.sosQueueStore"), total: storageStats.sosQueue, unsynced: storageStats.sosUnsynced, color: "#FF2D55" },
                    { store: t("off.checkinsStore"), total: storageStats.checkins, unsynced: storageStats.checkinsUnsynced, color: "#FF9500" },
                    { store: t("off.gpsTrailStore"), total: storageStats.gpsPoints, unsynced: storageStats.gpsUnsynced, color: "#00C853" },
                    { store: t("off.incidentsStore"), total: storageStats.incidents, unsynced: storageStats.incidentsUnsynced, color: "#8B5CF6" },
                  ].map(s => (
                    <div key={s.store} className="p-2 rounded-lg text-center" style={{ background: `${s.color}03`, border: `1px solid ${s.color}06` }}>
                      <p style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.total}</p>
                      <p style={{ fontSize: 8, color: `${s.color}60`, fontWeight: 600 }}>{s.store}</p>
                      {s.unsynced > 0 && (
                        <p style={{ fontSize: 7, color: "#FF9500", marginTop: 2 }}>{s.unsynced} {t("off.unsynced")}</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Storage bar */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{t("off.storageUsed")}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: "#00C8E0" }}>
                      {storageStats.estimatedSizeMB}MB / {storageStats.storageQuotaMB ? `${Math.round(storageStats.storageQuotaMB / 1000)}GB` : t("off.unknown")}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(1, Math.min(100, (storageStats.estimatedSizeMB / (storageStats.storageQuotaMB || 500)) * 100))}%`,
                        background: "linear-gradient(90deg, #00C8E0, #00C853)",
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>{t("off.loadingStorageStats")}</p>
            )}
          </div>

          {/* GPS Tracker System Status */}
          <div className="p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Satellite className="size-4" style={{ color: "#00C853" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>{t("off.gpsTrackerEngine")}</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)" }}>
                <p style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.15)" }}>{t("off.status")}</p>
                <p style={{ fontSize: 10, fontWeight: 700, color: gpsState.isTracking ? "#00C853" : "rgba(255,255,255,0.15)" }}>
                  {gpsState.isTracking ? t("off.recording") : t("off.stopped")}
                </p>
              </div>
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)" }}>
                <p style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.15)" }}>{t("off.deadReckoning")}</p>
                <p style={{ fontSize: 10, fontWeight: 700, color: gpsState.deadReckoningActive ? "#FF9500" : "rgba(255,255,255,0.15)" }}>
                  {gpsState.deadReckoningActive ? t("off.active") : t("off.standby")}
                </p>
              </div>
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)" }}>
                <p style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.15)" }}>{t("off.interval")}</p>
                <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>
                  {gpsState.currentInterval / 1000}s
                </p>
              </div>
            </div>

            {gpsState.lastPosition && (
              <div className="flex items-center gap-1.5 mt-2 p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)" }}>
                <MapPin className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontVariantNumeric: "tabular-nums" }}>
                  {t("off.lastPos")}: {gpsState.lastPosition.lat.toFixed(6)}, {gpsState.lastPosition.lng.toFixed(6)} (±{Math.round(gpsState.lastPosition.accuracy)}m)
                </span>
              </div>
            )}
          </div>

          {/* Offline Capabilities Checklist */}
          <div className="p-4 rounded-xl" style={{ background: "rgba(0,200,83,0.02)", border: "1px solid rgba(0,200,83,0.06)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="size-4" style={{ color: "#00C853" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>{t("off.offlineSafetyCaps")}</span>
            </div>

            <div className="space-y-2">
              {[
                { label: t("off.cap1Label"), desc: t("off.cap1Desc"), ok: true },
                { label: t("off.cap2Label"), desc: t("off.cap2Desc"), ok: true },
                { label: t("off.cap3Label"), desc: t("off.cap3Desc"), ok: true },
                { label: t("off.cap4Label"), desc: t("off.cap4Desc"), ok: true },
                { label: t("off.cap5Label"), desc: t("off.cap5Desc"), ok: true },
                { label: t("off.cap6Label"), desc: t("off.cap6Desc"), ok: true },
                { label: t("off.cap7Label"), desc: t("off.cap7Desc"), ok: true },
                { label: t("off.cap8Label"), desc: t("off.cap8Desc"), ok: true },
                { label: t("off.cap9Label"), desc: t("off.cap9Desc"), ok: swStatus.supported },
                { label: t("off.cap10Label"), desc: t("off.cap10Desc"), ok: swStatus.backgroundSyncSupported },
                { label: t("off.cap11Label"), desc: t("off.cap11Desc"), ok: swStatus.pushSupported },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  {item.ok ? (
                    <CheckCircle2 className="size-3.5 shrink-0" style={{ color: "#00C853" }} />
                  ) : (
                    <AlertTriangle className="size-3.5 shrink-0" style={{ color: "#FF9500" }} />
                  )}
                  <div className="flex-1">
                    <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{item.label}</span>
                    <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", marginLeft: 8 }}>{item.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}