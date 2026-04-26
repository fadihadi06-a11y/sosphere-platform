import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, Package, MapPin, Heart, Phone, Smartphone,
  Mic, Shield, Share2, Eye, Lock, ChevronRight, Check,
  Wifi, Battery, Signal, Clock, AlertTriangle, Droplets,
  Pill, Activity, QrCode, Copy, MessageSquare, Mail,
  Globe, X, Zap, Download, Users, Radio,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface PacketModule {
  id: string;
  icon: typeof MapPin;
  label: string;
  description: string;
  color: string;
  enabled: boolean;
  proOnly: boolean;
  items: { label: string; value: string; color?: string }[];
}

interface EmergencyPacketProps {
  onBack: () => void;
  userPlan: "free" | "pro" | "employee";
  onUpgrade?: () => void;
  userName?: string;
}

// FIX 2026-04-23: helpers to read REAL user data from localStorage instead of
// hardcoded Saudi demo ("King Fahad Rd, O+, Sarah +966 501 234 567, iPhone 14
// Pro"). These fields show up in the Packet Preview modal and QR payload,
// which are legal/forensic surfaces — fake data there is misleading and
// dangerous (first-responder scans QR → gets wrong blood type or wrong
// location → wrong treatment).
function readReal<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function readRealLocation() {
  const trail = readReal<Array<{ lat: number; lng: number; timestamp: number }>>("sosphere_gps_trail", []);
  const last = trail[trail.length - 1];
  if (last) {
    return {
      lat: last.lat, lng: last.lng,
      coordinates: `${last.lat.toFixed(6)}°N, ${last.lng.toFixed(6)}°E`,
      address: "Location captured — resolve via lat/lng", // no reverse-geocoding on device
      lastUpdated: new Date(last.timestamp).toLocaleTimeString("en-US", { hour12: false }),
      accuracy: "—",
      altitude: "—",
    };
  }
  return {
    lat: 0, lng: 0,
    coordinates: "Not yet captured",
    address: "GPS not acquired yet",
    lastUpdated: "—",
    accuracy: "—",
    altitude: "—",
  };
}

function readRealMedicalId() {
  const data = readReal<{
    bloodType?: string; conditions?: string[]; allergies?: string[];
    medications?: string[]; organDonor?: boolean; notes?: string;
  }>("sosphere_medical_id", {});
  return {
    bloodType: data.bloodType?.trim() || "—",
    conditions: (data.conditions || []).join(", ") || "—",
    allergies: (data.allergies || []).join(", ") || "—",
    medications: (data.medications || []).join(", ") || "—",
    organDonor: data.organDonor ? "Yes" : "No",
    notes: data.notes?.trim() || "—",
  };
}

function readRealContacts() {
  const arr = readReal<Array<{ name: string; phone: string; relation?: string }>>(
    "sosphere_emergency_contacts", []
  );
  return arr.map((c, i) => ({
    priority: i + 1,
    name: c.name || "—",
    phone: c.phone || "—",
    relation: c.relation || "",
  }));
}

