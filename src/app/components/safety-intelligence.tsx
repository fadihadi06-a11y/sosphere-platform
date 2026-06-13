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

import { getCachedRisks } from "./risk-register-service";
import { getAuditEntries } from "./audit-log-store";
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
import { onSyncEvent, getCompanyId, sendBroadcast } from "./shared-store";
import { fetchBuddyPairs } from "./buddy-service";
import { safeTelCall } from "./utils/safe-tel";
import { calculateRiskScore, type EmployeeRiskScore, type EmployeeForRiskScoring } from "./risk-scoring-engine";
import { getCachedLatest, lookupZoneObservation, loadLatestPerZone, aggregateSeverity, formatTempC, type WeatherObservation } from "./weather-service";

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



// ── FIX 2: Convert real Employee to WorkerRisk via calculateRiskScore ──
// Deterministic "mock sensor" data seeded by employee index
const ZONE_GPS: Record<string, { lat: number; lng: number }> = {
  "Zone A": { lat: 24.7136, lng: 46.6753 },
  "Zone B": { lat: 24.7200, lng: 46.6800 },
  "Zone C": { lat: 24.7180, lng: 46.6700 },
  "Zone D": { lat: 24.6950, lng: 46.7100 },
  "Zone E": { lat: 24.7050, lng: 46.6900 },
};

