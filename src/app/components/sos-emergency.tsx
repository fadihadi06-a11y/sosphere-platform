import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Phone, PhoneMissed, MapPin, Mic, MicOff,
  Shield, X, Clock, MessageSquare,
  AlertTriangle, CheckCircle, RefreshCw, FileText,
  ChevronRight, Heart, PhoneCall, Video,
  PhoneOff, Building2, Camera, Send, ImageIcon, Users,
} from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { useLang } from "./useLang";
import { useT } from "./dashboard-i18n";
import { emitSyncEvent, autoBroadcastSOS, emitCallSignal, onCallSignal, clearCallSignal, saveEmployeeSync, getBuddyFor } from "./shared-store";
import { toast } from "sonner";
import { voiceCallEngine, type VoiceCallInfo } from "./voice-call-engine";
import { storeEvidence, attachEvidenceManifest } from "./evidence-store";
import { computeEvidenceManifest, isHashingAvailable } from "./evidence-hash";
import { triggerOfflineSOS } from "./offline-sync";
// FIX FATAL-1: Import real GPS + battery from tracker (was hardcoded before)
import { getLastKnownPosition, getBatteryLevel, activateEmergencyTracking, deactivateEmergencyTracking } from "./offline-gps-tracker";
import { trackEventSync } from "./smart-timeline-tracker";
const reportError = (..._args: any[]) => {};
import { getSubscription, hasFeature, getCallDurationSec, getRecordingMaxSec, getMaxPhotos, getRecordingMode, type SubscriptionTier, type RecordingMode } from "./subscription-service";
import { isDuressPin, isDuressFeatureAvailable } from "./duress-service";
// ── Server-side SOS trigger (Path B — parallel to local dialer) ──
import {
  triggerServerSOS, endServerSOS,
  startWatchdog, reportWatchdogEvent, stopWatchdog,
  getServerTriggerResult, type ServerTriggerResult,
} from "./sos-server-trigger";

// ─── Haptic Feedback (vibration pattern during active SOS) ───────────────────
let hapticIntervalId: ReturnType<typeof setInterval> | null = null;
function startHapticFeedback() {
  stopHapticFeedback();
  // Immediate confirmation pulse
  try { navigator.vibrate?.([100, 50, 100]); } catch {}
  // Repeat every 30 seconds: 2 short pulses to confirm data is being sent
  hapticIntervalId = setInterval(() => {
    try { navigator.vibrate?.([80, 60, 80]); } catch {}
  }, 30000);
}
function stopHapticFeedback() {
  if (hapticIntervalId) { clearInterval(hapticIntervalId); hapticIntervalId = null; }
  try { navigator.vibrate?.(0); } catch {} // Cancel any ongoing vibration
}

// ─── SMS with Tracking Link (Free tier — sends web-viewer link to non-app contacts) ──
async function sendSOSTrackingLink(contactPhone: string, userName: string, lat: number, lng: number) {
  const trackingUrl = `https://sosphere.co/track?lat=${lat}&lng=${lng}&name=${encodeURIComponent(userName)}&t=${Date.now()}`;
  const message = `🚨 SOS from ${userName}! Live location: ${trackingUrl}`;
  try {
    // Try native SMS via Capacitor
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      // Use SMS URI scheme
      window.location.href = `sms:${contactPhone.replace(/[\s\-()]/g, "")}?body=${encodeURIComponent(message)}`;
      return true;
    }
  } catch {}
  console.log("[SOS] SMS tracking link would be sent:", message);
  return false;
}

// ─── Direct Call (bypasses OS app chooser) ───────────────────────────────────
async function directCall(phone: string): Promise<boolean> {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  if (!cleaned) return false;

  // Method 1: Native Java bridge — ACTION_CALL directly to phone dialer (NO chooser)
  try {
    const native = (window as any).SOSphereNative;
    if (native?.directCall) {
      const ok = native.directCall(cleaned);
      if (ok) {
        console.log("[SOS] directCall success via SOSphereNative:", cleaned);
        return true;
      }
    }
  } catch (err) {
    console.warn("[SOS] SOSphereNative.directCall failed:", err);
  }

  // Method 2: capacitor-call-number plugin (backup)
  try {
    const { CallNumber } = await import("capacitor-call-number");
    await CallNumber.call({ number: cleaned, bypassAppChooser: true });
    console.log("[SOS] directCall success via CallNumber plugin:", cleaned);
    return true;
  } catch (err) {
    console.warn("[SOS] CallNumber plugin failed:", err);
  }

  // Method 3: Web browser fallback — ONLY used when NOT running inside the
  // Capacitor native shell. The tel: URI scheme on Android always triggers
  // the app chooser (WhatsApp / Contacts / Truecaller / etc.), which is
  // exactly what we are trying to avoid. Inside the native app the two
  // methods above are authoritative — if they both fail, we surface the
  // failure to the caller rather than dump to the chooser.
  const isNativeShell =
    typeof (window as any).Capacitor !== "undefined" &&
    (window as any).Capacitor?.isNativePlatform?.() === true;

  if (isNativeShell) {
    console.error("[SOS] directCall: native paths exhausted — refusing tel: fallback to avoid app chooser");
    return false;
  }

  try {
    window.location.href = `tel:${cleaned}`;
    console.log("[SOS] directCall fallback tel: (web only):", cleaned);
    return true;
  } catch {
    return false;
  }
}

// ─── Work Hours Check ────────────────────────────────────────────────────────
// Returns true if current local time falls within office hours (Sun-Thu 8:00-17:00 for Arabic region, Mon-Fri otherwise)
function isWithinWorkHours(): boolean {
  try {
    const profile = localStorage.getItem("sosphere_employee_profile");
    if (profile) {
      const p = JSON.parse(profile);
      if (p.workStartHour !== undefined && p.workEndHour !== undefined) {
        const now = new Date();
        const hour = now.getHours();
        const day = now.getDay(); // 0=Sun, 6=Sat
        const workDays = p.workDays || [1, 2, 3, 4, 5]; // default Mon-Fri
        return workDays.includes(day) && hour >= p.workStartHour && hour < p.workEndHour;
      }
    }
  } catch { /* ignore */ }
  // Default: Mon-Fri 8:00-17:00
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 17;
}

