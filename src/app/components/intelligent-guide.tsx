// =====================================================================
// SOSphere — Intelligent Response Engine (IRE) v1
// ─────────────────────────────────────────────────────────────────────
// A revolutionary AI-powered emergency response wizard that:
// 1. AUTO-SCANS the situation (battery, signal, type, severity)
// 2. BUILDS a custom response protocol in real-time
// 3. AUTO-EXECUTES safe actions (GPS tracking, zone alerts)
// 4. GUIDES the admin step-by-step with smart recommendations
// 5. SCORES response quality in real-time
// 6. GENERATES incident summary at completion
// ─────────────────────────────────────────────────────────────────────
// "The AI copilot that never lets an emergency go unanswered"
// =====================================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shield, Phone, MapPin, Users, Siren, Clock, X, CheckCircle2, AlertTriangle, Zap, ChevronRight, Activity, Battery, Wifi, WifiOff, Send, MessageCircle, Navigation, Ambulance, Megaphone, ArrowUpRight, FileText, TrendingUp, Target, Camera, Award, Star, ChevronLeft, Sparkles, Brain, Crosshair, Lock, Heart, Bot, Download, Crown, Medal, Flame, TrendingDown, QrCode } from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, playUISound } from "./haptic-feedback";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { recordIREResponse, getAdminRating, buildQRPayload, generateVerificationHash, type AdminRating } from "./ire-performance-store";
import { sendPhaseNotification } from "./ire-push-notification";

// =====================================================================
// Types
// =====================================================================

export interface IREContext {
  emergencyId: string;
  employeeName: string;
  employeeRole?: string;
  zone: string;
  sosType: string;
  severity: "critical" | "high" | "medium" | "low";
  elapsed: number;
  batteryLevel?: number;
  signalStrength?: "excellent" | "good" | "fair" | "poor" | "none";
  isAirplaneMode?: boolean;
  lastGPS?: { lat: number; lng: number };
  phone?: string;
  isJourney?: boolean;
  journeyRoute?: string;
}

type IREPhase = "scanning" | "contact" | "locate" | "dispatch" | "escalate" | "document" | "complete";

// =====================================================================
// Type-Specific Protocol Instructions (FIX 2)
// =====================================================================

type TypeInstructionSet = Partial<Record<IREPhase, { title: string; instruction: string; color: string }>>;

const TYPE_INSTRUCTIONS: Record<string, TypeInstructionSet> = {
  fall_detected: {
    contact:  { title: "FALL PROTOCOL", instruction: "Do NOT ask the employee to move. They may have a spinal or head injury. Ask: \"Can you feel your hands and feet?\"", color: "#FF2D55" },
    locate:   { title: "FALL PROTOCOL", instruction: "Last GPS position is critical — lock it before the device dies. Mark exact location for paramedics.", color: "#FF9500" },
    dispatch: { title: "FALL PROTOCOL", instruction: "Request an ambulance — possible spinal injury. Do NOT let anyone move the employee until paramedics arrive.", color: "#FF2D55" },
    escalate: { title: "FALL PROTOCOL", instruction: "Notify management immediately. This may be a workplace injury requiring regulatory reporting within 24h.", color: "#FF9500" },
  },
  shake_sos: {
    contact:  { title: "DURESS PROTOCOL", instruction: "Employee may be under threat. Use silent chat first — they may not be able to speak safely.", color: "#FF2D55" },
    locate:   { title: "DURESS PROTOCOL", instruction: "Track live GPS discreetly. Do NOT send alerts that could be visible on the employee's screen.", color: "#FF9500" },
    dispatch: { title: "DURESS PROTOCOL", instruction: "Dispatch security team silently. Consider involving law enforcement if employee is being held.", color: "#FF2D55" },
  },
  geofence: {
    contact:  { title: "GEOFENCE BREACH", instruction: "Employee may have accidentally wandered. Call to verify before escalating — many breaches are benign.", color: "#FF9500" },
    locate:   { title: "GEOFENCE BREACH", instruction: "Check if they're near the boundary or deep outside. Direction of movement matters.", color: "#00C8E0" },
    dispatch: { title: "GEOFENCE BREACH", instruction: "If in a hazardous area, dispatch immediately. If near boundary, a phone call may suffice.", color: "#FF9500" },
  },
  missed_checkin: {
    contact:  { title: "MISSED CHECK-IN", instruction: "This could be a forgotten check-in or a real emergency. Try all contact methods before dispatching.", color: "#FF9500" },
    locate:   { title: "MISSED CHECK-IN", instruction: "Check if GPS shows movement — a moving device suggests the employee is okay but forgot to check in.", color: "#00C8E0" },
    dispatch: { title: "MISSED CHECK-IN", instruction: "If no contact after 5 minutes, treat as potential emergency and dispatch a buddy to verify.", color: "#FF9500" },
  },
  hazard: {
    contact:  { title: "HAZARD REPORT", instruction: "Ask for specific hazard type (chemical, fire, structural). This determines evacuation scope.", color: "#FF9500" },
    locate:   { title: "HAZARD REPORT", instruction: "Do NOT enter the hazard zone. Mark the perimeter on the map for approaching responders.", color: "#FF2D55" },
    dispatch: { title: "HAZARD REPORT", instruction: "Call specialized services: fire department for fire/chemical, structural engineers for collapse.", color: "#FF2D55" },
    escalate: { title: "HAZARD REPORT", instruction: "Issue zone evacuation immediately. Notify all employees in adjacent zones.", color: "#FF2D55" },
  },
  journey_sos: {
    contact:  { title: "JOURNEY EMERGENCY", instruction: "Try all contact methods — phone, WhatsApp, SMS. The driver may be injured or the vehicle immobilized.", color: "#FF2D55" },
    locate:   { title: "JOURNEY EMERGENCY", instruction: "Check last known route waypoints. Compare current GPS with planned route to find deviation point.", color: "#FF9500" },
    dispatch: { title: "JOURNEY EMERGENCY", instruction: "Activate SAR protocol for the route segment. Alert nearest waypoint responders and emergency services.", color: "#FF2D55" },
    escalate: { title: "JOURNEY EMERGENCY", instruction: "Notify all vehicles on the same route. Block the route segment if there's a road hazard.", color: "#FF9500" },
  },
  journey_deviation: {
    contact:  { title: "ROUTE DEVIATION", instruction: "Driver may have taken an alternate route intentionally. Call to verify before escalating.", color: "#FF9500" },
    locate:   { title: "ROUTE DEVIATION", instruction: "Track if the vehicle is moving toward the destination or away from it. Speed matters.", color: "#00C8E0" },
    dispatch: { title: "ROUTE DEVIATION", instruction: "If no contact and moving away from route, treat as potential hijacking. Alert security.", color: "#FF2D55" },
  },
  journey_no_contact: {
    contact:  { title: "LOST CONTACT", instruction: "Employee is unreachable on their route. This is HIGH PRIORITY — they could be in a dead zone or in danger.", color: "#FF2D55" },
    locate:   { title: "LOST CONTACT", instruction: "Last GPS fix is your only lead. Check the terrain — dead zones, tunnels, remote areas.", color: "#FF2D55" },
    dispatch: { title: "LOST CONTACT", instruction: "Activate full SAR protocol immediately. Send nearest vehicle to last known position.", color: "#FF2D55" },
  },
};

function getTypeInstruction(sosType: string, phase: IREPhase): TypeInstructionSet[IREPhase] | null {
  const key = sosType.includes("fire") || sosType.includes("chemical") ? "hazard" : sosType;
  return TYPE_INSTRUCTIONS[key]?.[phase] || null;
}

interface ScanResult {
  label: string;
  value: string;
  status: "ok" | "warning" | "critical";
  icon: any;
}

interface SmartAction {
  id: string;
  label: string;
  description: string;
  icon: any;
  color: string;
  autoExecute?: boolean;
  recommended?: boolean;
  completed: boolean;
  executing: boolean;
  optional?: boolean;
  resultText?: string;
}

const PHASE_META: Record<IREPhase, { label: string; color: string; icon: any; shortLabel: string }> = {
  scanning:  { label: "THREAT ASSESSMENT",   color: "#8B5CF6", icon: Brain,       shortLabel: "SCAN" },
  contact:   { label: "ESTABLISH CONTACT",   color: "#00C853", icon: Phone,       shortLabel: "CONTACT" },
  locate:    { label: "LOCATE & TRACK",      color: "#00C8E0", icon: Crosshair,   shortLabel: "LOCATE" },
  dispatch:  { label: "DISPATCH RESPONSE",   color: "#FF9500", icon: Send,        shortLabel: "DISPATCH" },
  escalate:  { label: "ESCALATE & ALERT",    color: "#FF2D55", icon: Megaphone,   shortLabel: "ESCALATE" },
  document:  { label: "DOCUMENT & EVIDENCE", color: "#7B5EFF", icon: FileText,    shortLabel: "DOCUMENT" },
  complete:  { label: "RESPONSE COMPLETE",   color: "#00C853", icon: Award,       shortLabel: "DONE" },
};

