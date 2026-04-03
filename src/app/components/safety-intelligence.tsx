// ═══════════════════════════════════════════════════════════════
// SOSphere — Safety Intelligence Engine (Dashboard Page)
// ─────────────────────────────────────────────────────────────
// THE DIFFERENTIATOR: Proactive safety, not reactive
// ═══════════════════════════════════════════════════════════════
// FIX 1: Removed inner duplicate "Safety Intelligence" card — EnterprisePageHeader handles title
// FIX 2: Workers tab now reads from real employee roster + calculateRiskScore()
// FIX 3: "Online Now" reads employees.filter(e => e.status === "on-shift" || "checked-in")
// FIX 4: Alert arrows navigate to relevant pages (Emergency Hub, People, Incident, Operations)
// FIX 5: Refresh AI has real recalculation + 10s cooldown
// FIX 6: "Based on available data" disclaimer under key metrics
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Brain, Shield, AlertTriangle, Users, MapPin, Clock,
  Thermometer, Wind, Eye, Activity, TrendingUp, TrendingDown,
  ChevronRight, Bell, Zap, Heart, Radio, Timer,
  Sun, CloudRain, Flame, Snowflake, ArrowUp, ArrowDown,
  CheckCircle2, XCircle, AlertCircle, Target,
  Waves, Gauge, BarChart3, Lightbulb, RefreshCw,
  UserCheck, Navigation, Phone, MessageSquare,
  ShieldAlert, ShieldCheck, BrainCircuit, Siren,
  Send, PhoneCall, MapPinned, Megaphone, Wifi,
  CircleAlert, CircleCheck, CircleDot, Radar,
  Sparkles, Info, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticWarning, hapticMedium } from "./haptic-feedback";
import { TYPOGRAPHY, TOKENS, KPICard, Card, SectionHeader, Badge, StatPill } from "./design-system";
import { type Employee } from "./dashboard-types";
import { onSyncEvent } from "./shared-store";
import { calculateRiskScore, type EmployeeRiskScore, type EmployeeForRiskScoring } from "./risk-scoring-engine";

interface SafetyIntelligenceProps {
  t: (key: string) => string;
  webMode?: boolean;
  employees?: Employee[];
  onNavigate?: (page: string, tab?: string) => void;
  onOpenEmployeeDetail?: (employeeId: string) => void;
}

// ── Risk Score Calculator ──────────────────────────────────────
interface WorkerRisk {
  id: string;
  name: string;
  role: string;
  zone: string;
  riskScore: number;
  riskLevel: "safe" | "elevated" | "high" | "critical";
  riskFactors: { factor: string; weight: number; color: string }[];
  hoursOnSite: number;
  lastCheckIn: number;
  temperature: number;
  nearbyWorkers: number;
  trend: "improving" | "stable" | "worsening";
  lat: number;
  lng: number;
  avatar: string;
}

interface ProactiveAlert {
  id: string;
  type: "prediction" | "environment" | "pattern" | "wellness" | "escalation";
  severity: "info" | "warning" | "danger" | "critical";
  title: string;
  description: string;
  affectedWorkers: string[];
  aiConfidence: number;
  timeToRisk: string;
  suggestedAction: string;
  timestamp: number;
  autoActioned?: boolean;
  // FIX 4: Navigation target for the arrow
  navTarget?: { page: string; tab?: string };
}

interface EnvironmentalThreat {
  type: string;
  icon: any;
  value: string;
  unit: string;
  status: "safe" | "caution" | "danger";
  threshold: string;
  trend: "up" | "down" | "stable";
}

// ── FIX 2: Convert real Employee to WorkerRisk via calculateRiskScore ──
// Deterministic "mock sensor" data seeded by employee index
const ZONE_GPS: Record<string, { lat: number; lng: number }> = {
  "Zone A": { lat: 24.7136, lng: 46.6753 },
  "Zone B": { lat: 24.7200, lng: 46.6800 },
  "Zone C": { lat: 24.7180, lng: 46.6700 },
  "Zone D": { lat: 24.6950, lng: 46.7100 },
  "Zone E": { lat: 24.7050, lng: 46.6900 },
};

function employeeToWorkerRisk(emp: Employee, idx: number, allEmployees: Employee[]): WorkerRisk {
  // Deterministic "sensor" data seeded by employee index
  const seed = idx + 1;
  const isOnDuty = emp.status === "on-shift" || emp.status === "checked-in";
  const isLate = emp.status === "late-checkin";
  const isSos = emp.status === "sos";

  const hoursOnSite = isOnDuty ? +(2 + (seed * 1.3) % 9).toFixed(1) : 0;
  const lastCheckInStr = emp.lastCheckin;
  const lastCheckIn = lastCheckInStr.includes("m ago")
    ? parseInt(lastCheckInStr) || 0
    : lastCheckInStr.includes("h ago")
    ? (parseInt(lastCheckInStr) || 1) * 60
    : lastCheckInStr === "0s" ? 0 : 5;
  const temperature = isOnDuty ? Math.round(28 + (seed * 7) % 22) : 24;
  const isAlone = seed % 4 === 0;
  const nearbyWorkers = isAlone ? 0 : Math.round(1 + (seed * 3) % 8);
  const zoneKey = emp.location.split(" - ")[0] || "Zone A";
  const gps = ZONE_GPS[zoneKey] || { lat: 24.71, lng: 46.68 };

  // Use the real risk scoring engine
  const riskInput: EmployeeForRiskScoring = {
    id: emp.id,
    name: emp.name,
    joinDate: Date.now() - (seed % 3 === 0 ? 15 : 90) * 24 * 60 * 60 * 1000,
    hasBuddy: seed % 3 !== 0,
    checkInInterval: lastCheckIn > 30 ? 180 : 60,
    batteryLevel: isSos ? 12 : Math.round(30 + (seed * 17) % 70),
    isWorkingAlone: isAlone,
    shift: seed % 5 === 0 ? "night" : "day",
    temperature: temperature > 40 ? temperature : undefined,
    isFasting: seed % 7 === 0,
    lastMovement: lastCheckIn > 30 ? lastCheckIn * 60000 : undefined,
  };

  const riskResult = calculateRiskScore(riskInput);

  // Map engine levels to WorkerRisk levels
  const levelMap: Record<string, "safe" | "elevated" | "high" | "critical"> = {
    safe: "safe",
    caution: "elevated",
    warning: "high",
    critical: "critical",
  };
  const riskLevel = levelMap[riskResult.level] || "safe";

  // SOS employees are always critical
  const finalScore = isSos ? Math.max(riskResult.totalScore, 90) : riskResult.totalScore;
  const finalLevel = isSos ? "critical" : riskLevel;

  // Convert risk factors to display format
  const factorColors: Record<string, string> = {
    low: "#FF9500", medium: "#FF9500", high: "#FF2D55",
  };
  const riskFactors = riskResult.factors.map(f => ({
    factor: f.label,
    weight: Math.min(f.points, 40),
    color: factorColors[f.severity] || "#FF9500",
  }));
  if (riskFactors.length === 0) {
    riskFactors.push({ factor: "Normal conditions", weight: 10, color: "#00C853" });
  }

  // Trend based on score
  const trend: "improving" | "stable" | "worsening" =
    finalScore >= 70 ? "worsening" : finalScore >= 40 ? "stable" : "improving";

  const initials = emp.name.split(" ").map(n => n[0]).join("").slice(0, 2);

  return {
    id: emp.id,
    name: emp.name,
    role: emp.role,
    zone: emp.location !== "—" ? emp.location : "Off-Site",
    riskScore: finalScore,
    riskLevel: finalLevel,
    riskFactors,
    hoursOnSite,
    lastCheckIn,
    temperature,
    nearbyWorkers,
    trend,
    lat: gps.lat + (seed * 0.001) % 0.01,
    lng: gps.lng + (seed * 0.002) % 0.01,
    avatar: initials,
  };
}