// ─── Component ─────────────────────────────────────────────────────────────────
export function EmergencyPacket({ onBack, userPlan, onUpgrade, userName }: EmergencyPacketProps) {
  const isPro = userPlan === "pro" || userPlan === "employee";
  const [showPreview, setShowPreview] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedModule, setExpandedModule] = useState<string | null>("location");
  const [packetReady, setPacketReady] = useState(false);
  // FIX 2026-04-23: persist packet module preferences to localStorage so the
  // SOS handler can READ them when building the emergency payload.
  // Previously these toggles were UI-only — user could turn OFF Medical ID
  // but the server still received it. Now they actually gate the data.
  const [modules, setModules] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("sosphere_packet_modules") || "null");
      if (saved && typeof saved === "object") {
        return {
          location: true, // always on, cannot be disabled
          medical: saved.medical !== false,
          contacts: saved.contacts !== false,
          device: saved.device !== false,
          recording: saved.recording !== false,
          incident: saved.incident !== false,
        };
      }
    } catch { /* ignore and use defaults */ }
    return { location: true, medical: true, contacts: true, device: true, recording: true, incident: true };
  });

  useEffect(() => {
    try { localStorage.setItem("sosphere_packet_modules", JSON.stringify(modules)); }
    catch { /* quota */ }
  }, [modules]);

  // FIX 2026-04-23: compute real data once per render from storage.
  const realLocation = readRealLocation();
  const realMedical = readRealMedicalId();
  const realContacts = readRealContacts();

  useEffect(() => {
    const t = setTimeout(() => setPacketReady(true), 800);
    return () => clearTimeout(t);
  }, []);

  const toggleModule = (id: string) => {
    if (id === "location") return; // always on
    setModules(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const packetModules: PacketModule[] = [
    // FIX 2026-04-23: every module below now reads REAL user data. No more
    // hardcoded Saudi demo that misled first responders who scan the QR.
    {
      id: "location",
      icon: MapPin,
      label: "Live Location",
      description: "GPS coordinates updated every 10s",
      color: "#00C8E0",
      enabled: true,
      proOnly: false,
      items: [
        { label: "Address", value: realLocation.address },
        { label: "Coordinates", value: realLocation.coordinates },
        { label: "Accuracy", value: realLocation.accuracy, color: "#00C853" },
        { label: "Last Updated", value: realLocation.lastUpdated, color: "#00C8E0" },
        { label: "Altitude", value: realLocation.altitude },
      ],
    },
    {
      id: "medical",
      icon: Heart,
      label: "Medical ID",
      description: "Blood type, allergies, medications, conditions",
      color: "#FF2D55",
      enabled: modules.medical,
      proOnly: false,
      items: [
        { label: "Blood Type", value: realMedical.bloodType, color: "#FF2D55" },
        { label: "Conditions", value: realMedical.conditions },
        { label: "Allergies", value: realMedical.allergies, color: "#FF9500" },
        { label: "Medications", value: realMedical.medications },
        { label: "Organ Donor", value: realMedical.organDonor, color: "#00C853" },
        { label: "Emergency Note", value: realMedical.notes },
      ],
    },
    {
      id: "contacts",
      icon: Users,
      label: "Emergency Contacts",
      description: realContacts.length === 0
        ? "No contacts added yet"
        : isPro
          ? `${realContacts.length} contact(s) with call order`
          : `${Math.min(1, realContacts.length)} contact (Free limit)`,
      color: "#00C8E0",
      enabled: modules.contacts,
      proOnly: false,
      items: realContacts.length === 0
        ? [{ label: "Status", value: "Add at least one contact via Home or Profile", color: "#FF9500" }]
        : realContacts.slice(0, isPro ? 10 : 1).map((c, i) => ({
            label: i === 0 ? "#1 Priority" : `#${i + 1}`,
            value: `${c.name}${c.relation ? ` (${c.relation})` : ""} · ${c.phone}`,
            color: i === 0 ? "#00C853" : undefined,
          })),
    },
    {
      id: "device",
      icon: Smartphone,
      label: "Device Info",
      description: "Phone model, battery, network status",
      color: "#8E8E93",
      enabled: modules.device,
      proOnly: true,
      // FIX 2026-04-23: removed fake "iPhone 14 Pro · iOS 19.2 · STC 5G · IMEI…"
      // Real device info requires Capacitor Device plugin which is already
      // installed — but until wired, show honest placeholders.
      items: [
        { label: "Device", value: typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent.slice(0, 60) : "—" },
        { label: "Battery", value: "Captured at SOS trigger", color: "#00C853" },
        { label: "Network", value: typeof navigator !== "undefined" && (navigator as { onLine?: boolean }).onLine ? "Online" : "Offline", color: "#00C853" },
        { label: "App Version", value: "SOSphere (debug build)" },
      ],
    },
    {
      id: "recording",
      icon: Mic,
      label: "Audio Recording",
      description: isPro ? "Up to 5 min continuous recording" : "60s recording (Free limit)",
      color: "#FF2D55",
      enabled: modules.recording,
      proOnly: false,
      items: [
        { label: "Max Duration", value: isPro ? "5 minutes" : "60 seconds", color: isPro ? "#00C853" : "#FF9500" },
        { label: "Format", value: "AAC 128kbps" },
        { label: "Auto-start", value: "On SOS activation", color: "#00C8E0" },
        { label: "Storage", value: "Encrypted local + cloud sync", color: "#00C853" },
      ],
    },
    {
      id: "incident",
      icon: Clock,
      label: "Incident Timeline",
      description: "Real-time event log with timestamps",
      color: "#FF9500",
      enabled: modules.incident,
      proOnly: true,
      items: [
        { label: "Events", value: "All SOS events logged with UTC timestamps" },
        { label: "Integrity", value: "Audit trail recorded", color: "#00C853" },
        { label: "Export", value: "PDF with digital signature", color: "#00C8E0" },
        // B-18 (2026-04-25): admissibility is a courtroom call, not ours.
        { label: "Legal", value: "Structured for legal review (admissibility depends on jurisdiction)" },
      ],
    },
  ];

  const activeModules = packetModules.filter(m => {
    if (m.proOnly && !isPro) return true; // show but locked
    return true;
  });

  const enabledCount = packetModules.filter(m => {
    if (m.proOnly && !isPro) return false;
    return modules[m.id] !== false;
  }).length;

  // FIX 2026-04-23: QR payload reads REAL data. Previously hardcoded
  // Saudi demo data (lat 24.71, blood O+, Penicillin/Peanuts, +966…) —
  // first responders scanning the code got WRONG medical info and WRONG
  // location. That's a life-threatening mistake for an emergency app.
  const qrData = JSON.stringify({
    app: "SOSphere",
    type: "emergency_packet",
    user: userName || "User",
    location: { lat: realLocation.lat, lng: realLocation.lng },
    blood: realMedical.bloodType,
    allergies: realMedical.allergies === "—" ? [] : realMedical.allergies.split(", ").filter(Boolean),
    medications: realMedical.medications === "—" ? [] : realMedical.medications.split(", ").filter(Boolean),
    conditions: realMedical.conditions === "—" ? [] : realMedical.conditions.split(", ").filter(Boolean),
    contact: realContacts[0]?.phone || "",
    ts: new Date().toISOString(),
  });

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      {/* Ambient */}
      <div
        className="absolute top-[-80px] left-1/2 -translate-x-1/2 pointer-events-none"
        style={{ width: 500, height: 350, background: "radial-gradient(ellipse, rgba(0,200,224,0.04) 0%, transparent 60%)" }}
      />

      {/* ── Header ── */}
      <div className="shrink-0 pt-[58px] px-5 pb-2">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="flex items-center gap-1 -ml-1 p-1">
            <ChevronLeft style={{ width: 20, height: 20, color: "#00C8E0" }} />
            <span style={{ fontSize: 15, color: "#00C8E0", fontWeight: 500 }}>Back</span>
          </button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowQR(true)}
            className="p-2 rounded-xl"
            style={{ background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.1)" }}
          >
            <QrCode style={{ width: 16, height: 16, color: "#00C8E0" }} />
          </motion.button>
        </div>

        {/* Title + Status */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
          <div className="flex items-center gap-2.5 mb-1">
            <Package style={{ width: 18, height: 18, color: "#00C8E0" }} />
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.4px" }}>Emergency Packet</h1>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
            Data bundle sent to contacts when SOS activates
          </p>
        </motion.div>

        {/* Status Card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-3.5 mb-3"
          style={{
            borderRadius: 16,
            background: packetReady
              ? "linear-gradient(135deg, rgba(0,200,83,0.04) 0%, rgba(0,200,224,0.02) 100%)"
              : "rgba(255,150,0,0.04)",
            border: `1px solid ${packetReady ? "rgba(0,200,83,0.1)" : "rgba(255,150,0,0.1)"}`,
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <motion.div
                animate={packetReady ? { scale: [1, 1.15, 1] } : {}}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="size-9 rounded-xl flex items-center justify-center"
                style={{
                  background: packetReady ? "rgba(0,200,83,0.08)" : "rgba(255,150,0,0.08)",
                  border: `1px solid ${packetReady ? "rgba(0,200,83,0.15)" : "rgba(255,150,0,0.15)"}`,
                }}
              >
                {packetReady ? (
                  <Shield style={{ width: 16, height: 16, color: "#00C853" }} />
                ) : (
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                    <Radio style={{ width: 16, height: 16, color: "#FF9500" }} />
                  </motion.div>
                )}
              </motion.div>
              <div>
                <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>
                  {packetReady ? "Packet Ready" : "Preparing..."}
                </p>
                {/* FIX 2026-04-23 (v2): the earlier span-level dir="ltr" was
                    being over-ridden by the parent RTL paragraph. Forcing
                    the entire <p> to dir="ltr" + textAlign:left guarantees
                    "4 modules active · Standby" reads correctly regardless
                    of the root language direction. */}
                <p dir="ltr" style={{ fontSize: 11, color: packetReady ? "rgba(0,200,83,0.5)" : "rgba(255,150,0,0.5)", textAlign: "left" }}>
                  {enabledCount} modules active · {packetReady ? "Standby" : "Loading data"}
                </p>
              </div>
            </div>
            <div
              className="px-2.5 py-1"
              style={{
                borderRadius: 8,
                background: packetReady ? "rgba(0,200,83,0.08)" : "rgba(255,150,0,0.08)",
                border: `1px solid ${packetReady ? "rgba(0,200,83,0.12)" : "rgba(255,150,0,0.12)"}`,
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 700, color: packetReady ? "#00C853" : "#FF9500", letterSpacing: "0.5px" }}>
                {packetReady ? "READY" : "LOADING"}
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Modules List ── */}
      <div className="flex-1 overflow-y-auto px-5 pb-44" style={{ scrollbarWidth: "none" }}>
        <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.12)", letterSpacing: "0.6px", marginBottom: 8, textTransform: "uppercase" }}>
          Packet Modules
        </p>

        <div className="space-y-2">
          {activeModules.map((mod, i) => {
            const isLocked = mod.proOnly && !isPro;
            const isEnabled = !isLocked && modules[mod.id] !== false;
            const isExpanded = expandedModule === mod.id && !isLocked;
            const ModIcon = mod.icon;

            return (
              <motion.div
                key={mod.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.04 }}
              >
                <div
                  style={{
                    borderRadius: 16,
                    background: isExpanded ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.012)",
                    border: `1px solid ${
                      isLocked
                        ? "rgba(255,150,0,0.06)"
                        : isExpanded
                        ? `${mod.color}18`
                        : "rgba(255,255,255,0.035)"
                    }`,
                    opacity: isLocked ? 0.6 : 1,
                    overflow: "hidden",
                  }}
                >
                  {/* Module Header */}
                  <button
                    onClick={() => {
                      if (isLocked) return;
                      setExpandedModule(isExpanded ? null : mod.id);
                    }}
                    className="w-full flex items-center gap-3 p-3.5 text-left"
                  >
                    <div
                      className="size-9 rounded-[10px] flex items-center justify-center shrink-0"
                      style={{
                        background: `${mod.color}08`,
                        border: `1px solid ${mod.color}15`,
                      }}
                    >
                      {isLocked ? (
                        <Lock style={{ width: 14, height: 14, color: "#FF9500" }} />
                      ) : (
                        <ModIcon style={{ width: 14, height: 14, color: mod.color }} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>
                          {mod.label}
                        </p>
                        {isLocked && (
                          <span
                            className="px-1.5 py-[1px] shrink-0"
                            style={{ borderRadius: 5, background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)", fontSize: 8, fontWeight: 700, color: "#FF9500", letterSpacing: "0.3px" }}
                          >
                            PRO
                          </span>
                        )}
                      </div>
                      {/* FIX 2026-04-23: dir="ltr" prevents RTL from flipping
                          "1 contact (Free limit)" to "(Free limit) 1 contact". */}
                      <p dir="ltr" className="truncate" style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "left" }}>
                        {mod.description}
                      </p>
                    </div>

                    {/* Toggle / Lock */}
                    {isLocked ? (
                      <ChevronRight style={{ width: 14, height: 14, color: "rgba(255,150,0,0.3)" }} />
                    ) : mod.id === "location" ? (
                      <div className="px-2 py-0.5" style={{ borderRadius: 6, background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.1)" }}>
                        <span style={{ fontSize: 8, fontWeight: 700, color: "#00C853", letterSpacing: "0.3px" }}>ALWAYS ON</span>
                      </div>
                    ) : (
                      // FIX 2026-04-23: missed RTL fix — same pattern as
                      // profile-settings toggles. dir="ltr" forces knob to
                      // render at expected x-position in Arabic layout.
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleModule(mod.id);
                        }}
                        dir="ltr"
                        className="relative"
                        style={{
                          width: 40, height: 22, borderRadius: 11,
                          background: isEnabled ? `${mod.color}20` : "rgba(255,255,255,0.05)",
                          border: `1px solid ${isEnabled ? `${mod.color}30` : "rgba(255,255,255,0.08)"}`,
                          transition: "all 0.2s",
                        }}
                      >
                        <motion.div
                          animate={{ x: isEnabled ? 19 : 2 }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          className="absolute top-[2px] size-[16px] rounded-full"
                          style={{
                            left: 0,
                            background: isEnabled ? mod.color : "rgba(255,255,255,0.15)",
                            boxShadow: isEnabled ? `0 0 6px ${mod.color}40` : "none",
                          }}
                        />
                      </motion.button>
                    )}
                  </button>

                  {/* Expanded Content */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3.5 pb-3.5 space-y-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                          <div className="pt-2.5" />
                          {mod.items.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between py-2 px-3"
                              style={{
                                borderRadius: 10,
                                background: "rgba(255,255,255,0.015)",
                                border: "1px solid rgba(255,255,255,0.025)",
                              }}
                            >
                              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>
                                {item.label}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 600, color: item.color || "rgba(255,255,255,0.5)", maxWidth: "55%", textAlign: "right" }}>
                                {item.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Pro Upsell */}
        {!isPro && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-4"
          >
            <button
              onClick={onUpgrade}
              className="w-full p-4 text-left relative overflow-hidden"
              style={{
                borderRadius: 18,
                background: "linear-gradient(135deg, rgba(0,200,224,0.04) 0%, rgba(255,150,0,0.02) 100%)",
                border: "1px solid rgba(0,200,224,0.08)",
              }}
            >
              <div className="absolute top-0 right-0 w-24 h-24 pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,150,0,0.06), transparent 70%)" }}
              />
              <div className="flex items-center gap-3 relative z-10">
                <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.12)" }}>
                  <Zap style={{ width: 16, height: 16, color: "#FF9500" }} />
                </div>
                <div className="flex-1">
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>
                    Unlock Full Packet
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                    Device info + incident timeline + 5 min recording
                  </p>
                </div>
                <ChevronRight style={{ width: 16, height: 16, color: "rgba(255,150,0,0.3)" }} />
              </div>
            </button>
          </motion.div>
        )}

        {/* Info Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-5 px-3 py-3"
          style={{ borderRadius: 14, background: "rgba(0,200,224,0.02)", border: "1px solid rgba(0,200,224,0.05)" }}
        >
          <div className="flex items-start gap-2.5">
            <Shield style={{ width: 12, height: 12, color: "rgba(0,200,224,0.3)", flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.6 }}>
                Emergency Packet is automatically sent via SMS with a secure link when SOS activates. The link is unguessable, served over HTTPS, and expires after 24 hours.
              </p>
              <p style={{ fontSize: 9, color: "rgba(0,200,224,0.2)", marginTop: 4 }}>
                Secure link · Expires 24h · GDPR-aligned
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Bottom Action Bar ── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 px-5 pb-10 pt-4"
        style={{
          background: "linear-gradient(180deg, transparent 0%, rgba(5,7,14,0.97) 30%)",
        }}
      >
        <div className="flex gap-2.5">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowPreview(true)}
            className="flex-1 flex items-center justify-center gap-2 py-3.5"
            style={{
              borderRadius: 14,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)",
            }}
          >
            <Eye style={{ width: 15, height: 15 }} />
            Preview
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowShareSheet(true)}
            className="flex-1 flex items-center justify-center gap-2 py-3.5"
            style={{
              borderRadius: 14,
              background: "rgba(0,200,224,0.08)",
              border: "1px solid rgba(0,200,224,0.15)",
              fontSize: 13, fontWeight: 600, color: "#00C8E0",
            }}
          >
            <Share2 style={{ width: 15, height: 15 }} />
            Test Share
          </motion.button>
        </div>
      </div>

      {/* ── Preview Modal ── */}
      <AnimatePresence>
        {showPreview && (
          <>
            <motion.div
              key="prev-bg"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)" }}
              onClick={() => setShowPreview(false)}
            />
            <motion.div
              key="prev-modal"
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute bottom-0 left-0 right-0 z-50 px-5 pb-10 pt-5"
              style={{
                borderRadius: "28px 28px 0 0",
                background: "rgba(10,18,32,0.98)",
                backdropFilter: "blur(40px)",
                borderTop: "1px solid rgba(0,200,224,0.12)",
                maxHeight: "75%",
              }}
            >
              <div className="flex justify-center mb-4">
                <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
              </div>

              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-white" style={{ fontSize: 17, fontWeight: 700 }}>Packet Preview</p>
                  <p style={{ fontSize: 11, color: "rgba(0,200,224,0.4)", marginTop: 2 }}>What your contacts will receive</p>
                </div>
                <button onClick={() => setShowPreview(false)}>
                  <X style={{ width: 18, height: 18, color: "rgba(255,255,255,0.3)" }} />
                </button>
              </div>

              <div className="overflow-y-auto pr-1" style={{ maxHeight: 380, scrollbarWidth: "none" }}>
                {/* SMS Preview */}
                <div
                  className="p-3.5 mb-3"
                  style={{ borderRadius: 16, background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.08)" }}
                >
                  <div className="flex items-center gap-2 mb-2.5">
                    <MessageSquare style={{ width: 12, height: 12, color: "#00C8E0" }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(0,200,224,0.5)", letterSpacing: "0.4px" }}>SMS MESSAGE</span>
                  </div>
                  <div
                    className="p-3"
                    style={{ borderRadius: 12, background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.06)" }}
                  >
                    {/* FIX 2026-04-23: preview now reflects the REAL data
                        your contacts would receive. Hardcoded Saudi demo
                        values (King Fahad Rd, O+, Penicillin/Peanuts)
                        were misleading for every user who isn't that demo
                        persona. If a field is missing (user hasn't filled
                        Medical ID yet), we show a dash instead of a lie. */}
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}>
                      🚨 <span style={{ fontWeight: 700, color: "#FF2D55" }}>EMERGENCY ALERT</span> — {userName || "User"} needs help!
                      <br />📍 {realLocation.coordinates === "Not yet captured" ? "Location pending" : realLocation.coordinates}
                      <br />🩸 Blood: {realMedical.bloodType} | Allergies: {realMedical.allergies}
                      <br />🔗 Live: sosphere.app/e/{Date.now().toString(36).slice(-6).toUpperCase()}
                    </p>
                  </div>
                </div>

                {/* Web Link Preview */}
                <div
                  className="p-3.5 mb-3"
                  style={{ borderRadius: 16, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
                >
                  <div className="flex items-center gap-2 mb-2.5">
                    <Globe style={{ width: 12, height: 12, color: "rgba(255,255,255,0.25)" }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.15)", letterSpacing: "0.4px" }}>WEB PAGE PREVIEW</span>
                  </div>
                  <div className="space-y-2">
                    {packetModules
                      .filter(m => modules[m.id] !== false && !(m.proOnly && !isPro))
                      .map(m => {
                        const MIcon = m.icon;
                        return (
                          <div key={m.id} className="flex items-center gap-2.5 py-2 px-3" style={{ borderRadius: 10, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.025)" }}>
                            <MIcon style={{ width: 12, height: 12, color: m.color }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>{m.label}</span>
                            <span style={{ fontSize: 9, color: "rgba(0,200,83,0.4)", marginLeft: "auto" }}>✓ Included</span>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Expiry Notice */}
                <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderRadius: 10, background: "rgba(255,150,0,0.04)", border: "1px solid rgba(255,150,0,0.08)" }}>
                  <Clock style={{ width: 11, height: 11, color: "#FF9500" }} />
                  <span style={{ fontSize: 10, color: "rgba(255,150,0,0.5)" }}>Link expires 24 hours after incident ends</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Share Sheet ── */}
      <AnimatePresence>
        {showShareSheet && (
          <>
            <motion.div
              key="share-bg"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)" }}
              onClick={() => setShowShareSheet(false)}
            />
            <motion.div
              key="share-modal"
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute bottom-0 left-0 right-0 z-50 px-5 pb-10 pt-5"
              style={{
                borderRadius: "28px 28px 0 0",
                background: "rgba(10,18,32,0.98)",
                backdropFilter: "blur(40px)",
                borderTop: "1px solid rgba(0,200,224,0.12)",
              }}
            >
              <div className="flex justify-center mb-4">
                <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
              </div>

              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-white" style={{ fontSize: 17, fontWeight: 700 }}>Test Share</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>Send a test packet to yourself</p>
                </div>
                <button onClick={() => setShowShareSheet(false)}>
                  <X style={{ width: 18, height: 18, color: "rgba(255,255,255,0.3)" }} />
                </button>
              </div>

              {/* Share Options */}
              <div className="space-y-2 mb-5">
                {[
                  { icon: MessageSquare, label: "SMS", detail: "Send test SMS to your phone", color: "#00C853" },
                  { icon: Mail, label: "Email", detail: "Send full report to your email", color: "#00C8E0" },
                  { icon: Globe, label: "WhatsApp", detail: "Share via WhatsApp", color: "#25D366" },
                ].map(opt => {
                  const OptIcon = opt.icon;
                  return (
                    <motion.button
                      key={opt.label}
                      whileTap={{ scale: 0.98 }}
                      className="w-full flex items-center gap-3 p-3.5 text-left"
                      style={{ borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
                    >
                      <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: `${opt.color}10`, border: `1px solid ${opt.color}18` }}>
                        <OptIcon style={{ width: 15, height: 15, color: opt.color }} />
                      </div>
                      <div className="flex-1">
                        <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</p>
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{opt.detail}</p>
                      </div>
                      <ChevronRight style={{ width: 14, height: 14, color: "rgba(255,255,255,0.1)" }} />
                    </motion.button>
                  );
                })}
              </div>

              {/* Copy Link */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleCopy}
                className="w-full flex items-center justify-center gap-2 py-3"
                style={{
                  borderRadius: 14,
                  background: copied ? "rgba(0,200,83,0.06)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${copied ? "rgba(0,200,83,0.12)" : "rgba(255,255,255,0.05)"}`,
                  fontSize: 12, fontWeight: 600,
                  color: copied ? "#00C853" : "rgba(255,255,255,0.25)",
                }}
              >
                {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
                {copied ? "Link Copied!" : "Copy Packet Link"}
              </motion.button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── QR Modal ── */}
      <AnimatePresence>
        {showQR && (
          <>
            <motion.div
              key="qr-bg"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(16px)" }}
              onClick={() => setShowQR(false)}
            />
            <motion.div
              key="qr-modal"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="absolute z-50 inset-x-4 flex flex-col items-center"
              /* FIX 2026-04-23: the modal previously used fixed left:50%
                 transform + no max-width, which clipped on narrow phones
                 (QR half visible). Now uses inset-x-4 for horizontal padding
                 and max-width so content always fits. Added explicit close
                 button in top-right corner + keeps the lower Close button. */
              style={{ top: "50%", transform: "translateY(-50%)", maxWidth: 360, marginLeft: "auto", marginRight: "auto" }}
            >
              <div
                className="p-6 flex flex-col items-center w-full relative"
                style={{
                  borderRadius: 28,
                  background: "rgba(10,18,32,0.98)",
                  border: "1px solid rgba(0,200,224,0.12)",
                  backdropFilter: "blur(40px)",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                }}
              >
                {/* FIX 2026-04-23: explicit X close button in top-right */}
                <button
                  onClick={() => setShowQR(false)}
                  aria-label="Close"
                  className="absolute top-3 right-3"
                  style={{
                    width: 32, height: 32, borderRadius: 16,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "rgba(255,255,255,0.5)", fontSize: 16, fontWeight: 700,
                    cursor: "pointer", padding: 0,
                  }}
                >
                  ×
                </button>
                <p className="text-white mb-1" style={{ fontSize: 16, fontWeight: 700 }}>Emergency QR</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginBottom: 16 }}>
                  Scan for instant packet access
                </p>
                <div
                  className="p-4 mb-4"
                  style={{ borderRadius: 16, background: "#fff" }}
                >
                  <QRCodeSVG
                    value={qrData}
                    size={180}
                    bgColor="#ffffff"
                    fgColor="#05070E"
                    level="M"
                  />
                </div>
                <p style={{ fontSize: 9, color: "rgba(0,200,224,0.3)", textAlign: "center", lineHeight: 1.5 }}>
                  First responders can scan this code
                  <br />to access your emergency information
                </p>
                <button
                  onClick={() => setShowQR(false)}
                  className="mt-4 px-8 py-2.5"
                  style={{
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)",
                  }}
                >
                  Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}