// ─── Subscription-aware contact list ─────────────────────────────────────────
function getSubscriptionContacts(allContacts: ERContact[], isPremium: boolean): ERContact[] {
  if (isPremium) return allContacts; // Paid: all contacts
  return allContacts.slice(0, 1);    // Free: only first (primary) contact
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Phase =
  | "starting" | "calling" | "no_answer" | "pausing"
  | "answered" | "recording" | "documenting" | "monitoring" | "ended";

type ContactStatus = "pending" | "calling" | "no_answer" | "answered";

interface ERContact {
  id: number; name: string; relation: string;
  phone: string; avatar: string; status: ContactStatus;
}

export interface ERREvent {
  id: string; ts: Date;
  type: "sos_start" | "call_out" | "no_answer" | "answered" | "sms_sent"
    | "recording_start" | "recording_end" | "dms_check" | "dms_dismissed"
    | "dms_confirmed" | "pause_start" | "pause_end" | "location_share" | "sos_end";
  title: string; detail?: string; color: string;
}

export interface IncidentRecord {
  id: string; startTime: Date; endTime?: Date;
  triggerMethod: "hold" | "shake" | "volume";
  location: { lat: number; lng: number; accuracy: number; address: string };
  contacts: ERContact[]; events: ERREvent[];
  cyclesCompleted: number; recordingSeconds: number; isPremium: boolean;
  /** Photos captured during documenting phase */
  photos: string[];
  /** Worker's comment describing the incident */
  comment: string;
  /** Evidence vault entry ID (links to Evidence Pipeline) */
  evidenceId?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
// ── SOS Timing Constants — read from subscription tier ─────────
// Free=30s | Basic=60s | Elite=300s (5 min) per contact
const CALL_SEC      = getCallDurationSec();
const PAUSE_SEC     = 60;   // 60 seconds pause between retry cycles
// Cap auto-redial: after MAX_CYCLES passes through the full contact list,
// stop re-dialing and enter monitoring (server keeps the chain alive).
// This prevents the "app keeps calling forever" problem when no one answers.
const MAX_CYCLES    = 2;
// Free=30s | Basic=60s | Elite=90s recording
const REC_MAX       = getRecordingMaxSec();
// Max photos: Free=1 | Basic=6 | Elite=unlimited
const PHOTO_MAX     = getMaxPhotos();
const DMS_FIRST_SEC = 10;
const DMS_GAP_SEC   = 10;
// REMOVED: ANSWER_CYCLE / ANSWER_AT — was hardcoded simulation.
// Real answer detection is now handled via:
//   1. tel: URI opens native dialer (Capacitor)
//   2. User presses "Connected" button when someone answers
//   3. Auto-timeout after CALL_SEC if no confirmation

// Default avatar — used when caller doesn't provide one
const DEFAULT_AVATAR = "https://images.unsplash.com/photo-1701463387028-3947648f1337?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjBtYW4lMjBhdmF0YXIlMjBkYXJrJTIwcG9ydHJhaXR8ZW58MXx8fHwxNzcyODc0MTc5fDA&ixlib=rb-4.1.0&q=80&w=400";

// FIX 8: ERR_ID was module-level — all SOS sessions shared the same incident ID.
// Now generated per-call to ensure each SOS session gets a unique ID.
function generateErrId(): string {
  const suffix = crypto?.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase() : Date.now().toString(16).slice(-4).toUpperCase();
  return `ERR-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-5)}-${suffix}`;
}

// ── Session-based SOS rate history (not persisted across restarts) ──
// SUPABASE_MIGRATION_POINT: sos_rate_history → supabase.from('sos_events').select().eq('employee_id', userId).gte('created_at', oneHourAgo)
let sosRateHistory: number[] = [];

// ── Battery critical emit throttle (5min between emits to prevent Supabase/Twilio spam) ──
// SUPABASE_MIGRATION_POINT: battery_critical_throttle → server-side debounce on notification triggers
let lastBatteryCriticalEmit = 0;
const BATTERY_CRITICAL_COOLDOWN_MS = 300000; // 5 minutes

/**
 * Emergency contacts are loaded from localStorage (set during employee onboarding).
 * If no contacts are saved, we show a setup prompt instead of fake numbers.
 *
 * TODO: Migrate to Supabase:
 *   const { data } = await supabase.from('emergency_contacts')
 *     .select('*').eq('employee_id', userId).order('priority', { ascending: true })
 */
const EMPTY_CONTACTS: ERContact[] = [];

// Admin contact — loaded from company profile in localStorage
function getAdminContact(): ERContact | null {
  try {
    const profile = localStorage.getItem("sosphere_employee_profile");
    if (profile) {
      const p = JSON.parse(profile);
      if (p.adminPhone && p.adminName) {
        return {
          id: 0, name: p.adminName, relation: "Company Admin",
          phone: p.adminPhone, status: "pending",
          avatar: p.adminAvatar || "",
        };
      }
    }
  } catch { /* fallback to null */ }
  return null;
}

/**
 * Load emergency contacts from localStorage, falling back to INIT_CONTACTS.
 * SUPABASE_MIGRATION_POINT: getEmergencyContacts
 * Replace localStorage read with:
 *   const { data } = await supabase.from('emergency_contacts')
 *     .select('*').eq('employee_id', userId).order('priority')
 */
function getEmergencyContacts(): ERContact[] {
  try {
    const stored = localStorage.getItem("sosphere_emergency_contacts");
    if (stored) {
      const parsed = JSON.parse(stored) as ERContact[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(c => ({ ...c, status: "pending" as ContactStatus }));
      }
    }
  } catch (e) {
    console.warn("[SOS] Failed to read stored contacts:", e);
  }
  // No fallback to fake contacts — return empty, UI will prompt user to add contacts
  return EMPTY_CONTACTS.map(c => ({ ...c }));
}

/** Check if user has set up emergency contacts */
function hasEmergencyContacts(): boolean {
  try {
    const stored = localStorage.getItem("sosphere_emergency_contacts");
    if (stored) {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) && parsed.length > 0;
    }
  } catch { /* ignore */ }
  return false;
}

/** Build contacts list based on user mode and subscription tier */
function getContactsForMode(mode: "employee" | "individual", isPremium = false): ERContact[] {
  const baseContacts = getEmergencyContacts();
  if (mode === "employee") {
    // During work hours: admin is notified first via CallingAdminView.
    // Outside work hours: skip admin, go straight to personal contacts.
    // Return subscription-aware list of personal contacts.
    return getSubscriptionContacts(baseContacts.slice(0, 3), isPremium);
  }
  // Individual mode: subscription-aware
  return getSubscriptionContacts(baseContacts, isPremium);
}

/** Get admin contact from company profile — returns null if not configured */
function getAdminForEmployee(): ERContact | null {
  return getAdminContact();
}

// ─── Glowing Circle Component ─────────────────────────────────────────────────
interface GlowCircleProps {
  phase: Phase;
  currentContact: ERContact | null;
  answeredContact: ERContact | null;
  callRemaining: number;
  pauseRemaining: number;
  recordingSec: number;
  isRecording: boolean;
  userAvatar?: string;
  userName: string;
}

function GlowCircle({
  phase, currentContact, answeredContact,
  callRemaining, pauseRemaining, recordingSec, isRecording,
  userAvatar, userName,
}: GlowCircleProps) {
  const { isAr, lang } = useLang();
  const t = useT(lang);
  const isConnected = ["answered", "recording", "documenting", "monitoring"].includes(phase);
  const isCalling   = phase === "calling";
  const isPausing   = phase === "pausing";

  const glowColor =
    isConnected  ? "#00C853" :
    isCalling    ? "#00C8E0" :
    isPausing    ? "#FF9500" : "#FF2D55";

  const displayContact =
    isConnected  ? answeredContact  :
    isCalling    ? currentContact   : null;

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="flex flex-col items-center">
      {/* Outer ambient glow — CSS only */}
      <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>

        {/* === GLOW LAYERS === */}
        <motion.div
          animate={{ opacity: [0.35, 0.55, 0.35], scale: [1, 1.04, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${glowColor}22 0%, ${glowColor}08 50%, transparent 75%)`,
            transition: "background 1.2s ease",
          }}
        />
        <motion.div
          animate={{ scale: [1, 1.18, 1], opacity: [0.2, 0, 0.2] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 190, height: 190,
            border: `1.5px solid ${glowColor}50`,
            boxShadow: `0 0 24px ${glowColor}30`,
            transition: "border-color 1.2s, box-shadow 1.2s",
          }}
        />
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: 0.6 }}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 170, height: 170,
            border: `1px solid ${glowColor}35`,
            transition: "border-color 1.2s",
          }}
        />

        {/* === RECORDING PROGRESS ARC === */}
        {isRecording && (
          <svg className="absolute" width="160" height="160" viewBox="0 0 160 160" style={{ transform: "rotate(-90deg)", zIndex: 5 }}>
            <circle cx="80" cy="80" r="74" fill="none" stroke="rgba(255,45,85,0.1)" strokeWidth="3" />
            <circle cx="80" cy="80" r="74" fill="none"
              stroke="#FF2D55" strokeWidth="3" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 74}
              strokeDashoffset={2 * Math.PI * 74 * (1 - recordingSec / REC_MAX)}
              style={{ transition: "stroke-dashoffset 1s linear", filter: "drop-shadow(0 0 6px #FF2D55)" }}
            />
          </svg>
        )}

        {/* === MAIN CIRCLE === */}
        <div
          className="relative overflow-hidden"
          style={{
            width: 152, height: 152,
            borderRadius: "50%",
            boxShadow: `
              0 0 0 1.5px ${glowColor}35,
              0 0 12px ${glowColor}40,
              0 0 28px ${glowColor}25,
              0 0 52px ${glowColor}12,
              inset 0 0 24px rgba(0,0,0,0.6),
              inset 0 2px 0 rgba(255,255,255,0.07)
            `,
            transition: "box-shadow 1.2s ease",
          }}
        >
          <AnimatePresence mode="wait">
            {displayContact ? (
              <motion.div
                key={`contact-${displayContact.id}`}
                initial={{ scale: 1.08, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="absolute inset-0"
              >
                {(() => {
                  // Hero avatar inside the GlowCircle. If no contact photo is
                  // set, render a large initials bubble on a deterministic
                  // gradient so the visual is never the grey broken-image box.
                  const initials = (displayContact.name || "?")
                    .split(/\s+/).filter(Boolean).slice(0, 2)
                    .map(w => w[0]).join("").toUpperCase() || "?";
                  const hue = (displayContact.name || "")
                    .split("").reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
                  if (displayContact.avatar) {
                    return (
                      <ImageWithFallback
                        src={displayContact.avatar}
                        alt={displayContact.name}
                        className="w-full h-full object-cover"
                      />
                    );
                  }
                  return (
                    <div
                      className="w-full h-full flex items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, hsl(${hue} 55% 28%), hsl(${(hue + 40) % 360} 50% 16%))`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 64, fontWeight: 800,
                          color: "rgba(255,255,255,0.95)",
                          letterSpacing: "-1px",
                          fontFamily: "'Outfit', sans-serif",
                          textShadow: "0 4px 14px rgba(0,0,0,0.4)",
                        }}
                      >{initials}</span>
                    </div>
                  );
                })()}
                <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.1) 30%, rgba(0,0,0,0.75) 100%)" }} />

                {isCalling && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center"
                    style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(0.5px)" }}
                  >
                    <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 0.9, repeat: Infinity }}>
                      <PhoneCall style={{ width: 28, height: 28, color: "#00C8E0", filter: "drop-shadow(0 0 8px #00C8E0)" }} />
                    </motion.div>
                    <span style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginTop: 6, textShadow: "0 0 12px rgba(0,200,224,0.8)", fontFamily: "inherit" }}>
                      {callRemaining}s
                    </span>
                    <div className="flex gap-1 mt-1.5">
                      {[0, 1, 2].map(i => (
                        <motion.div key={i} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.25 }}
                          className="size-1.5 rounded-full" style={{ background: "#00C8E0" }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 px-2 pb-3 text-center">
                  {isRecording && (
                    <div className="flex items-center justify-center gap-1 mt-0.5">
                      <motion.div animate={{ opacity: [1, 0.1, 1] }} transition={{ duration: 0.8, repeat: Infinity }}
                        className="size-2 rounded-full" style={{ background: "#FF2D55", boxShadow: "0 0 6px #FF2D55" }}
                      />
                      <span style={{ fontSize: 9, color: "#FF6060", fontWeight: 700, fontFamily: "inherit" }}>
                        {isAr ? "تسجيل " : "REC "}{fmt(recordingSec)}
                      </span>
                    </div>
                  )}
                  {phase === "monitoring" && !isRecording && (
                    <div className="flex items-center justify-center gap-1 mt-0.5">
                      <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }}
                        className="size-1.5 rounded-full" style={{ background: "#00C853" }}
                      />
                      <span style={{ fontSize: 9, color: "rgba(0,200,83,0.9)", fontWeight: 600, fontFamily: "inherit" }}>{t("sos.monitoring")}</span>
                    </div>
                  )}
                  {phase === "answered" && (
                    <div className="flex items-center justify-center gap-1 mt-0.5">
                      <div className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                      <span style={{ fontSize: 9, color: "rgba(0,200,83,0.9)", fontWeight: 600, fontFamily: "inherit" }}>{t("sos.connected")}</span>
                    </div>
                  )}
                  {phase === "documenting" && (
                    <div className="flex items-center justify-center gap-1 mt-0.5">
                      <Camera style={{ width: 10, height: 10, color: "#00C8E0" }} />
                      <span style={{ fontSize: 9, color: "rgba(0,200,224,0.9)", fontWeight: 600, fontFamily: "inherit" }}>Documenting</span>
                    </div>
                  )}
                </div>

                <motion.div
                  animate={{ opacity: [0.4, 0.9, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 rounded-full"
                  style={{
                    boxShadow: `inset 0 0 0 2.5px ${glowColor}55`,
                    transition: "box-shadow 1.2s",
                  }}
                />
              </motion.div>
            ) : isPausing ? (
              <motion.div key="pausing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center"
                style={{ background: "radial-gradient(circle, rgba(255,150,0,0.1) 0%, #050A14 100%)" }}
              >
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}>
                  <RefreshCw style={{ width: 28, height: 28, color: "#FF9500", filter: "drop-shadow(0 0 8px #FF9500)" }} />
                </motion.div>
                <span style={{ fontSize: 26, fontWeight: 900, color: "#FF9500", marginTop: 8, textShadow: "0 0 20px rgba(255,150,0,0.6)", fontFamily: "inherit" }}>
                  {pauseRemaining}
                </span>
                <span style={{ fontSize: 9, color: "rgba(255,150,0,0.45)", fontFamily: "inherit" }}>{isAr ? "ث · إعادة المحاولة" : "sec · Retrying"}</span>
              </motion.div>
            ) : (
              <motion.div key="sos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center"
                style={{ background: "radial-gradient(circle, rgba(255,45,85,0.12) 0%, #050A14 100%)" }}
              >
                <motion.span
                  animate={{ opacity: [1, 0.7, 1] }} transition={{ duration: 1.2, repeat: Infinity }}
                  style={{ fontSize: 38, fontWeight: 900, color: "#FF2D55", letterSpacing: "5px", textShadow: "0 0 30px rgba(255,45,85,0.7), 0 0 60px rgba(255,45,85,0.3)", fontFamily: "inherit" }}
                >
                  SOS
                </motion.span>
                <span style={{ fontSize: 9, color: "rgba(255,45,85,0.35)", fontFamily: "inherit", marginTop: 4, letterSpacing: "2px" }}>{t("sos.activating")}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* === CALLER / MY AVATAR SPLIT === */}
        {isCalling && displayContact && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 22 }}
            className="absolute -bottom-1 -left-2 size-10 rounded-full overflow-hidden"
            style={{ border: "2.5px solid #0A1220", boxShadow: `0 0 14px ${glowColor}50` }}
          >
            <ImageWithFallback src={userAvatar || DEFAULT_AVATAR} alt={userName} className="w-full h-full object-cover" />
          </motion.div>
        )}

        {/* Badge: recording */}
        <AnimatePresence>
          {isRecording && (
            <motion.div key="rec-badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              className="absolute -bottom-1 -right-2 size-10 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#FF2D55,#CC0033)", border: "2.5px solid #05070E", boxShadow: "0 0 16px rgba(255,45,85,0.6), 0 0 4px rgba(255,45,85,0.8)" }}
            >
              <motion.div animate={{ scale: [1, 0.8, 1] }} transition={{ duration: 0.9, repeat: Infinity }}>
                <Mic style={{ width: 14, height: 14, color: "#fff" }} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* === CONTACT NAME + STATUS (below circle) === */}
      <AnimatePresence mode="wait">
        {displayContact && (
          <motion.div key={`label-${displayContact.id}`}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="text-center mt-1"
          >
            <p style={{ fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px", fontFamily: "inherit" }}>
              {displayContact.name}
            </p>
            <p style={{ fontSize: 11, color: `${glowColor}CC`, fontFamily: "inherit", marginTop: 1 }}>
              {isCalling    ? (isAr ? `جاري الاتصال · ${callRemaining}ث` : `Calling · ${callRemaining}s`) :
               isConnected  ? `${phase === "recording" ? (isAr ? "تسجيل" : "Recording") : phase === "documenting" ? (isAr ? "توثيق الحادثة" : "Document incident") : (isAr ? "متصل" : "Connected")} · ${displayContact.relation}` : ""}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Calling Admin View ───────────────────────────────────────────────────────
type AdminCallState = "calling" | "connected" | "declined" | "ended";

interface CallingAdminViewProps {
  employeeId: string;
  employeeName: string;
  zone?: string;
  onDismiss: () => void;
  isPremium?: boolean;
}

function CallingAdminView({ employeeId, employeeName, zone, onDismiss, isPremium = true }: CallingAdminViewProps) {
  const { isAr, lang } = useLang();
  const t = useT(lang);
  const [callState, setCallState] = useState<AdminCallState>("calling");
  const callStateRef = useRef<AdminCallState>("calling");
  const [voiceInfo, setVoiceInfo] = useState<VoiceCallInfo | null>(null);
  const callIdRef = useRef(`sos-call-${employeeId}`);
  const endingRef = useRef(false); // [FIX #28] Prevent double onDismiss

  const elapsed = voiceInfo?.elapsed ?? 0;
  const maxDuration = isPremium ? 60 : 30;

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // Start WebRTC call + emit signaling
  useEffect(() => {
    emitCallSignal({ type: "EMPLOYEE_CALLING", employeeId, employeeName, zone });

    // Start WebRTC voice call
    voiceCallEngine.startCall(callIdRef.current, maxDuration);

    // Subscribe to voice state changes
    const unsubVoice = voiceCallEngine.subscribe((info) => {
      setVoiceInfo(info);
      if (info.state === "connected" && callStateRef.current !== "connected") {
        callStateRef.current = "connected";
        setCallState("connected");
      }
      if (info.state === "ended" && callStateRef.current === "connected") {
        callStateRef.current = "ended";
        setCallState("ended");
        // [FIX #28] Only auto-dismiss if handleEndCall hasn't already been called
        if (!endingRef.current) {
          endingRef.current = true;
          setTimeout(onDismiss, 2200);
        }
      }
    });

    // Listen for admin signaling response
    const unsub = onCallSignal((sig) => {
      if (!sig || sig.employeeId !== employeeId) return;
      if (sig.type === "ADMIN_ANSWERED") {
        callStateRef.current = "connected";
        setCallState("connected");
      } else if (sig.type === "ADMIN_DECLINED") {
        callStateRef.current = "declined";
        setCallState("declined");
        voiceCallEngine.endCall();
        if (!endingRef.current) {
          endingRef.current = true;
          setTimeout(onDismiss, 3500);
        }
      } else if (sig.type === "CALL_ENDED") {
        callStateRef.current = "ended";
        setCallState("ended");
        voiceCallEngine.endCall();
        if (!endingRef.current) {
          endingRef.current = true;
          setTimeout(onDismiss, 2200);
        }
      }
    });

    // [FIX #29] Cleanup: end the call if component unmounts unexpectedly
    return () => {
      unsub();
      unsubVoice();
      if (callStateRef.current === "calling" || callStateRef.current === "connected") {
        voiceCallEngine.endCall();
      }
    };
  }, [employeeId]);

  const handleEndCall = () => {
    if (endingRef.current) return; // [FIX #28] Prevent re-entry
    endingRef.current = true;
    voiceCallEngine.endCall();
    emitCallSignal({ type: "CALL_ENDED", employeeId, employeeName, zone });
    clearCallSignal();
    onDismiss();
  };

  const handleToggleMute = () => {
    voiceCallEngine.toggleMute();
  };

  const glowColor =
    callState === "connected" ? "#00C853" :
    callState === "calling"   ? "#00C8E0" : "#FF2D55";

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 340, damping: 36 }}
      className="absolute bottom-0 left-0 right-0 z-50"
      style={{
        borderRadius: "26px 26px 0 0",
        background: "rgba(5,9,20,0.99)",
        borderTop: `1px solid ${glowColor}30`,
        backdropFilter: "blur(32px)",
        boxShadow: `0 -12px 48px ${glowColor}10`,
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      <div className="flex justify-center pt-4 pb-1">
        <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.08)" }} />
      </div>

      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2">
          <motion.div
            animate={callState === "calling" ? { opacity: [1, 0.2, 1] } : { opacity: 1 }}
            transition={{ duration: 0.85, repeat: callState === "calling" ? Infinity : 0 }}
            className="size-2 rounded-full"
            style={{ background: glowColor, boxShadow: `0 0 6px ${glowColor}` }}
          />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", color: glowColor }}>
            {callState === "calling"   ? (isAr ? "جاري الإبلاغ" : "NOTIFYING ADMIN") :
             callState === "connected" ? (isAr ? "المسؤول يستجيب" : "ADMIN RESPONDING") :
             callState === "declined"  ? (isAr ? "المسؤول غير متاح" : "ADMIN UNAVAILABLE") : (isAr ? "انتهت المكالمة" : "CALL ENDED")}
          </span>
        </div>
        {callState !== "connected" && (
          <button
            onClick={callState === "calling" ? handleEndCall : onDismiss}
            className="size-7 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <X style={{ width: 13, height: 13, color: "rgba(255,255,255,0.3)" }} />
          </button>
        )}
      </div>

      <div className="flex flex-col items-center px-5 pb-4">
        <div className="relative mb-3" style={{ width: 88, height: 88 }}>
          {(callState === "calling" || callState === "connected") && (
            <div>
              {[1, 2, 3].map(i => (
                <motion.div
                  key={i}
                  className="absolute inset-0 rounded-full pointer-events-none"
                  animate={{ scale: [1, 1.28 + i * 0.12, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.4, ease: "easeOut" }}
                  style={{ border: `1.5px solid ${glowColor}`, boxShadow: `0 0 10px ${glowColor}40` }}
                />
              ))}
            </div>
          )}
          <div
            className="absolute inset-0 rounded-full flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${glowColor}20, ${glowColor}05)`,
              border: `2px solid ${glowColor}40`,
              boxShadow: `0 0 28px ${glowColor}18, inset 0 0 20px rgba(0,0,0,0.5)`,
            }}
          >
            {callState === "declined" || callState === "ended" ? (
              <PhoneOff style={{ width: 28, height: 28, color: glowColor }} />
            ) : callState === "connected" ? (
              <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.8, repeat: Infinity }}>
                <Phone style={{ width: 28, height: 28, color: "#00C853" }} />
              </motion.div>
            ) : (
              <motion.div animate={{ rotate: [0, 8, -8, 0] }} transition={{ duration: 0.7, repeat: Infinity }}>
                <PhoneCall style={{ width: 28, height: 28, color: "#00C8E0" }} />
              </motion.div>
            )}
          </div>
        </div>

        <p style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.2px" }}>{t("sos.safetyAdmin")}</p>
        <div className="flex items-center gap-1.5 mt-1 mb-3">
          <Building2 style={{ width: 11, height: 11, color: "rgba(0,200,224,0.6)" }} />
          <span style={{ fontSize: 11, color: "rgba(0,200,224,0.7)", fontWeight: 600 }}>
            {isAr ? "استجابة طوارئ الشركة" : "Company Emergency Response"}
          </span>
        </div>

        <AnimatePresence mode="wait">
          {callState === "calling" && (
            <motion.div
              key="calling-dots"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex gap-2 items-center"
            >
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.22 }}
                  className="size-2 rounded-full"
                  style={{ background: "#00C8E0" }}
                />
              ))}
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>{t("sos.ringing")}</span>
            </motion.div>
          )}

          {callState === "connected" && (
            <motion.div
              key="connected-timer"
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2"
            >
              {/* Voice level + timer */}
              <div className="flex items-center gap-2 px-4 py-1.5 rounded-full"
                style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.2)" }}
              >
                {/* Audio level bars */}
                <div className="flex items-end gap-0.5" style={{ height: 12 }}>
                  {[0.3, 0.6, 1, 0.7, 0.4].map((h, i) => (
                    <motion.div
                      key={i}
                      animate={{ scaleY: voiceInfo?.state === "connected" ? [0.3, Math.max(0.3, (voiceInfo?.audioLevel ?? 0) * h * 2), 0.3] : 0.3 }}
                      transition={{ duration: 0.3, repeat: Infinity, delay: i * 0.05 }}
                      style={{ width: 2, height: 12, background: "#00C853", borderRadius: 1, transformOrigin: "bottom" }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#00C853", fontVariantNumeric: "tabular-nums" }}>
                  {fmtTime(elapsed)}
                </span>
                <span style={{ fontSize: 11, color: "rgba(0,200,83,0.6)" }}>{t("sos.voiceActive")}</span>
              </div>
              {/* Duration limit indicator */}
              <div className="flex items-center gap-1.5">
                <div style={{ width: 60, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
                  <motion.div
                    style={{
                      height: "100%", borderRadius: 2,
                      background: elapsed > maxDuration * 0.8 ? "#FF2D55" : "#00C853",
                      width: `${Math.min(100, (elapsed / maxDuration) * 100)}%`,
                    }}
                  />
                </div>
                <span style={{ fontSize: 9, color: elapsed > maxDuration * 0.8 ? "#FF2D55" : "rgba(255,255,255,0.25)" }}>
                  {fmtTime(maxDuration - elapsed)} left
                </span>
              </div>
            </motion.div>
          )}

          {callState === "declined" && (
            <motion.div
              key="declined"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="px-4 py-2 rounded-full"
              style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)" }}
            >
              <span style={{ fontSize: 12, color: "rgba(255,45,85,0.8)", fontWeight: 600 }}>
                Admin unavailable — will be notified
              </span>
            </motion.div>
          )}

          {callState === "ended" && (
            <motion.div
              key="ended"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="px-4 py-2 rounded-full"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{t("sos.callEnded")}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Emergency context band */}
      <div
        className="mx-4 mb-4 flex items-start gap-3 px-4 py-3 rounded-2xl"
        style={{ background: "rgba(255,45,85,0.05)", border: "1px solid rgba(255,45,85,0.1)" }}
      >
        <AlertTriangle style={{ width: 14, height: 14, color: "#FF2D55", flexShrink: 0, marginTop: 1 }} />
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 2 }}>
            {isAr ? "SOS نشط — جاري الإبلاغ" : "SOS Active — Notifying Admin"}
          </p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
            {callState === "calling"
              ? isAr ? "جاري الاتصال بمسؤول سلامة شركتك..." : "Connecting to your company safety admin via SOSphere secure protocol"
              : callState === "connected"
              ? isAr ? "المسؤول على الخط — تكلم بوضوح وشارك موقعك" : "Admin is on the line — speak clearly and share your location"
              : isAr ? "سيتابع المسؤول عبر لوحة التحكم" : "Admin will follow up via the dashboard"}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-8 space-y-2">
        {callState === "connected" && (
          <div className="flex gap-3">
            {/* Mute toggle */}
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={handleToggleMute}
              className="flex-shrink-0 size-14 rounded-2xl flex items-center justify-center"
              style={{
                background: voiceInfo?.isMuted ? "rgba(255,45,85,0.12)" : "rgba(255,255,255,0.04)",
                border: voiceInfo?.isMuted ? "1.5px solid rgba(255,45,85,0.3)" : "1.5px solid rgba(255,255,255,0.08)",
              }}
            >
              {voiceInfo?.isMuted
                ? <MicOff style={{ width: 18, height: 18, color: "#FF2D55" }} />
                : <Mic style={{ width: 18, height: 18, color: "#00C853" }} />
              }
            </motion.button>
            {/* End call */}
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handleEndCall}
              className="flex-1 flex items-center justify-center gap-3 py-4 rounded-2xl"
              style={{
                background: "linear-gradient(135deg, rgba(255,45,85,0.14), rgba(255,45,85,0.04))",
                border: "1.5px solid rgba(255,45,85,0.3)",
                boxShadow: "0 4px 20px rgba(255,45,85,0.1)",
              }}
            >
              <div
                className="size-9 rounded-full flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #FF2D55, #CC0033)", boxShadow: "0 4px 14px rgba(255,45,85,0.4)" }}
              >
                <PhoneOff style={{ width: 16, height: 16, color: "#fff" }} />
              </div>
              <div className="text-left">
              <p style={{ fontSize: 13, fontWeight: 800, color: "#FF2D55" }}>{t("sos.endCall")}</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{isAr ? "SOS لا يزال نشطاً" : "SOS stays active"}</p>
            </div>
            </motion.button>
          </div>
        )}

        {callState === "calling" && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={handleEndCall}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <PhoneMissed style={{ width: 14, height: 14, color: "rgba(255,255,255,0.3)" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.35)" }}>
              Cancel Admin Call
            </span>
          </motion.button>
        )}

        {(callState === "declined" || callState === "ended") && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={onDismiss}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.35)" }}>{t("sos.close")}</span>
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
interface SosEmergencyProps {
  onEnd: (record: IncidentRecord) => void;
  onCancel: () => void;
  recordingEnabled?: boolean;
  /** "employee" = Admin is first contact; "individual" = personal contacts only */
  mode?: "employee" | "individual";
  /** Premium user — enables PDF export + extended recording */
  isPremium?: boolean;
  /** Navigate to subscription/pricing page */
  onNavigateToSubscription?: () => void;
  /** Real user identity — passed from auth context */
  userName: string;
  userId: string;
  userPhone: string;
  userBloodType: string;
  userZone: string;
  userAvatar?: string;
}

// ═════════════════════════════════════════════════════════════════════
// TierPipeline — visual representation of the 3-tier escalation chain
//
// Reflects the server-side `resolveTier()` logic deployed in v14:
//     Tier 1: Admin (supervisor)       — initial contact
//     Tier 2: Owner (company owner)    — auto-escalated after 60s
//     Tier 3: Emergency Services       — manual or auto-escalated final tier
//
// The pipeline is a single-glance status of where the SOS currently sits
// in the orchestration, matching what the backend is dispatching.
// ═════════════════════════════════════════════════════════════════════
interface TierPipelineProps {
  level: "admin" | "owner" | "emergency_services";
  mode: "employee" | "individual";
  isAr: boolean;
  escalationTimer: number;
  thresholdSec: number;
}