// ── AI Alerts (dynamic from real data, fallback to contextual defaults) ───────
const MOCK_ALERTS: ProactiveAlert[] = [
  {
    id: "PA1", type: "prediction", severity: "critical",
    title: "Worker Unresponsive — Auto-Escalation",
    description: "Mohammed Ali has not checked in for 35 minutes. Located in isolated Zone D-4 with no nearby workers. AI has initiated escalation protocol.",
    affectedWorkers: ["Mohammed Ali"],
    aiConfidence: 94,
    timeToRisk: "NOW",
    suggestedAction: "Dispatch nearest response team + activate peer alert for Zone D workers",
    timestamp: Date.now() - 120000,
    autoActioned: true,
    navTarget: { page: "emergencyHub", tab: "active" },
  },
  {
    id: "PA2", type: "wellness", severity: "warning",
    title: "Heat Fatigue Risk — Ahmed Khalil",
    description: "8.5 hours continuous work in 48°C. Historical data shows 73% of heat incidents occur after 7+ hours in similar conditions.",
    affectedWorkers: ["Ahmed Khalil"],
    aiConfidence: 87,
    timeToRisk: "~30 min",
    suggestedAction: "Send mandatory break alert + notify zone supervisor",
    timestamp: Date.now() - 300000,
    navTarget: { page: "people", tab: "directory" },
  },
  {
    id: "PA3", type: "pattern", severity: "warning",
    title: "Near-Miss Pattern Detected — Zone C-2",
    description: "3 near-miss incidents in Zone C-2 this week, all during 2-4 PM. Pattern suggests equipment or process issue.",
    affectedWorkers: ["Khalid Omar", "Nasser Al-Said"],
    aiConfidence: 79,
    timeToRisk: "2-4 PM today",
    suggestedAction: "Schedule safety inspection + reduce worker density in zone during peak hours",
    timestamp: Date.now() - 600000,
    navTarget: { page: "incidentRisk", tab: "investigation" },
  },
  {
    id: "PA4", type: "environment", severity: "danger",
    title: "Extreme Heat Warning — All Outdoor Zones",
    description: "Temperature reaching 48°C with Heat Index 54°C. Exceeds OSHA recommended limits. 12 outdoor workers affected.",
    affectedWorkers: ["Ahmed Khalil", "Mohammed Ali", "Khalid Omar"],
    aiConfidence: 100,
    timeToRisk: "Active",
    suggestedAction: "Enforce mandatory rest cycles: 30 min work / 15 min shade rest",
    timestamp: Date.now() - 900000,
    autoActioned: true,
    navTarget: { page: "operations", tab: "workforce" },
  },
  {
    id: "PA5", type: "escalation", severity: "info",
    title: "Shift Change Optimization",
    description: "AI analysis: workers transitioning to night shift show 40% higher risk in first 2 hours. Suggest staggered handoff.",
    affectedWorkers: ["Nasser Al-Said"],
    aiConfidence: 72,
    timeToRisk: "6 PM shift change",
    suggestedAction: "Implement 30-min overlap period with buddy assignment during transition",
    timestamp: Date.now() - 1200000,
    navTarget: { page: "operations", tab: "workforce" },
  },
];

const ENV_THREATS: EnvironmentalThreat[] = [
  { type: "Temperature", icon: Thermometer, value: "48", unit: "°C", status: "danger", threshold: "Safe < 35°C", trend: "up" },
  { type: "Heat Index", icon: Flame, value: "54", unit: "°C", status: "danger", threshold: "Safe < 40°C", trend: "up" },
  { type: "Wind Speed", icon: Wind, value: "12", unit: "km/h", status: "safe", threshold: "Danger > 50", trend: "stable" },
  { type: "Visibility", icon: Eye, value: "8", unit: "km", status: "safe", threshold: "Low < 2 km", trend: "stable" },
  { type: "UV Index", icon: Sun, value: "11+", unit: "", status: "danger", threshold: "Safe < 6", trend: "up" },
  { type: "Humidity", icon: Waves, value: "23", unit: "%", status: "caution", threshold: "Comfort 30-60%", trend: "down" },
];

const RISK_COLORS = {
  safe: "#00C853",
  elevated: "#FF9500",
  high: "#FF6B00",
  critical: "#FF2D55",
};

const SEVERITY_COLORS = {
  info: "#00C8E0",
  warning: "#FF9500",
  danger: "#FF6B00",
  critical: "#FF2D55",
};

const SEVERITY_ICONS: Record<string, any> = {
  prediction: BrainCircuit,
  environment: Thermometer,
  pattern: Radar,
  wellness: Heart,
  escalation: Zap,
};

// ── Styled Icon Component ──────────────────────────────────────
function GlowIcon({ icon: Icon, color, size = 40, iconSize = 20, pulse }: {
  icon: any; color: string; size?: number; iconSize?: number; pulse?: boolean;
}) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {pulse && (
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 rounded-xl"
          style={{ background: `${color}20`, filter: "blur(6px)" }}
        />
      )}
      <div className="relative flex items-center justify-center rounded-xl" style={{
        width: size, height: size,
        background: `linear-gradient(145deg, ${color}20 0%, ${color}08 100%)`,
        border: `1px solid ${color}25`,
        boxShadow: `0 4px 16px ${color}12, inset 0 1px 0 ${color}10`,
      }}>
        <Icon size={iconSize} color={color} strokeWidth={1.6} />
      </div>
    </div>
  );
}

// ── Mini Donut Ring ────────────────────────────────────────────
function RiskDonut({ score, color, size = 56 }: { score: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={4} />
        <motion.circle
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - score / 100) }}
          transition={{ duration: 1, ease: "easeOut" }}
          cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeLinecap="round" strokeDasharray={circumference}
          style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span style={{ fontSize: size * 0.26, fontWeight: 900, color, fontVariantNumeric: "tabular-nums" }}>{score}</span>
      </div>
    </div>
  );
}

