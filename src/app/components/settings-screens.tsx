import { useState } from "react";
import { motion } from "motion/react";
import {
  ChevronLeft, Check, Globe, Lock, Smartphone,
  HelpCircle, Mail, MessageCircle, FileText, Shield,
  Eye, EyeOff, MapPin, Fingerprint, Trash2, Download,
  Bluetooth, Watch, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { hapticLight, hapticWarning, hapticSuccess } from "./haptic-feedback";

// ── Language Screen ────────────────────────────────────────────
const LANGUAGES = [
  { code: "en", name: "English", native: "English", flag: "🇺🇸" },
  { code: "ar", name: "Arabic", native: "العربية", flag: "🇸🇦" },
  { code: "fr", name: "French", native: "Français", flag: "🇫🇷" },
  { code: "es", name: "Spanish", native: "Español", flag: "🇪🇸" },
  { code: "de", name: "German", native: "Deutsch", flag: "🇩🇪" },
  { code: "tr", name: "Turkish", native: "Türkçe", flag: "🇹🇷" },
  { code: "ur", name: "Urdu", native: "اردو", flag: "🇵🇰" },
  { code: "hi", name: "Hindi", native: "हिन्दी", flag: "🇮🇳" },
  { code: "zh", name: "Chinese", native: "中文", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", native: "日本語", flag: "🇯🇵" },
];

export function LanguageScreen({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState("en");

  return (
    <div className="relative flex flex-col h-full">
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="pt-14 pb-8">
          <ScreenHeader title="Language" subtitle="Choose your preferred language" onBack={onBack} />

          <div className="px-5">
            <div style={{ borderRadius: 18, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", overflow: "hidden" }}>
              {LANGUAGES.map((lang, i) => (
                <button
                  key={lang.code}
                  onClick={() => setSelected(lang.code)}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left"
                  style={{ borderBottom: i < LANGUAGES.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}
                >
                  <span style={{ fontSize: 22 }}>{lang.flag}</span>
                  <div className="flex-1">
                    <p style={{ fontSize: 14, fontWeight: 500, color: selected === lang.code ? "#fff" : "rgba(255,255,255,0.5)" }}>{lang.name}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.15)", marginTop: 1 }}>{lang.native}</p>
                  </div>
                  {selected === lang.code && (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                      <Check className="size-4" style={{ color: "#00C8E0" }} />
                    </motion.div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Privacy Screen ─────────────────────────────────────────────
export function PrivacyScreen({ onBack }: { onBack: () => void }) {
  const [locationHistory, setLocationHistory] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const [showProfile, setShowProfile] = useState(true);
  const [biometric, setBiometric] = useState(false);

  const toggles = [
    { id: "location", icon: MapPin, label: "Location History", sub: "Store location data for safety analysis", color: "#00C853", value: locationHistory, onChange: () => setLocationHistory(v => !v) },
    { id: "analytics", icon: Eye, label: "Usage Analytics", sub: "Help us improve with anonymous data", color: "#007AFF", value: analytics, onChange: () => setAnalytics(v => !v) },
    { id: "profile", icon: Shield, label: "Show Profile to Family", sub: "Allow circle members to see your status", color: "#00C8E0", value: showProfile, onChange: () => setShowProfile(v => !v) },
    { id: "biometric", icon: Fingerprint, label: "Biometric Lock", sub: "Require face/fingerprint to open app", color: "#AF52DE", value: biometric, onChange: () => setBiometric(v => !v) },
  ];

  const actions = [
    { icon: Download, label: "Download My Data", sub: "Export all your data as JSON", color: "#00C8E0" },
    { icon: Trash2, label: "Delete Account", sub: "Permanently remove all data", color: "#FF2D55", danger: true },
  ];

  return (
    <div className="relative flex flex-col h-full">
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="pt-14 pb-8">
          <ScreenHeader title="Privacy & Security" subtitle="Control your data and access" onBack={onBack} />

          {/* Toggles */}
          <div className="px-5 mb-5">
            <div style={{ borderRadius: 18, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", overflow: "hidden" }}>
              {toggles.map((t, i) => (
                <button key={t.id} onClick={t.onChange}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  style={{ borderBottom: i < toggles.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <div className="size-8 rounded-[10px] flex items-center justify-center shrink-0"
                    style={{ background: `${t.color}10`, border: `1px solid ${t.color}18` }}>
                    <t.icon style={{ width: 14, height: 14, color: t.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>{t.label}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.15)", marginTop: 1 }}>{t.sub}</p>
                  </div>
                  <div className="relative shrink-0" style={{
                    width: 44, height: 26, borderRadius: 13,
                    background: t.value ? `${t.color}25` : "rgba(255,255,255,0.06)",
                    border: `1.5px solid ${t.value ? `${t.color}35` : "rgba(255,255,255,0.08)"}`,
                  }}>
                    <motion.div animate={{ x: t.value ? 19 : 3 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-[2px]"
                      style={{ width: 18, height: 18, borderRadius: 9, background: t.value ? t.color : "rgba(255,255,255,0.25)" }} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Data Actions */}
          <div className="px-5">
            <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.12)", letterSpacing: "0.5px", marginBottom: 8, paddingLeft: 2, textTransform: "uppercase" }}>
              Data Management
            </p>
            <div style={{ borderRadius: 18, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", overflow: "hidden" }}>
              {actions.map((a, i) => (
                <button key={a.label} className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  onClick={() => {
                    if (a.danger) { hapticWarning(); toast.error(a.label, { description: "This action requires confirmation. Please contact support to proceed." }); }
                    else { hapticSuccess(); toast.success(a.label, { description: "Your data export is being prepared. You'll receive a download link shortly." }); }
                  }}
                  style={{ borderBottom: i < actions.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", cursor: "pointer" }}>
                  <div className="size-8 rounded-[10px] flex items-center justify-center shrink-0"
                    style={{ background: `${a.color}10` }}>
                    <a.icon style={{ width: 14, height: 14, color: a.color }} />
                  </div>
                  <div className="flex-1">
                    <p style={{ fontSize: 14, fontWeight: 500, color: a.danger ? "#FF2D55" : "rgba(255,255,255,0.7)" }}>{a.label}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.15)", marginTop: 1 }}>{a.sub}</p>
                  </div>
                  <ChevronRight style={{ width: 16, height: 16, color: "rgba(255,255,255,0.1)" }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Connected Devices Screen ───────────────────────────────────
export function ConnectedDevicesScreen({ onBack }: { onBack: () => void }) {
  const devices = [
    { id: "1", name: "iPhone 14 Pro", type: "phone", status: "current", lastSeen: "Now", os: "iOS 18.2" },
    { id: "2", name: "Apple Watch S9", type: "watch", status: "connected", lastSeen: "Connected", os: "watchOS 11" },
    { id: "3", name: "iPad Air", type: "phone", status: "inactive", lastSeen: "3 days ago", os: "iPadOS 18" },
  ];

  return (
    <div className="relative flex flex-col h-full">
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="pt-14 pb-8">
          <ScreenHeader title="Connected Devices" subtitle="Manage your linked devices" onBack={onBack} />

          <div className="px-5 space-y-2.5">
            {devices.map((d, i) => (
              <motion.div key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="p-4" style={{ borderRadius: 18, background: "rgba(255,255,255,0.02)", border: d.status === "current" ? "1px solid rgba(0,200,224,0.12)" : "1px solid rgba(255,255,255,0.04)" }}>
                <div className="flex items-center gap-3.5">
                  <div className="size-12 rounded-[14px] flex items-center justify-center"
                    style={{
                      background: d.type === "watch" ? "rgba(175,82,222,0.08)" : "rgba(0,200,224,0.06)",
                      border: d.type === "watch" ? "1px solid rgba(175,82,222,0.15)" : "1px solid rgba(0,200,224,0.1)",
                    }}>
                    {d.type === "watch"
                      ? <Watch className="size-5" style={{ color: "#AF52DE" }} />
                      : <Smartphone className="size-5" style={{ color: "#00C8E0" }} />
                    }
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</p>
                      {d.status === "current" && (
                        <span className="px-1.5 py-0.5" style={{ borderRadius: 5, background: "rgba(0,200,224,0.1)", fontSize: 8, fontWeight: 700, color: "#00C8E0" }}>THIS DEVICE</span>
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>{d.os} • {d.lastSeen}</p>
                  </div>
                  <div className="size-2.5 rounded-full"
                    style={{ background: d.status === "inactive" ? "rgba(255,255,255,0.1)" : "#00C853", boxShadow: d.status !== "inactive" ? "0 0 6px rgba(0,200,83,0.4)" : "none" }} />
                </div>
              </motion.div>
            ))}
          </div>

          {/* Smartwatch note */}
          <div className="px-5 mt-5">
            <div className="p-4" style={{ borderRadius: 16, background: "rgba(175,82,222,0.04)", border: "1px solid rgba(175,82,222,0.08)" }}>
              <div className="flex items-start gap-3">
                <Watch className="size-5 shrink-0 mt-0.5" style={{ color: "#AF52DE" }} />
                <div>
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>Smartwatch Integration</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 3, lineHeight: 1.5 }}>
                    Native smartwatch app is coming soon. You'll be able to trigger SOS and share location directly from your wrist.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Help & Support Screen ──────────────────────────────────────
export function HelpScreen({ onBack }: { onBack: () => void }) {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const faqs = [
    { q: "How does the SOS button work?", a: "Hold the SOS button for 3 seconds or shake your phone 3 times. Your emergency contacts will be called sequentially every 20 seconds, and an SMS with your location is sent to whoever answers." },
    { q: "What is the Check-in Timer?", a: "It's a Dead Man's Switch. Set a duration, and if you don't respond before the timer ends, SOS is automatically triggered. You can extend it by 30 minutes at any time." },
    { q: "How many emergency contacts can I add?", a: "Free plan: 1 contact. Pro plan: up to 4 contacts. Company plan: up to 4 contacts (managed by your organization)." },
    { q: "Is my location data private?", a: "Yes. Your location is only shared with your Family Circle members and emergency contacts during an SOS event. We never sell or share your data." },
    { q: "Can I use SOSphere without internet?", a: "SOS calls and SMS work without internet. However, live location sharing and map features require a data connection." },
  ];

  return (
    <div className="relative flex flex-col h-full">
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="pt-14 pb-8">
          <ScreenHeader title="Help & Support" subtitle="Get help with SOSphere" onBack={onBack} />

          {/* Contact options */}
          <div className="px-5 mb-5">
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { icon: Mail, label: "Email Support", sub: "support@sosphere.app", color: "#00C8E0" },
                { icon: MessageCircle, label: "Live Chat", sub: "Available 24/7", color: "#00C853" },
              ].map(c => (
                <button key={c.label} className="p-4 text-left"
                  onClick={() => { hapticLight(); toast.success(c.label, { description: c.label === "Email Support" ? "Opening email client — support@sosphere.app" : "Connecting to live chat agent..." }); }}
                  style={{ borderRadius: 16, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}>
                  <c.icon className="size-5 mb-2.5" style={{ color: c.color }} />
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 2 }}>{c.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* FAQs */}
          <div className="px-5">
            <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.12)", letterSpacing: "0.5px", marginBottom: 8, paddingLeft: 2, textTransform: "uppercase" }}>
              Frequently Asked Questions
            </p>
            <div style={{ borderRadius: 18, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", overflow: "hidden" }}>
              {faqs.map((faq, i) => (
                <button key={i} onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                  className="w-full text-left px-4 py-3.5"
                  style={{ borderBottom: i < faqs.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <div className="flex items-start gap-3">
                    <HelpCircle className="size-4 shrink-0 mt-0.5" style={{ color: "rgba(0,200,224,0.4)" }} />
                    <div className="flex-1">
                      <p style={{ fontSize: 13, fontWeight: 500, color: expandedFaq === i ? "#fff" : "rgba(255,255,255,0.5)" }}>{faq.q}</p>
                      {expandedFaq === i && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", marginTop: 8, lineHeight: 1.6 }}
                        >
                          {faq.a}
                        </motion.p>
                      )}
                    </div>
                    <ChevronRight className="size-4 shrink-0 transition-transform duration-300"
                      style={{ color: "rgba(255,255,255,0.1)", transform: expandedFaq === i ? "rotate(90deg)" : "none" }} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Terms */}
          <div className="px-5 mt-5">
            <button className="w-full p-4 flex items-center gap-3"
              onClick={() => { hapticLight(); toast("Terms & Privacy", { description: "Opening Terms of Service & Privacy Policy..." }); }}
              style={{ borderRadius: 16, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}>
              <FileText className="size-4" style={{ color: "rgba(255,255,255,0.2)" }} />
              <span style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>Terms & Privacy Policy</span>
              <ChevronRight className="size-4 ml-auto" style={{ color: "rgba(255,255,255,0.1)" }} />
            </button>
          </div>

          {/* Version */}
          <div className="text-center mt-6">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Shield style={{ width: 11, height: 11, color: "rgba(0,200,224,0.2)" }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.08)" }}>SOSphere</span>
            </div>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.06)" }}>Version 1.0.0 • Build 2026.03</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared Header Component ────────────────────────────────────
function ScreenHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 px-5 mb-6">
      <button onClick={onBack} className="size-9 rounded-[12px] flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <ChevronLeft className="size-[18px]" style={{ color: "rgba(255,255,255,0.5)" }} />
      </button>
      <div>
        <h1 className="text-white" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>{subtitle}</p>}
      </div>
    </div>
  );
}