const ALL_PHASES: IREPhase[] = ["scanning", "contact", "locate", "dispatch", "escalate", "document", "complete"];

// =====================================================================
// Threat Assessment Engine
// =====================================================================

function assessThreat(ctx: IREContext): {
  level: number; // 1-10
  label: string;
  protocol: string;
  scans: ScanResult[];
  recommendations: string[];
  autoActions: string[];
} {
  let threat = 0;
  const scans: ScanResult[] = [];
  const recommendations: string[] = [];
  const autoActions: string[] = [];

  // SOS Type assessment
  const typeScores: Record<string, number> = {
    sos_button: 8, fall_detected: 9, shake_sos: 8,
    missed_checkin: 5, geofence: 6, hazard: 4,
    journey_sos: 9, journey_deviation: 6, journey_no_contact: 7,
  };
  threat += typeScores[ctx.sosType] || 7;
  scans.push({
    label: "SOS Type",
    value: ctx.sosType.replace(/_/g, " ").toUpperCase(),
    status: (typeScores[ctx.sosType] || 7) >= 8 ? "critical" : (typeScores[ctx.sosType] || 7) >= 6 ? "warning" : "ok",
    icon: Siren,
  });

  // Severity
  const sevScores = { critical: 10, high: 7, medium: 4, low: 2 };
  threat += sevScores[ctx.severity];
  scans.push({
    label: "Severity",
    value: ctx.severity.toUpperCase(),
    status: ctx.severity === "critical" ? "critical" : ctx.severity === "high" ? "warning" : "ok",
    icon: AlertTriangle,
  });

  // Battery
  const bat = ctx.batteryLevel ?? 80;
  if (bat < 10) { threat += 3; recommendations.push("CRITICAL: Battery below 10% -- track GPS immediately before device dies"); autoActions.push("GPS_LOCK"); }
  else if (bat < 25) { threat += 1; recommendations.push("Low battery -- prioritize location data capture"); }
  scans.push({
    label: "Device Battery",
    value: `${bat}%`,
    status: bat < 10 ? "critical" : bat < 25 ? "warning" : "ok",
    icon: Battery,
  });

  // Signal
  const sigScores: Record<string, number> = { excellent: 0, good: 0, fair: 1, poor: 2, none: 4 };
  threat += sigScores[ctx.signalStrength || "good"];
  if (ctx.isAirplaneMode) { threat += 3; recommendations.push("Device is OFFLINE -- cannot reach employee. Dispatch team immediately"); autoActions.push("AUTO_DISPATCH"); }
  else if (ctx.signalStrength === "none" || ctx.signalStrength === "poor") { recommendations.push("Weak signal -- use WhatsApp call (lower bandwidth) instead of cellular"); }
  scans.push({
    label: "Signal",
    value: ctx.isAirplaneMode ? "OFFLINE" : (ctx.signalStrength || "good").toUpperCase(),
    status: ctx.isAirplaneMode || ctx.signalStrength === "none" ? "critical" : ctx.signalStrength === "poor" ? "warning" : "ok",
    icon: ctx.isAirplaneMode ? WifiOff : Wifi,
  });

  // Elapsed time
  if (ctx.elapsed > 300) { threat += 2; recommendations.push("Over 5 minutes without response -- consider full emergency protocol"); }
  else if (ctx.elapsed > 120) { threat += 1; }
  scans.push({
    label: "Time Elapsed",
    value: ctx.elapsed > 60 ? `${Math.floor(ctx.elapsed / 60)}m ${ctx.elapsed % 60}s` : `${ctx.elapsed}s`,
    status: ctx.elapsed > 300 ? "critical" : ctx.elapsed > 120 ? "warning" : "ok",
    icon: Clock,
  });

  // GPS
  scans.push({
    label: "GPS Lock",
    value: ctx.lastGPS ? `${ctx.lastGPS.lat.toFixed(4)}, ${ctx.lastGPS.lng.toFixed(4)}` : "No GPS Data",
    status: ctx.lastGPS ? "ok" : "warning",
    icon: MapPin,
  });

  // Zone risk (simulated)
  scans.push({
    label: "Zone Risk",
    value: ctx.zone.includes("High") || ctx.zone.includes("Mining") ? "HIGH RISK" : ctx.zone.includes("Remote") ? "ELEVATED" : "STANDARD",
    status: ctx.zone.includes("High") || ctx.zone.includes("Mining") ? "critical" : ctx.zone.includes("Remote") ? "warning" : "ok",
    icon: Shield,
  });

  const normalizedThreat = Math.min(10, Math.round(threat / 3));
  const label = normalizedThreat >= 8 ? "CRITICAL THREAT" : normalizedThreat >= 6 ? "HIGH THREAT" : normalizedThreat >= 4 ? "MODERATE THREAT" : "LOW THREAT";
  const protocol = normalizedThreat >= 8 ? "FULL EMERGENCY PROTOCOL" : normalizedThreat >= 6 ? "PRIORITY RESPONSE" : normalizedThreat >= 4 ? "STANDARD RESPONSE" : "MONITORING";

  if (normalizedThreat >= 8) autoActions.push("ZONE_ALERT", "MANAGEMENT_NOTIFY");
  if (ctx.severity === "critical") autoActions.push("GPS_LOCK");

  return { level: normalizedThreat, label, protocol, scans, recommendations, autoActions };
}

// =====================================================================
// Phase Action Generators
// =====================================================================

function getContactActions(ctx: IREContext, threatLevel: number): SmartAction[] {
  const isOffline = ctx.isAirplaneMode || ctx.signalStrength === "none";
  return [
    {
      id: "call_cellular",
      label: "Direct Phone Call",
      description: isOffline ? "Employee offline -- call may not connect" : "Fastest way to assess the situation",
      icon: Phone, color: "#00C853",
      recommended: !isOffline,
      completed: false, executing: false,
      resultText: "Call placed via device dialer",
    },
    {
      id: "call_whatsapp",
      label: "WhatsApp Call",
      description: "Lower bandwidth -- works on weak signal",
      icon: MessageCircle, color: "#25D366",
      recommended: ctx.signalStrength === "poor" || ctx.signalStrength === "fair",
      completed: false, executing: false,
      resultText: "WhatsApp call initiated",
    },
    {
      id: "send_sms",
      label: "Emergency SMS",
      description: "Auto-sends: 'Admin [name] is responding. Stay calm.'",
      icon: Send, color: "#00C8E0",
      autoExecute: threatLevel >= 7,
      completed: false, executing: false,
      resultText: "Emergency SMS auto-sent to employee",
    },
    {
      id: "silent_chat",
      label: "Silent Emergency Chat",
      description: "If employee can't speak -- text-only channel",
      icon: MessageCircle, color: "#FF9500",
      optional: true,
      completed: false, executing: false,
      resultText: "Chat channel opened",
    },
  ];
}

function getLocateActions(ctx: IREContext, threatLevel: number): SmartAction[] {
  return [
    {
      id: "gps_lock",
      label: "Lock GPS Position",
      description: "Capture current coordinates before device dies",
      icon: Crosshair, color: "#00C8E0",
      autoExecute: true,
      completed: false, executing: false,
      resultText: ctx.lastGPS ? `Locked: ${ctx.lastGPS.lat.toFixed(4)}, ${ctx.lastGPS.lng.toFixed(4)}` : "GPS signal acquired -- position locked",
    },
    {
      id: "live_track",
      label: "Activate Live Tracking",
      description: "Real-time GPS stream to Risk Map",
      icon: Navigation, color: "#00C853",
      autoExecute: threatLevel >= 6,
      completed: false, executing: false,
      resultText: "Live tracking active -- updating every 5s",
    },
    {
      id: "nearest_point",
      label: "Find Nearest Rescue Point",
      description: "Calculate closest hospital, fire station, or assembly point",
      icon: Target, color: "#FF9500",
      autoExecute: true,
      completed: false, executing: false,
      resultText: "Nearest: Al-Rashid Hospital (2.3km, ~4min by car)",
    },
    {
      id: "zone_map",
      label: "Open Risk Map Live",
      description: "Visual map with employee position and hazard zones",
      icon: MapPin, color: "#8B5CF6",
      optional: true,
      completed: false, executing: false,
      resultText: "Risk Map opened in new tab",
    },
  ];
}