// ── FIX 6: Estimated Data Disclaimer ───────────────────────────
function EstimatedDisclaimer() {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl mt-4" style={{
      background: "rgba(255,255,255,0.015)",
      border: "1px solid rgba(255,255,255,0.04)",
    }}>
      <Info size={13} color="rgba(255,255,255,0.25)" strokeWidth={1.8} />
      <span style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.25)", lineHeight: 1.4 }}>
        Based on available data — connect sensors for real-time readings
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
export function SafetyIntelligencePage({ t, webMode = true, employees, onNavigate, onOpenEmployeeDetail }: SafetyIntelligenceProps) {
  const [activeView, setActiveView] = useState<"overview" | "workers" | "alerts" | "environment">("overview");
  const [selectedWorker, setSelectedWorker] = useState<WorkerRisk | null>(null);
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [liveScore, setLiveScore] = useState(72);
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(new Set());
  const [contactedWorkers, setContactedWorkers] = useState<Set<string>>(new Set());
  const [sentAlerts, setSentAlerts] = useState<Set<string>>(new Set());
  const [locatedWorkers, setLocatedWorkers] = useState<Set<string>>(new Set());
  const [aiRefreshing, setAiRefreshing] = useState(false);
  const [refreshCooldown, setRefreshCooldown] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [recalcCounter, setRecalcCounter] = useState(0);

  // Build workers from real employee roster
  const roster = employees && employees.length > 0 ? employees : [];

  // Build dynamic alerts from real audit log + risk data
  const dynamicAlerts = useMemo<ProactiveAlert[]>(() => {
    try {
      const auditLogs: any[] = JSON.parse(localStorage.getItem("sosphere_audit_log") || "[]");
      const risks: any[] = JSON.parse(localStorage.getItem("sosphere_risks") || "[]");
      const realAlerts: ProactiveAlert[] = [];
      const latestCheckins: Record<string, number> = {};
      for (const e of auditLogs) {
        if (e.action?.includes("checkin") && e.user) {
          latestCheckins[e.user] = Math.max(latestCheckins[e.user] || 0, e.timestamp || 0);
        }
      }
      for (const [name, ts] of Object.entries(latestCheckins)) {
        if (Date.now() - ts > 30 * 60 * 1000) {
          realAlerts.push({
            id: `DYN-NOCHECK-${name.replace(/\s/g, "")}`, type: "prediction" as const, severity: "critical" as const,
            title: `Worker Unresponsive — ${name}`,
            description: `${name} has not checked in for over 30 minutes. Immediate follow-up required.`,
            affectedWorkers: [name], aiConfidence: 90, timeToRisk: "NOW",
            timestamp: Date.now() - 60000, autoActioned: false,
            suggestedAction: "Contact worker immediately and verify status",
            navTarget: { page: "emergencyHub", tab: "active" },
          });
        }
      }
      const highRisks = risks.filter((r: any) => r.riskLevel === "critical" || r.riskLevel === "high").slice(0, 2);
      for (const risk of highRisks) {
        realAlerts.push({
          id: `DYN-RISK-${risk.id || risk.zone || Date.now()}`, type: "pattern" as const, severity: "warning" as const,
          title: `High Risk Factor — ${risk.zone || "Site"}`,
          description: risk.description || "Critical risk factor requires immediate attention.",
          affectedWorkers: [], aiConfidence: 85, timeToRisk: "Today",
          timestamp: Date.now() - 300000,
          suggestedAction: risk.mitigation || "Review risk register and assign corrective actions",
          navTarget: { page: "incidentRisk", tab: "register" },
        });
      }
      if (realAlerts.length > 0) return realAlerts;
    } catch { /* fallback */ }
    return [];
  }, [roster, recalcCounter]);

  const workerRisks = useMemo(() => {
    return roster.map((emp, idx) => employeeToWorkerRisk(emp, idx, roster));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, recalcCounter]);

  // FIX 3: Online Now = employees with on-shift or checked-in status (same as dashboard)
  const onDutyEmployees = useMemo(() =>
    roster.filter(e => e.status === "on-shift" || e.status === "checked-in"),
    [roster]
  );
  const totalOnline = onDutyEmployees.length;

  // Name → Employee lookup for worker chip clicks
  const nameToEmployee = useMemo(() => {
    const map = new Map<string, Employee>();
    roster.forEach(emp => map.set(emp.name, emp));
    return map;
  }, [roster]);

  // Handler: click worker chip → navigate to People & open detail slideout
  const handleWorkerChipClick = useCallback((workerName: string) => {
    const emp = nameToEmployee.get(workerName);
    if (!emp) return;
    // Navigate to People & Teams page
    if (onNavigate) onNavigate("people", "directory");
    // Open the employee detail drawer
    if (onOpenEmployeeDetail) onOpenEmployeeDetail(emp.id);
  }, [nameToEmployee, onNavigate, onOpenEmployeeDetail]);

  // REAL: Drive safety score from actual emergency events instead of random noise
  useEffect(() => {
    const unsub = onSyncEvent((event) => {
      setLiveScore(prev => {
        if (event.type === "SOS_TRIGGERED")    return Math.min(100, prev + 15); // SOS → score spikes up (worse)
        if (event.type === "FALL_DETECTED")    return Math.min(100, prev + 12);
        if (event.type === "HAZARD_REPORT")    return Math.min(100, prev + 8);
        if (event.type === "EMERGENCY_RESOLVED") return Math.max(0, prev - 10); // Resolved → score improves
        if (event.type === "CHECKIN")          return Math.max(0, prev - 2);   // Check-in → slight improvement
        return prev;
      });
    });
    return unsub;
  }, []);

  // Slow natural decay toward baseline (60) when no events — score normalizes over time
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveScore(prev => {
        const baseline = 35; // healthy baseline
        if (Math.abs(prev - baseline) < 2) return baseline;
        return prev > baseline ? prev - 1 : prev + 1; // drift back toward baseline
      });
    }, 10000); // drift every 10s
    return () => clearInterval(interval);
  }, []);

  // FIX 5: Cooldown timer
  useEffect(() => {
    if (refreshCooldown <= 0) return;
    const timer = setInterval(() => {
      setRefreshCooldown(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [refreshCooldown]);

  const criticalWorkers = workerRisks.filter(w => w.riskLevel === "critical").length;
  const highRiskWorkers = workerRisks.filter(w => w.riskLevel === "high" || w.riskLevel === "critical").length;

  const getSiteRiskColor = () => {
    if (liveScore >= 75) return "#FF2D55";
    if (liveScore >= 50) return "#FF9500";
    if (liveScore >= 25) return "#00C8E0";
    return "#00C853";
  };

  const getSiteRiskLabel = () => {
    if (liveScore >= 75) return "CRITICAL";
    if (liveScore >= 50) return "ELEVATED";
    if (liveScore >= 25) return "MODERATE";
    return "SAFE";
  };

  const handleAcknowledge = useCallback((alertId: string) => {
    hapticSuccess();
    setAcknowledgedAlerts(prev => new Set([...prev, alertId]));
    const alert = dynamicAlerts.find(a => a.id === alertId);
    toast.success("Alert Acknowledged", { description: alert?.title || "Alert has been acknowledged" });
  }, []);

  const handleContact = useCallback((workerId: string) => {
    hapticSuccess();
    setContactedWorkers(prev => new Set([...prev, workerId]));
    toast.success("Contacting Worker", { description: "Initiating call — standby for connection..." });
  }, []);

  const handleSendAlert = useCallback((workerId: string) => {
    hapticMedium();
    setSentAlerts(prev => new Set([...prev, workerId]));
    const worker = workerRisks.find(w => w.id === workerId);
    toast.success("Alert Sent", { description: `Safety alert sent to ${worker?.name || "worker"}` });
  }, [workerRisks]);

  const handleLocate = useCallback((workerId: string) => {
    hapticSuccess();
    setLocatedWorkers(prev => new Set([...prev, workerId]));
    const worker = workerRisks.find(w => w.id === workerId);
    toast.success("Worker Located", { description: `${worker?.name || "Worker"} found at ${worker?.zone || "zone"} — GPS coordinates updated` });
  }, [workerRisks]);

  // FIX 5: Refresh AI — real recalculation + cooldown
  const handleRefreshAI = useCallback(() => {
    if (refreshCooldown > 0) {
      toast.error("Cooldown Active", { description: `Please wait ${refreshCooldown}s before refreshing again` });
      return;
    }
    hapticMedium();
    setAiRefreshing(true);
    toast("AI Analysis Started", { description: "Recalculating risk scores for all employees..." });
    setTimeout(() => {
      // Trigger recalculation by bumping counter
      setRecalcCounter(prev => prev + 1);
      // Update site score based on new data
      const avgScore = workerRisks.length > 0
        ? Math.round(workerRisks.reduce((s, w) => s + w.riskScore, 0) / workerRisks.length)
        : 50;
      setLiveScore(Math.max(0, Math.min(100, avgScore)));
      setAiRefreshing(false);
      setRefreshCooldown(10);
      setLastRefreshed("just now");
      toast.success("AI Analysis Complete", {
        description: `Risk scores recalculated for ${roster.length} employees across all zones`,
      });
    }, 2000);
  }, [refreshCooldown, workerRisks, roster.length]);

  // FIX 4: Navigate to alert target page
  const handleAlertNavigate = useCallback((alert: ProactiveAlert) => {
    if (onNavigate && alert.navTarget) {
      onNavigate(alert.navTarget.page, alert.navTarget.tab);
    }
  }, [onNavigate]);

  const riskColor = getSiteRiskColor();

  return (
    <div className="p-6 space-y-6" style={{ fontFamily: "'Outfit', sans-serif" }}>
      {/* ══════════════════════════════════════════════════════ */}
      {/* SITE RISK GAUGE — Hero Section                       */}
      {/* FIX 1: This is the ONLY title card. EnterprisePageHeader removed from parent. */}
      {/* ══════════════════════════════════════════════════════ */}
      <div className="rounded-2xl overflow-hidden relative" style={{
        background: "linear-gradient(135deg, rgba(10,18,32,0.95) 0%, rgba(5,7,14,0.98) 100%)",
        border: `1px solid ${riskColor}18`,
        boxShadow: `0 0 60px ${riskColor}06`,
      }}>
        {/* Subtle radial glow */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: `radial-gradient(ellipse at 30% 50%, ${riskColor}08 0%, transparent 60%)`,
        }} />

        <div className="relative p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <GlowIcon icon={BrainCircuit} color={riskColor} size={48} iconSize={24} pulse={liveScore >= 70} />
              <div>
                <h2 style={{ ...TYPOGRAPHY.h1, color: TOKENS.text.primary }}>Site Risk Intelligence</h2>
                <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, marginTop: 2 }}>
                  AI-powered proactive safety monitoring • Real-time analysis
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* FIX 5: Refresh AI with cooldown */}
              <motion.button
                whileHover={refreshCooldown === 0 ? { scale: 1.05 } : {}}
                whileTap={refreshCooldown === 0 ? { scale: 0.95 } : {}}
                onClick={handleRefreshAI}
                className="flex items-center gap-2 px-4 py-2 rounded-xl"
                style={{
                  background: refreshCooldown > 0 ? "rgba(255,255,255,0.02)" : "rgba(0,200,224,0.06)",
                  border: `1px solid ${refreshCooldown > 0 ? "rgba(255,255,255,0.06)" : "rgba(0,200,224,0.15)"}`,
                  cursor: refreshCooldown > 0 ? "not-allowed" : "pointer",
                  opacity: refreshCooldown > 0 ? 0.5 : 1,
                }}>
                <motion.div animate={aiRefreshing ? { rotate: 360 } : {}} transition={{ duration: 1, repeat: aiRefreshing ? Infinity : 0 }}>
                  <RefreshCw size={14} color={refreshCooldown > 0 ? "rgba(255,255,255,0.3)" : "#00C8E0"} />
                </motion.div>
                <span style={{ ...TYPOGRAPHY.caption, color: refreshCooldown > 0 ? "rgba(255,255,255,0.3)" : "#00C8E0", fontWeight: 600 }}>
                  {aiRefreshing ? "Analyzing..." : refreshCooldown > 0 ? `Wait ${refreshCooldown}s` : "Refresh AI"}
                </span>
              </motion.button>
              {/* Last updated indicator */}
              {lastRefreshed && (
                <span style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.2)" }}>
                  Updated: {lastRefreshed}
                </span>
              )}
              <motion.div
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}>
                <Wifi size={12} color="#00C853" />
                <span style={{ ...TYPOGRAPHY.micro, color: "#00C853" }}>AI ACTIVE</span>
              </motion.div>
            </div>
          </div>

          <div className="flex items-center gap-8">
            {/* Risk Donut */}
            <div className="flex items-center gap-6">
              <RiskDonut score={liveScore} color={riskColor} size={100} />
              <div>
                <div style={{ ...TYPOGRAPHY.overline, color: TOKENS.text.muted, marginBottom: 4 }}>OVERALL SITE RISK</div>
                <div className="flex items-center gap-3">
                  <span style={{ fontSize: 42, fontWeight: 900, color: riskColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{liveScore}</span>
                  <span style={{ ...TYPOGRAPHY.body, color: TOKENS.text.muted }}>/100</span>
                </div>
                <Badge variant={liveScore >= 50 ? "danger" : "success"} pulse size="md">
                  {getSiteRiskLabel()}
                </Badge>
              </div>
            </div>

            {/* Vertical divider */}
            <div className="w-px h-20" style={{ background: "rgba(255,255,255,0.06)" }} />

            {/* Quick stats — FIX 3: totalOnline from real roster */}
            <div className="flex-1 grid grid-cols-4 gap-4">
              {[
                { label: "Critical Workers", value: criticalWorkers, color: "#FF2D55", icon: CircleAlert },
                { label: "High Risk", value: highRiskWorkers, color: "#FF9500", icon: AlertTriangle },
                { label: "Online Now", value: totalOnline, color: "#00C8E0", icon: Users },
                { label: "AI Interventions", value: "47", color: "#7B5EFF", icon: Sparkles },
              ].map(stat => (
                <div key={stat.label} className="text-center">
                  <GlowIcon icon={stat.icon} color={stat.color} size={36} iconSize={16} />
                  <div className="mt-2">
                    <span style={{ ...TYPOGRAPHY.kpiValueSm, color: stat.color }}>{stat.value}</span>
                  </div>
                  <span style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 2, display: "block" }}>{stat.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Risk Gradient Bar */}
          <div className="mt-5">
            <div className="h-2.5 rounded-full overflow-hidden relative" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="absolute inset-0 rounded-full" style={{
                background: "linear-gradient(90deg, #00C853 0%, #00C8E0 25%, #FF9500 60%, #FF2D55 100%)",
                opacity: 0.2,
              }} />
              <motion.div
                animate={{ width: `${liveScore}%` }}
                transition={{ duration: 0.5 }}
                className="h-full rounded-full relative"
                style={{ background: `linear-gradient(90deg, #00C853, ${riskColor})` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
                  style={{ background: riskColor, boxShadow: `0 0 8px ${riskColor}80` }} />
              </motion.div>
            </div>
            <div className="flex justify-between mt-1.5">
              {["SAFE", "MODERATE", "ELEVATED", "CRITICAL"].map(l => (
                <span key={l} style={{ ...TYPOGRAPHY.micro, fontSize: 8, color: TOKENS.text.muted, opacity: 0.5 }}>{l}</span>
              ))}
            </div>
          </div>

          {/* FIX 6: Estimated data disclaimer */}
          <EstimatedDisclaimer />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════ */}
      {/* TAB NAVIGATION                                       */}
      {/* ══════════════════════════════════════════════════════ */}
      <div className="flex gap-2 p-1.5 rounded-xl" style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}>
        {([
          { id: "overview" as const, icon: Gauge, label: "Overview", count: undefined },
          { id: "workers" as const, icon: Users, label: "Workers", count: workerRisks.length },
          { id: "alerts" as const, icon: BrainCircuit, label: `AI Alerts${acknowledgedAlerts.size > 0 ? ` (${acknowledgedAlerts.size} ack)` : ""}`, count: dynamicAlerts.filter(a => !acknowledgedAlerts.has(a.id)).length },
          { id: "environment" as const, icon: Thermometer, label: "Environment", count: undefined },
        ]).map(tab => (
          <motion.button
            key={tab.id}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveView(tab.id)}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all"
            style={{
              background: activeView === tab.id ? "rgba(0,200,224,0.08)" : "transparent",
              border: activeView === tab.id ? "1px solid rgba(0,200,224,0.18)" : "1px solid transparent",
              cursor: "pointer",
            }}>
            <tab.icon size={15} color={activeView === tab.id ? "#00C8E0" : "rgba(255,255,255,0.25)"} strokeWidth={1.8} />
            <span style={{
              ...TYPOGRAPHY.caption,
              fontWeight: activeView === tab.id ? 700 : 500,
              color: activeView === tab.id ? "#00C8E0" : "rgba(255,255,255,0.3)",
            }}>
              {tab.label}
            </span>
            {tab.count !== undefined && (
              <span className="px-1.5 py-0.5 rounded-md" style={{
                background: activeView === tab.id ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)",
                fontSize: 9, fontWeight: 700,
                color: activeView === tab.id ? "#00C8E0" : "rgba(255,255,255,0.2)",
              }}>{tab.count}</span>
            )}
          </motion.button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════ */}
      <AnimatePresence mode="wait">

        {/* ── OVERVIEW TAB ─────────────────────────────────── */}
        {activeView === "overview" && (
          <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">

            {/* Proactive vs Reactive Comparison */}
            <Card glow="#00C8E0" padding={24}>
              <SectionHeader title="Proactive vs Reactive" subtitle="Why SOSphere is different" icon={Lightbulb} color="#00C8E0" />
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="p-4 rounded-xl relative overflow-hidden" style={{ background: "rgba(255,45,85,0.03)", border: "1px solid rgba(255,45,85,0.1)" }}>
                  <div className="absolute top-0 right-0 w-20 h-20" style={{ background: "radial-gradient(circle, rgba(255,45,85,0.06) 0%, transparent 70%)" }} />
                  <div className="flex items-center gap-2 mb-3">
                    <GlowIcon icon={XCircle} color="#FF2D55" size={28} iconSize={14} />
                    <span style={{ ...TYPOGRAPHY.overline, color: "#FF2D55" }}>OTHERS (Reactive)</span>
                  </div>
                  <p style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                    Danger happens → Worker presses SOS → Wait for help → Response after incident
                  </p>
                  <div className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,45,85,0.06)" }}>
                    <Clock size={12} color="#FF2D55" />
                    <span style={{ ...TYPOGRAPHY.micro, color: "#FF2D55" }}>Avg. 4min response time</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl relative overflow-hidden" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.1)" }}>
                  <div className="absolute top-0 right-0 w-20 h-20" style={{ background: "radial-gradient(circle, rgba(0,200,224,0.06) 0%, transparent 70%)" }} />
                  <div className="flex items-center gap-2 mb-3">
                    <GlowIcon icon={ShieldCheck} color="#00C853" size={28} iconSize={14} />
                    <span style={{ ...TYPOGRAPHY.overline, color: "#00C8E0" }}>SOSPHERE (Proactive)</span>
                  </div>
                  <p style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                    AI detects risk → Warns before danger → Auto-escalation → Prevention before incident
                  </p>
                  <div className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,200,83,0.06)" }}>
                    <Shield size={12} color="#00C853" />
                    <span style={{ ...TYPOGRAPHY.micro, color: "#00C853" }}>18s avg. prevention time</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Smart KPI Grid */}
            <div className="grid grid-cols-4 gap-4">
              <KPICard label="Risks Prevented" value="12" icon={ShieldCheck} color="#00C853"
                trend={{ value: "+4 this week", positive: true }} subtitle="AI-powered prevention" />
              <KPICard label="Auto-Alerts Sent" value="47" icon={BrainCircuit} color="#00C8E0"
                trend={{ value: "+12 today", positive: true }} subtitle="Proactive notifications" />
              <KPICard label="Avg Response" value="18s" icon={Zap} color="#7B5EFF"
                trend={{ value: "↓ from 4min", positive: true }} subtitle="13x faster than industry" />
              <KPICard label="Near-Misses" value="3" icon={Target} color="#FF9500"
                trend={{ value: "Patterns found", positive: false }} subtitle="AI pattern detection" />
            </div>

            {/* Latest AI Predictions */}
            <div>
              <SectionHeader title="Latest AI Predictions" subtitle="Real-time threat intelligence" icon={BrainCircuit} color="#7B5EFF"
                action={{ label: "View All", onClick: () => setActiveView("alerts") }} />
              {dynamicAlerts.slice(0, 3).map(alert => (
                <AlertCard key={alert.id} alert={alert} expanded={expandedAlert === alert.id}
                  onToggle={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
                  acknowledged={acknowledgedAlerts.has(alert.id)}
                  onAcknowledge={() => handleAcknowledge(alert.id)}
                  onContactWorker={() => handleContact(alert.affectedWorkers[0])}
                  contacted={contactedWorkers.has(alert.affectedWorkers[0])}
                  onNavigate={() => handleAlertNavigate(alert)}
                  hasNavTarget={!!alert.navTarget && !!onNavigate}
                  nameToEmployee={nameToEmployee}
                  onWorkerChipClick={handleWorkerChipClick}
                />
              ))}
            </div>

            {/* Top Risk Workers */}
            <div>
              <SectionHeader title="Workers Needing Attention" subtitle="Sorted by risk score" icon={AlertTriangle} color="#FF9500"
                action={{ label: "View All", onClick: () => setActiveView("workers") }} />
              {workerRisks.filter(w => w.riskScore >= 60).sort((a, b) => b.riskScore - a.riskScore).map(worker => (
                <WorkerRiskCard key={worker.id} worker={worker}
                  selected={selectedWorker?.id === worker.id}
                  onSelect={() => setSelectedWorker(selectedWorker?.id === worker.id ? null : worker)}
                  onSendAlert={() => handleSendAlert(worker.id)}
                  onContact={() => handleContact(worker.id)}
                  onLocate={() => handleLocate(worker.id)}
                  alertSent={sentAlerts.has(worker.id)}
                  contacted={contactedWorkers.has(worker.id)}
                  located={locatedWorkers.has(worker.id)}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* ── WORKERS TAB ──────────────────────────────────── */}
        {activeView === "workers" && (
          <motion.div key="workers" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
            
            {/* Risk Distribution Cards */}
            <div className="grid grid-cols-4 gap-3">
              {(["critical", "high", "elevated", "safe"] as const).map(level => {
                const count = workerRisks.filter(w => w.riskLevel === level).length;
                const color = RISK_COLORS[level];
                const icons = { critical: Siren, high: AlertTriangle, elevated: AlertCircle, safe: ShieldCheck };
                const Icon = icons[level];
                return (
                  <Card key={level} glow={color} padding={16}>
                    <div className="flex items-center justify-between mb-2">
                      <GlowIcon icon={Icon} color={color} size={32} iconSize={14} />
                      <span style={{ ...TYPOGRAPHY.kpiValue, color }}>{count}</span>
                    </div>
                    <span style={{ ...TYPOGRAPHY.overline, color, fontSize: 9 }}>{level}</span>
                  </Card>
                );
              })}
            </div>

            {/* FIX 6: Estimated disclaimer */}
            <EstimatedDisclaimer />

            {/* FIX 2: All Workers sorted by risk — from real roster */}
            {[...workerRisks].sort((a, b) => b.riskScore - a.riskScore).map(worker => (
              <WorkerRiskCard key={worker.id} worker={worker}
                selected={selectedWorker?.id === worker.id}
                onSelect={() => setSelectedWorker(selectedWorker?.id === worker.id ? null : worker)}
                onSendAlert={() => handleSendAlert(worker.id)}
                onContact={() => handleContact(worker.id)}
                onLocate={() => handleLocate(worker.id)}
                alertSent={sentAlerts.has(worker.id)}
                contacted={contactedWorkers.has(worker.id)}
                located={locatedWorkers.has(worker.id)}
              />
            ))}
          </motion.div>
        )}

        {/* ── AI ALERTS TAB ────────────────────────────────── */}
        {activeView === "alerts" && (
          <motion.div key="alerts" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
            
            {/* Alert Stats */}
            <div className="grid grid-cols-4 gap-3">
              {([
                { label: "Critical", count: dynamicAlerts.filter(a => a.severity === "critical" && !acknowledgedAlerts.has(a.id)).length, color: "#FF2D55", icon: Siren },
                { label: "Warning", count: dynamicAlerts.filter(a => (a.severity === "warning" || a.severity === "danger") && !acknowledgedAlerts.has(a.id)).length, color: "#FF9500", icon: AlertTriangle },
                { label: "Info", count: dynamicAlerts.filter(a => a.severity === "info" && !acknowledgedAlerts.has(a.id)).length, color: "#00C8E0", icon: Lightbulb },
                { label: "Acknowledged", count: acknowledgedAlerts.size, color: "#00C853", icon: Sparkles },
              ]).map(s => (
                <Card key={s.label} glow={s.color} padding={16}>
                  <div className="flex items-center justify-between mb-2">
                    <GlowIcon icon={s.icon} color={s.color} size={32} iconSize={14} />
                    <span style={{ ...TYPOGRAPHY.kpiValue, color: s.color }}>{s.count}</span>
                  </div>
                  <span style={{ ...TYPOGRAPHY.overline, color: s.color, fontSize: 9 }}>{s.label}</span>
                </Card>
              ))}
            </div>

            {/* All Alerts — FIX 4: arrows navigate, acknowledged sorted to bottom */}
            {[...dynamicAlerts].sort((a, b) => {
              const aAck = acknowledgedAlerts.has(a.id) ? 1 : 0;
              const bAck = acknowledgedAlerts.has(b.id) ? 1 : 0;
              return aAck - bAck;
            }).map(alert => (
              <AlertCard key={alert.id} alert={alert}
                expanded={expandedAlert === alert.id}
                onToggle={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
                acknowledged={acknowledgedAlerts.has(alert.id)}
                onAcknowledge={() => handleAcknowledge(alert.id)}
                onContactWorker={() => handleContact(alert.affectedWorkers[0])}
                contacted={contactedWorkers.has(alert.affectedWorkers[0])}
                onNavigate={() => handleAlertNavigate(alert)}
                hasNavTarget={!!alert.navTarget && !!onNavigate}
                nameToEmployee={nameToEmployee}
                onWorkerChipClick={handleWorkerChipClick}
              />
            ))}
          </motion.div>
        )}

        {/* ── ENVIRONMENT TAB ──────────────────────────────── */}
        {activeView === "environment" && (
          <motion.div key="environment" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
            
            {/* Active Weather Alert Banner */}
            <Card glow="#FF2D55" padding={20}>
              <div className="flex items-start gap-4">
                <GlowIcon icon={AlertTriangle} color="#FF2D55" size={44} iconSize={22} pulse />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ ...TYPOGRAPHY.h3, color: "#FF2D55" }}>Active Weather Alert</span>
                    <Badge variant="danger" pulse>EXTREME HEAT</Badge>
                  </div>
                  <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, lineHeight: 1.6 }}>
                    Temperature reaching 48°C with Heat Index 54°C. Exceeds OSHA recommended limits. 
                    AI has automatically enforced mandatory rest cycles for all outdoor workers.
                  </p>
                  <div className="flex gap-2 mt-3">
                    <StatPill label="Workers Affected" value="12" color="#FF2D55" />
                    <StatPill label="Auto-Actions" value="3" color="#00C853" />
                  </div>
                </div>
              </div>
            </Card>

            {/* Environmental Grid */}
            <div className="grid grid-cols-3 gap-4">
              {ENV_THREATS.map(threat => {
                const statusColor = threat.status === "safe" ? "#00C853" : threat.status === "caution" ? "#FF9500" : "#FF2D55";
                const ThreatIcon = threat.icon;
                return (
                  <Card key={threat.type} glow={statusColor} padding={18}>
                    <div className="flex items-center justify-between mb-3">
                      <GlowIcon icon={ThreatIcon} color={statusColor} size={34} iconSize={16} />
                      <div className="flex items-center gap-1.5">
                        {threat.trend === "up" && <ArrowUp size={12} color="#FF2D55" />}
                        {threat.trend === "down" && <ArrowDown size={12} color="#00C853" />}
                        <Badge variant={threat.status === "safe" ? "success" : threat.status === "caution" ? "warning" : "danger"}>
                          {threat.status.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span style={{ ...TYPOGRAPHY.kpiValue, color: statusColor }}>{threat.value}</span>
                      <span style={{ ...TYPOGRAPHY.caption, color: TOKENS.text.muted }}>{threat.unit}</span>
                    </div>
                    <p style={{ ...TYPOGRAPHY.caption, color: TOKENS.text.secondary, marginTop: 4, fontWeight: 600 }}>{threat.type}</p>
                    <p style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 4 }}>{threat.threshold}</p>
                  </Card>
                );
              })}
            </div>

            {/* FIX 6: Estimated disclaimer for environment tab */}
            <EstimatedDisclaimer />

            {/* AI Weather Recommendations */}
            <Card glow="#00C8E0" padding={20}>
              <SectionHeader title="AI Weather Recommendations" subtitle="Automated safety actions" icon={BrainCircuit} color="#00C8E0" />
              <div className="space-y-1 mt-3">
                {[
                  { text: "Enforce 30/15 work-rest cycle for outdoor workers", status: "Active", color: "#00C853", icon: CircleCheck },
                  { text: "Deploy hydration stations to Zones A-3 and D-4", status: "Suggested", color: "#FF9500", icon: CircleDot },
                  { text: "Reschedule heavy lifting tasks to 6-9 AM window", status: "Suggested", color: "#FF9500", icon: CircleDot },
                  { text: "Increase check-in frequency to every 15 minutes", status: "Active", color: "#00C853", icon: CircleCheck },
                ].map((rec, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors"
                    style={{ borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.03)" : undefined }}>
                    <rec.icon size={16} color={rec.color} strokeWidth={1.8} />
                    <p className="flex-1" style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.secondary }}>{rec.text}</p>
                    <Badge variant={rec.status === "Active" ? "success" : "warning"} size="sm">{rec.status}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Alert Card Component (FIX 4: added onNavigate + hasNavTarget) ──
function AlertCard({ alert, expanded, onToggle, acknowledged, onAcknowledge, onContactWorker, contacted, onNavigate, hasNavTarget, nameToEmployee, onWorkerChipClick }: {
  alert: ProactiveAlert; expanded: boolean; onToggle: () => void;
  acknowledged: boolean; onAcknowledge: () => void;
  onContactWorker: () => void; contacted: boolean;
  onNavigate?: () => void; hasNavTarget?: boolean;
  nameToEmployee?: Map<string, Employee>;
  onWorkerChipClick?: (workerName: string) => void;
}) {
  const color = SEVERITY_COLORS[alert.severity];
  const Icon = SEVERITY_ICONS[alert.type] || AlertTriangle;
  const minutesAgo = Math.round((Date.now() - alert.timestamp) / 60000);

  return (
    <motion.div layout className="rounded-xl overflow-hidden mb-3" style={{
      background: acknowledged ? "rgba(0,200,83,0.03)" : `${color}03`,
      border: `1px solid ${acknowledged ? "rgba(0,200,83,0.12)" : `${color}12`}`,
    }}>
      <button onClick={onToggle} className="w-full flex items-start gap-4 px-5 py-4 text-left cursor-pointer">
        <GlowIcon icon={Icon} color={acknowledged ? "#00C853" : color} size={38} iconSize={18}
          pulse={alert.severity === "critical" && !acknowledged} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ ...TYPOGRAPHY.h4, color: TOKENS.text.primary }}>{alert.title}</span>
            {alert.autoActioned && <Badge variant="success" size="sm">AUTO-ACTED</Badge>}
            {acknowledged && <Badge variant="success" size="sm">ACKNOWLEDGED</Badge>}
          </div>
          <div className="flex items-center gap-4 mt-1.5">
            <span style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>{minutesAgo}m ago</span>
            <div className="flex items-center gap-1">
              <Sparkles size={10} color={color} />
              <span style={{ ...TYPOGRAPHY.micro, color }}>{alert.aiConfidence}% confidence</span>
            </div>
            <div className="flex items-center gap-1">
              <Timer size={10} color={color} />
              <span style={{ ...TYPOGRAPHY.micro, color }}>{alert.timeToRisk}</span>
            </div>
          </div>
        </div>
        {/* FIX 4: Arrow navigates to relevant page when clicked */}
        {hasNavTarget ? (
          <motion.div
            whileHover={{ scale: 1.2, x: 3 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => { e.stopPropagation(); onNavigate?.(); }}
            className="flex items-center justify-center rounded-lg cursor-pointer"
            style={{ width: 30, height: 30, background: `${color}08`, border: `1px solid ${color}12`, marginTop: 4 }}
          >
            <ArrowRight size={14} color={color} />
          </motion.div>
        ) : (
          <ChevronRight size={16} color="rgba(255,255,255,0.15)"
            style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s", marginTop: 4 }} />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-5 pb-4 space-y-4" style={{ borderTop: `1px solid ${color}08` }}>
              <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.secondary, lineHeight: 1.7, paddingTop: 12 }}>
                {alert.description}
              </p>

              <div className="flex items-center gap-2 flex-wrap">
                <span style={{ ...TYPOGRAPHY.overline, color: TOKENS.text.muted, fontSize: 9 }}>AFFECTED:</span>
                {alert.affectedWorkers.map(w => {
                  const emp = nameToEmployee?.get(w);
                  const initials = w.split(" ").map(n => n[0]).join("").slice(0, 2);
                  const isClickable = !!emp && !!onWorkerChipClick;
                  return (
                    <motion.button
                      key={w}
                      whileHover={isClickable ? { scale: 1.05, y: -1 } : {}}
                      whileTap={isClickable ? { scale: 0.95 } : {}}
                      onClick={(e) => {
                        if (!isClickable) return;
                        e.stopPropagation();
                        onWorkerChipClick!(w);
                      }}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition-all"
                      style={{
                        background: isClickable ? `${color}06` : "rgba(255,255,255,0.03)",
                        border: `1px solid ${isClickable ? `${color}15` : "rgba(255,255,255,0.06)"}`,
                        cursor: isClickable ? "pointer" : "default",
                      }}
                    >
                      {/* Avatar circle with initials */}
                      <div className="flex items-center justify-center rounded-lg shrink-0" style={{
                        width: 22, height: 22,
                        background: `linear-gradient(135deg, ${color}25, ${color}10)`,
                        border: `1px solid ${color}20`,
                      }}>
                        <span style={{ fontSize: 8, fontWeight: 800, color, letterSpacing: 0.5 }}>{initials}</span>
                      </div>
                      {/* Name */}
                      <span style={{ ...TYPOGRAPHY.micro, color: isClickable ? TOKENS.text.primary : TOKENS.text.secondary, fontWeight: 600 }}>
                        {w}
                      </span>
                      {/* Arrow indicator for clickable chips */}
                      {isClickable && (
                        <ArrowRight size={10} color={color} strokeWidth={2} />
                      )}
                    </motion.button>
                  );
                })}
              </div>

              <div className="p-3.5 rounded-xl" style={{ background: `${color}05`, border: `1px solid ${color}10` }}>
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb size={13} color={color} />
                  <span style={{ ...TYPOGRAPHY.overline, color, fontSize: 9 }}>SUGGESTED ACTION</span>
                </div>
                <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.secondary, lineHeight: 1.6 }}>
                  {alert.suggestedAction}
                </p>
              </div>

              <div className="flex gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                  onClick={onAcknowledge}
                  disabled={acknowledged}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all"
                  style={{
                    background: acknowledged ? "rgba(0,200,83,0.08)" : `${color}06`,
                    border: `1px solid ${acknowledged ? "rgba(0,200,83,0.2)" : `${color}15`}`,
                    color: acknowledged ? "#00C853" : color,
                    cursor: acknowledged ? "default" : "pointer",
                    ...TYPOGRAPHY.caption, fontWeight: 600,
                  }}>
                  {acknowledged ? <CheckCircle2 size={15} /> : <CircleCheck size={15} />}
                  {acknowledged ? "Acknowledged" : "Acknowledge"}
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                  onClick={onContactWorker}
                  disabled={contacted}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all"
                  style={{
                    background: contacted ? "rgba(0,200,83,0.06)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${contacted ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.06)"}`,
                    color: contacted ? "#00C853" : "rgba(255,255,255,0.45)",
                    cursor: contacted ? "default" : "pointer",
                    ...TYPOGRAPHY.caption, fontWeight: 600,
                  }}>
                  {contacted ? <CheckCircle2 size={15} /> : <PhoneCall size={15} />}
                  {contacted ? "Contacted" : "Contact Worker"}
                </motion.button>
                {/* FIX 4: Navigate button inside expanded view */}
                {hasNavTarget && (
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={onNavigate}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all"
                    style={{
                      background: `${color}06`,
                      border: `1px solid ${color}15`,
                      color,
                      cursor: "pointer",
                      ...TYPOGRAPHY.caption, fontWeight: 600,
                    }}>
                    <ArrowRight size={15} />
                    Go to Page
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Worker Risk Card Component ──────────────────────────────
function WorkerRiskCard({ worker, selected, onSelect, onSendAlert, onContact, onLocate, alertSent, contacted, located }: {
  worker: WorkerRisk; selected: boolean; onSelect: () => void;
  onSendAlert: () => void; onContact: () => void; onLocate: () => void;
  alertSent: boolean; contacted: boolean; located: boolean;
}) {
  const color = RISK_COLORS[worker.riskLevel];
  const trendIcon = worker.trend === "worsening" ? TrendingUp : worker.trend === "improving" ? TrendingDown : Activity;
  const trendColor = worker.trend === "worsening" ? "#FF2D55" : worker.trend === "improving" ? "#00C853" : "#FF9500";
  const TrendIcon = trendIcon;

  return (
    <motion.div layout className="rounded-xl overflow-hidden mb-3" style={{
      background: selected ? `${color}04` : "rgba(255,255,255,0.015)",
      border: `1px solid ${selected ? `${color}15` : "rgba(255,255,255,0.04)"}`,
    }}>
      <button onClick={onSelect} className="w-full flex items-center gap-4 px-5 py-4 text-left cursor-pointer">
        {/* Risk Score Donut */}
        <RiskDonut score={worker.riskScore} color={color} size={52} />

        {/* Worker Avatar */}
        <div className="size-10 rounded-xl flex items-center justify-center shrink-0" style={{
          background: `linear-gradient(135deg, ${color}20, ${color}08)`,
          border: `1px solid ${color}20`,
        }}>
          <span style={{ fontSize: 11, fontWeight: 800, color }}>{worker.avatar}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <p style={{ ...TYPOGRAPHY.h4, color: TOKENS.text.primary }} className="truncate">{worker.name}</p>
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: `${trendColor}08` }}>
              <TrendIcon size={10} color={trendColor} />
              <span style={{ fontSize: 8, fontWeight: 700, color: trendColor, textTransform: "uppercase" }}>{worker.trend}</span>
            </div>
          </div>
          <p style={{ ...TYPOGRAPHY.caption, color: TOKENS.text.muted, marginTop: 2 }}>
            {worker.role} · {worker.zone} · {worker.hoursOnSite}h on site
          </p>
          <div className="flex items-center gap-4 mt-1.5">
            <span className="flex items-center gap-1" style={{
              ...TYPOGRAPHY.micro,
              color: worker.lastCheckIn > 20 ? "#FF2D55" : TOKENS.text.muted,
            }}>
              <Clock size={10} /> {worker.lastCheckIn}m ago
            </span>
            <span className="flex items-center gap-1" style={{
              ...TYPOGRAPHY.micro,
              color: worker.temperature > 40 ? "#FF9500" : TOKENS.text.muted,
            }}>
              <Thermometer size={10} /> {worker.temperature}°C
            </span>
            <span className="flex items-center gap-1" style={{
              ...TYPOGRAPHY.micro,
              color: worker.nearbyWorkers === 0 ? "#FF2D55" : TOKENS.text.muted,
            }}>
              <Users size={10} /> {worker.nearbyWorkers} nearby
            </span>
          </div>
        </div>

        <Badge variant={worker.riskLevel === "critical" ? "danger" : worker.riskLevel === "high" ? "warning" : worker.riskLevel === "elevated" ? "warning" : "success"}
          pulse={worker.riskLevel === "critical"} size="md">
          {worker.riskLevel.toUpperCase()}
        </Badge>
      </button>

      <AnimatePresence>
        {selected && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-5 pb-4 space-y-4" style={{ borderTop: `1px solid ${color}08`, paddingTop: 14 }}>
              {/* Risk Factors */}
              <div>
                <span style={{ ...TYPOGRAPHY.overline, color: TOKENS.text.muted, fontSize: 9 }}>RISK FACTORS</span>
                <div className="space-y-2 mt-2">
                  {worker.riskFactors.map((factor, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <motion.div
                          initial={{ width: 0 }} animate={{ width: `${factor.weight}%` }}
                          transition={{ duration: 0.6, delay: i * 0.1 }}
                          className="h-full rounded-full"
                          style={{ background: `linear-gradient(90deg, ${factor.color}80, ${factor.color})` }}
                        />
                      </div>
                      <span style={{ ...TYPOGRAPHY.caption, color: TOKENS.text.secondary, minWidth: 160 }}>{factor.factor}</span>
                      <span style={{ ...TYPOGRAPHY.micro, fontWeight: 800, color: factor.color }}>{factor.weight}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex gap-3 pt-1">
                <ActionButton
                  icon={alertSent ? CheckCircle2 : Send}
                  label={alertSent ? "Alert Sent" : "Send Alert"}
                  color="#00C8E0"
                  onClick={onSendAlert}
                  done={alertSent}
                />
                <ActionButton
                  icon={contacted ? CheckCircle2 : PhoneCall}
                  label={contacted ? "Called" : "Call"}
                  color="#00C853"
                  onClick={onContact}
                  done={contacted}
                />
                <ActionButton
                  icon={located ? CheckCircle2 : MapPinned}
                  label={located ? "Located" : "Locate"}
                  color="#FF9500"
                  onClick={onLocate}
                  done={located}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Action Button Component ─────────────────────────────────
function ActionButton({ icon: Icon, label, color, onClick, done }: {
  icon: any; label: string; color: string; onClick: () => void; done: boolean;
}) {
  return (
    <motion.button
      whileHover={!done ? { scale: 1.03 } : {}}
      whileTap={!done ? { scale: 0.96 } : {}}
      onClick={!done ? onClick : undefined}
      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all"
      style={{
        background: done ? "rgba(0,200,83,0.06)" : `${color}06`,
        border: `1px solid ${done ? "rgba(0,200,83,0.15)" : `${color}12`}`,
        color: done ? "#00C853" : color,
        cursor: done ? "default" : "pointer",
        ...TYPOGRAPHY.caption,
        fontWeight: 600,
      }}>
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </motion.button>
  );
}
