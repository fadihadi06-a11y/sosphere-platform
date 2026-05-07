// ═══════════════════════════════════════════════════════════════
// SOSphere — Dashboard Notifications Panel
// Slide-over panel from Bell icon in Topbar
// Shows: SOS alerts · Check-ins · Hazard reports · System events
// Real-time via shared-store onSyncEvent + mock historical feed
// ═══════════════════════════════════════════════════════════════
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bell, X, Siren, AlertTriangle, MapPin,
  UserCheck, Radio, Settings,
  Trash2, Volume2, VolumeX, Shield, Eye,
  LogIn,
} from "lucide-react";
import { onSyncEvent, type SyncEvent } from "./shared-store";
import { useDashboardStore } from "./stores/dashboard-store";

// ── Types ─────────────────────────────────────────────────────
type NotifCategory =
  | "sos"
  | "checkin"
  | "hazard"
  | "geofence"
  | "system"
  | "audit"
  | "login"
  | "broadcast";

type NotifSeverity = "critical" | "high" | "medium" | "info" | "success";

interface Notification {
  id: string;
  category: NotifCategory;
  severity: NotifSeverity;
  title: string;
  body: string;
  timestamp: Date;
  read: boolean;
  zone?: string;
  actorName?: string;
  navigateTo?: string; // dash page to open when clicked
  emoji?: string;
}

// ── Category Config ───────────────────────────────────────────
const NOTIF_CATEGORY: Record<NotifCategory, {
  label: string; icon: React.ElementType; color: string;
}> = {
  sos:       { label: "SOS Alert",    icon: Siren,         color: "#FF2D55" },
  checkin:   { label: "Check-in",     icon: UserCheck,     color: "#00C853" },
  hazard:    { label: "Hazard",       icon: AlertTriangle, color: "#FF9500" },
  geofence:  { label: "Geofence",     icon: MapPin,        color: "#00C8E0" },
  system:    { label: "System",       icon: Settings,      color: "#9B59B6" },
  audit:     { label: "Audit",        icon: Shield,        color: "#FF9500" },
  login:     { label: "Login",        icon: LogIn,         color: "#4A90D9" },
  broadcast: { label: "Broadcast",    icon: Radio,         color: "#9B59B6" },
};

const SEVERITY_DOT: Record<NotifSeverity, string> = {
  critical: "#FF2D55",
  high:     "#FF9500",
  medium:   "#FFB800",
  info:     "rgba(255,255,255,0.3)",
  success:  "#00C853",
};

// ── Mock Historical Notifications ─────────────────────────────
function minsAgo(m: number): Date { return new Date(Date.now() - m * 60000); }

