// ═══════════════════════════════════════════════════════════════
// SOSphere — WOW Demo v2: Cinematic 90-Second Platform Showcase
// ─────────────────────────────────────────────────────────────
// 12 Acts covering ALL major features across Mobile + Dashboard
// Full-screen immersive experience with live counters,
// feature highlights, and cross-tab synchronization.
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";
import {
  Shield, Play, Pause, RotateCcw, ChevronRight,
  AlertTriangle, CheckCircle, Phone, MapPin, Clock,
  Wifi, Battery, Signal, User, Bell, Zap,
  MessageCircle, Navigation, ShieldCheck,
  Mic, Heart, Siren, Brain, Radio,
  ArrowRight, Sparkles, Type,
  Map, Route, Users, Gauge,
  LocateFixed, Megaphone, ShieldAlert, ClipboardCheck,
  BarChart3, Lock, Sun, Headphones,
} from "lucide-react";
import { emitSyncEvent, type SyncEvent } from "./shared-store";

// ── Helper: wrap events with DEMO_ prefix so dashboard ignores them ──
function emitDemoPrefixedEvent(event: SyncEvent) {
  emitSyncEvent({ ...event, type: `DEMO_${event.type}` } as SyncEvent);
}

// ═══════════════════════════════════════════════════════════════
// Demo Events — 12 Acts, 90 Seconds, Full Platform Coverage
// ═══════════════════════════════════════════════════════════════
interface DemoEvent {
  id: string;
  time: number;
  duration: number;
  title: string;
  subtitle: string;
  color: string;
  icon: typeof Shield;
  category: "operations" | "intelligence" | "emergency" | "response" | "analytics";
  features: string[];          // Features showcased in this act
  mobileScreen: string;
  dashScreen: string;
  narration: string;
  highlight: string;
}

const EVENTS: DemoEvent[] = [
  {
    id: "overview", time: 0, duration: 8,
    title: "Command Center Live",
    subtitle: "Real-time operational dashboard",
    color: "#00C8E0", icon: Shield, category: "operations",
    features: ["Live Dashboard", "KPI Cards", "Activity Feed", "Weather Sensors"],
    mobileScreen: "home", dashScreen: "overview",
    narration: "SOSphere's Command Center gives you a real-time bird's-eye view of your entire field operation. Live worker counts, safety scores, weather conditions, and zone status — all updating in real-time.",
    highlight: "One screen. Total operational awareness.",
  },
  {
    id: "riskmap", time: 8, duration: 7,
    title: "Risk Map & GPS Tracking",
    subtitle: "Live worker positions on interactive map",
    color: "#00C8E0", icon: Map, category: "operations",
    features: ["Leaflet Map", "Worker Markers", "Zone Geofencing", "Trip Tracking"],
    mobileScreen: "gps-active", dashScreen: "riskmap",
    narration: "Every field worker appears as a live dot on the Risk Map. Geofenced zones glow based on risk level. Trip tracking records every movement with speed, checkpoints, and route history — like WIYAK GPS, but built for safety.",
    highlight: "GPS tracking that protects, not just monitors.",
  },
  {
    id: "checklist", time: 15, duration: 7,
    title: "Pre-Shift Safety Checklist",
    subtitle: "Standardized safety verification",
    color: "#00C853", icon: ClipboardCheck, category: "operations",
    features: ["Pre-Shift Checklist", "PPE Verification", "Safety Score", "Compliance"],
    mobileScreen: "checkin", dashScreen: "checklist",
    narration: "Before any shift starts, workers complete a pre-shift safety checklist — verifying PPE, equipment, and site conditions. The dashboard tracks completion rates in real-time. No worker enters a zone unchecked.",
    highlight: "Safety starts before the first step.",
  },
  {
    id: "intelligence", time: 22, duration: 8,
    title: "Safety Intelligence Engine",
    subtitle: "AI predicts danger before it happens",
    color: "#FF9500", icon: Brain, category: "intelligence",
    features: ["AI Predictions", "Pattern Analysis", "H2S Detection", "Risk Scoring"],
    mobileScreen: "ai-warning", dashScreen: "intelligence",
    narration: "The Safety Intelligence Engine analyzes historical incidents, sensor data, and weather patterns. It detects rising H2S levels and predicts danger 45 minutes before it reaches threshold. Workers and admins are alerted proactively.",
    highlight: "Proactive, not reactive. This is the SOSphere difference.",
  },
  {
    id: "gps-compliance", time: 30, duration: 7,
    title: "GPS Zone Compliance",
    subtitle: "Automated geofence monitoring every 15 min",
    color: "#00C8E0", icon: LocateFixed, category: "intelligence",
    features: ["Haversine Distance", "Zone Compliance %", "Auto-Broadcasts", "Non-Compliance Alerts"],
    mobileScreen: "zone-status", dashScreen: "compliance",
    narration: "Every 15 minutes, SOSphere checks if each worker is inside their assigned geofence using the Haversine formula — completely free, using raw GPS coordinates. Out-of-zone workers trigger automatic broadcasts to supervisors.",
    highlight: "$0 GPS compliance. No expensive APIs needed.",
  },
  {
    id: "broadcast", time: 37, duration: 7,
    title: "Broadcast Messaging",
    subtitle: "Role-based, zone-targeted mass communication",
    color: "#AF52DE", icon: Megaphone, category: "operations",
    features: ["Targeted Broadcasts", "Auto-Broadcasts", "Smart Escalation", "Scheduled Messages"],
    mobileScreen: "broadcast-received", dashScreen: "broadcast",
    narration: "Broadcasts reach the right people instantly — by zone, role, department, or custom selection. Auto-broadcasts fire on GPS violations, SOS events, and hazard reports. Smart escalation ensures no alert goes unread.",
    highlight: "The right message, to the right people, at the right time.",
  },
  {
    id: "sos", time: 44, duration: 8,
    title: "SOS Emergency Triggered",
    subtitle: "One button. 3-second confirmation. Instant response.",
    color: "#FF2D55", icon: Siren, category: "emergency",
    features: ["SOS Button", "3-Sec Countdown", "GPS Sharing", "Audio Recording", "Medical ID"],
    mobileScreen: "sos-active", dashScreen: "sos-alert",
    narration: "Ahmed triggers SOS. A 3-second countdown prevents false alarms. His live GPS, audio recording, and Medical ID are instantly shared with the company dashboard. The clock starts — every second counts.",
    highlight: "One button. Zero delay. Lives saved.",
  },
  {
    id: "escalation", time: 52, duration: 7,
    title: "Smart Auto-Escalation",
    subtitle: "4-level automated escalation chain",
    color: "#AF52DE", icon: Radio, category: "emergency",
    features: ["4-Level Escalation", "Zone Admin → Company Admin", "Emergency Services", "Owner Notification"],
    mobileScreen: "escalating", dashScreen: "escalation",
    narration: "No response in 30 seconds? SOSphere's 4-level Smart Escalation activates: Zone Admin → Company Admin → Emergency Services → Company Owner. Each level has configurable timeouts. The system never sleeps.",
    highlight: "Help ALWAYS arrives. No gaps. No excuses.",
  },
  {
    id: "response", time: 59, duration: 8,
    title: "Guided Response + Evidence",
    subtitle: "Admin call + audio recording + emergency chat",
    color: "#00C8E0", icon: Headphones, category: "response",
    features: ["Admin Call", "Guided Response Steps", "Audio Evidence", "Emergency Chat", "Buddy System"],
    mobileScreen: "call-chat", dashScreen: "guided-response",
    narration: "Rania, the Company Admin, calls Ahmed through the platform. The Guided Response System walks her through each step. Audio is recorded as evidence. The Emergency Chat provides a parallel text channel. The Buddy System locates the nearest colleague — Khalid, 150m away.",
    highlight: "Even untrained admins respond like seasoned professionals.",
  },
  {
    id: "evacuation", time: 67, duration: 7,
    title: "Evacuation Management",
    subtitle: "Zone-based evacuation with assembly points",
    color: "#FF2D55", icon: ShieldAlert, category: "response",
    features: ["Evacuation Trigger", "Assembly Points", "Headcount Tracking", "Route Guidance"],
    mobileScreen: "evacuating", dashScreen: "evacuation",
    narration: "Zone D is flagged for evacuation. SOSphere sends instant evacuation orders with GPS-guided routes to the nearest assembly point. Real-time headcount tracking shows who's safe, who's en route, and who needs rescue.",
    highlight: "From evacuation order to 100% accounted for.",
  },
  {
    id: "resolved", time: 74, duration: 8,
    title: "Resolution & Auto-Report",
    subtitle: "Incident resolved. PDF report auto-generated.",
    color: "#00C853", icon: ShieldCheck, category: "analytics",
    features: ["Incident Resolution", "PDF Report", "Trip Replay", "Compliance Documentation"],
    mobileScreen: "safe", dashScreen: "resolved",
    narration: "Ahmed is safe. The entire incident — from SOS to resolution — is automatically documented in a compliance-ready PDF report. Trip replay shows his exact route. Total response time: 4 minutes 23 seconds.",
    highlight: "From crisis to closure. Automatically documented.",
  },
  {
    id: "analytics", time: 82, duration: 8,
    title: "Analytics & Platform Power",
    subtitle: "15+ features. One unified safety platform.",
    color: "#00C8E0", icon: BarChart3, category: "analytics",
    features: ["Safety Analytics", "Trend Reports", "RBAC System", "8 Roles", "30+ Permissions", "Multi-Zone"],
    mobileScreen: "score-updated", dashScreen: "platform",
    narration: "SOSphere isn't just an emergency app — it's a complete safety intelligence platform. 15+ integrated modules, 8 role-based access levels, 30+ permissions, multi-zone management, and everything syncs in real-time across mobile and dashboard.",
    highlight: "Not just safety. Safety Intelligence.",
  },
];