function getDispatchActions(ctx: IREContext, threatLevel: number): SmartAction[] {
  return [
    {
      id: "dispatch_team",
      label: "Dispatch Response Team",
      description: "Alert on-duty responders in the zone",
      icon: Users, color: "#FF9500",
      autoExecute: threatLevel >= 8,
      recommended: threatLevel >= 6,
      completed: false, executing: false,
      resultText: "3 responders dispatched -- ETA 8 minutes",
    },
    {
      id: "call_911",
      label: "Call Emergency Services (911)",
      description: "External emergency -- police, ambulance, fire",
      icon: Ambulance, color: "#FF2D55",
      recommended: ctx.severity === "critical",
      completed: false, executing: false,
      resultText: "Emergency services notified -- case #SOSph-78234",
    },
    {
      id: "buddy_alert",
      label: "Alert Safety Buddy",
      description: "Notify assigned buddy partner",
      icon: Heart, color: "#E91E63",
      autoExecute: true,
      completed: false, executing: false,
      resultText: "Buddy Ahmed K. notified via push + SMS",
    },
    {
      id: "zone_lockdown",
      label: "Zone Restriction / Evacuation",
      description: "Restrict access or evacuate the zone",
      icon: Lock, color: "#FF6B00",
      optional: true,
      completed: false, executing: false,
      resultText: "Zone restriction activated -- workers redirected",
    },
  ];
}

function getEscalateActions(ctx: IREContext, threatLevel: number): SmartAction[] {
  return [
    {
      id: "zone_admin_alert",
      label: "Alert Zone Admins",
      description: "Notify all admins in the affected zone",
      icon: Shield, color: "#FF9500",
      autoExecute: threatLevel >= 7,
      completed: false, executing: false,
      resultText: "2 Zone Admins notified -- acknowledged in 12s",
    },
    {
      id: "mgmt_escalate",
      label: "Escalate to Management",
      description: "Notify Main Admin and Company Owner",
      icon: ArrowUpRight, color: "#FF2D55",
      recommended: ctx.severity === "critical",
      completed: false, executing: false,
      resultText: "Owner + Main Admin notified with full context",
    },
    {
      id: "broadcast_alert",
      label: "Company-Wide Broadcast",
      description: "Alert all employees about the situation",
      icon: Megaphone, color: "#00C8E0",
      optional: true,
      completed: false, executing: false,
      resultText: "Broadcast sent to 142 on-duty employees",
    },
    {
      id: "regulatory_report",
      label: "Prepare Regulatory Report",
      description: "OSHA / labor authority notification if required",
      icon: FileText, color: "#8B5CF6",
      optional: true,
      completed: false, executing: false,
      resultText: "Regulatory form pre-filled -- review before submission",
    },
  ];
}

function getDocumentActions(_ctx: IREContext): SmartAction[] {
  return [
    {
      id: "auto_timeline",
      label: "Generate Incident Timeline",
      description: "Auto-created from all actions with timestamps",
      icon: Clock, color: "#00C8E0",
      autoExecute: true,
      completed: false, executing: false,
      resultText: "Timeline generated -- 12 events logged",
    },
    {
      id: "evidence_collect",
      label: "Collect Evidence Package",
      description: "Photos, audio recordings, chat logs, GPS trail",
      icon: Camera, color: "#FF9500",
      completed: false, executing: false,
      resultText: "Evidence package assembled -- 4 items collected",
    },
    {
      id: "incident_report",
      label: "Generate PDF Incident Report",
      description: "Full incident report with evidence attachments",
      icon: FileText, color: "#7B5EFF",
      completed: false, executing: false,
      resultText: "PDF report generated -- ready for download",
    },
    {
      id: "lessons_learned",
      label: "Log Lessons Learned",
      description: "What went well, what could improve",
      icon: TrendingUp, color: "#00C853",
      optional: true,
      completed: false, executing: false,
      resultText: "Feedback logged -- added to Safety Intelligence",
    },
  ];
}

// =====================================================================
// Main Component — Intelligent Response Engine
// =====================================================================