const MOCK_NOTIFS: Notification[] = [
  {
    id: "N-001", category: "sos", severity: "critical",
    title: "🚨 SOS — Mohammed Ali",
    body: "SOS button activated in Zone D - Warehouse. Elapsed: 4m 12s",
    timestamp: minsAgo(4), read: false, zone: "Zone D", navigateTo: "emergencyHub",
    actorName: "Mohammed Ali",
  },
  {
    id: "N-002", category: "checkin", severity: "high",
    title: "⚠️ Missed Check-in — Khalid Omar",
    body: "Employee missed scheduled check-in at 14:30. Zone A - East. Now 32 minutes overdue.",
    timestamp: minsAgo(8), read: false, zone: "Zone A", navigateTo: "emergencyHub",
    actorName: "Khalid Omar",
  },
  {
    id: "N-003", category: "geofence", severity: "medium",
    title: "📍 Geofence Breach",
    body: "Unknown device exited Zone B - South boundary at 14:22. Investigating.",
    timestamp: minsAgo(13), read: false, zone: "Zone B", navigateTo: "emergencyHub",
  },
  {
    id: "N-004", category: "audit", severity: "info",
    title: "🔑 Permissions Updated",
    body: "Owner Ahmed Al-Rashid modified custom permissions for Sara Al-Mutairi (Zone C). PIN verified.",
    timestamp: minsAgo(18), read: true, navigateTo: "auditLog",
    actorName: "Ahmed Al-Rashid",
  },
  {
    id: "N-005", category: "checkin", severity: "success",
    title: "✅ Check-in — Aisha Rahman",
    body: "Fire Marshal Aisha Rahman checked in at Zone D - Warehouse. Safety score: 99%",
    timestamp: minsAgo(22), read: true, zone: "Zone D", navigateTo: "employees",
    actorName: "Aisha Rahman",
  },
  {
    id: "N-006", category: "hazard", severity: "high",
    title: "☢️ Hazard Report — Zone C",
    body: "Chemical spill reported by Sara Al-Mutairi. Severity: Medium. Response team notified.",
    timestamp: minsAgo(31), read: true, zone: "Zone C", navigateTo: "emergencyHub",
    actorName: "Sara Al-Mutairi",
  },
  {
    id: "N-007", category: "broadcast", severity: "info",
    title: "📢 Broadcast Sent",
    body: "Zone D evacuation alert broadcasted to 5 employees by Main Admin. Read receipts: 4/5.",
    timestamp: minsAgo(45), read: true, zone: "Zone D", navigateTo: "comms",
  },
  {
    id: "N-008", category: "audit", severity: "info",
    title: "👤 New Member Approved",
    body: "Aisha Rahman approved from invite link and assigned to Zone B as Field Worker.",
    timestamp: minsAgo(78), read: true, navigateTo: "roles",
    actorName: "Omar Al-Farsi",
  },
  {
    id: "N-009", category: "system", severity: "info",
    title: "🔄 Shift Schedule Updated",
    body: "Workforce schedule for Week 11 published. 3 conflicts detected — requires review.",
    timestamp: minsAgo(95), read: true, navigateTo: "workforce",
  },
  {
    id: "N-010", category: "login", severity: "info",
    title: "🔒 Owner Login Detected",
    body: "Owner Ahmed Al-Rashid logged in from Chrome/macOS (IP: 192.168.1.10)",
    timestamp: minsAgo(115), read: true, navigateTo: "auditLog",
    actorName: "Ahmed Al-Rashid",
  },
  {
    id: "N-011", category: "system", severity: "success",
    title: "📁 CSV Import Completed",
    body: "487 employees imported successfully by Main Admin. 3 warnings, 2 errors skipped.",
    timestamp: minsAgo(162), read: true, navigateTo: "employees",
  },
  {
    id: "N-012", category: "checkin", severity: "success",
    title: "✅ Bulk Check-in — Morning Shift",
    body: "12 employees confirmed shift start in Zone A. All safety scores above threshold.",
    timestamp: minsAgo(240), read: true, zone: "Zone A", navigateTo: "employees",
  },
];

// ── Time Format ───────────────────────────────────────────────
function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Notification Row ──────────────────────────────────────────
function NotifRow({
  notif, onRead, onNavigate, onDelete,
}: {
  notif: Notification;
  onRead: (id: string) => void;
  onNavigate: (page: string) => void;
  onDelete: (id: string) => void;
}) {
  const cfg = NOTIF_CATEGORY[notif.category];
  const Icon = cfg.icon;
  const dotColor = SEVERITY_DOT[notif.severity];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.2 }}
      className="relative flex gap-3 px-4 py-3 cursor-pointer group"
      style={{
        background: notif.read ? "transparent" : "rgba(0,200,224,0.03)",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
      onClick={() => {
        onRead(notif.id);
        if (notif.navigateTo) onNavigate(notif.navigateTo);
      }}
    >
      {/* Unread dot */}
      {!notif.read && (
        <motion.div
          animate={{ scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute left-1.5 top-1/2 -translate-y-1/2 size-1.5 rounded-full"
          style={{ background: dotColor }}
        />
      )}

      {/* Icon */}
      <div
        className="size-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: `${cfg.color}12`, border: `1px solid ${cfg.color}20` }}
      >
        <Icon className="size-4" style={{ color: cfg.color }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span style={{
            fontSize: 12, fontWeight: notif.read ? 500 : 700,
            color: notif.read ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.95)",
            lineHeight: 1.4,
          }}>
            {notif.title}
          </span>
          <span style={{
            fontSize: 10, color: "rgba(255,255,255,0.25)", flexShrink: 0, marginTop: 1,
            fontWeight: 500,
          }}>
            {timeAgo(notif.timestamp)}
          </span>
        </div>
        <p style={{
          fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2, lineHeight: 1.5,
        }}>
          {notif.body}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="px-1.5 py-0.5 rounded-md" style={{
            fontSize: 9, fontWeight: 700, color: cfg.color,
            background: `${cfg.color}15`,
          }}>
            {cfg.label}
          </span>
          {notif.zone && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
              · {notif.zone}
            </span>
          )}
          {notif.actorName && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
              · {notif.actorName}
            </span>
          )}
        </div>
      </div>

      {/* Delete on hover */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(notif.id); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity size-6 rounded-lg flex items-center justify-center flex-shrink-0 self-start mt-0.5"
        style={{ background: "rgba(255,45,85,0.08)" }}
      >
        <X className="size-3" style={{ color: "#FF2D55" }} />
      </button>
    </motion.div>
  );
}

// ── Props ─────────────────────────────────────────────────────
interface NotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: string) => void;
  unreadCount: number;
  onUnreadChange: (count: number) => void;
}