const TOTAL_DURATION = 90;

// ── Narration Typewriter Hook ──────────────────────────────────
function useTypewriter(text: string, speed = 18) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed(""); setDone(false);
    if (!text) return;
    let i = 0;
    const iv = setInterval(() => { i++; setDisplayed(text.slice(0, i)); if (i >= text.length) { setDone(true); clearInterval(iv); } }, speed);
    return () => clearInterval(iv);
  }, [text, speed]);
  return { displayed, done };
}

// ── Animated Counter ───────────────────────────────────────────
function AnimCounter({ to, duration = 2000, prefix = "", suffix = "" }: { to: number; duration?: number; prefix?: string; suffix?: string }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = 0; const step = to / (duration / 16);
    const iv = setInterval(() => { start += step; if (start >= to) { setVal(to); clearInterval(iv); } else setVal(Math.floor(start)); }, 16);
    return () => clearInterval(iv);
  }, [to, duration]);
  return <>{prefix}{val.toLocaleString()}{suffix}</>;
}

// ── Cross-Tab Sync ─────────────────────────────────────────────
function emitDemoSync(eventId: string) {
  const base = { employeeId: "DEMO-001", employeeName: "Ahmed Al-Rashidi", zone: "Zone A", timestamp: Date.now() };
  const map: Record<string, () => void> = {
    overview: () => emitDemoPrefixedEvent({ ...base, type: "CHECKIN", data: { demoMode: true } }),
    riskmap: () => emitDemoPrefixedEvent({ ...base, type: "LOCATION_UPDATE", data: { demoMode: true } }),
    checklist: () => emitDemoPrefixedEvent({ ...base, type: "CHECKIN", data: { demoMode: true, type: "pre-shift" } }),
    intelligence: () => emitDemoPrefixedEvent({ ...base, type: "HAZARD_REPORT", employeeName: "AI Engine", data: { demoMode: true, type: "H2S Prediction" } }),
    "gps-compliance": () => emitDemoPrefixedEvent({ ...base, type: "LOCATION_UPDATE", data: { demoMode: true, compliance: true } }),
    broadcast: () => emitDemoPrefixedEvent({ ...base, type: "STATUS_CHANGE", data: { demoMode: true, broadcast: true } }),
    sos: () => emitDemoPrefixedEvent({ ...base, type: "SOS_TRIGGERED", data: { demoMode: true } }),
    escalation: () => emitDemoPrefixedEvent({ ...base, type: "ESCALATION_UPDATE", data: { demoMode: true, level: 3 } }),
    response: () => emitDemoPrefixedEvent({ ...base, type: "EMERGENCY_CHAT", data: { demoMode: true } }),
    evacuation: () => emitDemoPrefixedEvent({ ...base, type: "STATUS_CHANGE", data: { demoMode: true, evacuation: true } }),
    resolved: () => emitDemoPrefixedEvent({ ...base, type: "SOS_CANCELLED", data: { demoMode: true } }),
    analytics: () => emitDemoPrefixedEvent({ ...base, type: "STATUS_CHANGE", data: { demoMode: true, analytics: true } }),
  };
  map[eventId]?.();
}

