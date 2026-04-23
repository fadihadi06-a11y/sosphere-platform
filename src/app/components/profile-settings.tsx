import { useState } from "react";
import { motion } from "motion/react";
import {
  ChevronRight, Crown, Shield, Heart, Bell,
  Globe, Moon, Lock, LogOut, HelpCircle, FileText,
  Users, Building2, Smartphone, MapPin, User,
  Star, Zap, AlertTriangle, Clock, Package, Phone,
  Sparkles, Camera,
} from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
// AUDIT-FIX (2026-04-21): avatar editing entry point — tap on the
// profile photo to open the shared AvatarEditSheet. Same primitive
// will later wire into Home header too.
import { useProfile, AvatarEditSheet } from "./shared-stores";

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
  const [showAvatarEdit, setShowAvatarEdit] = useState(false);
  const [profile] = useProfile();

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
        { id: "emergency", icon: Users, label: "Emergency Contacts", sub: isPro ? "4 contacts" : "1 contact (Free limit)", color: "#00C8E0", chevron: true, action: () => onNavigate("emergency-contacts"), badge: !isPro ? "PRO" : undefined, badgeColor: "#00C8E0" },
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
        { id: "devices", icon: Smartphone, label: "Connected Devices", sub: "1 device", color: "#00C8E0", chevron: true, action: () => onNavigate("connected-devices") },
        { id: "privacy", icon: Lock, label: "Privacy & Security", color: "rgba(255,255,255,0.4)", chevron: true, action: () => onNavigate("privacy") },
      ],
    },
    {
      title: "Support",
      items: [
        { id: "help", icon: HelpCircle, label: "Help & Support", color: "rgba(255,255,255,0.3)", chevron: true, action: () => onNavigate("help") },
        { id: "terms", icon: FileText, label: "Terms & Privacy Policy", color: "rgba(255,255,255,0.3)", chevron: true, action: () => { try { window.open("https://sosphere.co/terms", "_blank"); } catch { window.location.href = "https://sosphere.co/terms"; } } },
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
      <div
        data-ambient-glow
        className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0) 0%, transparent 70%)" }}
      />

      <div style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 112px)" }}>
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
              {/* Avatar — tap to change (AvatarEditSheet) */}
              <button
                onClick={() => setShowAvatarEdit(true)}
                aria-label="Change profile photo"
                className="relative group"
              >
                <div
                  className="size-[64px] rounded-[20px] overflow-hidden flex items-center justify-center"
                  style={{
                    border: `2px solid ${planConfig.border}`,
                    background: profile.avatarUrl
                      ? "transparent"
                      : "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,153,179,0.08))",
                  }}
                >
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : profile.avatarInitials ? (
                    <span className="text-white" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px" }}>
                      {profile.avatarInitials}
                    </span>
                  ) : (
                    <ImageWithFallback src={AVATAR_URL} alt="Profile" className="w-full h-full object-cover" />
                  )}
                </div>
                {/* Camera overlay on hover/tap — signals tap to edit */}
                <div
                  className="absolute inset-0 rounded-[20px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: "rgba(0,0,0,0.55)" }}
                >
                  <Camera className="size-[18px]" style={{ color: "#fff" }} />
                </div>
                {/* Plan badge */}
                <div
                  className="absolute -bottom-1 -right-1 size-6 rounded-lg flex items-center justify-center"
                  style={{ background: planConfig.bg, border: `1.5px solid ${planConfig.border}` }}
                >
                  <planConfig.icon style={{ width: 12, height: 12, color: planConfig.color }} />
                </div>
              </button>

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
                    /* AUDIT-FIX: boxShadow instead of borderBottom —
                       full-width 1px border rendered as visible
                       horizontal stripe on Android OLED. */
                    boxShadow: i < section.items.length - 1
                      ? "inset 0 -1px 0 rgba(255,255,255,0.035)"
                      : "none",
                  }}
                >
                  {/* Icon — AUDIT-FIX (2026-04-21): bumped bg to 18%
                      alpha + inset boxShadow to render crisply on OLED.
                      Previously 10% bg + 1px border looked "half-dim". */}
                  <div
                    className="size-8 rounded-[10px] flex items-center justify-center shrink-0"
                    style={{
                      background: `${item.color}20`,
                      boxShadow: `inset 0 0 0 1px ${item.color}40`,
                    }}
                  >
                    <item.icon style={{ width: 14, height: 14, color: item.color }} strokeWidth={2.2} />
                  </div>

                  {/* Label — AUDIT-FIX: bumped label opacity 70% -> 90%
                      and subtitle 15% -> 45% so text is readable on OLED. */}
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 14, fontWeight: 500, color: item.danger ? "#FF2D55" : "rgba(255,255,255,0.92)" }}>
                      {item.label}
                    </p>
                    {item.sub && (
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{item.sub}</p>
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

                  {/* Toggle — AUDIT-FIX (2026-04-21): force LTR direction
                      on the track + use `left` positioning instead of
                      Framer's translateX. Previous version's circle
                      animated OUTSIDE the track bounds under RTL layout. */}
                  {item.toggle && (
                    <div
                      dir="ltr"
                      className="relative shrink-0 overflow-hidden"
                      style={{
                        width: 44, height: 26, borderRadius: 13,
                        background: item.toggleValue ? `${item.color}30` : "rgba(255,255,255,0.08)",
                        boxShadow: `inset 0 0 0 1.5px ${item.toggleValue ? `${item.color}50` : "rgba(255,255,255,0.12)"}`,
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 3,
                          left: item.toggleValue ? 22 : 3,
                          width: 18, height: 18, borderRadius: 9,
                          background: item.toggleValue ? item.color : "rgba(255,255,255,0.45)",
                          transition: "left 220ms cubic-bezier(0.2, 0.8, 0.2, 1), background 180ms",
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

      {/* ── Contextual Avatar Edit Sheet — shared primitive ── */}
      <AvatarEditSheet open={showAvatarEdit} onClose={() => setShowAvatarEdit(false)} />
    </div>
  );
}