export function IntelligentGuide({
  context,
  onClose,
  onNavigate,
  onResolve,
  onOpenChat,
  adminName = "Admin",
}: {
  context: IREContext;
  onClose: () => void;
  onNavigate?: (page: string) => void;
  onResolve?: (id: string) => void;
  onOpenChat?: (emergencyId: string, employeeName: string) => void;
  adminName?: string;
}) {
  const [phase, setPhase] = useState<IREPhase>("scanning");
  const [scanProgress, setScanProgress] = useState(0);
  const [scanComplete, setScanComplete] = useState(false);
  const [assessment, setAssessment] = useState<ReturnType<typeof assessThreat> | null>(null);
  const [phaseActions, setPhaseActions] = useState<Record<IREPhase, SmartAction[]>>({} as any);
  const [elapsed, setElapsed] = useState(context.elapsed);
  const [responseScore, setResponseScore] = useState(100);
  const [completedPhases, setCompletedPhases] = useState<IREPhase[]>([]);
  const [autoLog, setAutoLog] = useState<Array<{ time: number; text: string; color: string }>>([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showPerformance, setShowPerformance] = useState(false);
  const [adminRating, setAdminRating] = useState<AdminRating | null>(null);
  const [recordSaved, setRecordSaved] = useState(false);
  const scoreDecayRef = useRef<ReturnType<typeof setInterval>>();

  // ── FIX 4: Per-phase countdown timer ─────────────────────────
  const [phaseCountdown, setPhaseCountdown] = useState(0);
  const [phaseTimedOut, setPhaseTimedOut] = useState(false);
  const phaseCountdownRef = useRef<ReturnType<typeof setInterval>>();

  // Calculate phase time budget based on threat level
  const getPhaseTimeBudget = (threatLevel: number): number => {
    if (threatLevel >= 8) return 30;   // Critical: 30s per phase
    if (threatLevel >= 6) return 60;   // High: 60s per phase
    return 90;                          // Medium/Low: 90s per phase
  };

  // Reset and start countdown when phase changes
  useEffect(() => {
    if (phase === "scanning" || phase === "complete") {
      if (phaseCountdownRef.current) clearInterval(phaseCountdownRef.current);
      return;
    }
    const budget = getPhaseTimeBudget(assessment?.level || 5);
    setPhaseCountdown(budget);
    setPhaseTimedOut(false);
    if (phaseCountdownRef.current) clearInterval(phaseCountdownRef.current);
    phaseCountdownRef.current = setInterval(() => {
      setPhaseCountdown(p => {
        if (p <= 1) {
          setPhaseTimedOut(true);
          return 0;
        }
        return p - 1;
      });
    }, 1000);
    return () => { if (phaseCountdownRef.current) clearInterval(phaseCountdownRef.current); };
  }, [phase, assessment?.level]);

  // ── Elapsed Timer ────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setElapsed(p => p + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Score Decay — Response score drops over time during active phases ──
  useEffect(() => {
    if (phase === "scanning" || phase === "complete") return;
    scoreDecayRef.current = setInterval(() => {
      setResponseScore(p => Math.max(10, p - 0.3));
    }, 1000);
    return () => { if (scoreDecayRef.current) clearInterval(scoreDecayRef.current); };
  }, [phase]);

  const addLog = useCallback((text: string, color: string) => {
    setAutoLog(p => [...p, { time: elapsed, text, color }]);
  }, [elapsed]);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Scanning Phase — AI Assessment ───────────────────────────
  useEffect(() => {
    if (phase !== "scanning") return;
    playUISound("scan");
    let frame = 0;
    const scanInterval = setInterval(() => {
      frame += 1;
      setScanProgress(Math.min(100, frame * 4));
      if (frame >= 25) {
        clearInterval(scanInterval);
        const result = assessThreat(context);
        setAssessment(result);
        setScanComplete(true);
        // Build phase actions
        setPhaseActions({
          scanning: [],
          contact: getContactActions(context, result.level),
          locate: getLocateActions(context, result.level),
          dispatch: getDispatchActions(context, result.level),
          escalate: getEscalateActions(context, result.level),
          document: getDocumentActions(context),
          complete: [],
        });
        addLog("Threat assessment complete -- Level " + result.level + "/10", "#8B5CF6");
        result.autoActions.forEach(a => addLog("AUTO: " + a.replace(/_/g, " "), "#FF9500"));
      }
    }, 100);
    return () => clearInterval(scanInterval);
  }, [phase]);

  // ── Auto-advance from scanning to contact ───────────────────
  useEffect(() => {
    if (scanComplete && phase === "scanning") {
      const t = setTimeout(() => {
        setPhase("contact");
        setCompletedPhases(p => [...p, "scanning"]);
        addLog("Phase 1: ESTABLISH CONTACT initiated", "#00C853");
      }, 1800);
      return () => clearTimeout(t);
    }
  }, [scanComplete, phase]);

  // ── Auto-execute actions when entering a phase ──────────────
  useEffect(() => {
    if (phase === "scanning" || phase === "complete") return;
    const actions = phaseActions[phase];
    if (!actions) return;
    actions.forEach((action, i) => {
      if (action.autoExecute && !action.completed && !action.executing) {
        setTimeout(() => {
          setPhaseActions(prev => {
            const next = { ...prev };
            const list = [...(next[phase] || [])];
            list[i] = { ...list[i], executing: true };
            next[phase] = list;
            return next;
          });
          addLog("AUTO-EXECUTING: " + action.label, action.color);
          // Simulate execution
          setTimeout(() => {
            setPhaseActions(prev => {
              const next = { ...prev };
              const list = [...(next[phase] || [])];
              list[i] = { ...list[i], executing: false, completed: true };
              next[phase] = list;
              return next;
            });
            addLog("COMPLETED: " + action.label, "#00C853");
            setResponseScore(p => Math.min(100, p + 3));
          }, 1500 + i * 800);
        }, 600 + i * 1200);
      }
    });
  }, [phase, phaseActions]);

  // ── Manual Action Handler ───────────────────────────────────
  const executeAction = (actionId: string) => {
    const actions = phaseActions[phase];
    if (!actions) return;
    const idx = actions.findIndex(a => a.id === actionId);
    if (idx < 0 || actions[idx].completed || actions[idx].executing) return;
    setPhaseActions(prev => {
      const next = { ...prev };
      const list = [...(next[phase] || [])];
      list[idx] = { ...list[idx], executing: true };
      next[phase] = list;
      return next;
    });
    addLog("EXECUTING: " + actions[idx].label, actions[idx].color);
    // Navigate if it's a map action
    if (actionId === "zone_map" && onNavigate) onNavigate("riskMap");
    // Open chat if silent_chat action
    if (actionId === "silent_chat" && onOpenChat) {
      playUISound("chatOpen");
      onOpenChat(context.emergencyId, context.employeeName);
    }
    // Simulate
    setTimeout(() => {
      setPhaseActions(prev => {
        const next = { ...prev };
        const list = [...(next[phase] || [])];
        list[idx] = { ...list[idx], executing: false, completed: true };
        next[phase] = list;
        return next;
      });
      addLog("COMPLETED: " + actions[idx].label, "#00C853");
      setResponseScore(p => Math.min(100, p + 5));
      playUISound("actionDone");
      toast.success(actions[idx].label, { description: actions[idx].resultText, duration: 3000 });
    }, 2000);
  };

  // ── Advance to Next Phase ───────────────────────────────────
  const advancePhase = () => {
    const idx = ALL_PHASES.indexOf(phase);
    if (idx < ALL_PHASES.length - 1) {
      setCompletedPhases(p => [...p, phase]);
      const nextPhase = ALL_PHASES[idx + 1];
      setPhase(nextPhase);
      playUISound("phaseComplete");
      // Background tab notification
      sendPhaseNotification(PHASE_META[phase].label, PHASE_META[nextPhase].label, responseScore);
      if (nextPhase !== "complete") {
        addLog(`Phase ${idx + 1}: ${PHASE_META[nextPhase].label} initiated`, PHASE_META[nextPhase].color);
      } else {
        addLog("All phases complete -- Response Score: " + Math.round(responseScore), "#00C853");
        hapticSuccess();
        // Record performance
        if (!recordSaved) {
          const record = recordIREResponse({
            emergencyId: context.emergencyId,
            employeeName: context.employeeName,
            zone: context.zone,
            sosType: context.sosType,
            severity: context.severity,
            responseScore: Math.round(responseScore),
            responseTimeSec: elapsed,
            phasesCompleted: completedPhases.length + 1,
            actionsCount: autoLog.filter(l => l.text.startsWith("COMPLETED")).length,
            autoActionsCount: autoLog.filter(l => l.text.startsWith("AUTO")).length,
            threatLevel: assessment?.level || 0,
          });
          setRecordSaved(true);
          setAdminRating(getAdminRating());
        }
        if (onResolve) onResolve(context.emergencyId);
      }
    }
  };

  const currentActions = phaseActions[phase] || [];
  const completedCount = currentActions.filter(a => a.completed).length;
  const requiredActions = currentActions.filter(a => !a.optional);
  const requiredCompleted = requiredActions.filter(a => a.completed).length;
  const canAdvance = requiredActions.length === 0 || requiredCompleted >= Math.ceil(requiredActions.length * 0.5);
  const phaseIdx = ALL_PHASES.indexOf(phase);
  const phaseMeta = PHASE_META[phase];
  const scoreColor = responseScore >= 80 ? "#00C853" : responseScore >= 50 ? "#FF9500" : "#FF2D55";
  const scoreLabel = responseScore >= 90 ? "EXCELLENT" : responseScore >= 70 ? "GOOD" : responseScore >= 50 ? "FAIR" : "NEEDS IMPROVEMENT";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[400] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)" }}
    >
      <motion.div
        initial={{ scale: 0.88, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="relative w-full max-w-2xl mx-4 flex flex-col"
        style={{
          maxHeight: "94vh",
          background: "linear-gradient(180deg, #0C1425, #05070E)",
          borderRadius: 28,
          border: `1px solid ${phaseMeta.color}25`,
          boxShadow: `0 40px 100px rgba(0,0,0,0.7), 0 0 40px ${phaseMeta.color}08`,
          overflow: "hidden",
        }}
      >
        {/* ── Ambient glow ── */}
        <motion.div
          animate={{ opacity: [0.03, 0.08, 0.03] }}
          transition={{ duration: 4, repeat: Infinity }}
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at top center, ${phaseMeta.color}20, transparent 70%)` }}
        />

        {/* ══════════════════════════════════════════════════════════
            HEADER
        ══════════════════════════════════════════════════════════ */}
        <div className="relative px-5 pt-4 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <motion.div
                animate={{ rotate: phase === "scanning" ? 360 : 0 }}
                transition={phase === "scanning" ? { duration: 2, repeat: Infinity, ease: "linear" } : {}}
                className="size-8 rounded-xl flex items-center justify-center"
                style={{ background: `${phaseMeta.color}15`, border: `1px solid ${phaseMeta.color}25` }}
              >
                <Bot className="size-4" style={{ color: phaseMeta.color }} />
              </motion.div>
              <div>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 11, fontWeight: 800, color: phaseMeta.color, letterSpacing: "0.5px" }}>
                    INTELLIGENT RESPONSE ENGINE
                  </span>
                  <motion.div
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="px-1.5 py-0.5 rounded-md"
                    style={{ background: `${phaseMeta.color}15`, border: `1px solid ${phaseMeta.color}20` }}
                  >
                    <span style={{ fontSize: 7, fontWeight: 800, color: phaseMeta.color, letterSpacing: "0.5px" }}>
                      {phaseMeta.label}
                    </span>
                  </motion.div>
                </div>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>
                  {context.employeeName} -- {context.zone}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Response Score */}
              {phase !== "scanning" && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
                  style={{ background: `${scoreColor}08`, border: `1px solid ${scoreColor}15` }}>
                  <Star className="size-3" style={{ color: scoreColor }} />
                  <span style={{ fontSize: 13, fontWeight: 900, color: scoreColor, fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(responseScore)}
                  </span>
                </div>
              )}
              {/* Timer */}
              <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg"
                style={{ background: elapsed > 120 ? "rgba(255,45,85,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${elapsed > 120 ? "rgba(255,45,85,0.12)" : "rgba(255,255,255,0.05)"}` }}>
                <Clock className="size-3" style={{ color: elapsed > 120 ? "#FF2D55" : "rgba(255,255,255,0.3)" }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: elapsed > 120 ? "#FF2D55" : "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }}>
                  {fmtTime(elapsed)}
                </span>
              </div>
              <button onClick={onClose} className="size-7 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <X className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
              </button>
            </div>
          </div>

          {/* ── Phase Progress Bar ── */}
          <div className="flex items-center gap-1">
            {ALL_PHASES.filter(p => p !== "complete").map((p, i) => {
              const isActive = p === phase;
              const isDone = completedPhases.includes(p);
              const meta = PHASE_META[p];
              return (
                <div key={p} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <motion.div
                      className="h-full rounded-full"
                      animate={{ width: isDone ? "100%" : isActive ? "50%" : "0%" }}
                      style={{ background: isDone ? "#00C853" : meta.color }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <span style={{ fontSize: 6, fontWeight: 700, color: isActive ? meta.color : isDone ? "#00C853" : "rgba(255,255,255,0.12)", letterSpacing: "0.5px" }}>
                    {meta.shortLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            BODY
        ══════════════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarWidth: "none" }}>
          <AnimatePresence mode="wait">

            {/* ── SCANNING PHASE ──────────────────────────────────── */}
            {phase === "scanning" && (
              <motion.div
                key="scanning"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col items-center"
              >
                {/* Scanning animation */}
                <div className="relative size-32 mb-6">
                  {/* Outer ring */}
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0 rounded-full"
                    style={{ border: "2px dashed rgba(139,92,246,0.2)" }}
                  />
                  {/* Middle ring */}
                  <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-3 rounded-full"
                    style={{ border: "1px solid rgba(139,92,246,0.1)" }}
                  />
                  {/* Radar sweep */}
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0"
                    style={{
                      background: `conic-gradient(from 0deg, transparent 0%, rgba(139,92,246,0.15) 20%, transparent 25%)`,
                      borderRadius: "50%",
                    }}
                  />
                  {/* Center icon */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="size-14 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(139,92,246,0.12)", border: "1.5px solid rgba(139,92,246,0.25)" }}
                    >
                      <Brain className="size-7" style={{ color: "#8B5CF6" }} />
                    </motion.div>
                  </div>
                  {/* Scanning dots */}
                  {[0, 60, 120, 180, 240, 300].map(deg => (
                    <motion.div
                      key={deg}
                      animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
                      transition={{ duration: 2, repeat: Infinity, delay: deg / 360 }}
                      className="absolute size-2 rounded-full"
                      style={{
                        background: "#8B5CF6",
                        left: `calc(50% + ${Math.cos(deg * Math.PI / 180) * 52}px - 4px)`,
                        top: `calc(50% + ${Math.sin(deg * Math.PI / 180) * 52}px - 4px)`,
                      }}
                    />
                  ))}
                </div>

                <h3 style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>
                  Analyzing Situation...
                </h3>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                  Scanning employee status, connectivity, and threat level
                </p>

                {/* Progress bar */}
                <div className="w-full max-w-xs mt-6">
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: "linear-gradient(90deg, #8B5CF6, #00C8E0)", width: `${scanProgress}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-2">
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                      {scanProgress < 30 ? "Reading device sensors..." : scanProgress < 60 ? "Analyzing signal strength..." : scanProgress < 85 ? "Calculating threat level..." : "Building response protocol..."}
                    </span>
                    <span style={{ fontSize: 9, color: "#8B5CF6", fontWeight: 700 }}>{scanProgress}%</span>
                  </div>
                </div>

                {/* Scan results (appear as they're found) */}
                {scanComplete && assessment && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full mt-6 space-y-3"
                  >
                    {/* Threat Level Badge */}
                    <div className="flex items-center justify-center gap-3 py-3 rounded-2xl"
                      style={{
                        background: assessment.level >= 7 ? "rgba(255,45,85,0.06)" : assessment.level >= 4 ? "rgba(255,150,0,0.06)" : "rgba(0,200,83,0.06)",
                        border: `1px solid ${assessment.level >= 7 ? "rgba(255,45,85,0.15)" : assessment.level >= 4 ? "rgba(255,150,0,0.15)" : "rgba(0,200,83,0.15)"}`,
                      }}>
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: 10 }).map((_, i) => (
                          <motion.div
                            key={i}
                            initial={{ scaleY: 0 }}
                            animate={{ scaleY: 1 }}
                            transition={{ delay: 0.05 * i }}
                            className="rounded-full"
                            style={{
                              width: 3,
                              height: 12 + i * 1.5,
                              background: i < assessment.level
                                ? (i >= 7 ? "#FF2D55" : i >= 4 ? "#FF9500" : "#00C853")
                                : "rgba(255,255,255,0.06)",
                            }}
                          />
                        ))}
                      </div>
                      <div className="text-center">
                        <span style={{ fontSize: 14, fontWeight: 900, color: assessment.level >= 7 ? "#FF2D55" : assessment.level >= 4 ? "#FF9500" : "#00C853" }}>
                          {assessment.label}
                        </span>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                          {assessment.protocol}
                        </p>
                      </div>
                    </div>

                    {/* Scan Results Grid */}
                    <div className="grid grid-cols-3 gap-1.5">
                      {assessment.scans.map((scan, i) => {
                        const ScanIcon = scan.icon;
                        const sc = scan.status === "critical" ? "#FF2D55" : scan.status === "warning" ? "#FF9500" : "#00C853";
                        return (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.1 * i }}
                            className="p-2 rounded-xl text-center"
                            style={{ background: `${sc}06`, border: `1px solid ${sc}12` }}
                          >
                            <ScanIcon className="size-3 mx-auto mb-1" style={{ color: sc }} />
                            <p style={{ fontSize: 7, color: "rgba(255,255,255,0.25)", fontWeight: 600 }}>{scan.label}</p>
                            <p style={{ fontSize: 9, color: sc, fontWeight: 700, marginTop: 1 }}>{scan.value}</p>
                          </motion.div>
                        );
                      })}
                    </div>

                    {/* Smart Recommendations */}
                    {assessment.recommendations.length > 0 && (
                      <div className="space-y-1">
                        {assessment.recommendations.map((rec, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.15 * i }}
                            className="flex items-start gap-2 px-3 py-2 rounded-xl"
                            style={{ background: "rgba(255,150,0,0.04)", border: "1px solid rgba(255,150,0,0.08)" }}
                          >
                            <Sparkles className="size-3 flex-shrink-0 mt-0.5" style={{ color: "#FF9500" }} />
                            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{rec}</p>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ── ACTION PHASES (contact → document) ──────────────── */}
            {phase !== "scanning" && phase !== "complete" && (
              <motion.div
                key={phase}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.25 }}
                className="space-y-4"
              >
                {/* Phase Header */}
                <div className="flex items-start gap-3">
                  <motion.div
                    animate={context.severity === "critical" ? {
                      boxShadow: [`0 0 0 0 ${phaseMeta.color}30`, `0 0 0 10px ${phaseMeta.color}00`],
                    } : {}}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="size-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${phaseMeta.color}12`, border: `1px solid ${phaseMeta.color}20` }}
                  >
                    {(() => { const I = phaseMeta.icon; return <I className="size-5" style={{ color: phaseMeta.color }} />; })()}
                  </motion.div>
                  <div className="flex-1">
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>
                      {phaseMeta.label}
                    </h3>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                      {completedCount}/{currentActions.length} actions completed
                    </p>
                  </div>
                  {/* Phase counter */}
                  <div className="px-2.5 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>
                      Step {phaseIdx}/{ALL_PHASES.length - 1}
                    </span>
                  </div>
                </div>

                {/* ── FIX 4: Per-phase countdown bar ── */}
                {phase !== "scanning" && phase !== "complete" && (() => {
                  const budget = getPhaseTimeBudget(assessment?.level || 5);
                  const pct = budget > 0 ? (phaseCountdown / budget) * 100 : 0;
                  const barColor = phaseTimedOut ? "#FF2D55" : phaseCountdown <= 10 ? "#FF9500" : phaseMeta.color;
                  return (
                    <div className="space-y-1">
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <motion.div
                          className="h-full rounded-full"
                          animate={{
                            width: `${pct}%`,
                            background: barColor,
                          }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        {phaseTimedOut ? (
                          <motion.p
                            animate={{ opacity: [1, 0.4, 1] }}
                            transition={{ duration: 0.6, repeat: Infinity }}
                            style={{ fontSize: 9, fontWeight: 800, color: "#FF2D55", letterSpacing: "0.3px" }}
                          >
                            TIME CRITICAL — take action now
                          </motion.p>
                        ) : (
                          <span style={{ fontSize: 9, color: phaseCountdown <= 10 ? "#FF9500" : "rgba(255,255,255,0.2)", fontWeight: phaseCountdown <= 10 ? 700 : 500 }}>
                            {phaseCountdown <= 10 ? "Hurry — " : ""}{phaseCountdown}s remaining
                          </span>
                        )}
                        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>
                          {assessment && assessment.level >= 8 ? "30s budget" : assessment && assessment.level >= 6 ? "60s budget" : "90s budget"}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* ── FIX 2: Type-specific protocol advisory ── */}
                {(() => {
                  const typeInstr = getTypeInstruction(context.sosType, phase);
                  if (!typeInstr) return null;
                  return (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl"
                      style={{
                        background: `${typeInstr.color}08`,
                        border: `1px solid ${typeInstr.color}20`,
                        boxShadow: `0 0 16px ${typeInstr.color}06`,
                      }}
                    >
                      <div className="size-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: `${typeInstr.color}15`, border: `1px solid ${typeInstr.color}25` }}>
                        <AlertTriangle className="size-3.5" style={{ color: typeInstr.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: 8, fontWeight: 800, color: typeInstr.color, letterSpacing: "0.5px", marginBottom: 3 }}>
                          {typeInstr.title}
                        </p>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.55, fontWeight: 500 }}>
                          {typeInstr.instruction}
                        </p>
                      </div>
                    </motion.div>
                  );
                })()}

                {/* Smart recommendation for this phase */}
                {assessment && assessment.recommendations.length > 0 && phaseIdx <= 3 && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl"
                    style={{ background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.08)" }}>
                    <Bot className="size-3 flex-shrink-0 mt-0.5" style={{ color: "#8B5CF6" }} />
                    <p style={{ fontSize: 10, color: "rgba(139,92,246,0.7)", fontWeight: 500 }}>
                      AI Tip: {assessment.recommendations[0]}
                    </p>
                  </div>
                )}

                {/* Action Cards */}
                <div className="space-y-2">
                  {currentActions.map((action, i) => {
                    const ActionIcon = action.icon;
                    return (
                      <motion.div
                        key={action.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.08 * i }}
                      >
                        <button
                          onClick={() => !action.completed && !action.executing && executeAction(action.id)}
                          disabled={action.completed || action.executing}
                          className="w-full flex items-start gap-3 p-3.5 rounded-xl text-left relative overflow-hidden"
                          style={{
                            background: action.completed
                              ? "rgba(0,200,83,0.04)"
                              : action.executing
                              ? `${action.color}08`
                              : `linear-gradient(135deg, ${action.color}06, ${action.color}02)`,
                            border: `1px solid ${action.completed ? "rgba(0,200,83,0.12)" : action.executing ? `${action.color}20` : `${action.color}10`}`,
                            opacity: action.completed ? 0.7 : 1,
                            cursor: action.completed || action.executing ? "default" : "pointer",
                          }}
                        >
                          {/* Auto/Recommended badges */}
                          {(action.autoExecute || action.recommended) && !action.completed && (
                            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md"
                              style={{
                                background: action.autoExecute ? "rgba(139,92,246,0.1)" : "rgba(0,200,83,0.1)",
                                border: `1px solid ${action.autoExecute ? "rgba(139,92,246,0.2)" : "rgba(0,200,83,0.2)"}`,
                              }}>
                              <span style={{
                                fontSize: 7, fontWeight: 800, letterSpacing: "0.4px",
                                color: action.autoExecute ? "#8B5CF6" : "#00C853",
                              }}>
                                {action.autoExecute ? "AUTO" : "RECOMMENDED"}
                              </span>
                            </div>
                          )}

                          {/* Icon */}
                          <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{
                              background: action.completed ? "rgba(0,200,83,0.1)" : `${action.color}10`,
                              border: `1px solid ${action.completed ? "rgba(0,200,83,0.2)" : `${action.color}15`}`,
                            }}>
                            {action.completed ? (
                              <CheckCircle2 className="size-4" style={{ color: "#00C853" }} />
                            ) : action.executing ? (
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                              >
                                <Zap className="size-4" style={{ color: action.color }} />
                              </motion.div>
                            ) : (
                              <ActionIcon className="size-4" style={{ color: action.color }} />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 pr-10">
                            <p style={{ fontSize: 12, fontWeight: 700, color: action.completed ? "rgba(0,200,83,0.7)" : "#fff" }}>
                              {action.label}
                            </p>
                            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                              {action.completed ? action.resultText : action.description}
                            </p>
                            {action.executing && (
                              <motion.div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                                <motion.div
                                  animate={{ width: ["0%", "100%"] }}
                                  transition={{ duration: 2, ease: "easeInOut" }}
                                  className="h-full rounded-full"
                                  style={{ background: action.color }}
                                />
                              </motion.div>
                            )}
                          </div>

                          {!action.completed && !action.executing && !action.autoExecute && (
                            <ChevronRight className="size-4 flex-shrink-0 mt-1" style={{ color: `${action.color}40` }} />
                          )}
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* ── COMPLETE PHASE ──────────────────────────────────── */}
            {phase === "complete" && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-4"
              >
                {/* Score Circle with tier badge */}
                <div className="relative size-28 mb-2">
                  <svg className="size-28 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
                    <motion.circle
                      cx="50" cy="50" r="42" fill="none"
                      stroke={scoreColor}
                      strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={264}
                      initial={{ strokeDashoffset: 264 }}
                      animate={{ strokeDashoffset: 264 * (1 - responseScore / 100) }}
                      transition={{ duration: 1.5, ease: "easeOut" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span style={{ fontSize: 24, fontWeight: 900, color: scoreColor, fontVariantNumeric: "tabular-nums" }}>
                      {Math.round(responseScore)}
                    </span>
                    <span style={{ fontSize: 7, fontWeight: 700, color: `${scoreColor}80`, letterSpacing: "0.5px" }}>
                      {scoreLabel}
                    </span>
                  </div>
                  {/* Tier badge */}
                  {adminRating && adminRating.totalIncidents > 0 && (
                    <motion.div
                      initial={{ scale: 0, rotate: -45 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ delay: 0.8, type: "spring", stiffness: 400 }}
                      className="absolute -top-1 -right-1 size-7 rounded-full flex items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${adminRating.tierColor}30, ${adminRating.tierColor}10)`,
                        border: `1.5px solid ${adminRating.tierColor}50`,
                        boxShadow: `0 0 12px ${adminRating.tierGlow}`,
                      }}>
                      {adminRating.tier === "PLATINUM" ? <Crown className="size-3.5" style={{ color: adminRating.tierColor }} /> :
                       adminRating.tier === "GOLD" ? <Star className="size-3.5" style={{ color: adminRating.tierColor }} /> :
                       adminRating.tier === "SILVER" ? <Medal className="size-3.5" style={{ color: adminRating.tierColor }} /> :
                       adminRating.tier === "BRONZE" ? <Shield className="size-3.5" style={{ color: adminRating.tierColor }} /> :
                       <Zap className="size-3.5" style={{ color: adminRating.tierColor }} />}
                    </motion.div>
                  )}
                </div>

                <h3 style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>Emergency Resolved</h3>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                  Total response time: {fmtTime(elapsed)} -- {autoLog.length} actions logged
                </p>

                {/* Verification hash badge */}
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full"
                  style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.12)" }}>
                  <QrCode className="size-3" style={{ color: "#8B5CF6" }} />
                  <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(139,92,246,0.6)", letterSpacing: "0.5px", fontVariantNumeric: "tabular-nums" }}>
                    {generateVerificationHash({ emergencyId: context.emergencyId, responseScore, responseTimeSec: elapsed, timestamp: new Date().toISOString() })}
                  </span>
                </motion.div>

                {/* Summary Stats */}
                <div className="w-full grid grid-cols-3 gap-2 mt-4">
                  {[
                    { label: "Phases", value: completedPhases.length.toString(), color: "#00C8E0" },
                    { label: "Actions", value: autoLog.filter(l => l.text.startsWith("COMPLETED")).length.toString(), color: "#00C853" },
                    { label: "Auto-Actions", value: autoLog.filter(l => l.text.startsWith("AUTO")).length.toString(), color: "#8B5CF6" },
                  ].map(s => (
                    <div key={s.label} className="p-3 rounded-xl text-center"
                      style={{ background: `${s.color}06`, border: `1px solid ${s.color}10` }}>
                      <p style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.value}</p>
                      <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", fontWeight: 600 }}>{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* ── Admin Performance Card ── */}
                {adminRating && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                    className="w-full mt-4"
                  >
                    <button onClick={() => setShowPerformance(!showPerformance)}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl"
                      style={{
                        background: `linear-gradient(135deg, ${adminRating.tierColor}08, ${adminRating.tierColor}03)`,
                        border: `1px solid ${adminRating.tierColor}15`,
                        cursor: "pointer",
                      }}>
                      <div className="flex items-center gap-2">
                        <div className="size-6 rounded-full flex items-center justify-center"
                          style={{ background: `${adminRating.tierColor}15`, border: `1px solid ${adminRating.tierColor}25` }}>
                          {adminRating.tier === "PLATINUM" ? <Crown className="size-3" style={{ color: adminRating.tierColor }} /> :
                           adminRating.tier === "GOLD" ? <Star className="size-3" style={{ color: adminRating.tierColor }} /> :
                           <Medal className="size-3" style={{ color: adminRating.tierColor }} />}
                        </div>
                        <div className="text-left">
                          <span style={{ fontSize: 10, fontWeight: 800, color: adminRating.tierColor, letterSpacing: "0.5px" }}>
                            {adminRating.tier} RESPONDER
                          </span>
                          <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>
                            {adminRating.totalIncidents} incident{adminRating.totalIncidents !== 1 ? "s" : ""} -- Avg {adminRating.avgScore}/100
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {adminRating.currentStreak >= 3 && (
                          <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(255,150,0,0.1)", border: "1px solid rgba(255,150,0,0.15)" }}>
                            <Flame className="size-2.5" style={{ color: "#FF9500" }} />
                            <span style={{ fontSize: 7, fontWeight: 800, color: "#FF9500" }}>{adminRating.currentStreak}</span>
                          </div>
                        )}
                        <ChevronRight className="size-3" style={{ color: `${adminRating.tierColor}40`, transform: showPerformance ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
                      </div>
                    </button>

                    <AnimatePresence>
                      {showPerformance && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden mt-2">
                          {/* Performance metrics */}
                          <div className="grid grid-cols-4 gap-1.5 mb-3">
                            {[
                              { label: "AVG", value: `${adminRating.avgScore}`, color: adminRating.tierColor },
                              { label: "BEST", value: `${adminRating.bestScore}`, color: "#00C853" },
                              { label: "STREAK", value: `${adminRating.currentStreak}`, color: "#FF9500" },
                              { label: "TOP %", value: `${adminRating.percentile}`, color: "#8B5CF6" },
                            ].map(m => (
                              <div key={m.label} className="p-2 rounded-lg text-center"
                                style={{ background: `${m.color}06`, border: `1px solid ${m.color}0D` }}>
                                <p style={{ fontSize: 14, fontWeight: 900, color: m.color }}>{m.value}</p>
                                <p style={{ fontSize: 6, color: "rgba(255,255,255,0.2)", fontWeight: 700, letterSpacing: "0.3px" }}>{m.label}</p>
                              </div>
                            ))}
                          </div>

                          {/* Mini score sparkline */}
                          {adminRating.recentScores.length > 1 && (
                            <div className="px-2 mb-3">
                              <p style={{ fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.3px", marginBottom: 4 }}>
                                RECENT SCORES
                              </p>
                              <div className="flex items-end gap-1 h-6">
                                {adminRating.recentScores.map((s, i) => (
                                  <motion.div
                                    key={i}
                                    initial={{ height: 0 }}
                                    animate={{ height: `${Math.max(15, s)}%` }}
                                    transition={{ delay: i * 0.05 }}
                                    className="flex-1 rounded-sm"
                                    style={{
                                      background: s >= 85 ? "#00C853" : s >= 60 ? "#00C8E0" : s >= 40 ? "#FF9500" : "#FF2D55",
                                      opacity: i === adminRating.recentScores.length - 1 ? 1 : 0.5,
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Trend */}
                          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg mb-2"
                            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                            {adminRating.trend === "improving" ? <TrendingUp className="size-3" style={{ color: "#00C853" }} /> :
                             adminRating.trend === "declining" ? <TrendingDown className="size-3" style={{ color: "#FF2D55" }} /> :
                             <Activity className="size-3" style={{ color: "rgba(255,255,255,0.3)" }} />}
                            <span style={{ fontSize: 8, color: adminRating.trend === "improving" ? "#00C853" : adminRating.trend === "declining" ? "#FF2D55" : "rgba(255,255,255,0.35)", fontWeight: 600 }}>
                              {adminRating.trend === "improving" ? "Performance trending upward" : adminRating.trend === "declining" ? "Performance trending down" : "Stable performance"}
                            </span>
                          </div>

                          {/* AI Insights */}
                          {adminRating.insights.slice(0, 2).map((insight, i) => (
                            <div key={i} className="flex items-start gap-1.5 px-2 py-1.5 mb-1">
                              <Sparkles className="size-2.5 flex-shrink-0 mt-0.5" style={{ color: "rgba(139,92,246,0.5)" }} />
                              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", lineHeight: 1.4 }}>{insight}</span>
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}

                {/* Response Timeline */}
                <div className="w-full mt-3">
                  <button onClick={() => setShowTimeline(!showTimeline)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>RESPONSE TIMELINE ({autoLog.length} events)</span>
                    <ChevronRight className="size-3" style={{ color: "rgba(255,255,255,0.2)", transform: showTimeline ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
                  </button>
                  <AnimatePresence>
                    {showTimeline && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden mt-2 max-h-40 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
                        {autoLog.map((log, i) => (
                          <div key={i} className="flex items-center gap-2 py-1.5 px-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.15)", fontVariantNumeric: "tabular-nums", width: 36 }}>{fmtTime(log.time)}</span>
                            <div className="size-1.5 rounded-full" style={{ background: log.color }} />
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{log.text}</span>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Open Emergency Chat */}
                {onOpenChat && (
                  <button onClick={() => {
                    playUISound("chatOpen");
                    onOpenChat(context.emergencyId, context.employeeName);
                    toast.success("Emergency Chat opened", { description: `Chat with ${context.employeeName}` });
                  }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl mt-3"
                    style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.12)", cursor: "pointer" }}>
                    <MessageCircle className="size-4" style={{ color: "#FF9500" }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#FF9500" }}>Open Emergency Chat</span>
                  </button>
                )}

                <div className="w-full flex gap-2 mt-3">
                  <button onClick={async () => {
                    hapticSuccess();
                    toast.loading("Generating IRE Report with QR...", { id: "ire-pdf" });
                    try {
                      await import("jspdf-autotable");
                      const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
                      const pw = doc.internal.pageSize.getWidth();
                      const ph = doc.internal.pageSize.getHeight();
                      // eslint-disable-next-line no-control-regex
                      const safe = (s: string) => s.replace(/[^\u0000-\u007F]/g, "");
                      const now = new Date();

                      // Generate QR Code
                      const qrPayload = buildQRPayload({
                        emergencyId: context.emergencyId,
                        employeeName: context.employeeName,
                        responseScore,
                        responseTimeSec: elapsed,
                        phasesCompleted: completedPhases.length,
                        timestamp: now.toISOString(),
                      });
                      let qrDataUrl = "";
                      try {
                        qrDataUrl = await QRCode.toDataURL(qrPayload, {
                          width: 200,
                          margin: 1,
                          color: { dark: "#00C8E0FF", light: "#05070EFF" },
                          errorCorrectionLevel: "H",
                        });
                      } catch { /* QR generation failed - continue without */ }

                      const vHash = generateVerificationHash({
                        emergencyId: context.emergencyId,
                        responseScore,
                        responseTimeSec: elapsed,
                        timestamp: now.toISOString(),
                      });

                      // ── Page Background ──
                      doc.setFillColor(5, 7, 14);
                      doc.rect(0, 0, pw, ph, "F");

                      // ── Header Band ──
                      doc.setFillColor(10, 18, 32);
                      doc.rect(0, 0, pw, 42, "F");
                      // Accent line
                      doc.setDrawColor(0, 200, 224);
                      doc.setLineWidth(0.8);
                      doc.line(0, 42, pw, 42);

                      doc.setFontSize(22);
                      doc.setTextColor(0, 200, 224);
                      doc.text("SOSphere IRE Report", 14, 16);
                      doc.setFontSize(9);
                      doc.setTextColor(120);
                      doc.text("Intelligent Response Engine | Incident Response Summary", 14, 24);
                      doc.text(`Generated: ${now.toLocaleString()} | ${vHash}`, 14, 31);

                      // QR Code in header (top-right)
                      if (qrDataUrl) {
                        doc.addImage(qrDataUrl, "PNG", pw - 42, 4, 34, 34);
                        doc.setFontSize(5);
                        doc.setTextColor(80);
                        doc.text("Scan to verify", pw - 25, 40, { align: "center" });
                      }

                      let y = 52;

                      // ── Response Score Section ──
                      const sLabel = responseScore >= 85 ? "EXCELLENT" : responseScore >= 60 ? "GOOD" : responseScore >= 40 ? "FAIR" : "NEEDS IMPROVEMENT";
                      const sColor: [number, number, number] = responseScore >= 85 ? [0, 200, 83] : responseScore >= 60 ? [0, 200, 224] : responseScore >= 40 ? [255, 150, 0] : [255, 45, 85];

                      // Score box
                      doc.setFillColor(sColor[0], sColor[1], sColor[2]);
                      doc.setGState(new (doc as any).GState({ opacity: 0.08 }));
                      doc.roundedRect(14, y, pw - 28, 22, 3, 3, "F");
                      doc.setGState(new (doc as any).GState({ opacity: 1 }));
                      doc.setDrawColor(sColor[0], sColor[1], sColor[2]);
                      doc.setLineWidth(0.3);
                      doc.roundedRect(14, y, pw - 28, 22, 3, 3, "S");

                      doc.setFontSize(28);
                      doc.setTextColor(sColor[0], sColor[1], sColor[2]);
                      doc.text(`${Math.round(responseScore)}`, 24, y + 15);
                      doc.setFontSize(10);
                      doc.text(`/ 100   ${sLabel}`, 46, y + 14);
                      doc.setFontSize(8);
                      doc.setTextColor(100);
                      doc.text(`Response Time: ${fmtTime(elapsed)} | ${completedPhases.length} phases | ${autoLog.length} events logged`, 24, y + 20);
                      y += 30;

                      // ── Admin Performance (if available) ──
                      if (adminRating && adminRating.totalIncidents > 0) {
                        doc.setFontSize(11);
                        doc.setTextColor(adminRating.tierColor === "#E5E4E2" ? 229 : adminRating.tierColor === "#FFD700" ? 255 : 192,
                                          adminRating.tierColor === "#E5E4E2" ? 228 : adminRating.tierColor === "#FFD700" ? 215 : 192,
                                          adminRating.tierColor === "#E5E4E2" ? 226 : adminRating.tierColor === "#FFD700" ? 0 : 192);
                        doc.text(`${adminRating.tier} Responder`, 14, y);
                        doc.setFontSize(8);
                        doc.setTextColor(100);
                        doc.text(`Avg Score: ${adminRating.avgScore} | ${adminRating.totalIncidents} incidents | Streak: ${adminRating.currentStreak} | Top ${adminRating.percentile}%`, 14, y + 5);
                        y += 12;
                      }

                      // ── Incident Details Table ──
                      doc.setFontSize(12);
                      doc.setTextColor(255);
                      doc.text("Incident Details", 14, y); y += 2;

                      const details = [
                        ["Emergency ID", safe(context.emergencyId)],
                        ["Employee", safe(context.employeeName)],
                        ["Zone", safe(context.zone)],
                        ["SOS Type", safe(context.sosType).replace(/_/g, " ").toUpperCase()],
                        ["Severity", safe(context.severity).toUpperCase()],
                        ["Threat Level", `${assessment?.level || "N/A"}/10 -- ${assessment?.label || "N/A"}`],
                        ["Response Time", fmtTime(elapsed)],
                        ["Battery", `${context.batteryLevel ?? "N/A"}%`],
                        ["Signal", safe(context.signalStrength || "N/A")],
                        ["GPS", context.lastGPS ? `${context.lastGPS.lat.toFixed(5)}, ${context.lastGPS.lng.toFixed(5)}` : "N/A"],
                        ["Responding Admin", safe(adminName)],
                      ];
                      if (context.isJourney) details.push(["Journey Route", safe(context.journeyRoute || "N/A")]);

                      (doc as any).autoTable({
                        startY: y,
                        head: [["Field", "Value"]],
                        body: details,
                        theme: "grid",
                        headStyles: { fillColor: [0, 200, 224], textColor: [5, 7, 14], fontSize: 8, fontStyle: "bold" },
                        bodyStyles: { fillColor: [8, 12, 22], textColor: [180, 180, 180], fontSize: 8 },
                        alternateRowStyles: { fillColor: [12, 18, 30] },
                        columnStyles: { 0: { textColor: [100, 100, 100], cellWidth: 45 } },
                        margin: { left: 14, right: 14 },
                      });
                      y = (doc as any).lastAutoTable.finalY + 8;

                      // ── Phases Completed ──
                      doc.setFontSize(12);
                      doc.setTextColor(255);
                      doc.text("Phases Completed", 14, y); y += 2;

                      (doc as any).autoTable({
                        startY: y,
                        head: [["#", "Phase", "Status"]],
                        body: completedPhases.map((p, i) => [
                          `${i + 1}`,
                          safe(PHASE_META[p]?.label || p.toUpperCase()),
                          "COMPLETED",
                        ]),
                        theme: "grid",
                        headStyles: { fillColor: [0, 200, 83], textColor: [5, 7, 14], fontSize: 8 },
                        bodyStyles: { fillColor: [8, 12, 22], textColor: [0, 200, 83], fontSize: 8 },
                        alternateRowStyles: { fillColor: [12, 18, 30] },
                        columnStyles: { 0: { cellWidth: 12 }, 2: { cellWidth: 30 } },
                        margin: { left: 14, right: 14 },
                      });
                      y = (doc as any).lastAutoTable.finalY + 8;

                      // ── Check if we need a new page for the timeline ──
                      if (y > ph - 60) {
                        doc.addPage();
                        doc.setFillColor(5, 7, 14);
                        doc.rect(0, 0, pw, ph, "F");
                        y = 20;
                      }

                      // ── Event Timeline ──
                      doc.setFontSize(12);
                      doc.setTextColor(255);
                      doc.text(`Response Timeline (${autoLog.length} events)`, 14, y); y += 2;

                      (doc as any).autoTable({
                        startY: y,
                        head: [["Time", "Event", "Type"]],
                        body: autoLog.map(l => {
                          const type = l.text.startsWith("AUTO") ? "AUTO" : l.text.startsWith("COMPLETED") ? "MANUAL" : "SYSTEM";
                          return [fmtTime(l.time), safe(l.text), type];
                        }),
                        theme: "grid",
                        headStyles: { fillColor: [10, 18, 32], textColor: [0, 200, 224], fontSize: 7 },
                        bodyStyles: { fillColor: [8, 12, 22], textColor: [140, 140, 140], fontSize: 6.5 },
                        alternateRowStyles: { fillColor: [12, 16, 28] },
                        columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 20, textColor: [139, 92, 246] } },
                        margin: { left: 14, right: 14 },
                      });

                      // ── Footer on all pages ──
                      const totalPages = doc.getNumberOfPages();
                      for (let pg = 1; pg <= totalPages; pg++) {
                        doc.setPage(pg);
                        // Watermark
                        doc.setFontSize(50);
                        doc.setTextColor(255, 255, 255);
                        doc.setGState(new (doc as any).GState({ opacity: 0.02 }));
                        doc.text("SOSphere", pw / 2, ph / 2, { align: "center", angle: 35 });
                        doc.setGState(new (doc as any).GState({ opacity: 1 }));
                        // Footer line
                        doc.setDrawColor(0, 200, 224);
                        doc.setLineWidth(0.2);
                        doc.line(14, ph - 12, pw - 14, ph - 12);
                        // Footer text
                        doc.setFontSize(6);
                        doc.setTextColor(60);
                        doc.text(`SOSphere Intelligent Response Engine | CONFIDENTIAL | ${now.toISOString().split("T")[0]} | ${vHash}`, 14, ph - 8);
                        doc.text(`Page ${pg}/${totalPages}`, pw - 14, ph - 8, { align: "right" });
                      }

                      doc.save(`SOSphere_IRE_${safe(context.emergencyId)}_${now.toISOString().split("T")[0]}.pdf`);
                      toast.success("IRE Report Downloaded", { id: "ire-pdf", description: `Verified report with QR Code [${vHash}]` });
                    } catch (err) {
                      console.error("IRE PDF error:", err);
                      toast.error("PDF Generation Failed", { id: "ire-pdf" });
                    }
                  }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                    style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", cursor: "pointer" }}>
                    <Download className="size-4" style={{ color: "#00C8E0" }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>Download Report</span>
                  </button>
                  <button onClick={onClose}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                    style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)", cursor: "pointer" }}>
                    <CheckCircle2 className="size-4" style={{ color: "#00C853" }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#00C853" }}>Close & Archive</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ══════════════════════════════════════════════════════════
            FOOTER
        ══════════════════════════════════════════════════════════ */}
        {phase !== "scanning" && phase !== "complete" && (
          <div className="px-5 py-3 flex items-center justify-between"
            style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
            <button
              onClick={() => {
                const idx = ALL_PHASES.indexOf(phase);
                if (idx > 1) {
                  const prevPhase = ALL_PHASES[idx - 1];
                  setPhase(prevPhase);
                  setCompletedPhases(p => p.filter(cp => cp !== prevPhase));
                }
              }}
              disabled={phaseIdx <= 1}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
              style={{
                background: phaseIdx > 1 ? "rgba(255,255,255,0.04)" : "transparent",
                border: phaseIdx > 1 ? "1px solid rgba(255,255,255,0.06)" : "1px solid transparent",
                opacity: phaseIdx > 1 ? 1 : 0.3,
                cursor: phaseIdx > 1 ? "pointer" : "default",
              }}>
              <ChevronLeft className="size-3" style={{ color: "rgba(255,255,255,0.4)" }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>Back</span>
            </button>

            <div className="flex items-center gap-2">
              {/* Quick Chat */}
              {onOpenChat && (
                <button onClick={() => {
                  playUISound("chatOpen");
                  onOpenChat(context.emergencyId, context.employeeName);
                }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg"
                  style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.1)", cursor: "pointer" }}>
                  <MessageCircle className="size-3" style={{ color: "#FF9500" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,150,0,0.6)" }}>Chat</span>
                </button>
              )}
              {/* Live log count */}
              <button onClick={() => setShowTimeline(!showTimeline)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", cursor: "pointer" }}>
                <Activity className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{autoLog.length} events</span>
              </button>
              {/* Next phase */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={advancePhase}
                disabled={!canAdvance}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl"
                style={{
                  background: canAdvance
                    ? `linear-gradient(135deg, ${phaseMeta.color}15, ${phaseMeta.color}08)`
                    : "rgba(255,255,255,0.03)",
                  border: `1px solid ${canAdvance ? `${phaseMeta.color}25` : "rgba(255,255,255,0.06)"}`,
                  opacity: canAdvance ? 1 : 0.4,
                  cursor: canAdvance ? "pointer" : "default",
                }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: canAdvance ? phaseMeta.color : "rgba(255,255,255,0.3)" }}>
                  {phaseIdx < ALL_PHASES.length - 2 ? "Next Phase" : "Complete"}
                </span>
                <ChevronRight className="size-3.5" style={{ color: canAdvance ? phaseMeta.color : "rgba(255,255,255,0.2)" }} />
              </motion.button>
            </div>
          </div>
        )}

        {/* ── Inline Timeline Overlay ── */}
        <AnimatePresence>
          {showTimeline && phase !== "complete" && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 140, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden overflow-y-auto border-t"
              style={{ borderColor: "rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.3)", scrollbarWidth: "none" }}
            >
              <div className="px-4 py-2">
                <p style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "1px", marginBottom: 6 }}>LIVE ACTION LOG</p>
                {autoLog.map((log, i) => (
                  <div key={i} className="flex items-center gap-2 py-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.015)" }}>
                    <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.12)", fontVariantNumeric: "tabular-nums", width: 36, flexShrink: 0 }}>{fmtTime(log.time)}</span>
                    <div className="size-1.5 rounded-full flex-shrink-0" style={{ background: log.color }} />
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>{log.text}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