function employeeToWorkerRisk(
  emp: Employee,
  allEmployees: Employee[],
  ctx: { buddyEmpIds: Set<string>; weatherRows: WeatherObservation[]; nowHour: number },
): WorkerRisk {
  const isOnDuty = emp.status === "on-shift" || emp.status === "checked-in";
  const isSos = emp.status === "sos";

  // REAL: check-in age (minutes) parsed from the roster's lastCheckin string.
  const lastCheckInStr = emp.lastCheckin || "";
  const lastCheckIn = lastCheckInStr.includes("m ago")
    ? parseInt(lastCheckInStr) || 0
    : lastCheckInStr.includes("h ago")
    ? (parseInt(lastCheckInStr) || 1) * 60
    : lastCheckInStr === "0s" ? 0 : 0;

  const zoneKey = emp.location.split(" - ")[0] || "Zone A";

  // REAL: nearby = other on-duty workers in the same zone (from the live roster).
  const nearbyWorkers = allEmployees.filter(e =>
    e.id !== emp.id &&
    (e.status === "on-shift" || e.status === "checked-in") &&
    (e.location.split(" - ")[0] || "") === zoneKey
  ).length;

  // REAL: buddy presence from buddy_pairs (not a seed guess).
  const hasBuddy = ctx.buddyEmpIds.has(emp.id);
  const isWorkingAlone = isOnDuty && !hasBuddy && nearbyWorkers === 0;

  // REAL: live weather for the worker's zone (may be absent → factor skipped).
  const weatherObs = lookupZoneObservation(ctx.weatherRows, zoneKey);
  const zoneTemp = weatherObs?.temp_c ?? null;

  // REAL: shift derived from the current hour (day 06:00–18:00, else night).
  const shift: "day" | "night" = (ctx.nowHour >= 18 || ctx.nowHour < 6) ? "night" : "day";

  // Feed the real risk engine ONLY real-sourced inputs. Factors with no real
  // source (battery, fasting, hours-on-site) are left null/undefined so the
  // engine simply skips them instead of scoring fabricated data.
  const riskInput: EmployeeForRiskScoring = {
    id: emp.id,
    name: emp.name,
    // real joinDate when known; otherwise a neutral 1-year-ago so an UNKNOWN
    // tenure never adds a fake "new worker" penalty.
    joinDate: emp.joinDate ?? (Date.now() - 365 * 24 * 60 * 60 * 1000),
    hasBuddy,
    checkInInterval: emp.checkInInterval ?? (lastCheckIn > 30 ? 180 : 60),
    batteryLevel: null,                                   // no real battery telemetry → skip
    isWorkingAlone,
    shift,
    temperature: typeof zoneTemp === "number" ? zoneTemp : undefined, // real zone temp only
    lastMovement: lastCheckIn > 0 ? lastCheckIn * 60000 : undefined,
    weatherSeverity: weatherObs?.severity,
    weatherCondition: weatherObs?.condition,
  };

  const riskResult = calculateRiskScore(riskInput);

  const levelMap: Record<string, "safe" | "elevated" | "high" | "critical"> = {
    safe: "safe",
    caution: "elevated",
    warning: "high",
    critical: "critical",
  };
  const riskLevel = levelMap[riskResult.level] || "safe";

  // A worker in active SOS is always critical regardless of engine score.
  const finalScore = isSos ? Math.max(riskResult.totalScore, 90) : riskResult.totalScore;
  const finalLevel: WorkerRisk["riskLevel"] = isSos ? "critical" : riskLevel;

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

  const trend: "improving" | "stable" | "worsening" =
    finalScore >= 70 ? "worsening" : finalScore >= 40 ? "stable" : "improving";

  const initials = emp.name.split(" ").map(n => n[0]).join("").slice(0, 2);
  // Zone centroid (display only) — honest zone-level position, not fake precision.
  const gps = ZONE_GPS[zoneKey] || { lat: 0, lng: 0 };

  return {
    id: emp.id,
    name: emp.name,
    role: emp.role,
    zone: emp.location !== "—" ? emp.location : "Off-Site",
    riskScore: finalScore,
    riskLevel: finalLevel,
    riskFactors,
    hoursOnSite: 0,                                         // no real clock-in source → not displayed
    lastCheckIn,
    temperature: typeof zoneTemp === "number" ? Math.round(zoneTemp) : 0, // real zone temp, else 0 (hidden)
    nearbyWorkers,
    trend,
    lat: gps.lat,
    lng: gps.lng,
    avatar: initials,
  };
}


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
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(new Set());
  const [contactedWorkers, setContactedWorkers] = useState<Set<string>>(new Set());
  const [sentAlerts, setSentAlerts] = useState<Set<string>>(new Set());
  const [locatedWorkers, setLocatedWorkers] = useState<Set<string>>(new Set());
  const [aiRefreshing, setAiRefreshing] = useState(false);
  const [refreshCooldown, setRefreshCooldown] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [recalcCounter, setRecalcCounter] = useState(0);

  // REAL context for risk scoring: live buddy pairs + live per-zone weather.
  const [buddyEmpIds, setBuddyEmpIds] = useState<Set<string>>(new Set());
  const [weatherRows, setWeatherRows] = useState<WeatherObservation[]>(() => getCachedLatest());
  useEffect(() => {
    const cid = getCompanyId();
    if (!cid) return;
    let alive = true;
    fetchBuddyPairs().then(pairs => {
      if (!alive) return;
      const ids = new Set<string>();
      pairs.forEach(pr => { if (pr.isActive !== false) { if (pr.employeeAId) ids.add(pr.employeeAId); if (pr.employeeBId) ids.add(pr.employeeBId); } });
      setBuddyEmpIds(ids);
    }).catch(() => { /* buddy load best-effort */ });
    loadLatestPerZone(cid).then(rows => { if (alive && rows.length) setWeatherRows(rows); }).catch(() => { /* weather best-effort */ });
    return () => { alive = false; };
  }, []);

  // Build workers from real employee roster
  const roster = employees && employees.length > 0 ? employees : [];

  // Build dynamic alerts from real audit log + risk data
  const dynamicAlerts = useMemo<ProactiveAlert[]>(() => {
    try {
      // 2026-06-03 #6 fix: route audit + risk reads through their
      // service modules instead of raw localStorage. Without this, AI
      // scoring kept producing recommendations from the previous
      // tenant's data after a tenant switch on a shared device.
      const auditLogs: any[] = getAuditEntries();
      const risks: any[] = getCachedRisks();
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
    const nowHour = new Date().getHours();
    const ctx = { buddyEmpIds, weatherRows, nowHour };
    return roster.map(emp => employeeToWorkerRisk(emp, roster, ctx));
  }, [roster, recalcCounter, buddyEmpIds, weatherRows]);

  // REAL site risk = average of the live per-worker risk scores (0 when empty).
  const liveScore = useMemo(() => {
    if (workerRisks.length === 0) return 0;
    return Math.round(workerRisks.reduce((sum, w) => sum + w.riskScore, 0) / workerRisks.length);
  }, [workerRisks]);

  // REAL: count of high/critical entries in the company risk register.
  const openHighRisks = useMemo(() => {
    try { return getCachedRisks().filter((r: any) => r.riskLevel === "high" || r.riskLevel === "critical").length; }
    catch { return 0; }
  }, [recalcCounter]);

  // REAL: environment metrics derived from live per-zone weather (weather_log).
  const envWeather = useMemo(() => {
    const rows = weatherRows;
    if (!rows.length) return null;
    const sevRank = (sv: string) => sv === "severe" ? 2 : sv === "warning" ? 1 : 0;
    const rep = [...rows].sort((a, b) => sevRank(b.severity) - sevRank(a.severity))[0];
    const severity = aggregateSeverity(rows);
    const t = rep.temp_c, fl = rep.feels_like_c, h = rep.humidity_pct;
    const wKmh = typeof rep.wind_speed_ms === "number" ? rep.wind_speed_ms * 3.6 : null;
    const visKm = typeof rep.visibility_m === "number" ? rep.visibility_m / 1000 : null;
    const metrics = [
      { type: "Temperature", icon: Thermometer, value: typeof t === "number" ? Math.round(t).toString() : "—", unit: "°C", status: (t ?? 0) >= 40 ? "danger" : (t ?? 0) >= 35 ? "caution" : "safe", threshold: "Safe < 35°C" },
      { type: "Feels Like", icon: Flame, value: typeof fl === "number" ? Math.round(fl).toString() : "—", unit: "°C", status: (fl ?? 0) >= 45 ? "danger" : (fl ?? 0) >= 40 ? "caution" : "safe", threshold: "Safe < 40°C" },
      { type: "Humidity", icon: Waves, value: typeof h === "number" ? Math.round(h).toString() : "—", unit: "%", status: "safe", threshold: "Comfort 30–60%" },
      { type: "Wind Speed", icon: Wind, value: wKmh != null ? Math.round(wKmh).toString() : "—", unit: "km/h", status: (wKmh ?? 0) >= 50 ? "danger" : (wKmh ?? 0) >= 30 ? "caution" : "safe", threshold: "Danger > 50" },
      { type: "Visibility", icon: Eye, value: visKm != null ? visKm.toFixed(1) : "—", unit: "km", status: (visKm ?? 99) < 2 ? "danger" : "safe", threshold: "Low < 2 km" },
      { type: "Condition", icon: Sun, value: rep.condition || "—", unit: "", status: severity === "severe" ? "danger" : severity === "warning" ? "caution" : "safe", threshold: `as of ${new Date(rep.observed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` },
    ];
    return { rep, severity, metrics };
  }, [weatherRows]);

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

  // REAL: when an emergency/check-in event fires, force a recompute so the
  // (real) per-worker risk scores — and the derived site score — refresh from
  // the latest roster. No synthetic drift, no fabricated number.
  useEffect(() => {
    const unsub = onSyncEvent((event) => {
      if (["SOS_TRIGGERED", "FALL_DETECTED", "HAZARD_REPORT", "EMERGENCY_RESOLVED", "CHECKIN"].includes(event.type)) {
        setRecalcCounter(prev => prev + 1);
      }
    });
    return unsub;
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

  // REAL: place a phone call to the worker (works by employee id OR name —
  // the alert cards pass a name, the worker cards pass an id).
  const handleContact = useCallback((workerKey: string) => {
    const emp = roster.find(e => e.id === workerKey) || roster.find(e => e.name === workerKey);
    if (!emp) { toast.error("Worker not found"); return; }
    hapticSuccess();
    setContactedWorkers(prev => new Set([...prev, workerKey]));
    if (emp.phone) {
      void safeTelCall(emp.phone, emp.name);
      toast.success("Calling Worker", { description: `Dialing ${emp.name}…` });
    } else {
      toast.info("No phone on file", { description: `${emp.name} has no phone number to call.` });
    }
  }, [roster]);

  // REAL: push a safety alert to the worker's device via the broadcast pipeline
  // (targeted by their auth user_id). Honest fallback when no linked device.
  const handleSendAlert = useCallback((workerId: string) => {
    const emp = roster.find(e => e.id === workerId);
    if (!emp) { toast.error("Worker not found"); return; }
    hapticMedium();
    setSentAlerts(prev => new Set([...prev, workerId]));
    const targetId = (emp.userId || "").trim();
    if (targetId) {
      sendBroadcast({
        title: "Safety Check Required",
        body: `${emp.name}, elevated risk detected for your zone — please confirm your status now.`,
        priority: "urgent",
        audience: { type: "custom", employeeIds: [targetId] },
        audienceLabel: emp.name,
        source: "manual",
        senderName: "Safety Intelligence",
        senderRole: "Admin",
        timestamp: Date.now(),
        expiresAt: Date.now() + 6 * 3600000,
      });
      toast.success("Alert Sent", { description: `Safety alert pushed to ${emp.name}.` });
    } else {
      toast.info("No linked device", { description: `${emp.name} has no linked device id — can't push an alert yet.` });
    }
  }, [roster]);

  // REAL: open the worker in People & Teams so the admin sees their live
  // location/details (instead of a fake location-updated toast).
  const handleLocate = useCallback((workerId: string) => {
    const emp = roster.find(e => e.id === workerId);
    if (!emp) { toast.error("Worker not found"); return; }
    hapticSuccess();
    setLocatedWorkers(prev => new Set([...prev, workerId]));
    if (onNavigate) onNavigate("people", "directory");
    if (onOpenEmployeeDetail) onOpenEmployeeDetail(emp.id);
  }, [roster, onNavigate, onOpenEmployeeDetail]);

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
      // Site score is derived from workerRisks (recomputed via recalcCounter).
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
                { label: "Active Alerts", value: dynamicAlerts.filter(a => !acknowledgedAlerts.has(a.id)).length, color: "#7B5EFF", icon: BrainCircuit },
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
                </div>
              </div>
            </Card>

            {/* Smart KPI Grid */}
            <div className="grid grid-cols-4 gap-4">
              <KPICard label="Avg Risk Score" value={liveScore} icon={Gauge} color={getSiteRiskColor()}
                subtitle="Live site average" />
              <KPICard label="Active Alerts" value={dynamicAlerts.filter(a => !acknowledgedAlerts.has(a.id)).length} icon={BrainCircuit} color="#00C8E0"
                subtitle="Open AI alerts" />
              <KPICard label="Workers Online" value={totalOnline} icon={Users} color="#7B5EFF"
                subtitle="On shift / checked in" />
              <KPICard label="Open Risks" value={openHighRisks} icon={AlertTriangle} color="#FF9500"
                subtitle="High/critical in register" />
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

            {/* Honest empty state when no live weather is available */}
            {!envWeather && (
              <Card padding={20}>
                <div className="flex items-start gap-4">
                  <GlowIcon icon={Thermometer} color="rgba(255,255,255,0.3)" size={44} iconSize={22} />
                  <div className="flex-1">
                    <span style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.secondary }}>No live weather data</span>
                    <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, lineHeight: 1.6, marginTop: 4 }}>
                      Per-zone weather appears here once the weather fetch runs for your zones. Configure it in the weather settings to see real temperature, wind, and severity.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* REAL active weather alert — only when live severity is elevated */}
            {envWeather && envWeather.severity !== "info" && (
              <Card glow={envWeather.severity === "severe" ? "#FF2D55" : "#FF9500"} padding={20}>
                <div className="flex items-start gap-4">
                  <GlowIcon icon={AlertTriangle} color={envWeather.severity === "severe" ? "#FF2D55" : "#FF9500"} size={44} iconSize={22} pulse />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span style={{ ...TYPOGRAPHY.h3, color: envWeather.severity === "severe" ? "#FF2D55" : "#FF9500" }}>Active Weather Alert</span>
                      <Badge variant={envWeather.severity === "severe" ? "danger" : "warning"} pulse>{envWeather.severity.toUpperCase()}</Badge>
                    </div>
                    <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, lineHeight: 1.6 }}>
                      {envWeather.rep.condition || "Severe weather"} in {envWeather.rep.zone_id || "your area"} — {formatTempC(envWeather.rep.temp_c)}{typeof envWeather.rep.feels_like_c === "number" ? ` (feels ${formatTempC(envWeather.rep.feels_like_c)})` : ""}. Review outdoor work and check-in frequency.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <StatPill label="Workers On Duty" value={String(totalOnline)} color={envWeather.severity === "severe" ? "#FF2D55" : "#FF9500"} />
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* REAL environmental grid from live weather */}
            {envWeather && (
              <div className="grid grid-cols-3 gap-4">
                {envWeather.metrics.map(metric => {
                  const statusColor = metric.status === "safe" ? "#00C853" : metric.status === "caution" ? "#FF9500" : "#FF2D55";
                  const ThreatIcon = metric.icon;
                  return (
                    <Card key={metric.type} glow={statusColor} padding={18}>
                      <div className="flex items-center justify-between mb-3">
                        <GlowIcon icon={ThreatIcon} color={statusColor} size={34} iconSize={16} />
                        <Badge variant={metric.status === "safe" ? "success" : metric.status === "caution" ? "warning" : "danger"}>
                          {metric.status.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span style={{ ...TYPOGRAPHY.kpiValue, color: statusColor }}>{metric.value}</span>
                        <span style={{ ...TYPOGRAPHY.caption, color: TOKENS.text.muted }}>{metric.unit}</span>
                      </div>
                      <p style={{ ...TYPOGRAPHY.caption, color: TOKENS.text.secondary, marginTop: 4, fontWeight: 600 }}>{metric.type}</p>
                      <p style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 4 }}>{metric.threshold}</p>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Honest source note */}
            <EstimatedDisclaimer />
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
            {worker.role} · {worker.zone}
          </p>
          <div className="flex items-center gap-4 mt-1.5">
            <span className="flex items-center gap-1" style={{
              ...TYPOGRAPHY.micro,
              color: worker.lastCheckIn > 20 ? "#FF2D55" : TOKENS.text.muted,
            }}>
              <Clock size={10} /> {worker.lastCheckIn}m ago
            </span>
            {worker.temperature > 0 && (
              <span className="flex items-center gap-1" style={{
                ...TYPOGRAPHY.micro,
                color: worker.temperature > 40 ? "#FF9500" : TOKENS.text.muted,
              }}>
                <Thermometer size={10} /> {worker.temperature}°C
              </span>
            )}
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
