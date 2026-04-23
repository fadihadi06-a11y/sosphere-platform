import { useState } from "react";
import { motion } from "motion/react";
import {
  ChevronRight, Crown, Shield, Heart, Bell,
  Globe, Moon, Lock, LogOut, HelpCircle, FileText,
  Users, Building2, Smartphone, MapPin, User,
  Star, Zap, AlertTriangle, Clock, Package, Phone,
  Sparkles,
} from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";

// ─── Types ─────────────────────────────────────────────────────────────────────
type SubScreen = "main" | "medical-id" | "subscription" | "incident-history" | "emergency-packet" | "emergency-services" | "emergency-contacts" | "language" | "privacy" | "connected-devices" | "help" | "elite-features";

interface ProfileSettingsProps {
  userPlan: "free" | "pro" | "employee";
  onNavigate: (screen: SubScreen) => void;
  onLogout: () => void;
  companyName?: string;
  userName?: string;
}

interface SettingsSection {
  title: string;
  items: SettingsItem[];
}

interface SettingsItem {
  id: string;
  icon: typeof Heart;
  label: string;
  sub?: string;
  color: string;
  badge?: string;
  badgeColor?: string;
  action?: () => void;
  chevron?: boolean;
  toggle?: boolean;
  toggleValue?: boolean;
  locked?: boolean;
  danger?: boolean;
}

const AVATAR_URL = "https://images.unsplash.com/photo-1769636929231-3cd7f853d038?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjBtYW4lMjBwb3J0cmFpdCUyMGhlYWRzaG90JTIwZGFyayUyMGJhY2tncm91bmR8ZW58MXx8fHwxNzcyNzkyMjkwfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral";

