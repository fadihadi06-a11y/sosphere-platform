// ═══════════════════════════════════════════════════════════════
// SOSphere — Push Notification System
// ─────────────────────────────────────────────────────────────
// Uses Web Notification API for real browser notifications:
// • SOS alerts even when dashboard tab is background
// • Check-in expirations
// • Environmental warnings
// • Works across tabs without backend
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bell, BellRing, X, Shield, AlertTriangle, Clock, ChevronRight, Zap } from "lucide-react";

// ── Notification Types ─────────────────────────────────────────
export type NotifType = "sos" | "checkin_expired" | "fall_detected" | "environment" | "geofence" | "broadcast" | "escalation";

interface SOSphereNotification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  severity: "critical" | "high" | "medium" | "low";
  timestamp: number;
  read: boolean;
  data?: Record<string, any>;
}

// ── Permission State ───────────────────────────────────────────
type PermissionState = "default" | "granted" | "denied" | "unsupported";

// ── Web Notification Manager ───────────────────────────────────
class NotificationManager {
  private static instance: NotificationManager;
  private permission: PermissionState = "default";
  private audioCtx: AudioContext | null = null;

  static getInstance() {
    if (!this.instance) this.instance = new NotificationManager();
    return this.instance;
  }

  async requestPermission(): Promise<PermissionState> {
    if (!("Notification" in window)) {
      this.permission = "unsupported";
      return "unsupported";
    }
    
    try {
      const result = await Notification.requestPermission();
      this.permission = result as PermissionState;
      return this.permission;
    } catch {
      this.permission = "denied";
      return "denied";
    }
  }

  getPermission(): PermissionState {
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission as PermissionState;
  }

  async sendNotification(notif: SOSphereNotification): Promise<boolean> {
    const perm = this.getPermission();
    
    // Play sound regardless of permission
    this.playSound(notif.severity);

    if (perm !== "granted") return false;

    try {
      const iconEmoji = notif.type === "sos" ? "🚨" : notif.type === "fall_detected" ? "⚠️" : notif.type === "environment" ? "🌡️" : "🔔";
      
      const n = new Notification(`${iconEmoji} ${notif.title}`, {
        body: notif.body,
        tag: notif.id,
        requireInteraction: notif.severity === "critical",
        silent: false,
      });

      n.onclick = () => {
        window.focus();
        n.close();
      };

      // Auto-close non-critical after 10s
      if (notif.severity !== "critical") {
        setTimeout(() => n.close(), 10000);
      }

      return true;
    } catch {
      return false;
    }
  }

  private playSound(severity: "critical" | "high" | "medium" | "low") {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (severity === "critical") {
        // Urgent alarm: alternating high-low
        osc.type = "square";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.15);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.45);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.6);
      } else if (severity === "high") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      } else {
        osc.type = "sine";
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      }
    } catch {
      // Audio not available
    }
  }
}

