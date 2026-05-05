import { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  ChevronLeft, Check, Globe, Lock, Smartphone,
  HelpCircle, Mail, MessageCircle, FileText, Shield,
  Eye, EyeOff, MapPin, Fingerprint, Trash2, Download,
  Bluetooth, Watch, ChevronRight, Radio, Users,
  Sparkles, Volume2, RotateCcw, Crown,
} from "lucide-react";
import { toast } from "sonner";
import { hapticLight, hapticWarning, hapticSuccess } from "./haptic-feedback";
import { getNeighborAlertSettings, setNeighborAlertSettings } from "./neighbor-alert-service";
import { hasFeature } from "./subscription-service";
import {
  getAiVoiceScript,
  setAiVoiceScript,
  resetAiVoiceScript,
  type AiVoiceLang,
  type AiVoiceName,
} from "./ai-voice-call-service";
import { unenrollBiometric, checkBiometricAvailability } from "./biometric-gate";
import {
  getBiometricLockEnabled,
  setBiometricLockEnabled,
} from "./biometric-lock-settings";
import { BiometricGateModal } from "./biometric-gate-modal-v2";

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
  const [biometric, setBiometric] = useState<boolean>(() => getBiometricLockEnabled());
  const [biometricEnrollOpen, setBiometricEnrollOpen] = useState(false);
  // FIX 2026-04-23: pre-check biometric availability on mount so we can show
  // an honest "Coming Soon" badge when the device/WebView doesn't support it
  // (instead of the user tapping the toggle, getting a toast, then blaming
  // us for a broken feature). The core issue: WebAuthn's platform
  // authenticator is often unavailable in Huawei/Xiaomi WebViews, and the
  // native Capacitor biometric plugin isn't installed in this build.
  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    checkBiometricAvailability().then(s => {
      if (!cancelled) setBiometricAvailable(s !== "not_available");
    }).catch(() => { if (!cancelled) setBiometricAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  // Toggle wiring:
  //   • Turning ON  → open modal in enrollment mode; only persist the flag
  //     AFTER the user completes enrollment (verified callback). Aborting
  //     leaves the toggle off — no half-state.
  //   • Turning OFF → unenroll on device (clears the credential id) AND
  //     clear the flag. Non-destructive of any session-level unlock.
  const handleBiometricToggle = async () => {
    if (!biometric) {
      // Pre-flight: if the device has no biometric hardware at all, fail fast
      // with an explanatory toast instead of opening a dead-end modal.
      const status = await checkBiometricAvailability();
      if (status === "not_available") {
        hapticWarning();
        toast.error("Biometrics unavailable", { description: "This device doesn't support biometric authentication." });
        return;
      }
      setBiometricEnrollOpen(true);
    } else {
      unenrollBiometric();
      setBiometricLockEnabled(false);
      setBiometric(false);
      hapticLight();
      toast("Biometric lock disabled");
    }
  };

  const handleBiometricEnrolled = () => {
    setBiometricLockEnabled(true);
    setBiometric(true);
    setBiometricEnrollOpen(false);
    hapticSuccess();
    toast.success("Biometric lock enabled");
  };

  // Neighbor Alert — hydrated from localStorage via the service
  const initialNeighbor = getNeighborAlertSettings();
  const [neighborReceive, setNeighborReceive] = useState(initialNeighbor.receive);
  const [neighborBroadcast, setNeighborBroadcast] = useState(initialNeighbor.broadcast);
  const eliteUnlocked = hasFeature("aiVoiceCalls");

  const toggleNeighborReceive = () => {
    const next = !neighborReceive;
    setNeighborReceive(next);
    setNeighborAlertSettings({ receive: next });
    hapticLight();
  };

  const toggleNeighborBroadcast = () => {
    if (!eliteUnlocked) {
      hapticWarning();
      toast("Elite feature", { description: "Broadcasting SOS to nearby neighbors requires the Elite plan." });
      return;
    }
    const next = !neighborBroadcast;
    setNeighborBroadcast(next);
    setNeighborAlertSettings({ broadcast: next });
    hapticLight();
  };

  // FIX 2026-04-23: biometric row adapts to actual device support. When
  // unsupported, show a "Coming Soon" badge and disable the toggle entirely
  // rather than letting the user tap a broken feature.
  const biometricReady = biometricAvailable === true;
  const biometricChecking = biometricAvailable === null;
  const toggles = [
    { id: "location", icon: MapPin, label: "Location History", sub: "Store location data for safety analysis", color: "#00C853", value: locationHistory, onChange: () => setLocationHistory(v => !v) },
    { id: "analytics", icon: Eye, label: "Usage Analytics", sub: "Help us improve with anonymous data", color: "#007AFF", value: analytics, onChange: () => setAnalytics(v => !v) },
    { id: "profile", icon: Shield, label: "Show Profile to Family", sub: "Allow circle members to see your status", color: "#00C8E0", value: showProfile, onChange: () => setShowProfile(v => !v) },
    {
      id: "biometric",
      icon: Fingerprint,
      label: "Biometric Lock",
      sub: biometricChecking
        ? "Checking device support..."
        : biometricReady
          ? "Require face/fingerprint to open app"
          : "Coming soon — this device does not yet support biometric unlock",
      color: biometricReady ? "#AF52DE" : "rgba(175,82,222,0.35)",
      value: biometricReady ? biometric : false,
      onChange: biometricReady
        ? handleBiometricToggle
        : () => {
            hapticWarning();
            toast("Biometric Lock unavailable", {
              description: "Your device or app version doesn't support biometric authentication yet. We're working on a native plugin for Android/iOS.",
            });
          },
      badge: biometricReady ? undefined : (biometricChecking ? undefined : "Coming Soon"),
    },
    { id: "neighbor_receive", icon: Users, label: "Receive Nearby SOS Alerts", sub: "Get notified when a neighbor triggers SOS close to you", color: "#00C8E0", value: neighborReceive, onChange: toggleNeighborReceive },
    { id: "neighbor_broadcast", icon: Radio, label: `Broadcast SOS to Neighbors${eliteUnlocked ? "" : " (Elite)"}`, sub: "Send a coarse-location alert to opted-in neighbors when you trigger SOS", color: "#FF9500", value: neighborBroadcast, onChange: toggleNeighborBroadcast },
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
                  {/* FIX 2026-04-23: dir="ltr" to prevent RTL from mirroring the
                      x-transform (same fix as profile-settings.tsx toggles). */}
                  <div dir="ltr" className="relative shrink-0" style={{
                    width: 44, height: 26, borderRadius: 13,
                    background: t.value ? `${t.color}25` : "rgba(255,255,255,0.06)",
                    border: `1.5px solid ${t.value ? `${t.color}35` : "rgba(255,255,255,0.08)"}`,
                  }}>
                    <motion.div animate={{ x: t.value ? 19 : 3 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-[2px]"
                      style={{ width: 18, height: 18, borderRadius: 9, left: 0, background: t.value ? t.color : "rgba(255,255,255,0.25)", boxShadow: t.value ? `0 2px 6px ${t.color}50` : "0 1px 3px rgba(0,0,0,0.3)" }} />
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
                  /* FIX 2026-04-23: Download My Data now actually exports all
                     sosphere_* localStorage keys as a JSON blob the user can
                     save locally. Previously this was a toast-only ghost.
                     Delete Account still routes to support because a real
                     deletion must hit the server (user profile, evidence,
                     incidents in Supabase) which requires server endpoint. */
                  onClick={async () => {
                    if (a.danger) {
                      // FIX 2026-04-23: real deletion via delete-account edge
                      // function. Requires confirm prompt + valid JWT.
                      const confirmed = typeof window !== "undefined"
                        ? window.confirm("Permanently delete your account?\n\nThis cannot be undone. All incidents, evidence, contacts, and subscription will be wiped.")
                        : false;
                      if (!confirmed) return;
                      hapticWarning();
                      try {
                        // E1.6-PHASE3: lock-free token read.
                        const { getStoredBearerToken } = await import("./api/safe-rpc");
                        const token = getStoredBearerToken();
                        if (!token) {
                          toast.error("Not signed in", { description: "Please sign in first." });
                          return;
                        }
                        const { SUPABASE_CONFIG } = await import("./api/supabase-client");
                        const res = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/delete-account`, {
                          method: "POST",
                          headers: {
                            "Authorization": `Bearer ${token}`,
                            "apikey": SUPABASE_CONFIG.anonKey,
                            "Content-Type": "application/json",
                          },
                        });
                        if (!res.ok) {
                          const txt = await res.text();
                          toast.error("Deletion failed", { description: txt.slice(0, 200) });
                          return;
                        }
                        // Clear all local storage
                        try {
                          for (let i = localStorage.length - 1; i >= 0; i--) {
                            const key = localStorage.key(i);
                            if (key?.startsWith("sosphere_")) localStorage.removeItem(key);
                          }
                        } catch { /* ignore */ }
                        toast.success("Account deleted", { description: "All your data has been removed." });
                        setTimeout(() => { if (typeof window !== "undefined") window.location.reload(); }, 1500);
                      } catch (err) {
                        console.error("[privacy] delete-account error:", err);
                        toast.error("Deletion failed", { description: "Network error. Try again or contact support." });
                      }
                      return;
                    }
                    // Real JSON export of all SOSphere-owned localStorage
                    try {
                      const payload: Record<string, unknown> = {
                        exportedAt: new Date().toISOString(),
                        version: 1,
                        data: {},
                      };
                      const dataBucket = payload.data as Record<string, unknown>;
                      for (let k = 0; k < localStorage.length; k++) {
                        const key = localStorage.key(k);
                        if (!key || !key.startsWith("sosphere_")) continue;
                        try { dataBucket[key] = JSON.parse(localStorage.getItem(key) || "null"); }
                        catch { dataBucket[key] = localStorage.getItem(key); }
                      }
                      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `sosphere-data-${Date.now()}.json`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      URL.revokeObjectURL(url);
                      hapticSuccess();
                      toast.success(a.label, { description: `Exported ${Object.keys(dataBucket).length} keys to JSON file.` });
                    } catch (err) {
                      console.error("[privacy] export failed:", err);
                      toast.error(a.label, { description: "Export failed — browser blocked download." });
                    }
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

      {/* Enrollment modal — opens when user toggles Biometric Lock ON */}
      <BiometricGateModal
        isOpen={biometricEnrollOpen}
        onVerified={handleBiometricEnrolled}
        onCancel={() => setBiometricEnrollOpen(false)}
        title="Enable Biometric Lock"
        description="Register your face or fingerprint to unlock the app"
        userId="sosphere-local"
        userName="SOSphere User"
        allowPinFallback={false}
      />
    </div>
  );
}

// ── Connected Devices Screen ───────────────────────────────────
// FIX 2026-04-23: replaced the 3 hardcoded fake devices (iPhone 14 Pro +
// Apple Watch S9 + iPad Air) with an honest "Coming Soon" screen.
// The backend for device registration / session management doesn't exist
// yet, so we don't pretend it does. When the real multi-device sync
// pipeline lands, this screen will read from Supabase.
export function ConnectedDevicesScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="relative flex flex-col h-full">
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="pt-14 pb-8">
          <ScreenHeader title="Connected Devices" subtitle="Manage your linked devices" onBack={onBack} />

          <div className="px-5 mt-8 flex flex-col items-center text-center">
            <div className="size-20 rounded-[24px] flex items-center justify-center mb-5"
              style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
              <Smartphone className="size-10" style={{ color: "#00C8E0" }} />
            </div>
            <p className="text-white" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Coming Soon
            </p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.6, maxWidth: 300 }}>
              Multi-device sync, smartwatch pairing, and session management will
              be available in an upcoming release. You'll be able to see every
              device signed in to your account and sign them out remotely.
            </p>

            <div className="mt-8 px-4 py-3 w-full max-w-sm"
              style={{ borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
                Currently signed in on this device only.
              </p>
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
              {/* FIX 2026-04-23: real links instead of toast stubs.
                  - Email → mailto: opens the user's email client
                  - Live Chat → wa.me deep link to a support WhatsApp
                  Note: WhatsApp phone number below is a placeholder until
                  real support number is configured. Replace with actual
                  business WhatsApp when available. */}
              {[
                {
                  icon: Mail, label: "Email Support", sub: "support@sosphere.app", color: "#00C8E0",
                  href: "mailto:support@sosphere.app?subject=SOSphere%20Support%20Request",
                },
                {
                  icon: MessageCircle, label: "WhatsApp Support", sub: "Chat with our team", color: "#00C853",
                  href: "https://wa.me/966500000000?text=Hi%2C%20I%20need%20help%20with%20SOSphere",
                },
              ].map(c => (
                <a key={c.label} href={c.href} target="_blank" rel="noopener noreferrer" className="p-4 text-left"
                  onClick={() => { hapticLight(); }}
                  style={{ borderRadius: 16, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", cursor: "pointer", display: "block", textDecoration: "none" }}>
                  <c.icon className="size-5 mb-2.5" style={{ color: c.color }} />
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 2 }}>{c.sub}</p>
                </a>
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
          {/* FIX 2026-04-23: external link to the real Terms page instead
              of a toast stub. Uses https URL so it opens in the device's
              browser (or Capacitor's in-app browser). */}
          <div className="px-5 mt-5">
            <a href="https://sosphere.app/legal/terms" target="_blank" rel="noopener noreferrer" className="w-full p-4 flex items-center gap-3"
              onClick={() => { hapticLight(); }}
              style={{ borderRadius: 16, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", cursor: "pointer", textDecoration: "none" }}>
              <FileText className="size-4" style={{ color: "rgba(255,255,255,0.2)" }} />
              <span style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>Terms & Privacy Policy</span>
              <ChevronRight className="size-4 ml-auto" style={{ color: "rgba(255,255,255,0.1)" }} />
            </a>
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

// ── Elite Features Screen ──────────────────────────────────────
// Houses configuration for Elite-tier-only conveniences. Currently:
//   • AI Voice Call Script — the TwiML <Say> the server reads to
//     emergency contacts. Bilingual, Polly-voice selectable.
//
// Design choices:
//   • Auto-save on blur (or on voice/lang change) — there's no
//     "Save" button, because the data is low-stakes (worst case the
//     user re-opens the screen) and keeping the form hot avoids the
//     "did it save?" uncertainty panic users feel during drills.
//   • Non-Elite users see a locked preview with an upsell CTA.
//   • Token cheatsheet ({name}, {location}, {time}) is inline so
//     users don't have to memorise it.
// ─────────────────────────────────────────────────────────────
const VOICE_OPTIONS: { value: AiVoiceName; label: string; lang: AiVoiceLang }[] = [
  { value: "Polly.Joanna",  label: "Joanna (English US)",   lang: "en" },
  { value: "Polly.Matthew", label: "Matthew (English US)",  lang: "en" },
  { value: "Polly.Amy",     label: "Amy (English UK)",      lang: "en" },
  { value: "Polly.Zeina",   label: "Zeina (Arabic)",        lang: "ar" },
];

export function EliteFeaturesScreen({ onBack }: { onBack: () => void }) {
  const eliteUnlocked = hasFeature("aiVoiceCalls");
  const initial = getAiVoiceScript();
  const [scriptEn, setScriptEn] = useState(initial.en);
  const [scriptAr, setScriptAr] = useState(initial.ar);
  const [lang, setLang] = useState<AiVoiceLang>(initial.lang);
  const [voice, setVoice] = useState<AiVoiceName>(initial.voice);

  const persist = (patch: Parameters<typeof setAiVoiceScript>[0]) => {
    setAiVoiceScript(patch);
    hapticLight();
  };

  const handleReset = () => {
    const defaults = resetAiVoiceScript();
    setScriptEn(defaults.en);
    setScriptAr(defaults.ar);
    setLang(defaults.lang);
    setVoice(defaults.voice);
    hapticSuccess();
    toast.success("Restored default script");
  };

  return (
    <div className="relative flex flex-col h-full">
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="pt-14 pb-8">
          <ScreenHeader
            title="Elite Features"
            subtitle="Personalise your SOS experience"
            onBack={onBack}
          />

          {/* Elite lock notice (Free / Basic users) */}
          {!eliteUnlocked && (
            <div className="px-5 mb-5">
              <div className="p-4 flex items-start gap-3" style={{ borderRadius: 18, background: "rgba(255,215,0,0.04)", border: "1px solid rgba(255,215,0,0.12)" }}>
                <Crown className="size-5 shrink-0 mt-0.5" style={{ color: "#FFD700" }} />
                <div>
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>Elite required</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 3, lineHeight: 1.5 }}>
                    Personalised AI voice scripts are an Elite feature. You can preview below — changes won't be applied to live SOS calls until you upgrade.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Section header */}
          <div className="px-5 mb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles style={{ width: 14, height: 14, color: "#AF52DE" }} />
              <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                AI Voice Call Script
              </p>
            </div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 4, lineHeight: 1.5 }}>
              Spoken to your emergency contacts when the server places a call on your behalf. Tokens
              <code style={{ margin: "0 4px", padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.05)", fontSize: 10 }}>{"{name}"}</code>
              <code style={{ margin: "0 4px", padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.05)", fontSize: 10 }}>{"{location}"}</code>
              <code style={{ margin: "0 4px", padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.05)", fontSize: 10 }}>{"{time}"}</code>
              are filled in at call time.
            </p>
          </div>

          {/* Language + Voice */}
          <div className="px-5 mb-5">
            <div style={{ borderRadius: 18, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", overflow: "hidden" }}>
              {/* Language selector */}
              <div className="px-4 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-3 mb-3">
                  <Globe style={{ width: 14, height: 14, color: "#007AFF" }} />
                  <p style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>Default Language</p>
                </div>
                <div className="flex gap-2">
                  {(["en", "ar"] as const).map(code => (
                    <button
                      key={code}
                      onClick={() => { setLang(code); persist({ lang: code }); }}
                      className="flex-1 py-2 rounded-[10px]"
                      style={{
                        background: lang === code ? "rgba(0,122,255,0.12)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${lang === code ? "rgba(0,122,255,0.3)" : "rgba(255,255,255,0.04)"}`,
                        color: lang === code ? "#007AFF" : "rgba(255,255,255,0.5)",
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                    >
                      {code === "en" ? "English" : "العربية"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice picker */}
              <div className="px-4 py-3.5">
                <div className="flex items-center gap-3 mb-3">
                  <Volume2 style={{ width: 14, height: 14, color: "#AF52DE" }} />
                  <p style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>Voice</p>
                </div>
                <div className="space-y-1.5">
                  {VOICE_OPTIONS.map(v => (
                    <button
                      key={v.value}
                      onClick={() => { setVoice(v.value); persist({ voice: v.value }); }}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-[10px]"
                      style={{
                        background: voice === v.value ? "rgba(175,82,222,0.10)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${voice === v.value ? "rgba(175,82,222,0.25)" : "rgba(255,255,255,0.04)"}`,
                      }}
                    >
                      <span style={{ fontSize: 13, color: voice === v.value ? "#fff" : "rgba(255,255,255,0.55)" }}>
                        {v.label}
                      </span>
                      {voice === v.value && <Check className="size-4" style={{ color: "#AF52DE" }} />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* English template */}
          <div className="px-5 mb-5">
            <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8, paddingLeft: 2 }}>
              English Template
            </p>
            <textarea
              value={scriptEn}
              onChange={e => setScriptEn(e.target.value.slice(0, 600))}
              onBlur={() => persist({ en: scriptEn })}
              rows={5}
              dir="ltr"
              className="w-full p-3 text-white resize-none"
              style={{ borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit", outline: "none" }}
            />
            <p className="mt-1.5 text-right" style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{scriptEn.length} / 600</p>
          </div>

          {/* Arabic template */}
          <div className="px-5 mb-5">
            <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8, paddingLeft: 2 }}>
              Arabic Template
            </p>
            <textarea
              value={scriptAr}
              onChange={e => setScriptAr(e.target.value.slice(0, 600))}
              onBlur={() => persist({ ar: scriptAr })}
              rows={5}
              dir="rtl"
              className="w-full p-3 text-white resize-none"
              style={{ borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 13, lineHeight: 1.7, fontFamily: "inherit", outline: "none" }}
            />
            <p className="mt-1.5 text-right" style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{scriptAr.length} / 600</p>
          </div>

          {/* Reset */}
          <div className="px-5">
            <button
              onClick={handleReset}
              className="w-full flex items-center justify-center gap-2 py-3"
              style={{ borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 500 }}
            >
              <RotateCcw style={{ width: 14, height: 14 }} />
              Reset to defaults
            </button>
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