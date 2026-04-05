import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { ChevronLeft, Bell, AlertTriangle, Shield, Users, MapPin, Timer, Heart, CheckCheck, Trash2, Megaphone } from "lucide-react";
interface Notification {
  id: string;
  type: "sos" | "checkin" | "family" | "location" | "system" | "medical" | "broadcast";
  title: string;
  message: string;
  time: string;
  read: boolean;
  urgent: boolean;
  broadcastPriority?: string;
  broadcastSource?: string;
}

interface NotificationsCenterProps {
  onBack: () => void;
}

const TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string }> = {
  sos: { icon: AlertTriangle, color: "#FF2D55", bg: "rgba(255,45,85,0.08)" },
  checkin: { icon: Timer, color: "#FF9500", bg: "rgba(255,150,0,0.08)" },
  family: { icon: Users, color: "#00C8E0", bg: "rgba(0,200,224,0.08)" },
  location: { icon: MapPin, color: "#00C853", bg: "rgba(0,200,83,0.08)" },
  system: { icon: Shield, color: "#007AFF", bg: "rgba(0,122,255,0.08)" },
  medical: { icon: Heart, color: "#FF2D55", bg: "rgba(255,45,85,0.08)" },
  broadcast: { icon: Megaphone, color: "#00C8E0", bg: "rgba(0,200,224,0.08)" },
};

const INITIAL_NOTIFICATIONS: Notification[] = [
  { id: "1", type: "family", title: "Sarah checked in", message: "Sarah confirmed she's safe at home.", time: "2m ago", read: false, urgent: false },
  { id: "2", type: "location", title: "Alex left school zone", message: "Alex has moved outside the school geofence area.", time: "18m ago", read: false, urgent: true },
  { id: "3", type: "checkin", title: "Check-in reminder", message: "Your 2-hour check-in timer expires in 5 minutes. Please respond.", time: "45m ago", read: false, urgent: true },
  { id: "4", type: "system", title: "App updated to v1.1", message: "New features: improved SOS response time and battery optimization.", time: "2h ago", read: true, urgent: false },
  { id: "5", type: "family", title: "Mom's location updated", message: "Mom is now at City Hospital. Last check-in 25 minutes ago.", time: "3h ago", read: true, urgent: false },
  { id: "6", type: "sos", title: "SOS drill completed", message: "Your monthly SOS drill was successful. All contacts notified in 8 seconds.", time: "1d ago", read: true, urgent: false },
  { id: "7", type: "medical", title: "Medical ID updated", message: "Your blood type and allergy information has been synced.", time: "2d ago", read: true, urgent: false },
  { id: "8", type: "system", title: "Pro features activated", message: "Enjoy unlimited emergency contacts, 5-min recording, and PDF export.", time: "3d ago", read: true, urgent: false },
  { id: "9", type: "family", title: "David joined Family Circle", message: "David accepted your invitation and is now part of your safety circle.", time: "5d ago", read: true, urgent: false },
  { id: "10", type: "location", title: "New safe zone added", message: "Home zone has been set up. You'll get alerts when family members arrive or leave.", time: "1w ago", read: true, urgent: false },
];

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "Just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function broadcastToNotification(b: BroadcastMessage): Notification {
  const priorityUrgent = b.priority === "emergency" || b.priority === "urgent";
  const sourceIcon = b.source === "auto_sos" ? "sos"
    : b.source === "auto_gps" ? "location"
    : b.source === "auto_hazard" ? "sos"
    : "broadcast";
  return {
    id: `bc-${b.id}`,
    type: sourceIcon as any,
    title: b.title,
    message: b.body,
    time: timeAgo(b.timestamp),
    read: b.readBy.includes("EMP-APP"),
    urgent: priorityUrgent,
    broadcastPriority: b.priority,
    broadcastSource: b.source,
  };
}

type FilterType = "all" | "sos" | "checkin" | "family" | "location" | "system" | "medical" | "broadcast";

const FILTERS: { id: FilterType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "broadcast", label: "Broadcasts" },
  { id: "sos", label: "SOS" },
  { id: "checkin", label: "Check-in" },
  { id: "family", label: "Family" },
  { id: "location", label: "Location" },
  { id: "system", label: "System" },
];

