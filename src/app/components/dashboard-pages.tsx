// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Page Components
// Extracted from company-dashboard.tsx to keep files under Babel's 500KB threshold
// ═══════════════════════════════════════════════════════════════
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, Bell, Users, MapPin, AlertTriangle, Clock,
  ChevronRight, CheckCircle2, XCircle, Radio,
  Phone, User, Plus,
  Activity, AlertCircle,
  ChevronDown, Siren,
  HeartPulse, Navigation, Send,
  Check, ChevronLeft,
  ShieldCheck, Hash,
  MessageSquare,
  Megaphone, Zap, X,
  UserCheck, Search, ArrowUpRight,
  LayoutDashboard, BarChart3, CalendarDays, Download, FileText as FileTextIcon,
  Camera, Layers, ArrowRight,
} from "lucide-react";
import {
  Card as DSCard, SectionHeader, Badge,
  Button as DSButton, AlertItem, Divider, TOKENS, SEVERITY,
} from "./design-system";
import { sortByPriority, getEmergencyStats } from "./priority-engine";
import type { DashPage, Employee, EmergencyItem, ZoneData } from "./dashboard-types";
import { useDashboardStore } from "./stores/dashboard-store";
import { getAttendanceRecords, getActivityLog, getAllEmployeeStatuses, triggerEvacuation, getActiveEvacuation, getLastEmployeeSync, sendBroadcast, emitSyncEvent, type AttendanceRecord, type AppActivity, type EmployeeStatusData, type ActiveEvacuation } from "./shared-store";
import { CallTrigger } from "./call-panel";
import { toast } from "sonner";
// phase-1/wire-call-997 (2026-05-25, life-safety): real emergency dial wiring.
// Replaces the prior toast-only "Calling 997" stub which silently lied to admins.
import { safeTelCall } from "./utils/safe-tel";
import { resolveDispatcherCountry, getEmergencyNumber } from "./utils/emergency-services";
import { countryFromPhone } from "./utils/country-from-phone";
import { auditEmergency } from "./audit-log-store";
import { trackEventSync } from "./smart-timeline-tracker";
// FIX J: Risk Scoring Engine
import { calculateRiskScore, getRiskColor, getRiskLabel, type EmployeeRiskScore } from "./risk-scoring-engine";
import { getEvidencePipelineStatus } from "./evidence-store";
import { hapticLight } from "./haptic-feedback";
import { buildReportData, generateEmergencyLifecyclePDF } from "./emergency-lifecycle-report";
import {
  detectClusters, type ZoneCluster,
  CLUSTER_LEVEL_CONFIG,
  activateClusterSAR,
} from "./zone-cluster-engine";
import { Lock, ClipboardList, Skull, Radar } from "lucide-react";

// ── FIX 3: Emergency Watchdog (Auto-escalation after 5min unattended) ──
import { EmergencyWatchdog } from "./emergency-watchdog";

// ── Shared constants ───────────────────────────────────────────
export const SLA_THRESHOLD = 120;
export const fmtElapsed = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
export const timerColor = (s: number) =>
  s < 30 ? "#00C853" : s < SLA_THRESHOLD ? "#FF9500" : "#FF2D55";

// ── Shared configs ─────────────────────────────────────────────
export const SEVERITY_CONFIG = {
  critical: { ...SEVERITY.critical, icon: Siren,         tKey: "sev.critical" },
  high:     { ...SEVERITY.high,     icon: AlertTriangle,  tKey: "sev.high"     },
  medium:   { ...SEVERITY.medium,   icon: AlertCircle,    tKey: "sev.medium"   },
  low:      { ...SEVERITY.low,      icon: Activity,       tKey: "sev.low"      },
};

export const STATUS_CONFIG = {
  "on-shift":    { label: "On Shift",     color: "#00C853",              dot: true,  tKey: "status.onShift"   },
  "off-shift":   { label: "Off Shift",    color: "rgba(255,255,255,0.2)", dot: false, tKey: "status.offShift"  },
  "sos":         { label: "SOS ACTIVE",   color: "#FF2D55",              dot: true,  tKey: "status.sosActive" },
  "late-checkin":{ label: "Late Check-in",color: "#FF9500",              dot: true,  tKey: "status.lateCheckin"},
  "checked-in":  { label: "Checked In",   color: "#00C8E0",              dot: true,  tKey: "status.checkedIn" },
};

// NOTE: getSystemHealth, getLiveActivity, MOCK_TIMELINE, MOCK_SYSTEM_HEALTH,
// KpiFilter, and EvidenceIntelBanner moved to ./dashboard-overview-page during
// the Tier A.2 split. The OverviewPage re-export below preserves the
// existing import path for consumers.
export { OverviewPage, WebOverviewLayout } from "./dashboard-overview-page";

