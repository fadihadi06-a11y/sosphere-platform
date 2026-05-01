// ═══════════════════════════════════════════════════════════════
// NotificationPermissionBanner — lifesaving prompt
// ─────────────────────────────────────────────────────────────
// Audit 2026-05-01: live test revealed push_tokens table was empty
// for ALL users despite initFCM() being wired into the auth listener.
// Root cause: browsers silently block Notification.requestPermission()
// when called outside a user-gesture context (auth listeners are NOT
// user gestures). Result: SOS push alerts never delivered to owners.
//
// This component fixes that by rendering a small banner at the top
// of the dashboard whenever Notification.permission === "default".
// The user clicks "Enable Alerts" — that click IS a user gesture,
// so the browser shows its native permission prompt. After grant,
// initFCM runs and saves the PushSubscription to push_tokens.
//
// SOS push delivery only works AFTER this banner has been
// dismissed-by-grant at least once per device per browser.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  getNotificationPermissionState,
  requestPushPermission,
} from "./api/fcm-push";

const SNOOZE_KEY = "sos_notif_banner_snoozed_until";
const SNOOZE_HOURS = 24;

interface Props {
  userId: string | undefined;
}

export function NotificationPermissionBanner({ userId }: Props) {
  const [perm, setPerm] = useState<ReturnType<typeof getNotificationPermissionState>>("default");
  const [busy, setBusy] = useState(false);
  const [snoozed, setSnoozed] = useState(false);

  useEffect(() => {
    setPerm(getNotificationPermissionState());
    try {
      const until = parseInt(localStorage.getItem(SNOOZE_KEY) || "0", 10);
      setSnoozed(Number.isFinite(until) && until > Date.now());
    } catch { /* localStorage may be blocked */ }
  }, []);

  // Don't render: unsupported, already granted, denied (browser-level
  // — only browser settings can re-enable), or user snoozed.
  if (perm === "granted" || perm === "denied" || perm === "unsupported") return null;
  if (snoozed) return null;
  if (!userId) return null;

  const handleEnable = async () => {
    setBusy(true);
    try {
      const result = await requestPushPermission(userId);
      if (result === "granted") {
        toast.success("Emergency alerts enabled. You'll be notified the moment an employee triggers SOS.");
        setPerm("granted");
      } else if (result === "denied") {
        toast.error("Notifications blocked. To enable later: click the lock icon in your address bar → Notifications → Allow.");
        setPerm("denied");
      } else if (result === "unsupported") {
        toast.error("Your browser does not support push notifications.");
      } else {
        toast.error("Could not enable notifications. Please refresh and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSnooze = () => {
    const until = Date.now() + SNOOZE_HOURS * 60 * 60 * 1000;
    try { localStorage.setItem(SNOOZE_KEY, String(until)); } catch { /* ignore */ }
    setSnoozed(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        role="alert"
        aria-live="polite"
        style={{
          position: "relative",
          margin: "12px 16px 0",
          padding: "12px 16px",
          borderRadius: 12,
          background: "linear-gradient(135deg, rgba(255,149,0,0.10), rgba(255,149,0,0.04))",
          border: "1px solid rgba(255,149,0,0.30)",
          boxShadow: "0 4px 20px rgba(255,149,0,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: "rgba(255,149,0,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Bell className="size-5" style={{ color: "#FF9500" }} />
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#FF9500", margin: 0 }}>
            Enable emergency alerts
          </p>
          <p style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.65)", margin: "2px 0 0", lineHeight: 1.4 }}>
            Without this, you will not receive a push notification when an employee triggers SOS — even if their location and audio reach the dashboard.
          </p>
        </div>

        <button
          onClick={handleEnable}
          disabled={busy}
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            background: busy ? "rgba(255,149,0,0.4)" : "linear-gradient(135deg, #FF9500, #E08000)",
            color: "#fff", fontSize: 13, fontWeight: 700,
            border: "none",
            cursor: busy ? "default" : "pointer",
            display: "flex", alignItems: "center", gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          <Bell className="size-4" />
          {busy ? "Enabling..." : "Enable Alerts"}
        </button>

        <button
          onClick={handleSnooze}
          aria-label="Snooze for 24 hours"
          title="Snooze for 24 hours"
          style={{
            padding: 8, borderRadius: 8,
            background: "transparent", border: "1px solid rgba(255,255,255,0.10)",
            color: "rgba(255,255,255,0.5)",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <X className="size-4" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

// Re-export the icon symbol so test files can detect the import.
export { BellOff };