// ── Hook: useNotifications ─────────────────────────────────────
export function useNotifications() {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [notifications, setNotifications] = useState<SOSphereNotification[]>([]);
  const manager = useRef(NotificationManager.getInstance());

  useEffect(() => {
    setPermission(manager.current.getPermission());
  }, []);

  const requestPermission = useCallback(async () => {
    const result = await manager.current.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const sendNotification = useCallback(async (
    type: NotifType,
    title: string,
    body: string,
    severity: "critical" | "high" | "medium" | "low" = "medium",
    data?: Record<string, any>,
  ) => {
    const notif: SOSphereNotification = {
      id: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type,
      title,
      body,
      severity,
      timestamp: Date.now(),
      read: false,
      data,
    };

    setNotifications(prev => [notif, ...prev].slice(0, 50));
    await manager.current.sendNotification(notif);
    return notif.id;
  }, []);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return {
    permission,
    notifications,
    unreadCount,
    requestPermission,
    sendNotification,
    markAsRead,
    clearAll,
  };
}

// ── Permission Request Card ────────────────────────────────────
interface PermissionRequestProps {
  permission: PermissionState;
  onRequest: () => void;
  onDismiss: () => void;
}

export function NotificationPermissionCard({ permission, onRequest, onDismiss }: PermissionRequestProps) {
  if (permission === "granted") return null;

  return (
    <AnimatePresence>
      {permission !== "denied" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="p-4 rounded-2xl"
          style={{
            background: "linear-gradient(135deg, rgba(0,200,224,0.06), rgba(123,94,255,0.04))",
            border: "1px solid rgba(0,200,224,0.12)",
          }}
        >
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.15)" }}>
              <BellRing className="size-5" style={{ color: "#00C8E0" }} />
            </div>
            <div className="flex-1">
              <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Enable Safety Alerts</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.5, marginTop: 4 }}>
                Get instant browser notifications for SOS emergencies, expired check-ins, and critical safety events — even when this tab is in the background.
              </p>
              
              <div className="flex gap-2 mt-3">
                <button onClick={onRequest}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl"
                  style={{
                    background: "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.06))",
                    border: "1px solid rgba(0,200,224,0.2)",
                    color: "#00C8E0",
                    fontSize: 12,
                    fontWeight: 700,
                  }}>
                  <Bell className="size-3.5" />
                  Enable Notifications
                </button>
                <button onClick={onDismiss}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.3)",
                    fontSize: 11,
                    fontWeight: 500,
                  }}>
                  Later
                </button>
              </div>
            </div>
          </div>

          {/* What you'll get */}
          <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            {[
              { icon: AlertTriangle, label: "SOS Alerts", color: "#FF2D55" },
              { icon: Clock, label: "Timer Expiry", color: "#FF9500" },
              { icon: Shield, label: "Fall Detection", color: "#00C853" },
              { icon: Zap, label: "Environment", color: "#00C8E0" },
            ].map(item => (
              <div key={item.label} className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
                style={{ background: `${item.color}06`, border: `1px solid ${item.color}10` }}>
                <item.icon className="size-3" style={{ color: item.color }} />
                <span style={{ fontSize: 8, fontWeight: 600, color: item.color }}>{item.label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── In-App Toast Notification ──────────────────────────────────
interface ToastNotifProps {
  notification: SOSphereNotification | null;
  onDismiss: () => void;
  onAction?: () => void;
}

export function NotificationToast({ notification, onDismiss, onAction }: ToastNotifProps) {
  useEffect(() => {
    if (!notification) return;
    if (notification.severity !== "critical") {
      const timer = setTimeout(onDismiss, 5000);
      return () => clearTimeout(timer);
    }
  }, [notification, onDismiss]);

  if (!notification) return null;

  const severityColors: Record<string, string> = {
    critical: "#FF2D55",
    high: "#FF9500",
    medium: "#00C8E0",
    low: "#00C853",
  };
  const color = severityColors[notification.severity] || "#00C8E0";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -80, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -80, opacity: 0, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="absolute top-14 left-3 right-3 z-[65] rounded-2xl overflow-hidden"
        style={{
          background: "rgba(10,18,32,0.95)",
          border: `1px solid ${color}25`,
          backdropFilter: "blur(20px)",
          boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 20px ${color}10`,
        }}
      >
        <div className="p-3.5 flex items-start gap-3">
          <motion.div
            animate={notification.severity === "critical" ? { scale: [1, 1.15, 1] } : {}}
            transition={{ duration: 0.8, repeat: Infinity }}
            className="size-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${color}12`, border: `1px solid ${color}20` }}
          >
            {notification.type === "sos" && <AlertTriangle className="size-4" style={{ color }} />}
            {notification.type === "fall_detected" && <AlertTriangle className="size-4" style={{ color }} />}
            {notification.type === "checkin_expired" && <Clock className="size-4" style={{ color }} />}
            {notification.type === "environment" && <Shield className="size-4" style={{ color }} />}
            {!["sos", "fall_detected", "checkin_expired", "environment"].includes(notification.type) && (
              <Bell className="size-4" style={{ color }} />
            )}
          </motion.div>
          <div className="flex-1 min-w-0">
            <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{notification.title}</p>
            <p className="mt-0.5" style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
              {notification.body}
            </p>
          </div>
          <button onClick={onDismiss}
            className="size-6 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "rgba(255,255,255,0.05)" }}>
            <X className="size-3" style={{ color: "rgba(255,255,255,0.3)" }} />
          </button>
        </div>

        {/* Quick Actions for critical */}
        {notification.severity === "critical" && onAction && (
          <div className="flex gap-2 px-3.5 pb-3">
            <button onClick={onAction}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
              style={{ background: `${color}10`, border: `1px solid ${color}18`, color, fontSize: 11, fontWeight: 700 }}>
              <ChevronRight className="size-3.5" />
              View Emergency
            </button>
            <button onClick={onDismiss}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)", fontSize: 11, fontWeight: 600 }}>
              Dismiss
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