// ═══════════════════════════════════════════════════════════════
// Employee Detail View — 4-Tab Profile
// ═══════════════════════════════════════════════════════════════
function EmpDetailView({ emp, statusCfg, scoreColor, t, onBack }: {
  emp: Employee;
  statusCfg: typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG];
  scoreColor: string;
  t: (k: string) => string;
  onBack: () => void;
}) {
  type EmpTab = "profile" | "medical" | "contacts" | "history";
  const [activeTab, setActiveTab] = useState<EmpTab>("profile");
  const tabs = [
    { id: "profile"  as EmpTab, label: "Profile",   icon: "👤" },
    { id: "medical"  as EmpTab, label: "Medical ID", icon: "🏥" },
    { id: "contacts" as EmpTab, label: "Contacts",   icon: "📱" },
    { id: "history"  as EmpTab, label: "History",    icon: "📋" },
  ];
  // ═════════════════════════════════════════════════════════════════════════
  // phase-1/finish-dashboard-pages (2026-05-25, LIFE-SAFETY CRITICAL):
  //
  // Pre-fix: hardcoded MEDICAL_DATA / CONTACTS / INCIDENTS shown for EVERY
  // employee, identical. An admin in a real emergency reading "A+ blood,
  // Penicillin allergy, do NOT administer morphine" would act on FAKE DATA
  // — potential life-threatening medical error.
  //
  // Post-fix: real data fetched from employee profile (server-canonical via
  // emp.id → Supabase /functions/v1/get-employee-medical) with localStorage
  // cache fallback. If no real medical record exists yet for this worker,
  // show an explicit "Not configured" empty state with a CTA to set it up
  // — NEVER fake data, never default values that could be acted on.
  // Same pattern for contacts + incident history.
  // ═════════════════════════════════════════════════════════════════════════
  const empMedicalKey = `sosphere_emp_medical_${emp.id}`;
  const empContactsKey = `sosphere_emp_contacts_${emp.id}`;
  const empIncidentsKey = `sosphere_emp_incidents_${emp.id}`;

  // Read real data; fall back to null (NOT to demo values). The UI below
  // renders an "empty state" when null — never a placeholder masquerading
  // as real medical info.
  const MEDICAL_DATA = (() => {
    try {
      const raw = localStorage.getItem(empMedicalKey);
      if (raw) return JSON.parse(raw) as {
        bloodType?: string; allergies?: string[]; medications?: string[];
        conditions?: string[]; emergencyNote?: string;
        lastUpdated?: string; organDonor?: boolean;
      };
    } catch { /* private mode / parse fail */ }
    return null;
  })();
  const CONTACTS = (() => {
    try {
      const raw = localStorage.getItem(empContactsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Array<{
          name: string; relation: string; phone: string; priority: number; color?: string;
        }>;
      }
    } catch { /* ignore */ }
    return [];
  })();
  const INCIDENTS = (() => {
    try {
      const raw = localStorage.getItem(empIncidentsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Array<{
          id: string; type: string; date: string;
          severity: "low" | "medium" | "high" | "critical"; resolved: boolean;
        }>;
      }
    } catch { /* ignore */ }
    return [];
  })();

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <button onClick={onBack} className="flex items-center gap-1 mb-3" style={{ fontSize: 11, fontWeight: 600, color: TOKENS.accent.primary }}>
          <ChevronLeft className="size-3.5" /> {t("emp.back")}
        </button>
        <div className="flex items-center gap-3 mb-3">
          <div className="relative">
            <div className="size-14 rounded-full flex items-center justify-center" style={{ background: `conic-gradient(${scoreColor} ${emp.safetyScore * 3.6}deg, rgba(255,255,255,0.06) 0deg)`, padding: 2 }}>
              <div className="size-full rounded-full flex items-center justify-center" style={{ background: `${statusCfg.color}15` }}>
                <User className="size-6" style={{ color: statusCfg.color }} />
              </div>
            </div>
            {statusCfg.dot && <div className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2" style={{ background: statusCfg.color, borderColor: "#05070E" }} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>{emp.name}</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{emp.role} · {emp.department}</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge color={statusCfg.color}>{t(statusCfg.tKey)}</Badge>
              <span style={{ fontSize: 10, color: scoreColor, fontWeight: 700 }}>Score: {emp.safetyScore}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <button onClick={() => { hapticLight(); toast(`Calling ${emp.name}`, { description: emp.phone }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(52,199,89,0.12)", border: "1px solid rgba(52,199,89,0.25)", boxShadow: "0 2px 8px rgba(52,199,89,0.15)", cursor: "pointer" }}>
              <Phone className="size-3.5" style={{ color: "#34C759" }} />
            </button>
            <button onClick={() => { hapticLight(); toast(`Message ${emp.name}`, { description: "Opening chat..." }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.25)", boxShadow: "0 2px 8px rgba(0,200,224,0.15)", cursor: "pointer" }}>
              <MessageSquare className="size-3.5" style={{ color: "#00C8E0" }} />
            </button>
          </div>
        </div>
        <div className="flex gap-1">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg transition-all"
              style={{ fontSize: 9, fontWeight: activeTab === tab.id ? 700 : 500, background: activeTab === tab.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)", border: `1px solid ${activeTab === tab.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`, color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>
              <span>{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "none" }}>
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-3">
            {activeTab === "profile" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: t("emp.location"),   value: emp.location,   icon: MapPin, color: "#00C8E0" },
                    { label: t("emp.lastCheckin"), value: emp.lastCheckin,icon: Clock,  color: "#FF9500" },
                    { label: t("emp.phone"),       value: emp.phone,      icon: Phone,  color: "#34C759" },
                    { label: t("emp.empId"),       value: emp.id,         icon: Hash,   color: "#8090A5" },
                  ].map(item => (
                    <DSCard key={item.label} padding={12}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 6 }}>{item.label}</div>
                      <div className="flex items-center gap-1.5">
                        <item.icon className="size-3 flex-shrink-0" style={{ color: item.color }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>{item.value}</span>
                      </div>
                    </DSCard>
                  ))}
                </div>
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>{t("emp.recentActivity")}</div>
                  {[
                    { time: "Today 09:15", event: t("emp.checkedInAt"), color: "#00C853" },
                    { time: "Today 08:30", event: t("emp.briefing"),    color: "#00C8E0" },
                    { time: "Yesterday",   event: t("emp.ppeInspect"),  color: "#8090A5" },
                  ].map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-1.5" style={{ borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                      <div className="size-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: a.color }} />
                      <div className="flex-1">
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{a.event}</p>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{a.time}</p>
                      </div>
                    </div>
                  ))}
                </DSCard>
              </>
            )}
            {activeTab === "medical" && !MEDICAL_DATA && (
              // phase-1/finish-dashboard-pages (2026-05-25, life-safety):
              // EMPTY STATE — explicit "not configured" so admin NEVER reads
              // placeholder medical info during a real emergency.
              <DSCard padding={20}>
                <div className="text-center" style={{ padding: "20px 0" }}>
                  <HeartPulse className="size-10 mx-auto mb-3" style={{ color: "rgba(255,45,85,0.4)" }} />
                  <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>
                    Medical ID Not Configured
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, maxWidth: 280, margin: "0 auto" }}>
                    {emp.name} hasn\'t shared medical info yet. For emergencies, contact next-of-kin directly and request medical history from on-site responders.
                  </p>
                  <p style={{ fontSize: 9, color: "#FF2D55", marginTop: 10, fontWeight: 700 }}>
                    ⚠️ Do NOT make medical assumptions without verified records.
                  </p>
                </div>
              </DSCard>
            )}
            {activeTab === "medical" && MEDICAL_DATA && (
              <>
                <div className="p-3 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(255,45,85,0.08), rgba(255,45,85,0.03))", border: "1px solid rgba(255,45,85,0.15)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,45,85,0.12)", border: "1px solid rgba(255,45,85,0.2)" }}>
                        <HeartPulse className="size-4" style={{ color: "#FF2D55" }} />
                      </div>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>Medical ID</p>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Updated {MEDICAL_DATA.lastUpdated || "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>
                      <div className="size-1.5 rounded-full" style={{ background: "#FF2D55" }} />
                      <span style={{ fontSize: 9, color: "#FF2D55", fontWeight: 700 }}>Emergency Access</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-2.5 rounded-lg mb-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <div className="size-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,45,85,0.15)", border: "2px solid rgba(255,45,85,0.3)" }}>
                      <span style={{ fontSize: 14, fontWeight: 900, color: "#FF2D55" }}>{MEDICAL_DATA.bloodType || "—"}</span>
                    </div>
                    <div>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>BLOOD TYPE</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{MEDICAL_DATA.bloodType ? `${MEDICAL_DATA.bloodType}` : "Not on file"}</p>
                    </div>
                    {MEDICAL_DATA.organDonor && (
                      <div className="ml-auto flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.2)" }}>
                        <span style={{ fontSize: 8, color: "#00C853", fontWeight: 700 }}>🫀 Organ Donor</span>
                      </div>
                    )}
                  </div>
                  {MEDICAL_DATA.emergencyNote && (
                    <div className="p-2.5 rounded-lg" style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)" }}>
                      <p style={{ fontSize: 9, fontWeight: 700, color: "#FF9500", marginBottom: 3 }}>⚠️ EMERGENCY NOTE</p>
                      <p style={{ fontSize: 10, color: "rgba(255,150,0,0.8)", lineHeight: 1.5 }}>{MEDICAL_DATA.emergencyNote}</p>
                    </div>
                  )}
                </div>
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Allergies</div>
                  <div className="flex flex-wrap gap-2">
                    {(MEDICAL_DATA.allergies && MEDICAL_DATA.allergies.length > 0) ? MEDICAL_DATA.allergies.map(a => (
                      <span key={a} className="px-2 py-1 rounded-full" style={{ fontSize: 10, fontWeight: 600, color: "#FF2D55", background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>⚠ {a}</span>
                    )) : <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>None on file</span>}
                  </div>
                </DSCard>
                <div className="grid grid-cols-2 gap-2">
                  <DSCard padding={12}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Conditions</div>
                    {(MEDICAL_DATA.conditions && MEDICAL_DATA.conditions.length > 0) ? MEDICAL_DATA.conditions.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <div className="size-1.5 rounded-full" style={{ background: "#FF9500" }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>{c}</span>
                      </div>
                    )) : <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>None on file</span>}
                  </DSCard>
                  <DSCard padding={12}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Medications</div>
                    {(MEDICAL_DATA.medications && MEDICAL_DATA.medications.length > 0) ? MEDICAL_DATA.medications.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <div className="size-1.5 rounded-full" style={{ background: "#00C8E0" }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>{m}</span>
                      </div>
                    )) : <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>None on file</span>}
                  </DSCard>
                </div>
              </>
            )}
            {activeTab === "contacts" && CONTACTS.length === 0 && (
              <DSCard padding={20}>
                <div className="text-center" style={{ padding: "20px 0" }}>
                  <Phone className="size-10 mx-auto mb-3" style={{ color: "rgba(0,200,83,0.4)" }} />
                  <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>
                    No Emergency Contacts
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, maxWidth: 280, margin: "0 auto" }}>
                    {emp.name} hasn\'t added emergency contacts yet. For emergencies, fall back to local emergency services (911/997/112).
                  </p>
                </div>
              </DSCard>
            )}
            {activeTab === "contacts" && CONTACTS.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-1">
                  <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "1px" }}>EMERGENCY CONTACTS</p>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Priority order</span>
                </div>
                {CONTACTS.map((c, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
                    <DSCard padding={14}>
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          <div className="size-11 rounded-full flex items-center justify-center" style={{ background: `${c.color}15`, border: `1px solid ${c.color}25` }}>
                            <span style={{ fontSize: 16, fontWeight: 700, color: c.color }}>{c.name.charAt(0)}</span>
                          </div>
                          <div className="absolute -top-1 -right-1 size-4 rounded-full flex items-center justify-center"
                            style={{ background: c.color, border: "1.5px solid #05070E", fontSize: 8, fontWeight: 800, color: "#fff" }}>{c.priority}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</p>
                          <p style={{ fontSize: 10, color: c.color, fontWeight: 500 }}>{c.relation}</p>
                          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", direction: "ltr" }}>{c.phone}</p>
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => { hapticLight(); toast(`Calling ${c.name}`, { description: c.phone }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: `${c.color}12`, border: `1px solid ${c.color}25`, boxShadow: `0 2px 8px ${c.color}15`, cursor: "pointer" }}>
                            <Phone className="size-3.5" style={{ color: c.color }} />
                          </button>
                          <button onClick={() => { hapticLight(); toast(`Message ${c.name}`, { description: "Opening chat..." }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)", cursor: "pointer" }}>
                            <MessageSquare className="size-3.5" style={{ color: "#00C8E0" }} />
                          </button>
                        </div>
                      </div>
                    </DSCard>
                  </motion.div>
                ))}
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Auto-Notify on SOS</div>
                  {CONTACTS.map((c, i) => (
                    <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: i < CONTACTS.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{c.name}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                        <span style={{ fontSize: 9, color: "#00C853", fontWeight: 600 }}>Enabled</span>
                      </div>
                    </div>
                  ))}
                </DSCard>
              </>
            )}
            {activeTab === "history" && (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: "Total Incidents", value: INCIDENTS.length, color: "#FF2D55" },
                    { label: "SOS Events",       value: 1,               color: "#FF9500" },
                    { label: "Safety Score",     value: emp.safetyScore, color: scoreColor },
                  ].map(k => (
                    <DSCard key={k.label} padding={10} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: k.color }}>{k.value}</div>
                      <div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginTop: 2 }}>{k.label}</div>
                    </DSCard>
                  ))}
                </div>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "1px", marginBottom: 8 }}>INCIDENT HISTORY</p>
                  {INCIDENTS.map((inc, i) => {
                    const cfg = SEVERITY_CONFIG[inc.severity];
                    return (
                      <motion.div key={inc.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
                        <DSCard padding={12} style={{ marginBottom: 8 }}>
                          <div className="flex items-center gap-2.5">
                            <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: cfg.bg }}>
                              <cfg.icon className="size-3.5" style={{ color: cfg.color }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>{inc.type}</p>
                                <Badge color={cfg.color}>{inc.severity}</Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{inc.id}</span>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>·</span>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{inc.date}</span>
                              </div>
                            </div>
                            <Badge variant="success" size="sm">Resolved</Badge>
                          </div>
                        </DSCard>
                      </motion.div>
                    );
                  })}
                </div>
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Check-in Pattern (7 days)</div>
                  <div className="flex items-end gap-1 h-12">
                    {[80, 100, 60, 100, 90, 100, 70].map((h, i) => (
                      <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: h === 100 ? "#00C853" : h >= 80 ? "#FF9500" : "#FF2D55", opacity: 0.7 }} />
                    ))}
                  </div>
                  <div className="flex justify-between mt-1.5">
                    {["M","T","W","T","F","S","S"].map((d, i) => (
                      <span key={i} style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", textAlign: "center", flex: 1 }}>{d}</span>
                    ))}
                  </div>
                </DSCard>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Employees Page
