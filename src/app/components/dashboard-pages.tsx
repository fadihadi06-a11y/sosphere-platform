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
// Employees Page + EmpDetailView — extracted 2026-05-31 (Tier A step 6/7)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Emergencies Page — extracted 2026-05-31 (Tier A step 7/7 — final)
// (includes ZoneClusterBanner, RICH_EMERGENCIES, EMG_STATUS_CONFIG,
//  and the 4 emergency-related types as internal scaffolding)
// ═══════════════════════════════════════════════════════════════
export { EmergenciesPage } from "./dashboard-emergencies-page";

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
// Create Emergency Drawer — extracted 2026-05-31 (Tier A step 5/7)
// ═══════════════════════════════════════════════════════════════
export { CreateEmergencyDrawer } from "./dashboard-create-emergency-drawer";
