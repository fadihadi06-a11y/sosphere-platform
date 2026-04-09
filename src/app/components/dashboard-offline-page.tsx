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
import { useDashboardStore } from "./stores/dashboard-store";

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

function WorkerRow({ worker }: { worker: WorkerConnectivity }) {
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
              SOS QUEUED
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

function SyncHistoryRow({ event }: { event: SyncEvent }) {
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
            {event.type === "auto" ? "Auto Sync" : event.type === "manual" ? "Manual Sync" : "Background Sync"}
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

  // FIX 1: Sync SOS_QUEUED workers → shared emergency store
  const sosInjectedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const { addEmergency, emergencies } = useDashboardStore.getState();
    const existingIds = new Set(emergencies.map(e => e.id));
    MOCK_FLEET.filter(w => w.lastSOS !== null).forEach(worker => {
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
          note: "SOS triggered while offline — device reconnecting",
          isOwned: false,
          elapsed: Math.round((Date.now() - (worker.lastSOS ?? Date.now())) / 1000),
          timestamp: new Date(worker.lastSOS ?? Date.now()),
        } as any);
      }
    });
  }, []);

  // Fleet stats
  const onlineCount = MOCK_FLEET.filter(w => w.isOnline).length;
  const offlineCount = MOCK_FLEET.filter(w => !w.isOnline).length;
  const criticalCount = MOCK_FLEET.filter(w => !w.isOnline && (Date.now() - w.lastSeen > 3600000)).length;
  const totalPending = MOCK_FLEET.reduce((sum, w) => sum + w.pendingSync, 0);
  const totalGPS = MOCK_FLEET.reduce((sum, w) => sum + w.gpsPointsCached, 0);
  const avgBattery = Math.round(MOCK_FLEET.reduce((sum, w) => sum + w.batteryLevel, 0) / MOCK_FLEET.length * 100);
  const sosQueued = MOCK_FLEET.filter(w => w.lastSOS !== null).length;

  const filteredFleet = MOCK_FLEET.filter(w => {
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

  const networkScore = Math.round(
    ((onlineCount / MOCK_FLEET.length) * 40) +
    ((1 - Math.min(totalPending / 1000, 1)) * 30) +
    ((avgBattery / 100) * 20) +
    ((sosQueued === 0 ? 1 : 0) * 10)
  );

  return (
    <div className="space-y-5 pb-8">
      {/* Page Header */}
      <PageHeader
        title="Offline & Connectivity"
        subtitle="Fleet network status, sync queues, and offline resilience monitoring"
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
                Network Resilience Score
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span style={{ fontSize: 40, fontWeight: 900, color: networkScore > 70 ? "#00C853" : networkScore > 40 ? "#FF9500" : "#FF2D55", letterSpacing: "-0.03em" }}>
                {networkScore}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.15)" }}>/100</span>
            </div>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>
              {networkScore > 70 ? "Fleet connectivity is healthy" : networkScore > 40 ? "Some workers need attention" : "Critical — multiple workers disconnected"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Online", value: onlineCount, total: MOCK_FLEET.length, color: "#00C853" },
              { label: "Offline", value: offlineCount, total: MOCK_FLEET.length, color: "#FF9500" },
              { label: "Critical", value: criticalCount, total: MOCK_FLEET.length, color: "#FF2D55" },
              { label: "SOS Queued", value: sosQueued, total: null, color: "#FF2D55" },
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
        <StatBox icon={Upload} label="Pending Sync" value={totalPending.toLocaleString()} color="#FF9500" sub="items across fleet" />
        <StatBox icon={Navigation} label="GPS Cached" value={totalGPS.toLocaleString()} color="#00C8E0" sub="breadcrumb points" />
        <StatBox icon={BatteryFull} label="Avg Battery" value={`${avgBattery}%`} color={avgBattery > 50 ? "#00C853" : "#FF9500"} sub="fleet average" />
        <StatBox icon={HardDrive} label="Local Storage" value={`${storageStats?.estimatedSizeMB || 0}MB`} color="#8B5CF6" sub={`of ${storageStats?.storageQuotaMB ? Math.round(storageStats.storageQuotaMB / 1000) + "GB" : "—"}`} />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
        {([
          { key: "fleet", label: "Fleet Status", icon: Users },
          { key: "sync", label: "Sync History", icon: RefreshCw },
          { key: "system", label: "System Health", icon: Server },
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
              { key: "all", label: `All (${MOCK_FLEET.length})`, color: "#00C8E0" },
              { key: "online", label: `Online (${onlineCount})`, color: "#00C853" },
              { key: "offline", label: `Offline (${offlineCount})`, color: "#FF9500" },
              { key: "critical", label: `Critical (${criticalCount})`, color: "#FF2D55" },
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
              <span style={{ fontSize: 10, fontWeight: 600, color: "#00C8E0" }}>{syncing ? "Syncing..." : "Force Sync All"}</span>
            </button>
          </div>

          {/* Column Headers */}
          <div className="flex items-center gap-3 px-3 py-1.5">
            <div className="w-2" />
            <span className="flex-1" style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Worker / Zone</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase", width: 40 }}>Net</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase", width: 40 }}>Queue</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase", width: 55 }}>GPS</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase", width: 40 }}>Batt</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em", textTransform: "uppercase", width: 50 }}>Last Seen</span>
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
                  <WorkerRow worker={worker} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {filteredFleet.length === 0 && (
            <div className="text-center py-10" style={{ color: "rgba(255,255,255,0.15)" }}>
              <CheckCircle2 className="size-8 mx-auto mb-2" />
              <p style={{ fontSize: 12, fontWeight: 600 }}>No workers in this category</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ Sync History Tab ═══ */}
      {tab === "sync" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>Recent Sync Operations</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>Last 24 hours</span>
          </div>

          {/* Sync stats summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl text-center" style={{ background: "rgba(0,200,83,0.03)", border: "1px solid rgba(0,200,83,0.06)" }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#00C853" }}>
                {MOCK_SYNC_HISTORY.reduce((sum, e) => sum + e.itemsSynced, 0).toLocaleString()}
              </p>
              <p style={{ fontSize: 9, color: "rgba(0,200,83,0.5)", fontWeight: 600 }}>Items Synced</p>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ background: "rgba(255,45,85,0.03)", border: "1px solid rgba(255,45,85,0.06)" }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: MOCK_SYNC_HISTORY.reduce((sum, e) => sum + e.itemsFailed, 0) > 0 ? "#FF2D55" : "#00C853" }}>
                {MOCK_SYNC_HISTORY.reduce((sum, e) => sum + e.itemsFailed, 0)}
              </p>
              <p style={{ fontSize: 9, color: "rgba(255,45,85,0.5)", fontWeight: 600 }}>Failed</p>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.06)" }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#00C8E0" }}>
                {(MOCK_SYNC_HISTORY.reduce((sum, e) => sum + e.durationMs, 0) / MOCK_SYNC_HISTORY.length / 1000).toFixed(1)}s
              </p>
              <p style={{ fontSize: 9, color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>Avg Duration</p>
            </div>
          </div>

          {/* History list */}
          <div className="space-y-2">
            {MOCK_SYNC_HISTORY.map(event => (
              <SyncHistoryRow key={event.id} event={event} />
            ))}
          </div>

          {/* Data breakdown */}
          <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Sync Priority Order
            </span>
            <div className="mt-3 space-y-2">
              {[
                { priority: "P1", label: "SOS Alerts", desc: "Life-critical — always synced first", color: "#FF2D55", icon: Zap },
                { priority: "P2", label: "Check-ins", desc: "Safety-critical — missed check-in triggers alert", color: "#FF9500", icon: Clock },
                { priority: "P3", label: "Incidents", desc: "Important reports with photo evidence", color: "#8B5CF6", icon: AlertTriangle },
                { priority: "P4", label: "Messages", desc: "Emergency chat communication", color: "#00C8E0", icon: MessageSquare },
                { priority: "P5", label: "GPS Trail", desc: "Bulk location data, synced in batches of 100", color: "#00C853", icon: Navigation },
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
                <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>Service Worker</span>
              </div>
              <button
                onClick={handleRegisterSW}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                style={{ background: "rgba(139,92,255,0.06)", border: "1px solid rgba(139,92,255,0.12)" }}
              >
                <Download className="size-3" style={{ color: "#8B5CF6" }} />
                <span style={{ fontSize: 9, fontWeight: 600, color: "#8B5CF6" }}>
                  {swStatus.registered ? "Update" : "Register"}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Status", value: swStatus.registered ? (swStatus.active ? "Active" : "Installed") : "Not Registered", color: swStatus.active ? "#00C853" : swStatus.registered ? "#FF9500" : "rgba(255,255,255,0.15)" },
                { label: "Background Sync", value: swStatus.backgroundSyncSupported ? "Supported" : "Not Available", color: swStatus.backgroundSyncSupported ? "#00C853" : "#FF9500" },
                { label: "Push Notifications", value: swStatus.pushSupported ? "Supported" : "Not Available", color: swStatus.pushSupported ? "#00C853" : "#FF9500" },
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
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>IndexedDB Storage</span>
            </div>

            {storageStats ? (
              <>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[
                    { store: "SOS Queue", total: storageStats.sosQueue, unsynced: storageStats.sosUnsynced, color: "#FF2D55" },
                    { store: "Check-ins", total: storageStats.checkins, unsynced: storageStats.checkinsUnsynced, color: "#FF9500" },
                    { store: "GPS Trail", total: storageStats.gpsPoints, unsynced: storageStats.gpsUnsynced, color: "#00C853" },
                    { store: "Incidents", total: storageStats.incidents, unsynced: storageStats.incidentsUnsynced, color: "#8B5CF6" },
                  ].map(s => (
                    <div key={s.store} className="p-2 rounded-lg text-center" style={{ background: `${s.color}03`, border: `1px solid ${s.color}06` }}>
                      <p style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.total}</p>
                      <p style={{ fontSize: 8, color: `${s.color}60`, fontWeight: 600 }}>{s.store}</p>
                      {s.unsynced > 0 && (
                        <p style={{ fontSize: 7, color: "#FF9500", marginTop: 2 }}>{s.unsynced} unsynced</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Storage bar */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Storage Used</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: "#00C8E0" }}>
                      {storageStats.estimatedSizeMB}MB / {storageStats.storageQuotaMB ? `${Math.round(storageStats.storageQuotaMB / 1000)}GB` : "Unknown"}
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
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>Loading storage stats...</p>
            )}
          </div>

          {/* GPS Tracker System Status */}
          <div className="p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Satellite className="size-4" style={{ color: "#00C853" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>GPS Tracker Engine</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)" }}>
                <p style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.15)" }}>Status</p>
                <p style={{ fontSize: 10, fontWeight: 700, color: gpsState.isTracking ? "#00C853" : "rgba(255,255,255,0.15)" }}>
                  {gpsState.isTracking ? "Recording" : "Stopped"}
                </p>
              </div>
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)" }}>
                <p style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.15)" }}>Dead Reckoning</p>
                <p style={{ fontSize: 10, fontWeight: 700, color: gpsState.deadReckoningActive ? "#FF9500" : "rgba(255,255,255,0.15)" }}>
                  {gpsState.deadReckoningActive ? "Active" : "Standby"}
                </p>
              </div>
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)" }}>
                <p style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.15)" }}>Interval</p>
                <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>
                  {gpsState.currentInterval / 1000}s
                </p>
              </div>
            </div>

            {gpsState.lastPosition && (
              <div className="flex items-center gap-1.5 mt-2 p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.01)" }}>
                <MapPin className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontVariantNumeric: "tabular-nums" }}>
                  Last: {gpsState.lastPosition.lat.toFixed(6)}, {gpsState.lastPosition.lng.toFixed(6)} (±{Math.round(gpsState.lastPosition.accuracy)}m)
                </span>
              </div>
            )}
          </div>

          {/* Offline Capabilities Checklist */}
          <div className="p-4 rounded-xl" style={{ background: "rgba(0,200,83,0.02)", border: "1px solid rgba(0,200,83,0.06)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="size-4" style={{ color: "#00C853" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>Offline Safety Capabilities</span>
            </div>

            <div className="space-y-2">
              {[
                { label: "SOS Alert Queuing", desc: "Triggered offline → stored → synced first", ok: true },
                { label: "GPS Continuous Recording", desc: "IndexedDB stores up to 50,000 points", ok: true },
                { label: "Check-in Timer", desc: "Runs locally, missed check-ins queued", ok: true },
                { label: "Incident Photo Reports", desc: "Photos stored as base64 in IndexedDB", ok: true },
                { label: "Emergency Chat (Offline Queue)", desc: "Messages queued, delivered on reconnect", ok: true },
                { label: "Dead Reckoning GPS", desc: "Estimates position when GPS signal lost", ok: true },
                { label: "Battery-Aware Tracking", desc: "Reduces GPS frequency on low battery", ok: true },
                { label: "Priority-Based Sync", desc: "SOS → Check-ins → Incidents → Messages → GPS", ok: true },
                { label: "Service Worker Cache", desc: "App loads offline after first visit", ok: swStatus.supported },
                { label: "Background Sync API", desc: "Syncs data even when app tab is closed", ok: swStatus.backgroundSyncSupported },
                { label: "Push When Closed", desc: "Receive push alerts with app closed", ok: swStatus.pushSupported },
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