// ═══════════════════════════════════════════════════════════════
// Main Panel Component
// ═══════════════════════════════════════════════════════════════
export function NotificationsPanel({
  isOpen, onClose, onNavigate, unreadCount, onUnreadChange,
}: NotificationsPanelProps) {
  // Seed with real emergencies from store first, then fall back to mock for empty state
  const storeEmergencies = useDashboardStore(s => s.emergencies);
  const [notifs, setNotifs] = useState<Notification[]>(() => {
    // Convert real store emergencies to notifications
    const fromStore: Notification[] = storeEmergencies.map(e => ({
      id: `N-emg-${e.id}`,
      category: "sos" as NotifCategory,
      severity: (e.severity === "critical" ? "critical" : e.severity === "high" ? "high" : "medium") as any,
      title: `🚨 SOS — ${e.employeeName}`,
      body: `${e.type || "Emergency"} in ${e.zone || "Unknown Zone"}. Status: ${e.status}.`,
      timestamp: new Date(e.triggeredAt || Date.now()),
      read: e.status === "resolved",
      zone: e.zone,
      actorName: e.employeeName,
      navigateTo: "emergencyHub",
    }));
    // CRIT #164: never fall back to MOCK_NOTIFS on Day 1 — owner
    // would see fake emergencies before any real activity. Empty
    // state is rendered by the panel below.
    return import.meta.env.DEV && fromStore.length === 0 ? MOCK_NOTIFS : fromStore;
  });
  const [filterCat, setFilterCat] = useState<NotifCategory | "all">("all");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showFilter, setShowFilter] = useState(false);

  // Sync with store changes (new emergencies arrive → add notification)
  useEffect(() => {
    const fromStore: Notification[] = storeEmergencies.map(e => ({
      id: `N-emg-${e.id}`,
      category: "sos" as NotifCategory,
      severity: (e.severity === "critical" ? "critical" : e.severity === "high" ? "high" : "medium") as any,
      title: `🚨 SOS — ${e.employeeName}`,
      body: `${e.type || "Emergency"} in ${e.zone || "Unknown Zone"}. Status: ${e.status}.`,
      timestamp: new Date(e.triggeredAt || Date.now()),
      read: e.status === "resolved",
      zone: e.zone,
      actorName: e.employeeName,
      navigateTo: "emergencyHub",
    }));
    if (fromStore.length > 0) {
      setNotifs(prev => {
        const existingIds = new Set(prev.map(n => n.id));
        const newFromStore = fromStore.filter(n => !existingIds.has(n.id));
        if (newFromStore.length === 0) return prev;
        return [...newFromStore, ...prev.filter(n => !n.id.startsWith("N-0") /* remove mock */)]
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      });
    }
  }, [storeEmergencies]);

  // Sync unread count outward
  useEffect(() => {
    onUnreadChange(notifs.filter(n => !n.read).length);
  }, [notifs, onUnreadChange]);

  // Live events from mobile app / shared store
  useEffect(() => {
    const unsub = onSyncEvent((event: SyncEvent) => {
      let newNotif: Notification | null = null;

      if (event.type === "SOS_TRIGGERED") {
        newNotif = {
          id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          category: "sos", severity: "critical",
          title: `🚨 SOS — ${event.employeeName}`,
          body: `SOS button activated in ${event.zone || "Unknown Zone"}. Immediate response required.`,
          timestamp: new Date(event.timestamp),
          read: false, zone: event.zone, actorName: event.employeeName,
          navigateTo: "emergencyHub",
        };
      } else if (event.type === "HAZARD_REPORT") {
        newNotif = {
          id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          category: "hazard", severity: "high",
          title: `☢️ Hazard Report — ${event.employeeName}`,
          body: `${event.data?.hazardType || "Environmental"} hazard reported in ${event.zone || "Unknown Zone"}.`,
          timestamp: new Date(event.timestamp),
          read: false, zone: event.zone, actorName: event.employeeName,
          navigateTo: "emergencyHub",
        };
      } else if (event.type === "CHECKIN") {
        newNotif = {
          id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          category: "checkin", severity: "success",
          title: `✅ Check-in — ${event.employeeName}`,
          body: `Employee checked in at ${event.zone || "their zone"}.`,
          timestamp: new Date(event.timestamp),
          read: false, zone: event.zone, actorName: event.employeeName,
          navigateTo: "employees",
        };
      } else if (event.type === "INCIDENT_REPORT_RECEIVED") {
        const d = event.data as any;
        const photoCount = d?.photoCount || d?.photos?.length || 0;
        const sev = d?.severity || "medium";
        newNotif = {
          id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          category: "hazard", severity: sev === "critical" ? "critical" : sev === "high" ? "high" : "medium",
          title: `📋 Incident Report — ${event.employeeName}`,
          body: `${d?.incidentType || "Incident"} report with ${photoCount} photo${photoCount !== 1 ? "s" : ""} from ${event.zone || "Unknown Zone"}. Severity: ${(sev || "medium").toUpperCase()}.${d?.comment ? ` "${d.comment.slice(0, 80)}${d.comment.length > 80 ? "…" : ""}"` : ""}`,
          timestamp: new Date(event.timestamp),
          read: false, zone: event.zone, actorName: event.employeeName,
          navigateTo: "emergencyHub",
        };
      }

      // ── Admin SOS Response Tracking (Owner visibility) ──
      if (event.type === "ADMIN_ACKNOWLEDGED") {
        const d = event.data as any;
        newNotif = {
          id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          category: "sos", severity: "success",
          title: `✅ Admin Responded — ${event.employeeName}`,
          body: `${d?.adminName || "Safety Admin"} acknowledged SOS in ${d?.responseTimeSec || "?"}s. Response logged.`,
          timestamp: new Date(event.timestamp),
          read: false, zone: event.zone, actorName: d?.adminName || "Safety Admin",
          navigateTo: "auditLog",
        };
      } else if (event.type === "ADMIN_UNREACHABLE") {
        const d = event.data as any;
        newNotif = {
          id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          category: "sos", severity: "critical",
          title: `⚠️ Admin ${d?.action === "declined" ? "Declined" : "Missed"} SOS — ${event.employeeName}`,
          body: `${d?.adminName || "Safety Admin"} ${d?.action === "declined" ? "declined" : "did not answer"} SOS call after ${d?.responseTimeSec || "30"}s. ${d?.reason || "Escalation may be needed."}`,
          timestamp: new Date(event.timestamp),
          read: false, zone: event.zone, actorName: d?.adminName || "Safety Admin",
          navigateTo: "emergencyHub",
        };
      }

      // ── Evidence submitted from field worker ──
      if (event.type === "SOS_EVIDENCE_SUBMITTED") {
        const d = event.data as any;
        newNotif = {
          id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          severity: "high",
          category: "sos",
          icon: "📸",
          title: `Field Evidence Received — ${event.employeeName}`,
          body: `${d?.photoCount || 0} photo(s)${d?.hasRecording ? ` + ${d?.recordingDuration}s voice memo` : ""}${d?.hasComment ? " + worker comment" : ""}. Evidence stored in vault${d?.evidenceId ? ` (${d.evidenceId})` : ""}.`,
          timestamp: new Date(event.timestamp),
          read: false, zone: event.zone, actorName: event.employeeName,
          navigateTo: "incidentReports",
        };
      }

      if (newNotif) {
        setNotifs(prev => [newNotif!, ...prev]);
        // Play sound
        if (soundEnabled && newNotif.severity === "critical") {
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            osc.start(); osc.stop(ctx.currentTime + 0.5);
          } catch (_) {}
        }
      }
    });
    return unsub;
  }, [soundEnabled]);

  const filtered = notifs.filter(n =>
    filterCat === "all" || n.category === filterCat
  );

  const unread = notifs.filter(n => !n.read).length;
  const unreadFiltered = filtered.filter(n => !n.read).length;

  const handleRead = useCallback((id: string) => {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const handleDelete = useCallback((id: string) => {
    setNotifs(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleMarkAllRead = () => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleClearAll = () => {
    setNotifs(prev => prev.filter(n => !n.read || n.severity === "critical"));
  };

  const FILTER_OPTIONS: Array<{ id: NotifCategory | "all"; label: string; color: string }> = [
    { id: "all",       label: "All",        color: "#00C8E0"              },
    { id: "sos",       label: "SOS",        color: "#FF2D55"              },
    { id: "checkin",   label: "Check-in",   color: "#00C853"              },
    { id: "hazard",    label: "Hazard",     color: "#FF9500"              },
    { id: "geofence",  label: "Geofence",   color: "#00C8E0"              },
    { id: "audit",     label: "Audit",      color: "#FF9500"              },
    { id: "system",    label: "System",     color: "#9B59B6"              },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="notif-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="notif-panel"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
            style={{
              width: 420,
              background: "linear-gradient(180deg, #0A1220 0%, #07090F 100%)",
              borderLeft: "1px solid rgba(0,200,224,0.08)",
              boxShadow: "-24px 0 80px rgba(0,0,0,0.5)",
            }}
          >
            {/* ── Header ─────────────────────────────────────── */}
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="size-9 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}
                >
                  <Bell className="size-4" style={{ color: "#00C8E0" }} />
                </div>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>
                    Notifications
                  </h2>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                    {unread > 0 ? `${unread} unread` : "All caught up"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Sound toggle */}
                <button
                  onClick={() => setSoundEnabled(v => !v)}
                  className="size-8 rounded-lg flex items-center justify-center transition-all"
                  style={{
                    background: soundEnabled ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${soundEnabled ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.06)"}`,
                  }}
                  title={soundEnabled ? "Mute alerts" : "Enable alerts"}
                >
                  {soundEnabled
                    ? <Volume2 className="size-3.5" style={{ color: "#00C8E0" }} />
                    : <VolumeX className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                  }
                </button>

                {/* Close */}
                <button
                  onClick={onClose}
                  className="size-8 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
                </button>
              </div>
            </div>

            {/* ── Action Bar ─────────────────────────────────── */}
            <div
              className="flex items-center gap-2 px-4 py-2.5"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >
              {unread > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", fontSize: 11, fontWeight: 600, color: "#00C8E0" }}
                >
                  <Eye className="size-3.5" /> Mark all read
                </button>
              )}
              <button
                onClick={handleClearAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}
              >
                <Trash2 className="size-3.5" /> Clear read
              </button>
              <div className="flex-1" />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                {filtered.length} total
              </span>
            </div>

            {/* ── Category Filter Pills ───────────────────────── */}
            <div
              className="flex items-center gap-1.5 px-4 py-2.5 overflow-x-auto"
              style={{ scrollbarWidth: "none", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >
              {FILTER_OPTIONS.map(opt => {
                const isActive = filterCat === opt.id;
                const catCount = opt.id === "all"
                  ? notifs.filter(n => !n.read).length
                  : notifs.filter(n => n.category === opt.id && !n.read).length;
                return (
                  <motion.button
                    key={opt.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setFilterCat(opt.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg flex-shrink-0"
                    style={{
                      background: isActive ? `${opt.color}15` : "rgba(255,255,255,0.03)",
                      border: isActive ? `1.5px solid ${opt.color}30` : "1px solid rgba(255,255,255,0.06)",
                      fontSize: 11, fontWeight: isActive ? 700 : 500,
                      color: isActive ? opt.color : "rgba(255,255,255,0.4)",
                    }}
                  >
                    {opt.label}
                    {catCount > 0 && (
                      <span
                        className="size-4 rounded-full flex items-center justify-center"
                        style={{ fontSize: 8, fontWeight: 800, background: opt.color, color: "#fff" }}
                      >
                        {catCount}
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>

            {/* ── Notification List ──────────────────────────── */}
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                  <div
                    className="size-14 rounded-2xl flex items-center justify-center"
                    style={{ background: "rgba(0,200,224,0.06)" }}
                  >
                    <Bell className="size-6" style={{ color: "rgba(0,200,224,0.4)" }} />
                  </div>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>No notifications</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {/* Group: Unread */}
                  {unreadFiltered > 0 && (
                    <div key="group-unread">
                      <div
                        className="sticky top-0 px-4 py-2 flex items-center gap-2"
                        style={{ background: "rgba(10,18,32,0.95)", backdropFilter: "blur(12px)", zIndex: 1 }}
                      >
                        <motion.div
                          animate={{ opacity: [1, 0.4, 1] }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="size-2 rounded-full"
                          style={{ background: "#FF2D55" }}
                        />
                        <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "1px" }}>
                          UNREAD · {unreadFiltered}
                        </span>
                      </div>
                      {filtered.filter(n => !n.read).map(n => (
                        <NotifRow
                          key={n.id}
                          notif={n}
                          onRead={handleRead}
                          onNavigate={(page) => { onNavigate(page); onClose(); }}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  )}

                  {/* Group: Read */}
                  {filtered.filter(n => n.read).length > 0 && (
                    <div key="group-read">
                      <div
                        className="sticky top-0 px-4 py-2"
                        style={{ background: "rgba(10,18,32,0.95)", backdropFilter: "blur(12px)", zIndex: 1 }}
                      >
                        <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "1px" }}>
                          EARLIER
                        </span>
                      </div>
                      {filtered.filter(n => n.read).map(n => (
                        <NotifRow
                          key={n.id}
                          notif={n}
                          onRead={handleRead}
                          onNavigate={(page) => { onNavigate(page); onClose(); }}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  )}
                </AnimatePresence>
              )}

              {/* Footer spacer */}
              <div className="h-16" />
            </div>

            {/* ── Footer ─────────────────────────────────────── */}
            <div
              className="px-4 py-3 flex items-center gap-2"
              style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                style={{ background: soundEnabled ? "rgba(52,199,89,0.08)" : "rgba(255,255,255,0.04)", border: "1px solid rgba(52,199,89,0.15)" }}
              >
                <motion.div
                  animate={{ opacity: soundEnabled ? [1, 0.4, 1] : 1 }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="size-1.5 rounded-full"
                  style={{ background: soundEnabled ? "#34C759" : "rgba(255,255,255,0.2)" }}
                />
                <span style={{ fontSize: 9, fontWeight: 700, color: soundEnabled ? "#34C759" : "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                  {soundEnabled ? "LIVE" : "MUTED"}
                </span>
              </div>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                Real-time · Updates from field
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Bell Button with Badge ────────────────────────────────────
export function NotificationsBellButton({
  unreadCount, onClick,
}: { unreadCount: number; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className="relative size-9 rounded-full flex items-center justify-center"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <Bell className="size-4" style={{ color: "rgba(255,255,255,0.35)" }} />
      <AnimatePresence>
        {unreadCount > 0 && (
          <motion.span
            key="badge"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="absolute -top-0.5 -right-0.5 min-w-4 h-4 rounded-full flex items-center justify-center px-1"
            style={{ background: "#FF2D55", fontSize: 8, fontWeight: 800, color: "#fff", boxShadow: "0 0 6px rgba(255,45,85,0.5)" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}