function TierPipeline({ level, mode, isAr, escalationTimer, thresholdSec }: TierPipelineProps) {
  // Individual mode does not have an admin/owner chain — hide pipeline.
  if (mode !== "employee") return null;

  const tiers: Array<{ key: "admin" | "owner" | "emergency_services"; label: string; labelEn: string }> = [
    { key: "admin",              label: "المشرف",   labelEn: "Admin"     },
    { key: "owner",              label: "المالك",   labelEn: "Owner"     },
    { key: "emergency_services", label: "الطوارئ",  labelEn: "Services"  },
  ];

  const idxOf = (k: string) => tiers.findIndex(t => t.key === k);
  const currentIdx = idxOf(level);

  return (
    <div className="shrink-0 px-5 mb-3">
      <div className="flex items-center gap-1" style={{
        padding: "8px 10px",
        borderRadius: 14,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}>
        {tiers.map((tier, i) => {
          const isPast    = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isFuture  = i > currentIdx;

          const color =
            isPast    ? "#00C853" :
            isCurrent ? (level === "emergency_services" ? "#FF2D55" : level === "owner" ? "#FF9500" : "#00C8E0") :
                        "rgba(255,255,255,0.22)";

          const progress =
            isCurrent && level === "admin"
              ? Math.min(1, escalationTimer / thresholdSec)
              : isPast ? 1 : 0;

          return (
            <div key={tier.key} className="flex items-center" style={{ flex: 1, minWidth: 0 }}>
              {/* Node */}
              <motion.div
                animate={isCurrent ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={{ duration: 1.4, repeat: isCurrent ? Infinity : 0 }}
                className="shrink-0 flex items-center justify-center"
                style={{
                  width: 26, height: 26, borderRadius: 99,
                  background: isCurrent ? `${color}1F` : isPast ? "rgba(0,200,83,0.12)" : "rgba(255,255,255,0.03)",
                  border: `1.5px solid ${color}${isCurrent ? "" : isPast ? "" : "40"}`,
                  boxShadow: isCurrent ? `0 0 12px ${color}55` : "none",
                }}
              >
                {isPast ? (
                  <CheckCircle style={{ width: 12, height: 12, color }} />
                ) : isCurrent && level === "emergency_services" ? (
                  <AlertTriangle style={{ width: 11, height: 11, color }} />
                ) : (
                  <span style={{ fontSize: 10, fontWeight: 800, color, fontFamily: "'Outfit', monospace" }}>{i + 1}</span>
                )}
              </motion.div>

              {/* Label + connector */}
              <div className="flex-1 flex items-center min-w-0">
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: isCurrent ? color : isPast ? "rgba(0,200,83,0.65)" : "rgba(255,255,255,0.28)",
                  marginInline: 6,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {isAr ? tier.label : tier.labelEn}
                </span>

                {/* Connector line — hidden on last tier */}
                {i < tiers.length - 1 && (
                  <div style={{ flex: 1, height: 1.5, borderRadius: 99, background: "rgba(255,255,255,0.05)", position: "relative", minWidth: 8 }}>
                    <motion.div
                      animate={{ width: `${progress * 100}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      style={{
                        position: "absolute", left: 0, top: 0, bottom: 0,
                        borderRadius: 99,
                        background: isPast ? "#00C853" : color,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SosEmergency({ onEnd, onCancel: _onCancel, recordingEnabled = false, mode = "individual", isPremium = false, onNavigateToSubscription, userName, userId, userPhone, userBloodType, userZone, userAvatar }: SosEmergencyProps) {
  const { isAr, lang } = useLang();
  const t = useT(lang);
  // ══════════════════════════════════════════════════════════════
  // SOS is never blocked by trial status — safety first
  // SUPABASE_MIGRATION_POINT: this guarantee must be
  // enforced server-side via RLS — SOS table always writable
  // ══════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════
  // FIX A: SOS Rate Limiting (Insider Threat Protection)
  // Prevents abuse: max 3 SOS per hour per user
  // ══════════════════════════════════════════════════════════════
  const SOS_RATE_LIMIT = {
    maxPerHour: 3,
    cooldownMinutes: 20,
  };

  const [showRateLimitWarning, setShowRateLimitWarning] = useState(false);
  const [rateLimitChoice, setRateLimitChoice] = useState<"testing" | "real" | null>(null);
  const [sosRateFlagged, setSosRateFlagged] = useState(false);

  // ── Core SOS state — declared early because escalation useEffect needs `phase` ──
  const [phase, setPhase]               = useState<Phase>("starting");
  const [showBypassOption, setShowBypassOption] = useState(false);
  const [bypassSupervisor, setBypassSupervisor] = useState(false);

  // Check rate limit on mount — session-based (module-level array, not localStorage)
  useEffect(() => {
    // [SUPABASE_READY] sos_rate_limit: migrate to supabase.from('sos_events').select().eq('employee_id', userId).gte('created_at', oneHourAgo)
    const oneHourAgo = Date.now() - 3600000;
    // Prune expired entries
    sosRateHistory = sosRateHistory.filter(t => t > oneHourAgo);

    console.log("[SUPABASE_READY] rate_limit_check: " + sosRateHistory.length + " recent triggers");

    if (sosRateHistory.length >= SOS_RATE_LIMIT.maxPerHour) {
      setShowRateLimitWarning(true);
      setSosRateFlagged(true);

      // Emit admin warning
      (async () => {
        const ackResult = await emitSyncEvent({
          type: "SOS_TRIGGERED",
          employeeId: userId,
          employeeName: userName,
          zone: userZone,
          timestamp: Date.now(),
          data: {
            rateLimitTriggered: true,
            sosCountLastHour: sosRateHistory.length,
            warning: `${userName} triggered ${sosRateHistory.length} SOS in 1 hour — possible false alarms or system testing`,
          },
        });
        // Check if dashboard received the signal
        if (ackResult && typeof ackResult === 'object' && 'delivered' in ackResult && !ackResult.delivered) {
          console.warn("[SOS] Dashboard did not acknowledge — signal may be queued for retry");
        }
      })();
    } else {
      // Normal SOS — log timestamp to session history
      sosRateHistory.push(Date.now());
    }
  }, [userId, userName, userZone]);

  // ── Work-hours routing for employees ──
  // During office hours → admin first, then personal contacts
  // Outside office hours → skip admin, personal contacts only
  const duringWorkHours = mode === "employee" ? isWithinWorkHours() : false;

  const modeContacts = getContactsForMode(mode, isPremium);
  const noContacts = modeContacts.length === 0;

  // ══════════════════════════════════════════════════════════════
  // QUICK SETUP: If user has no emergency contacts, show inline
  // setup INSIDE the SOS screen so they can add one fast (~30 sec)
  // ══════════════════════════════════════════════════════════════
  const [showQuickSetup, setShowQuickSetup] = useState(noContacts);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [quickRelation, setQuickRelation] = useState("");

  const handleQuickSetupSave = () => {
    if (!quickName.trim() || !quickPhone.trim()) return;
    const newContact: ERContact = {
      id: Date.now(), name: quickName.trim(), relation: quickRelation.trim() || (isAr ? "جهة طوارئ" : "Emergency"),
      phone: quickPhone.trim(), avatar: "", status: "pending",
    };
    try {
      const existing = JSON.parse(localStorage.getItem("sosphere_emergency_contacts") || "[]");
      existing.push(newContact);
      localStorage.setItem("sosphere_emergency_contacts", JSON.stringify(existing));
    } catch {
      localStorage.setItem("sosphere_emergency_contacts", JSON.stringify([newContact]));
    }
    setContacts([newContact]);
    setShowQuickSetup(false);
  };

  // ══════════════════════════════════════════════════════════════
  // BATTERY WARNING TIERS:
  // • 35% (0.35): Amber warning "Battery low — stay near power source"
  // • 20% (0.20): Red critical "Battery critical — SOS may not complete"
  // ══════════════════════════════════════════════════════════════
  const [criticalBattery, setCriticalBattery] = useState(false);
  const [lowBattery, setLowBattery] = useState(false);
  useEffect(() => {
    const checkBattery = async () => {
      try {
        const level = await getBatteryLevel();
        if (level !== null) {
          if (level < 0.20) {
            setCriticalBattery(true);
            setLowBattery(false);
          } else if (level < 0.35) {
            setLowBattery(true);
            setCriticalBattery(false);
          } else {
            setCriticalBattery(false);
            setLowBattery(false);
          }
        }
      } catch { /* battery API not available */ }
    };
    // Check immediately + every 30 seconds
    checkBattery();
    const iv = setInterval(checkBattery, 30000);
    return () => clearInterval(iv);
  }, []);

  // ══════════════════════════════════════════════════════════════
  // SMART ESCALATION: When admin doesn't answer for 60+ seconds,
  // auto-escalate to company Owner with full incident data.
  // Employee can also escalate manually at any time.
  // ══════════════════════════════════════════════════════════════
  const [escalationLevel, setEscalationLevel] = useState<"admin" | "owner" | "emergency_services">("admin");
  const [escalationTimer, setEscalationTimer] = useState(0);
  const [autoEscalated, setAutoEscalated] = useState(false);
  const ESCALATION_THRESHOLD_SEC = 60; // Auto-escalate after 60s no admin response

  // Auto-escalation logic
  useEffect(() => {
    if (mode !== "employee") return;
    if (escalationLevel !== "admin") return;
    if (phase === "answered" || phase === "recording" || phase === "ended") return;

    const iv = setInterval(() => {
      setEscalationTimer(prev => {
        const next = prev + 1;
        if (next >= ESCALATION_THRESHOLD_SEC && !autoEscalated) {
          // Auto-escalate: send everything to Owner
          setAutoEscalated(true);
          setEscalationLevel("owner");
          const gps = getLastKnownPosition();
          emitSyncEvent({
            type: "SOS_ESCALATED",
            employeeId: userId,
            employeeName: userName,
            zone: userZone,
            timestamp: Date.now(),
            data: {
              reason: "admin_no_response",
              escalatedTo: "owner",
              waitedSeconds: next,
              location: gps,
              bloodType: userBloodType,
              phone: userPhone,
              photos: [], // will be populated from evidence store
              suggestion: isAr
                ? `${userName} في حالة طوارئ والأدمن لم يستجب لمدة ${next} ثانية. يُنصح بالتدخل الفوري.`
                : `${userName} is in emergency and admin hasn't responded for ${next}s. Immediate action recommended.`,
            },
          });
          trackEventSync(errIdRef.current, "escalation_triggered",
            `Emergency escalated to company owner`,
            "System", "System",
            { escalationLevel: "owner", reason: "No admin response" });
          toast.error(isAr ? "تم تصعيد الطوارئ تلقائياً للمالك" : "Emergency auto-escalated to Owner");
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [mode, escalationLevel, phase, autoEscalated, userId, userName, userZone, userBloodType, userPhone, isAr]);

  /** Manual escalation by employee */
  const handleManualEscalate = () => {
    if (escalationLevel === "admin") {
      setEscalationLevel("owner");
      emitSyncEvent({
        type: "SOS_ESCALATED",
        employeeId: userId, employeeName: userName, zone: userZone,
        timestamp: Date.now(),
        data: { reason: "employee_manual", escalatedTo: "owner", waitedSeconds: escalationTimer },
      });
      trackEventSync(errIdRef.current, "escalation_triggered",
        `Emergency escalated to company owner`,
        "System", "System",
        { escalationLevel: "owner", reason: "No admin response" });
      toast(isAr ? "تم التصعيد للمالك" : "Escalated to Owner");
    } else if (escalationLevel === "owner") {
      setEscalationLevel("emergency_services");
      toast(isAr ? "اتصل بالطوارئ 911/997 الآن!" : "Call 911/997 NOW!");
    }
  };

  const [contacts, setContacts]         = useState<ERContact[]>(modeContacts);
  const [currentIdx, setCurrentIdx]     = useState(0);
  const [cycle, setCycle]               = useState(1);
  const [phaseTimer, setPhaseTimer]     = useState(0);
  const [elapsed, setElapsed]           = useState(0);
  const [isRecording, setIsRecording]   = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [smsSent, setSmsSent]           = useState(false);
  const [answeredContact, setAnsweredContact] = useState<ERContact | null>(null);
  const [events, setEvents]             = useState<ERREvent[]>([]);
  const [monitorSec, setMonitorSec]     = useState(0);

  // ── Admin Call State ──────────────────────────────────────────
  const [showAdminCall, setShowAdminCall]       = useState(false);
  const [adminCallEmitted, setAdminCallEmitted] = useState(false);
  const [showPersonalSosNotice, setShowPersonalSosNotice] = useState(false);
  // Ref: pauses the tick while CallingAdminView is visible (employee mode only).
  // Only pause for admin call during work hours — outside work hours, skip admin entirely.
  const adminCallPendingRef = useRef(mode === "employee" && duringWorkHours);

  // ── Documenting State (photos + comment after recording) ────
  const [docPhotos, setDocPhotos]     = useState<string[]>([]);
  const [docComment, setDocComment]   = useState("");
  const [docSubmitted, setDocSubmitted] = useState(false);
  const docPhotosRef = useRef<string[]>([]);
  const docCommentRef = useRef("");
  const evidenceIdRef = useRef<string | undefined>(undefined);

  // FIX 8: Unique incident ID per SOS session (was module-level singleton)
  const errIdRef = useRef(generateErrId());

  // DMS
  const [showDMS, setShowDMS]       = useState(false);
  const [dmsCheckNum, setDmsCheckNum] = useState(1);
  const [dmsCountdown, setDmsCountdown] = useState(30);

  const [showCancel, setShowCancel] = useState(false);

  // ── Deactivation PIN (prevents accidental/forced SOS termination) ──
  const [showPinEntry, setShowPinEntry] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const deactivationPin = useRef(() => {
    try {
      const stored = localStorage.getItem("sosphere_deactivation_pin");
      if (stored) return stored;
    } catch {}
    return "1234"; // Default PIN — user should change in settings
  });
  // Track if SMS tracking was already sent for each contact index
  const smsTrackingSentRef = useRef<number[]>([]);

  // ── Upgrade Modal (for gated Elite features) ──
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeFeatureName, setUpgradeFeatureName] = useState("");

  // ── Incident Record Overlay (view live record WITHOUT ending SOS) ──
  const [showIncidentOverlay, setShowIncidentOverlay] = useState(false);
  // ── Server-side SOS result (Path B) ──
  const [serverResult, setServerResult] = useState<ServerTriggerResult | null>(null);

  // Mutable ref (avoids stale closures in setInterval)
  const q = useRef({
    phase: "starting" as Phase,
    currentIdx: 0, cycle: 1, phaseTimer: 0, elapsed: 0,
    isRecording: false, recordingSec: 0, smsSent: false,
    monitorSec: 0, nextDMSAt: DMS_FIRST_SEC,
    dmsCheckNum: 1, dmsActive: false, dmsCountdown: 30,
    dialerOpenedForIdx: [] as number[], // Track which contacts we've opened dialer for
  });
  // ── Manual answer confirmation: user presses "Connected" when someone answers ──
  const manualAnswerRef = useRef(false);
  const contactsRef = useRef<ERContact[]>(modeContacts);
  const eventsRef   = useRef<ERREvent[]>([]);
  const tickRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const dmsTickRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // FIX FATAL-2: Battery last gasp — send final position when battery ≤10%
  const lastGaspSentRef = useRef(false);

  // ── REAL VOICE RECORDING: MediaRecorder API ──────────────────────
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const audioDataUrlRef  = useRef<string>(""); // stores real base64 audio

  // ── Recording timing mode (snapshotted at SOS start; cannot change mid-incident) ──
  //   "after"  — default: record only after a contact answers (current behavior)
  //   "during" — record from SOS activation onward; skip the post-call recording phase
  //   "both"   — Elite: record from activation AND restart a fresh post-call segment
  const recordingModeRef = useRef<RecordingMode>(getRecordingMode());
  const duringRecordingStartedRef = useRef(false); // prevents double-start on re-renders

  const startRealRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Convert recorded chunks to base64 dataUrl
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          audioDataUrlRef.current = reader.result as string;
        };
        reader.readAsDataURL(blob);
        // Stop microphone tracks
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start(1000); // Collect data every second
      mediaRecorderRef.current = recorder;
    } catch (err) {
      // Microphone permission denied or not available — continue without audio
      console.warn("[SOS] Voice recording unavailable:", err);
      audioDataUrlRef.current = "";
    }
  }, []);

  const stopRealRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, []);

  // ── Load contacts from localStorage on mount (subscription-aware) ──
  useEffect(() => {
    const loaded = getContactsForMode(mode, isPremium);
    setContacts(loaded);
    contactsRef.current = loaded;
    console.log("[SOS] contacts_loaded:", loaded.length, "contacts | tier:", isPremium ? "paid" : "free", "| mode:", mode, "| workHours:", duringWorkHours);
  }, []);

  const addEvent = useCallback((ev: Omit<ERREvent, "id" | "ts">) => {
    const full: ERREvent = { ...ev, id: `EVT-${Date.now().toString(36)}-${(crypto?.randomUUID ? crypto.randomUUID().slice(0,8) : Date.now().toString(36).slice(-4))}`, ts: new Date() };
    eventsRef.current = [...eventsRef.current, full];
    setEvents([...eventsRef.current]);
  }, []);

  const updateContact = useCallback((idx: number, status: ContactStatus) => {
    contactsRef.current = contactsRef.current.map((c, i) => i === idx ? { ...c, status } : c);
    setContacts([...contactsRef.current]);
  }, []);

  const resetContacts = useCallback(() => {
    contactsRef.current = contactsRef.current.map(c => ({ ...c, status: "pending" }));
    setContacts([...contactsRef.current]);
  }, []);

  // ── Live GPS Trail — buffered to reduce Supabase writes by ~80% ──
  // Collects GPS points and emits batch when buffer reaches 5 points OR 30s since last emit
  const GPS_BUFFER_SIZE = 5;
  const GPS_FLUSH_INTERVAL_MS = 30000;
  const [gpsTrailCount, setGpsTrailCount] = useState(0);
  const gpsBufferRef = useRef<{ trailPoint: number; lat: number; lng: number; accuracy: number; fromRealGPS: boolean; timestamp: number }[]>([]);
  const gpsLastFlushRef = useRef(Date.now());
  const gpsTrailRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const flushGpsBuffer = useCallback(() => {
    if (gpsBufferRef.current.length === 0) return;
    const batch = [...gpsBufferRef.current];
    gpsBufferRef.current = [];
    gpsLastFlushRef.current = Date.now();
    // [SUPABASE_READY] gps_trail_batch: insert batch into gps_trail table
    console.log("[SUPABASE_READY] gps_batch: " + batch.length + " points");
    emitSyncEvent({
      type: "GPS_TRAIL_UPDATE",
      employeeId: userId,
      employeeName: userName,
      zone: userZone,
      timestamp: Date.now(),
      data: { batch, pointCount: batch.length },
    });
    trackEventSync(errIdRef.current, "gps_updated",
      `GPS trail updated: ${batch.length} points`,
      "System", "System",
      { pointCount: batch.length, lastPoint: batch[batch.length - 1] });
  }, [userId, userName, userZone]);

  useEffect(() => {
    // Collect a GPS point every 6s (5 points × 6s = 30s natural flush cycle)
    gpsTrailRef.current = setInterval(() => {
      setGpsTrailCount(prev => {
        const newCount = prev + 1;
        // FIX FATAL-1: Use real GPS from tracker instead of random mock offsets
        const realPos = getLastKnownPosition();
        // Use real GPS position — if not available, use last known from localStorage
        const storedPos = (() => {
          try {
            const pts: any[] = JSON.parse(localStorage.getItem("sosphere_gps_trail") || "[]");
            return pts.filter(p => p.employeeId?.includes(userName.replace(/\s+/g, ""))).slice(-1)[0] ?? null;
          } catch { return null; }
        })();
        const bestPos = realPos || storedPos;
        // Use real GPS position — no hardcoded fallback coordinates
        const trailLat = bestPos ? bestPos.lat : 0;
        const trailLng = bestPos ? bestPos.lng : 0;
        gpsBufferRef.current.push({
          trailPoint: newCount,
          lat: trailLat,
          lng: trailLng,
          accuracy: realPos?.accuracy ?? 9999,
          fromRealGPS: !!realPos,
          timestamp: Date.now(),
        });
        // Flush if buffer full OR 30s elapsed since last flush
        if (
          gpsBufferRef.current.length >= GPS_BUFFER_SIZE ||
          Date.now() - gpsLastFlushRef.current >= GPS_FLUSH_INTERVAL_MS
        ) {
          flushGpsBuffer();
        }
        return newCount;
      });
    }, 6000);
    return () => {
      // Flush remaining points on cleanup (SOS end)
      if (gpsBufferRef.current.length > 0) flushGpsBuffer();
      if (gpsTrailRef.current) clearInterval(gpsTrailRef.current);
    };
  }, [flushGpsBuffer]);

  // ── Track if location was sent (only on first answer) ──
  const [locationSent, setLocationSent] = useState(false);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const doEnd = useCallback((reason: string) => {
    if (tickRef.current)    clearInterval(tickRef.current);
    if (dmsTickRef.current) clearInterval(dmsTickRef.current);
    if (gpsTrailRef.current) clearInterval(gpsTrailRef.current);
    stopHapticFeedback(); // Stop vibration feedback
    stopWatchdog(); // Stop watchdog timer
    deactivateEmergencyTracking(); // Restore normal GPS interval
    // ── Exit Immersive Mode: Restore system UI ──
    try { (window as any).SOSphereNative?.setEmergencyActive(false); } catch {}
    // ── End server-side SOS session (Path B cleanup) ──
    endServerSOS({
      emergencyId: errIdRef.current,
      reason,
      recordingSec: q.current.recordingSec,
      photos: docPhotosRef.current,
      comment: docCommentRef.current,
    }).catch(() => {});
    q.current.phase = "ended";
    addEvent({ type: "sos_end", title: reason, detail: `Duration: ${fmt(q.current.elapsed)}`, color: "#00C8E0" });
    const record: IncidentRecord = {
      id: errIdRef.current, startTime: new Date(Date.now() - q.current.elapsed * 1000),
      endTime: new Date(), triggerMethod: "hold",
      // FIX FATAL-1: Use real GPS from tracker instead of hardcoded Riyadh coords
      location: getLastKnownPosition() ?? { lat: 0, lng: 0, accuracy: 9999, address: "Location unavailable — GPS not acquired" },
      contacts: contactsRef.current, events: eventsRef.current,
      cyclesCompleted: q.current.cycle, recordingSeconds: q.current.recordingSec, isPremium,
      photos: docPhotosRef.current,
      comment: docCommentRef.current,
      evidenceId: evidenceIdRef.current,
    };
    // ── STOP any active voice recording on SOS end ──
    stopRealRecording();
    onEnd(record);
    // ── GAP FIX: Emit SOS_CANCELLED so dashboard resolves the emergency ──
    // This allows the cluster engine to re-evaluate when a worker cancels SOS
    // [SUPABASE_READY] sos_cancel: update sos_events set status='cancelled' + realtime
    emitSyncEvent({
      type: "SOS_CANCELLED",
      employeeId: userId,
      employeeName: userName,
      zone: userZone,
      timestamp: Date.now(),
      // FIX AUDIT-2.2: Include emergencyId so dashboard resolves by ID, not name
      data: { reason, duration: q.current.elapsed, phone: userPhone, bloodType: userBloodType, emergencyId: errIdRef.current },
    });
    trackEventSync(errIdRef.current, "emergency_resolved",
      `SOS ended: ${reason}. Duration: ${q.current.elapsed}s`,
      userName, "Employee",
      { reason, durationSec: q.current.elapsed, cyclesCompleted: q.current.cycle });
  }, [addEvent, onEnd, isPremium]);

  // Open DMS modal
  const openDMS = useCallback(() => {
    if (q.current.dmsActive) return;
    q.current.dmsActive = true;
    q.current.dmsCountdown = 30;
    setShowDMS(true);
    setDmsCheckNum(q.current.dmsCheckNum);
    setDmsCountdown(30);
    addEvent({
      type: "dms_check",
      title: `Are you safe? — Check #${q.current.dmsCheckNum}`,
      detail: ["5 minutes elapsed", "10 minutes — critical", "15 minutes — immediate escalation"][q.current.dmsCheckNum - 1],
      color: "#FF9500",
    });
    if (dmsTickRef.current) clearInterval(dmsTickRef.current);
    dmsTickRef.current = setInterval(() => {
      q.current.dmsCountdown -= 1;
      setDmsCountdown(q.current.dmsCountdown);
      if (q.current.dmsCountdown <= 0) {
        clearInterval(dmsTickRef.current!);
        q.current.dmsActive = false;
        q.current.dmsCheckNum += 1;
        q.current.nextDMSAt = q.current.monitorSec + DMS_GAP_SEC * q.current.dmsCheckNum;
        setShowDMS(false);
        setDmsCheckNum(q.current.dmsCheckNum);
        addEvent({ type: "dms_dismissed", title: `Check #${q.current.dmsCheckNum - 1} — No response`, color: "#FF2D55" });
      }
    }, 1000);
  }, [addEvent]);

  const handleImSafe = useCallback(() => {
    if (dmsTickRef.current) clearInterval(dmsTickRef.current);
    q.current.dmsActive = false;
    setShowDMS(false);
    addEvent({ type: "dms_confirmed", title: "User confirmed safe", color: "#00C853" });
    doEnd("SOS ended — User is safe");
  }, [addEvent, doEnd]);

  const handleStillDanger = useCallback(() => {
    if (dmsTickRef.current) clearInterval(dmsTickRef.current);
    q.current.dmsActive = false;
    q.current.dmsCheckNum += 1;
    q.current.nextDMSAt = q.current.monitorSec + DMS_GAP_SEC * q.current.dmsCheckNum;
    setShowDMS(false);
    setDmsCheckNum(q.current.dmsCheckNum);
    addEvent({ type: "dms_dismissed", title: `Still in danger — Check #${q.current.dmsCheckNum - 1}`, color: "#FF2D55" });
  }, [addEvent]);

  // ── Show CallingAdminView when SOS starts (employee mode, DURING work hours only) ──
  // Outside work hours → skip admin, go straight to personal contacts.
  useEffect(() => {
    if (mode === "employee" && duringWorkHours && phase === "starting" && !adminCallEmitted) {
      setShowAdminCall(true);
      setAdminCallEmitted(true);
    }
    // ── FIX 2: Show Personal SOS notice for individual users (auto-dismiss after 3s) ──
    if (mode === "individual" && phase === "calling" && !showPersonalSosNotice) {
      setShowPersonalSosNotice(true);
      // Auto-dismiss after 3 seconds — don't make user wait, SOS continues in background
      setTimeout(() => setShowPersonalSosNotice(false), 3000);
    }
    // Outside work hours for employees — show personal SOS notice instead of admin
    if (mode === "employee" && !duringWorkHours && phase === "calling" && !showPersonalSosNotice) {
      setShowPersonalSosNotice(true);
      setTimeout(() => setShowPersonalSosNotice(false), 3000);
    }
  }, [phase, adminCallEmitted, mode, showPersonalSosNotice, duringWorkHours]);

  // Main tick
  useEffect(() => {
    addEvent({ type: "sos_start", title: "SOS Activated", detail: "3-second hold trigger", color: "#FF2D55" });
    addEvent({ type: "location_share", title: "GPS tracking your location", detail: "Will be shared when someone answers", color: "#00C8E0" });
    // ── Haptic feedback: 2 short pulses every 30s to confirm data is being sent ──
    startHapticFeedback();
    // ── Immersive Mode: Lock screen to SOSphere only (hides status bar, nav bar, blocks notifications) ──
    try { (window as any).SOSphereNative?.setEmergencyActive(true); } catch {}

    // ── Switch GPS to emergency high-frequency mode (3s intervals) ──
    activateEmergencyTracking();

    // ══════════════════════════════════════════════════════════
    // PATH B: Server-side SOS trigger (fires in PARALLEL with local dialer)
    // Does NOT block or wait for Path A (local call).
    // ══════════════════════════════════════════════════════════
    triggerServerSOS({
      emergencyId: errIdRef.current,
      userId,
      userName,
      userPhone,
      contacts: contactsRef.current.map(c => ({ name: c.name, phone: c.phone, relation: c.relation })),
      bloodType: userBloodType,
      zone: userZone,
    }).then(result => {
      setServerResult(result);
      if (result.success) {
        console.log("[SOS] Path B (server) completed:", result.results?.length, "contacts processed");
        addEvent({ type: "sms_sent", title: "Server alerts sent", detail: `Tier: ${result.tier} · ${result.results?.length || 0} contacts`, color: "#00C8E0" });
      } else {
        console.warn("[SOS] Path B (server) failed:", result.error);
        // Server failure is non-fatal — local call (Path A) continues
      }
    }).catch(err => {
      console.warn("[SOS] Path B error (non-fatal):", err);
    });

    // ── Start Watchdog: if local dialer doesn't open in 5s → escalate ──
    startWatchdog((reason) => {
      console.warn("[SOS] Watchdog escalation:", reason);
      addEvent({ type: "sos_start", title: "Watchdog: local dialer failed", detail: reason, color: "#FF9500" });
      // Informational, not an error: watchdog only fires when we can't confirm
      // the native dialer launched locally — but Path B (server Twilio calls)
      // is already running in parallel, so the SOS is NOT failing. A red
      // "Local call failed" error on a panicking user is the wrong signal.
      toast.info(isAr ? "الخادم يواصل تنبيه جهاتك" : "Server is alerting your contacts");
    });

    // ── Auto-detect call answered/ended via native Android CallStateReceiver ──
    // IMPORTANT: On Android, OFFHOOK fires when dialing starts (not when someone answers).
    // We track: first OFFHOOK = dialing started, then IDLE = call ended.
    // If OFFHOOK lasted >5 seconds before IDLE, someone likely answered.
    let callDialStartTime = 0;
    const handleCallState = (e: Event) => {
      const state = (e as CustomEvent).detail?.state;
      console.log("[SOS] Native call state:", state, "phase:", q.current.phase, "dialStart:", callDialStartTime);

      if (state === "answered") {
        // OFFHOOK detected — record when dialing started
        callDialStartTime = Date.now();
        reportWatchdogEvent("dialer_ringing"); // Watchdog: call is ringing
        console.log("[SOS] Call dialing started (OFFHOOK)");
        // Do NOT mark as answered yet — OFFHOOK fires immediately when dialing
      } else if (state === "ended" && q.current.phase === "calling") {
        // Call ended — check if it lasted long enough to have been answered
        const callDuration = callDialStartTime > 0 ? (Date.now() - callDialStartTime) / 1000 : 0;
        console.log("[SOS] Call ended, duration:", callDuration, "seconds");
        if (callDuration >= 5) {
          // Call lasted >5 seconds — someone likely answered and talked
          console.log("[SOS] Call was answered (duration > 5s) — marking connected");
          manualAnswerRef.current = true;
        }
        // If <5s, it was probably rejected or went to voicemail — let timeout handle it
        callDialStartTime = 0;
      } else if (state === "ended" && q.current.phase !== "ended") {
        console.log("[SOS] Call ended during phase:", q.current.phase);
        callDialStartTime = 0;
      }
    };
    window.addEventListener("sosphere-call-state", handleCallState);

    // FIX FATAL-2: Reset last gasp flag on SOS start
    lastGaspSentRef.current = false;

    tickRef.current = setInterval(() => {
      const r = q.current;
      if (r.phase === "ended") return;
      r.elapsed += 1; r.phaseTimer += 1;
      if (r.isRecording)            r.recordingSec += 1;
      if (r.phase === "monitoring") r.monitorSec += 1;

      setElapsed(r.elapsed);
      setPhaseTimer(r.phaseTimer);
      if (r.isRecording)            setRecordingSec(r.recordingSec);

      // ── PHASE 1 SAFETY CAP: "during" mode can record across multiple phases,
      // so the existing per-phase cap at line ~2079 doesn't fire. Enforce the
      // tier REC_MAX here, regardless of current phase, ONLY for during/both
      // when the initial segment was kicked off early. "after" mode is untouched.
      if (
        r.isRecording &&
        duringRecordingStartedRef.current &&
        (recordingModeRef.current === "during" || recordingModeRef.current === "both") &&
        r.recordingSec >= REC_MAX &&
        r.phase !== "recording" // let the existing path handle post-call cap
      ) {
        r.isRecording = false; setIsRecording(false);
        stopRealRecording();
        duringRecordingStartedRef.current = false; // allow "both" to start segment #2 later
        addEvent({
          type: "recording_end",
          title: isAr ? "اكتمل التسجيل" : "Recording complete",
          detail: isAr ? `حد الخطة: ${REC_MAX} ثانية` : `Plan limit: ${REC_MAX}s`,
          color: "#00C853",
        });
      }

      if (r.phase === "monitoring") {
        setMonitorSec(r.monitorSec);
        if (!r.dmsActive && r.monitorSec >= r.nextDMSAt) openDMS();
      }

      // ── FIX FATAL-2: Battery last gasp — send final known position ──
      // Throttled: only emit BATTERY_CRITICAL if 5min passed since last emit
      const currentBattery = getBatteryLevel();
      if (currentBattery !== null && currentBattery <= 0.20) {
        const now = Date.now();
        if (now - lastBatteryCriticalEmit >= BATTERY_CRITICAL_COOLDOWN_MS) {
          lastBatteryCriticalEmit = now;
          lastGaspSentRef.current = true;
          const lastPos = getLastKnownPosition();
          console.log("[SUPABASE_READY] battery_critical_emitted");
          emitSyncEvent({
            type: "BATTERY_CRITICAL",
            employeeId: userId,
            employeeName: userName,
            zone: userZone,
            timestamp: now,
            data: {
              batteryLevel: Math.round(currentBattery * 100),
              lastPosition: lastPos,
              emergencyId: errIdRef.current,
              message: "Device battery critical — last known position transmitted",
            },
          });
          trackEventSync(errIdRef.current, "battery_critical",
            `Battery critically low (${Math.round((currentBattery || 0) * 100)}%) — last known position sent`,
            "System", "System",
            { batteryLevel: currentBattery, lastGPS: lastPos });
          addEvent({
            type: "system",
            title: "⚠️ Battery Critical",
            detail: `Battery at ${Math.round(currentBattery * 100)}% — final location shared with emergency contacts`,
            color: "#FF9500",
          });
        } else {
          console.log("[SUPABASE_READY] battery_critical_throttled");
        }
      }

      switch (r.phase) {
        case "starting":
          // FIX: Pause here while CallingAdminView is showing (employee mode).
          // Tick resumes when admin sheet is dismissed via adminCallPendingRef.
          if (adminCallPendingRef.current) break;
          if (r.phaseTimer >= 2) {
            r.phase = "calling"; r.phaseTimer = 0; r.currentIdx = 0;
            setPhase("calling"); setPhaseTimer(0); setCurrentIdx(0);
            updateContact(0, "calling");
            addEvent({ type: "call_out", title: `Calling ${contactsRef.current[0].name}`, detail: contactsRef.current[0].phone, color: "#00C8E0" });
            // ── PHASE 1: "during" / "both" mode — start recording at activation ──
            // Safe-guarded: only starts once, only if recordingEnabled, never interferes
            // with the post-call "after" recording path.
            if (
              recordingEnabled &&
              (recordingModeRef.current === "during" || recordingModeRef.current === "both") &&
              !duringRecordingStartedRef.current
            ) {
              duringRecordingStartedRef.current = true;
              r.isRecording = true; setIsRecording(true);
              addEvent({
                type: "recording_start",
                title: isAr ? "بدأ التسجيل — أثناء الحادثة" : "Recording started — during incident",
                detail: isAr ? "تسجيل محيطي كدليل · مشفّر" : "Ambient recording as evidence · Encrypted",
                color: "#FF2D55",
              });
              trackEventSync(errIdRef.current, "evidence_audio",
                `Voice recording started early (mode=${recordingModeRef.current})`,
                "System", "System",
                { mode: recordingModeRef.current });
              startRealRecording();
            }
            // ── CRITICAL FIX 1: Real user data in SOS event ──
            // FIX AUDIT-2.2: Include errIdRef so dashboard can match cancel→create by ID
            // [SUPABASE_READY] sos_trigger: insert into sos_events + realtime broadcast
            // Read device signal synchronously; battery is async so fire-and-forget
            const signalType = typeof navigator !== "undefined" && "connection" in navigator
              ? (navigator as any).connection?.effectiveType ?? "unknown"
              : "unknown";
            // FIX I: Include bypass flag if supervisor is being bypassed
            // Await SOS acknowledgment from dashboard
            (async () => {
              const ackResult = await emitSyncEvent({
                type: "SOS_TRIGGERED",
                employeeId: userId,
                employeeName: userName,
                zone: userZone,
                timestamp: Date.now(),
                data: {
                  phone: userPhone,
                  bloodType: userBloodType,
                  emergencyId: errIdRef.current,
                  battery: null,
                  signal: signalType,
                  bypassZoneAdmin: bypassSupervisor,
                  escalateTo: bypassSupervisor ? "company_admin" : undefined,
                  sensitiveReport: bypassSupervisor,
                }
              });
              // Check if dashboard received the signal
              if (ackResult && typeof ackResult === 'object' && 'delivered' in ackResult && !ackResult.delivered) {
                console.warn("[SOS] Dashboard did not acknowledge — signal may be queued for retry");
              }
            })();
            // ── SMART TIMELINE: Track SOS trigger ──
            trackEventSync(errIdRef.current, "sos_triggered",
              `SOS triggered by ${userName} in ${userZone}`,
              userName, "Employee",
              { phone: userPhone, bloodType: userBloodType, signal: signalType, mode });
            // Persist device data for dashboard IRE to read (sync first with signal only)
            saveEmployeeSync({ employeeId: userId, battery: null, signal: signalType, updatedAt: Date.now() });
            // Then async-update battery when available (non-blocking)
            if (typeof navigator !== "undefined" && "getBattery" in navigator) {
              (navigator as any).getBattery().then((b: any) => {
                const lvl = Math.round(b.level * 100);
                saveEmployeeSync({ employeeId: userId, battery: lvl, signal: signalType, updatedAt: Date.now() });
              }).catch((err) => {
                reportError(err, { type: "battery_api_failed", component: "SOSEmergency" }, "warning");
              });
            }
            // ── FIX 1: Buddy Alert — notify buddy partner via sync event ──
            if (mode === "employee") {
              const buddy = getBuddyFor(userId);
              if (buddy) {
                emitSyncEvent({
                  type: "BUDDY_ALERT",
                  employeeId: userId,
                  employeeName: userName,
                  zone: userZone,
                  timestamp: Date.now(),
                  data: { buddyId: buddy.buddyId, buddyName: buddy.buddyName, emergencyId: errIdRef.current },
                });
              }
            }
            // ── FIX 2: Individual SOS — emit PERSONAL_SOS for non-employee users ──
            if (mode === "individual") {
              emitSyncEvent({
                type: "PERSONAL_SOS",
                employeeId: userId,
                employeeName: userName,
                zone: userZone,
                timestamp: Date.now(),
                data: { phone: userPhone, emergencyId: errIdRef.current },
              });
            }
            autoBroadcastSOS(userName, userZone, errIdRef.current);
            // ── CRITICAL FIX 2: Queue SOS in IndexedDB + retry on network failure ──
            // triggerOfflineSOS stores to IndexedDB immediately, regardless of network.
            // The sync engine (offline-sync-engine.ts) will auto-retry with exponential
            // backoff when connection restores via enableAutoSync().
            triggerOfflineSOS(userId, userName, userZone);
          }
          break;

        case "calling": {
          const idx = r.currentIdx;
          // ── REAL CALL: Direct dial at second 1 (once per contact, bypasses OS chooser) ──
          if (r.phaseTimer === 1 && !r.dialerOpenedForIdx?.includes(idx)) {
            if (!r.dialerOpenedForIdx) r.dialerOpenedForIdx = [];
            r.dialerOpenedForIdx.push(idx);
            const phone = contactsRef.current[idx]?.phone;
            if (phone) {
              // Direct call via Capacitor CallNumber plugin (bypassAppChooser: true)
              directCall(phone).then(ok => {
                if (ok) {
                  reportWatchdogEvent("dialer_opened"); // Watchdog: Path A success
                } else {
                  reportError(new Error("directCall failed"), { type: "dialer_failed", phone: phone.slice(-4), component: "SOSEmergency" }, "warning");
                }
              });
              // ── SMS Tracking Link: Send web-viewer link to non-app contacts (Free tier gets this) ──
              if (hasFeature("webViewerLink") && !smsTrackingSentRef.current.includes(idx)) {
                smsTrackingSentRef.current.push(idx);
                const gps = getLastKnownPosition();
                if (gps) {
                  sendSOSTrackingLink(phone, userName, gps.lat, gps.lng).then(sent => {
                    if (sent) {
                      addEvent({ type: "sms_sent", title: `Tracking link sent to ${contactsRef.current[idx]?.name}`, detail: "Web-viewer link via SMS", color: "#00C8E0" });
                    }
                  });
                }
              }
              addEvent({ type: "call_out", title: `Dialing ${contactsRef.current[idx].name}`, detail: `Direct call: ${phone}`, color: "#00C8E0" });
              trackEventSync(errIdRef.current, "contact_called",
                `Calling emergency contact: ${contactsRef.current[idx].name} (${phone})`,
                "System", "System",
                { contactName: contactsRef.current[idx].name, contactPhone: phone, contactIndex: idx });
            }
          }
          // ── Answer detection: via manualAnswerRef (user presses "Connected" button) ──
          if (manualAnswerRef.current) {
            manualAnswerRef.current = false;
            const c = contactsRef.current[idx];
            r.phase = "answered"; r.phaseTimer = 0;
            setPhase("answered"); setPhaseTimer(0);
            updateContact(idx, "answered");
            setAnsweredContact({ ...c });
            addEvent({ type: "answered", title: `${c.name} answered`, color: "#00C853" });
            trackEventSync(errIdRef.current, "contact_answered",
              `${c.name} answered the call`,
              c.name, "Emergency Contact",
              { contactPhone: c.phone, responseTimeSec: q.current.elapsed });
          } else if (r.phaseTimer >= CALL_SEC) {
            // No answer after CALL_SEC seconds → move to next contact
            r.phase = "no_answer"; r.phaseTimer = 0;
            setPhase("no_answer"); setPhaseTimer(0);
            updateContact(idx, "no_answer");
            addEvent({ type: "no_answer", title: `${contactsRef.current[idx].name} — No answer (${CALL_SEC}s)`, color: "#FF9500" });
            trackEventSync(errIdRef.current, "contact_no_answer",
              `${contactsRef.current[idx].name} did not answer after ${CALL_SEC}s`,
              "System", "System",
              { contactName: contactsRef.current[idx].name, waitedSec: CALL_SEC });
          }
          break;
        }

        case "no_answer": {
          if (r.phaseTimer >= 1) {
            const next = r.currentIdx + 1;
            manualAnswerRef.current = false; // FIX: Clear stale answer flag before next contact
            callDialStartTime = 0; // FIX: Reset dial timer for next contact
            if (next < contactsRef.current.length) {
              r.phase = "calling"; r.phaseTimer = 0; r.currentIdx = next;
              setPhase("calling"); setPhaseTimer(0); setCurrentIdx(next);
              updateContact(next, "calling");
              addEvent({ type: "call_out", title: `Calling ${contactsRef.current[next].name}`, detail: contactsRef.current[next].phone, color: "#00C8E0" });
            } else {
              r.phase = "pausing"; r.phaseTimer = 0;
              setPhase("pausing"); setPhaseTimer(0);
              addEvent({ type: "pause_start", title: "All contacts unreachable", detail: `Retrying in ${PAUSE_SEC}s`, color: "#FF2D55" });
            }
          }
          break;
        }

        case "pausing":
          setPhaseTimer(r.phaseTimer);
          if (r.phaseTimer >= PAUSE_SEC) {
            // FIX: Cap retry cycles so the app doesn't loop dialing forever.
            // After MAX_CYCLES full passes with no answer, stop client-side dialing
            // and enter monitoring — the server-side chain (v14 /sos-alert) continues.
            if (r.cycle >= MAX_CYCLES) {
              r.phase = "monitoring"; r.phaseTimer = 0;
              setPhase("monitoring"); setPhaseTimer(0);
              addEvent({
                type: "pause_end",
                title: isAr
                  ? `انتهت محاولات الاتصال (${MAX_CYCLES} دورات)`
                  : `Max redial cycles reached (${MAX_CYCLES})`,
                detail: isAr
                  ? "المراقبة نشطة — الخادم يواصل المحاولة"
                  : "Monitoring active — server keeps trying",
                color: "#FF9500",
              });
              break;
            }
            r.cycle += 1; r.phase = "calling"; r.phaseTimer = 0; r.currentIdx = 0;
            r.dialerOpenedForIdx = []; // FIX: Reset dialer tracking so calls actually dial on retry cycles
            manualAnswerRef.current = false; // FIX: Clear stale answer flag from previous cycle
            callDialStartTime = 0; // FIX: Reset call timer for new cycle
            setCycle(r.cycle); setPhase("calling"); setPhaseTimer(0); setCurrentIdx(0);
            resetContacts(); updateContact(0, "calling");
            addEvent({ type: "pause_end", title: `Cycle ${r.cycle} — Retrying`, color: "#00C8E0" });
            addEvent({ type: "call_out", title: `Calling ${contactsRef.current[0].name}`, detail: contactsRef.current[0].phone, color: "#00C8E0" });
          }
          break;

        case "answered":
          // Send location to the person who answered (once)
          if (r.phaseTimer === 1 && !r.smsSent) {
            r.smsSent = true; setSmsSent(true); setLocationSent(true);
            addEvent({ type: "sms_sent", title: "Location shared", detail: `Google Maps · ${contactsRef.current.find(c => c.status === "answered")?.name || "Responder"}`, color: "#00C853" });
            addEvent({ type: "location_share", title: "Live GPS — updating every 30s", detail: "Responder can see your live location now", color: "#00C8E0" });
            emitSyncEvent({ type: "SOS_CONTACT_ANSWERED", employeeId: userId, employeeName: userName, zone: userZone, timestamp: Date.now(), data: { contactName: contactsRef.current.find(c => c.status === "answered")?.name, gpsTrailActive: true, phone: userPhone, bloodType: userBloodType } });
          }
          // After 15 seconds in answered state, move to recording (simulates call end)
          if (r.phaseTimer >= 15) {
            const mode = recordingModeRef.current;
            // "during" only — recording already running since activation. Skip the
            // post-call recording phase entirely and go straight to documenting.
            if (recordingEnabled && mode === "during") {
              r.phase = "documenting"; r.phaseTimer = 0;
              setPhase("documenting"); setPhaseTimer(0);
            }
            // "after" (default) — classic behavior: start recording now, post-call.
            // "both" (Elite) — stop the in-progress segment and start a fresh one,
            // so the user gets two clearly-separated evidence clips.
            else if (recordingEnabled && (mode === "after" || mode === "both")) {
              if (mode === "both" && duringRecordingStartedRef.current) {
                // finalize segment #1 (during-incident) before starting segment #2 (post-call)
                stopRealRecording();
                addEvent({
                  type: "recording_end",
                  title: isAr ? "انتهى مقطع التسجيل الأول" : "First recording segment ended",
                  detail: isAr ? "بدء تسجيل ما بعد المكالمة" : "Starting post-call segment",
                  color: "#00C853",
                });
              }
              r.isRecording = true; setIsRecording(true);
              r.phase = "recording"; r.phaseTimer = 0;
              setPhase("recording"); setPhaseTimer(0);
              addEvent({ type: "recording_start", title: "Call ended — Voice recording started", detail: "Ambient recording as evidence · Encrypted", color: "#FF2D55" });
              emitSyncEvent({ type: "SOS_RECORDING_STARTED", employeeId: userId, employeeName: userName, zone: userZone, timestamp: Date.now(), data: { maxDuration: REC_MAX, mode } });
              trackEventSync(errIdRef.current, "evidence_audio",
                `Voice recording started (max ${REC_MAX}s, mode=${mode})`,
                "System", "System",
                { maxDuration: REC_MAX, mode });
              // ── START REAL MICROPHONE RECORDING ──
              startRealRecording();
            } else {
              r.phase = "documenting"; r.phaseTimer = 0;
              setPhase("documenting"); setPhaseTimer(0);
            }
          }
          break;

        case "recording":
          if (r.recordingSec >= REC_MAX) {
            r.isRecording = false; setIsRecording(false);
            // ── STOP REAL MICROPHONE RECORDING ──
            stopRealRecording();
            addEvent({ type: "recording_end", title: "Recording complete", detail: "Uploaded securely · 60 seconds", color: "#00C853" });
            r.phase = "documenting"; r.phaseTimer = 0;
            setPhase("documenting"); setPhaseTimer(0);
          }
          break;

        case "documenting":
          // Stay in documenting until user submits or skips
          break;

        default: break;
      }
    }, 1000);

    return () => {
      if (tickRef.current)    clearInterval(tickRef.current);
      if (dmsTickRef.current) clearInterval(dmsTickRef.current);
      window.removeEventListener("sosphere-call-state", handleCallState);
    };
  }, []);

  // Derived
  const callRemaining  = Math.max(0, CALL_SEC - phaseTimer);
  const pauseRemaining = Math.max(0, PAUSE_SEC - phaseTimer);
  const currentContact = contacts[currentIdx] ?? null;
  const isConnected    = ["answered", "recording", "documenting", "monitoring"].includes(phase);
  const statusColor    = isConnected ? "#00C853" : phase === "pausing" ? "#FF9500" : "#FF2D55";

  // Status label below the GlowCircle.
  //
  // IMPORTANT — de-duplication rule:
  // The GlowCircle already renders the active contact's NAME + their call status
  // (e.g. "Ahmed · Calling · 30s"). Repeating that name here creates the same
  // info three times on screen. So for phases where GlowCircle owns the "who"
  // (calling / answered / monitoring), the status line here must describe the
  // PIPELINE state instead of re-stating the contact name.
  const statusLabel = () => {
    const answered = contacts.filter(c => c.status === "answered").length;
    const total    = contacts.length;
    if (phase === "starting")    return isAr ? "جاري تفعيل الطوارئ..." : "Activating Emergency...";
    if (phase === "calling")     return isAr
      ? `الاتصال بجهة ${currentIdx + 1} من ${total}`
      : `Calling contact ${currentIdx + 1} of ${total}`;
    if (phase === "no_answer")   return isAr ? "لم يردّ — ننتقل للتالي" : "No answer — moving to next";
    if (phase === "pausing")     return isAr
      ? `إعادة المحاولة خلال ${pauseRemaining}ث`
      : `Retrying in ${pauseRemaining}s`;
    if (phase === "answered")    return isAr
      ? `تم الرد — مشاركة الموقع`
      : `Answered — sharing location`;
    if (phase === "recording")   return isAr
      ? `جاري تسجيل الأدلة · ${fmt(recordingSec)} / ${fmt(REC_MAX)}`
      : `Recording evidence · ${fmt(recordingSec)} / ${fmt(REC_MAX)}`;
    if (phase === "documenting") return isAr ? "وثّق هذه الحادثة" : "Document this incident";
    if (phase === "monitoring") {
      // Civilian-friendly copy: tell the user exactly what happened
      // and what the system is still doing for them. No engineering jargon.
      if (answered > 0) {
        return isAr
          ? `ردّ ${answered} من ${total} — الخادم يواصل المتابعة`
          : `${answered} of ${total} answered — server keeps following up`;
      }
      return isAr
        ? `لم يردّ أحد — الخادم سيواصل المحاولة`
        : `No one answered yet — server still trying`;
    }
    return isAr ? "SOS نشط" : "SOS Active";
  };

  // ── Documenting handlers ──
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAddPhoto = () => {
    if (docPhotos.length >= PHOTO_MAX) {
      toast.info(isAr ? `الحد الأقصى ${PHOTO_MAX} صور` : `Maximum ${PHOTO_MAX} photos`);
      return;
    }
    // ── REAL CAMERA: Use native file input with camera capture ──
    // On mobile (Capacitor), this opens the device camera.
    // On desktop, it opens a file picker for photos.
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      if (docPhotos.length >= PHOTO_MAX) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setDocPhotos(prev => {
          if (prev.length >= PHOTO_MAX) return prev;
          return [...prev, dataUrl];
        });
        // Track evidence photo in timeline
        trackEventSync(errIdRef.current, "evidence_photo",
          `Evidence photo captured (${(file.size / 1024).toFixed(0)}KB)`,
          userName, "Employee",
          { fileSize: file.size, fileType: file.type, photoIndex: docPhotos.length + 1 });
      };
      reader.readAsDataURL(file);
    });

    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmitDoc = () => {
    setDocSubmitted(true);
    // [FIX] Sync refs so doEnd() can access them
    docPhotosRef.current = docPhotos;
    docCommentRef.current = docComment;
    addEvent({ type: "recording_end", title: "Incident documented", detail: `${docPhotos.length} photo(s) · ${docComment ? "Comment added" : "No comment"}`, color: "#00C853" });

    // [FIX] Store evidence in the Evidence Intelligence Pipeline
    // [SUPABASE_READY] evidence_upload: insert into evidence_vault + supabase.storage.upload(photos)
    try {
      const evidenceEntry = storeEvidence({
        emergencyId: errIdRef.current,
        submittedBy: userName,
        submittedAt: Date.now(),
        zone: userZone,
        severity: "high",
        incidentType: "SOS Emergency",
        workerComment: docComment || "No comment provided",
        photos: docPhotos.map((url, i) => ({
          id: `PHOTO-${Date.now()}-${i}`,
          dataUrl: url,
          caption: `Evidence photo ${i + 1}`,
          size: url.startsWith("data:") ? `${Math.round(url.length * 0.75 / 1024)}KB` : "unknown",
        })),
        audioMemo: q.current.recordingSec > 0 ? {
          id: `AUDIO-${Date.now()}`,
          // Use real MediaRecorder audio if available, otherwise mark as pending upload
          dataUrl: audioDataUrlRef.current || `pending://voice-${errIdRef.current}.webm`,
          durationSec: q.current.recordingSec,
          format: audioDataUrlRef.current
            ? (audioDataUrlRef.current.includes("audio/mp4") ? "mp4" : "webm")
            : "webm",
          transcription: audioDataUrlRef.current
            ? undefined  // Real audio — no transcription yet
            : "Recording captured — transcription pending upload",
        } : undefined,
        tier: isPremium ? "paid" : "free",
        retentionDays: isPremium ? 365 : 30,
      });
      evidenceIdRef.current = evidenceEntry.id;

      // ── Phase 5 — Chain-of-Custody SHA-256 manifest ──
      // Fire-and-forget: hashing runs in the background so submit UX
      // stays instant. On completion, the manifest is attached to the
      // vault entry and an action is appended. On failure (e.g. Web
      // Crypto unavailable or the entry has been evicted), we simply
      // log and move on — the pre-Phase-5 flow is untouched.
      if (isHashingAvailable()) {
        const capturedEvidenceId = evidenceEntry.id;
        const hashInput = {
          photos: docPhotos.map((url, i) => ({
            id: `PHOTO-${i}`, // index-stable id purely for manifest shape
            dataUrl: url,
          })),
          audio: audioDataUrlRef.current
            ? { dataUrl: audioDataUrlRef.current }
            : null,
          comment: docComment || null,
        };
        // Detached promise — do not await, do not block SOS flow.
        computeEvidenceManifest(hashInput)
          .then((manifest) => {
            if (manifest) {
              attachEvidenceManifest(capturedEvidenceId, manifest);
              trackEventSync(
                errIdRef.current,
                "evidence_hashed",
                `Integrity hash computed · manifest ${manifest.manifestHash.slice(0, 12)}…`,
                userName,
                "Employee",
                {
                  evidenceId: capturedEvidenceId,
                  algorithm: manifest.algorithm,
                  manifestHash: manifest.manifestHash,
                  photoCount: manifest.photoHashes.length,
                  hasAudio: !!manifest.audioHash,
                  hasComment: !!manifest.commentHash,
                }
              );
            }
          })
          .catch((e) => {
            console.warn("[SOS] Evidence hashing failed (non-fatal):", e);
          });
      }
    } catch (err) {
      console.warn("[SOS] Evidence store failed (non-fatal):", err);
    }

    // [FIX] Notify dashboard about documentation submission
    emitSyncEvent({
      type: "SOS_EVIDENCE_SUBMITTED",
      employeeId: userId,
      employeeName: userName,
      zone: userZone,
      timestamp: Date.now(),
      data: {
        emergencyId: errIdRef.current,
        photoCount: docPhotos.length,
        hasComment: !!docComment,
        hasRecording: q.current.recordingSec > 0,
        recordingDuration: q.current.recordingSec,
        evidenceId: evidenceIdRef.current,
      },
    });
    trackEventSync(errIdRef.current, "evidence_submitted",
      `Evidence submitted: ${docPhotos.length} photos${q.current.recordingSec > 0 ? ` + ${q.current.recordingSec}s voice recording` : ""}`,
      userName, "Employee",
      { photoCount: docPhotos.length, hasRecording: q.current.recordingSec > 0, evidenceId: evidenceIdRef.current });

    setTimeout(() => {
      q.current.phase = "monitoring"; q.current.phaseTimer = 0; q.current.monitorSec = 0;
      setPhase("monitoring"); setPhaseTimer(0); setMonitorSec(0);
    }, 1200);
  };

  const handleSkipDoc = () => {
    // [FIX] Sync empty refs so doEnd() records "skipped"
    docPhotosRef.current = [];
    docCommentRef.current = "";
    addEvent({ type: "recording_end", title: "Documentation skipped", color: "#FF9500" });
    q.current.phase = "monitoring"; q.current.phaseTimer = 0; q.current.monitorSec = 0;
    setPhase("monitoring"); setPhaseTimer(0); setMonitorSec(0);
  };

  function handleEndSOS() {
    // If deactivation PIN is enabled (Elite feature or custom-set), require PIN entry
    const storedPin = (() => { try { return localStorage.getItem("sosphere_deactivation_pin"); } catch { return null; } })();
    if (storedPin) {
      setShowCancel(false);
      setShowPinEntry(true);
      setPinInput("");
      setPinError(false);
      return;
    }
    // No PIN set — end immediately
    setShowCancel(false); setShowDMS(false);
    doEnd("SOS ended by user");
  }

  function handlePinSubmit() {
    // ── PHASE 2: Duress PIN check — MUST run before the normal PIN check.
    // If a duress PIN is configured and matches, we silently tag the end
    // event as duress=true and still close the SOS UI identically to a
    // normal deactivation so any coercer watching sees the same result.
    // Tier-gated: duressCode is Elite-only; if the feature isn't available
    // the duress PIN is ignored (defense-in-depth — even if a stale PIN
    // lingers in localStorage after a tier downgrade).
    if (isDuressFeatureAvailable() && isDuressPin(pinInput)) {
      setShowPinEntry(false);
      setShowDMS(false);
      // Broadcast DURESS flag to dashboard/contacts BEFORE ending locally.
      try {
        emitSyncEvent({
          type: "SOS_DURESS_TRIGGERED",
          employeeId: userId,
          employeeName: userName,
          zone: userZone,
          timestamp: Date.now(),
          data: {
            emergencyId: errIdRef.current,
            phone: userPhone,
            bloodType: userBloodType,
            reason: "duress_pin_entered",
          },
        });
      } catch {}
      trackEventSync(errIdRef.current, "duress_triggered",
        "Duress PIN entered — user is under coercion",
        userName, "Employee",
        { coercion: true });
      addEvent({
        type: "system",
        title: "⚠ Duress code acknowledged",
        detail: "Flag relayed to dashboard — UI ends normally",
        color: "#FF2D55",
      });
      // Use the SAME reason text as normal end so the incident record is
      // visually indistinguishable from a normal deactivation locally.
      // The distinguishing duress=true signal rides on the sync event above.
      doEnd("SOS ended by user (PIN verified)");
      return;
    }

    const storedPin = (() => { try { return localStorage.getItem("sosphere_deactivation_pin") || "1234"; } catch { return "1234"; } })();
    if (pinInput === storedPin) {
      setShowPinEntry(false);
      setShowDMS(false);
      doEnd("SOS ended by user (PIN verified)");
    } else {
      setPinError(true);
      setPinInput("");
      // Vibrate on wrong PIN
      try { navigator.vibrate?.([200]); } catch {}
      setTimeout(() => setPinError(false), 2000);
    }
  }

  // ═══ LOW BATTERY WARNING ═══
  // FIX 1: NON-BLOCKING during active SOS — show as banner, not modal
  // If SOS is active, battery modal should not steal focus or throttle background processes.
  // During active SOS, emit "last-gasp" GPS position instead.
  if (lowBattery && !criticalBattery && phase !== "ended") {
    // GUARD: If SOS is active (not idle), show compact banner instead of full-screen modal
    if (phase !== "idle") {
      // Emit last-gasp GPS position for battery-critical scenario
      if (phase === "triggered" || phase === "escalating") {
        const gps = getLastKnownPosition();
        if (gps) {
          emitSyncEvent({
            type: "GPS_LAST_GASP",
            employeeId: userId,
            data: { position: gps, reason: "low_battery", level: batteryLevelRef.current },
          });
        }
      }
      // Show compact banner, not blocking modal
      return (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0,
          height: 48, background: "linear-gradient(135deg, #FF9500, #FF7700)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999, fontSize: 13, color: "#fff", fontWeight: 600,
        }}>
          <AlertTriangle size={16} style={{ marginRight: 8 }} />
          {isAr ? "البطارية منخفضة — ابق بالقرب من مصدر كهربائي" : "Battery low — stay near power source"}
        </div>
      );
    }
    // Only show full-screen modal if idle (not during active SOS)
    return (
      <div className="flex flex-col items-center justify-center h-full p-6" style={{ background: "#1A0A00" }}>
        <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
          style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(255,149,0,0.15)",
            border: "3px solid #FF9500", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
          <AlertTriangle size={40} color="#FF9500" />
        </motion.div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "#FF9500", textAlign: "center", marginBottom: 8 }}>
          {isAr ? "البطارية منخفضة" : "Battery Low"}
        </h1>
        <p style={{ fontSize: 15, color: "rgba(255,255,255,0.7)", textAlign: "center", marginBottom: 24, lineHeight: 1.8 }}>
          {isAr ? "البطارية بين 20-35% — ابق بالقرب من مصدر كهربائي" : "Battery 20-35% — stay near power source"}
        </p>
        <button onClick={() => setLowBattery(false)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
            width: "100%", maxWidth: 280, height: 56, borderRadius: 16,
            background: "linear-gradient(135deg, #FF9500, #FF7700)", boxShadow: "0 8px 32px rgba(255,149,0,0.3)",
            color: "#fff", fontSize: 16, fontWeight: 700, textDecoration: "none", border: "none", cursor: "pointer" }}>
          {isAr ? "فهمت، تابع" : "I understand, continue"}
        </button>
      </div>
    );
  }

  // ═══ CRITICAL BATTERY MODE ═══
  // FIX 1: NON-BLOCKING during active SOS — show as compact banner, not full-screen modal
  // During active SOS, critical battery should NOT steal focus which could throttle background processes.
  if (criticalBattery && phase !== "ended") {
    // GUARD: If SOS is active (not idle), do NOT render full-screen modal — show banner instead
    if (phase !== "idle") {
      // Emit final last-gasp GPS position immediately
      const gps = getLastKnownPosition();
      if (gps) {
        emitSyncEvent({
          type: "GPS_LAST_GASP",
          employeeId: userId,
          data: { position: gps, reason: "critical_battery", level: batteryLevelRef.current },
        });
      }
      // Show compact critical banner at top, not blocking modal
      return (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0,
          height: 56, background: "linear-gradient(135deg, #FF2D55, #CC0033)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999, fontSize: 14, color: "#fff", fontWeight: 700,
          boxShadow: "0 4px 16px rgba(255,45,85,0.4)",
        }}>
          <AlertTriangle size={18} style={{ marginRight: 8 }} />
          {isAr ? "البطارية حرجة — أقل من 5%!" : "CRITICAL BATTERY — below 5%!"}
        </div>
      );
    }
    // Only show full-screen modal if idle (not during active SOS)
    return (
      <div className="flex flex-col items-center justify-center h-full p-6" style={{ background: "#1A0005" }}>
        <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
          style={{ width: 100, height: 100, borderRadius: "50%", background: "rgba(255,45,85,0.15)",
            border: "3px solid #FF2D55", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
          <AlertTriangle size={48} color="#FF2D55" />
        </motion.div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: "#FF2D55", textAlign: "center", marginBottom: 8 }}>
          {isAr ? "البطارية حرجة!" : "CRITICAL BATTERY!"}
        </h1>
        <p style={{ fontSize: 16, color: "rgba(255,255,255,0.7)", textAlign: "center", marginBottom: 32, lineHeight: 1.8 }}>
          {isAr ? "البطارية أقل من 5% — اتصل بالطوارئ الآن قبل ما ينطفئ الجهاز" : "Battery below 5% — call emergency services NOW before device shuts off"}
        </p>
        <button onClick={() => directCall("997")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
          width: "100%", maxWidth: 320, height: 64, borderRadius: 20, cursor: "pointer",
          background: "linear-gradient(135deg, #FF2D55, #CC0033)", boxShadow: "0 8px 32px rgba(255,45,85,0.4)",
          color: "#fff", fontSize: 22, fontWeight: 800, border: "none" }}>
          <Phone size={24} /> {isAr ? "اتصل 997 الآن" : "Call 997 NOW"}
        </button>
        <button onClick={() => directCall("911")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
          width: "100%", maxWidth: 320, height: 54, borderRadius: 16, marginTop: 12, cursor: "pointer",
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
          color: "#fff", fontSize: 18, fontWeight: 700 }}>
          <Phone size={20} /> {isAr ? "اتصل 911" : "Call 911"}
        </button>
        <button onClick={() => setCriticalBattery(false)}
          style={{ marginTop: 20, fontSize: 13, color: "rgba(255,255,255,0.3)", background: "none", border: "none" }}>
          {isAr ? "عودة لشاشة الطوارئ" : "Back to SOS screen"}
        </button>
      </div>
    );
  }

  // ═══ QUICK CONTACT SETUP ═══
  // If user has no emergency contacts, let them add one fast before SOS proceeds
  if (showQuickSetup) {
    return (
      <div className="flex flex-col h-full p-6" style={{ background: "#05070E" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 400, margin: "0 auto", width: "100%" }}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-center mb-4">
              <div style={{ width: 64, height: 64, borderRadius: 20, background: "rgba(255,150,0,0.1)",
                border: "2px solid rgba(255,150,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <AlertTriangle size={28} color="#FF9500" />
              </div>
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#fff", textAlign: "center", marginBottom: 6 }}>
              {isAr ? "لا يوجد جهات اتصال طوارئ!" : "No Emergency Contacts!"}
            </h2>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", textAlign: "center", lineHeight: 1.7, marginBottom: 24 }}>
              {isAr ? "أضف جهة اتصال واحدة على الأقل لنتمكن من الاتصال بها في حالة الطوارئ" : "Add at least one contact so we can call them in an emergency"}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input value={quickName} onChange={e => setQuickName(e.target.value)} placeholder={isAr ? "الاسم" : "Name"}
                style={{ height: 50, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff", fontSize: 15, padding: "0 16px", fontFamily: "inherit", direction: isAr ? "rtl" : "ltr" }} />
              <input value={quickPhone} onChange={e => setQuickPhone(e.target.value)} placeholder={isAr ? "رقم الهاتف" : "Phone number"}
                type="tel" inputMode="tel" dir="ltr"
                style={{ height: 50, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff", fontSize: 15, padding: "0 16px", fontFamily: "'Outfit', monospace" }} />
              <input value={quickRelation} onChange={e => setQuickRelation(e.target.value)} placeholder={isAr ? "الصلة (اختياري) — مثال: زوجة، أخ" : "Relation (optional) — e.g. Wife, Brother"}
                style={{ height: 50, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff", fontSize: 15, padding: "0 16px", fontFamily: "inherit", direction: isAr ? "rtl" : "ltr" }} />
            </div>

            <motion.button whileTap={{ scale: 0.97 }} onClick={handleQuickSetupSave}
              disabled={!quickName.trim() || !quickPhone.trim()}
              style={{ width: "100%", height: 54, borderRadius: 16, marginTop: 20,
                background: quickName.trim() && quickPhone.trim() ? "linear-gradient(135deg, #FF2D55, #CC0033)" : "rgba(255,255,255,0.04)",
                color: quickName.trim() && quickPhone.trim() ? "#fff" : "rgba(255,255,255,0.2)",
                fontSize: 16, fontWeight: 700, boxShadow: quickName.trim() && quickPhone.trim() ? "0 8px 28px rgba(255,45,85,0.3)" : "none" }}>
              {isAr ? "حفظ وبدء الطوارئ" : "Save & Start Emergency"}
            </motion.button>

            <button onClick={() => { setShowQuickSetup(false); }}
              style={{ marginTop: 12, width: "100%", height: 44, borderRadius: 14,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
              {isAr ? "تخطي — متابعة بدون جهات اتصال" : "Skip — continue without contacts"}
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        // Full-screen opaque overlay — guarantees nothing (Home / status bar /
        // nav) bleeds through on any device. Covers notches via safe-area
        // padding-top. z-index sits BELOW the Emergency Chat (z-50) and chat
        // fullscreen (z-200) so those stay accessible during a live SOS.
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 40,
        background: "#05070E",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >

      {/* Ambient background — subtle radial glow */}
      <motion.div
        animate={{ opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 4, repeat: Infinity }}
        className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none"
        style={{ width: 500, height: 500, background: `radial-gradient(ellipse, ${statusColor}08 0%, transparent 65%)`, transition: "background 1.5s" }}
      />

      {/* FIX I: Bypass Supervisor Modal */}
      <AnimatePresence>
        {showBypassOption && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: "rgba(5,7,14,0.98)", backdropFilter: "blur(12px)" }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-md p-6 rounded-3xl"
              style={{
                background: "linear-gradient(135deg, rgba(0,200,224,0.10), rgba(0,200,224,0.05))",
                border: "1.5px solid rgba(0,200,224,0.3)",
                boxShadow: "0 20px 60px rgba(0,200,224,0.3)",
              }}
            >
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 p-4 rounded-full" style={{ background: "rgba(0,200,224,0.15)" }}>
                  <Shield className="size-8" style={{ color: "#00C8E0" }} />
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 8 }}>
                  {isAr ? "خيارات الإبلاغ الآمن" : "Safe Reporting Options"}
                </h2>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, marginBottom: 24 }}>
                  {isAr ? "إذا كان مشرفك جزءاً من المشكلة، يمكنك تجاوزه والإبلاغ لمسؤول الشركة مباشرة." : "If your supervisor is involved in the emergency, you can bypass them and report directly to company admin."}
                </p>
                <div className="flex flex-col gap-3 w-full">
                  <button
                    onClick={() => {
                      setBypassSupervisor(true);
                      setShowBypassOption(false);
                      toast.success(isAr ? "تجاوز المشرف — الإبلاغ لمسؤول الشركة" : "Bypassing supervisor — reporting to company admin", {
                        description: isAr ? "لن يُبلَّغ مشرفك" : "Your supervisor will NOT be notified",
                        duration: 5000,
                      });
                    }}
                    className="px-6 py-4 rounded-xl"
                    style={{ background: "linear-gradient(135deg, #FF9500, #E67E00)", boxShadow: "0 4px 16px rgba(255,149,0,0.4)" }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>
                      {isAr ? "نعم، تجاوز المشرف" : "Yes, Bypass Supervisor"}
                    </span>
                  </button>
                  <button
                    onClick={() => { setBypassSupervisor(false); setShowBypassOption(false); }}
                    className="px-6 py-3 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>
                      {isAr ? "لا، SOS عادي" : "No, Normal SOS"}
                    </span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════
          HEADER — status chip | telemetry rail | elapsed timer
          Redesigned to stay balanced at all widths: the center rail only
          holds tiny indicators (GPS / REC / NET) so the left status chip
          and right timer sit flush at the edges and don't wrap.
          ══════════════════════════════════════════════════════════════════ */}
      <div className="shrink-0 px-5 pt-12 pb-3">
        <div className="flex items-center gap-3">
          {/* LEFT — Status chip (phase-driven color, tier-aware label) */}
          <div className="flex items-center gap-2 px-3 py-1.5" style={{
            borderRadius: 100,
            background: `${statusColor}12`,
            border: `1px solid ${statusColor}30`,
            boxShadow: `0 2px 10px ${statusColor}14`,
          }}>
            <motion.div
              animate={{ opacity: [1, 0.2, 1], scale: [1, 1.25, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
              className="size-2 rounded-full"
              style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }}
            />
            <span style={{
              fontSize: 10, fontWeight: 800, color: statusColor,
              letterSpacing: "0.6px", whiteSpace: "nowrap",
            }}>
              {isConnected
                ? (isAr ? "متصل" : "CONNECTED")
                : phase === "pausing"
                  ? (isAr ? "إعادة محاولة" : "RETRYING")
                  : phase === "documenting"
                    ? (isAr ? "توثيق" : "DOCUMENTING")
                    : phase === "recording"
                      ? (isAr ? "تسجيل" : "RECORDING")
                      : (isAr ? "طوارئ نشطة" : "ACTIVE")}
            </span>
          </div>

          {/* CENTER — telemetry rail, compact and balanced */}
          <div className="flex-1 flex items-center justify-center gap-2" style={{
            height: 26, borderRadius: 99,
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.04)",
          }}>
            {/* GPS */}
            <div className="flex items-center gap-1" title="GPS">
              <motion.div
                animate={{ opacity: getLastKnownPosition() ? [1, 0.35, 1] : 1 }}
                transition={{ duration: 2, repeat: Infinity }}
                className="size-1.5 rounded-full"
                style={{ background: getLastKnownPosition() ? "#00C853" : "#FF9500" }}
              />
              <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.3px" }}>GPS</span>
            </div>
            <div style={{ width: 1, height: 10, background: "rgba(255,255,255,0.06)" }} />
            {/* REC */}
            <div className="flex items-center gap-1" title="Recording">
              <motion.div
                animate={{ opacity: isRecording ? [1, 0.15, 1] : 1 }}
                transition={{ duration: 0.8, repeat: Infinity }}
                className="size-1.5 rounded-full"
                style={{ background: isRecording ? "#FF2D55" : "rgba(255,255,255,0.12)" }}
              />
              <span style={{ fontSize: 9, fontWeight: 700, color: isRecording ? "rgba(255,45,85,0.75)" : "rgba(255,255,255,0.25)", letterSpacing: "0.3px" }}>REC</span>
            </div>
            <div style={{ width: 1, height: 10, background: "rgba(255,255,255,0.06)" }} />
            {/* NET — server-trigger confirmation (today's v14 logic) */}
            <div className="flex items-center gap-1" title="Server alert">
              <motion.div
                animate={{ opacity: smsSent ? 1 : [1, 0.3, 1] }}
                transition={{ duration: 1.6, repeat: smsSent ? 0 : Infinity }}
                className="size-1.5 rounded-full"
                style={{ background: smsSent ? "#00C853" : "#00C8E0" }}
              />
              <span style={{ fontSize: 9, fontWeight: 700, color: smsSent ? "rgba(0,200,83,0.75)" : "rgba(0,200,224,0.75)", letterSpacing: "0.3px" }}>NET</span>
            </div>
          </div>

          {/* RIGHT — elapsed timer, monospace */}
          <span style={{
            fontSize: 15, fontWeight: 700,
            color: "rgba(255,255,255,0.5)",
            fontVariantNumeric: "tabular-nums",
            fontFamily: "'Outfit', monospace",
            minWidth: 52, textAlign: "right",
          }}>{fmt(elapsed)}</span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TIER PIPELINE — Admin → Owner → Emergency Services
          Reflects server-side resolveTier() + client escalationLevel.
          Only rendered for employee mode (individual mode has no chain).
          ══════════════════════════════════════════════════════════════════ */}
      <TierPipeline
        level={escalationLevel}
        mode={mode}
        isAr={isAr}
        escalationTimer={escalationTimer}
        thresholdSec={ESCALATION_THRESHOLD_SEC}
      />

      {/* ══════════════════════════════════════════════════════════════════
          SCROLLABLE CENTER — GlowCircle + phase-specific content
          ══════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto flex flex-col" style={{ WebkitOverflowScrolling: "touch" }}>

        {/* Bypass supervisor link — starting phase only */}
        {phase === "starting" && mode === "employee" && !bypassSupervisor && (
          <div className="px-5 mb-1 text-center">
            <button onClick={() => setShowBypassOption(true)} style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", background: "none", border: "none", textDecoration: "underline" }}>
              {isAr ? "المشرف جزء من المشكلة؟ →" : "Supervisor involved? →"}
            </button>
          </div>
        )}

        {/* ── GLOW CIRCLE — the hero element ── */}
        <div className="shrink-0 flex justify-center" style={{ paddingTop: phase === "documenting" ? 8 : 20, paddingBottom: 8 }}>
          <GlowCircle
            phase={phase}
            currentContact={currentContact}
            answeredContact={answeredContact}
            callRemaining={callRemaining}
            pauseRemaining={pauseRemaining}
            recordingSec={recordingSec}
            isRecording={isRecording}
            userAvatar={userAvatar}
            userName={userName}
          />
        </div>

        {/* ── Status text below circle ── */}
        <div className="text-center px-5 mb-4">
          <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>{statusLabel()}</p>
          {cycle > 1 && <p style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", marginTop: 2 }}>{isAr ? `الدورة ${cycle}` : `Cycle ${cycle}`}</p>}
        </div>

        {/* ── DOCUMENTING PHASE — photos + comment ── */}
        <AnimatePresence>
          {phase === "documenting" && !docSubmitted && (
            <motion.div
              key="doc-phase"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, type: "spring", stiffness: 300, damping: 28 }}
              className="shrink-0 mx-5 mb-3 space-y-3"
            >
              <div className="px-4 py-3" style={{ borderRadius: 14, background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.12)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <Camera style={{ width: 14, height: 14, color: "#00C8E0" }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>{isAr ? "وثّق الحادثة" : "Document the Incident"}</span>
                </div>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                  {isAr ? "التقط صور وأضف تعليق. سيُرفق كدليل." : "Take photos and add a comment — attached as evidence."}
                </p>
              </div>
              <div className="flex gap-2 items-center">
                {docPhotos.map((photo, i) => (
                  <motion.div key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 25, delay: i * 0.1 }}
                    className="size-16 rounded-xl overflow-hidden relative" style={{ border: "1.5px solid rgba(0,200,224,0.2)" }}>
                    <ImageWithFallback src={photo} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute top-0.5 right-0.5 size-4 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,83,0.9)" }}>
                      <CheckCircle style={{ width: 10, height: 10, color: "#fff" }} />
                    </div>
                  </motion.div>
                ))}
                <input ref={fileInputRef} type="file" accept="image/*" capture="environment" multiple onChange={handlePhotoCapture} style={{ display: "none" }} />
                {docPhotos.length < PHOTO_MAX && (
                  <motion.button whileTap={{ scale: 0.92 }} onClick={handleAddPhoto}
                    className="size-16 rounded-xl flex flex-col items-center justify-center gap-1"
                    style={{ border: "1.5px dashed rgba(0,200,224,0.25)", background: "rgba(0,200,224,0.03)" }}>
                    <Camera style={{ width: 16, height: 16, color: "#00C8E0" }} />
                    <span style={{ fontSize: 8, color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>
                      {docPhotos.length === 0 ? (isAr ? "صورة" : "Photo") : `${PHOTO_MAX - docPhotos.length}`}
                    </span>
                  </motion.button>
                )}
              </div>
              <div style={{ borderRadius: 12, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <textarea value={docComment} onChange={(e) => setDocComment(e.target.value)}
                  placeholder={isAr ? "صف ما حدث... (اختياري)" : "Describe what happened... (optional)"}
                  maxLength={2000} rows={2}
                  style={{ width: "100%", padding: "10px 12px", background: "transparent", border: "none", outline: "none", resize: "none", fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "inherit" }} />
              </div>
              <div className="flex gap-2">
                <motion.button whileTap={{ scale: 0.96 }} onClick={handleSubmitDoc}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                  style={{ background: docPhotos.length > 0 || docComment ? "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.04))" : "rgba(0,200,224,0.06)",
                    border: `1.5px solid ${docPhotos.length > 0 || docComment ? "rgba(0,200,224,0.3)" : "rgba(0,200,224,0.12)"}` }}>
                  <Send style={{ width: 13, height: 13, color: "#00C8E0" }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>{isAr ? "إرسال" : "Submit"}</span>
                </motion.button>
                <button onClick={handleSkipDoc}
                  className="flex items-center justify-center px-4 py-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.25)" }}>{isAr ? "تخطي" : "Skip"}</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submitted confirmation */}
        <AnimatePresence>
          {phase === "documenting" && docSubmitted && (
            <motion.div key="doc-submitted" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="shrink-0 mx-5 mb-3 flex items-center gap-3 px-4 py-3"
              style={{ borderRadius: 14, background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}>
              <CheckCircle style={{ width: 18, height: 18, color: "#00C853" }} />
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,200,83,0.9)" }}>{isAr ? "تم رفع الأدلة" : "Evidence submitted"}</p>
                <p style={{ fontSize: 10, color: "rgba(0,200,83,0.5)" }}>{docPhotos.length} {isAr ? "صورة" : "photo(s)"}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── CALL QUEUE — contacts in the current tier, ordered by call position ──
            Replaces the old scattered pills layout. Renders as a single
            compact panel with a header row ("Calling queue · N contacts")
            followed by a neatly aligned list where each row shows:
              [position #] [avatar] [name + relation] [status badge / timer]
            The active contact is highlighted with a subtle glow that matches
            statusColor (the same phase-driven color used by the header chip).
        */}
        {phase !== "documenting" && contacts.length > 0 && (
          <div className="shrink-0 px-5 mb-3">
            <div style={{
              borderRadius: 16,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
              overflow: "hidden",
            }}>
              {/* Queue header */}
              <div className="flex items-center justify-between px-4 py-2" style={{
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                background: "rgba(255,255,255,0.015)",
              }}>
                <div className="flex items-center gap-2">
                  <Users style={{ width: 12, height: 12, color: "rgba(255,255,255,0.4)" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.4px" }}>
                    {isAr ? "قائمة الاتصال" : "CALL QUEUE"}
                  </span>
                  {/* Retry-cycle counter — user-visible proof that we stop
                      after MAX_CYCLES instead of looping forever. */}
                  {cycle > 0 && phase !== "monitoring" && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: "rgba(255,150,0,0.75)",
                      background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.2)",
                      padding: "2px 6px", borderRadius: 99, letterSpacing: "0.3px",
                    }}>
                      {isAr ? `جولة ${cycle + 1}/${MAX_CYCLES}` : `Round ${cycle + 1}/${MAX_CYCLES}`}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>
                  {contacts.filter(c => c.status === "answered").length}
                  <span style={{ color: "rgba(255,255,255,0.15)" }}> / </span>
                  {contacts.length}
                </span>
              </div>

              {/* Queue rows */}
              <div>
                {contacts.map((c, i) => {
                  const isActive  = phase === "calling" && i === currentIdx;
                  const isAnswered = c.status === "answered";
                  const isMissed   = c.status === "no_answer";
                  const isPending  = !isActive && !isAnswered && !isMissed;

                  const sc = isAnswered ? "#00C853" : isMissed ? "#FF9500" : isActive ? statusColor : "rgba(255,255,255,0.22)";

                  return (
                    <motion.div
                      key={c.id}
                      layout
                      className="flex items-center gap-3 px-4 py-2.5"
                      style={{
                        background: isActive ? `${sc}0F` : "transparent",
                        borderBottom: i === contacts.length - 1 ? "none" : "1px solid rgba(255,255,255,0.03)",
                        transition: "background 0.3s",
                      }}
                    >
                      {/* Position number */}
                      <div className="shrink-0 flex items-center justify-center" style={{
                        width: 22, height: 22, borderRadius: 99,
                        background: isActive ? `${sc}22` : isAnswered ? "rgba(0,200,83,0.1)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${sc}${isActive ? "55" : "22"}`,
                      }}>
                        {isAnswered ? (
                          <CheckCircle style={{ width: 11, height: 11, color: sc }} />
                        ) : isMissed ? (
                          <PhoneMissed style={{ width: 11, height: 11, color: sc }} />
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 800, color: sc, fontFamily: "'Outfit', monospace" }}>{i + 1}</span>
                        )}
                      </div>

                      {/* Avatar — real image if present, else a polished
                          initials bubble with a deterministic gradient.
                          Avoids the generic grey "broken image" placeholder
                          when a contact has no photo (which is the common case). */}
                      {(() => {
                        const initials = (c.name || "?")
                          .split(/\s+/).filter(Boolean).slice(0, 2)
                          .map(w => w[0]).join("").toUpperCase() || "?";
                        // Deterministic hue from the name so each contact keeps
                        // the same color across re-renders.
                        const hue = (c.name || "")
                          .split("").reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
                        return (
                          <div
                            className="shrink-0 rounded-full overflow-hidden flex items-center justify-center"
                            style={{
                              width: 30, height: 30,
                              border: `1.5px solid ${sc}${isPending ? "33" : "88"}`,
                              opacity: isPending ? 0.6 : 1,
                              background: c.avatar
                                ? "transparent"
                                : `linear-gradient(135deg, hsl(${hue} 60% 40%), hsl(${(hue + 40) % 360} 55% 28%))`,
                              boxShadow: isActive ? `0 0 8px ${sc}44` : "none",
                            }}
                          >
                            {c.avatar ? (
                              <ImageWithFallback src={c.avatar} alt={c.name} className="w-full h-full object-cover" />
                            ) : (
                              <span
                                style={{
                                  fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.95)",
                                  letterSpacing: "0.3px", fontFamily: "'Outfit', sans-serif",
                                }}
                              >{initials}</span>
                            )}
                          </div>
                        );
                      })()}

                      {/* Name + relation */}
                      <div className="flex-1 min-w-0">
                        <div style={{
                          fontSize: 13, fontWeight: 700,
                          color: isActive ? "#fff" : isAnswered ? "#fff" : isMissed ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.55)",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {c.name}
                        </div>
                        {c.relation && (
                          <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.28)", marginTop: 1 }}>
                            {c.relation}
                          </div>
                        )}
                      </div>

                      {/* Status badge */}
                      <div className="shrink-0">
                        {isActive && (
                          <motion.div
                            animate={{ opacity: [1, 0.6, 1] }}
                            transition={{ duration: 1.2, repeat: Infinity }}
                            className="flex items-center gap-1.5 px-2 py-1"
                            style={{ borderRadius: 99, background: `${sc}1A`, border: `1px solid ${sc}44` }}
                          >
                            <Phone style={{ width: 10, height: 10, color: sc }} />
                            <span style={{ fontSize: 11, fontWeight: 800, color: sc, fontFamily: "'Outfit', monospace" }}>
                              {callRemaining}s
                            </span>
                          </motion.div>
                        )}
                        {isAnswered && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(0,200,83,0.7)", letterSpacing: "0.4px" }}>
                            {isAr ? "ردّ" : "ANSWERED"}
                          </span>
                        )}
                        {isMissed && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,150,0,0.7)", letterSpacing: "0.4px" }}>
                            {isAr ? "لم يردّ" : "NO ANSWER"}
                          </span>
                        )}
                        {isPending && (
                          <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.25)", letterSpacing: "0.4px" }}>
                            {isAr ? "بالانتظار" : "PENDING"}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Recording banner — only when actively recording ── */}
        <AnimatePresence>
          {phase === "recording" && recordingEnabled && (
            <motion.div key="rec-bar" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="shrink-0 mx-5 mb-3">
              <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderRadius: 14, background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.18)" }}>
                <motion.div animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
                  <Mic style={{ width: 14, height: 14, color: "#FF2D55", filter: "drop-shadow(0 0 4px #FF2D55)" }} />
                </motion.div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#FF6060" }}>
                      {isAr ? "تسجيل" : "Recording"} {fmt(recordingSec)}
                    </span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{fmt(REC_MAX)}</span>
                  </div>
                  <div style={{ height: 2, borderRadius: 99, background: "rgba(255,255,255,0.06)" }}>
                    <motion.div style={{ height: "100%", borderRadius: 99, background: "linear-gradient(90deg, #FF2D55, #FF6080)" }}
                      animate={{ width: `${(recordingSec / REC_MAX) * 100}%` }} transition={{ duration: 1, ease: "linear" }} />
                  </div>
                </div>
                <div className="flex items-center gap-[2px] shrink-0">
                  {[4, 8, 6, 10, 7].map((h, i) => (
                    <motion.div key={i} animate={{ height: [h, h + 5, h] }} transition={{ duration: 0.4, repeat: Infinity, delay: i * 0.07 }}
                      style={{ width: 2, borderRadius: 1, background: "rgba(255,45,85,0.5)", minHeight: h }} />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Pause countdown ── */}
        <AnimatePresence>
          {phase === "pausing" && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="shrink-0 mx-5 mb-3">
              <div className="px-4 py-2.5" style={{ borderRadius: 14, background: "rgba(255,150,0,0.05)", border: "1px solid rgba(255,150,0,0.12)" }}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <RefreshCw style={{ width: 11, height: 11, color: "#FF9500" }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#FF9500" }}>
                      {isAr ? `إعادة المحاولة · جولة ${cycle + 1}/${MAX_CYCLES}` : `Retrying · Round ${cycle + 1}/${MAX_CYCLES}`}
                    </span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#FF9500" }}>{pauseRemaining}s</span>
                </div>
                {/* Explain what the user is about to see: Android's native
                    dialer will appear again when the next call fires. This
                    prevents the "why is Contacts/Zoom popping up again?!"
                    confusion the user reported. */}
                <p style={{ fontSize: 10, color: "rgba(255,150,0,0.65)", marginTop: 2, lineHeight: 1.3 }}>
                  {isAr
                    ? "سيفتح نظام الهاتف شاشة الاتصال تلقائياً (زر جهات الاتصال من نظام أندرويد، ليس من التطبيق)."
                    : "Android's system dialer will re-open automatically (Contacts button is from Android, not from this app)."}
                </p>
                <div style={{ height: 2, borderRadius: 99, background: "rgba(255,255,255,0.05)" }}>
                  <div style={{ height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#FF9500,#FF7700)", width: `${((PAUSE_SEC - pauseRemaining) / PAUSE_SEC) * 100}%`, transition: "width 1s linear" }} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Spacer to push bottom actions down */}
        <div className="flex-1" />

      </div>{/* end scrollable middle */}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM ACTION BAR — consolidated, context-aware
          Layout priority (top-to-bottom):
            1) Status strip — ONE line that communicates server state
               (monitoring / location sent / auto-escalated / recording)
            2) Secondary row — Incident Log + Escalate (side-by-side)
            3) Primary row  — End Emergency (large destructive)
            4) Disclaimer   — single subtle line
          All reactive to today's v14 server-orchestration state
          (smsSent ← sos-alert response, answeredContact ← Twilio status).
          ══════════════════════════════════════════════════════════════════ */}
      <div
        className="shrink-0 px-5"
        style={{
          paddingTop: 8,
          // Reserve room for BOTH the device home-bar gesture area AND the
          // Emergency Chat collapsed pill (z-50, ~64px tall incl. its own
          // safe-area). 24px fallback for older Androids where CSS env()
          // reports 0 and would otherwise clip the End Emergency button.
          paddingBottom: "calc(env(safe-area-inset-bottom, 24px) + 16px + 64px)",
        }}
      >

        {/* ── 1. STATUS STRIP — collapses multiple separate banners into one ── */}
        {(() => {
          // Pick the single most relevant status message (priority order).
          let msg: { icon: any; color: string; text: string; pulse?: boolean } | null = null;

          if (smsSent && answeredContact) {
            msg = {
              icon: CheckCircle,
              color: "#00C853",
              text: isAr ? `تم إرسال الموقع · ${answeredContact.name} ردّ` : `Location sent · ${answeredContact.name} answered`,
            };
          } else if (smsSent) {
            msg = {
              icon: CheckCircle,
              color: "rgba(0,200,224,0.85)",
              text: isAr ? "تم تنبيه الخادم — جاري الاتصال بالتسلسل" : "Server alerted — dialing chain",
              pulse: true,
            };
          } else if (phase === "monitoring" && recordingEnabled && !isRecording) {
            msg = {
              icon: CheckCircle,
              color: "#00C853",
              text: isAr ? "التسجيل اكتمل — المراقبة مستمرة" : "Recording saved — monitoring active",
            };
          } else if (autoEscalated) {
            msg = {
              icon: RefreshCw,
              color: "#FF9500",
              text: isAr ? "تم التصعيد تلقائياً للمالك" : "Auto-escalated to Owner",
            };
          }

          if (!msg) return null;
          const Icon = msg.icon;
          return (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-3 py-2 mb-2"
              style={{
                borderRadius: 12,
                background: `${msg.color}0D`,
                border: `1px solid ${msg.color}22`,
              }}
            >
              <motion.div
                animate={msg.pulse ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
                transition={{ duration: 1.4, repeat: msg.pulse ? Infinity : 0 }}
              >
                <Icon style={{ width: 12, height: 12, color: msg.color }} />
              </motion.div>
              <span style={{ fontSize: 11, fontWeight: 600, color: msg.color, letterSpacing: "-0.1px" }}>{msg.text}</span>
            </motion.div>
          );
        })()}

        {/* ── 2. SECONDARY ROW — Incident Log + Escalate (employees only) ── */}
        <div className="flex gap-2 mb-2">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowIncidentOverlay(true)}
            className="flex-1 flex items-center justify-center gap-1.5"
            style={{
              height: 42, borderRadius: 12,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <FileText style={{ width: 13, height: 13, color: "rgba(255,255,255,0.45)" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.55)" }}>
              {isAr ? "سجل الحادث" : "Incident Log"}
            </span>
          </motion.button>

          {mode === "employee" && phase !== "answered" && phase !== "ended" && escalationLevel !== "emergency_services" && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleManualEscalate}
              className="flex-1 flex items-center justify-center gap-1.5"
              style={{
                height: 42, borderRadius: 12,
                background: escalationLevel === "admin" ? "rgba(255,150,0,0.08)" : "rgba(255,45,85,0.1)",
                border: `1px solid ${escalationLevel === "admin" ? "rgba(255,150,0,0.25)" : "rgba(255,45,85,0.28)"}`,
              }}
            >
              <AlertTriangle style={{ width: 13, height: 13, color: escalationLevel === "admin" ? "#FF9500" : "#FF2D55" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: escalationLevel === "admin" ? "#FF9500" : "#FF2D55" }}>
                {escalationLevel === "admin"
                  ? (isAr ? "تصعيد للمالك" : "Escalate to Owner")
                  : (isAr ? "اتصل 911/997" : "Call 911/997")}
              </span>
            </motion.button>
          )}
        </div>

        {/* ── 3. PRIMARY — End Emergency (large destructive, high visual weight) ── */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setShowCancel(true)}
          className="w-full flex items-center justify-center gap-2"
          style={{
            height: 52, borderRadius: 16,
            background: "linear-gradient(135deg, rgba(255,45,85,0.09), rgba(255,45,85,0.04))",
            border: "1.5px solid rgba(255,45,85,0.22)",
            color: "#FF2D55",
            fontSize: 15, fontWeight: 700,
            boxShadow: "0 6px 24px rgba(255,45,85,0.08)",
          }}
        >
          <X style={{ width: 15, height: 15 }} />
          {isAr ? "إنهاء الطوارئ" : "End Emergency"}
        </motion.button>

        {/* ── 4. Disclaimer ── */}
        <p style={{
          fontSize: 9, color: "rgba(255,255,255,0.18)",
          textAlign: "center", lineHeight: 1.5, marginTop: 8,
          letterSpacing: "0.1px",
        }}>
          {isAr ? "نموذج أولي — ليس بديلاً عن 911 / 997 / 112" : "Prototype only — not a replacement for 911 / 997 / 112"}
        </p>
      </div>

      {/* DMS MODAL */}
      <AnimatePresence>
        {showDMS && (
          <div>
            <motion.div key="dms-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(16px)" }}
            />
            <motion.div key="dms-sheet"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 36 }}
              className="absolute bottom-0 left-0 right-0 z-50 px-5 pb-10 pt-5"
              style={{ borderRadius: "26px 26px 0 0", background: "rgba(6,11,22,0.99)", borderTop: "1px solid rgba(255,150,0,0.2)" }}
            >
              <div className="flex justify-center mb-4">
                <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
              </div>
              <div className="flex flex-col items-center text-center">
                <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 1.3, repeat: Infinity }}
                  className="size-[72px] rounded-full flex items-center justify-center mb-4"
                  style={{ background: "rgba(255,150,0,0.08)", border: "2px solid rgba(255,150,0,0.22)", boxShadow: "0 0 40px rgba(255,150,0,0.1)" }}
                >
                  <AlertTriangle style={{ width: 30, height: 30, color: "#FF9500" }} />
                </motion.div>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", fontFamily: "inherit" }}>Are you safe?</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 6, lineHeight: 1.7, fontFamily: "inherit" }}>
                  {(isAr ? ["فحص #1 — 5 دقائق مضت", "فحص #2 — 10 دقائق — حرج", "فحص #3 — تصعيد فوري"] : ["Check #1 — 5 minutes elapsed", "Check #2 — 10 minutes — Critical", "Check #3 — Immediate escalation"])[dmsCheckNum - 1] ?? (isAr ? `فحص #${dmsCheckNum}` : `Check #${dmsCheckNum}`)}
                </p>

                {/* Countdown ring */}
                <div className="relative flex items-center justify-center my-4" style={{ width: 68, height: 68 }}>
                  <svg className="absolute" width="68" height="68" viewBox="0 0 68 68" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="34" cy="34" r="29" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
                    <circle cx="34" cy="34" r="29" fill="none" stroke="#FF9500"
                      strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 29}
                      strokeDashoffset={2 * Math.PI * 29 * (1 - dmsCountdown / 30)}
                      style={{ transition: "stroke-dashoffset 1s linear" }}
                    />
                  </svg>
                  <span style={{ fontSize: 20, fontWeight: 800, color: "#FF9500", fontFamily: "inherit" }}>{dmsCountdown}</span>
                </div>

                <motion.button whileTap={{ scale: 0.97 }} onClick={handleImSafe}
                  className="w-full flex items-center justify-center gap-2.5 mb-3"
                  style={{ height: 54, borderRadius: 17, background: "linear-gradient(135deg, #00C853, #00A040)", color: "#fff", fontSize: 16, fontWeight: 800, boxShadow: "0 8px 28px rgba(0,200,83,0.3)", fontFamily: "inherit" }}
                >
                  <Heart style={{ width: 17, height: 17 }} />
                  I'm Safe — End Emergency
                </motion.button>

                <button onClick={handleStillDanger}
                  className="w-full flex items-center justify-center gap-2"
                  style={{ height: 46, borderRadius: 14, background: "rgba(255,45,85,0.07)", border: "1px solid rgba(255,45,85,0.18)", color: "rgba(255,80,80,0.7)", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}
                >
                  <AlertTriangle style={{ width: 13, height: 13 }} />
                  Still in danger — Continue monitoring
                </button>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.1)", marginTop: 8, fontFamily: "inherit" }}>
                  Next check in {DMS_GAP_SEC * (dmsCheckNum + 1)} seconds
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CALLING ADMIN OVERLAY */}
      <AnimatePresence>
        {showAdminCall && (
          <motion.div
            key="admin-call-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showAdminCall && (
          <CallingAdminView
            key="calling-admin"
            employeeId={userId}
            employeeName={userName}
            zone={userZone}
            onDismiss={() => {
              adminCallPendingRef.current = false; // Resume tick → calling phase starts
              setShowAdminCall(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Personal SOS Banner removed — was duplicating "Calling [name]" which already shows in header + glow circle + contact list */}

      {/* END CONFIRMATION */}
      <AnimatePresence>
        {showCancel && (
          <div>
            <motion.div key="ec-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(10px)" }}
            />
            <motion.div key="ec-card"
              initial={{ scale: 0.88, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.88, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="absolute inset-x-6 z-50"
              style={{ top: "50%", transform: "translateY(-50%)", borderRadius: 24, background: "rgba(8,14,26,0.99)", border: "1px solid rgba(255,45,85,0.15)", padding: 24 }}
            >
              <div className="flex flex-col items-center text-center">
                <div className="size-14 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(255,45,85,0.08)", border: "2px solid rgba(255,45,85,0.16)" }}>
                  <Shield style={{ width: 24, height: 24, color: "#FF2D55" }} />
                </div>
                <p style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "inherit" }}>End Emergency?</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.26)", marginTop: 8, lineHeight: 1.7, fontFamily: "inherit" }}>
                  Everything will stop — calls, recording, and location sharing. Your incident record will be saved.
                </p>
                <div className="flex gap-3 w-full mt-5">
                  <button onClick={() => setShowCancel(false)} style={{ flex: 1, height: 46, borderRadius: 13, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>
                    Go Back
                  </button>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={handleEndSOS} style={{ flex: 1, height: 46, borderRadius: 13, background: "rgba(255,45,85,0.1)", border: "1.5px solid rgba(255,45,85,0.24)", color: "#FF2D55", fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}>
                    End SOS
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DEACTIVATION PIN ENTRY */}
      <AnimatePresence>
        {showPinEntry && (
          <div>
            <motion.div key="pin-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-50"
              style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)" }}
            />
            <motion.div key="pin-card"
              initial={{ scale: 0.88, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.88, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="absolute inset-x-6 z-50"
              style={{ top: "50%", transform: "translateY(-50%)", borderRadius: 24, background: "rgba(8,14,26,0.99)", border: "1px solid rgba(255,45,85,0.15)", padding: 24 }}
            >
              <div className="flex flex-col items-center text-center">
                <div className="size-14 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(255,45,85,0.08)", border: "2px solid rgba(255,45,85,0.16)" }}>
                  <Shield style={{ width: 24, height: 24, color: "#FF2D55" }} />
                </div>
                <p style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "inherit" }}>
                  {isAr ? "أدخل رمز الإلغاء" : "Enter Deactivation PIN"}
                </p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.26)", marginTop: 8, lineHeight: 1.7, fontFamily: "inherit" }}>
                  {isAr ? "أدخل الرمز السري لإيقاف حالة الطوارئ" : "Enter your PIN to confirm you are safe and end the SOS"}
                </p>

                {/* PIN display dots */}
                <div className="flex gap-3 mt-5 mb-3">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="size-12 rounded-xl flex items-center justify-center"
                      style={{
                        background: pinError ? "rgba(255,45,85,0.1)" : "rgba(255,255,255,0.04)",
                        border: pinError ? "1.5px solid rgba(255,45,85,0.4)" : "1.5px solid rgba(255,255,255,0.1)",
                        fontSize: 20, fontWeight: 700, color: "#fff", fontFamily: "inherit",
                        transition: "all 0.2s ease",
                      }}
                    >
                      {pinInput[i] ? "●" : ""}
                    </div>
                  ))}
                </div>

                {pinError && (
                  <motion.p initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
                    style={{ fontSize: 12, color: "#FF2D55", fontWeight: 600, marginBottom: 8 }}>
                    {isAr ? "رمز خاطئ — حاول مرة أخرى" : "Wrong PIN — try again"}
                  </motion.p>
                )}

                {/* Number pad */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, width: "100%", maxWidth: 220 }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"].map((n, i) => (
                    <motion.button key={i} whileTap={{ scale: 0.92 }}
                      onClick={() => {
                        if (n === null) return;
                        if (n === "del") { setPinInput(p => p.slice(0, -1)); return; }
                        if (pinInput.length < 4) setPinInput(p => p + String(n));
                      }}
                      style={{
                        height: 48, borderRadius: 12,
                        background: n === null ? "transparent" : "rgba(255,255,255,0.04)",
                        border: n === null ? "none" : "1px solid rgba(255,255,255,0.07)",
                        color: n === "del" ? "#FF9500" : "#fff",
                        fontSize: n === "del" ? 12 : 18, fontWeight: 600, fontFamily: "inherit",
                        cursor: n === null ? "default" : "pointer",
                      }}
                      disabled={n === null}
                    >
                      {n === null ? "" : n === "del" ? "⌫" : n}
                    </motion.button>
                  ))}
                </div>

                <div className="flex gap-3 w-full mt-5">
                  <button onClick={() => { setShowPinEntry(false); setPinInput(""); }} style={{ flex: 1, height: 46, borderRadius: 13, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>
                    {isAr ? "رجوع" : "Go Back"}
                  </button>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={handlePinSubmit}
                    style={{
                      flex: 1, height: 46, borderRadius: 13,
                      background: pinInput.length === 4 ? "rgba(0,200,83,0.12)" : "rgba(255,255,255,0.02)",
                      border: pinInput.length === 4 ? "1.5px solid rgba(0,200,83,0.3)" : "1.5px solid rgba(255,255,255,0.05)",
                      color: pinInput.length === 4 ? "#00C853" : "rgba(255,255,255,0.2)",
                      fontSize: 14, fontWeight: 700, fontFamily: "inherit",
                      transition: "all 0.2s ease",
                    }}
                    disabled={pinInput.length < 4}
                  >
                    {isAr ? "تأكيد" : "Confirm"}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* UPGRADE MODAL — shown when Free/Basic user tries Elite features */}
      <AnimatePresence>
        {showUpgradeModal && (
          <div>
            <motion.div key="up-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-50"
              style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(10px)" }}
              onClick={() => setShowUpgradeModal(false)}
            />
            <motion.div key="up-card"
              initial={{ scale: 0.88, opacity: 0, y: 30 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.88, opacity: 0, y: 30 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="absolute inset-x-6 z-50"
              style={{ top: "50%", transform: "translateY(-50%)", borderRadius: 24, background: "linear-gradient(180deg, rgba(8,14,26,0.99), rgba(10,10,20,0.99))", border: "1px solid rgba(0,200,224,0.15)", padding: 24 }}
            >
              <div className="flex flex-col items-center text-center">
                <div className="size-14 rounded-full flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,83,0.08))", border: "2px solid rgba(0,200,224,0.2)" }}>
                  <Shield style={{ width: 24, height: 24, color: "#00C8E0" }} />
                </div>
                <p style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "inherit" }}>
                  {isAr ? "ترقية للحماية الكاملة" : "Upgrade to Elite Shield"}
                </p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 8, lineHeight: 1.7, fontFamily: "inherit" }}>
                  {upgradeFeatureName}
                  {isAr ? " — متاح في الباقة النخبوية" : " — available in Elite Shield"}
                </p>
                <div className="mt-4 w-full space-y-2">
                  {[
                    isAr ? "ملف PDF جنائي كامل" : "Forensic PDF Dossier",
                    isAr ? "مكالمات AI صوتية" : "AI Voice Calls",
                    isAr ? "وضع التخفي المتقدم" : "Advanced Stealth Mode",
                    isAr ? "رمز الإكراه" : "Duress Code Protection",
                  ].map((f, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.06)" }}>
                      <CheckCircle style={{ width: 14, height: 14, color: "#00C8E0" }} />
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{f}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 w-full mt-5">
                  <button onClick={() => setShowUpgradeModal(false)} style={{ flex: 1, height: 46, borderRadius: 13, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>
                    {isAr ? "لاحقاً" : "Later"}
                  </button>
                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={() => { setShowUpgradeModal(false); onNavigateToSubscription?.(); }}
                    style={{ flex: 1, height: 46, borderRadius: 13, background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,83,0.08))", border: "1.5px solid rgba(0,200,224,0.3)", color: "#00C8E0", fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}>
                    {isAr ? "ترقية الآن" : "Upgrade Now"}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── INCIDENT RECORD OVERLAY — shows live record WITHOUT ending SOS ── */}
      <AnimatePresence>
        {showIncidentOverlay && (
          <div>
            <motion.div key="ir-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-50"
              style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)" }}
              onClick={() => setShowIncidentOverlay(false)}
            />
            <motion.div key="ir-card"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="absolute inset-x-0 bottom-0 z-50"
              style={{ maxHeight: "85%", borderRadius: "24px 24px 0 0", background: "linear-gradient(180deg, rgba(10,14,28,0.99), rgba(6,8,16,0.99))", border: "1px solid rgba(0,200,224,0.12)", borderBottom: "none", overflow: "auto" }}
            >
              <div className="px-5 pt-5 pb-8">
                {/* Drag handle */}
                <div className="flex justify-center mb-4">
                  <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.15)" }} />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FileText style={{ width: 16, height: 16, color: "#00C8E0" }} />
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: "inherit" }}>
                      {isAr ? "سجل الحادث المباشر" : "Live Incident Record"}
                    </span>
                  </div>
                  <button onClick={() => setShowIncidentOverlay(false)}
                    className="size-8 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <X style={{ width: 14, height: 14, color: "rgba(255,255,255,0.5)" }} />
                  </button>
                </div>

                {/* Top summary — duration only (the stat the user cares about).
                    Incident ID moved to footer as subtle reference copy. */}
                <div className="flex items-center gap-3 mb-5 px-4 py-3 rounded-2xl" style={{ background: "rgba(255,45,85,0.04)", border: "1px solid rgba(255,45,85,0.12)" }}>
                  <motion.div
                    animate={{ opacity: [1, 0.45, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity }}
                    className="size-2 rounded-full shrink-0"
                    style={{ background: "#FF2D55", boxShadow: "0 0 6px #FF2D55" }}
                  />
                  <div className="flex-1">
                    <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.8px" }}>
                      {isAr ? "الحدث نشط" : "LIVE INCIDENT"}
                    </p>
                    <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", fontFamily: "'Outfit', monospace", letterSpacing: "-0.5px" }}>
                      {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
                    </p>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.6px" }}>
                    {isAr ? `الدورة ${cycle}` : `CYCLE ${cycle}`}
                  </span>
                </div>

                {/* Event Timeline — FIRST and primary content.
                    Each row shows HH:MM:SS timestamp so the log actually reads
                    like a log, not a UUID wall. */}
                {events.length > 0 && (
                  <>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", marginBottom: 10, letterSpacing: "0.6px" }}>
                      {isAr ? "الخط الزمني" : "TIMELINE"}
                    </p>
                    <div className="space-y-1 mb-5">
                      {events.slice(-12).map((ev, i) => {
                        const h = String(ev.ts.getHours()).padStart(2, "0");
                        const m = String(ev.ts.getMinutes()).padStart(2, "0");
                        const s = String(ev.ts.getSeconds()).padStart(2, "0");
                        return (
                          <div key={ev.id || i} className="flex items-start gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", fontFamily: "'Outfit', monospace", letterSpacing: "0.2px", paddingTop: 2, flexShrink: 0, minWidth: 56 }}>
                              {h}:{m}:{s}
                            </span>
                            <div className="size-1.5 rounded-full shrink-0" style={{ background: ev.color || "#00C8E0", marginTop: 7 }} />
                            <div className="flex-1 min-w-0">
                              <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.8)", lineHeight: 1.4 }}>{ev.title}</p>
                              {ev.detail && (
                                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2, lineHeight: 1.4 }}>{ev.detail}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Contact Status — secondary info. Cleaner row:
                    single line with name + relation, phone tucked right (monospace, muted). */}
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", marginBottom: 10, letterSpacing: "0.6px" }}>
                  {isAr ? "جهات الاتصال" : "CONTACTS"}
                </p>
                <div className="space-y-2 mb-5">
                  {contacts.map((c, i) => {
                    const sc = c.status === "answered" ? "#00C853"
                             : c.status === "no_answer" ? "#FF9500"
                             : c.status === "calling" ? "#FF2D55"
                             : "rgba(255,255,255,0.25)";
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl"
                        style={{ background: `${sc}0A`, border: `1px solid ${sc}22` }}>
                        <div className="size-7 rounded-full flex items-center justify-center shrink-0" style={{ background: `${sc}18`, border: `1px solid ${sc}40` }}>
                          {c.status === "answered" ? <CheckCircle style={{ width: 12, height: 12, color: sc }} /> :
                           c.status === "no_answer" ? <PhoneMissed style={{ width: 12, height: 12, color: sc }} /> :
                           c.status === "calling" ? <Phone style={{ width: 12, height: 12, color: sc }} /> :
                           <span style={{ fontSize: 10, fontWeight: 800, color: sc, fontFamily: "'Outfit', monospace" }}>{i + 1}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {c.name}{c.relation ? <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 500 }}> · {c.relation}</span> : null}
                          </p>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "'Outfit', monospace", color: sc, letterSpacing: "0.4px" }}>
                          {c.status === "answered" ? (isAr ? "ردّ" : "ANSWERED") :
                           c.status === "no_answer" ? (isAr ? "لم يردّ" : "NO ANSWER") :
                           c.status === "calling" ? (isAr ? "رنين" : "RINGING") :
                           (isAr ? "انتظار" : "PENDING")}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* GPS + Recording Status */}
                <div className="flex gap-2 mb-5">
                  <div className="flex-1 px-3 py-2 rounded-xl" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.08)" }}>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>GPS</p>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "#00C853" }}>
                      {getLastKnownPosition() ? (isAr ? "نشط" : "Active") : (isAr ? "في الانتظار..." : "Acquiring...")}
                    </p>
                  </div>
                  <div className="flex-1 px-3 py-2 rounded-xl" style={{ background: "rgba(255,45,85,0.04)", border: "1px solid rgba(255,45,85,0.08)" }}>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{isAr ? "التسجيل" : "Recording"}</p>
                    <p style={{ fontSize: 12, fontWeight: 600, color: isRecording ? "#FF2D55" : "rgba(255,255,255,0.3)" }}>
                      {isRecording ? `${recordingSec}s / 60s` : phase === "monitoring" ? (isAr ? "اكتمل" : "Done") : (isAr ? "لم يبدأ" : "Not started")}
                    </p>
                  </div>
                  <div className="flex-1 px-3 py-2 rounded-xl" style={{ background: "rgba(255,150,0,0.04)", border: "1px solid rgba(255,150,0,0.08)" }}>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{isAr ? "الدورة" : "Cycle"}</p>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "#FF9500" }}>{cycle}</p>
                  </div>
                </div>

                {/* SOS Still Active indicator */}
                <div className="flex items-center justify-center gap-2 py-3 rounded-xl" style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.12)" }}>
                  <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }}
                    className="size-2 rounded-full" style={{ background: "#FF2D55" }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#FF6060", fontFamily: "inherit" }}>
                    {isAr ? "SOS لا يزال نشطاً — لم يتم إنهاء الطوارئ" : "SOS Still Active — Emergency not ended"}
                  </span>
                </div>

                {/* Close button */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowIncidentOverlay(false)}
                  className="w-full mt-4"
                  style={{ height: 48, borderRadius: 14, background: "rgba(0,200,224,0.08)", border: "1.5px solid rgba(0,200,224,0.2)", color: "#00C8E0", fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}>
                  {isAr ? "إغلاق والعودة للمكالمة" : "Close & Return to SOS"}
                </motion.button>

                {/* Footer — Incident ID for support reference.
                    Moved here (from the top) because it's a 36-char UUID useful
                    to support staff only, not to the person in distress. */}
                <div className="mt-4 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px", marginBottom: 2 }}>
                    {isAr ? "مرجع الدعم" : "SUPPORT REFERENCE"}
                  </p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "'Outfit', monospace", wordBreak: "break-all", lineHeight: 1.4 }}>
                    {errIdRef.current}
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