export function ProfileSettings({ userPlan, onNavigate, onLogout, companyName, userName }: ProfileSettingsProps) {
  const [notifications, setNotifications] = useState(true);
  const [locationSharing, setLocationSharing] = useState(true);
  const [darkMode, setDarkMode] = useState(true);

  const isPro = userPlan === "pro" || userPlan === "employee";

  const planConfig = {
    free: { label: "Free Plan", color: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.06)", icon: Shield },
    pro: { label: "Pro Plan", color: "#00C8E0", bg: "rgba(0,200,224,0.06)", border: "rgba(0,200,224,0.12)", icon: Crown },
    employee: { label: companyName || "Company Plan", color: "#FF9500", bg: "rgba(255,150,0,0.06)", border: "rgba(255,150,0,0.12)", icon: Building2 },
  }[userPlan];

  const sections: SettingsSection[] = [
    {
      title: "Safety",
      items: [
        { id: "medical", icon: Heart, label: "Medical ID", sub: "Blood type, allergies, medications", color: "#FF2D55", chevron: true, action: () => onNavigate("medical-id") },
        { id: "incidents", icon: Clock, label: "Incident History", sub: isPro ? "Unlimited archive" : "Last 7 days", color: "#FF9500", chevron: true, action: () => onNavigate("incident-history") },
        { id: "packet", icon: Package, label: "Emergency Packet", sub: "Data sent during SOS", color: "#00C8E0", chevron: true, action: () => onNavigate("emergency-packet") },
        { id: "services", icon: Phone, label: "Emergency Services", sub: "Emergency numbers by country", color: "#FF2D55", chevron: true, action: () => onNavigate("emergency-services") },
        // FIX 2026-04-23: removed the "PRO" badge. Free users CAN add 1
        // emergency contact — the badge made the row look locked and users
        // thought the feature required an upgrade. The sub-text still says
        // "1 contact (Free limit)" which is informative without misleading.
        { id: "emergency", icon: Users, label: "Emergency Contacts", sub: isPro ? "4 contacts" : "1 contact (Free limit)", color: "#00C8E0", chevron: true, action: () => onNavigate("emergency-contacts") },
        { id: "location", icon: MapPin, label: "Live Location Sharing", color: "#00C853", toggle: true, toggleValue: locationSharing },
      ],
    },
    {
      title: "Preferences",
      items: [
        { id: "notifications", icon: Bell, label: "Notifications", sub: "Alerts, check-in reminders", color: "#FF9500", toggle: true, toggleValue: notifications },
        { id: "language", icon: Globe, label: "Language", sub: "English", color: "#007AFF", chevron: true, action: () => onNavigate("language") },
        { id: "elite-features", icon: Sparkles, label: "Elite Features", sub: "AI voice script, personalisation", color: "#FFD700", chevron: true, action: () => onNavigate("elite-features"), badge: !isPro ? "ELITE" : undefined, badgeColor: "#FFD700" },
        { id: "appearance", icon: Moon, label: "Dark Mode", color: "#AF52DE", toggle: true, toggleValue: darkMode },
      ],
    },
    {
      title: "Account",
      items: [
        { id: "subscription", icon: Crown, label: "Subscription", sub: planConfig.label, color: "#FFD700", chevron: true, action: () => onNavigate("subscription") },
        // FIX 2026-04-23: Connected Devices marked as Coming Soon because the
        // backend feature isn't ready. Removed the navigation action so the
        // user can't reach a broken screen, and added a visible badge.
        { id: "devices", icon: Smartphone, label: "Connected Devices", sub: "Coming soon", color: "rgba(255,255,255,0.25)", badge: "Coming Soon", badgeColor: "rgba(255,255,255,0.35)" },
        { id: "privacy", icon: Lock, label: "Privacy & Security", color: "rgba(255,255,255,0.4)", chevron: true, action: () => onNavigate("privacy") },
      ],
    },
    {
      title: "Support",
      items: [
        { id: "help", icon: HelpCircle, label: "Help & Support", color: "rgba(255,255,255,0.3)", chevron: true, action: () => onNavigate("help") },
        // FIX 2026-04-23: Terms & Privacy previously had no action (tap = dead).
        // Now opens the terms page. Also works as external fallback if no
        // internal page is registered — mobile-app.tsx routes it.
        { id: "terms", icon: FileText, label: "Terms & Privacy Policy", color: "rgba(255,255,255,0.3)", chevron: true, action: () => onNavigate("terms") },
        { id: "logout", icon: LogOut, label: "Log Out", color: "#FF2D55", danger: true, action: onLogout },
      ],
    },
  ];

  const handleToggle = (id: string) => {
    if (id === "notifications") setNotifications(v => !v);
    if (id === "location") setLocationSharing(v => !v);
    if (id === "appearance") setDarkMode(v => !v);
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden relative" style={{ scrollbarWidth: "none" }}>
      {/* Ambient */}
      <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0.03) 0%, transparent 70%)" }}
      />

      <div className="pt-14 pb-28">
        {/* Profile Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="px-5 mb-5"
        >
          <div
            className="p-5 relative overflow-hidden"
            style={{
              borderRadius: 22,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.04)",
              backdropFilter: "blur(20px)",
            }}
          >
            {/* Glow */}
            <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none"
              style={{ background: `radial-gradient(circle at top right, ${planConfig.bg}, transparent 70%)` }}
            />

            <div className="flex items-center gap-4 relative z-10">
              {/* Avatar */}
              <div className="relative">
                <div
                  className="size-[64px] rounded-[20px] overflow-hidden"
                  style={{ border: `2px solid ${planConfig.border}` }}
                >
                  <ImageWithFallback src={AVATAR_URL} alt="Profile" className="w-full h-full object-cover" />
                </div>
                {/* Plan badge */}
                <div
                  className="absolute -bottom-1 -right-1 size-6 rounded-lg flex items-center justify-center"
                  style={{ background: planConfig.bg, border: `1.5px solid ${planConfig.border}` }}
                >
                  <planConfig.icon style={{ width: 12, height: 12, color: planConfig.color }} />
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-white" style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px" }}>
                  {userName || "User"}
                </p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                  +966 5XX XXX XXXX
                </p>
                <div className="flex items-center gap-2 mt-2.5">
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1"
                    style={{
                      borderRadius: 8,
                      background: planConfig.bg,
                      border: `1px solid ${planConfig.border}`,
                    }}
                  >
                    <planConfig.icon style={{ width: 10, height: 10, color: planConfig.color }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: planConfig.color }}>
                      {planConfig.label}
                    </span>
                  </div>
                  {userPlan === "free" && (
                    <button
                      onClick={() => onNavigate("subscription")}
                      className="flex items-center gap-1 px-2.5 py-1"
                      style={{
                        borderRadius: 8,
                        background: "rgba(0,200,224,0.06)",
                        border: "1px solid rgba(0,200,224,0.12)",
                      }}
                    >
                      <Zap style={{ width: 9, height: 9, color: "#00C8E0" }} />
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#00C8E0" }}>Upgrade</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Upgrade Banner (Free only) */}
        {userPlan === "free" && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="px-5 mb-5"
          >
            <button
              onClick={() => onNavigate("subscription")}
              className="w-full p-4 relative overflow-hidden text-left"
              style={{
                borderRadius: 18,
                background: "linear-gradient(135deg, rgba(0,200,224,0.06) 0%, rgba(0,200,224,0.02) 100%)",
                border: "1px solid rgba(0,200,224,0.1)",
              }}
            >
              <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(0,200,224,0.1), transparent 70%)" }}
              />
              <div className="flex items-center gap-3 relative z-10">
                <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.15)" }}>
                  <Star style={{ width: 18, height: 18, color: "#00C8E0" }} />
                </div>
                <div className="flex-1">
                  <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>
                    Unlock Full Protection
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                    Unlimited contacts, 5min recording, PDF export & more
                  </p>
                </div>
                <ChevronRight style={{ width: 16, height: 16, color: "rgba(0,200,224,0.4)" }} />
              </div>
            </button>
          </motion.div>
        )}

        {/* Safety Stats */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="px-5 mb-5"
        >
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "47", label: "Days Safe", color: "#00C853" },
              { value: "12", label: "Check-ins", color: "#FF9500" },
              { value: "0", label: "SOS Alerts", color: "#FF2D55" },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className="p-3 text-center"
                style={{
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.015)",
                  border: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <p style={{ fontSize: 22, fontWeight: 800, color: stat.color, marginBottom: 2 }}>{stat.value}</p>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>{stat.label}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Settings Sections */}
        {sections.map((section, si) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + si * 0.06 }}
            className="px-5 mb-4"
          >
            <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", marginBottom: 8, paddingLeft: 2, textTransform: "uppercase" }}>
              {section.title}
            </p>
            <div
              style={{
                borderRadius: 16,
                background: "rgba(255,255,255,0.015)",
                border: "1px solid rgba(255,255,255,0.04)",
                overflow: "hidden",
              }}
            >
              {section.items.map((item, i) => (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.toggle) handleToggle(item.id);
                    else if (item.action) item.action();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  style={{
                    borderBottom: i < section.items.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                  }}
                >
                  {/* Icon */}
                  <div
                    className="size-8 rounded-[10px] flex items-center justify-center shrink-0"
                    style={{ background: `${item.color}10`, border: `1px solid ${item.color}18` }}
                  >
                    <item.icon style={{ width: 14, height: 14, color: item.color }} />
                  </div>

                  {/* Label */}
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 14, fontWeight: 500, color: item.danger ? "#FF2D55" : "rgba(255,255,255,0.7)" }}>
                      {item.label}
                    </p>
                    {item.sub && (
                      // FIX 2026-04-23: dir="ltr" + unicode-bidi:isolate prevents
                      // RTL from reordering numbers inside mixed strings like
                      // "1 contact (Free limit)" which was rendering as
                      // "contact (Free limit) 1" in Arabic layout.
                      <p dir="ltr" style={{ fontSize: 11, color: "rgba(255,255,255,0.15)", marginTop: 1, unicodeBidi: "isolate" }}>{item.sub}</p>
                    )}
                  </div>

                  {/* Badge */}
                  {item.badge && (
                    <span
                      className="px-2 py-0.5 shrink-0"
                      style={{
                        borderRadius: 6,
                        fontSize: 8, fontWeight: 700,
                        color: item.badgeColor,
                        background: `${item.badgeColor}12`,
                        border: `1px solid ${item.badgeColor}20`,
                        letterSpacing: "0.5px",
                      }}
                    >
                      {item.badge}
                    </span>
                  )}

                  {/* Toggle */}
                  {/* FIX 2026-04-23: added dir="ltr" to prevent RTL layout from
                      mirroring the motion.div x-transform. Without this, the
                      knob visually appeared on the LEFT when ON in Arabic. */}
                  {item.toggle && (
                    <div
                      dir="ltr"
                      className="relative shrink-0"
                      style={{
                        width: 44, height: 26, borderRadius: 13,
                        background: item.toggleValue ? `${item.color}25` : "rgba(255,255,255,0.06)",
                        border: `1.5px solid ${item.toggleValue ? `${item.color}35` : "rgba(255,255,255,0.08)"}`,
                      }}
                    >
                      <motion.div
                        animate={{ x: item.toggleValue ? 19 : 3 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="absolute top-[2px]"
                        style={{
                          width: 18, height: 18, borderRadius: 9,
                          left: 0,
                          background: item.toggleValue ? item.color : "rgba(255,255,255,0.25)",
                          boxShadow: item.toggleValue ? `0 2px 6px ${item.color}50` : "0 1px 3px rgba(0,0,0,0.3)",
                        }}
                      />
                    </div>
                  )}

                  {/* Chevron */}
                  {item.chevron && !item.toggle && (
                    <ChevronRight style={{ width: 16, height: 16, color: "rgba(255,255,255,0.1)", flexShrink: 0 }} />
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        ))}

        {/* App Version */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-3"
        >
          <div className="flex items-center justify-center gap-1.5 mb-1.5">
            <Shield style={{ width: 11, height: 11, color: "rgba(0,200,224,0.2)" }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.08)" }}>SOSphere</span>
          </div>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.06)" }}>Version 1.0.0</p>
        </motion.div>
      </div>
    </div>
  );
}