// ═══════════════════════════════════════════════════════════════
// Mobile Phone Simulator — Enhanced with more screens
// ═══════════════════════════════════════════════════════════════
function MobileSimulator({ event }: { event: DemoEvent | null }) {
  const screen = event?.mobileScreen || "idle";
  const isEmergency = screen === "sos-active" || screen === "escalating" || screen === "call-chat" || screen === "evacuating";

  return (
    <div className="relative" style={{ width: 220, height: 448 }}>
      <div className="absolute inset-0 rounded-[32px] overflow-hidden"
        style={{ background: "#000", border: "2.5px solid rgba(255,255,255,0.08)",
          boxShadow: `0 16px 50px rgba(0,0,0,0.5)${isEmergency ? ", 0 0 30px rgba(255,45,85,0.15)" : ""}` }}>
        
        {/* Dynamic Island */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-30">
          <AnimatePresence mode="wait">
            {isEmergency ? (
              <motion.div key="alert-island"
                initial={{ width: 80, height: 24, borderRadius: 12 }}
                animate={{ width: 180, height: 40, borderRadius: 16 }}
                exit={{ width: 80, height: 24, borderRadius: 12 }}
                className="flex items-center gap-2 px-2.5"
                style={{
                  background: screen === "sos-active" ? "linear-gradient(135deg, rgba(255,45,85,0.9), rgba(200,20,40,0.9))" :
                    screen === "evacuating" ? "linear-gradient(135deg, rgba(255,45,85,0.85), rgba(255,100,0,0.85))" :
                    screen === "call-chat" ? "linear-gradient(135deg, rgba(0,200,83,0.9), rgba(0,150,60,0.9))" :
                    "linear-gradient(135deg, rgba(175,82,222,0.9), rgba(130,60,170,0.9))",
                  boxShadow: `0 4px 16px ${screen === "sos-active" || screen === "evacuating" ? "rgba(255,45,85,0.4)" : "rgba(0,200,83,0.4)"}`,
                }}>
                <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 0.7, repeat: Infinity }}>
                  {screen === "sos-active" ? <Siren className="size-3.5 text-white" /> :
                   screen === "evacuating" ? <ShieldAlert className="size-3.5 text-white" /> :
                   screen === "call-chat" ? <Phone className="size-3.5 text-white" /> :
                   <Radio className="size-3.5 text-white" />}
                </motion.div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 8, fontWeight: 700, color: "white" }}>
                    {screen === "sos-active" ? "SOS ACTIVE" : screen === "evacuating" ? "EVACUATE NOW" : screen === "call-chat" ? "Admin Calling" : "ESCALATING"}
                  </p>
                  <p style={{ fontSize: 6.5, color: "rgba(255,255,255,0.7)" }}>
                    {screen === "sos-active" ? "Help is coming" : screen === "evacuating" ? "Move to Assembly A" : screen === "call-chat" ? "Rania Abbas" : "Level 2 Active"}
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div key="normal-island" style={{ width: 80, height: 24, borderRadius: 12, background: "#000" }} />
            )}
          </AnimatePresence>
        </div>

        {/* Screen */}
        <div className="absolute inset-0 pt-12 px-3 pb-3 overflow-hidden" style={{ background: "#05070E" }}>
          <div className="absolute top-0 left-0 right-0 flex justify-between items-center px-5 pt-[42px]"
            style={{ fontSize: 8.5, color: "rgba(255,255,255,0.35)" }}>
            <span>9:41</span>
            <div className="flex items-center gap-1"><Signal className="size-2.5" /><Wifi className="size-2.5" /><Battery className="size-3" /></div>
          </div>

          <AnimatePresence mode="wait">
            {/* HOME */}
            {(screen === "home" || screen === "idle") && (
              <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-5 flex flex-col h-full">
                <div className="flex items-center gap-2 mb-3">
                  <div className="size-6 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00C8E0, #0088A8)" }}>
                    <User className="size-3 text-white" />
                  </div>
                  <div><p className="text-white" style={{ fontSize: 10, fontWeight: 700 }}>Ahmed Al-Rashidi</p>
                    <p style={{ fontSize: 7, color: "rgba(255,255,255,0.3)" }}>Field Worker · Zone A</p></div>
                </div>
                <div className="rounded-xl p-2.5 mb-2" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.12)" }}>
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>Safety Score</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#00C853" }}>92</span>
                  </div>
                  <div className="w-full h-0.5 rounded-full mt-1" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <motion.div initial={{ width: 0 }} animate={{ width: "92%" }} transition={{ duration: 1 }}
                      className="h-full rounded-full" style={{ background: "linear-gradient(90deg, #00C853, #00E676)" }} />
                  </div>
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <div className="relative size-24">
                    <motion.div animate={{ scale: [1, 1.06, 1], opacity: [0.3, 0.5, 0.3] }} transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,45,85,0.12) 0%, transparent 70%)" }} />
                    <div className="absolute inset-2 rounded-full flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg, #FF2D55, #CC1540)", boxShadow: "0 6px 24px rgba(255,45,85,0.3)" }}>
                      <div className="text-center"><p className="text-white" style={{ fontSize: 17, fontWeight: 900, letterSpacing: "2px" }}>SOS</p>
                        <p style={{ fontSize: 5.5, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>HOLD 3 SEC</p></div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* GPS ACTIVE / ZONE STATUS */}
            {(screen === "gps-active" || screen === "zone-status") && (
              <motion.div key="gps" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-5 space-y-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: "#00C8E0" }} />
                  <span style={{ fontSize: 8, fontWeight: 700, color: "#00C8E0" }}>GPS TRACKING ACTIVE</span>
                </div>
                <div className="rounded-xl overflow-hidden h-28 relative" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.08)" }}>
                  <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 50%, rgba(0,200,224,0.06) 0%, transparent 60%)" }} />
                  <motion.div animate={{ x: [20, 60, 40, 70, 50], y: [30, 20, 50, 35, 45] }} transition={{ duration: 4, repeat: Infinity }}
                    className="absolute size-3 rounded-full" style={{ background: "#00C8E0", boxShadow: "0 0 8px rgba(0,200,224,0.5)" }} />
                  {[{x:30,y:40,r:25},{x:70,y:25,r:18}].map((z,i) => (
                    <div key={i} className="absolute rounded-full" style={{ left: `${z.x}%`, top: `${z.y}%`, width: z.r*2, height: z.r*2, border: "1px solid rgba(0,200,83,0.15)", transform: "translate(-50%,-50%)" }} />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[{ l: "Zone", v: "A - North Gate", c: "#00C853" }, { l: "Status", v: screen === "zone-status" ? "IN ZONE ✓" : "Tracking", c: "#00C8E0" }].map(s => (
                    <div key={s.l} className="p-2 rounded-lg" style={{ background: `${s.c}05`, border: `1px solid ${s.c}08` }}>
                      <p style={{ fontSize: 6, color: "rgba(255,255,255,0.2)" }}>{s.l}</p>
                      <p style={{ fontSize: 9, fontWeight: 700, color: s.c }}>{s.v}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* CHECK-IN / CHECKLIST */}
            {screen === "checkin" && (
              <motion.div key="checkin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-5 space-y-2">
                <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  className="rounded-xl p-3" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: 2 }}>
                      <CheckCircle className="size-4" style={{ color: "#00C853" }} /></motion.div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: "#00C853" }}>Pre-Shift Complete</p>
                  </div>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>Zone A · 6:00 AM</p>
                </motion.div>
                <div className="space-y-1">
                  {["PPE Verified ✓", "Equipment Check ✓", "Buddy Assigned ✓", "Zone Briefing ✓"].map((item, i) => (
                    <motion.div key={item} initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.15 }}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "rgba(0,200,83,0.03)" }}>
                      <CheckCircle className="size-2.5" style={{ color: "#00C853" }} />
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.5)" }}>{item}</span>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* AI WARNING */}
            {screen === "ai-warning" && (
              <motion.div key="warning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-5 space-y-2">
                <motion.div initial={{ y: -15, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                  className="rounded-xl p-3" style={{ background: "linear-gradient(135deg, rgba(255,150,0,0.08), rgba(255,150,0,0.02))", border: "1px solid rgba(255,150,0,0.2)" }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 2, repeat: Infinity }}>
                      <Brain className="size-4" style={{ color: "#FF9500" }} /></motion.div>
                    <div><p style={{ fontSize: 9, fontWeight: 700, color: "#FF9500" }}>Safety Intelligence</p>
                      <p style={{ fontSize: 6, color: "rgba(255,150,0,0.5)", fontWeight: 600 }}>AI PREDICTION</p></div>
                  </div>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>H2S rising in Zone A. 78% probability of exceeding threshold in 45 min.</p>
                </motion.div>
                <div className="flex items-end gap-0.5 h-8 px-2">
                  {[20,25,30,35,42,55,68,78].map((v,i) => (
                    <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${v}%` }} transition={{ delay: i * 0.08, duration: 0.4 }}
                      className="flex-1 rounded-t" style={{ background: v > 60 ? "#FF9500" : "rgba(0,200,224,0.3)" }} />
                  ))}
                </div>
              </motion.div>
            )}

            {/* BROADCAST RECEIVED */}
            {screen === "broadcast-received" && (
              <motion.div key="broadcast" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-5 space-y-2">
                <p style={{ fontSize: 7, fontWeight: 700, color: "rgba(175,82,222,0.5)", letterSpacing: "1px" }}>BROADCASTS</p>
                {[
                  { title: "⚠️ Zone A Alert", body: "H2S levels rising. Stay alert.", time: "2m ago", color: "#FF9500", priority: "urgent" },
                  { title: "📢 Safety Reminder", body: "Hydration break at 10:00 AM", time: "15m ago", color: "#00C8E0", priority: "info" },
                  { title: "✅ Shift Update", body: "Zone B cleared for operations", time: "1h ago", color: "#00C853", priority: "normal" },
                ].map((b, i) => (
                  <motion.div key={i} initial={{ x: 15, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.15 }}
                    className="rounded-xl p-2.5" style={{ background: `${b.color}05`, border: `1px solid ${b.color}10` }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <p style={{ fontSize: 8.5, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{b.title}</p>
                      <span className="px-1 py-0.5 rounded" style={{ fontSize: 5.5, fontWeight: 700, color: b.color, background: `${b.color}12` }}>{b.priority.toUpperCase()}</span>
                    </div>
                    <p style={{ fontSize: 7.5, color: "rgba(255,255,255,0.35)" }}>{b.body}</p>
                    <p style={{ fontSize: 6, color: "rgba(255,255,255,0.15)", marginTop: 2 }}>{b.time}</p>
                  </motion.div>
                ))}
              </motion.div>
            )}

            {/* SOS ACTIVE */}
            {screen === "sos-active" && (
              <motion.div key="sos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full gap-3">
                <motion.div animate={{ scale: [1, 1.12, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 1, repeat: Infinity }}
                  className="size-20 rounded-full flex items-center justify-center"
                  style={{ background: "radial-gradient(circle, rgba(255,45,85,0.25) 0%, rgba(255,45,85,0.04) 70%)", border: "2px solid rgba(255,45,85,0.35)" }}>
                  <Siren className="size-8" style={{ color: "#FF2D55" }} /></motion.div>
                <motion.p animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1, repeat: Infinity }}
                  style={{ fontSize: 16, fontWeight: 900, color: "#FF2D55", letterSpacing: "2px" }}>SOS ACTIVE</motion.p>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.12)" }}>
                  <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 0.5, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: "#FF2D55" }} />
                  <span style={{ fontSize: 7.5, color: "#FF2D55", fontWeight: 700 }}>GPS · Audio · Medical ID</span>
                </div>
              </motion.div>
            )}

            {/* ESCALATING */}
            {screen === "escalating" && (
              <motion.div key="escalating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-4 space-y-2">
                <p style={{ fontSize: 7, fontWeight: 700, color: "#AF52DE", letterSpacing: "1px", textAlign: "center" }}>AUTO-ESCALATION</p>
                {[
                  { l: "L1", label: "Zone Admin", done: true, c: "#00C853" },
                  { l: "L2", label: "Company Admin", done: true, c: "#FF9500" },
                  { l: "L3", label: "Emergency Services", done: false, c: "#FF2D55" },
                ].map((s, i) => (
                  <motion.div key={s.l} initial={{ x: -15, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.25 }}
                    className="flex items-center gap-2 p-2 rounded-xl" style={{ background: `${s.c}06`, border: `1px solid ${s.c}15` }}>
                    <div className="size-6 rounded-lg flex items-center justify-center" style={{ background: `${s.c}12` }}>
                      {s.done ? <CheckCircle className="size-3" style={{ color: s.c }} /> :
                        <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: Infinity }}><Clock className="size-3" style={{ color: s.c }} /></motion.div>}
                    </div>
                    <div className="flex-1"><span style={{ fontSize: 8, fontWeight: 800, color: s.c }}>{s.l}</span>
                      <span style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginLeft: 4 }}>{s.label}</span></div>
                  </motion.div>
                ))}
              </motion.div>
            )}

            {/* CALL + CHAT */}
            {screen === "call-chat" && (
              <motion.div key="call-chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-4 space-y-2">
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.1)" }}>
                  <Phone className="size-3" style={{ color: "#00C853" }} />
                  <span style={{ fontSize: 8, fontWeight: 700, color: "#00C853" }}>Connected — Rania Abbas</span>
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: "rgba(255,45,85,0.04)" }}>
                  <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 0.7, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: "#FF2D55" }} />
                  <span style={{ fontSize: 7, fontWeight: 700, color: "#FF2D55" }}>REC</span><span style={{ fontSize: 7, color: "rgba(255,255,255,0.25)" }}>02:34</span>
                </div>
                <div className="space-y-1.5 px-1">
                  {[
                    { from: "Admin", msg: "Ahmed, are you safe?", c: "#FF9500" },
                    { from: "You", msg: "Gas leak sector 3. Dizzy.", c: "#00C8E0" },
                    { from: "Admin", msg: "Stay calm. Help en route.", c: "#FF9500" },
                  ].map((m, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.4 }}
                      className={`flex ${m.from === "You" ? "justify-end" : ""}`}>
                      <div className="max-w-[80%] px-2 py-1.5 rounded-lg" style={{
                        background: m.from === "You" ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${m.from === "You" ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)"}`,
                      }}>
                        <p style={{ fontSize: 6, fontWeight: 700, color: m.c }}>{m.from}</p>
                        <p style={{ fontSize: 8, color: "rgba(255,255,255,0.5)" }}>{m.msg}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* EVACUATING */}
            {screen === "evacuating" && (
              <motion.div key="evac" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full gap-3">
                <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 1, repeat: Infinity }}
                  className="size-16 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,45,85,0.1)", border: "2px solid rgba(255,45,85,0.25)" }}>
                  <ShieldAlert className="size-7" style={{ color: "#FF2D55" }} /></motion.div>
                <div className="text-center">
                  <p style={{ fontSize: 13, fontWeight: 800, color: "#FF2D55" }}>EVACUATE ZONE D</p>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>Assembly Point A — 120m NE</p>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.1)" }}>
                  <Navigation className="size-3" style={{ color: "#00C8E0" }} />
                  <span style={{ fontSize: 7.5, color: "#00C8E0", fontWeight: 700 }}>GPS Navigation Active</span>
                </div>
              </motion.div>
            )}

            {/* SAFE / RESOLVED */}
            {screen === "safe" && (
              <motion.div key="safe" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full gap-3">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200 }}
                  className="size-16 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(0,200,83,0.1)", border: "2px solid rgba(0,200,83,0.2)" }}>
                  <ShieldCheck className="size-8" style={{ color: "#00C853" }} /></motion.div>
                <p className="text-white" style={{ fontSize: 14, fontWeight: 800 }}>You're Safe</p>
                <div className="flex items-center gap-1 px-3 py-1 rounded-full" style={{ background: "rgba(0,200,83,0.06)" }}>
                  <Heart className="size-2.5" style={{ color: "#00C853" }} />
                  <span style={{ fontSize: 7.5, color: "#00C853", fontWeight: 600 }}>Report auto-generated</span>
                </div>
              </motion.div>
            )}

            {/* SCORE UPDATED */}
            {screen === "score-updated" && (
              <motion.div key="score" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-5 space-y-2">
                <div className="text-center mb-2">
                  <p style={{ fontSize: 8, fontWeight: 700, color: "#00C8E0", letterSpacing: "1px" }}>PLATFORM OVERVIEW</p>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { icon: Shield, label: "Safety", value: "94", c: "#00C853" },
                    { icon: Map, label: "GPS", value: "ON", c: "#00C8E0" },
                    { icon: Users, label: "Buddy", value: "Active", c: "#FF9500" },
                    { icon: Bell, label: "Alerts", value: "0", c: "#00C853" },
                  ].map(s => (
                    <div key={s.label} className="p-2 rounded-lg text-center" style={{ background: `${s.c}04`, border: `1px solid ${s.c}08` }}>
                      <s.icon className="size-3 mx-auto mb-0.5" style={{ color: s.c }} />
                      <p style={{ fontSize: 10, fontWeight: 800, color: s.c }}>{s.value}</p>
                      <p style={{ fontSize: 6, color: "rgba(255,255,255,0.2)" }}>{s.label}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Dashboard Simulator — Shows different dashboard pages
// ═══════════════════════════════════════════════════════════════
function DashboardSimulator({ event }: { event: DemoEvent | null }) {
  const screen = event?.dashScreen || "idle";

  const Topbar = () => (
    <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.01)" }}>
      <div className="flex items-center gap-2">
        <div className="size-6 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.2)" }}>
          <Shield className="size-3" style={{ color: "#00C8E0" }} /></div>
        <span className="text-white" style={{ fontSize: 11, fontWeight: 700 }}>SOSphere Dashboard</span>
        <span style={{ fontSize: 7, fontWeight: 700, color: "rgba(0,200,224,0.35)", letterSpacing: "1px" }}>ENTERPRISE</span>
      </div>
      <div className="flex items-center gap-2.5">
        <motion.div animate={{ scale: (screen === "sos-alert" || screen === "escalation") ? [1, 1.3, 1] : 1 }}
          transition={{ duration: 0.5, repeat: screen === "sos-alert" ? Infinity : 0 }} className="size-1.5 rounded-full"
          style={{ background: screen === "sos-alert" || screen === "escalation" ? "#FF2D55" : "#00C853" }} />
        <Bell className="size-3.5" style={{ color: "rgba(255,255,255,0.15)" }} />
        <div className="size-5 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,224,0.08)" }}>
          <User className="size-2.5" style={{ color: "#00C8E0" }} /></div>
      </div>
    </div>
  );

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden relative"
      style={{ background: "#0A0E17", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 16px 50px rgba(0,0,0,0.4)" }}>
      <Topbar />
      <div className="p-3.5 overflow-hidden" style={{ height: "calc(100% - 42px)" }}>
        <AnimatePresence mode="wait">
          {/* OVERVIEW */}
          {screen === "overview" && (
            <motion.div key="d-overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
              <p style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.12)", letterSpacing: "1px" }}>OPERATIONS OVERVIEW</p>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "On Duty", value: "15", color: "#00C8E0", icon: Users },
                  { label: "Safety Score", value: "87%", color: "#00C853", icon: Shield },
                  { label: "Alerts", value: "0", color: "#00C853", icon: Bell },
                  { label: "Zones", value: "5", color: "#FF9500", icon: Map },
                ].map(k => (
                  <motion.div key={k.label} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                    className="p-2.5 rounded-xl" style={{ background: `${k.color}04`, border: `1px solid ${k.color}08` }}>
                    <k.icon className="size-3 mb-1" style={{ color: k.color }} />
                    <p style={{ fontSize: 16, fontWeight: 800, color: k.color }}>{k.value}</p>
                    <p style={{ fontSize: 7, color: "rgba(255,255,255,0.25)" }}>{k.label}</p>
                  </motion.div>
                ))}
              </div>
              <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.3 }}
                className="flex items-center gap-2.5 p-2.5 rounded-xl" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.08)" }}>
                <CheckCircle className="size-3.5" style={{ color: "#00C853" }} />
                <div className="flex-1"><p className="text-white" style={{ fontSize: 9.5, fontWeight: 600 }}>Ahmed Al-Rashidi checked in</p>
                  <p style={{ fontSize: 7, color: "rgba(255,255,255,0.25)" }}>Zone A · Just now</p></div>
                <span style={{ fontSize: 7, color: "#00C853", fontWeight: 700 }}>ON DUTY</span>
              </motion.div>
            </motion.div>
          )}

          {/* RISK MAP */}
          {screen === "riskmap" && (
            <motion.div key="d-riskmap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5"><Map className="size-3.5" style={{ color: "#00C8E0" }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>Risk Map Live</span></div>
                <div className="flex items-center gap-1"><motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                  <span style={{ fontSize: 7, color: "#00C853", fontWeight: 600 }}>10 tracked</span></div>
              </div>
              <div className="rounded-xl overflow-hidden h-32 relative" style={{ background: "#0D1117", border: "1px solid rgba(0,200,224,0.08)" }}>
                <div className="absolute inset-0" style={{ background: "repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(0,200,224,0.03) 20px), repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(0,200,224,0.03) 20px)" }} />
                {/* Zone circles */}
                {[{x:25,y:35,r:20,c:"#FF9500"},{x:60,y:25,r:16,c:"#00C853"},{x:45,y:65,r:18,c:"#FF2D55"},{x:75,y:55,r:14,c:"#00C853"}].map((z,i) => (
                  <div key={i} className="absolute rounded-full" style={{ left: `${z.x}%`, top: `${z.y}%`, width: z.r*2, height: z.r*2, border: `1px solid ${z.c}30`, background: `${z.c}06`, transform: "translate(-50%,-50%)" }} />
                ))}
                {/* Worker dots */}
                {[{x:24,y:33,c:"#00C8E0"},{x:27,y:38,c:"#00C8E0"},{x:58,y:23,c:"#00C8E0"},{x:62,y:27,c:"#FF9500"},{x:44,y:63,c:"#FF2D55",sos:true},{x:46,y:67,c:"#00C8E0"},{x:73,y:53,c:"#00C8E0"}].map((w,i) => (
                  <motion.div key={i} animate={w.sos ? { scale: [1, 1.5, 1] } : {}} transition={{ duration: 0.7, repeat: Infinity }}
                    className="absolute size-2 rounded-full" style={{ left: `${w.x}%`, top: `${w.y}%`, background: w.c, boxShadow: `0 0 ${w.sos ? 8 : 4}px ${w.c}60` }} />
                ))}
                {/* Trip route line */}
                <svg className="absolute inset-0 w-full h-full">
                  <motion.path d="M 50 85 L 55 75 L 48 60 L 52 50 L 45 40 L 50 30" fill="none" stroke="#00C8E0" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.4"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2 }} />
                </svg>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[{ l: "Trip Active", v: "3", c: "#FF9500" }, { l: "Geofences", v: "5", c: "#00C8E0" }, { l: "SOS", v: "1", c: "#FF2D55" }].map(s => (
                  <div key={s.l} className="text-center p-1.5 rounded-lg" style={{ background: `${s.c}04`, border: `1px solid ${s.c}08` }}>
                    <p style={{ fontSize: 12, fontWeight: 800, color: s.c }}>{s.v}</p>
                    <p style={{ fontSize: 6, color: "rgba(255,255,255,0.2)" }}>{s.l}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* CHECKLIST */}
          {screen === "checklist" && (
            <motion.div key="d-checklist" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
              <div className="flex items-center gap-1.5"><ClipboardCheck className="size-3.5" style={{ color: "#00C853" }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>Pre-Shift Compliance</span>
                <span className="ml-auto px-1.5 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 700, color: "#00C853", background: "rgba(0,200,83,0.08)" }}>93% Complete</span></div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { name: "Ahmed K.", zone: "A", status: "✓ Done", c: "#00C853" },
                  { name: "Fatima H.", zone: "B", status: "✓ Done", c: "#00C853" },
                  { name: "Khalid O.", zone: "A", status: "In Progress", c: "#FF9500" },
                  { name: "Sara M.", zone: "C", status: "✓ Done", c: "#00C853" },
                ].map(w => (
                  <div key={w.name} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: `${w.c}04`, border: `1px solid ${w.c}08` }}>
                    <div className="size-5 rounded flex items-center justify-center" style={{ background: `${w.c}12` }}>
                      <User className="size-2.5" style={{ color: w.c }} /></div>
                    <div className="flex-1"><p style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{w.name}</p>
                      <p style={{ fontSize: 6, color: "rgba(255,255,255,0.2)" }}>Zone {w.zone}</p></div>
                    <span style={{ fontSize: 6, fontWeight: 700, color: w.c }}>{w.status}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* INTELLIGENCE */}
          {screen === "intelligence" && (
            <motion.div key="d-intel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
              <div className="flex items-center gap-1.5"><Brain className="size-3.5" style={{ color: "#FF9500" }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: "#FF9500" }}>Safety Intelligence</span></div>
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
                className="p-3 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(255,150,0,0.06), rgba(255,150,0,0.02))", border: "1px solid rgba(255,150,0,0.15)" }}>
                <div className="flex items-center gap-2 mb-2"><AlertTriangle className="size-4" style={{ color: "#FF9500" }} />
                  <div><p style={{ fontSize: 10, fontWeight: 700, color: "#FF9500" }}>H2S Prediction — Zone A</p>
                    <p style={{ fontSize: 7, color: "rgba(255,150,0,0.5)" }}>AI Confidence: 78% · ETA: 45min</p></div></div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="py-1.5 rounded-lg text-center" style={{ background: "rgba(255,150,0,0.1)", fontSize: 8, fontWeight: 700, color: "#FF9500" }}>Notify Workers</div>
                  <div className="py-1.5 rounded-lg text-center" style={{ background: "rgba(255,45,85,0.06)", fontSize: 8, fontWeight: 700, color: "#FF2D55" }}>Evacuate Zone</div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* GPS COMPLIANCE */}
          {screen === "compliance" && (
            <motion.div key="d-compliance" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
              <div className="flex items-center gap-1.5"><LocateFixed className="size-3.5" style={{ color: "#00C8E0" }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>GPS Zone Compliance</span></div>
              <div className="grid grid-cols-3 gap-1.5">
                {[{ l: "In Zone", v: "7", c: "#00C853" }, { l: "Out of Zone", v: "1", c: "#FF2D55" }, { l: "Compliance", v: "88%", c: "#00C8E0" }].map(s => (
                  <div key={s.l} className="text-center p-2 rounded-lg" style={{ background: `${s.c}04`, border: `1px solid ${s.c}08` }}>
                    <p style={{ fontSize: 14, fontWeight: 800, color: s.c }}>{s.v}</p>
                    <p style={{ fontSize: 6, color: "rgba(255,255,255,0.2)" }}>{s.l}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "rgba(255,45,85,0.04)", border: "1px solid rgba(255,45,85,0.1)" }}>
                <AlertTriangle className="size-3" style={{ color: "#FF2D55" }} />
                <div className="flex-1"><p style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>Khalid Omar — 340m outside Zone A</p>
                  <p style={{ fontSize: 6, color: "rgba(255,255,255,0.2)" }}>Auto-broadcast sent to supervisor</p></div>
              </div>
            </motion.div>
          )}

          {/* BROADCAST */}
          {screen === "broadcast" && (
            <motion.div key="d-broadcast" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
              <div className="flex items-center gap-1.5"><Megaphone className="size-3.5" style={{ color: "#AF52DE" }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>Broadcast Center</span>
                <span className="ml-auto px-1.5 py-0.5 rounded" style={{ fontSize: 6, fontWeight: 700, color: "#AF52DE", background: "rgba(175,82,222,0.1)" }}>3 ACTIVE</span></div>
              {[
                { title: "H2S Alert — Zone A", audience: "All Zone A Workers", priority: "urgent", c: "#FF9500", source: "AI Auto" },
                { title: "GPS Violation Alert", audience: "Admins & Supervisors", priority: "urgent", c: "#FF2D55", source: "GPS Auto" },
                { title: "Shift Rotation Update", audience: "All Company", priority: "info", c: "#00C8E0", source: "Manual" },
              ].map((b, i) => (
                <motion.div key={i} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: i * 0.12 }}
                  className="flex items-center gap-2 p-2 rounded-lg" style={{ background: `${b.c}04`, border: `1px solid ${b.c}08` }}>
                  <div className="size-5 rounded flex items-center justify-center" style={{ background: `${b.c}12` }}>
                    <Megaphone className="size-2.5" style={{ color: b.c }} /></div>
                  <div className="flex-1"><p style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{b.title}</p>
                    <p style={{ fontSize: 6, color: "rgba(255,255,255,0.2)" }}>{b.audience} · {b.source}</p></div>
                  <span className="px-1 py-0.5 rounded" style={{ fontSize: 5.5, fontWeight: 700, color: b.c, background: `${b.c}10` }}>{b.priority.toUpperCase()}</span>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* SOS ALERT */}
          {screen === "sos-alert" && (
            <motion.div key="d-sos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
              <motion.div animate={{ boxShadow: ["0 0 0 0px rgba(255,45,85,0)", "0 0 0 6px rgba(255,45,85,0.08)", "0 0 0 0px rgba(255,45,85,0)"] }}
                transition={{ duration: 1.5, repeat: Infinity }} className="p-3 rounded-xl"
                style={{ background: "linear-gradient(135deg, rgba(255,45,85,0.06), rgba(255,45,85,0.02))", border: "1px solid rgba(255,45,85,0.2)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.6, repeat: Infinity }}>
                    <Siren className="size-5" style={{ color: "#FF2D55" }} /></motion.div>
                  <div className="flex-1"><p style={{ fontSize: 12, fontWeight: 800, color: "#FF2D55" }}>SOS EMERGENCY</p>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>Ahmed Al-Rashidi · Zone A</p></div>
                  <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 800, color: "#FF2D55", background: "rgba(255,45,85,0.12)" }}>CRITICAL</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[{ icon: Phone, label: "Call", c: "#00C853" }, { icon: MapPin, label: "GPS", c: "#00C8E0" }, { icon: MessageCircle, label: "Chat", c: "#FF9500" }].map(a => (
                    <div key={a.label} className="p-1.5 rounded-lg text-center" style={{ background: `${a.c}06` }}>
                      <a.icon className="size-3 mx-auto mb-0.5" style={{ color: a.c }} />
                      <p style={{ fontSize: 6.5, fontWeight: 700, color: a.c }}>{a.label}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* ESCALATION */}
          {screen === "escalation" && (
            <motion.div key="d-esc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              <p style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.12)", letterSpacing: "1px" }}>AUTO-ESCALATION ENGINE</p>
              {[
                { level: "L1", desc: "Zone Admin notified", status: "done", c: "#00C853" },
                { level: "L2", desc: "Company Admin alerted", status: "done", c: "#FF9500" },
                { level: "L3", desc: "Emergency services", status: "active", c: "#FF2D55" },
                { level: "L4", desc: "Company Owner", status: "pending", c: "rgba(255,255,255,0.15)" },
              ].map((s, i) => (
                <motion.div key={s.level} initial={{ x: 15, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.15 }}
                  className="flex items-center gap-2 p-2 rounded-lg"
                  style={{ background: s.status === "active" ? `${s.c}06` : "rgba(255,255,255,0.01)", border: `1px solid ${s.status !== "pending" ? `${s.c}15` : "rgba(255,255,255,0.03)"}` }}>
                  <div className="size-5 rounded flex items-center justify-center" style={{ background: `${s.c}12` }}>
                    {s.status === "done" ? <CheckCircle className="size-2.5" style={{ color: s.c }} /> :
                     s.status === "active" ? <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1, repeat: Infinity }}><Clock className="size-2.5" style={{ color: s.c }} /></motion.div> :
                     <Clock className="size-2.5" style={{ color: s.c }} />}
                  </div>
                  <span style={{ fontSize: 7, fontWeight: 800, color: s.c }}>{s.level}</span>
                  <span style={{ fontSize: 8, fontWeight: 600, color: s.status === "pending" ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.6)" }}>{s.desc}</span>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* GUIDED RESPONSE */}
          {screen === "guided-response" && (
            <motion.div key="d-guided" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
              <div className="flex items-center gap-1.5"><Sparkles className="size-3.5" style={{ color: "#00C8E0" }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0" }}>Guided Response</span></div>
              <div className="p-3 rounded-xl" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.1)" }}>
                {[
                  { step: 1, text: "Call Ahmed immediately", done: true },
                  { step: 2, text: "Assess via chat", active: true },
                  { step: 3, text: "Dispatch medical team" },
                  { step: 4, text: "Activate buddy system" },
                ].map(s => (
                  <div key={s.step} className={`flex items-center gap-2 mb-2 ${!s.done && !s.active ? "opacity-30" : ""}`}>
                    <div className="size-5 rounded-full flex items-center justify-center"
                      style={{ background: s.done ? "rgba(0,200,83,0.12)" : s.active ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)" }}>
                      <span style={{ fontSize: 8, fontWeight: 800, color: s.done ? "#00C853" : s.active ? "#00C8E0" : "rgba(255,255,255,0.2)" }}>{s.step}</span>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 600, color: s.done ? "#00C853" : s.active ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>{s.text}</span>
                    {s.done && <CheckCircle className="size-3 ml-auto" style={{ color: "#00C853" }} />}
                    {s.active && <motion.div animate={{ x: [0, 3, 0] }} transition={{ duration: 1, repeat: Infinity }}><ArrowRight className="size-3 ml-auto" style={{ color: "#00C8E0" }} /></motion.div>}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.08)" }}>
                <Phone className="size-3" style={{ color: "#00C853" }} />
                <span style={{ fontSize: 8, fontWeight: 600, color: "#00C853" }}>Connected with Ahmed — 01:23</span>
              </div>
            </motion.div>
          )}

          {/* EVACUATION */}
          {screen === "evacuation" && (
            <motion.div key="d-evac" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
              <div className="flex items-center gap-1.5"><ShieldAlert className="size-3.5" style={{ color: "#FF2D55" }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: "#FF2D55" }}>Evacuation Active — Zone D</span></div>
              <div className="grid grid-cols-3 gap-1.5">
                {[{ l: "Safe", v: "4", c: "#00C853" }, { l: "En Route", v: "2", c: "#FF9500" }, { l: "Unknown", v: "1", c: "#FF2D55" }].map(s => (
                  <div key={s.l} className="text-center p-2 rounded-lg" style={{ background: `${s.c}04`, border: `1px solid ${s.c}08` }}>
                    <p style={{ fontSize: 14, fontWeight: 800, color: s.c }}>{s.v}</p>
                    <p style={{ fontSize: 6, color: "rgba(255,255,255,0.2)" }}>{s.l}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                {["Ahmed K. — Safe ✓", "Fatima H. — En Route", "Khalid O. — Unknown ⚠"].map((w, i) => (
                  <motion.div key={w} initial={{ x: 10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.12 }}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)" }}>
                    <div className="size-4 rounded flex items-center justify-center" style={{ background: w.includes("Safe") ? "rgba(0,200,83,0.12)" : w.includes("Route") ? "rgba(255,150,0,0.12)" : "rgba(255,45,85,0.12)" }}>
                      <User className="size-2" style={{ color: w.includes("Safe") ? "#00C853" : w.includes("Route") ? "#FF9500" : "#FF2D55" }} /></div>
                    <span style={{ fontSize: 8, color: "rgba(255,255,255,0.5)" }}>{w}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* RESOLVED */}
          {screen === "resolved" && (
            <motion.div key="d-resolved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center gap-3" style={{ minHeight: 200 }}>
              <motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 200 }}
                className="size-14 rounded-full flex items-center justify-center"
                style={{ background: "rgba(0,200,83,0.1)", border: "2px solid rgba(0,200,83,0.2)" }}>
                <ShieldCheck className="size-7" style={{ color: "#00C853" }} /></motion.div>
              <p className="text-white" style={{ fontSize: 13, fontWeight: 800 }}>Incident Resolved</p>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Response: 4m 23s · PDF Report Generated</p>
              <div className="grid grid-cols-3 gap-2 w-full max-w-xs">
                {[{ l: "Response", v: "< 30s", c: "#00C853" }, { l: "Resolution", v: "4:23", c: "#00C8E0" }, { l: "SLA", v: "PASS", c: "#00C853" }].map(m => (
                  <div key={m.l} className="p-1.5 rounded-lg text-center" style={{ background: `${m.c}04` }}>
                    <p style={{ fontSize: 12, fontWeight: 800, color: m.c }}>{m.v}</p>
                    <p style={{ fontSize: 6, color: "rgba(255,255,255,0.15)" }}>{m.l}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* PLATFORM SHOWCASE */}
          {screen === "platform" && (
            <motion.div key="d-platform" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              <p style={{ fontSize: 8, fontWeight: 700, color: "rgba(0,200,224,0.4)", letterSpacing: "1px", textAlign: "center" }}>COMPLETE SAFETY PLATFORM</p>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { icon: Map, label: "Risk Map", c: "#00C8E0" }, { icon: Brain, label: "AI Intel", c: "#FF9500" },
                  { icon: LocateFixed, label: "GPS", c: "#00C853" }, { icon: Megaphone, label: "Broadcast", c: "#AF52DE" },
                  { icon: Siren, label: "SOS", c: "#FF2D55" }, { icon: Radio, label: "Escalation", c: "#AF52DE" },
                  { icon: Users, label: "Buddy", c: "#00C8E0" }, { icon: ShieldAlert, label: "Evacuation", c: "#FF2D55" },
                  { icon: Route, label: "Trips", c: "#FF9500" }, { icon: ClipboardCheck, label: "Checklists", c: "#00C853" },
                  { icon: Lock, label: "RBAC", c: "#00C8E0" }, { icon: BarChart3, label: "Analytics", c: "#FF9500" },
                ].map((f, i) => (
                  <motion.div key={f.label} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: i * 0.04, type: "spring", stiffness: 300 }}
                    className="text-center p-1.5 rounded-lg" style={{ background: `${f.c}04`, border: `1px solid ${f.c}08` }}>
                    <f.icon className="size-3 mx-auto mb-0.5" style={{ color: f.c }} />
                    <p style={{ fontSize: 6, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>{f.label}</p>
                  </motion.div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-1">
                {[{ l: "Roles", v: "8", c: "#00C8E0" }, { l: "Permissions", v: "30+", c: "#FF9500" }, { l: "Pages", v: "15+", c: "#00C853" }].map(s => (
                  <div key={s.l} className="text-center p-1.5 rounded-lg" style={{ background: `${s.c}04`, border: `1px solid ${s.c}08` }}>
                    <p style={{ fontSize: 12, fontWeight: 800, color: s.c }}>{s.v}</p>
                    <p style={{ fontSize: 6, color: "rgba(255,255,255,0.15)" }}>{s.l}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* IDLE */}
          {screen === "idle" && (
            <motion.div key="d-idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center gap-2 h-full opacity-20">
              <Shield className="size-6" style={{ color: "#00C8E0" }} />
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>Press Start to begin demo</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main WOW Demo Component
// ═══════════════════════════════════════════════════════════════
export function WowDemo() {
  const navigate = useNavigate();
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showIntro, setShowIntro] = useState(true);
  const [showFinale, setShowFinale] = useState(false);
  const [showNarration, setShowNarration] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncRef = useRef<string | null>(null);

  const currentEvent = EVENTS.find(e => elapsed >= e.time && elapsed < e.time + e.duration) || null;
  const progress = Math.min(elapsed / TOTAL_DURATION, 1);

  const { displayed: narText, done: narDone } = useTypewriter(currentEvent?.narration || "", 16);

  useEffect(() => {
    if (!currentEvent) return;
    if (lastSyncRef.current !== currentEvent.id) { lastSyncRef.current = currentEvent.id; emitDemoSync(currentEvent.id); }
  }, [currentEvent?.id]);

  const start = useCallback(() => { setShowIntro(false); setIsPlaying(true); setElapsed(0); lastSyncRef.current = null; }, []);
  const toggle = useCallback(() => setIsPlaying(p => !p), []);
  const reset = useCallback(() => { setIsPlaying(false); setElapsed(0); setShowIntro(true); setShowFinale(false); lastSyncRef.current = null; }, []);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setElapsed(prev => { if (prev >= TOTAL_DURATION) { setIsPlaying(false); setTimeout(() => setShowFinale(true), 500); return TOTAL_DURATION; } return prev + 0.1; });
      }, 100);
    } else { if (intervalRef.current) clearInterval(intervalRef.current); }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying]);

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col" style={{ background: "#02040A", fontFamily: "'Outfit', sans-serif" }}>
      {/* Ambient */}
      <div className="absolute inset-0 pointer-events-none">
        <div style={{ position: "absolute", top: "10%", left: "15%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,200,224,0.03), transparent 70%)" }} />
        <div style={{ position: "absolute", bottom: "10%", right: "20%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,45,85,0.02), transparent 70%)" }} />
      </div>

      {/* ── INTRO ── */}
      <AnimatePresence>
        {showIntro && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6" style={{ background: "rgba(2,4,10,0.98)" }}>
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.8, type: "spring" }}
              className="flex flex-col items-center gap-4">
              <div className="relative">
                <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }} transition={{ duration: 3, repeat: Infinity }}
                  className="absolute -inset-8 rounded-full" style={{ background: "radial-gradient(circle, rgba(0,200,224,0.15), transparent 70%)" }} />
                <div className="size-20 rounded-[24px] flex items-center justify-center relative z-10"
                  style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.25), rgba(0,200,224,0.08))", border: "1px solid rgba(0,200,224,0.3)", boxShadow: "0 12px 40px rgba(0,200,224,0.2)" }}>
                  <Shield className="size-10" style={{ color: "#00C8E0" }} /></div>
              </div>
              <div className="text-center">
                <h1 className="text-white" style={{ fontSize: 42, fontWeight: 900, letterSpacing: "-1px" }}>SOSphere</h1>
                <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,200,224,0.5)", letterSpacing: "4px", marginTop: 4 }}>PROACTIVE SAFETY INTELLIGENCE</p>
              </div>
              <p className="text-center max-w-lg" style={{ fontSize: 15, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                Experience a <span style={{ color: "#00C8E0", fontWeight: 600 }}>90-second cinematic demo</span> showcasing{" "}
                <span style={{ color: "#FF9500", fontWeight: 600 }}>12 platform features</span> across Mobile & Dashboard in real-time.
              </p>
            </motion.div>

            <motion.button initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={start}
              className="flex items-center gap-3 px-8 py-4 rounded-2xl"
              style={{ background: "linear-gradient(135deg, #00C8E0, #0099B8)", boxShadow: "0 12px 40px rgba(0,200,224,0.3)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <Play className="size-5 text-white" fill="white" />
              <span className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>Start 90s Demo</span>
            </motion.button>

            {/* Feature pills */}
            <div className="flex flex-wrap items-center justify-center gap-3 mt-2 max-w-xl">
              {["Risk Map", "AI Intelligence", "GPS Compliance", "SOS Emergency", "Auto-Escalation", "Broadcasts", "Buddy System", "Evacuation", "Trip Tracking", "PDF Reports", "RBAC (8 Roles)", "Pre-Shift Checklist"].map(f => (
                <span key={f} className="px-2.5 py-1 rounded-full" style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>{f}</span>
              ))}
            </div>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}
              className="flex items-center gap-2 mt-4 px-4 py-2 rounded-lg" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.08)" }}>
              <Wifi className="size-3.5 shrink-0" style={{ color: "rgba(0,200,83,0.5)" }} />
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                <span style={{ color: "rgba(0,200,83,0.6)", fontWeight: 600 }}>Pro tip:</span> Open <span style={{ color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>/dashboard</span> in another tab to see events sync live.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FINALE ── */}
      <AnimatePresence>
        {showFinale && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5" style={{ background: "rgba(2,4,10,0.97)", backdropFilter: "blur(20px)" }}>
            <motion.div initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
              className="size-24 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(0,200,83,0.2), rgba(0,200,83,0.05))", border: "2px solid rgba(0,200,83,0.3)", boxShadow: "0 0 60px rgba(0,200,83,0.15)" }}>
              <ShieldCheck className="size-12" style={{ color: "#00C853" }} /></motion.div>
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="text-center">
              <h2 className="text-white" style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-0.5px" }}>That's SOSphere</h2>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", marginTop: 6, maxWidth: 500, lineHeight: 1.6 }}>
                12 features demonstrated. From AI prediction to incident resolution in under 5 minutes.
                <br /><span style={{ color: "#00C8E0", fontWeight: 600 }}>Proactive. Intelligent. Life-saving.</span>
              </p>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="flex gap-5 mt-2">
              {[
                { label: "Features", value: "15+", color: "#00C8E0" }, { label: "Response Time", value: "< 30s", color: "#00C853" },
                { label: "AI Accuracy", value: "78%", color: "#FF9500" }, { label: "Escalation Levels", value: "4", color: "#AF52DE" },
                { label: "RBAC Roles", value: "8", color: "#00C8E0" }, { label: "Cost", value: "$0 GPS", color: "#00C853" },
              ].map((s, i) => (
                <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 + i * 0.08 }} className="text-center">
                  <p style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", fontWeight: 600, letterSpacing: "0.3px" }}>{s.label}</p>
                </motion.div>
              ))}
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="flex gap-3 mt-3">
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={reset}
                className="flex items-center gap-2 px-6 py-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
                <RotateCcw className="size-4" /> Replay
              </motion.button>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => navigate("/dashboard")}
                className="flex items-center gap-2 px-6 py-3 rounded-xl"
                style={{ background: "linear-gradient(135deg, #00C8E0, #0099B8)", boxShadow: "0 8px 30px rgba(0,200,224,0.3)", border: "1px solid rgba(255,255,255,0.1)", fontSize: 14, fontWeight: 700, color: "white" }}>
                Explore Dashboard <ArrowRight className="size-4" />
              </motion.button>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => navigate("/")}
                className="flex items-center gap-2 px-6 py-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
                Try Mobile App
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── HEADER ── */}
      <div className="flex items-center justify-between px-6 py-2.5 relative z-10" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex items-center gap-3">
          <div className="size-7 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.2)" }}>
            <Shield className="size-3.5" style={{ color: "#00C8E0" }} /></div>
          <span className="text-white" style={{ fontSize: 14, fontWeight: 800 }}>SOSphere</span>
          <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(0,200,224,0.35)", letterSpacing: "2px" }}>WOW DEMO</span>
        </div>

        {/* Live counters */}
        {!showIntro && !showFinale && (
          <div className="flex items-center gap-5">
            {[
              { label: "Workers Protected", value: 847, color: "#00C8E0" },
              { label: "Incidents Prevented", value: 23, color: "#00C853" },
              { label: "Response SLA", value: 99, color: "#FF9500", suffix: "%" },
            ].map(c => (
              <div key={c.label} className="text-center">
                <p style={{ fontSize: 14, fontWeight: 800, color: c.color, fontVariantNumeric: "tabular-nums" }}>
                  <AnimCounter to={c.value} duration={3000} suffix={c.suffix} />
                </p>
                <p style={{ fontSize: 7, color: "rgba(255,255,255,0.15)", fontWeight: 600, letterSpacing: "0.3px" }}>{c.label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowNarration(p => !p)}
            className="size-7 rounded-lg flex items-center justify-center"
            style={{ background: showNarration ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${showNarration ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.06)"}` }}>
            <Type className="size-3" style={{ color: showNarration ? "#00C8E0" : "rgba(255,255,255,0.2)" }} /></motion.button>
          <motion.button whileTap={{ scale: 0.95 }} onClick={toggle}
            className="size-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
            {isPlaying ? <Pause className="size-3" style={{ color: "#00C8E0" }} /> : <Play className="size-3" style={{ color: "#00C8E0" }} fill="#00C8E0" />}
          </motion.button>
          <motion.button whileTap={{ scale: 0.95 }} onClick={reset}
            className="size-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <RotateCcw className="size-3" style={{ color: "rgba(255,255,255,0.25)" }} /></motion.button>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <Clock className="size-2.5" style={{ color: "rgba(255,255,255,0.15)" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }}>{Math.floor(elapsed)}s / {TOTAL_DURATION}s</span>
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 flex items-stretch gap-6 px-6 py-4 relative z-10 overflow-hidden">
        {/* Phone */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 mb-1"><div className="size-1.5 rounded-full" style={{ background: "#00C8E0" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(0,200,224,0.4)", letterSpacing: "1px" }}>EMPLOYEE APP</span></div>
          <MobileSimulator event={currentEvent} />
        </div>

        {/* Connection */}
        <div className="flex flex-col items-center justify-center gap-1 shrink-0 self-center">
          <motion.div animate={currentEvent ? { boxShadow: [`0 0 0 0px ${currentEvent.color}00`, `0 0 0 5px ${currentEvent.color}15`, `0 0 0 0px ${currentEvent.color}00`] } : {}}
            transition={{ duration: 1.5, repeat: Infinity }} className="size-8 rounded-full flex items-center justify-center"
            style={{ background: currentEvent ? `${currentEvent.color}08` : "rgba(255,255,255,0.02)", border: `1px solid ${currentEvent ? `${currentEvent.color}20` : "rgba(255,255,255,0.05)"}` }}>
            <Wifi className="size-3.5" style={{ color: currentEvent?.color || "rgba(255,255,255,0.1)" }} /></motion.div>
          <div className="w-px h-8" style={{ background: `linear-gradient(to bottom, ${currentEvent?.color || "rgba(255,255,255,0.05)"}30, transparent)` }} />
          <span style={{ fontSize: 6, fontWeight: 700, color: "rgba(255,255,255,0.08)", letterSpacing: "1px" }}>SYNC</span>
          <div className="w-px h-8" style={{ background: `linear-gradient(to bottom, transparent, ${currentEvent?.color || "rgba(255,255,255,0.05)"}30)` }} />
        </div>

        {/* Dashboard */}
        <div className="flex flex-col flex-1 gap-2 min-w-0">
          <div className="flex items-center gap-1.5 mb-1"><div className="size-1.5 rounded-full" style={{ background: "#FF9500" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,150,0,0.4)", letterSpacing: "1px" }}>COMPANY DASHBOARD</span>
            {currentEvent && (
              <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-1 ml-auto">
                <div className="size-4 rounded flex items-center justify-center" style={{ background: `${currentEvent.color}12` }}>
                  <currentEvent.icon className="size-2.5" style={{ color: currentEvent.color }} /></div>
                <span style={{ fontSize: 8, fontWeight: 700, color: currentEvent.color }}>{currentEvent.title}</span>
              </motion.div>
            )}
          </div>
          <div className="flex-1" style={{ minHeight: 320 }}>
            <DashboardSimulator event={currentEvent} />
          </div>

          {/* Feature pills for current event */}
          <AnimatePresence mode="wait">
            {currentEvent && (
              <motion.div key={currentEvent.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 flex-wrap">
                {currentEvent.features.map((f, i) => (
                  <motion.span key={f} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.06 }}
                    className="px-2 py-0.5 rounded-full" style={{ fontSize: 7, fontWeight: 600, color: currentEvent.color, background: `${currentEvent.color}08`, border: `1px solid ${currentEvent.color}12` }}>
                    {f}
                  </motion.span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── NARRATION BAR ── */}
      <AnimatePresence mode="wait">
        {currentEvent && showNarration && !showIntro && !showFinale && (
          <motion.div key={currentEvent.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="mx-6 mb-1.5 rounded-xl overflow-hidden"
            style={{ background: "linear-gradient(135deg, rgba(10,18,32,0.95), rgba(5,7,14,0.98))", border: "1px solid rgba(255,255,255,0.05)", backdropFilter: "blur(20px)" }}>
            <div className="px-4 py-2.5">
              <div className="flex items-start gap-2.5">
                <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }}
                  className="mt-0.5 size-4 rounded shrink-0 flex items-center justify-center" style={{ background: `${currentEvent.color}10`, border: `1px solid ${currentEvent.color}15` }}>
                  <Type className="size-2.5" style={{ color: currentEvent.color }} /></motion.div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.65, minHeight: 16 }}>
                    {narText}{!narDone && <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }} style={{ color: currentEvent.color }}>|</motion.span>}
                  </p>
                  <AnimatePresence>{narDone && (
                    <motion.p initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                      style={{ fontSize: 10, fontWeight: 700, color: currentEvent.color, marginTop: 4, fontStyle: "italic" }}>{currentEvent.highlight}</motion.p>
                  )}</AnimatePresence>
                </div>
              </div>
            </div>
            <div className="h-px w-full" style={{ background: "rgba(255,255,255,0.03)" }}>
              <motion.div key={currentEvent.id} initial={{ width: "0%" }} animate={{ width: "100%" }}
                transition={{ duration: currentEvent.duration, ease: "linear" }} className="h-full"
                style={{ background: `linear-gradient(90deg, ${currentEvent.color}30, ${currentEvent.color}60)` }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── TIMELINE ── */}
      <div className="px-6 pb-3 pt-1 relative z-10">
        <div className="relative">
          <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.03)" }}>
            <motion.div className="h-full rounded-full" style={{
              width: `${progress * 100}%`,
              background: currentEvent ? `linear-gradient(90deg, #00C8E0, ${currentEvent.color})` : "#00C8E0",
              boxShadow: currentEvent ? `0 0 10px ${currentEvent.color}30` : "none",
            }} />
          </div>
          <div className="absolute top-0 left-0 right-0 h-1.5">
            {EVENTS.map(ev => (
              <div key={ev.id} className="absolute top-1/2 -translate-y-1/2 size-1.5 rounded-full transition-all duration-300"
                style={{
                  left: `${(ev.time / TOTAL_DURATION) * 100}%`,
                  background: elapsed >= ev.time ? ev.color : "rgba(255,255,255,0.08)",
                  boxShadow: elapsed >= ev.time && elapsed < ev.time + ev.duration ? `0 0 6px ${ev.color}` : "none",
                }} />
            ))}
          </div>
        </div>
        <div className="flex justify-between mt-1.5">
          {EVENTS.map(ev => {
            const isActive = elapsed >= ev.time && elapsed < ev.time + ev.duration;
            const isPast = elapsed >= ev.time + ev.duration;
            return (
              <div key={ev.id} className="flex flex-col items-center" style={{ width: `${100 / EVENTS.length}%` }}>
                <span style={{ fontSize: 5.5, fontWeight: isActive ? 800 : 600, color: isActive ? ev.color : isPast ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)",
                  letterSpacing: "0.2px", textAlign: "center", transition: "all 0.3s" }}>{ev.title}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