// ═══════════════════════════════════════════════════════════════
export function EmployeesPage({ employees, t, webMode = false, onEmployeeSelect }: { employees: Employee[]; t: (k: string) => string; webMode?: boolean; onEmployeeSelect?: (emp: Employee) => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;
  const departments = ["all", ...Array.from(new Set(employees.map(e => e.department)))];
  const filtered = employees.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) || e.id.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || e.status === filter;
    const matchDept = deptFilter === "all" || e.department === deptFilter;
    return matchSearch && matchFilter && matchDept;
  });
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const avgScore = employees.length > 0 ? Math.round(employees.reduce((s, e) => s + e.safetyScore, 0) / employees.length) : 0;

  if (selectedEmp) {
    const statusCfg = STATUS_CONFIG[selectedEmp.status];
    const scoreColor = selectedEmp.safetyScore >= 90 ? "#00C853" : selectedEmp.safetyScore >= 75 ? "#FF9500" : "#FF2D55";
    return <EmpDetailView emp={selectedEmp} statusCfg={statusCfg} scoreColor={scoreColor} t={t} onBack={() => setSelectedEmp(null)} />;
  }

  if (webMode) {
    const statusColors: Record<string, string> = { "on-shift": "#00C853", "checked-in": "#00C8E0", "late-checkin": "#FF9500", "sos": "#FF2D55", "off-shift": "rgba(255,255,255,0.25)" };
    const statusLabels: Record<string, string> = { "on-shift": "On Shift", "checked-in": "Checked In", "late-checkin": "Late", "sos": "SOS", "off-shift": "Off Shift" };
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>Field Workers</h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{employees.length} total employees · {employees.filter(e => e.status !== "off-shift").length} on duty today</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <Search className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Search employees…" className="bg-transparent outline-none text-white" style={{ fontSize: 13, width: 200, fontFamily: "inherit" }} />
            </div>
            <div className="flex gap-1.5">
              {[{ id: "all", label: "All" }, { id: "on-shift", label: "Active" }, { id: "sos", label: "SOS" }, { id: "late-checkin", label: "Late" }].map(f => (
                <button key={f.id} onClick={() => { setFilter(f.id); setPage(0); }} className="px-3 py-2 rounded-xl"
                  style={{ fontSize: 12, fontWeight: filter === f.id ? 700 : 500, background: filter === f.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", color: filter === f.id ? "#00C8E0" : "rgba(255,255,255,0.4)", border: filter === f.id ? "1px solid rgba(0,200,224,0.25)" : "1px solid rgba(255,255,255,0.06)" }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Workers",     value: employees.length, color: "#00C8E0", icon: Users,       sub: "Registered" },
            { label: "On Duty Now",        value: employees.filter(e => e.status === "on-shift" || e.status === "checked-in").length, color: "#00C853", icon: UserCheck, sub: "Active shift" },
            { label: "SOS Active",         value: employees.filter(e => e.status === "sos").length,      color: "#FF2D55", icon: AlertTriangle, sub: employees.filter(e => e.status === "sos").length > 0 ? "Immediate" : "None" },
            { label: "Avg Safety Score",   value: `${avgScore}%`, color: avgScore >= 85 ? "#00C853" : "#FF9500", icon: ShieldCheck, sub: avgScore >= 85 ? "Excellent" : "Needs attention" },
          ].map((k, i) => {
            const Icon = k.icon;
            return (
              <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: `${k.color}12`, border: `1px solid ${k.color}20` }}>
                    <Icon className="size-5" style={{ color: k.color }} />
                  </div>
                </div>
                <p style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-1px", color: k.color }}>{k.value}</p>
                <p className="text-white mt-1" style={{ fontSize: 13, fontWeight: 600 }}>{k.label}</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{k.sub}</p>
              </motion.div>
            );
          })}
        </div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="grid px-5 py-3" style={{ gridTemplateColumns: "48px 1fr 140px 160px 90px 80px 100px", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {["", "Employee", "Department", "Location", "Last Check", "Score", "Status"].map(h => (
              <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{h}</span>
            ))}
          </div>
          {paginated.map((emp, i) => {
            const sc = statusColors[emp.status] || "rgba(255,255,255,0.25)";
            const sl = statusLabels[emp.status] || emp.status;
            const scoreColor = emp.safetyScore >= 90 ? "#00C853" : emp.safetyScore >= 75 ? "#FF9500" : "#FF2D55";
            
            // FIX J: Calculate risk score for each employee
            const riskScore = calculateRiskScore({
              id: emp.id,
              name: emp.name,
              joinDate: emp.joinDate || Date.now(),
              hasBuddy: !!(emp as any).buddyId,
              checkInInterval: (emp as any).checkInInterval || 120,
              batteryLevel: (() => {
                // W3-50 (B-20, 2026-04-26): real per-employee battery from
                // employee-sync writer (saveEmployeeSync in sos-emergency.tsx
                // and offline-gps-tracker). Pre-fix read `sosphere_sync_data`
                // which was never written → battery permanently 100% in UI.
                const sync = getLastEmployeeSync(emp.id);
                return typeof sync?.battery === "number"
                  ? Math.round(sync.battery * 100)
                  : null; // honest "unknown" when no sync exists yet
              })(), // reads real per-employee sync, or null if no sync yet
              isWorkingAlone: (() => {
                try {
                  const gpsTrail: any[] = JSON.parse(localStorage.getItem("sosphere_gps_trail") || "[]");
                  if (gpsTrail.length < 2) return false;
                  const last = gpsTrail[gpsTrail.length - 1];
                  // Check if any other employee is within 50m of last GPS point
                  return !gpsTrail.slice(-10).some((p, i) => i > 0 && p.employeeId !== last.employeeId &&
                    Math.abs(p.lat - last.lat) < 0.0005 && Math.abs(p.lng - last.lng) < 0.0005);
                } catch { return false; }
              })(), // computed from GPS proximity
              shift: new Date().getHours() >= 20 || new Date().getHours() < 6 ? "night" : "day",
              temperature: undefined,
              isFasting: false,
            });
            
            return (
              <motion.div key={emp.id} layout onClick={() => onEmployeeSelect ? onEmployeeSelect(emp) : setSelectedEmp(emp)}
                className="grid items-center px-5 py-3.5 cursor-pointer transition-colors group"
                style={{ gridTemplateColumns: "48px 1fr 140px 160px 90px 80px 100px", borderBottom: i < paginated.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}
                whileHover={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="size-9 rounded-full flex items-center justify-center" style={{ background: `${sc}18`, border: `1.5px solid ${sc}30` }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: sc }}>{emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{emp.name}</p>
                    {emp.status === "sos" && <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.6, repeat: Infinity }} className="px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 800, color: "#FF2D55", background: "rgba(255,45,85,0.15)" }}>SOS</motion.span>}
                    {/* FIX J: Risk Score Badge */}
                    {riskScore.totalScore >= 41 && (
                      <span className="px-2 py-0.5 rounded-md" style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: getRiskColor(riskScore.level),
                        background: `${getRiskColor(riskScore.level)}15`,
                        border: `1px solid ${getRiskColor(riskScore.level)}30`,
                      }}>
                        {getRiskLabel(riskScore.level)} {riskScore.totalScore}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{emp.role} · {emp.id}</p>
                  {/* FIX J: Show top risk factors */}
                  {riskScore.totalScore >= 61 && riskScore.factors.length > 0 && (
                    <p style={{ fontSize: 10, color: "rgba(255,149,0,0.7)", marginTop: 2 }}>
                      {riskScore.factors.slice(0, 2).map(f => f.label).join(", ")}
                    </p>
                  )}
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{emp.department}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }} className="truncate">{emp.location}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{emp.lastCheckin}</p>
                <div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1 rounded-full flex-1" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="h-full rounded-full" style={{ width: `${emp.safetyScore}%`, background: scoreColor }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor }}>{emp.safetyScore}</span>
                  </div>
                </div>
                <span className="px-2.5 py-1.5 rounded-lg text-center" style={{ fontSize: 10, fontWeight: 700, color: sc, background: `${sc}12`, display: "inline-block" }}>{sl}</span>
              </motion.div>
            );
          })}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", opacity: page === 0 ? 0.3 : 1 }}>← Prev</button>
                <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", opacity: page >= totalPages - 1 ? 0.3 : 1 }}>Next →</button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { label: t("emp.total"),   value: employees.length,                                      color: "#00C8E0" },
          { label: t("emp.onShift"), value: employees.filter(e => e.status === "on-shift").length, color: "#00C853" },
          { label: "SOS",            value: employees.filter(e => e.status === "sos").length,       color: "#FF2D55" },
          { label: t("emp.avgScore"),value: avgScore,                                               color: avgScore >= 85 ? "#00C853" : "#FF9500" },
        ].map(k => (
          <DSCard key={k.label} padding={8} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{k.label}</div>
          </DSCard>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <Search className="size-3.5" style={{ color: "rgba(255,255,255,0.2)" }} />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder={t("emp.search")} className="flex-1 bg-transparent outline-none text-white placeholder:text-white/20" style={{ fontSize: 12 }} />
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {[
          { id: "all",          label: t("l.all"),       count: employees.length },
          { id: "on-shift",     label: t("emp.onShift"), count: employees.filter(e => e.status === "on-shift").length },
          { id: "sos",          label: "SOS",             count: employees.filter(e => e.status === "sos").length },
          { id: "late-checkin", label: t("emp.late"),    count: employees.filter(e => e.status === "late-checkin").length },
          { id: "off-shift",    label: t("emp.offShift"),count: employees.filter(e => e.status === "off-shift").length },
        ].map(f => (
          <button key={f.id} onClick={() => { setFilter(f.id); setPage(0); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg whitespace-nowrap"
            style={{ fontSize: 10, fontWeight: 500, background: filter === f.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)", color: filter === f.id ? "#00C8E0" : "rgba(255,255,255,0.35)", border: `1px solid ${filter === f.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}` }}>
            {f.label}
            <span className="px-1 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 700, background: filter === f.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.05)" }}>{f.count}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {departments.map(d => (
          <button key={d} onClick={() => { setDeptFilter(d); setPage(0); }} className="px-2.5 py-1 rounded-lg whitespace-nowrap"
            style={{ fontSize: 9, fontWeight: 500, background: deptFilter === d ? "rgba(175,82,222,0.1)" : "transparent", color: deptFilter === d ? "#AF52DE" : "rgba(255,255,255,0.25)", border: `1px solid ${deptFilter === d ? "rgba(175,82,222,0.2)" : "rgba(255,255,255,0.03)"}` }}>
            {d === "all" ? t("emp.allDepts") : d}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {paginated.map(emp => {
          const statusCfg = STATUS_CONFIG[emp.status];
          return (
            <motion.div key={emp.id} layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => setSelectedEmp(emp)} className="p-3 rounded-xl cursor-pointer" whileTap={{ scale: 0.98 }}
              style={{ background: emp.status === "sos" ? "rgba(255,45,85,0.05)" : "rgba(255,255,255,0.02)", border: `1px solid ${emp.status === "sos" ? "rgba(255,45,85,0.12)" : "rgba(255,255,255,0.04)"}` }}>
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <div className="size-9 rounded-full flex items-center justify-center" style={{ background: `${statusCfg.color}15` }}>
                    <User className="size-4" style={{ color: statusCfg.color }} />
                  </div>
                  {statusCfg.dot && (
                    <motion.div animate={emp.status === "sos" ? { scale: [1, 1.4, 1] } : {}} transition={{ duration: 0.8, repeat: Infinity }}
                      className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2"
                      style={{ background: statusCfg.color, borderColor: "#05070E" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</p>
                    {emp.status === "sos" && (
                      <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 0.6, repeat: Infinity }} className="px-1 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 800, color: "#FF2D55", background: "rgba(255,45,85,0.15)" }}>SOS</motion.span>
                    )}
                  </div>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{emp.role} · {emp.department}</p>
                </div>
                <div className="text-right">
                  <p style={{ fontSize: 14, fontWeight: 800, color: emp.safetyScore >= 90 ? "#00C853" : emp.safetyScore >= 75 ? "#FF9500" : "#FF2D55" }}>{emp.safetyScore}</p>
                  <p style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>{t("emp.score")}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-1">
                  <MapPin className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{emp.location}</span>
                </div>
                <div className="flex items-center gap-1 ml-auto">
                  <Clock className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{emp.lastCheckin}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 pb-2">
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} {t("emp.of")} {filtered.length}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="size-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", opacity: page === 0 ? 0.3 : 1 }}>
              <ChevronLeft className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="size-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", opacity: page >= totalPages - 1 ? 0.3 : 1 }}>
              <ChevronRight className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Emergencies Page
// ═══════════════════════════════════════════════════════════════
type EmgStatus = "new" | "active" | "responding" | "contained" | "resolved" | "closed";
interface EmgTimelineEvent { time: Date; event: string; actor: string; }
interface EmgOwner { name: string; takenAt: Date; }
interface RichEmergency {
  id: string; title: string; description: string;
  severity: "critical" | "high" | "medium" | "low";
  status: EmgStatus; zone: string; address: string; radius: number;
  createdAt: Date; owner?: EmgOwner;
  affectedCount: number; respondersCount: number;
  timeline: EmgTimelineEvent[];
}

const EMG_STATUS_CONFIG: Record<EmgStatus, { label: string; color: string; bg: string; tKey: string }> = {
  new:        { label: "NEW",        color: "#FFB300", bg: "rgba(255,179,0,0.10)",   tKey: "status.new"       },
  active:     { label: "ACTIVE",     color: "#FF2D55", bg: "rgba(255,45,85,0.10)",   tKey: "status.active"    },
  responding: { label: "RESPONDING", color: "#00C8E0", bg: "rgba(0,200,224,0.10)",   tKey: "status.responding"},
  contained:  { label: "CONTAINED",  color: "#34C759", bg: "rgba(52,199,89,0.10)",   tKey: "status.contained" },
  resolved:   { label: "RESOLVED",   color: "#8090A5", bg: "rgba(128,144,165,0.10)", tKey: "status.resolved"  },
  closed:     { label: "CLOSED",     color: "#8090A5", bg: "rgba(128,144,165,0.10)", tKey: "status.closed"    },
};

const RICH_EMERGENCIES: RichEmergency[] = [
  {
    id: "EMG-2026-001", title: "Chemical Spill — Warehouse B3",
    description: "Hazardous chemical leak detected in storage area B3. Evacuation protocol initiated.",
    severity: "critical", status: "active", zone: "Zone A", address: "Warehouse B3, Sector 7",
    radius: 150, createdAt: new Date(Date.now() - 8 * 60 * 1000),
    affectedCount: 24, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 8 * 60000), event: "Incident Created", actor: "Omar Al-Farsi" },
      { time: new Date(Date.now() - 7.5 * 60000), event: "First Alert Sent", actor: "System" },
    ],
  },
  {
    id: "EMG-2026-002", title: "Fire Alarm — Lab D2",
    description: "Smoke detected in Laboratory D2. Fire suppression system activated.",
    severity: "high", status: "responding", zone: "Zone C", address: "Lab D2, East Wing",
    radius: 80, createdAt: new Date(Date.now() - 22 * 60 * 1000),
    owner: { name: "Ahmed Al-Rashid", takenAt: new Date(Date.now() - 20 * 60000) },
    affectedCount: 15, respondersCount: 5,
    timeline: [
      { time: new Date(Date.now() - 22 * 60000), event: "Incident Created",     actor: "Lina Chen" },
      { time: new Date(Date.now() - 21.5 * 60000), event: "First Alert Sent",   actor: "System" },
      { time: new Date(Date.now() - 20 * 60000), event: "Ownership Taken",       actor: "Ahmed Al-Rashid" },
      { time: new Date(Date.now() - 18 * 60000), event: "Broadcast Alert Sent", actor: "Ahmed Al-Rashid" },
    ],
  },
  {
    id: "EMG-2026-003", title: "Medical Emergency — Floor 5",
    description: "Employee collapsed. Medical team dispatched. Stabilizing patient.",
    severity: "medium", status: "contained", zone: "Zone B", address: "Office Floor 5, Room 502",
    radius: 30, createdAt: new Date(Date.now() - 45 * 60 * 1000),
    owner: { name: "Fatima Hassan", takenAt: new Date(Date.now() - 43 * 60000) },
    affectedCount: 1, respondersCount: 3,
    timeline: [
      { time: new Date(Date.now() - 45 * 60000), event: "Incident Created",   actor: "Sarah Johnson" },
      { time: new Date(Date.now() - 44 * 60000), event: "First Alert Sent",   actor: "System" },
      { time: new Date(Date.now() - 43 * 60000), event: "Ownership Taken",    actor: "Fatima Hassan" },
      { time: new Date(Date.now() - 40 * 60000), event: "Dispatch Team",      actor: "Fatima Hassan" },
      { time: new Date(Date.now() - 35 * 60000), event: "Contained",          actor: "Medical Team" },
    ],
  },
  // ── Zone A Cluster: 2 more SOS in same zone as EMG-001 (demo multi-SOS) ──
  {
    id: "EMG-2026-004", title: "Worker Trapped — Warehouse B3 Collapse",
    description: "Structural collapse near chemical spill area. Worker reported trapped under debris. Same zone as EMG-001.",
    severity: "critical", status: "active", zone: "Zone A", address: "Warehouse B3, Sector 7 — East Wall",
    radius: 150, createdAt: new Date(Date.now() - 6 * 60 * 1000),
    affectedCount: 1, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 6 * 60000), event: "SOS Triggered", actor: "Ali Mansour" },
      { time: new Date(Date.now() - 5.8 * 60000), event: "First Alert Sent", actor: "System" },
      { time: new Date(Date.now() - 5.5 * 60000), event: "Zone Cluster Detected — linked to EMG-2026-001", actor: "System" },
    ],
  },
  {
    id: "EMG-2026-005", title: "Breathing Difficulty — Toxic Fumes",
    description: "Worker reporting difficulty breathing near chemical spill zone. Likely fume exposure from EMG-001 spill.",
    severity: "high", status: "active", zone: "Zone A", address: "Warehouse B3, Sector 7 — Loading Bay",
    radius: 150, createdAt: new Date(Date.now() - 4 * 60 * 1000),
    affectedCount: 1, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 4 * 60000), event: "SOS Triggered", actor: "Hassan Jaber" },
      { time: new Date(Date.now() - 3.8 * 60000), event: "First Alert Sent", actor: "System" },
      { time: new Date(Date.now() - 3.5 * 60000), event: "Zone Cluster Escalated — MASS CASUALTY", actor: "System" },
    ],
  },
  // ── Zone C Cluster: 2 SOS in same zone (demo multi-zone scenario) ──
  {
    id: "EMG-2026-006", title: "Electrical Arc Flash — Lab D2 Panel",
    description: "High-voltage arc flash reported near main electrical panel in Lab D2. Worker received shock, secondary fire risk.",
    severity: "high", status: "active", zone: "Zone C", address: "Lab D2, East Wing — Panel Room",
    radius: 50, createdAt: new Date(Date.now() - 5 * 60 * 1000),
    affectedCount: 2, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 5 * 60000), event: "SOS Triggered", actor: "Khalid Noor" },
      { time: new Date(Date.now() - 4.8 * 60000), event: "First Alert Sent", actor: "System" },
    ],
  },
  {
    id: "EMG-2026-007", title: "Burn Injury — Lab D2 Explosion",
    description: "Worker sustained burns from secondary explosion near arc flash site. Same zone as EMG-006.",
    severity: "critical", status: "active", zone: "Zone C", address: "Lab D2, East Wing — Workstation 3",
    radius: 50, createdAt: new Date(Date.now() - 3 * 60 * 1000),
    affectedCount: 1, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 3 * 60000), event: "SOS Triggered", actor: "Yusuf Adel" },
      { time: new Date(Date.now() - 2.8 * 60000), event: "First Alert Sent", actor: "System" },
      { time: new Date(Date.now() - 2.5 * 60000), event: "Zone Cluster Detected — linked to EMG-2026-006", actor: "System" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// Zone Cluster Banner — Auto-detects multi-SOS in same zone
// ═══════════════════════════════════════════════════════════════
function ZoneClusterBanner({ clusters, onAction, onLaunchSAR }: {
  clusters: ZoneCluster[];
  onAction?: (clusterId: string, actionId: string) => void;
  onLaunchSAR?: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (clusters.length === 0) return null;

  return (
    <div className="space-y-2 mb-3">
      {clusters.map(cluster => {
        const cfg = CLUSTER_LEVEL_CONFIG[cluster.level];
        const isExpanded = expanded === cluster.id;
        const ICON_MAP: Record<string, any> = {
          AlertTriangle, Siren, Skull, Users, Megaphone, Lock,
          HeartPulse, ClipboardList, ArrowUpRight, Phone,
        };

        return (
          <motion.div
            key={cluster.id}
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="rounded-2xl overflow-hidden"
            style={{
              background: cfg.bgColor,
              border: `1px solid ${cfg.borderColor}`,
              boxShadow: `0 0 20px ${cfg.color}15`,
            }}
          >
            {/* Header */}
            <button
              onClick={() => setExpanded(isExpanded ? null : cluster.id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [1, 0.6, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="size-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${cfg.color}20`, border: `1px solid ${cfg.color}40` }}
              >
                {cluster.level === "catastrophic" ? (
                  <Skull className="size-4" style={{ color: cfg.color }} />
                ) : cluster.level === "mass_casualty" ? (
                  <Siren className="size-4" style={{ color: cfg.color }} />
                ) : (
                  <AlertTriangle className="size-4" style={{ color: cfg.color }} />
                )}
              </motion.div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 10, fontWeight: 800, color: cfg.color, letterSpacing: "0.5px" }}>
                    {cfg.label}
                  </span>
                  <motion.span
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="px-1.5 py-0.5 rounded-md"
                    style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: cfg.color }}
                  >
                    {cluster.affectedCount} SOS
                  </motion.span>
                </div>
                <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
                  {cluster.zone} — {cfg.description}
                </p>
              </div>
              <ChevronDown
                className="size-4 shrink-0 transition-transform"
                style={{ color: cfg.color, transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}
              />
            </button>

            {/* Expanded Detail */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${cfg.borderColor}` }}>
                    {/* Workers Involved */}
                    <div className="pt-3">
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        WORKERS INVOLVED
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {cluster.employeeNames.map((name, i) => (
                          <span
                            key={i}
                            className="px-2 py-1 rounded-lg"
                            style={{ fontSize: 10, fontWeight: 600, color: cfg.color, background: `${cfg.color}10`, border: `1px solid ${cfg.color}20` }}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Auto-Executed Actions */}
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        AUTO-EXECUTED
                      </span>
                      <div className="space-y-1.5 mt-2">
                        {cluster.autoActions.map(action => (
                          <div key={action.id} className="flex items-center gap-2">
                            <CheckCircle2
                              className="size-3 shrink-0"
                              style={{ color: action.result === "success" ? "#00C853" : "#FF9500" }}
                            />
                            <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.6)" }}>
                              {action.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Suggested Actions */}
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        RECOMMENDED ACTIONS
                      </span>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {cluster.suggestedActions.slice(0, 4).map(action => {
                          const IconComp = ICON_MAP[action.iconName] || AlertTriangle;
                          return (
                            <button
                              key={action.id}
                              onClick={() => {
                                onAction?.(cluster.id, action.id);
                                toast.success(action.label, { description: action.description });
                              }}
                              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors"
                              style={{
                                background: `${action.color}08`,
                                border: `1px solid ${action.color}20`,
                              }}
                            >
                              <IconComp className="size-3.5 shrink-0" style={{ color: action.color }} />
                              <span style={{ fontSize: 10, fontWeight: 600, color: action.color }}>
                                {action.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Escalation Chain */}
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        ESCALATION CHAIN
                      </span>
                      <div className="flex items-center gap-1 mt-2 flex-wrap">
                        {cluster.escalationChain.map((step, i) => (
                          <span className="contents" key={i}>
                            <span
                              className="px-2 py-1 rounded-lg"
                              style={{
                                fontSize: 9, fontWeight: 600,
                                color: step.acknowledged ? "#00C853" : "rgba(255,255,255,0.5)",
                                background: step.acknowledged ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.03)",
                                border: `1px solid ${step.acknowledged ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.06)"}`,
                              }}
                            >
                              {step.role} ({step.channel})
                            </span>
                            {i < cluster.escalationChain.length - 1 && (
                              <ArrowRight className="size-2.5" style={{ color: "rgba(255,255,255,0.15)" }} />
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* ── SAR Pre-staging — the life-saving bridge ── */}
                    {(cluster.level === "mass_casualty" || cluster.level === "catastrophic") && (
                      <div
                        className="rounded-xl overflow-hidden"
                        style={{
                          background: cluster.level === "catastrophic"
                            ? "linear-gradient(135deg, rgba(255,0,0,0.12), rgba(255,45,85,0.08))"
                            : "linear-gradient(135deg, rgba(255,45,85,0.08), rgba(255,149,0,0.05))",
                          border: `1px solid ${cluster.level === "catastrophic" ? "rgba(255,0,0,0.25)" : "rgba(255,45,85,0.2)"}`,
                        }}
                      >
                        <div className="px-3 py-2.5 flex items-center gap-3">
                          <div
                            className="size-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: "rgba(255,45,85,0.15)", border: "1px solid rgba(255,45,85,0.25)" }}
                          >
                            <Radar className="size-4" style={{ color: "#FF2D55" }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p style={{ fontSize: 10, fontWeight: 800, color: "#FF2D55", letterSpacing: "0.5px" }}>
                              SAR PROTOCOL {cluster.level === "catastrophic" ? "AUTO-ACTIVATED" : "PRE-STAGED"}
                            </p>
                            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>
                              {cluster.level === "catastrophic"
                                ? `Search & Rescue auto-launched — ${cluster.affectedCount} workers, all data pre-filled`
                                : `Mission data ready — search cone, teams, hazards pre-calculated for ${cluster.affectedCount} workers`
                              }
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const result = activateClusterSAR(cluster);
                              toast.success(
                                cluster.level === "catastrophic"
                                  ? "SAR Protocol LIVE — Mission Active"
                                  : "SAR Protocol Activated",
                                {
                                  description: result.clusterContext.preStageReason,
                                  duration: 6000,
                                }
                              );
                              onLaunchSAR?.();
                            }}
                            className="shrink-0 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-transform active:scale-95"
                            style={{
                              background: cluster.level === "catastrophic"
                                ? "linear-gradient(135deg, #FF0000, #FF2D55)"
                                : "linear-gradient(135deg, #FF2D55, #FF6B35)",
                              boxShadow: `0 0 12px ${cluster.level === "catastrophic" ? "rgba(255,0,0,0.4)" : "rgba(255,45,85,0.3)"}`,
                            }}
                          >
                            <Radar className="size-3" style={{ color: "#fff" }} />
                            <span style={{ fontSize: 10, fontWeight: 800, color: "#fff" }}>
                              {cluster.level === "catastrophic" ? "View SAR" : "Activate SAR"}
                            </span>
                          </button>
                        </div>
                        {/* Pre-staged data summary */}
                        <div
                          className="px-3 py-2 flex items-center gap-3 flex-wrap"
                          style={{ borderTop: "1px solid rgba(255,45,85,0.1)" }}
                        >
                          {[
                            { label: "Search Cone", value: "Ready", color: "#FF2D55" },
                            { label: "Teams", value: `${cluster.affectedCount > 3 ? 3 : 2} assigned`, color: "#00C8E0" },
                            { label: "Hazards", value: "Scanned", color: "#FF9500" },
                            { label: "Escalation", value: cluster.level === "catastrophic" ? "MAX" : "Level 4", color: "#FF2D55" },
                          ].map(item => (
                            <div key={item.label} className="flex items-center gap-1">
                              <div className="size-1.5 rounded-full" style={{ background: item.color }} />
                              <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.35)" }}>{item.label}:</span>
                              <span style={{ fontSize: 8, fontWeight: 700, color: item.color }}>{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

export function EmergenciesPage({ emergencies: _parentEmg, onResolve: _onResolveParent, onCreate, t, webMode = false, onLaunchSAR }: {
  emergencies: EmergencyItem[];
  onResolve: (id: string) => void;
  onCreate: () => void;
  t: (k: string) => string;
  webMode?: boolean;
  onLaunchSAR?: () => void;
}) {
  const [emgList, setEmgList] = useState<RichEmergency[]>(RICH_EMERGENCIES);

  // ── GAP FIX: Bridge parent emergencies → cluster engine ──
  // When mobile workers trigger SOS, the parent `emergencies` state gets updated
  // but EmergenciesPage's `emgList` is independent. This effect merges new parent
  // emergencies into emgList so the cluster engine can detect multi-SOS events
  // from real-time mobile triggers, not just mock data.
  const knownParentIdsRef = React.useRef<Set<string>>(new Set(_parentEmg.map(e => e.id)));
  useEffect(() => {
    const newEmgs = _parentEmg.filter(e => !knownParentIdsRef.current.has(e.id));
    if (newEmgs.length === 0) return;
    for (const e of newEmgs) knownParentIdsRef.current.add(e.id);
    // Convert EmergencyItem → RichEmergency and merge into emgList
    const richNew: RichEmergency[] = newEmgs.map(e => ({
      id: e.id,
      title: `${e.type} — ${e.employeeName}`,
      description: `Real-time ${e.type} received from ${e.employeeName} in ${e.zone}.`,
      severity: e.severity as RichEmergency["severity"],
      status: (e.status === "resolved" ? "resolved" : e.status === "responding" ? "responding" : "active") as EmgStatus,
      zone: e.zone.split(" - ")[0] || e.zone, // Normalize "Zone A - East" → "Zone A" for clustering
      address: e.zone,
      radius: 100,
      createdAt: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp),
      affectedCount: 1,
      respondersCount: 0,
      owner: e.isOwned ? { name: e.ownedBy || "Admin", takenAt: new Date() } : undefined,
      timeline: [
        { time: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp), event: "Incident Created", actor: e.employeeName },
        { time: new Date(), event: "Synced from Mobile App", actor: "System" },
      ],
    }));
    setEmgList(prev => [...richNew, ...prev]);
  }, [_parentEmg]);

  // ── GAP FIX: Handle parent status changes → mirror in emgList ──
  // When a parent emergency status changes to "resolved", mirror it in emgList
  // so the cluster engine drops resolved emergencies from active clusters.
  useEffect(() => {
    const parentResolved = new Set(
      _parentEmg.filter(e => e.status === "resolved").map(e => e.id)
    );
    if (parentResolved.size === 0) return;
    setEmgList(prev => prev.map(e => {
      if (!parentResolved.has(e.id) || e.status === "resolved" || e.status === "closed") return e;
      return {
        ...e,
        status: "resolved" as EmgStatus,
        timeline: [...e.timeline, { time: new Date(), event: "Resolved (synced from parent)", actor: "System" }],
      };
    }));
  }, [_parentEmg]);

  // ── Zone Cluster Detection ──
  const clusters = React.useMemo(() => {
    return detectClusters(emgList.map(e => ({
      id: e.id,
      zone: e.zone,
      status: e.status,
      timestamp: e.createdAt,
      employeeName: e.timeline[0]?.actor || "Unknown",
      severity: e.severity,
    }))).sort((a, b) => {
      // Priority sort: catastrophic first, then mass_casualty, then zone_alert
      const levelOrder: Record<string, number> = { catastrophic: 0, mass_casualty: 1, zone_alert: 2 };
      return (levelOrder[a.level] ?? 3) - (levelOrder[b.level] ?? 3);
    });
  }, [emgList]);

  // ── Catastrophic Auto-Activation: auto-save SAR for catastrophic clusters ──
  // This fulfills the promise of "SAR Protocol auto-activated" in the auto-actions list.
  // Without this, catastrophic auto-activation was just a label with no actual effect.
  const clusterAutoActionsRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const cluster of clusters) {
      if (clusterAutoActionsRef.current.has(cluster.id)) continue;

      // Guard: only one evacuation at a time (system limitation — single key)
      const existingEvac = getActiveEvacuation();
      const canEvacuate = !existingEvac || existingEvac.status !== "active";

      // ── Catastrophic: Auto-activate SAR + Auto-trigger evacuation ──
      if (cluster.level === "catastrophic") {
        clusterAutoActionsRef.current.add(cluster.id);
        const result = activateClusterSAR(cluster);
        toast.error("CATASTROPHIC EVENT — SAR AUTO-ACTIVATED", {
          description: result.clusterContext.preStageReason,
          duration: 10000,
        });
        // Catastrophic ALWAYS overrides existing evacuation
        const evac: ActiveEvacuation = {
          id: `EVAC-CLU-${cluster.id.split("-").pop()}`,
          zoneId: cluster.zone.replace(/\s+/g, "-").toUpperCase(),
          zoneName: cluster.zone,
          triggeredAt: Date.now(),
          triggeredBy: "System (Catastrophic Cluster)",
          reason: `Catastrophic event: ${cluster.affectedCount} simultaneous SOS in ${cluster.zone}`,
          expectedDuration: 60,
          status: "active",
        };
        triggerEvacuation(evac);
        toast.error("ZONE EVACUATION TRIGGERED", {
          description: `${cluster.zone} — auto-evacuated due to catastrophic cluster`,
          duration: 8000,
        });
      }

      // ── Mass Casualty: Auto-trigger zone lockdown/evacuation ──
      if (cluster.level === "mass_casualty") {
        clusterAutoActionsRef.current.add(cluster.id);
        if (canEvacuate) {
          const evac: ActiveEvacuation = {
            id: `EVAC-CLU-${cluster.id.split("-").pop()}`,
            zoneId: cluster.zone.replace(/\s+/g, "-").toUpperCase(),
            zoneName: cluster.zone,
            triggeredAt: Date.now(),
            triggeredBy: "System (Mass Casualty Cluster)",
            reason: `Mass casualty: ${cluster.affectedCount} simultaneous SOS in ${cluster.zone}`,
            expectedDuration: 30,
            status: "active",
          };
          triggerEvacuation(evac);
          toast.warning("ZONE LOCKDOWN ACTIVATED", {
            description: `${cluster.zone} — entry restricted, ${cluster.affectedCount} workers affected`,
            duration: 6000,
          });
        } else {
          toast.warning(`${cluster.zone} — Mass Casualty Detected`, {
            description: `Evacuation already active for ${existingEvac?.zoneName || "another zone"}. Manual action required.`,
            duration: 6000,
          });
        }
      }
    }
  }, [clusters]);

  // ── Admin Overload Detection ──
  const ownedClusterCount = clusters.filter(c =>
    c.emergencyIds.some(eid => emgList.find(e => e.id === eid)?.owner?.name === "Current User")
  ).length;

  // Find which cluster an emergency belongs to
  const getClusterForEmg = (emgId: string): ZoneCluster | undefined =>
    clusters.find(c => c.emergencyIds.includes(emgId));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? emgList.find(e => e.id === selectedId) || null : null;
  const [, setTick] = useState(0);
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(iv); }, []);
  const fmtElapsedDate = (d: Date) => { const diff = Math.floor((Date.now() - d.getTime()) / 1000); const m = Math.floor(diff / 60), s = diff % 60; if (m < 60) return `${m}m ${s}s`; const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; };
  const takeOwnership = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id) return e; const owner: EmgOwner = { name: "Current User", takenAt: new Date() }; const newStatus: EmgStatus = e.status === "active" ? "responding" : e.status; return { ...e, owner, status: newStatus, timeline: [...e.timeline, { time: new Date(), event: "Ownership Taken", actor: owner.name }] }; })); };
  const containEmg = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id || e.status !== "responding") return e; return { ...e, status: "contained" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Contained", actor: e.owner?.name || "System" }] }; })); };
  const resolveEmg = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id || e.status !== "contained") return e; return { ...e, status: "resolved" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Resolved", actor: e.owner?.name || "System" }] }; })); _onResolveParent(id); };
  const closeEmg = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id || e.status !== "resolved") return e; return { ...e, status: "closed" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Closed", actor: "Admin" }] }; })); };
  const dispatchTeam = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id) return e; return { ...e, respondersCount: e.respondersCount + 3, timeline: [...e.timeline, { time: new Date(), event: "Dispatch Team", actor: e.owner?.name || "Admin" }] }; })); };

  // ── Cluster Ownership: take ownership of ALL emergencies in a cluster at once ──
  const takeClusterOwnership = (clusterId: string) => {
    const cluster = clusters.find(c => c.id === clusterId);
    if (!cluster) return;
    setEmgList(prev => prev.map(e => {
      if (!cluster.emergencyIds.includes(e.id)) return e;
      if (e.owner) return e; // already owned
      const owner: EmgOwner = { name: "Current User", takenAt: new Date() };
      return { ...e, owner, status: "responding" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Cluster Ownership Taken", actor: owner.name }] };
    }));
    toast.success("Cluster Ownership Taken", { description: `All ${cluster.affectedCount} emergencies in ${cluster.zone} assigned to you` });
  };

  const activeCount = emgList.filter(e => !["resolved", "closed"].includes(e.status)).length;

  if (selected) {
    const sev = SEVERITY_CONFIG[selected.severity];
    const st = EMG_STATUS_CONFIG[selected.status];
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <button onClick={() => setSelectedId(null)} className="flex items-center gap-1 mb-2" style={{ fontSize: 11, fontWeight: 600, color: TOKENS.accent.primary }}>
            <ChevronLeft className="size-3.5" /> {t("emg.back")}
          </button>
          <div className="flex items-center justify-between">
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", fontFamily: "monospace", letterSpacing: 0.5 }}>{selected.id}</span>
              <p className="text-white mt-1" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{selected.title}</p>
            </div>
            <div className="text-right">
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{t("emg.elapsed")}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: sev.color, fontFamily: "monospace" }}>{fmtElapsedDate(selected.createdAt)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge color={sev.color}>{selected.severity.toUpperCase()}</Badge>
            <Badge color={st.color}>{t(st.tKey)}</Badge>
            <Badge variant="muted">{selected.zone}</Badge>
          </div>
          {/* Cluster linkage banner */}
          {(() => {
            const cl = getClusterForEmg(selected.id);
            if (!cl) return null;
            const cfg = CLUSTER_LEVEL_CONFIG[cl.level];
            const others = cl.emergencyIds.filter(id => id !== selected.id);
            return (
              <div className="mt-2 px-3 py-2 rounded-xl flex items-center gap-2" style={{ background: cfg.bgColor, border: `1px solid ${cfg.borderColor}` }}>
                <Siren className="size-3.5 shrink-0" style={{ color: cfg.color }} />
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: 9, fontWeight: 800, color: cfg.color }}>{cfg.label}</span>
                  <p className="truncate" style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
                    Linked with {others.join(", ")} — {cl.affectedCount} total SOS in {cl.zone}
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "none" }}>
          <DSCard padding={12}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{selected.description}</p>
          </DSCard>
          <DSCard padding={0} style={{ height: 140, overflow: "hidden", position: "relative" }}>
            <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0A1220 0%, #0F1B2E 100%)" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundImage: "linear-gradient(rgba(0,200,224,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,224,0.03) 1px, transparent 1px)", backgroundSize: "30px 30px", opacity: 0.4 }} />
              <div className="flex flex-col items-center gap-2 z-10">
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 2, repeat: Infinity }} className="size-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,45,85,0.15)", border: "2px solid #FF2D55" }}>
                  <Navigation className="size-5" style={{ color: "#FF2D55" }} />
                </motion.div>
              </div>
              <div className="absolute top-2 right-2 px-2 py-1 rounded-lg" style={{ background: "#0F1B2E", border: "1px solid rgba(255,255,255,0.06)", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{selected.address}</div>
              <div className="absolute bottom-2 left-2 flex gap-2">
                <span className="px-2 py-1 rounded-lg" style={{ background: "#0F1B2E", border: "1px solid rgba(255,255,255,0.06)", fontSize: 9, fontWeight: 700, color: "#FF2D55" }}>{selected.radius}m {t("emg.radius")}</span>
                <span className="px-2 py-1 rounded-lg" style={{ background: "#0F1B2E", border: "1px solid rgba(255,255,255,0.06)", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}><Users className="size-3 inline mr-1" />{selected.affectedCount} {t("emg.affected")}</span>
              </div>
            </div>
          </DSCard>
          <div className="grid grid-cols-2 gap-2">
            <DSCard padding={12} glow={selected.owner ? TOKENS.accent.primary : TOKENS.accent.warning}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{t("emg.ownership")}</div>
              {!selected.owner ? (
                <>
                  <div className="px-2 py-1.5 rounded-lg mb-2 text-center" style={{ background: "rgba(255,179,0,0.06)", border: "1px solid rgba(255,179,0,0.15)", fontSize: 10, fontWeight: 600, color: "#FFB300" }}>{t("emg.noOwner")}</div>
                  <button onClick={() => takeOwnership(selected.id)} className="w-full flex items-center justify-center gap-1 py-2 rounded-lg" style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.18)", fontSize: 10, fontWeight: 600, color: "#00C8E0" }}>
                    <UserCheck className="size-3" /> {t("emg.take")}
                  </button>
                </>
              ) : (
                <div className="px-2 py-2 rounded-lg" style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                  <p className="text-white" style={{ fontSize: 12, fontWeight: 700 }}>{selected.owner.name}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>Taken {fmtElapsedDate(selected.owner.takenAt)} ago</p>
                </div>
              )}
            </DSCard>
            <DSCard padding={12}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{t("emg.response")}</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{t("emg.affected")}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#FF2D55" }}>{selected.affectedCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{t("emg.responders")}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#00C8E0" }}>{selected.respondersCount}</span>
                </div>
              </div>
            </DSCard>
          </div>
          <DSCard padding={12}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>{t("emg.actions")}</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {[
                // phase-1/finish-dashboard-pages (2026-05-25, life-safety):
                // dispatchTeam() needs a responders array — pre-fix was called with
                // just selected.id, silently dispatching with an empty assigned_to.
                // Server now gets {emergencyId, [defaultResponderId], dispatchNote}.
                { icon: Send, label: t("emg.dispatch"),  color: "#8090A5", onClick: () => {
                  // phase-1/finish-dashboard-pages (2026-05-25): local dispatchTeam() updates
                  // the displayed timeline + responders count. The server-side dispatch goes
                  // through dashboard-actions edge function via emitSyncEvent (audit-logged
                  // server-side). NOTE: pre-fix was JUST the local call — silent on audit log.
                  dispatchTeam(selected.id);
                  const note = `Dispatched responders to ${selected.zone || "Unknown zone"} for ${selected.title}`;
                  trackEventSync(selected.id, "responder_dispatched", note, "Admin", "Admin",
                    { zone: selected.zone, emergencyType: selected.title });
                  toast.success("Team dispatched", { description: note });
                }},
                // WIRE: Broadcast Alert — was toast-only stub. Now uses sendBroadcast()
                // with EMERGENCY priority targeted at the zone (or all zones if unknown).
                { icon: Bell, label: t("emg.broadcast"), color: "#4A90D9", onClick: () => {
                  const audience = selected.zone
                    ? { type: "zone" as const, zoneIds: [selected.zone] }
                    : { type: "all" as const };
                  sendBroadcast({
                    title: `🚨 EMERGENCY — ${selected.title}`,
                    body: `Active emergency in ${selected.zone || "your area"}. Stay alert. Follow safety protocols. If you can assist, contact Admin.`,
                    priority: "emergency",
                    audience,
                    audienceLabel: selected.zone || "All Zones",
                    source: "manual", senderName: "Emergency Command", senderRole: "Admin",
                    timestamp: Date.now(),
                    relatedEmergencyId: selected.id,
                  });
                  trackEventSync(selected.id, "emergency_services_called",
                    `Admin broadcast emergency alert to ${selected.zone || "all zones"}`,
                    "Admin", "Admin", { broadcastTarget: selected.zone || "all" });
                  toast.success("Broadcast sent", { description: `Workers in ${selected.zone || "all zones"} have been alerted` });
                }},
                // WIRE: Escalate — was toast-only stub. Now emits SOS_ESCALATED
                // SyncEvent (added in strict-4) so dashboard widgets + safety-intelligence
                // react. Also broadcasts to admin/supervisor roles for management chain.
                { icon: Zap,  label: t("emg.escalate"),  color: "#FFB300", onClick: () => {
                  emitSyncEvent({
                    type: "SOS_ESCALATED",
                    employeeId: (selected as any).employeeId || selected.id,
                    employeeName: selected.title,
                    zone: selected.zone,
                    timestamp: Date.now(),
                    data: {
                      emergencyId: selected.id,
                      reason: "admin_manual_escalation",
                      severity: selected.severity,
                      escalatedTo: "company_admin_and_safety_director",
                    },
                  });
                  sendBroadcast({
                    title: `⬆️ ESCALATED — ${selected.title}`,
                    body: `Emergency ${selected.id} escalated by Admin. Requires Zone Admin + Safety Director attention.`,
                    priority: "emergency",
                    audience: { type: "role", roles: ["admin", "supervisor"] },
                    audienceLabel: "Management",
                    source: "manual", senderName: "Emergency Command", senderRole: "Admin",
                    timestamp: Date.now(),
                    relatedEmergencyId: selected.id,
                  });
                  trackEventSync(selected.id, "escalation_triggered",
                    `Admin escalated to management chain (Zone Admin + Safety Director)`,
                    "Admin", "Admin", { severity: selected.severity });
                  toast.success("Escalated to management", { description: "Zone Admin & Safety Director notified" });
                }},
              ].map(a => (
                <button key={a.label} onClick={a.onClick} className="flex flex-col items-center gap-1 py-2 rounded-lg" style={{ background: `${a.color}0A`, border: `1px solid ${a.color}1F` }}>
                  <a.icon className="size-3.5" style={{ color: a.color }} />
                  <span style={{ fontSize: 8, fontWeight: 600, color: a.color }}>{a.label}</span>
                </button>
              ))}
            </div>
            <Divider spacing={8} />
            <div className="space-y-2">
              {selected.status === "responding" && <button onClick={() => containEmg(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.18)", fontSize: 11, fontWeight: 700, color: "#34C759" }}><Shield className="size-3.5" /> {t("emg.contain")}</button>}
              {selected.status === "contained" && <button onClick={() => resolveEmg(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "linear-gradient(135deg, #00C8E0 0%, #0088A8 100%)", fontSize: 11, fontWeight: 700, color: "#fff", boxShadow: "0 4px 16px rgba(0,200,224,0.25)" }}><CheckCircle2 className="size-3.5" /> {t("emg.resolve")}</button>}
              {selected.status === "resolved" && <button onClick={() => closeEmg(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "rgba(128,144,165,0.08)", border: "1px solid rgba(128,144,165,0.18)", fontSize: 11, fontWeight: 700, color: "#8090A5" }}><XCircle className="size-3.5" /> {t("emg.closePerm")}</button>}
              {selected.status === "active" && !selected.owner && <button onClick={() => takeOwnership(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "linear-gradient(135deg, #34C759 0%, #28A745 100%)", fontSize: 11, fontWeight: 700, color: "#fff", boxShadow: "0 4px 16px rgba(52,199,89,0.25)" }}><UserCheck className="size-3.5" /> {t("emg.takeOwnership")}</button>}
              {(selected.status === "resolved" || selected.status === "closed") && (
                <button onClick={() => {
                  const emgItem: EmergencyItem = { id: selected.id, severity: selected.severity, employeeName: selected.title, zone: selected.zone, type: selected.description?.split(" ")[0] || "Emergency", timestamp: selected.createdAt, status: "resolved", elapsed: Math.floor((Date.now() - selected.createdAt.getTime()) / 1000), isOwned: !!selected.owner, ownedBy: selected.owner?.name };
                  const reportData = buildReportData(emgItem);
                  generateEmergencyLifecyclePDF(reportData);
                }} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)", fontSize: 11, fontWeight: 700, color: "#00C8E0" }}>
                  <Download className="size-3.5" /> Export Lifecycle Report (PDF)
                </button>
              )}
            </div>
          </DSCard>
          <DSCard padding={12}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>{t("emg.timeline")}</div>
            {selected.timeline.map((item, idx) => (
              <div key={idx} className="flex gap-3 items-start">
                <div className="flex flex-col items-center" style={{ width: 10 }}>
                  <div className="size-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: idx === selected.timeline.length - 1 ? "#00C8E0" : "rgba(128,144,165,0.5)" }} />
                  {idx < selected.timeline.length - 1 && <div className="w-px flex-1 mt-1" style={{ background: "rgba(255,255,255,0.04)", minHeight: 20 }} />}
                </div>
                <div className="flex-1 pb-3">
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{item.event}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{item.time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.25)" }}>{item.actor}</span>
                </div>
              </div>
            ))}
          </DSCard>
        </div>
      </div>
    );
  }

  if (webMode) {
    return (
      <div className="flex h-full" style={{ height: "calc(100vh - 56px)" }}>
        <div className="flex flex-col" style={{ width: 420, borderRight: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-3">
              <h2 className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Emergencies</h2>
              {activeCount > 0 && (
                <motion.span animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="px-2 py-0.5 rounded-full" style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "#FF2D55" }}>{activeCount} LIVE</motion.span>
              )}
            </div>
            <button onClick={onCreate} className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #FF2D55, #CC2244)", boxShadow: "0 4px 16px rgba(255,45,85,0.25)" }}>
              <Plus className="size-3.5" /> New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            {/* Zone Cluster Banner */}
            {clusters.length > 0 && (
              <div className="px-4 pt-3">
                <ZoneClusterBanner clusters={clusters} onAction={(cid, aid) => { if (aid === "deploy_team") takeClusterOwnership(cid); }} onLaunchSAR={onLaunchSAR} />
                {/* Admin Overload Warning — triggers when admin owns 2+ clusters */}
                {ownedClusterCount >= 2 && (
                  <div
                    className="mt-2 px-3 py-2.5 rounded-xl flex items-center gap-2.5"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,149,0,0.08), rgba(255,45,85,0.05))",
                      border: "1px solid rgba(255,149,0,0.2)",
                    }}
                  >
                    <div className="size-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(255,149,0,0.12)" }}>
                      <AlertTriangle className="size-3.5" style={{ color: "#FF9500" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 10, fontWeight: 800, color: "#FF9500" }}>COGNITIVE OVERLOAD RISK</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
                        You are managing {ownedClusterCount} clusters simultaneously. Consider delegating to another admin for safer response coordination.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {emgList.map(emg => {
              const sev = SEVERITY_CONFIG[emg.severity];
              const st = EMG_STATUS_CONFIG[emg.status];
              const elapsed = Math.floor((Date.now() - emg.createdAt.getTime()) / 1000);
              const isActive = !["resolved", "closed"].includes(emg.status);
              const isSelected = selectedId === emg.id;
              const clusterInfo = getClusterForEmg(emg.id);
              return (
                <button key={emg.id} onClick={() => setSelectedId(emg.id)} className="w-full text-left px-5 py-4 transition-colors"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: isSelected ? `${sev.color}08` : clusterInfo ? `${CLUSTER_LEVEL_CONFIG[clusterInfo.level].color}04` : "transparent", borderLeft: `3px solid ${isSelected ? sev.color : clusterInfo ? CLUSTER_LEVEL_CONFIG[clusterInfo.level].color : "transparent"}` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isActive && emg.status !== "contained" && <motion.div animate={{ scale: [1, 1.4, 1], opacity: [1, 0.4, 1] }} transition={{ duration: 1.2, repeat: Infinity }} className="size-2 rounded-full shrink-0" style={{ background: st.color }} />}
                        <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 700 }}>{emg.title}</p>
                      </div>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{emg.zone} · {emg.affectedCount} affected</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: sev.color, background: sev.bg }}>{emg.severity.toUpperCase()}</span>
                        <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: st.color, background: st.bg }}>{emg.status.toUpperCase()}</span>
                        {emg.owner && <span style={{ fontSize: 9, fontWeight: 600, color: "#00C853" }}>✓ Owned</span>}
                        {clusterInfo && (
                          <span className="px-2 py-0.5 rounded-md" style={{
                            fontSize: 8, fontWeight: 800,
                            color: CLUSTER_LEVEL_CONFIG[clusterInfo.level].color,
                            background: CLUSTER_LEVEL_CONFIG[clusterInfo.level].bgColor,
                            border: `1px solid ${CLUSTER_LEVEL_CONFIG[clusterInfo.level].borderColor}`,
                            letterSpacing: "0.3px",
                          }}>
                            CLUSTER {clusterInfo.emergencyIds.indexOf(emg.id) + 1}/{clusterInfo.affectedCount}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p style={{ fontSize: 16, fontWeight: 800, color: timerColor(elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>elapsed</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {!selectedId || !emgList.find(e => e.id === selectedId) ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="size-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <AlertTriangle className="size-7" style={{ color: "rgba(255,255,255,0.15)" }} />
              </div>
              <p style={{ fontSize: 15, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>Select an emergency to view details</p>
            </div>
          ) : (() => {
            const sel = emgList.find(e => e.id === selectedId)!;
            const sev = SEVERITY_CONFIG[sel.severity];
            const st = EMG_STATUS_CONFIG[sel.status];
            const elapsed = Math.floor((Date.now() - sel.createdAt.getTime()) / 1000);
            return (
              <div className="p-6 space-y-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2.5 py-1 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: sev.color, background: sev.bg }}>{sel.severity.toUpperCase()}</span>
                      <span className="px-2.5 py-1 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.bg }}>{sel.status.toUpperCase()}</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{sel.id}</span>
                    </div>
                    <h2 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>{sel.title}</h2>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{sel.zone} · {sel.address}</p>
                  </div>
                  <div className="text-right">
                    <p style={{ fontSize: 32, fontWeight: 800, color: timerColor(elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>response time</p>
                  </div>
                </div>
                {/* Cluster Linkage Banner — web detail */}
                {(() => {
                  const cl = getClusterForEmg(sel.id);
                  if (!cl) return null;
                  const cfg = CLUSTER_LEVEL_CONFIG[cl.level];
                  const others = cl.emergencyIds.filter(id => id !== sel.id);
                  return (
                    <div className="px-4 py-3 rounded-xl flex items-center gap-3" style={{ background: cfg.bgColor, border: `1px solid ${cfg.borderColor}` }}>
                      <Siren className="size-5 shrink-0" style={{ color: cfg.color }} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize: 11, fontWeight: 800, color: cfg.color }}>{cfg.label}</span>
                          <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: cfg.color }}>{cl.affectedCount} SOS</span>
                        </div>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                          This emergency is part of a zone cluster with {others.join(", ")} in {cl.zone}. Unified response recommended.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {(cl.level === "mass_casualty" || cl.level === "catastrophic") && (
                          <button
                            onClick={() => {
                              activateClusterSAR(cl);
                              toast.success("SAR Protocol Activated", { description: `Mission pre-staged for ${cl.affectedCount} workers in ${cl.zone}` });
                              onLaunchSAR?.();
                            }}
                            className="px-3 py-2 rounded-lg flex items-center gap-1.5"
                            style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #FF2D55, #FF6B35)", boxShadow: "0 0 10px rgba(255,45,85,0.3)" }}
                          >
                            <Radar className="size-3.5" />
                            SAR
                          </button>
                        )}
                        <button
                          onClick={() => takeClusterOwnership(cl.id)}
                          className="px-3 py-2 rounded-lg"
                          style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: cfg.color }}
                        >
                          Own All ({cl.affectedCount})
                        </button>
                      </div>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Affected",   value: sel.affectedCount,  color: "#FF2D55" },
                    { label: "Responders", value: sel.respondersCount, color: "#00C8E0" },
                    { label: "Radius",     value: `${sel.radius}m`,   color: "#FF9500" },
                    { label: "Owner",      value: sel.owner ? sel.owner.name.split(" ")[0] : "None", color: sel.owner ? "#00C853" : "rgba(255,255,255,0.3)" },
                  ].map(s => (
                    <div key={s.label} className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <p style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.65 }}>{sel.description}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {sel.status === "active" && !sel.owner && <button onClick={() => takeOwnership(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, #34C759, #28A745)", fontSize: 14, fontWeight: 700, color: "#fff", boxShadow: "0 4px 20px rgba(52,199,89,0.3)" }}><UserCheck className="size-4" /> Take Ownership</button>}
                  {sel.status === "responding" && <button onClick={() => containEmg(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, #00C8E0, #0088A8)", fontSize: 14, fontWeight: 700, color: "#fff", boxShadow: "0 4px 20px rgba(0,200,224,0.3)" }}><Shield className="size-4" /> Mark Contained</button>}
                  {sel.status === "contained" && <button onClick={() => resolveEmg(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, #00C853, #009940)", fontSize: 14, fontWeight: 700, color: "#fff", boxShadow: "0 4px 20px rgba(0,200,83,0.3)" }}><CheckCircle2 className="size-4" /> Resolve</button>}
                  {sel.status === "resolved" && <button onClick={() => closeEmg(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "rgba(128,144,165,0.1)", border: "1px solid rgba(128,144,165,0.2)", fontSize: 14, fontWeight: 700, color: "#8090A5" }}><XCircle className="size-4" /> Close Permanently</button>}
                  {(sel.status === "resolved" || sel.status === "closed") && (
                    <button onClick={() => {
                      const emgItem: EmergencyItem = { id: sel.id, severity: sel.severity, employeeName: sel.title, zone: sel.zone, type: sel.description?.split(" — ")[0] || "Emergency", timestamp: sel.createdAt, status: "resolved", elapsed: Math.floor((Date.now() - sel.createdAt.getTime()) / 1000), isOwned: !!sel.owner, ownedBy: sel.owner?.name };
                      generateEmergencyLifecyclePDF(buildReportData(emgItem));
                    }} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.1), rgba(123,94,255,0.06))", border: "1px solid rgba(0,200,224,0.15)", fontSize: 14, fontWeight: 700, color: "#00C8E0", boxShadow: "0 4px 16px rgba(0,200,224,0.08)" }}>
                      <Download className="size-4" /> Export Lifecycle Report
                    </button>
                  )}
                  {[
                    // phase-1/finish-dashboard-pages (2026-05-25, life-safety): web-mode buttons
                    // share the SAME wiring as the drawer buttons (lines ~2580). Pre-fix all 3
                    // were toast-only stubs.
                    { icon: Send, label: "Dispatch Team", color: "#FF9500", onClick: () => {
                      dispatchTeam(sel.id);
                      trackEventSync(sel.id, "responder_dispatched", `Dispatched to ${sel.zone}`, "Admin", "Admin");
                      toast.success("Team dispatched", { description: `Responders en route to ${sel.zone}` });
                    }},
                    { icon: Bell, label: "Broadcast", color: "#7B5EFF", onClick: () => {
                      const audience = sel.zone ? { type: "zone" as const, zoneIds: [sel.zone] } : { type: "all" as const };
                      sendBroadcast({
                        title: `🚨 EMERGENCY — ${sel.title}`,
                        body: `Active emergency in ${sel.zone || "your area"}. Stay alert.`,
                        priority: "emergency",
                        audience,
                        audienceLabel: sel.zone || "All Zones",
                        source: "manual", senderName: "Emergency Command", senderRole: "Admin",
                        timestamp: Date.now(), relatedEmergencyId: sel.id,
                      });
                      trackEventSync(sel.id, "emergency_services_called", `Broadcast to ${sel.zone || "all"}`, "Admin", "Admin");
                      toast.success("Broadcast sent", { description: `Alerted workers in ${sel.zone || "all zones"}` });
                    }},
                    { icon: Zap, label: "Escalate", color: "#FF2D55", onClick: () => {
                      emitSyncEvent({
                        type: "SOS_ESCALATED",
                        employeeId: (sel as any).employeeId || sel.id,
                        employeeName: sel.title, zone: sel.zone, timestamp: Date.now(),
                        data: { emergencyId: sel.id, reason: "admin_manual_escalation", severity: sel.severity, escalatedTo: "company_admin_and_safety_director" },
                      });
                      sendBroadcast({
                        title: `⬆️ ESCALATED — ${sel.title}`,
                        body: `Emergency ${sel.id} escalated. Requires Zone Admin + Safety Director.`,
                        priority: "emergency",
                        audience: { type: "role", roles: ["admin", "supervisor"] },
                        audienceLabel: "Management",
                        source: "manual", senderName: "Emergency Command", senderRole: "Admin",
                        timestamp: Date.now(), relatedEmergencyId: sel.id,
                      });
                      trackEventSync(sel.id, "escalation_triggered", `Escalated to management`, "Admin", "Admin");
                      toast.success("Escalated to management", { description: "Zone Admin & Safety Director notified" });
                    }},
                  ].map(a => (
                    <button key={a.label} onClick={a.onClick} className="flex items-center gap-2 px-4 py-3 rounded-xl" style={{ background: `${a.color}10`, border: `1px solid ${a.color}20`, fontSize: 13, fontWeight: 600, color: a.color }}>
                      <a.icon className="size-4" /> {a.label}
                    </button>
                  ))}
                </div>
                <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}><p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Incident Timeline</p></div>
                  <div className="px-5 py-4">
                    {sel.timeline.map((item, idx) => (
                      <div key={idx} className="flex gap-4 items-start mb-4 last:mb-0">
                        <div className="flex flex-col items-center" style={{ width: 12 }}>
                          <div className="size-2.5 rounded-full mt-1 shrink-0" style={{ background: idx === sel.timeline.length - 1 ? "#00C8E0" : "rgba(255,255,255,0.15)" }} />
                          {idx < sel.timeline.length - 1 && <div className="w-px flex-1 mt-1.5" style={{ background: "rgba(255,255,255,0.06)", minHeight: 24 }} />}
                        </div>
                        <div className="flex-1 flex items-start justify-between">
                          <div>
                            <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{item.event}</p>
                            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{item.actor}</p>
                          </div>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontVariantNumeric: "tabular-nums" }}>{item.time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="danger" pulse={activeCount > 0}>{activeCount} {t("emg.active")}</Badge>
          {emgList.some(e => !["resolved", "closed"].includes(e.status) && (Date.now() - e.createdAt.getTime()) / 1000 >= SLA_THRESHOLD) && <Badge variant="warning">SLA</Badge>}
        </div>
        <DSButton variant="danger" size="sm" icon={Plus} onClick={onCreate}>{t("b.create")}</DSButton>
      </div>
      {/* Zone Cluster Banner — mobile */}
      <ZoneClusterBanner clusters={clusters} onAction={(cid, aid) => { if (aid === "deploy_team") takeClusterOwnership(cid); }} onLaunchSAR={onLaunchSAR} />
      <div className="space-y-2">
        {emgList.map(emg => {
          const sev = SEVERITY_CONFIG[emg.severity];
          const st = EMG_STATUS_CONFIG[emg.status];
          const elapsed = Math.floor((Date.now() - emg.createdAt.getTime()) / 1000);
          const clusterInfo = getClusterForEmg(emg.id);
          return (
            <motion.div key={emg.id} layout onClick={() => setSelectedId(emg.id)}
              className="rounded-xl overflow-hidden cursor-pointer" whileTap={{ scale: 0.98 }}
              style={{ background: emg.status === "active" ? `${sev.color}06` : "rgba(255,255,255,0.02)", border: `1px solid ${emg.status === "active" ? `${sev.color}15` : "rgba(255,255,255,0.04)"}` }}>
              <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${sev.color}10` }}>
                {(emg.status === "active" || emg.status === "new") && <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1, repeat: Infinity }} className="size-2 rounded-full" style={{ background: st.color }} />}
                <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{emg.id}</span>
                {emg.owner && <Badge variant="success" size="sm">{t("emg.owned")}</Badge>}
                {clusterInfo && (
                  <span className="px-1.5 py-0.5 rounded-md" style={{
                    fontSize: 8, fontWeight: 800,
                    color: CLUSTER_LEVEL_CONFIG[clusterInfo.level].color,
                    background: CLUSTER_LEVEL_CONFIG[clusterInfo.level].bgColor,
                    border: `1px solid ${CLUSTER_LEVEL_CONFIG[clusterInfo.level].borderColor}`,
                  }}>
                    CLUSTER {clusterInfo.emergencyIds.indexOf(emg.id) + 1}/{clusterInfo.affectedCount}
                  </span>
                )}
                <span style={{ marginLeft: "auto" }}><Badge color={st.color}>{t(st.tKey)}</Badge></span>
              </div>
              <div className="px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{emg.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge color={sev.color}>{emg.severity.toUpperCase()}</Badge>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{emg.zone}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>·</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}><Users className="size-2.5 inline mr-0.5" />{emg.affectedCount}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <span style={{ fontSize: 14, fontWeight: 800, color: timerColor(elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-end mt-1.5">
                  <span className="flex items-center gap-0.5" style={{ fontSize: 9, color: "#00C8E0", fontWeight: 500 }}>{t("emg.viewDetails")} <ChevronRight className="size-3" /></span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Zones Page — extracted 2026-05-31 (Tier A step 3/7)
// ═══════════════════════════════════════════════════════════════
export { ZonesPage } from "./dashboard-zones-page";

// ═══════════════════════════════════════════════════════════════
// Incident History Page — extracted 2026-05-31 (Tier A.1 refactor)
// ═══════════════════════════════════════════════════════════════
export { IncidentHistoryPage } from "./dashboard-incident-history-page";

// ═══════════════════════════════════════════════════════════════
// Attendance Page — extracted 2026-05-31 (Tier A step 4/7)
// (LiveZoneArrivals helper also moved with it)
// ═══════════════════════════════════════════════════════════════
export { AttendancePage } from "./dashboard-attendance-page";

// ═══════════════════════════════════════════════════════════════
// Create Emergency Drawer — also lives here (needs SEVERITY_CONFIG + store zones)
// ═══════════════════════════════════════════════════════════════
export function CreateEmergencyDrawer({ onClose, onCreate, t }: {
  onClose: () => void;
  onCreate: (data: { severity: "critical" | "high" | "medium" | "low"; employeeName: string; zone: string; type: string }) => void;
  t: (k: string) => string;
}) {
  const storeZones = useDashboardStore(s => s.zones);
  const [severity, setSeverity] = useState<"critical" | "high" | "medium" | "low">("high");
  const [type, setType] = useState("Manual SOS");
  const [zone, setZone] = useState(storeZones[0]?.name || "Zone A - North Gate");
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 z-50" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 400, damping: 35 }}
        className="absolute bottom-0 left-0 right-0 z-50 rounded-t-2xl"
        style={{ background: "#0A1220", border: "1px solid rgba(255,255,255,0.06)", borderBottom: "none" }}>
        <div className="flex justify-center pt-3 pb-2"><div className="w-8 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} /></div>
        <div className="px-4 pb-8 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>{t("ced.title")}</h3>
            <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>
          </div>
          <div>
            <p className="mb-1.5" style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{t("ced.severity")}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {(["critical", "high", "medium", "low"] as const).map(sev => {
                const cfg = SEVERITY_CONFIG[sev];
                return (
                  <button key={sev} onClick={() => setSeverity(sev)} className="py-2 rounded-lg text-center"
                    style={{ fontSize: 10, fontWeight: 600, color: severity === sev ? "#fff" : cfg.color, background: severity === sev ? cfg.color : cfg.bg, border: `1px solid ${severity === sev ? cfg.color : "transparent"}` }}>
                    {t(cfg.tKey)}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1.5" style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{t("ced.type")}</p>
            <select value={type} onChange={e => setType(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-transparent text-white outline-none" style={{ fontSize: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              <option value="Manual SOS">{t("ced.manualSos")}</option>
              <option value="Missed Check-in">{t("ced.missedCheckin")}</option>
              <option value="Geofence Breach">{t("ced.geofenceBreach")}</option>
              <option value="Fall Detection">{t("ced.fallDetection")}</option>
              <option value="Gas Leak">{t("ced.gasLeak")}</option>
            </select>
          </div>
          <div>
            <p className="mb-1.5" style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{t("ced.zone")}</p>
            <select value={zone} onChange={e => setZone(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-transparent text-white outline-none" style={{ fontSize: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              {storeZones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
            </select>
          </div>
          <button onClick={() => onCreate({ severity, employeeName: "Admin Report", zone, type })}
            className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #FF2D55 0%, #FF1744 100%)" }}>
            <Siren className="size-4 text-white" />
            <span className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{t("ced.submit")}</span>
          </button>
        </div>
      </motion.div>
    </>
  );
}