export function NotificationsCenter({ onBack }: NotificationsCenterProps) {
  const [baseNotifications, setBaseNotifications] = useState(INITIAL_NOTIFICATIONS);
  const [broadcastNotifs, setBroadcastNotifs] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");

  // Load broadcasts on mount and listen for new ones
  useEffect(() => {
    const loadBroadcasts = () => {
      const broadcasts = getBroadcastsForEmployee("EMP-APP", "employee", "Z-B");
      setBroadcastNotifs(broadcasts.map(broadcastToNotification));
    };
    loadBroadcasts();
    const unsub = onBroadcastReceived(() => loadBroadcasts());
    const interval = setInterval(loadBroadcasts, 3000);
    return () => { unsub(); clearInterval(interval); };
  }, []);

  const notifications = [...broadcastNotifs, ...baseNotifications];

  const unreadCount = notifications.filter(n => !n.read).length;
  const filtered = filter === "all" ? notifications : notifications.filter(n => n.type === filter);

  const markAllRead = () => {
    setBaseNotifications(ns => ns.map(n => ({ ...n, read: true })));
    // Mark all broadcasts read
    const broadcasts = getBroadcastsForEmployee("EMP-APP", "employee", "Z-B");
    broadcasts.forEach(b => markBroadcastRead(b.id, "EMP-APP"));
    setBroadcastNotifs(prev => prev.map(n => ({ ...n, read: true })));
  };

  const markRead = (id: string) => {
    if (id.startsWith("bc-")) {
      const bcId = id.replace("bc-", "");
      markBroadcastRead(bcId, "EMP-APP");
      setBroadcastNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } else {
      setBaseNotifications(ns => ns.map(n => n.id === id ? { ...n, read: true } : n));
    }
  };

  const deleteNotification = (id: string) => {
    if (id.startsWith("bc-")) {
      setBroadcastNotifs(prev => prev.filter(n => n.id !== id));
    } else {
      setBaseNotifications(ns => ns.filter(n => n.id !== id));
    }
  };

  const clearAll = () => {
    setBaseNotifications([]);
    setBroadcastNotifs([]);
  };

  // Group by today, earlier, older
  const today = filtered.filter(n => n.time.includes("m ago") || n.time.includes("h ago") || n.time.includes("s ago") || n.time === "Just now");
  const earlier = filtered.filter(n => n.time.includes("d ago"));
  const older = filtered.filter(n => n.time.includes("w ago"));

  const renderSection = (title: string, items: Notification[]) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-4">
        <p className="px-5 mb-2" style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.12)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
          {title}
        </p>
        <div className="space-y-1.5 px-5">
          {items.map((notif, i) => {
            const config = TYPE_CONFIG[notif.type];
            return (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                layout
                onClick={() => markRead(notif.id)}
                className="relative p-3.5 cursor-pointer"
                style={{
                  borderRadius: 16,
                  background: notif.read ? "rgba(255,255,255,0.01)" : "rgba(255,255,255,0.025)",
                  border: notif.urgent && !notif.read
                    ? `1px solid ${config.color}20`
                    : "1px solid rgba(255,255,255,0.035)",
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div
                    className="size-9 rounded-[11px] flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: config.bg, border: `1px solid ${config.color}15` }}
                  >
                    <config.icon className="size-4" style={{ color: config.color, opacity: notif.read ? 0.5 : 1 }} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p style={{
                        fontSize: 13,
                        fontWeight: notif.read ? 500 : 600,
                        color: notif.read ? "rgba(255,255,255,0.4)" : "#fff",
                      }}>
                        {notif.title}
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.12)" }}>{notif.time}</span>
                        {!notif.read && (
                          <div className="size-[6px] rounded-full" style={{ background: config.color, boxShadow: `0 0 4px ${config.color}50` }} />
                        )}
                      </div>
                    </div>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.18)", marginTop: 3, lineHeight: 1.5 }}>
                      {notif.message}
                    </p>
                  </div>
                </div>

                {/* Urgent indicator */}
                {notif.urgent && !notif.read && (
                  <div className="absolute top-0 left-0 w-[3px] h-full rounded-l-[16px]" style={{ background: config.color }} />
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="relative flex flex-col h-full">
      {/* Ambient */}
      <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0.03) 0%, transparent 70%)" }}
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: "none" }}>
        <div className="pt-14 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between px-5 mb-4">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="size-9 rounded-[12px] flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <ChevronLeft className="size-[18px]" style={{ color: "rgba(255,255,255,0.5)" }} />
              </button>
              <div>
                <h1 className="text-white" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>Notifications</h1>
                {unreadCount > 0 && (
                  <p style={{ fontSize: 11, color: "rgba(0,200,224,0.5)", marginTop: 2 }}>
                    {unreadCount} unread
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="px-3 py-1.5 rounded-lg"
                  style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.1)", fontSize: 11, fontWeight: 600, color: "rgba(0,200,224,0.6)" }}>
                  <CheckCheck className="size-3.5 inline mr-1" />
                  Read all
                </button>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="px-5 mb-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            <div className="flex items-center gap-2">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className="px-3.5 py-2 shrink-0"
                  style={{
                    borderRadius: 10,
                    background: filter === f.id ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${filter === f.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
                    fontSize: 12,
                    fontWeight: filter === f.id ? 600 : 400,
                    color: filter === f.id ? "#00C8E0" : "rgba(255,255,255,0.25)",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notifications */}
          {filtered.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-20">
              <div className="size-16 rounded-[20px] flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <Bell className="size-7" style={{ color: "rgba(255,255,255,0.1)" }} />
              </div>
              <p className="text-white" style={{ fontSize: 16, fontWeight: 600 }}>No Notifications</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>
                {filter !== "all" ? "No notifications in this category" : "You're all caught up!"}
              </p>
            </motion.div>
          ) : (
            <>
              {renderSection("Today", today)}
              {renderSection("This Week", earlier)}
              {renderSection("Earlier", older)}

              {/* Clear all */}
              {notifications.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-5 mt-4">
                  <button onClick={clearAll} className="w-full py-3 flex items-center justify-center gap-2"
                    style={{ borderRadius: 14, background: "rgba(255,45,85,0.03)", border: "1px solid rgba(255,45,85,0.06)", fontSize: 13, fontWeight: 500, color: "rgba(255,45,85,0.4)" }}>
                    <Trash2 className="size-3.5" />
                    Clear All Notifications
                  </button>
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}