import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useDashboardStore } from "./stores/dashboard-store";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, Users, MapPin, AlertTriangle,
  ChevronRight, CheckCircle2, Radio,
  FileText, Building2, User, LogOut, Map as MapIcon,
  UserCheck, Zap, Settings,
  LayoutDashboard, TrendingUp,
  X, ArrowUpRight, Siren,
  Navigation, Download, Layers, Target,
  Cpu, Signal, FileWarning, CalendarDays,
  Megaphone, Route, Trophy, ScrollText,
  UserCog, Wallet, Radar, ListChecks, BookOpen,
  CloudLightning, Award, Mail,
  Brain, Sparkles, Camera, PhoneMissed, Phone, Clock,
  CreditCard, Lock, Crown, RefreshCw, Activity,
} from "lucide-react";
import { type Lang, LANG_META, useT, LanguagePicker } from "./dashboard-i18n";
import type { DashPage, Employee, EmergencyItem, ZoneData } from "./dashboard-types";
// Mock data now read from Zustand store — no direct EMPLOYEES/EMERGENCIES/ZONES imports needed
import { CommandCenterPage } from "./command-center";
import { IncidentReportsTab } from "./hub-incident-reports";
import { RiskMapLivePage } from "./risk-map-live";
import { type PriorityOverrideLog } from "./priority-engine";
import { hasPermission, ROLE_CONFIG, type Role, type AuthState } from "./mobile-auth";
import { hasFeature, canCreateEmergency as canCreateEmgBilling, isTrialExpired, isTrial, trialDaysRemaining, toAccountStatus, type CompanyState } from "./mobile-company";
// (LiveAlertOverlay — replaced by SOSEmergencyPopup)
import { HazardAlertBanner } from "./hazard-banner";
import { TenantBanner } from "./tenant-banner";
import { ManualPriorityModal } from "./manual-priority-modal";
import { SettingsPage } from "./dashboard-settings-page";
import { PricingPage } from "./dashboard-pricing-page";
import { BillingPage } from "./dashboard-billing-page";
import {
  OverviewPage, EmergenciesPage,
  IncidentHistoryPage, CreateEmergencyDrawer,
} from "./dashboard-pages";
// (EmployeesPage, ZonesPage, AttendancePage — now handled inside hubs/location page)
import { AnalyticsPage } from "./dashboard-analytics-page";
import { EmployeeDetailDrawer } from "./dashboard-employee-detail";
import { onSyncEvent, getHybridMode, onHybridModeChange, onMissedCallChange, onMissedCallNotify, markMissedCallSeen, emitCallSignal, emitAdminSignal, getLastEmployeeSync, emitSyncEvent, initRealtimeChannels, type MissedCall } from "./shared-store";
import { calculateRiskScore, getRiskLabel } from "./risk-scoring-engine";
// (ShiftSchedulingPage, GeofencingPage, GPSCompliancePage, BroadcastPage — now merged into hubs/location tabs)

// (DashboardEvacuationPage, EmployeeStatusPage — now merged into hubs via PAGE_TO_HUB redirects)

// Import UX enhancement components
import { GlobalQuickActions } from "./global-quick-actions";
import { GlobalSearch, useGlobalSearch } from "./global-search";

// Import Unified Employees Page
import { UnifiedEmployeesPage } from "./employees-unified-page";
import { DashboardJobsPage } from "./dashboard-jobs-page";

// ── NEW: Hybrid Hub Pages (merged for clarity) ──────────────────
// EmergencyHubPage tabs now flattened into parent HubTabBar (no double tab bar)
import { LocationZonesPage } from "./dashboard-location-page";
import { WorkforcePage } from "./dashboard-workforce-page";
import { CommsHubPage } from "./dashboard-comms-hub";
import { SOSEmergencyPopup, type SOSEmployee } from "./sos-emergency-popup";
import { AdminCallSystem } from "./admin-incoming-call";

// ── NEW: Roles & Permissions Page ──────────────────────────────
import { RolesPermissionsPage } from "./dashboard-roles-page";

// ── NEW: Audit Log Page ──────────────���────────────────────────
import { AuditLogPage } from "./dashboard-audit-log-page";

// ── NEW: CSV Field Guide ────────────────────────────────────────
import { CSVFieldGuide } from "./csv-field-guide";

// ── NEW: Notifications Panel ───────��────────────────────────────
import { NotificationsPanel, NotificationsBellButton } from "./dashboard-notifications-panel";

// ── NEW: Safety Intelligence Engine ─────────────────────────────
import { SafetyIntelligencePage } from "./safety-intelligence";
import { Toaster, toast } from "sonner";
import { safeTelCall } from "./utils/safe-tel";
import { hapticLight, playUISound } from "./haptic-feedback";

// (EscalationTimeline/EscalationBadge/useSmartEscalation — handled inside hubs)
// (useNotifications/NotificationPermissionCard — moved to settings)

// ── NEW: Round 1 Features ───────────────────────────────────────
import { DashboardEmergencyChat } from "./emergency-chat";
// ── Unified Emergency Engine (replaces 3 separate imports) ──
import { UnifiedEmergencyEngine, GuideMeButton, type AICoAdminContext, type IREContext } from "./unified-emergency-engine";
import type { UnifiedEmergencyContext } from "./unified-emergency-engine";
// Legacy imports kept for type compatibility in dashboard-store
// import { EmergencyResponseWizard, GuideMeButton } from "./guided-response";
// import { IntelligentGuide, type IREContext } from "./intelligent-guide";
// import { AICoAdmin, type AICoAdminContext } from "./ai-co-admin";
import { requestNotificationPermission } from "./ire-push-notification";
import { buildReportData, generateEmergencyLifecyclePDF } from "./emergency-lifecycle-report";
import { PdfEmailModal } from "./pdf-email-modal";
// FIX D: Shift Handover Modal
import { ShiftHandoverModal, type EmergencyForHandover } from "./shift-handover-modal";

// ── NEW: Round 2 Features ──────────────────────────────────��────
import { BuddySystemPage } from "./buddy-system";
import { PreShiftChecklistPage } from "./pre-shift-checklist";
import { EmergencyPlaybookPage } from "./emergency-playbook";

// ── NEW: Round 3 Features ───────────────────────────────────────
import { WeatherAlertsPage } from "./weather-alerts";
import { JourneyManagementPage } from "./journey-management";
import { SafetyGamificationPage } from "./safety-gamification";
import { ComplianceReportsPage } from "./compliance-reports";

// ── NEW: Smart Admin Hints ──────────────────────────────────────
import { AdminHintBar } from "./admin-hints";
import { useSessionTimeout, SessionTimeoutWarning } from "./use-session-timeout";
import { LiveTrialBanner } from "./trial-banner-live";  // AUTH-5 P4 (#175)
import { LeaderboardPage } from "./dashboard-leaderboard-page";
import { trackEventSync } from "./smart-timeline-tracker";
// RRP merged into unified Smart Response Guide (IRE)
import { BatchEmailScheduler } from "./batch-email-scheduler";
import { RRPAnalyticsPage } from "./rrp-analytics-page";
import { OfflineIndicator } from "./offline-sync";
import { OfflineMonitoringPage } from "./dashboard-offline-page";
import { getTrackerState, startGPSTracking } from "./offline-gps-tracker";

// ── NEW: SAR Protocol Engine ────────────────────────────────────
import { SARProtocolPage } from "./dashboard-sar-page";

// ── NEW: ISO 45001 Compliance Pages ─────────────────��───────────
import { IncidentInvestigationPage } from "./dashboard-incident-investigation";
import { RiskRegisterPage } from "./dashboard-risk-register";

// ── NEW: Mission Control ────────────────────────────────────────
import { MissionControlPage } from "./mission-control";

// ── NEW: Incident Photo Report — Admin Broadcast Panel ──────────
import { AdminBroadcastPanel, type IncidentReportData } from "./incident-photo-report";
import {
  storeEvidence, updateEvidenceStatus, addEvidenceAction, getAllEvidence,
  getEvidencePipelineStatus, seedMockEvidence,
} from "./evidence-store";
import {
  getClusterGuideHint,
  CLUSTER_LEVEL_CONFIG, type ZoneCluster,
} from "./zone-cluster-engine";

// ── NEW: Error Boundaries for page-level crash protection ───────
import { PageErrorBoundary, WidgetErrorBoundary } from "./error-boundary";

// ── FIX 1+3: Plan Gates + Trial Expired Overlay ────────────────
import { PlanGate, TrialExpiredOverlay, isPageBlockedByTrial, PlanLimitModal, checkZoneLimit, checkEmployeeLimit, checkFeatureGate } from "./plan-gate";

// ── NEW: Integration Readiness Checker (console: sosCheck()) ────
import "./api/integration-checklist";

// FIX 7: Collision-resistant emergency ID generator
// Uses full timestamp (base36) + 4-char random suffix → ~2.1B unique values/second
function generateEmergencyId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EMG-${ts}-${rand}`;
}

// ── Smart Navigation: Maps standalone page IDs to their Hub + Tab ──
// This eliminates dead-end pages and ensures consistent hub context
const PAGE_TO_HUB: Record<string, { hub: DashPage; tab: string }> = {
  // ── Current hub sub-pages ──
  workforce:              { hub: "operations",       tab: "workforce" },
  comms:                  { hub: "operations",       tab: "comms" },
  offlineMonitor:         { hub: "operations",       tab: "offline" },
  journeyMgmt:            { hub: "operations",       tab: "journey" },
  employees:              { hub: "people",            tab: "directory" },
  buddySystem:            { hub: "people",            tab: "buddy" },
  checklist:              { hub: "people",            tab: "checklist" },
  safetyScore:            { hub: "people",            tab: "score" },
  // E1.6: Jobs is a sub-tab of "People & Teams" — Jobs are bulk operations
  // on people (CSV imports, SCIM syncs, mass invitations). The wizard
  // routes here via onNavigate("jobs") after a successful enqueue.
  jobs:                   { hub: "people",            tab: "jobs" },
  incidentInvestigation:  { hub: "incidentRisk",      tab: "investigation" },
  riskRegister:           { hub: "incidentRisk",      tab: "register" },
  complianceReports:      { hub: "reportsAnalytics",  tab: "reports" },
  analytics:              { hub: "reportsAnalytics",  tab: "analytics" },
  leaderboard:            { hub: "reportsAnalytics",  tab: "leaderboard" },
  emailScheduler:         { hub: "reportsAnalytics",  tab: "scheduler" },
  auditLog:               { hub: "governance",        tab: "audit" },
  roles:                  { hub: "governance",        tab: "roles" },
  sarProtocol:            { hub: "emergencyHub",      tab: "sar" },
  playbook:               { hub: "emergencyHub",      tab: "playbook" },
  // ── Legacy page aliases (pre-hub) — redirected to their hub ──
  emergencies:            { hub: "emergencyHub",      tab: "active" },
  commandCenter:          { hub: "emergencyHub",      tab: "active" },
  incidents:              { hub: "incidentRisk",      tab: "investigation" },
  attendance:             { hub: "operations",        tab: "workforce" },
  shiftScheduling:        { hub: "operations",        tab: "workforce" },
  broadcast:              { hub: "operations",        tab: "comms" },
  evacuation:             { hub: "operations",        tab: "comms" },
  employeeStatus:         { hub: "people",            tab: "directory" },
};

// Page aliases — pages that are simply renamed/moved
const PAGE_ALIASES: Record<string, DashPage> = {
  zones: "location",
  geofencing: "location",     // Geofencing is now a tab inside LocationZonesPage
  gpsCompliance: "location",  // GPS Compliance is now a tab inside LocationZonesPage
};

// ══════════════════════════════════════════════════════════════
// SOSphere Enterprise Dashboard — Premium Supervisor Interface
// Based on PremiumDashboard Architecture (Docked Panel Pattern) v2
// ══════════════════════════════════════════════════════════════

// Types & mock data imported from ./dashboard-types (single source of truth)

interface CompanyDashboardProps {
  companyName: string;
  ownerName?: string;
  onSOSTrigger: () => void;
  onLogout: () => void;
  webMode?: boolean;
}

// Mock data now served from Zustand store (single source of truth)

// SEVERITY_CONFIG & STATUS_CONFIG centralized in ./dashboard-pages (single source of truth)

// ── Sidebar Navigation — Danger Priority Order (Highest → Lowest) ──
// 🔴 LIVE THREAT → 🧠 INTELLIGENCE → 🔵 OPERATIONS → 🟢 COMPLIANCE → ⚙️ SYSTEM

function getNavLiveThreat(t: (k: string) => string) {
  return [
    { id: "emergencyHub" as DashPage,  icon: Siren,   label: "Emergency Hub" },
    { id: "riskMap" as DashPage,       icon: MapIcon,  label: t("nav.risk")   },
  ];
}

function getNavIntelligence(t: (k: string) => string) {
  return [
    { id: "safetyIntel" as DashPage,  icon: Radar,           label: "Safety Intelligence" },
    { id: "overview" as DashPage,     icon: LayoutDashboard,  label: t("nav.overview")     },
  ];
}

function getNavOperations(_t: (k: string) => string) {
  return [
    { id: "operations" as DashPage,  icon: Route,  label: "Operations Hub"  },
    { id: "people" as DashPage,      icon: Users,  label: "People & Teams"  },
  ];
}

function getNavCompliance() {
  return [
    { id: "incidentRisk" as DashPage,      icon: FileWarning, label: "Incident & Risk"     },
    { id: "reportsAnalytics" as DashPage,  icon: TrendingUp,  label: "Reports & Analytics" },
  ];
}

function getNavSystem() {
  return [
    { id: "governance" as DashPage,  icon: ScrollText, label: "Governance" },
  ];
}

// ── Hub Tab Configurations ──────────────────────────────────────
const HUB_TABS: Record<string, Array<{ id: string; label: string; icon: any; color?: string }>> = {
  emergencyHub: [
    { id: "active", label: "Live Alerts", icon: Siren, color: "#FF2D55" },
    { id: "reports", label: "Reports", icon: FileText, color: "#FF9500" },
    { id: "history", label: "History", icon: FileWarning, color: "#00C8E0" },
    { id: "command", label: "Command", icon: Radio, color: "#9B59B6" },
    { id: "sar", label: "SAR", icon: Target, color: "#FF9500" },
    { id: "playbook", label: "Playbook", icon: BookOpen, color: "#7B5EFF" },
  ],
  operations: [
    { id: "missions", label: "Missions", icon: Navigation, color: "#00C8E0" },
    { id: "journey", label: "Journeys", icon: Route, color: "#4A90D9" },
    { id: "workforce", label: "Workforce", icon: CalendarDays, color: "#FF9500" },
    { id: "comms", label: "Comms Hub", icon: Megaphone, color: "#E67E22" },
    { id: "offline", label: "Connectivity", icon: Signal, color: "#00C853" },
  ],
  people: [
    { id: "directory", label: "Directory", icon: Users, color: "#00C8E0" },
    { id: "buddy", label: "Buddy System", icon: UserCheck, color: "#00C853" },
    { id: "checklist", label: "Pre-Shift", icon: ListChecks, color: "#FF9500" },
    { id: "score", label: "Safety Score", icon: Award, color: "#FFD700" },
    // E1.6: Jobs tab — live status of bulk operations enqueued via E1.5
    { id: "jobs", label: "Jobs", icon: Activity, color: "#9B59B6" },
  ],
  incidentRisk: [
    { id: "investigation", label: "Investigation", icon: FileWarning, color: "#FF9500" },
    { id: "register", label: "Risk Register", icon: Shield, color: "#BF5AF2" },
  ],
  reportsAnalytics: [
    { id: "reports", label: "Reports", icon: FileText, color: "#00C853" },
    { id: "analytics", label: "Analytics", icon: TrendingUp, color: "#4A90D9" },
    { id: "leaderboard", label: "Leaderboard", icon: Trophy, color: "#FFD700" },
    { id: "scheduler", label: "Scheduler", icon: Mail, color: "#00C8E0" },
  ],
  governance: [
    { id: "audit", label: "Audit Trail", icon: ScrollText, color: "#8090A5" },
    { id: "roles", label: "Roles & Access", icon: UserCog, color: "#9B59B6" },
  ],
};

// ── HubTabBar Component — Glassmorphism tab navigation ─────────
function HubTabBar({ hubId, activeTab, onTabChange, badges, lockedTabs }: {
  hubId: string;
  activeTab: string;
  onTabChange: (tab: string) => void;
  badges?: Record<string, number>;
  lockedTabs?: Set<string>;
}) {
  const tabs = HUB_TABS[hubId];
  if (!tabs) return null;
  return (
    <div className="px-5 pt-3 pb-1">
      <div className="flex gap-1 p-1 rounded-2xl" style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.04)",
        backdropFilter: "blur(20px)",
      }}>
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badge = badges?.[tab.id];
          const isLocked = lockedTabs?.has(tab.id);
          return (
            <motion.button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              whileTap={{ scale: 0.96 }}
              className="relative flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl transition-all"
              style={{
                background: isActive ? `linear-gradient(135deg, ${tab.color}12 0%, ${tab.color}06 100%)` : "transparent",
                border: isActive ? `1px solid ${tab.color}18` : "1px solid transparent",
                opacity: isLocked && !isActive ? 0.55 : 1,
              }}
            >
              {isActive && (
                <motion.div
                  layoutId={`hub-tab-${hubId}`}
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background: `linear-gradient(135deg, ${tab.color}10 0%, ${tab.color}04 100%)`,
                    border: `1px solid ${tab.color}15`,
                  }}
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <Icon className="size-3.5 relative z-10" style={{ color: isActive ? tab.color : "rgba(255,255,255,0.25)", strokeWidth: isActive ? 2 : 1.5 }} />
              <span className="relative z-10 hidden sm:inline" style={{
                fontSize: 11, fontWeight: isActive ? 650 : 450,
                color: isActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)",
                letterSpacing: "-0.01em", whiteSpace: "nowrap",
              }}>{tab.label}</span>
              {isLocked && (
                <Lock className="size-2.5 relative z-10" style={{ color: "rgba(255,150,0,0.6)" }} />
              )}
              {badge !== undefined && badge > 0 && (
                <span className="relative z-10 px-1.5 py-0.5 rounded-md" style={{
                  fontSize: 8, fontWeight: 800, color: "#fff",
                  background: `linear-gradient(135deg, ${tab.color}, ${tab.color}CC)`,
                  minWidth: 16, textAlign: "center",
                }}>{badge}</span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Trial Banner Component (PART C + E)
// ═══════════════════════════════════════════════════════════════

function TrialBanner({ daysLeft, isActive, trialEndsAt, onUpgrade, onDismiss }: {
  daysLeft: number;
  isActive: boolean;
  trialEndsAt: string | null;
  onUpgrade: () => void;
  onDismiss: () => void;
}) {
  const isExpired = !isActive && daysLeft <= 0;
  const isUrgent = !isExpired && daysLeft <= 2;
  const isWarning = !isExpired && daysLeft <= 4 && daysLeft > 2;

  // PART E: 30-day data deletion countdown
  const daysSinceExpired = isExpired && trialEndsAt
    ? Math.floor((Date.now() - new Date(trialEndsAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const daysUntilDeletion = Math.max(0, 30 - daysSinceExpired);

  // Color scheme based on urgency
  const color = isExpired
    ? { bg: "rgba(127,29,29,0.15)", border: "rgba(239,68,68,0.3)", text: "#EF4444", accent: "#DC2626" }
    : isUrgent
    ? { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)", text: "#EF4444", accent: "#EF4444" }
    : isWarning
    ? { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)", text: "#F59E0B", accent: "#F59E0B" }
    : { bg: "rgba(0,200,83,0.08)", border: "rgba(0,200,83,0.2)", text: "#00C853", accent: "#00C853" };

  const message = isExpired
    ? `Trial ended. Your data will be permanently deleted in ${daysUntilDeletion} day${daysUntilDeletion !== 1 ? "s" : ""}`
    : daysLeft <= 1
    ? "Trial ends tomorrow! Upgrade now"
    : daysLeft <= 2
    ? `Trial ends in ${daysLeft} days! Upgrade now`
    : daysLeft <= 4
    ? `Only ${daysLeft} days left! Upgrade before trial ends`
    : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left in your free trial`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex items-center gap-3 px-4 py-2.5 mx-4 mt-3 mb-1"
      style={{
        borderRadius: 12,
        background: color.bg,
        border: `1px solid ${color.border}`,
      }}
    >
      {isUrgent || isExpired ? (
        <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
          <AlertTriangle className="size-4 shrink-0" style={{ color: color.accent }} />
        </motion.div>
      ) : (
        <Clock className="size-4 shrink-0" style={{ color: color.accent }} />
      )}
      <div className="flex-1 min-w-0">
        <span style={{ fontSize: 13, fontWeight: 600, color: color.text }}>
          {message}
        </span>
        {isExpired && daysUntilDeletion <= 7 && (
          <p style={{ fontSize: 10, color: "rgba(239,68,68,0.7)", marginTop: 2 }}>
            {"\u26A0\uFE0F"} All company data will be permanently deleted after this period
          </p>
        )}
      </div>
      <button
        onClick={onUpgrade}
        className="shrink-0 px-3 py-1.5"
        style={{
          borderRadius: 8,
          background: color.accent,
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {isExpired ? "Upgrade to Restore" : "Upgrade Now"}
      </button>
      {/* Cannot dismiss when expired (daysLeft 0) */}
      {!isExpired && (
        <button
          onClick={onDismiss}
          className="shrink-0 p-1 rounded-md"
          style={{ color: color.text, cursor: "pointer" }}
        >
          <X className="size-3.5" />
        </button>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Trial Blocked Modal (PART D)
// ═══════════════════════════════════════════════════════════════

function TrialBlockedModal({ type, message, onUpgrade, onClose }: {
  type: "employee" | "zone" | "generic";
  message: string;
  onUpgrade: () => void;
  onClose: () => void;
}) {
  const icons: Record<string, any> = { employee: Users, zone: MapPin, generic: AlertTriangle };
  const Icon = icons[type] || AlertTriangle;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9998] flex items-center justify-center p-6"
      style={{ background: "rgba(5,7,14,0.85)", backdropFilter: "blur(12px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        transition={{ type: "spring", damping: 22 }}
        className="w-full rounded-2xl p-6 space-y-4"
        style={{
          maxWidth: 380,
          background: "linear-gradient(145deg, rgba(10,18,32,0.98), rgba(15,22,38,0.95))",
          border: "1px solid rgba(255,45,85,0.15)",
          boxShadow: "0 25px 80px rgba(0,0,0,0.6)",
        }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="size-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>
            <Icon className="size-7" style={{ color: "#FF2D55" }} />
          </div>
          <h3 className="text-white" style={{ fontSize: 18, fontWeight: 800 }}>Trial Ended</h3>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
            {message}
          </p>
        </div>
        <button
          onClick={() => { onUpgrade(); onClose(); }}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
          style={{
            background: "linear-gradient(135deg, #00C8E0, #00A0B8)",
            color: "#fff", fontSize: 14, fontWeight: 800,
            border: "none", cursor: "pointer",
            boxShadow: "0 4px 20px rgba(0,200,224,0.3)",
          }}
        >
          <Crown className="size-4" />
          Upgrade Now
        </button>
        <button onClick={onClose}
          className="w-full py-2 rounded-lg"
          style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", background: "transparent", border: "none", cursor: "pointer" }}>
          Maybe Later
        </button>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Dashboard Component
// ═══════════════════════════════════════════════════════════════
export function CompanyDashboard({ companyName, ownerName, onSOSTrigger, onLogout, webMode = false }: CompanyDashboardProps) {
  // ── Init Supabase Realtime channels on mount ────────────────
  // Uses Supabase session company_id for isolated realtime channel
  useEffect(() => {
    (async () => {
      try {
        const { supabase } = await import("./api/supabase-client");
        // E1.6-PHASE3 (2026-05-04): use loadCanonicalIdentity (safeRpc-first,
        // lock-free) instead of getSession() + companies SELECT chain.
        const { loadCanonicalIdentity } = await import("./api/canonical-identity");
        const id = await loadCanonicalIdentity(supabase);
        const userId = id?.user_id;
        if (userId) {
          const data = id.active_company ? { id: id.active_company.id } : null;
          if (data?.id) {
            localStorage.setItem("sosphere_company_id", data.id);
            initRealtimeChannels(data.id);
          } else {
            // Owner has no company yet (mid-registration) — clean
            // any leftover cache so we don't subscribe to a ghost.
            localStorage.removeItem("sosphere_company_id");
          }
        } else {
          // No session — demo/offline mode uses a stable derived ID.
          const fallbackId = `demo-${companyName.toLowerCase().replace(/\s+/g, "-")}`;
          initRealtimeChannels(fallbackId);
        }
      } catch {
        // Non-blocking: realtime is enhancement, not requirement
        const fallbackId = `demo-${companyName.toLowerCase().replace(/\s+/g, "-")}`;
        initRealtimeChannels(fallbackId);
      }
    })();
  }, []);

  // ══════════════════════════════════════════════════════════════
  // Zustand Store — single source of truth (replaces 32+ useState)
  // ══════════════════════════════════════════════════════════════
  const {
    // Navigation
    currentPage, sidebarCollapsed, hubTabs,
    setCurrentPage, setSidebarCollapsed, navigateTo,
    setHubTab,
    // Data
    employees, emergencies, zones, activeEmergencyCount, zoneClusters,
    addEmergency, updateEmergency, cancelEmergencyById, tickEmergencyTimers,
    // Auth
    activeRole, authState, companyState,
    setActiveRole,
    // UI
    lang, setLang,
    showCreateEmergency, setShowCreateEmergency,
    showNotifPanel, setShowNotifPanel,
    notifCount, setNotifCount, incrementNotifCount,
    notifUnread, setNotifUnread,
    showGlobalSearch, setShowGlobalSearch,
    // SOS
    dismissedSosIds, dismissSos,
    // Incident Reports
    pendingIncidentReport, setPendingIncidentReport,
    showIncidentReportPanel, setShowIncidentReportPanel,
    // Priority
    showPriorityModal, setShowPriorityModal,
    priorityOverrideTargetId, setPriorityOverrideTargetId,
    // Employee Detail
    selectedEmployee, setSelectedEmployee,
    // Guided Response / IRE
    showGuidedResponse, setShowGuidedResponse,
    guidedEmergencyId, setGuidedEmergencyId,
    showIntelligentGuide, setShowIntelligentGuide,
    ireEmergencyId, setIreEmergencyId,
    directIreContext, setDirectIreContext,
    showGuideQuickPanel, setShowGuideQuickPanel,
    showIreTriagePanel, setShowIreTriagePanel,
    // AI Co-Admin
    showAICoAdmin, setShowAICoAdmin,
    aiCoAdminContext, setAICoAdminContext,
    // Emergency Chat
    showEmergencyChat, setShowEmergencyChat,
    chatEmergencyId, setChatEmergencyId,
    chatEmployeeName, setChatEmployeeName,
    // Cross-Hub Prompt
    crossHubPrompt, setCrossHubPrompt,
    // Misc
    hybridMode, setHybridMode,
    tenantBannerDismissed, setTenantBannerDismissed,
    // Missed Calls
    missedCalls, unseenMissedCallCount, showMissedCallPanel,
    refreshMissedCalls, setShowMissedCallPanel, markMissedCallSeenInStore,
    // Actions
    takeOwnership, handleResolve, handlePinAsActive, handleClearPriority,
    checkPermission, toggleSidebar,
    // Session Timeout
    sessionTimeout,
    // Free Trial
    trialEndsAt, trialDaysLeft, isTrialActive, isTrial: isOnTrial,
    trialBannerDismissed, dismissTrialBanner, refreshTrialState,
    // Trial Blocked Modal (PART D)
    trialBlockedModal, hideTrialBlockedModal,
    // Plan Limit Modal
    planLimitModal, hidePlanLimitModal,
    // Data freshness
    kpis, lastRefreshedAt, isRefreshing, refreshDashboard,
  } = useDashboardStore();

  // ── [SUPABASE_READY] Trial status logging on mount + hourly refresh (PART B + F) ──
  useEffect(() => {
    // PART E: compute data deletion countdown
    const daysSinceExpired = trialEndsAt && !isTrialActive
      ? Math.floor((Date.now() - new Date(trialEndsAt).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const daysUntilDeletion = Math.max(0, 30 - daysSinceExpired);

    console.log("[SUPABASE_READY] trial_status: " + JSON.stringify({
      daysLeft: trialDaysLeft,
      isActive: isTrialActive,
      endsAt: trialEndsAt,
      daysUntilDeletion,
    }));

    // Refresh trial state on mount to recalculate daysLeft
    refreshTrialState();

    // PART B: Refresh every 1 hour to keep daysLeft accurate over long sessions
    const intervalId = setInterval(() => {
      refreshTrialState();
    }, 3600000); // 1 hour

    return () => clearInterval(intervalId);
  }, []);

  // FIX 4: Prototype disclaimer state
  const [protoDisclaimerVisible, setProtoDisclaimerVisible] = useState(true);

  // ── Pre-Shift → Incident source filter bridge ──
  const [incidentSourceFilter, setIncidentSourceFilter] = useState<string | undefined>(undefined);

  // ── Escalated Investigations bridge (Reports → Investigations) ──
  const [pendingInvestigations, setPendingInvestigations] = useState<any[]>([]);

  // ── Risk updates bridge (Investigations → Risk Register) ──
  const [pendingRiskUpdates, setPendingRiskUpdates] = useState<{ riskId: string; update: Record<string, any> }[]>([]);

  // ── Active Safe Walks — real-time tracking ──────────────────────────────────
  const [activeSafeWalks, setActiveSafeWalks] = useState<Array<{
    employeeName: string;
    employeeId: string;
    zone: string;
    startedAt: number;
    guardians: string[];
  }>>([]);

  const handleRiskUpdateFromInvestigation = (riskId: string, update: Record<string, any>) => {
    setPendingRiskUpdates(prev => [...prev, { riskId, update }]);
    console.log("[SUPABASE_READY] risk_update_bridged: " + JSON.stringify({ riskId }));
  };

  const handleEscalateToInvestigation = (newInv: any) => {
    setPendingInvestigations(prev => [...prev, newInv]);
  };

  // ── FIX FATAL-3: Check-in warning state for admin visibility ──
  const [checkinWarnings, setCheckinWarnings] = useState<{
    employeeId: string;
    employeeName: string;
    zone: string;
    warningCycle: number;
    timestamp: number;
    deadlineAt: number;
  }[]>([]);

  // ── CRITICAL FIX 3: Real session timeout with emergency suspension ──
  const sessionTimeoutState = useSessionTimeout({
    timeout: sessionTimeout,
    activeEmergencyCount,
    onLogout,
    enabled: true,
  });

  // Lifecycle Report Email Modal state
  const [showLifecycleEmailModal, setShowLifecycleEmailModal] = useState(false);
  const [lifecycleReportTitle, setLifecycleReportTitle] = useState("");

  // FIX D: Shift Handover State
  const [showHandoverModal, setShowHandoverModal] = useState(false);
  const [handoverNote, setHandoverNote] = useState<string | null>(null);

  // FIX D: Logout Handler with Handover Check
  const handleLogoutWithHandover = () => {
    const activeEmgs = emergencies.filter(e => e.status === "active");
    
    if (activeEmgs.length > 0) {
      setShowHandoverModal(true);
    } else {
      onLogout();
    }
  };

  const t = useT(lang);
  const dir = LANG_META[lang].dir;
  const isAr = lang === "ar";
  const getHubTab = (hub: string) => hubTabs[hub] || HUB_TABS[hub]?.[0]?.id || "";

  // ── Initialize sidebar from webMode ───────────────────────────
  const initializedWebMode = useRef(false);
  useEffect(() => {
    if (!initializedWebMode.current) {
      setSidebarCollapsed(!webMode);
      initializedWebMode.current = true;
    }
  }, [webMode, setSidebarCollapsed]);

  // ── Set owner name from Google OAuth ─────────────────────────
  useEffect(() => {
    if (ownerName && ownerName !== "Admin") {
      useDashboardStore.setState((state: any) => ({
        authState: {
          ...state.authState,
          user: { ...state.authState.user, name: ownerName, nameAr: ownerName },
        }
      }));
    }
  }, [ownerName]);

  // ── Hybrid Mode Sync + Init ───────────────────────────────────
  useEffect(() => {
    setHybridMode(getHybridMode() ? "multi-site" : "single-site");
    const unsub = onHybridModeChange((enabled: boolean) => setHybridMode(enabled ? "multi-site" : "single-site"));
    requestNotificationPermission();
    seedMockEvidence();
    return unsub;
  }, [setHybridMode]);

  // ── Missed Call Sync — Load initial + listen for changes ───────
  useEffect(() => {
    refreshMissedCalls();
    const unsubChange = onMissedCallChange(() => refreshMissedCalls());
    const unsubNotify = onMissedCallNotify((call) => {
      refreshMissedCalls();
      toast.warning(`Missed Call: ${call.employeeName}`, {
        description: `${call.zone || "Unknown zone"} — ${call.missedOn === "desktop" ? "No answer on desktop" : "No answer on phone"}`,
        duration: 6000,
      });
    });
    return () => { unsubChange(); unsubNotify(); };
  }, [refreshMissedCalls]);

  // ── Refs (non-store, component-local) ─────────────────────────
  const knownEmergencyIdsRef = useRef<Set<string>>(new Set(emergencies.map(e => e.id)));
  const receivedReportCountRef = useRef(0);

  // ── Global Search keyboard shortcut ───────────────────────────
  useGlobalSearch(() => setShowGlobalSearch(true));

  // ── Cross-Tab Sync from Mobile App ────────────────────────────
  useEffect(() => {
    const unsub = onSyncEvent((event) => {
      if (event.type === "SOS_TRIGGERED") {
        // FIX AUDIT-2.2: Use mobile's emergencyId as sourceEmergencyId for cancel matching
        const mobileEmgId = event.data?.emergencyId as string | undefined;
        const empObj = employees.find(e => e.name === event.employeeName);
        const newEmergencyId = addEmergency({
          id: mobileEmgId || generateEmergencyId(),
          severity: "critical",
          employeeName: event.employeeName,
          zone: event.zone || "Unknown Zone",
          type: "SOS Button (App)",
          timestamp: new Date(event.timestamp),
          status: "active",
          elapsed: 0,
          sourceEmergencyId: mobileEmgId,
        });

        trackEventSync(newEmergencyId, "admin_notified",
          `Dashboard received SOS from ${event.employeeName} in ${event.zone || "Unknown Zone"}`,
          "System", "System",
          { severity: "critical", type: "SOS Button (App)" });

        // ── AUTO-TRIGGER AI CO-ADMIN on first SOS ──
        // Only auto-open if < 2 active emergencies (prevent UI spam on mass casualty)
        // Feature gate: AI Co-Admin requires Business plan or above
        const activeCount = emergencies.filter(e => e.status === "active").length;
        const aiGate = checkFeatureGate("ai_co_admin", companyState);
        if (activeCount <= 1 && !showAICoAdmin && aiGate.allowed) {
          setTimeout(() => {
            const ctx: AICoAdminContext = {
              emergencyId: newEmergencyId,
              employeeName: event.employeeName,
              employeePhone: empObj?.phone || "",
              zone: event.zone || "Unknown Zone",
              sosType: "SOS Button (App)",
              severity: "critical",
              batteryLevel: event.data?.batteryLevel as number | undefined,
              signalStrength: event.data?.signalStrength as "excellent" | "good" | "fair" | "poor" | "none" | undefined,
              lastGPS: event.data?.lastGPS as { lat: number; lng: number; address?: string } | undefined,
              timestamp: event.timestamp,
              zoneEmployeeCount: employees.filter(emp => emp.zone === (event.zone || "Unknown Zone")).length,
            };
            setAICoAdminContext(ctx);
            setShowAICoAdmin(true);
          }, 2000); // 2s delay to show SOS notification first
        }
      }
      if (event.type === "HAZARD_REPORT") {
        const hazardEmergencyId = generateEmergencyId();
        addEmergency({
          id: hazardEmergencyId,
          severity: "high",
          employeeName: event.employeeName,
          zone: event.zone || "Unknown Zone",
          type: `Hazard: ${event.data?.hazardType || "Environmental"}`,
          timestamp: new Date(event.timestamp),
          status: "active",
          elapsed: 0,
        });

        trackEventSync(hazardEmergencyId, "sos_triggered",
          `Hazard reported by ${event.employeeName}: ${event.data?.hazardType || "Environmental"}`,
          event.employeeName, "Employee",
          { hazardType: event.data?.hazardType });
      }
      if (event.type === "FALL_DETECTED") {
        const fallEmergencyId = generateEmergencyId();
        addEmergency({
          id: fallEmergencyId,
          severity: "critical",
          employeeName: event.employeeName,
          zone: event.zone || "Unknown Zone",
          type: "Fall Detected (Auto)",
          timestamp: new Date(event.timestamp),
          status: "active",
          elapsed: 0,
        });

        trackEventSync(fallEmergencyId, "sos_triggered",
          `Fall detected for ${event.employeeName} in ${event.zone || "Unknown Zone"} (automatic)`,
          "System", "System",
          { detectionMethod: "accelerometer" });
      }
      if (event.type === "SHAKE_SOS") {
        incrementNotifCount();
        toast.warning(`${event.employeeName} — Shake SOS detected`, {
          description: "SOS sequence starting — emergency will appear momentarily",
          duration: 4000,
        });
      }
      if (event.type === "AUDIO_EVIDENCE") incrementNotifCount();
      if (event.type === "EMERGENCY_CHAT") incrementNotifCount();
      if (event.type === "GPS_TRAIL_UPDATE") incrementNotifCount();
      if (event.type === "SOS_CONTACT_ANSWERED") {
        incrementNotifCount();
        toast.success(`${event.data?.contactName || "Contact"} answered — location shared`, { duration: 4000 });
      }
      if (event.type === "SOS_RECORDING_STARTED") {
        incrementNotifCount();
        toast.info("Ambient recording started — evidence capturing", { duration: 3000 });
      }
      if (event.type === "STATUS_UPDATE") {
        toast.success(`${event.employeeName} — status: ${event.data?.status || "safe"}`, { duration: 3000 });
      }
      if (event.type === "INCIDENT_REPORT_RECEIVED") {
        receivedReportCountRef.current += 1;
        incrementNotifCount();
        const d = event.data as any;
        const report: IncidentReportData = {
          emergencyId: d?.emergencyId || event.employeeId || "EMG-UNKNOWN",
          employeeName: event.employeeName || "Unknown Worker",
          zone: event.zone || "Unknown Zone",
          photos: d?.photos || [],
          audioMemo: d?.audioMemo || undefined,
          comment: d?.comment || "",
          severity: d?.severity || "medium",
          incidentType: d?.incidentType || "Other",
          timestamp: event.timestamp || Date.now(),
        };
        setPendingIncidentReport(report);
        setShowIncidentReportPanel(true);
        try {
          storeEvidence({
            emergencyId: report.emergencyId,
            submittedBy: report.employeeName,
            submittedAt: report.timestamp,
            zone: report.zone,
            severity: report.severity,
            incidentType: report.incidentType,
            workerComment: report.comment,
            photos: report.photos.map(p => ({
              id: p.id, dataUrl: p.dataUrl, caption: p.caption, size: p.size,
            })),
            audioMemo: report.audioMemo ? {
              id: report.audioMemo.id,
              dataUrl: report.audioMemo.dataUrl,
              durationSec: report.audioMemo.durationSec,
              format: report.audioMemo.format,
            } : undefined,
            tier: "paid",
            retentionDays: 90,
          });
        } catch {}
        playEmergencyAlert();
      }
      if (event.type === "CHECKIN") incrementNotifCount();
      if (event.type === "STATUS_CHANGE") incrementNotifCount();
      if (event.type === "SOS_CANCELLED") {
        // FIX AUDIT-2.2: Cancel by emergencyId first, name as fallback
        const cancelId = (event.data?.emergencyId as string) || "";
        cancelEmergencyById(cancelId, event.employeeName);
        toast.info(`${event.employeeName} cancelled SOS`, {
          description: "Emergency resolved — cluster re-evaluating",
          duration: 4000,
        });
      }
      if (event.type === "CONNECTION_LOST") {
        incrementNotifCount();
        addEmergency({
          id: generateEmergencyId(),
          severity: "high",
          employeeName: event.employeeName,
          zone: event.zone || "Unknown Zone",
          type: "Connection Lost (Watchdog)",
          timestamp: new Date(event.timestamp),
          status: "active",
          elapsed: 0,
        });
        toast.error(`Connection lost: ${event.employeeName}`, {
          description: `${event.zone || "Unknown zone"} — worker unreachable. Monitor or initiate SAR.`,
          duration: 8000,
        });
      }
      if (event.type === "SAR_ACTIVATED") incrementNotifCount();
      // ── FIX FATAL-2: Battery critical — show admin toast with last known position ──
      if (event.type === "BATTERY_CRITICAL") {
        incrementNotifCount();
        const battLvl = event.data?.batteryLevel ?? "?";
        const lastPos = event.data?.lastPosition as { lat?: number; lng?: number } | undefined;
        toast.error(`🔋 Battery Critical: ${event.employeeName} (${battLvl}%)`, {
          description: lastPos
            ? `Last GPS: ${lastPos.lat?.toFixed(5)}, ${lastPos.lng?.toFixed(5)} — ${event.zone || "Unknown zone"}`
            : `Location unavailable — ${event.zone || "Unknown zone"}`,
          duration: 15000,
        });
        addEmergency({
          id: generateEmergencyId(),
          severity: "high",
          employeeName: event.employeeName,
          zone: event.zone || "Unknown Zone",
          type: `Battery Critical (${battLvl}%)`,
          timestamp: new Date(event.timestamp),
          status: "active",
          elapsed: 0,
        });
      }
      // ── FIX FATAL-3: Check-in warning — admin sees overdue check-ins before SOS ──
      if (event.type === "CHECKIN_WARNING") {
        incrementNotifCount();
        setCheckinWarnings(prev => {
          const warning = {
            employeeId: event.employeeId || "EMP-UNKNOWN",
            employeeName: event.employeeName,
            zone: event.zone || "Unknown Zone",
            warningCycle: (event.data?.warningCycle as number) || 1,
            timestamp: event.timestamp,
            deadlineAt: (event.data?.deadlineAt as number) || 0,
          };
          const exists = prev.find(w => w.employeeId === event.employeeId);
          if (exists) return prev.map(w => w.employeeId === event.employeeId ? warning : w);
          return [...prev, warning];
        });
        toast.warning(`⏰ Check-in Overdue: ${event.employeeName}`, {
          description: `${event.zone || "Unknown zone"} — warning cycle ${event.data?.warningCycle || 1}/2. No response = auto-SOS.`,
          duration: 10000,
        });
      }
      // ── FIX 1: Buddy Alert — forward SOS notification to buddy's mobile via admin signal ──
      if (event.type === "BUDDY_ALERT") {
        const buddyId = event.data?.buddyId as string;
        const buddyName = event.data?.buddyName as string;
        if (buddyId) {
          emitAdminSignal("BUDDY_ALERT", buddyId, {
            sosEmployeeId: event.employeeId,
            sosEmployeeName: event.employeeName,
            sosZone: event.zone,
            emergencyId: event.data?.emergencyId,
          });
          incrementNotifCount();
          toast.warning(`Buddy Alert: ${buddyName || "Buddy"} notified`, {
            description: `${event.employeeName} triggered SOS in ${event.zone || "unknown zone"} — buddy partner alerted`,
            duration: 6000,
          });
        }
      }

      // ── Safe Walk Tracking ────────────────────────────────────────────────────
      if (event.type === "SAFE_WALK_STARTED") {
        setActiveSafeWalks(prev => [
          ...prev.filter(w => w.employeeId !== event.employeeId),
          {
            employeeName: event.employeeName,
            employeeId: event.employeeId || "",
            zone: event.zone || "Unknown",
            startedAt: event.timestamp,
            guardians: (event.data?.guardians as string[]) || [],
          }
        ]);
        incrementNotifCount();
        toast.info(`🚶 ${event.employeeName} started Safe Walk`, {
          description: `Zone: ${event.zone} — ${(event.data?.guardians as string[])?.length || 0} guardian(s) monitoring`,
          duration: 4000,
        });
        console.log("[SUPABASE_READY] safe_walk_started_received: " + event.employeeName);
      }

      if (event.type === "SAFE_WALK_ENDED") {
        setActiveSafeWalks(prev =>
          prev.filter(w => w.employeeId !== event.employeeId)
        );
        const arrivedSafely = event.data?.arrivedSafely;
        toast.success(
          `${event.employeeName} — Safe Walk ${arrivedSafely ? "completed safely ✓" : "ended"}`,
          { duration: 4000 }
        );
        console.log("[SUPABASE_READY] safe_walk_ended_received: " + event.employeeName);
      }

      // ── Buddy Locate Request ──────────────────────────────────────────────────
      if (event.type === "BUDDY_LOCATE_REQUEST") {
        incrementNotifCount();
        toast.info(`📍 Buddy locate: ${event.data?.buddyName || "Unknown"}`, {
          description: `Requested by ${event.employeeName} — Zone: ${event.zone}`,
          duration: 5000,
        });
        console.log("[SUPABASE_READY] buddy_locate_received: " + JSON.stringify(event.data));
      }
    });
    return unsub;
  }, [addEmergency, incrementNotifCount, cancelEmergencyById, setPendingIncidentReport, setShowIncidentReportPanel]);

  // ── Audio Alert System ────────────────────────────────────────
  const playEmergencyAlert = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.setValueAtTime(600, ctx.currentTime + 0.3);
      osc.frequency.setValueAtTime(800, ctx.currentTime + 0.6);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 1);
    } catch (_) { /* silent */ }
  }, []);

  // zoneClusters now computed automatically inside Zustand store (recompute on emergencies change)

  // ── Cluster Detection Alert — plays escalated sound + toast on new cluster ──
  const prevClusterCountRef = useRef(0);
  useEffect(() => {
    if (zoneClusters.length > prevClusterCountRef.current && zoneClusters.length > 0) {
      const worst = zoneClusters.reduce((a, b) => {
        const lvl = { catastrophic: 0, mass_casualty: 1, zone_alert: 2 } as const;
        return (lvl[a.level] ?? 2) <= (lvl[b.level] ?? 2) ? a : b;
      });
      const cfg = CLUSTER_LEVEL_CONFIG[worst.level];
      // Dramatic multi-tone cluster alarm (different from individual SOS)
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.2);
        osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.4);
        osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.6);
        osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.8);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 1.2);
      } catch {}
      toast.error(`${cfg.label}: ${worst.zone}`, {
        description: `${worst.affectedCount} simultaneous SOS — ${cfg.description}`,
        duration: 8000,
      });
    }
    prevClusterCountRef.current = zoneClusters.length;
  }, [zoneClusters]);

  // Emergency timer — uses store action
  useEffect(() => {
    const interval = setInterval(() => tickEmergencyTimers(), 1000);
    return () => clearInterval(interval);
  }, [tickEmergencyTimers]);

  // Priority Engine handlers — aliased from store
  const handleTakeOwnership = takeOwnership;

  // ── Cross-Hub Navigation Prompt ──────────���──��───────────────────
  // crossHubPrompt — now in Zustand store

  // FIX 13: Safe resolve with undo toast — prevents accidental resolution of wrong emergency
  // FIX E: Now activates monitoring mode for minor incidents
  const safeHandleResolve = useCallback((id: string, resolutionType?: "resolved" | "minor" | "monitoring") => {
    const emg = emergencies.find(e => e.id === id);
    const label = emg ? `${emg.employeeName} (${emg.type})` : id;
    
    // FIX E: Activate monitoring mode if minor or monitoring resolution
    if (emg && (resolutionType === "minor" || resolutionType === "monitoring")) {
      const checkInInterval = 30; // minutes
      const monitorDuration = 120; // 2 hours
      const monitoringData = {
        employeeId: emg.employeeId,
        employeeName: emg.employeeName,
        zone: emg.zone,
        checkInInterval,
        nextCheckIn: Date.now() + (checkInInterval * 60 * 1000),
        monitorUntil: Date.now() + (monitorDuration * 60 * 1000),
        reason: emg.type,
        activatedAt: Date.now(),
        activatedBy: authState?.userName || "Admin",
      };
      
      // Save to localStorage
      localStorage.setItem(`monitoring_${emg.employeeId}`, JSON.stringify(monitoringData));
      
      // Emit signal to employee mobile app
      emitSyncEvent({
        type: "MONITORING_ACTIVATED",
        employeeId: emg.employeeId,
        employeeName: emg.employeeName,
        zone: emg.zone,
        timestamp: Date.now(),
        data: monitoringData,
      });
      
      toast.success(`Monitoring activated for ${emg.employeeName}`, {
        description: `30-minute check-ins for next 2 hours`,
        duration: 5000,
      });
    }
    
    handleResolve(id);

    trackEventSync(id, "emergency_resolved",
      `Emergency resolved by admin`,
      "Admin", "Admin");

    // Auto-create investigation for resolved emergencies
    try {
      if (emg) {
        localStorage.setItem("sosphere_new_investigation", JSON.stringify({
          id: emg.id,
          employeeName: emg.employeeName,
          zone: emg.zone,
          type: emg.type,
          severity: emg.severity,
          timestamp: emg.timestamp,
          elapsed: emg.elapsed,
          ownedBy: emg.ownedBy,
        }));
      }
    } catch {}

    toast.success(`Emergency resolved: ${label}`, {
      description: "Click undo within 5s to reverse.",
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          useDashboardStore.getState().updateEmergency(id, { status: "active" as const });
          toast.info("Emergency reactivated");
          // Also clear monitoring if it was activated
          if (emg && (resolutionType === "minor" || resolutionType === "monitoring")) {
            localStorage.removeItem(`monitoring_${emg.employeeId}`);
          }
        },
      },
    });
  }, [emergencies, handleResolve, authState]);

  // handlePinAsActive, handleClearPriority — from Zustand store

  // ���─ RBAC-Gated Create Emergency ─────────────────────────────
  const handleOpenCreateEmergency = useCallback(() => {
    if (!checkPermission("emergency:create")) return;
    if (!canCreateEmgBilling(companyState)) return;
    setShowCreateEmergency(true);
  }, [checkPermission, companyState, setShowCreateEmergency]);

  // ── Manual Priority Override via Modal ───────────────────────
  const handleRequestPriorityOverride = useCallback((id: string, _reason?: string) => {
    setPriorityOverrideTargetId(id);
    setShowPriorityModal(true);
  }, [setPriorityOverrideTargetId, setShowPriorityModal]);

  const handleConfirmPriorityOverride = useCallback((reason: string) => {
    if (!priorityOverrideTargetId) return;
    handlePinAsActive(priorityOverrideTargetId, reason);
    setShowPriorityModal(false);
    setPriorityOverrideTargetId(null);
  }, [priorityOverrideTargetId, handlePinAsActive, setShowPriorityModal, setPriorityOverrideTargetId]);

  // ── Detect NEW emergencies → SOS Popup + Audio ──────────────
  useEffect(() => {
    const currentIds = new Set(emergencies.map(e => e.id));
    emergencies.forEach(e => {
      if (!knownEmergencyIdsRef.current.has(e.id)) {
        knownEmergencyIdsRef.current.add(e.id);
        playEmergencyAlert();
      }
    });
    // Cleanup removed IDs
    knownEmergencyIdsRef.current.forEach(id => {
      if (!currentIds.has(id)) knownEmergencyIdsRef.current.delete(id);
    });
  }, [emergencies, playEmergencyAlert]);

  // FIX E: Check for missed monitoring check-ins
  useEffect(() => {
    const interval = setInterval(() => {
      const allKeys = Object.keys(localStorage);
      const monitoringKeys = allKeys.filter(k => k.startsWith("monitoring_"));
      
      monitoringKeys.forEach(key => {
        const data = JSON.parse(localStorage.getItem(key) || "{}");
        if (data.nextCheckIn && Date.now() > data.nextCheckIn + (5 * 60 * 1000)) {
          // Missed check-in by more than 5 minutes
          emitSyncEvent({
            type: "MONITORING_MISSED",
            employeeId: data.employeeId,
            employeeName: data.employeeName,
            zone: data.zone,
            timestamp: Date.now(),
            data: {
              missedBy: Math.floor((Date.now() - data.nextCheckIn) / 60000),
              lastCheckIn: data.nextCheckIn - (data.checkInInterval * 60 * 1000),
            },
          });
          
          toast.error(`⚠️ ${data.employeeName} missed check-in`, {
            description: `Monitoring mode — last check-in ${Math.floor((Date.now() - data.nextCheckIn) / 60000)} min ago`,
            duration: 10000,
          });
          
          // Clear monitoring after alert
          localStorage.removeItem(key);
        }
        
        // Auto-clear monitoring if period ended
        if (data.monitorUntil && Date.now() > data.monitorUntil) {
          localStorage.removeItem(key);
          emitSyncEvent({
            type: "MONITORING_CLEARED",
            employeeId: data.employeeId,
            employeeName: data.employeeName,
            zone: data.zone,
            timestamp: Date.now(),
            data: { reason: "period_ended" },
          });
        }
      });
    }, 30000); // Check every 30 seconds
    
    return () => clearInterval(interval);
  }, []);

  // FIX J: Monitor for critical risk scores and auto-alert admin
  useEffect(() => {
    const interval = setInterval(() => {
      employees.forEach(emp => {
        const riskScore = calculateRiskScore({
          id: emp.id,
          name: emp.name,
          joinDate: (emp as any).joinDate || Date.now(),
          hasBuddy: !!(emp as any).buddyId,
          checkInInterval: (emp as any).checkInInterval || 120,
          batteryLevel: getLastEmployeeSync(emp.id)?.battery || 100,
          isWorkingAlone: false,
          shift: new Date().getHours() >= 20 || new Date().getHours() < 6 ? "night" : "day",
        });
        
        if (riskScore.totalScore >= 80) {
          const alertKey = `risk_alert_${emp.id}_${Math.floor(Date.now() / 3600000)}`;
          if (!localStorage.getItem(alertKey)) {
            localStorage.setItem(alertKey, "1");
            
            toast.error(`🚨 Critical Risk: ${emp.name}`, {
              description: `Risk Score: ${riskScore.totalScore}/100 - ${getRiskLabel(riskScore.level)}`,
              duration: 15000,
            });
            
            emitSyncEvent({
              type: "STATUS_UPDATE",
              employeeId: emp.id,
              employeeName: emp.name,
              zone: emp.zone,
              timestamp: Date.now(),
              data: {
                riskScore: riskScore.totalScore,
                riskLevel: riskScore.level,
                riskFactors: riskScore.factors,
                suggestions: riskScore.suggestions,
              },
            });
          }
        }
      });
    }, 60000); // Check every 60 seconds
    
    return () => clearInterval(interval);
  }, [employees]);

  // ── Build SOSEmployee list for popup ─────────────────────────
  const sosPopupEmployees: SOSEmployee[] = useMemo(() => 
    emergencies
      .filter(e => e.status === "active" && !dismissedSosIds.has(e.id))
      .map(e => {
        const emp = employees.find(emp => emp.name === e.employeeName);
        return {
          id: e.id,
          name: e.employeeName,
          role: emp?.role || "Employee",
          department: emp?.department || "Unknown",
          phone: emp?.phone || "+966 5X XXX XXXX",
          zone: e.zone,
          // FIX 2: Real battery/signal from last sync event
          batteryLevel: (() => { const sync = getLastEmployeeSync(emp?.id || ""); return sync?.battery ?? null; })(),
          signalStrength: (() => { const sync = getLastEmployeeSync(emp?.id || ""); const s = sync?.signal; return s === "excellent" ? "excellent" : s === "good" ? "good" : s === "poor" ? "poor" : "good"; })() as "excellent" | "good" | "fair" | "poor",
          elapsedSeconds: e.elapsed,
          status: e.status,
          triggeredAt: e.timestamp,
          sosType: e.type.includes("SOS") ? "sos_button" : e.type.includes("Geofence") ? "geofence" : e.type.includes("Hazard") ? "hazard" : "missed_checkin",
          // Medical data — read from employee profile (if stored during onboarding)
          bloodType: (emp as any)?.bloodType || undefined,
          allergies: (emp as any)?.allergies || undefined,
          medications: (emp as any)?.medications || undefined,
          conditions: (emp as any)?.conditions || undefined,
        };
      }),
    [emergencies, dismissedSosIds, employees]
  );

  // FIX 1: Compute locked tabs per hub based on plan
  // Emergency override: when active emergencies exist, unlock history + command
  const hasActiveEmergency = emergencies.length > 0;
  const emergencyHubLockedTabs = new Set<string>();
  if (!hasActiveEmergency && !hasFeature(companyState, "incident_history")) emergencyHubLockedTabs.add("history");
  if (!hasActiveEmergency && !hasFeature(companyState, "command_center")) emergencyHubLockedTabs.add("command");

  const governanceLockedTabs = new Set<string>();
  if (!hasFeature(companyState, "audit_logs")) governanceLockedTabs.add("audit");

  const reportsLockedTabs = new Set<string>();
  if (!hasFeature(companyState, "advanced_analytics")) reportsLockedTabs.add("analytics");
  if (!hasFeature(companyState, "custom_reports")) reportsLockedTabs.add("reports");

  return (
    <div dir={dir} className={`relative ${webMode ? "flex flex-row" : "flex flex-col"} h-full`} style={{ background: "#0A0E17" }}>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#0A1220",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#fff",
            fontFamily: "'Outfit', sans-serif",
            fontSize: 13,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          },
        }}
      />
      {/* ── CRITICAL FIX 3: Session timeout warning banner ── */}
      <SessionTimeoutWarning
        secondsLeft={sessionTimeoutState.warningSecondsLeft}
        isVisible={sessionTimeoutState.showWarning}
        isSuspended={sessionTimeoutState.isSuspended}
        onStayLoggedIn={sessionTimeoutState.resetTimer}
      />
      {/* AUTH-5 P4 (#175): live trial countdown / past_due / DPA renewal.
          Reads server-of-truth via get_company_subscription_state RPC,
          NEVER trusts localStorage for billing decisions. The banner
          self-hides for everything except the four states it knows
          about, so we can mount it unconditionally and let it decide. */}
      <LiveTrialBanner companyId={typeof window !== "undefined" ? localStorage.getItem("sosphere_company_id") : null} />
      {/* FIX 3: Trial Expired Overlay — blocks all pages except Settings + Billing */}
      {isTrialExpired(companyState) && isPageBlockedByTrial(currentPage, companyState) && (
        <TrialExpiredOverlay
          companyState={companyState}
          employeeCount={employees.length}
          onChoosePlan={() => setCurrentPage("billing")}
          onExportData={() => {
            // FIX 3: Real CSV export of all localStorage data
            try {
              const rows: string[][] = [["Category", "Key", "Value"]];
              // Employees
              employees.forEach(emp => {
                rows.push(["Employee", emp.name, `${emp.role} | ${emp.zone} | ${emp.status} | ${emp.phone || "N/A"}`]);
              });
              // Emergency history
              emergencies.forEach(emg => {
                rows.push(["Emergency", emg.id, `${emg.employeeName} | ${emg.zone} | ${emg.type} | ${emg.severity} | ${emg.status} | ${emg.timestamp}`]);
              });
              // Zones
              zones.forEach(z => {
                rows.push(["Zone", z.name, `Risk: ${z.risk} | Workers: ${z.workers} | ID: ${z.id}`]);
              });
              // Settings from localStorage
              const settingsRaw = localStorage.getItem("company_settings");
              if (settingsRaw) rows.push(["Settings", "company_settings", settingsRaw]);
              const regRaw = localStorage.getItem("sos_reg_result");
              if (regRaw) rows.push(["Settings", "sos_reg_result", regRaw]);
              // Build CSV
              const csvContent = rows.map(row =>
                row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")
              ).join("\n");
              const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `sosphere-data-export-${new Date().toISOString().split("T")[0]}.csv`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
              toast.success("Data exported successfully", {
                description: `${rows.length - 1} records saved to CSV`,
              });
            } catch (err) {
              toast.error("Export failed", { description: "Could not generate CSV file" });
            }
          }}
        />
      )}
      {/* Trial Blocked Modal (PART D) — shown when add employee/zone is blocked */}
      <AnimatePresence>
        {trialBlockedModal?.show && (
          <TrialBlockedModal
            type={trialBlockedModal.type}
            message={trialBlockedModal.message}
            onUpgrade={() => navigateTo("billing")}
            onClose={hideTrialBlockedModal}
          />
        )}
      </AnimatePresence>
      {/* Plan Limit Modal — shown when zone/employee limit reached */}
      <AnimatePresence>
        {planLimitModal?.show && (
          <PlanLimitModal
            type={planLimitModal.type}
            limitResult={
              planLimitModal.type === "zone"
                ? checkZoneLimit(zones.length, companyState)
                : checkEmployeeLimit(employees.length, companyState)
            }
            onUpgrade={() => navigateTo("billing")}
            onClose={hidePlanLimitModal}
          />
        )}
      </AnimatePresence>
      {/* Sidebar */}
      <DashSidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        collapsed={sidebarCollapsed}
        onToggle={() => toggleSidebar()}
        companyName={companyName}
        activeEmergencyCount={activeEmergencyCount}
        t={t}
        authState={authState}
        companyState={companyState}
        webMode={webMode}
        hybridMode={hybridMode}
        onGuideMe={() => {
          const activeList = emergencies.filter(e => e.status === "active");
          if (activeList.length === 0) {
            // No active emergency → show Guide Me Quick Panel
            setShowGuideQuickPanel(true);
          } else if (activeList.length === 1) {
            // Single emergency → Unified Engine auto-routes based on severity + plan
            // No manual routing needed — the engine decides internally
            const emg = activeList[0];
            setIreEmergencyId(emg.id);
            setShowIntelligentGuide(true);
          } else {
            // Multiple emergencies → show triage screen first
            setShowIreTriagePanel(true);
          }
        }}
        zoneClusters={zoneClusters}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden"
        style={{ marginLeft: 0, background: "linear-gradient(180deg, rgba(5,7,14,1) 0%, rgba(8,12,22,1) 100%)" }}>

        {/* Topbar */}
        <DashTopbar
          currentPage={currentPage}
          notifCount={notifCount}
          notifUnread={notifUnread}
          onOpenNotifs={() => setShowNotifPanel(true)}
          onToggleSidebar={() => toggleSidebar()}
          onLogout={handleLogoutWithHandover}
          companyName={companyName}
          t={t}
          lang={lang}
          onLangChange={setLang}
          webMode={webMode}
          missedCallCount={unseenMissedCallCount}
          onOpenMissedCalls={() => setShowMissedCallPanel(true)}
          isRefreshing={isRefreshing}
          lastRefreshedAt={lastRefreshedAt}
          onManualRefresh={refreshDashboard}
        />

        {/* Emergency Queue Bar — compact, only when not on emergency hub or overview */}
        {currentPage !== "overview" && currentPage !== "emergencyHub" && sosPopupEmployees.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="flex items-center gap-3 px-5 py-2.5"
            style={{ background: "linear-gradient(90deg, rgba(255,45,85,0.06), rgba(255,45,85,0.02))", borderBottom: "1px solid rgba(255,45,85,0.08)" }}
          >
            <motion.div
              animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="size-2 rounded-full" style={{ background: "#FF2D55", boxShadow: "0 0 8px rgba(255,45,85,0.5)" }}
            />
            <span style={{ fontSize: 11, color: "#FF2D55", fontWeight: 700, letterSpacing: "-0.005em" }}>
              {sosPopupEmployees.length} Active Emergency{sosPopupEmployees.length > 1 ? "ies" : ""}
            </span>
            <button
              onClick={() => setCurrentPage("emergencyHub")}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg"
              style={{ fontSize: 10, color: "#FF2D55", background: "rgba(255,45,85,0.08)", fontWeight: 700, border: "1px solid rgba(255,45,85,0.12)" }}
            >
              Emergency Hub <ArrowUpRight className="size-3" />
            </button>
          </motion.div>
        )}

        {/* Page content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: "none" }}>
          <div className="pb-6">
            {/* ── Trial Banner — shows when on trial ── */}
            <AnimatePresence>
              {isOnTrial && (!trialBannerDismissed || (trialDaysLeft <= 0 && !isTrialActive)) && (
                <TrialBanner
                  daysLeft={trialDaysLeft}
                  isActive={isTrialActive}
                  trialEndsAt={trialEndsAt}
                  onUpgrade={() => navigateTo("billing")}
                  onDismiss={dismissTrialBanner}
                />
              )}
            </AnimatePresence>

            {/* ── Hazard Alert Banner — Inline in content flow ── */}
            <HazardAlertBanner
              onNavigate={(page) => navigateTo(page)}
              t={t}
              inline
            />

            {/* ── Tenant Banner — Inline in content flow ── */}
            {!tenantBannerDismissed && (
              <TenantBanner
                companyState={companyState}
                onDismiss={() => setTenantBannerDismissed(true)}
                onUpgrade={() => setCurrentPage("settings")}
                t={t}
                inline
              />
            )}

            {/* Smart Admin Hints — contextual guidance */}
            <AdminHintBar
              currentPage={currentPage}
              hasActiveEmergency={emergencies.some(e => e.status === "active")}
              onNavigate={(page) => navigateTo(page)}
            />
            <AnimatePresence mode="wait">
              <motion.div
                key={currentPage}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                {currentPage === "overview" && (
                  <PageErrorBoundary label="Overview">
                  <OverviewPage
                    emergencies={emergencies}
                    employees={employees}
                    zones={zones}
                    onNavigate={navigateTo}
                    onResolve={safeHandleResolve}
                    onTakeOwnership={handleTakeOwnership}
                    onPinAsActive={handleRequestPriorityOverride}
                    onClearPriority={handleClearPriority}
                    t={t}
                    webMode={webMode}
                  />
                  </PageErrorBoundary>
                )}
                {currentPage === "riskMap" && <PlanGate feature="risk_map" companyState={companyState} onUpgrade={() => navigateTo("billing")}><div><EnterprisePageHeader page="riskMap" /><RiskMapLivePage t={t} /></div></PlanGate>}
                {/* Billing header removed — accessed via Settings sub-tab; breadcrumb provides context */}
                {currentPage === "billing" && <div><BillingPage companyState={companyState} webMode={webMode} /><PricingPage webMode={webMode} currentStatus={toAccountStatus(companyState.company.billingStatus, trialDaysRemaining(companyState))} trialDays={trialDaysRemaining(companyState)} /></div>}
                {currentPage === "settings" && <div><SettingsPage companyName={companyName} t={t} lang={lang} onLangChange={setLang} activeRole={activeRole} onRoleChange={setActiveRole} authState={authState} companyState={companyState} onNavigate={navigateTo} webMode={webMode} /></div>}
                {/* geofencing & gpsCompliance now redirect to "location" via PAGE_ALIASES */}
                {/* ══ HUB: Emergency Hub — Active | SAR | Playbook ���═ */}
                {currentPage === "emergencyHub" && (
                  <PageErrorBoundary label="Emergency Hub">
                  <div>
                    <EnterprisePageHeader page="emergencyHub" activeEmergencyCount={activeEmergencyCount} />
                    <HubTabBar hubId="emergencyHub" activeTab={getHubTab("emergencyHub")} onTabChange={(tab) => setHubTab("emergencyHub", tab)} lockedTabs={emergencyHubLockedTabs} />
                    <AnimatePresence mode="wait">
                      <motion.div key={getHubTab("emergencyHub")} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
                        {getHubTab("emergencyHub") === "active" && <EmergenciesPage emergencies={emergencies} onResolve={safeHandleResolve} onCreate={handleOpenCreateEmergency} t={t} webMode={webMode} onLaunchSAR={() => { setHubTab("emergencyHub", "sar"); }} />}
                        {getHubTab("emergencyHub") === "reports" && <IncidentReportsTab webMode={webMode} onEscalateToInvestigation={handleEscalateToInvestigation} />}
                        {getHubTab("emergencyHub") === "history" && (hasActiveEmergency ? <div><div className="flex items-center gap-2 px-4 py-2 mb-3 rounded-xl" style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)" }}><span style={{ fontSize: 12, fontWeight: 600, color: "#FF2D55" }}>⚡ Emergency override — full access active</span></div><IncidentHistoryPage t={t} webMode={webMode} /></div> : <PlanGate feature="incident_history" companyState={companyState} onUpgrade={() => navigateTo("billing")} compact><IncidentHistoryPage t={t} webMode={webMode} /></PlanGate>)}
                        {getHubTab("emergencyHub") === "command" && (hasActiveEmergency ? <div><div className="flex items-center gap-2 px-4 py-2 mb-3 rounded-xl" style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)" }}><span style={{ fontSize: 12, fontWeight: 600, color: "#FF2D55" }}>⚡ Emergency override — full access active</span></div><CommandCenterPage t={t} /></div> : <PlanGate feature="command_center" companyState={companyState} onUpgrade={() => navigateTo("billing")} compact><CommandCenterPage t={t} /></PlanGate>)}
                        {getHubTab("emergencyHub") === "sar" && <SARProtocolPage />}
                        {getHubTab("emergencyHub") === "playbook" && <EmergencyPlaybookPage t={t} webMode={webMode} />}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  </PageErrorBoundary>
                )}

                {/* ══ HUB: Operations — Journeys | Workforce | Comms | Connectivity ══ */}
                {currentPage === "operations" && (
                  <PageErrorBoundary label="Operations Hub">
                  <div>
                    <EnterprisePageHeader page="operations" />
                    {/* ── Active Safe Walks Panel ── */}
                    {activeSafeWalks.length > 0 && (
                      <div
                        className="mx-4 mb-3 px-4 py-3 rounded-xl"
                        style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.15)" }}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <motion.div
                            animate={{ opacity: [1, 0.3, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                            className="size-2 rounded-full"
                            style={{ background: "#00C8E0" }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#00C8E0" }}>
                            Active Safe Walks ({activeSafeWalks.length})
                          </span>
                        </div>
                        {activeSafeWalks.map((walk, i) => (
                          <div
                            key={walk.employeeId}
                            className="flex items-center justify-between py-2"
                            style={{
                              borderBottom: i < activeSafeWalks.length - 1
                                ? "1px solid rgba(255,255,255,0.04)"
                                : "none"
                            }}
                          >
                            <div>
                              <p style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.85)" }}>
                                {walk.employeeName}
                              </p>
                              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                                {walk.zone} · {walk.guardians.length} guardian(s)
                              </p>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <p style={{ fontSize: 11, color: "#00C8E0" }}>
                                {Math.floor((Date.now() - walk.startedAt) / 60000)}m ago
                              </p>
                              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>In progress</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* FIX 4: GPS Stopped warning banner */}
                    {!getTrackerState().isTracking && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                        className="mx-4 mb-2 px-4 py-3 rounded-xl flex items-center justify-between gap-3"
                        style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.15)" }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span style={{ fontSize: 14 }}>⚠️</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#FF2D55", lineHeight: 1.35 }}>
                            GPS tracking is inactive — employee locations may be inaccurate
                          </span>
                        </div>
                        <button
                          onClick={() => { startGPSTracking(); }}
                          className="shrink-0 px-3 py-1.5 rounded-lg"
                          style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "rgba(255,45,85,0.85)", border: "1px solid rgba(255,45,85,0.4)" }}
                        >
                          Start GPS Tracking
                        </button>
                      </motion.div>
                    )}
                    <HubTabBar hubId="operations" activeTab={getHubTab("operations")} onTabChange={(tab) => setHubTab("operations", tab)} />
                    <AnimatePresence mode="wait">
                      <motion.div key={getHubTab("operations")} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
                        {getHubTab("operations") === "missions" && <MissionControlPage />}
                        {getHubTab("operations") === "journey" && <JourneyManagementPage t={t} webMode={webMode} onGuideMe={(journeyId, empName) => {
                          setDirectIreContext({ emergencyId: journeyId, employeeName: empName, zone: "Route Zone", sosType: "journey_sos", severity: "high", elapsed: 45, batteryLevel: 62, signalStrength: "fair", isJourney: true, journeyRoute: "HQ to Site Alpha", lastGPS: { lat: 25.2048, lng: 55.2708 } });
                          setShowIntelligentGuide(true);
                        }} onLaunchSAR={() => { setCurrentPage("emergencyHub"); setHubTab("emergencyHub", "sar"); }} />}
                        {getHubTab("operations") === "workforce" && <WorkforcePage t={t} webMode={webMode} checkinWarnings={checkinWarnings} />}
                        {getHubTab("operations") === "comms" && <CommsHubPage t={t} webMode={webMode} />}
                        {getHubTab("operations") === "offline" && <OfflineMonitoringPage />}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  </PageErrorBoundary>
                )}

                {/* ══ HUB: People & Teams — Directory | Buddy | Checklist | Score ══ */}
                {currentPage === "people" && (
                  <PageErrorBoundary label="People & Teams">
                  <div>
                    <HubTabBar hubId="people" activeTab={getHubTab("people")} onTabChange={(tab) => setHubTab("people", tab)} />
                    <AnimatePresence mode="wait">
                      <motion.div key={getHubTab("people")} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
                        {getHubTab("people") === "directory" && <UnifiedEmployeesPage employees={employees} t={t} webMode={webMode} onEmployeeSelect={setSelectedEmployee} onNavigate={(page) => navigateTo(page)} />}
                        {getHubTab("people") === "buddy" && <BuddySystemPage t={t} webMode={webMode} />}
                        {getHubTab("people") === "checklist" && <PreShiftChecklistPage t={t} webMode={webMode} onNavigateToFlagged={() => { setIncidentSourceFilter("Pre-Shift Checklist"); setCurrentPage("incidentRisk" as any); setHubTab("incidentRisk" as any, "investigation"); }} />}
                        {getHubTab("people") === "score" && <SafetyGamificationPage t={t} webMode={webMode} />}
                        {/* E1.6: live Background Jobs page (subscribes to async_job_metadata via Realtime) */}
                        {getHubTab("people") === "jobs" && <DashboardJobsPage />}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  </PageErrorBoundary>
                )}

                {/* ══ HUB: Incident & Risk — Investigation | Risk Register ══ */}
                {currentPage === "incidentRisk" && (
                  <PageErrorBoundary label="Incident & Risk">
                  <div>
                    <EnterprisePageHeader page="incidentRisk" />
                    <HubTabBar hubId="incidentRisk" activeTab={getHubTab("incidentRisk")} onTabChange={(tab) => setHubTab("incidentRisk", tab)} />
                    <AnimatePresence mode="wait">
                      <motion.div key={getHubTab("incidentRisk")} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
                        {getHubTab("incidentRisk") === "investigation" && <IncidentInvestigationPage key={incidentSourceFilter || "default"} t={t} webMode={webMode} initialSourceFilter={incidentSourceFilter} pendingInvestigations={pendingInvestigations} onRiskUpdate={handleRiskUpdateFromInvestigation} />}
                        {getHubTab("incidentRisk") === "register" && <RiskRegisterPage t={t} webMode={webMode} pendingRiskUpdates={pendingRiskUpdates} />}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  </PageErrorBoundary>
                )}

                {/* ══ HUB: Reports & Analytics — Reports | Analytics | Leaderboard | Scheduler ══ */}
                {currentPage === "reportsAnalytics" && (
                  <PageErrorBoundary label="Reports & Analytics">
                  <div>
                    <EnterprisePageHeader page="reportsAnalytics" />
                    <HubTabBar hubId="reportsAnalytics" activeTab={getHubTab("reportsAnalytics")} onTabChange={(tab) => setHubTab("reportsAnalytics", tab)} lockedTabs={reportsLockedTabs} />
                    <AnimatePresence mode="wait">
                      <motion.div key={getHubTab("reportsAnalytics")} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
                        {getHubTab("reportsAnalytics") === "reports" && <PlanGate feature="custom_reports" companyState={companyState} onUpgrade={() => navigateTo("billing")} compact><ComplianceReportsPage t={t} webMode={webMode} /></PlanGate>}
                        {getHubTab("reportsAnalytics") === "analytics" && <PlanGate feature="advanced_analytics" companyState={companyState} onUpgrade={() => navigateTo("billing")} compact><AnalyticsPage t={t} webMode={webMode} /></PlanGate>}
                        {getHubTab("reportsAnalytics") === "leaderboard" && <LeaderboardPage t={t} webMode={webMode} onNavigateToTraining={() => window.open("/training", "_blank")} />}
                        {getHubTab("reportsAnalytics") === "scheduler" && <BatchEmailScheduler t={t} webMode={webMode} />}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  </PageErrorBoundary>
                )}

                {/* ══ HUB: Governance — Audit | Roles ══ */}
                {currentPage === "governance" && (
                  <PageErrorBoundary label="Governance">
                  <div>
                    <EnterprisePageHeader page="governance" />
                    <HubTabBar hubId="governance" activeTab={getHubTab("governance")} onTabChange={(tab) => setHubTab("governance", tab)} lockedTabs={governanceLockedTabs} />
                    <AnimatePresence mode="wait">
                      <motion.div key={getHubTab("governance")} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
                        {getHubTab("governance") === "audit" && <PlanGate feature="audit_logs" companyState={companyState} onUpgrade={() => navigateTo("billing")} compact><AuditLogPage t={t} webMode={webMode} /></PlanGate>}
                        {getHubTab("governance") === "roles" && <RolesPermissionsPage t={t} webMode={webMode} onNavigate={(page) => navigateTo(page)} />}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  </PageErrorBoundary>
                )}

                {/* ══ Truly Standalone pages (not inside any hub) ══ */}
                {currentPage === "location" && <div><EnterprisePageHeader page="location" /><LocationZonesPage t={t} webMode={webMode} /></div>}
                {currentPage === "csvGuide" && <CSVFieldGuide standalone onClose={() => navigateTo("people")} />}
                {/* FIX 1: Removed EnterprisePageHeader — Site Risk Intelligence card inside page is the title */}
                {currentPage === "safetyIntel" && <div><SafetyIntelligencePage t={t} webMode={webMode} employees={employees} onNavigate={(page, tab) => { if (tab) { setHubTab(page, tab); } navigateTo(page as any); }} onOpenEmployeeDetail={(empId) => { const emp = employees.find(e => e.id === empId); if (emp) setSelectedEmployee(emp); }} /></div>}
                {currentPage === "weatherAlerts" && <div><EnterprisePageHeader page="weatherAlerts" /><WeatherAlertsPage t={t} webMode={webMode} /></div>}
                {currentPage === "rrpAnalytics" && <div><EnterprisePageHeader page="rrpAnalytics" /><RRPAnalyticsPage t={t} webMode={webMode} /></div>}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Create Emergency Drawer */}
      <AnimatePresence>
        {showCreateEmergency && (
          <CreateEmergencyDrawer
            t={t}
            onClose={() => setShowCreateEmergency(false)}
            onCreate={(data) => {
              const newEmg: EmergencyItem = {
                id: generateEmergencyId(),
                severity: data.severity,
                employeeName: data.employeeName || "Manual Report",
                zone: data.zone,
                type: data.type,
                timestamp: new Date(),
                status: "active",
                elapsed: 0,
              };
              addEmergency(newEmg);
              setShowCreateEmergency(false);
              setCurrentPage("overview");
            }}
          />
        )}
      </AnimatePresence>

      {/* HazardAlertBanner & TenantBanner — moved into content flow below */}

      {/* ── Manual Priority Override Modal ── */}
      <ManualPriorityModal
        isOpen={showPriorityModal}
        emergencyId={priorityOverrideTargetId || ""}
        currentPosition={priorityOverrideTargetId ? emergencies.findIndex(e => e.id === priorityOverrideTargetId) : 0}
        onConfirm={handleConfirmPriorityOverride}
        onCancel={() => { setShowPriorityModal(false); setPriorityOverrideTargetId(null); }}
        t={t}
      />

      {/* ── SOS Emergency Popup — Floating card (replaces red bar + command bar) ── */}
      <AnimatePresence>
        {sosPopupEmployees.length > 0 && (
          <SOSEmergencyPopup
            emergencies={sosPopupEmployees}
            adminName="Admin"
            onCall={(id) => {
              const emg = emergencies.find(e => e.id === id);
              const emp = emg ? employees.find(e => e.name === emg.employeeName) : null;
              if (emp?.phone) safeTelCall(emp.phone, emp.name);
            }}
            onViewLocation={(id) => setCurrentPage("riskMap")}
            onAcknowledge={(id) => {
              updateEmergency(id, { status: "responding" as const });
            }}
            onGuideMe={(id) => {
              // Open AI Co-Admin — Full emergency response automation
              // Feature gate: AI Co-Admin requires Business plan or above
              const aiGateCheck = checkFeatureGate("ai_co_admin", companyState);
              if (!aiGateCheck.allowed) {
                toast.error(`AI Co-Admin requires ${aiGateCheck.requiredPlanLabel} plan`, {
                  description: `Upgrade to ${aiGateCheck.requiredPlanLabel} ($${aiGateCheck.requiredPlanPrice}/mo) to unlock AI Co-Admin`,
                });
                navigateTo("billing");
                return;
              }
              const emg = emergencies.find(e => e.id === id);
              if (emg) {
                const ctx: AICoAdminContext = {
                  emergencyId: emg.id,
                  employeeName: emg.employeeName,
                  employeePhone: emg.phone || "",
                  zone: emg.zone,
                  sosType: emg.type,
                  severity: emg.severity as "critical" | "high" | "medium" | "low",
                  batteryLevel: emg.batteryLevel,
                  signalStrength: emg.signalStrength as "excellent" | "good" | "fair" | "poor" | "none",
                  lastGPS: emg.location ? { lat: emg.location.lat, lng: emg.location.lng, address: emg.location.address } : undefined,
                  timestamp: emg.timestamp,
                  zoneEmployeeCount: employees.filter(emp => emp.zone === emg.zone).length,
                };
                setAICoAdminContext(ctx);
                setShowAICoAdmin(true);
              }
            }}

            onViewFull={(id) => {
              // Navigate to Emergency Hub for full details
              setCurrentPage("emergencyHub");
            }}
            onLaunchSAR={(id) => {
              // Navigate to SAR tab in Emergency Hub
              setCurrentPage("emergencyHub");
              setHubTab("emergencyHub", "sar");
            }}
            onDismiss={(id) => dismissSos(id)}
          />
        )}
      </AnimatePresence>

      {/* RBAC Role Chip removed — redundant with sidebar user profile */}

      {/* ── Employee Detail Drawer ── */}
      {selectedEmployee && (
        <EmployeeDetailDrawer
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
          webMode={webMode}
        />
      )}

      {/* Global Quick Actions */}
      <GlobalQuickActions
        onCreateEmergency={handleOpenCreateEmergency}
        onBroadcast={() => navigateTo("comms")}
        onEvacuation={() => navigateTo("comms")}
        onSearch={() => setShowGlobalSearch(true)}
      />

      {/* ── Admin Call System — Incoming + Active call overlays ── */}
      {/* Suppress when SOSEmergencyPopup is already handling calls to prevent dual-overlay conflict */}
      {sosPopupEmployees.length === 0 && <AdminCallSystem />}

      {/* ── Incident Report Review Panel — Admin reviews photos + can broadcast ── */}
      <AnimatePresence>
        {showIncidentReportPanel && pendingIncidentReport && (
          <motion.div
            key="incident-report-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowIncidentReportPanel(false); }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 30 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto rounded-2xl"
            >
              <AdminBroadcastPanel
                report={pendingIncidentReport}
                companyName={companyName}
                onBroadcast={(payload) => {
                  // Record in Evidence Vault
                  try {
                    const allEvd = getAllEvidence();
                    const latest = allEvd.find(e => e.emergencyId === pendingIncidentReport.emergencyId);
                    if (latest) {
                      updateEvidenceStatus(latest.id, "broadcast", "Admin", "HSE Manager");
                      addEvidenceAction(latest.id, {
                        actor: "Admin", role: "HSE Manager",
                        action: `Broadcast sent to ${payload.broadcastTo} — ${payload.priority} priority`,
                        actionType: "broadcast",
                        details: payload.broadcastMessage.slice(0, 100),
                      });
                    }
                  } catch {}
                  toast.success("Safety Warning Broadcast", {
                    description: `Alert sent to ${payload.broadcastTo === "all" ? "all employees" : payload.broadcastTo === "zone" ? pendingIncidentReport.zone : "department"} — ${payload.priority} priority`,
                  });
                  setShowIncidentReportPanel(false);
                  setPendingIncidentReport(null);
                }}
                onForwardToOwner={(report) => {
                  try {
                    const allEvd2 = getAllEvidence();
                    const latest2 = allEvd2.find(e => e.emergencyId === report.emergencyId);
                    if (latest2) {
                      addEvidenceAction(latest2.id, {
                        actor: "Admin", role: "HSE Manager",
                        action: "Forwarded to company owner",
                        actionType: "forwarded",
                      });
                    }
                  } catch {}
                  toast.success("Report Forwarded to Owner", {
                    description: `Incident report from ${report.employeeName} forwarded to company owner for review`,
                  });
                }}
                onClose={() => {
                  // Mark as reviewed in Evidence Vault
                  try {
                    const allEvd3 = getAllEvidence();
                    const latest3 = allEvd3.find(e => e.emergencyId === pendingIncidentReport?.emergencyId);
                    if (latest3) updateEvidenceStatus(latest3.id, "reviewed", "Admin", "HSE Manager");
                  } catch {}
                  setShowIncidentReportPanel(false);
                  setPendingIncidentReport(null);
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Search */}
      <GlobalSearch
        isOpen={showGlobalSearch}
        onClose={() => setShowGlobalSearch(false)}
        onSelect={(result) => {
          if (result.type === "employee") {
            const emp = employees.find(e => e.id === result.id);
            if (emp) {
              setSelectedEmployee(emp);
              navigateTo("employees"); // Navigate to employees page with selection
            }
          } else if (result.type === "zone") {
            navigateTo("location");
          } else if (result.type === "incident") {
            navigateTo("emergencyHub");
          }
        }}
        employees={employees.map(e => ({ id: e.id, name: e.name, zone: e.location, status: e.status }))}
        zones={zones.map(z => ({ id: z.id, name: z.name, risk: z.risk }))}
        incidents={emergencies.map(e => ({ id: e.id, employeeName: e.employeeName, zone: e.zone, timestamp: e.timestamp }))}
      />

      {/* ── Notifications Panel ── */}
      <NotificationsPanel
        isOpen={showNotifPanel}
        onClose={() => setShowNotifPanel(false)}
        onNavigate={(page) => { navigateTo(page); setShowNotifPanel(false); }}
        unreadCount={notifUnread}
        onUnreadChange={setNotifUnread}
      />

      {/* ── Missed Calls Panel ── */}
      <AnimatePresence>
        {showMissedCallPanel && (
          <MissedCallsPanel
            calls={missedCalls}
            onClose={() => setShowMissedCallPanel(false)}
            onMarkSeen={(id) => {
              markMissedCallSeen(id);
              markMissedCallSeenInStore(id);
            }}
            onCallBack={(call) => {
              emitCallSignal({
                type: "ADMIN_CALLING_BACK",
                employeeId: call.employeeId,
                employeeName: call.employeeName,
                zone: call.zone,
              });
              setShowMissedCallPanel(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Setup Wizard Banner removed — integrated into Settings page */}

      {/* Smart Response floating button removed — redundant with Guide Me in sidebar */}


      {/* ═══ UNIFIED EMERGENCY RESPONSE ENGINE ═══
           Replaces 3 separate overlays (GuidedResponse, IRE, AICoAdmin)
           with one smart router that auto-selects the right engine.
           Admin can switch engines mid-response via the switcher tab. */}
      <AnimatePresence>
        {/* Case 1: AI Co-Admin triggered (premium auto-open) */}
        {showAICoAdmin && aiCoAdminContext && (() => {
          const isPremium = checkFeatureGate("ai_co_admin", companyState).allowed;
          const ctx: UnifiedEmergencyContext = {
            emergencyId: aiCoAdminContext.emergencyId,
            employeeName: aiCoAdminContext.employeeName,
            employeePhone: aiCoAdminContext.employeePhone,
            employeeRole: aiCoAdminContext.employeeRole,
            employeeBloodType: aiCoAdminContext.employeeBloodType,
            employeeMedications: aiCoAdminContext.employeeMedications,
            employeeAvatar: aiCoAdminContext.employeeAvatar,
            zone: aiCoAdminContext.zone,
            sosType: aiCoAdminContext.sosType,
            severity: aiCoAdminContext.severity,
            batteryLevel: aiCoAdminContext.batteryLevel,
            signalStrength: aiCoAdminContext.signalStrength,
            lastGPS: aiCoAdminContext.lastGPS,
            timestamp: aiCoAdminContext.timestamp,
            zoneEmployeeCount: aiCoAdminContext.zoneEmployeeCount,
            nearbyTeams: aiCoAdminContext.nearbyTeams,
          };
          return (
            <UnifiedEmergencyEngine
              context={ctx}
              isPremium={isPremium}
              forceEngine="ai_co_admin"
              onClose={() => { setShowAICoAdmin(false); setAICoAdminContext(null); }}
              onResolve={(id) => { safeHandleResolve(id); setTimeout(() => { setShowAICoAdmin(false); setAICoAdminContext(null); }, 2000); }}
              onNavigate={(page) => navigateTo(page)}
              onOpenChat={(emergencyId, employeeName) => { setChatEmergencyId(emergencyId); setChatEmployeeName(employeeName); setShowEmergencyChat(true); }}
            />
          );
        })()}

        {/* Case 2: IRE triggered (critical/high severity or Guide Me button) */}
        {!showAICoAdmin && showIntelligentGuide && (() => {
          let emgId = ireEmergencyId;
          let emg = emgId ? emergencies.find(e => e.id === emgId) : null;
          const emp = emg ? employees.find(e => e.name === emg!.employeeName) : null;
          const isPremium = checkFeatureGate("ai_co_admin", companyState).allowed;

          // Build context from directIreContext or emergency data
          const ctx: UnifiedEmergencyContext = directIreContext ? {
            emergencyId: directIreContext.emergencyId,
            employeeName: directIreContext.employeeName,
            employeeRole: directIreContext.employeeRole,
            zone: directIreContext.zone,
            sosType: directIreContext.sosType,
            severity: directIreContext.severity,
            elapsed: directIreContext.elapsed,
            batteryLevel: directIreContext.batteryLevel,
            signalStrength: directIreContext.signalStrength,
            lastGPS: directIreContext.lastGPS ? { ...directIreContext.lastGPS, address: undefined } : undefined,
            timestamp: Date.now(),
            phone: directIreContext.phone,
            isJourney: directIreContext.isJourney,
            journeyRoute: directIreContext.journeyRoute,
          } : emg ? {
            emergencyId: emg.id,
            employeeName: emg.employeeName,
            employeeRole: emp?.role,
            zone: emg.zone,
            sosType: emg.type.includes("SOS") ? "sos_button"
              : emg.type.includes("Fall") ? "fall_detected"
              : emg.type.includes("Shake") ? "shake_sos"
              : emg.type.includes("Check") ? "missed_checkin"
              : emg.type.includes("Geofence") ? "geofence"
              : emg.type.includes("Hazard") || emg.type.includes("Fire") || emg.type.includes("Chemical") ? "hazard"
              : emg.type.includes("Journey") ? "journey_sos"
              : "sos_button",
            severity: emg.severity,
            elapsed: emg.elapsed,
            batteryLevel: (() => { const sync = getLastEmployeeSync(emp?.id || ""); return sync?.battery ?? 50; })(),
            signalStrength: (() => { const sync = getLastEmployeeSync(emp?.id || ""); const s = sync?.signal; return s === "excellent" || s === "good" || s === "fair" || s === "poor" || s === "none" ? s : "fair"; })() as "excellent" | "good" | "fair" | "poor" | "none",
            lastGPS: { lat: 25.2048, lng: 55.2708 },
            timestamp: Date.now(),
            phone: emp?.phone,
          } : null!;

          if (!ctx) return null;
          return (
            <UnifiedEmergencyEngine
              context={ctx}
              isPremium={isPremium}
              forceEngine="ire"
              onClose={() => { setShowIntelligentGuide(false); setIreEmergencyId(null); setDirectIreContext(null); }}
              onResolve={(id) => {
                safeHandleResolve(id);
                setTimeout(() => {
                  setShowIntelligentGuide(false); setIreEmergencyId(null); setDirectIreContext(null);
                  const remaining = emergencies.filter(e => e.status === "active" && e.id !== id);
                  if (remaining.length > 0) setTimeout(() => setShowIreTriagePanel(true), 500);
                }, 2000);
              }}
              onNavigate={(page) => navigateTo(page)}
              onOpenChat={(emergencyId, employeeName) => { setChatEmergencyId(emergencyId); setChatEmployeeName(employeeName); setShowEmergencyChat(true); }}
            />
          );
        })()}

        {/* Case 3: Guided Response triggered (medium/low severity) */}
        {!showAICoAdmin && !showIntelligentGuide && showGuidedResponse && guidedEmergencyId && (() => {
          const emg = emergencies.find(e => e.id === guidedEmergencyId);
          if (!emg) return null;
          const isPremium = checkFeatureGate("ai_co_admin", companyState).allowed;
          const ctx: UnifiedEmergencyContext = {
            emergencyId: emg.id,
            employeeName: emg.employeeName,
            employeeRole: employees.find(e => e.name === emg.employeeName)?.role,
            zone: emg.zone,
            sosType: emg.type.includes("SOS") ? "sos_button"
              : emg.type.includes("Fall") ? "fall_detected"
              : emg.type.includes("Shake") ? "shake_sos"
              : emg.type.includes("Check") ? "missed_checkin"
              : "sos_button",
            severity: emg.severity,
            elapsed: emg.elapsed,
            timestamp: Date.now(),
          };
          return (
            <UnifiedEmergencyEngine
              context={ctx}
              isPremium={isPremium}
              forceEngine="guided"
              onClose={() => { setShowGuidedResponse(false); setGuidedEmergencyId(null); }}
              onResolve={(id) => { safeHandleResolve(id); setTimeout(() => { setShowGuidedResponse(false); setGuidedEmergencyId(null); }, 2000); }}
              onNavigate={(page) => navigateTo(page)}
              onOpenChat={(emergencyId, employeeName) => { setChatEmergencyId(emergencyId); setChatEmployeeName(employeeName); setShowEmergencyChat(true); }}
            />
          );
        })()}
      </AnimatePresence>

      {/* ── Emergency Chat (Dashboard side) ── */}
      <AnimatePresence>
        {showEmergencyChat && chatEmergencyId && (
          <DashboardEmergencyChat
            emergencyId={chatEmergencyId}
            employeeName={chatEmployeeName}
            isOpen={showEmergencyChat}
            onClose={() => { setShowEmergencyChat(false); setChatEmergencyId(null); }}
          />
        )}
      </AnimatePresence>

      {/* ── Guide Me Quick Panel — Smart contextual actions ── */}
      <AnimatePresence>
        {showGuideQuickPanel && (
          <GuideQuickPanel
            onClose={() => setShowGuideQuickPanel(false)}
            onNavigate={(page: DashPage) => { setShowGuideQuickPanel(false); setCurrentPage(page); }}
            onNavigateHub={(page: DashPage, tab: string) => { setShowGuideQuickPanel(false); setCurrentPage(page); setHubTab(page, tab); }}
            pipeline={getEvidencePipelineStatus()}
            resolvedCount={emergencies.filter(e => e.status === "resolved").length}
          />
        )}
      </AnimatePresence>

      {/* ── FIX 3: IRE Triage Panel — Multi-emergency awareness ── */}
      <AnimatePresence>
        {showIreTriagePanel && emergencies.filter(e => e.status === "active").length > 0 && (
          <IreTriagePanel
            emergencies={emergencies.filter(e => e.status === "active")}
            employees={employees}
            onSelect={(id) => {
              setShowIreTriagePanel(false);
              // Unified Engine handles routing — just open it
              setIreEmergencyId(id);
              setShowIntelligentGuide(true);
            }}
            onClose={() => setShowIreTriagePanel(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Cross-Hub Navigation Prompt — ISO 45001 §10.2 workflow ── */}
      <AnimatePresence>
        {crossHubPrompt?.show && (
          <CrossHubPrompt
            emergencyId={crossHubPrompt.emergencyId}
            emergencyName={crossHubPrompt.emergencyName}
            emergencyType={crossHubPrompt.emergencyType}
            severity={crossHubPrompt.severity}
            resolvedAt={crossHubPrompt.resolvedAt}
            emergencyRef={crossHubPrompt.emergencyRef}
            onOpenInvestigation={() => {
              setCrossHubPrompt(null);
              setCurrentPage("incidentRisk");
              setHubTab("incidentRisk", "investigation");
            }}
            onOpenRiskRegister={() => {
              setCrossHubPrompt(null);
              setCurrentPage("incidentRisk");
              setHubTab("incidentRisk", "register");
            }}
            onExportPDF={() => {
              const reportData = buildReportData(crossHubPrompt.emergencyRef);
              generateEmergencyLifecyclePDF(reportData);
            }}
            onEmailPDF={() => {
              setLifecycleReportTitle(`Emergency Lifecycle Report — ${crossHubPrompt.emergencyName}`);
              setShowLifecycleEmailModal(true);
            }}
            onDismiss={() => setCrossHubPrompt(null)}
          />
        )}
      </AnimatePresence>

      {/* Lifecycle Report Email Modal */}
      <PdfEmailModal
        open={showLifecycleEmailModal}
        onClose={() => setShowLifecycleEmailModal(false)}
        reportTitle={lifecycleReportTitle || "Emergency Lifecycle Report"}
        reportSize="3.1 MB"
        isEncrypted={false}
        onSent={(emails) => {
          toast.success("Lifecycle Report Emailed", {
            description: `Sent to ${emails.length} recipient${emails.length > 1 ? "s" : ""} via secure channel`,
            duration: 5000,
          });
        }}
      />

      {/* FIX D: Shift Handover Modal */}
      <AnimatePresence>
        {showHandoverModal && (
          <ShiftHandoverModal
            activeEmergencies={emergencies
              .filter(e => e.status === "active")
              .map(e => ({
                id: e.id,
                employeeName: e.employeeName,
                zone: e.zone,
                type: e.type,
                elapsed: e.elapsed,
                status: e.status,
              }))
            }
            adminName={authState?.userName || "Admin"}
            onComplete={(notes) => {
              setHandoverNote(notes);
              setShowHandoverModal(false);
              toast.success("Handover complete — logging out");
              onLogout();
            }}
            onEmergencyLogout={() => {
              setShowHandoverModal(false);
              toast.warning("Emergency logout — no handover recorded");
              onLogout();
            }}
            onCancel={() => setShowHandoverModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Guide Me Quick Panel — "The AI Copilot that's always watching"
// Shows smart contextual actions when no active emergency
// ═══════════════════════════════════════════════════════════════
function GuideQuickPanel({ onClose, onNavigate, onNavigateHub, pipeline, resolvedCount }: {
  onClose: () => void;
  onNavigate: (page: DashPage) => void;
  onNavigateHub: (page: DashPage, tab: string) => void;
  pipeline: { pendingReview: number; suggestions: { title: string; navigateTo: string }[] };
  resolvedCount: number;
}) {
  // Play opening sound
  useEffect(() => { try { playUISound("guideOpen"); hapticLight(); } catch {} }, []);

  // Build smart action list based on current platform state
  const actions: { id: string; icon: any; label: string; detail: string; color: string; badge?: string; onClick: () => void }[] = [];

  // Priority 1: Pending evidence
  if (pipeline.pendingReview > 0) {
    actions.push({
      id: "evidence", icon: Camera, label: "Review Evidence", color: "#FF9500",
      detail: `${pipeline.pendingReview} item${pipeline.pendingReview > 1 ? "s" : ""} awaiting your review`,
      badge: `${pipeline.pendingReview}`,
      onClick: () => { try { playUISound("guideAction"); } catch {} onNavigateHub("emergencyHub" as DashPage, "reports"); },
    });
  }

  // Priority 2: Resolved emergencies needing investigation
  if (resolvedCount > 0) {
    actions.push({
      id: "investigate", icon: FileWarning, label: "Investigate Incidents", color: "#FF2D55",
      detail: `${resolvedCount} resolved — run RCA & CAPA analysis`,
      badge: `${resolvedCount}`,
      onClick: () => { try { playUISound("guideAction"); } catch {} onNavigateHub("incidentRisk" as DashPage, "investigation"); },
    });
  }

  // Priority 3: Evidence pipeline suggestions
  pipeline.suggestions.slice(0, 2).forEach((sug, i) => {
    actions.push({
      id: `sug-${i}`, icon: Sparkles, label: sug.title.slice(0, 35), color: "#7B5EFF",
      detail: "AI-recommended action",
      onClick: () => { try { playUISound("guideAction"); } catch {} onNavigate(sug.navigateTo as DashPage); },
    });
  });

  // Always-available smart actions
  actions.push(
    { id: "safety-intel", icon: Brain, label: "Safety Intelligence", color: "#00C8E0", detail: "AI threat predictions & risk analysis", onClick: () => { try { playUISound("guideAction"); } catch {} onNavigate("safetyIntel" as DashPage); } },
    { id: "risk-register", icon: Target, label: "Risk Register", color: "#FF9500", detail: "Review 5×5 risk matrix & controls", onClick: () => { try { playUISound("guideAction"); } catch {} onNavigateHub("incidentRisk" as DashPage, "register"); } },
    { id: "training", icon: Award, label: "Run Safety Drill", color: "#00C853", detail: "Launch a training drill for your team", onClick: () => { try { playUISound("guideAction"); } catch {} window.open("/training", "_blank"); } },
    { id: "compliance", icon: ScrollText, label: "Compliance Reports", color: "#AF52DE", detail: "ISO 45001 audit & compliance status", onClick: () => { try { playUISound("guideAction"); } catch {} onNavigateHub("reportsAnalytics" as DashPage, "reports"); } },
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 30 }}
        transition={{ type: "spring", stiffness: 350, damping: 30 }}
        className="relative z-10 w-full max-w-md mx-4"
        style={{
          borderRadius: 24,
          background: "rgba(10,18,32,0.98)",
          border: "1px solid rgba(0,200,224,0.12)",
          backdropFilter: "blur(40px)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5), 0 0 40px rgba(0,200,224,0.05)",
          maxHeight: "80vh",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.2), rgba(123,94,255,0.1))", border: "1px solid rgba(0,200,224,0.15)" }}
            >
              <Zap style={{ width: 18, height: 18, color: "#00C8E0" }} />
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>Guide Me</p>
              <p style={{ fontSize: 11, color: "rgba(0,200,224,0.5)" }}>AI Safety Copilot</p>
            </div>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)" }}>
            <X style={{ width: 16, height: 16, color: "rgba(255,255,255,0.3)" }} />
          </button>
        </div>

        {/* Status bar */}
        <div className="px-6 pb-3">
          <div className="flex items-center gap-2 px-3 py-2" style={{ borderRadius: 10, background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.08)" }}>
            <div className="size-2 rounded-full" style={{ background: "#00C853" }} />
            <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(0,200,83,0.6)" }}>
              All clear — no active emergencies
            </p>
          </div>
        </div>

        {/* Actions list */}
        <div className="px-4 pb-5 overflow-y-auto" style={{ maxHeight: "55vh", scrollbarWidth: "none" }}>
          {pipeline.pendingReview > 0 && (
            <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,150,0,0.4)", letterSpacing: "0.5px", marginBottom: 6, marginLeft: 8, textTransform: "uppercase" }}>
              Needs Attention
            </p>
          )}
          <div className="space-y-1.5">
            {actions.map((action, i) => {
              const AIcon = action.icon;
              const isUrgent = action.badge !== undefined;
              return (
                <motion.button
                  key={action.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={action.onClick}
                  className="w-full flex items-center gap-3 px-3 py-3 text-left"
                  style={{
                    borderRadius: 14,
                    background: isUrgent ? `${action.color}06` : "rgba(255,255,255,0.01)",
                    border: `1px solid ${isUrgent ? `${action.color}15` : "rgba(255,255,255,0.03)"}`,
                    transition: "background 0.2s",
                  }}
                >
                  <div className="size-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${action.color}10`, border: `1px solid ${action.color}18` }}
                  >
                    <AIcon style={{ width: 15, height: 15, color: action.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{action.label}</p>
                    <p className="truncate" style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>{action.detail}</p>
                  </div>
                  {action.badge && (
                    <span className="px-2 py-0.5 rounded-md shrink-0" style={{ fontSize: 10, fontWeight: 800, color: action.color, background: `${action.color}12`, border: `1px solid ${action.color}25` }}>
                      {action.badge}
                    </span>
                  )}
                  <ChevronRight style={{ width: 12, height: 12, color: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
                </motion.button>
              );
            })}
          </div>

          {/* Separator before always-available */}
          {(pipeline.pendingReview > 0 || resolvedCount > 0 || pipeline.suggestions.length > 0) && actions.length > 4 && (
            <div className="my-3 mx-8" style={{ height: 1, background: "rgba(255,255,255,0.03)" }} />
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FIX 3: IRE Triage Panel — Multi-emergency awareness
// When 2+ active emergencies, shows a prioritized list
// ═══════════════════════════════════════════════════════════════
function IreTriagePanel({ emergencies, employees, onSelect, onClose }: {
  emergencies: EmergencyItem[];
  employees: Employee[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  // Score each emergency for triage priority (higher = more urgent)
  const scored = emergencies.map(emg => {
    let score = 0;
    // Severity
    if (emg.severity === "critical") score += 40;
    else if (emg.severity === "high") score += 25;
    else if (emg.severity === "medium") score += 12;
    else score += 5;
    // Type
    if (emg.type.includes("SOS") || emg.type.includes("Fall")) score += 20;
    else if (emg.type.includes("Shake")) score += 18;
    else if (emg.type.includes("Geofence")) score += 10;
    else if (emg.type.includes("Check")) score += 8;
    // Time elapsed
    if (emg.elapsed > 300) score += 15;
    else if (emg.elapsed > 120) score += 8;
    else if (emg.elapsed > 60) score += 4;

    const threatLabel = score >= 50 ? "CRITICAL" : score >= 30 ? "HIGH" : score >= 15 ? "MEDIUM" : "LOW";
    const threatColor = score >= 50 ? "#FF2D55" : score >= 30 ? "#FF9500" : score >= 15 ? "#FFD60A" : "#00C853";
    return { ...emg, triageScore: score, threatLabel, threatColor };
  }).sort((a, b) => b.triageScore - a.triageScore);

  const fmtElapsed = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
        onClick={onClose}
      />

      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 30 }}
        transition={{ type: "spring", stiffness: 350, damping: 30 }}
        className="relative z-10 w-full max-w-lg mx-4"
        style={{
          borderRadius: 24,
          background: "rgba(10,18,32,0.98)",
          border: "1px solid rgba(255,45,85,0.15)",
          backdropFilter: "blur(40px)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5), 0 0 40px rgba(255,45,85,0.05)",
          maxHeight: "80vh",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(255,45,85,0.12)", border: "1px solid rgba(255,45,85,0.2)" }}>
              <Siren style={{ width: 18, height: 18, color: "#FF2D55" }} />
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>Emergency Triage</p>
              <p style={{ fontSize: 11, color: "rgba(255,45,85,0.6)" }}>{scored.length} active — prioritized by threat</p>
            </div>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)" }}>
            <X style={{ width: 16, height: 16, color: "rgba(255,255,255,0.3)" }} />
          </button>
        </div>

        {/* Emergency list */}
        <div className="px-4 pb-5 overflow-y-auto" style={{ maxHeight: "60vh", scrollbarWidth: "none" }}>
          <div className="space-y-2">
            {scored.map((emg, i) => {
              const emp = employees.find(e => e.name === emg.employeeName);
              return (
                <motion.div
                  key={emg.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="rounded-xl overflow-hidden"
                  style={{
                    background: i === 0 ? `${emg.threatColor}08` : "rgba(255,255,255,0.01)",
                    border: `1px solid ${i === 0 ? `${emg.threatColor}20` : "rgba(255,255,255,0.04)"}`,
                  }}
                >
                  <div className="flex items-center gap-3 p-3.5">
                    {/* Rank badge */}
                    <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: `${emg.threatColor}12`, border: `1px solid ${emg.threatColor}20` }}>
                      <span style={{ fontSize: 13, fontWeight: 900, color: emg.threatColor }}>
                        {i + 1}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate" style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                          {emg.employeeName}
                        </p>
                        <span className="px-1.5 py-0.5 rounded-md flex-shrink-0"
                          style={{ fontSize: 7, fontWeight: 800, color: emg.threatColor, background: `${emg.threatColor}12`, border: `1px solid ${emg.threatColor}25`, letterSpacing: "0.3px" }}>
                          {emg.threatLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{emg.type}</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>·</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{emg.zone}</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>·</span>
                        <span style={{ fontSize: 10, color: emg.elapsed > 120 ? "#FF2D55" : "rgba(255,255,255,0.3)", fontWeight: emg.elapsed > 120 ? 700 : 400 }}>
                          {fmtElapsed(emg.elapsed)}
                        </span>
                      </div>
                    </div>

                    {/* Action button */}
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => onSelect(emg.id)}
                      className="px-3 py-2 rounded-lg flex-shrink-0"
                      style={{
                        background: i === 0
                          ? `linear-gradient(135deg, ${emg.threatColor}25, ${emg.threatColor}10)`
                          : "rgba(0,200,224,0.06)",
                        border: `1px solid ${i === 0 ? `${emg.threatColor}35` : "rgba(0,200,224,0.12)"}`,
                      }}
                    >
                      <span style={{ fontSize: 10, fontWeight: 800, color: i === 0 ? emg.threatColor : "#00C8E0", letterSpacing: "-0.2px" }}>
                        {i === 0 ? "Handle First" : "Handle"}
                      </span>
                    </motion.button>
                  </div>

                  {/* First item emphasis */}
                  {i === 0 && (
                    <div className="px-3.5 pb-3">
                      <motion.div
                        animate={{ opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                        style={{ background: `${emg.threatColor}06`, border: `1px solid ${emg.threatColor}10` }}
                      >
                        <Zap style={{ width: 10, height: 10, color: emg.threatColor }} />
                        <span style={{ fontSize: 9, color: `${emg.threatColor}90`, fontWeight: 600 }}>
                          Highest threat score — recommended to handle first
                        </span>
                      </motion.div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Cross-Hub Navigation Prompt — "The platform that never forgets"
// After resolving an emergency, prompts admin to investigate (ISO 45001 §10.2)
// ═══════════════════════════════════════════════════════════════
function CrossHubPrompt({ emergencyId, emergencyName, emergencyType, severity, resolvedAt, emergencyRef, onOpenInvestigation, onOpenRiskRegister, onExportPDF, onEmailPDF, onDismiss }: {
  emergencyId: string;
  emergencyName: string;
  emergencyType: string;
  severity: "critical" | "high" | "medium" | "low";
  resolvedAt: Date;
  emergencyRef: EmergencyItem;
  onOpenInvestigation: () => void;
  onOpenRiskRegister: () => void;
  onExportPDF: () => void;
  onEmailPDF?: () => void;
  onDismiss: () => void;
}) {
  const [countdown, setCountdown] = useState(15);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(timer); onDismiss(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(5,7,14,0.75)", backdropFilter: "blur(8px)" }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="w-[440px] rounded-3xl overflow-hidden"
        style={{
          background: "linear-gradient(145deg, #0D1520 0%, #0A1220 50%, #0D1520 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 40px rgba(0,200,83,0.08)",
        }}
      >
        {/* Success Header */}
        <div className="relative px-6 pt-6 pb-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.2 }}
            className="mx-auto size-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: "linear-gradient(135deg, rgba(0,200,83,0.15), rgba(0,200,83,0.06))",
              border: "1px solid rgba(0,200,83,0.2)",
              boxShadow: "0 4px 20px rgba(0,200,83,0.15)",
            }}
          >
            <CheckCircle2 className="size-7" style={{ color: "#00C853" }} />
          </motion.div>
          <p className="text-center" style={{ fontSize: 17, fontWeight: 750, color: "#fff", letterSpacing: "-0.02em" }}>
            Emergency Resolved
          </p>
          <p className="text-center mt-1" style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: 450 }}>
            {emergencyName} — {emergencyType}
          </p>
        </div>

        {/* ISO 45001 Reminder */}
        <div className="mx-6 px-4 py-3 rounded-xl mb-4" style={{
          background: "linear-gradient(135deg, rgba(255,150,0,0.06), rgba(255,150,0,0.02))",
          border: "1px solid rgba(255,150,0,0.1)",
        }}>
          <div className="flex items-start gap-3">
            <div className="size-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{
              background: "rgba(255,150,0,0.1)", border: "1px solid rgba(255,150,0,0.15)"
            }}>
              <AlertTriangle className="size-3.5" style={{ color: "#FF9500" }} />
            </div>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,150,0,0.8)", letterSpacing: "-0.01em" }}>
                ISO 45001 §10.2 — Investigation Required
              </p>
              <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)", fontWeight: 400, marginTop: 2, lineHeight: 1.4 }}>
                Every resolved incident must be investigated within 24h. Root cause analysis prevents recurrence.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="px-6 pb-2 space-y-2">
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={onOpenInvestigation}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl"
            style={{
              background: "linear-gradient(135deg, rgba(255,150,0,0.12), rgba(255,150,0,0.04))",
              border: "1px solid rgba(255,150,0,0.18)",
              boxShadow: "0 2px 12px rgba(255,150,0,0.08)",
            }}
          >
            <div className="size-9 rounded-lg flex items-center justify-center" style={{
              background: "linear-gradient(135deg, rgba(255,150,0,0.2), rgba(255,150,0,0.08))",
              border: "1px solid rgba(255,150,0,0.2)",
            }}>
              <FileWarning className="size-4" style={{ color: "#FF9500" }} />
            </div>
            <div className="flex-1 text-left">
              <p style={{ fontSize: 13, fontWeight: 700, color: "#FF9500", letterSpacing: "-0.01em" }}>
                Open Investigation
              </p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>
                RCA + CAPA — required within 24 hours
              </p>
            </div>
            <ChevronRight className="size-4" style={{ color: "rgba(255,150,0,0.4)" }} />
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={onOpenRiskRegister}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div className="size-9 rounded-lg flex items-center justify-center" style={{
              background: "rgba(191,90,242,0.08)", border: "1px solid rgba(191,90,242,0.12)",
            }}>
              <Shield className="size-4" style={{ color: "#BF5AF2" }} />
            </div>
            <div className="flex-1 text-left">
              <p style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.7)", letterSpacing: "-0.01em" }}>
                Update Risk Register
              </p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>
                Re-evaluate zone risk level — ISO 45001 §6.1
              </p>
            </div>
            <ChevronRight className="size-4" style={{ color: "rgba(255,255,255,0.15)" }} />
          </motion.button>
        </div>

        {/* Divider */}
        <div className="mx-6 my-2 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)" }} />

        {/* ── Export Full PDF Report — The hero feature ── */}
        <div className="px-6 pb-2">
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.97 }}
            onClick={onExportPDF}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(0,200,224,0.1), rgba(123,94,255,0.06))",
              border: "1px solid rgba(0,200,224,0.15)",
              boxShadow: "0 4px 16px rgba(0,200,224,0.08)",
            }}
          >
            {/* Shimmer effect */}
            <motion.div
              animate={{ x: [-200, 500] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute inset-y-0 w-20"
              style={{ background: "linear-gradient(90deg, transparent, rgba(0,200,224,0.06), transparent)" }}
            />
            <div className="size-9 rounded-lg flex items-center justify-center relative z-10" style={{
              background: "linear-gradient(135deg, rgba(0,200,224,0.2), rgba(0,200,224,0.08))",
              border: "1px solid rgba(0,200,224,0.2)",
            }}>
              <FileText className="size-4" style={{ color: "#00C8E0" }} />
            </div>
            <div className="flex-1 text-left relative z-10">
              <p style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0", letterSpacing: "-0.01em" }}>
                Export Full Lifecycle Report
              </p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>
                PDF · 9 sections · Timeline + Actions + ISO checklist
              </p>
            </div>
            <Download className="size-4 relative z-10" style={{ color: "rgba(0,200,224,0.5)" }} />
          </motion.button>
          {onEmailPDF && (
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.97 }}
              onClick={onEmailPDF}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl mt-2"
              style={{
                background: "rgba(123,94,255,0.06)",
                border: "1px solid rgba(123,94,255,0.12)",
              }}
            >
              <div className="size-9 rounded-lg flex items-center justify-center" style={{
                background: "rgba(123,94,255,0.12)", border: "1px solid rgba(123,94,255,0.18)",
              }}>
                <Mail className="size-4" style={{ color: "#7B5EFF" }} />
              </div>
              <div className="flex-1 text-left">
                <p style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(123,94,255,0.9)", letterSpacing: "-0.01em" }}>
                  Email Report
                </p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>
                  Send encrypted PDF to team via secure channel
                </p>
              </div>
              <ChevronRight className="size-4" style={{ color: "rgba(123,94,255,0.35)" }} />
            </motion.button>
          )}
        </div>

        {/* Dismiss with countdown */}
        <div className="px-6 pt-2 pb-5">
          <button
            onClick={onDismiss}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>
              Skip for now
            </span>
            <span className="px-1.5 py-0.5 rounded-md" style={{
              fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)",
              fontVariantNumeric: "tabular-nums",
            }}>
              {countdown}s
            </span>
          </button>
        </div>

        {/* Progress bar countdown */}
        <div className="h-0.5" style={{ background: "rgba(255,255,255,0.03)" }}>
          <motion.div
            initial={{ width: "100%" }}
            animate={{ width: "0%" }}
            transition={{ duration: 15, ease: "linear" }}
            className="h-full"
            style={{ background: "linear-gradient(90deg, rgba(0,200,83,0.4), rgba(255,150,0,0.3))" }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Role Badge Chip — Floating role indicator
// ══════════════════════════════════════════════════════════════
function RoleBadgeChip({ authState, t, isAr, onTap }: { authState: AuthState; t: (k:string)=>string; isAr: boolean; onTap: ()=>void }) {
  const cfg = ROLE_CONFIG[authState.user.role];
  return (
    <motion.button
      onClick={onTap}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="fixed bottom-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-[10px]"
      style={{
        left: 266,
        background: `linear-gradient(135deg, ${cfg.color}15 0%, ${cfg.color}08 100%)`,
        border: `1px solid ${cfg.color}20`,
        backdropFilter: "blur(12px)",
        boxShadow: `0 2px 12px ${cfg.color}10`,
      }}
    >
      <div className="size-2 rounded-full" style={{ background: cfg.color, boxShadow: `0 0 6px ${cfg.color}60` }} />
      <span style={{ fontSize: 9, fontWeight: 700, color: cfg.color, letterSpacing: "0.03em" }}>
        {isAr ? cfg.labelAr : cfg.label}
      </span>
    </motion.button>
  );
}

// ═══════════════════════════════════════════════════════════════
// Enterprise Page Header Config — icon + description per page
// ═══════════════════════════════════════════════════════════════
const PAGE_HEADER_CONFIG: Partial<Record<DashPage, {
  icon: any; color: string; description: string;
  badge?: { label: string; color?: string; pulse?: boolean };
}>> = {
  emergencyHub: { icon: Siren, color: "#FF2D55", description: "Unified incident management — live alerts, SAR protocol & response playbook" },
  operations: { icon: Route, color: "#00C8E0", description: "Journey tracking, workforce management, communications & connectivity" },
  people: { icon: Users, color: "#00C8E0", description: "Team directory, buddy system, pre-shift readiness & safety scores" },
  incidentRisk: { icon: FileWarning, color: "#FF9500", description: "Root cause analysis, corrective actions & risk assessment matrix — ISO 45001", badge: { label: "ISO 45001", color: "#FF9500" } },
  reportsAnalytics: { icon: TrendingUp, color: "#4A90D9", description: "Compliance reports, performance analytics, leaderboards & automated scheduling" },
  governance: { icon: ScrollText, color: "#8090A5", description: "Audit trail, roles & access control — complete compliance governance" },
  safetyIntel: { icon: Cpu, color: "#7B5EFF", description: "AI-powered predictive risk engine — forecasts danger before it happens", badge: { label: "AI Powered", color: "#7B5EFF" } },
  riskMap: { icon: MapIcon, color: "#FF9500", description: "Real-time situational map with live worker positions & threat overlays" },
  analytics: { icon: TrendingUp, color: "#4A90D9", description: "Safety performance metrics, SLA compliance & exportable reports" },
  employees: { icon: Users, color: "#00C8E0", description: "Team directory — live GPS, safety scores & profiles connected from mobile app" },
  location: { icon: MapPin, color: "#00C853", description: "Site zones, geofencing editor & GPS compliance monitoring" },
  workforce: { icon: CalendarDays, color: "#FF9500", description: "Attendance tracking, shift scheduling & conflict detection" },
  comms: { icon: Megaphone, color: "#E67E22", description: "Broadcast alerts, mass notifications & evacuation control" },
  roles: { icon: UserCog, color: "#9B59B6", description: "RBAC permissions, team hierarchy & access control management" },
  auditLog: { icon: ScrollText, color: "#8090A5", description: "Complete immutable system activity log for compliance" },
  billing: { icon: Wallet, color: "#7B5EFF", description: "Subscription plans, usage metrics, invoices & upgrades" },
  settings: { icon: Settings, color: "rgba(255,255,255,0.5)", description: "Company profile, notification rules & integrations" },
  buddySystem: { icon: UserCheck, color: "#00C853", description: "Paired worker safety — mutual monitoring & auto-alert on SOS" },
  checklist: { icon: ListChecks, color: "#FF9500", description: "Shift readiness verification — ensure workers are prepared" },
  playbook: { icon: BookOpen, color: "#FF2D55", description: "Structured emergency response protocols & step-by-step guides" },
  weatherAlerts: { icon: CloudLightning, color: "#4A90D9", description: "Environmental hazard monitoring — wind, heat, storms & visibility" },
  journeyMgmt: { icon: Route, color: "#00C8E0", description: "Travel & route safety tracking with checkpoint verification" },
  safetyScore: { icon: Award, color: "#FFD700", description: "Gamified safety performance — leaderboards, achievements & rewards" },
  complianceReports: { icon: FileText, color: "#00C853", description: "Automated regulatory PDF reports — OSHA, ISO & custom templates" },
  leaderboard: { icon: Trophy, color: "#FFD700", description: "Admin performance rankings — response scores, streaks & tier progression" },
  emailScheduler: { icon: Mail, color: "#00C8E0", description: "Automated batch report scheduling — daily, weekly, monthly & quarterly email delivery" },
  rrpAnalytics: { icon: Zap, color: "#FF2D55", description: "Response performance analytics — response times, heatmaps, admin comparisons & AI insights" },
  incidentInvestigation: { icon: FileWarning, color: "#FF9500", description: "Root Cause Analysis & Corrective Actions (CAPA) — ISO 45001 §10.2 compliant investigation workflow", badge: { label: "ISO 45001", color: "#FF9500" } },
  riskRegister: { icon: Shield, color: "#BF5AF2", description: "Zone-based risk assessment matrix, training records & certification tracking — ISO 45001 §6.1", badge: { label: "ISO 45001", color: "#BF5AF2" } },
};

// Enterprise Page Header — titles map (hoisted outside render)
const PAGE_TITLES: Partial<Record<DashPage, string>> = {
  emergencyHub: "Emergency Hub", safetyIntel: "Safety Intelligence",
  riskMap: "Risk Map Live", analytics: "Analytics & Insights",
  employees: "Employees", location: "Location & Zones",
  workforce: "Workforce", comms: "Comms & Safety",
  roles: "Roles & Access", auditLog: "Audit Trail",
  billing: "Plans & Billing", settings: "Settings",
  buddySystem: "Buddy System", checklist: "Pre-Shift Checklist",
  playbook: "Response Playbook", weatherAlerts: "Weather Alerts",
  journeyMgmt: "Journey Management", safetyScore: "Safety Score",
  complianceReports: "Compliance Reports", leaderboard: "Admin Leaderboard",
  emailScheduler: "Email Scheduler", rrpAnalytics: "Response Analytics",
  offlineMonitor: "Offline & Sync",
  operations: "Operations Hub", people: "People & Teams",
  incidentRisk: "Incident & Risk", reportsAnalytics: "Reports & Analytics",
  governance: "Governance",
};

// Enterprise Page Header Renderer — with motion entrance & ambient glow
function EnterprisePageHeader({ page, activeEmergencyCount }: { page: DashPage; activeEmergencyCount?: number }) {
  const config = PAGE_HEADER_CONFIG[page];
  if (!config) return null;
  const Icon = config.icon;

  const dynamicBadge = config.badge;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 24px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient gradient glow behind header */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: "100%",
        background: `radial-gradient(ellipse at 10% 50%, ${config.color}06 0%, transparent 50%)`,
        pointerEvents: "none",
      }} />
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] }}
        style={{
          width: 40, height: 40, borderRadius: 13,
          background: `linear-gradient(135deg, ${config.color}18 0%, ${config.color}06 100%)`,
          border: `1px solid ${config.color}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, boxShadow: `0 4px 14px ${config.color}0A`,
          position: "relative", zIndex: 1,
        }}
      >
        <Icon size={20} color={config.color} strokeWidth={1.8} />
      </motion.div>
      <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.02em" }}>
            {PAGE_TITLES[page] || page}
          </span>
          {dynamicBadge && (
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 8, fontSize: 9, fontWeight: 700,
                color: dynamicBadge.color || config.color,
                background: `${dynamicBadge.color || config.color}12`,
                border: `1px solid ${dynamicBadge.color || config.color}18`,
                letterSpacing: "0.03em",
              }}
            >
              {dynamicBadge.pulse && (
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: dynamicBadge.color || config.color,
                  animation: "pulse 1.5s ease infinite",
                }} />
              )}
              {dynamicBadge.label}
            </motion.span>
          )}
        </div>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 2, letterSpacing: "-0.005em" }}>
          {config.description}
        </p>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Guide Me — SOS-Aware + Evidence-Aware Intelligent Subtitle
// Shows real-time SOS intelligence: GPS trail, recording, contact status
// ═══════════════════════════��═══════════════════════════════════
function GuideSubtitle({ emergencyCount, clusters = [] }: { emergencyCount: number; clusters?: ZoneCluster[] }) {
  const [liveHint, setLiveHint] = useState(0);

  // Cycle through SOS intelligence hints when emergencies are active
  useEffect(() => {
    if (emergencyCount <= 0) return;
    const timer = setInterval(() => {
      setLiveHint(h => (h + 1) % (clusters.length > 0 ? 6 : 4));
      // Subtle sound tick on each hint rotation during SOS
      try { playUISound("guideHint"); } catch {}
      try { hapticLight(); } catch {}
    }, 3000);
    return () => clearInterval(timer);
  }, [emergencyCount, clusters.length]);

  if (emergencyCount > 0) {
    // Base contextual SOS intelligence hints
    const hints: { text: string; color: string }[] = [
      { text: `${emergencyCount} active — tap to rescue`, color: "rgba(255,45,85,0.5)" },
      { text: "GPS trail recording live", color: "rgba(0,200,224,0.6)" },
      { text: "Ambient recording may be active", color: "rgba(255,150,0,0.5)" },
      { text: "Guide Me will walk you through", color: "rgba(0,200,224,0.4)" },
    ];
    // Cluster-aware hints — injected when zone clusters are detected
    if (clusters.length > 0) {
      const clusterHint = getClusterGuideHint(clusters);
      if (clusterHint) {
        const worst = clusters[0];
        const cfg = CLUSTER_LEVEL_CONFIG[worst.level];
        hints.push(
          { text: clusterHint, color: cfg.color },
          { text: `Unified response needed — ${worst.zone}`, color: cfg.color },
        );
      }
    }
    const hint = hints[liveHint % hints.length];
    return (
      <div className="flex items-center gap-1.5">
        <motion.div
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
          className="size-1.5 rounded-full"
          style={{ background: "#FF2D55" }}
        />
        <motion.p
          key={liveHint}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.01em", color: hint.color }}
        >
          {hint.text}
        </motion.p>
      </div>
    );
  }

  // Check evidence pipeline for smart suggestions
  const pipeline = getEvidencePipelineStatus();
  if (pipeline.pendingReview > 0) {
    return (
      <div className="flex items-center gap-1.5">
        <motion.div
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          className="size-1.5 rounded-full"
          style={{ background: "#FF9500" }}
        />
        <p style={{ fontSize: 9, fontWeight: 600, color: "#FF9500" }}>
          {pipeline.pendingReview} evidence awaiting review
        </p>
      </div>
    );
  }

  if (pipeline.suggestions.length > 0) {
    return (
      <p style={{ fontSize: 9, fontWeight: 500, color: "rgba(123,94,255,0.6)" }}>
        {pipeline.suggestions[0].title.slice(0, 40)}...
      </p>
    );
  }

  return (
    <p style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.01em", color: "rgba(0,200,224,0.4)" }}>
      AI Safety Copilot
    </p>
  );
}

// ══════════════════════��════════════════════════════════════════
// Sidebar Component
// ═══════════════════════════════════════════════════════════════
function DashSidebar({ currentPage, onNavigate, collapsed, onToggle, companyName, activeEmergencyCount, t, authState, companyState, webMode = false, hybridMode, onGuideMe, zoneClusters = [] }: {
  currentPage: DashPage;
  onNavigate: (page: DashPage) => void;
  collapsed: boolean;
  onToggle: () => void;
  companyName: string;
  activeEmergencyCount: number;
  t: (k: string) => string;
  authState?: AuthState;
  companyState?: CompanyState;
  webMode?: boolean;
  hybridMode?: boolean;
  onGuideMe?: () => void;
  zoneClusters?: ZoneCluster[];
}) {
  // Gate nav items by RBAC + Plan — Danger Priority Order
  const NAV_LIVE_THREAT = getNavLiveThreat(t).filter(item => {
    if (!authState) return true;
    if (item.id === "riskMap") return (!companyState || hasFeature(companyState, "risk_map")) && hybridMode !== false;
    return true;
  });
  const NAV_INTELLIGENCE = getNavIntelligence(t);
  const NAV_OPERATIONS = getNavOperations(t);
  const NAV_COMPLIANCE = getNavCompliance();
  const NAV_SYSTEM = getNavSystem().filter(item => {
    if (!authState) return true;
    if (item.id === "governance") return hasPermission(authState, "settings:view");
    return true;
  });
  // ── Shared sidebar inner content ─────────────────────────────
  const sidebarContent = (
    <div className="contents">
      {/* Logo + Company — compact single block */}
      <div className="px-4 pb-2 relative" style={{ paddingTop: webMode ? 14 : 48 }}>
        <div className="absolute top-0 left-0 right-0 h-16 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 40% 0%, rgba(0,200,224,0.06) 0%, transparent 65%)" }} />
        <div className="flex items-center gap-2.5 relative z-10">
          <div className="size-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(0,200,224,0.3) 0%, rgba(0,136,168,0.15) 100%)",
              border: "1px solid rgba(0,200,224,0.2)",
            }}>
            <Shield className="size-4" style={{ color: "#00C8E0" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white" style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.03em" }}>SOSphere</p>
            <div className="flex items-center gap-1">
              <Building2 className="size-2.5 flex-shrink-0" style={{ color: "rgba(255,150,0,0.5)" }} />
              <p className="truncate" style={{ fontSize: 8.5, color: "rgba(255,150,0,0.45)", fontWeight: 600 }}>{companyName}</p>
            </div>
          </div>
          {!webMode && (
            <button onClick={onToggle} className="size-6 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ color: "rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── GUIDE ME — Compact inline button ── */}
      <div className="mx-3 mb-2">
        <motion.button
          onClick={() => { try { hapticLight(); } catch {} onGuideMe?.(); if (!webMode) onToggle(); }}
          whileTap={{ scale: 0.97 }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg relative overflow-hidden"
          style={{
            background: activeEmergencyCount > 0
              ? "linear-gradient(135deg, rgba(255,45,85,0.1) 0%, rgba(255,45,85,0.03) 100%)"
              : "linear-gradient(135deg, rgba(0,200,224,0.06) 0%, rgba(123,94,255,0.03) 100%)",
            border: `1px solid ${activeEmergencyCount > 0 ? "rgba(255,45,85,0.12)" : "rgba(0,200,224,0.08)"}`,
          }}
        >
          <div className="size-6 rounded-md flex items-center justify-center flex-shrink-0" style={{
            background: activeEmergencyCount > 0
              ? "rgba(255,45,85,0.15)"
              : "rgba(0,200,224,0.1)",
          }}>
            {activeEmergencyCount > 0 ? (
              <motion.div animate={{ rotate: [0, -10, 10, -10, 0] }} transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}>
                <Siren className="size-3" style={{ color: "#FF2D55" }} />
              </motion.div>
            ) : (
              <Zap className="size-3" style={{ color: "#00C8E0" }} />
            )}
          </div>
          <p style={{
            fontSize: 11, fontWeight: 700,
            color: activeEmergencyCount > 0 ? "#FF2D55" : "#00C8E0",
          }}>
            {activeEmergencyCount > 0 ? "GUIDE ME NOW" : "Guide Me"}
          </p>
          <ChevronRight className="size-3 ml-auto flex-shrink-0" style={{ color: activeEmergencyCount > 0 ? "rgba(255,45,85,0.25)" : "rgba(0,200,224,0.2)" }} />
        </motion.button>
      </div>

      {/* Navigation Groups — Danger Priority: Highest → Lowest */}
      <div className="flex-1 overflow-y-auto px-2" style={{ scrollbarWidth: "none" }}>
        {/* ── 🔴 LIVE THREAT ── */}
        <NavGroupLabel label="LIVE THREAT" color="255,45,85" first />
        {NAV_LIVE_THREAT.map(item => (
          <SidebarNavItem
            key={item.id}
            item={item}
            active={currentPage === item.id}
            onClick={() => { onNavigate(item.id); if (!webMode) onToggle(); }}
            badge={item.id === "emergencyHub" ? activeEmergencyCount : undefined}
          />
        ))}

        {/* ── 🧠 INTELLIGENCE ── */}
        <NavGroupLabel label="INTELLIGENCE" color="123,94,255" />
        {NAV_INTELLIGENCE.map(item => (
          <SidebarNavItem
            key={item.id}
            item={item}
            active={currentPage === item.id}
            onClick={() => { onNavigate(item.id); if (!webMode) onToggle(); }}
          />
        ))}

        {/* ── 🔵 OPERATIONS ── */}
        <NavGroupLabel label="OPERATIONS" color="0,200,224" />
        {NAV_OPERATIONS.map(item => (
          <SidebarNavItem
            key={item.id}
            item={item}
            active={currentPage === item.id}
            onClick={() => { onNavigate(item.id); if (!webMode) onToggle(); }}
          />
        ))}

        {/* ── 🟢 COMPLIANCE ── */}
        <NavGroupLabel label="COMPLIANCE" color="0,200,83" />
        {NAV_COMPLIANCE.map(item => (
          <SidebarNavItem
            key={item.id}
            item={item}
            active={currentPage === item.id}
            onClick={() => { onNavigate(item.id); if (!webMode) onToggle(); }}
          />
        ))}

        {/* ── ⚙️ SYSTEM ── */}
        <NavGroupLabel label="SYSTEM" color="128,144,165" />
        {NAV_SYSTEM.map(item => (
          <SidebarNavItem
            key={item.id}
            item={item}
            active={currentPage === item.id}
            onClick={() => { onNavigate(item.id); if (!webMode) onToggle(); }}
          />
        ))}
        <SidebarNavItem
          item={{ id: "settings" as DashPage, icon: Settings, label: t("nav.settings") }}
          active={currentPage === "settings"}
          onClick={() => { onNavigate("settings" as DashPage); if (!webMode) onToggle(); }}
        />
        {/* Billing removed from sidebar — accessible as sub-tab inside Settings */}
        <div style={{ height: 8 }} />
      </div>

      {/* Trial Countdown Banner — shown when trial ≤ 7 days left */}
      {companyState && isTrial(companyState) && trialDaysRemaining(companyState) <= 7 && (() => {
        const daysLeft = trialDaysRemaining(companyState);
        const isUrgent = daysLeft <= 3;
        return (
          <div className="mx-3 mb-2">
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-3 py-2.5 rounded-xl relative overflow-hidden"
              style={{
                background: isUrgent
                  ? "linear-gradient(135deg, rgba(255,45,85,0.1), rgba(255,45,85,0.04))"
                  : "linear-gradient(135deg, rgba(255,179,0,0.1), rgba(255,179,0,0.04))",
                border: `1px solid ${isUrgent ? "rgba(255,45,85,0.2)" : "rgba(255,179,0,0.2)"}`,
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="size-1.5 rounded-full flex-shrink-0"
                  style={{ background: isUrgent ? "#FF2D55" : "#FFB300" }}
                />
                <Clock className="size-3 flex-shrink-0" style={{ color: isUrgent ? "#FF2D55" : "#FFB300" }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: isUrgent ? "#FF2D55" : "#FFB300" }}>
                  {daysLeft} day{daysLeft !== 1 ? "s" : ""} left in trial
                </span>
              </div>
              <button
                onClick={() => { onNavigate("billing" as DashPage); if (!webMode) onToggle(); }}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#fff",
                  background: isUrgent
                    ? "linear-gradient(135deg, #FF2D55, #CC2244)"
                    : "linear-gradient(135deg, #FFB300, #E6A200)",
                  cursor: "pointer",
                }}
              >
                <ArrowUpRight className="size-3" />
                Upgrade Now
              </button>
            </motion.div>
          </div>
        );
      })()}

      {/* Bottom: Compact User Profile */}
      {authState && (() => {
        const roleCfg = ROLE_CONFIG[authState.user.role];
        return (
          <div className="mx-3 mb-3 px-2.5 py-2 rounded-lg flex items-center gap-2"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="size-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: `${roleCfg.color}15`, border: `1px solid ${roleCfg.color}12` }}>
              <User className="size-3.5" style={{ color: roleCfg.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white truncate" style={{ fontSize: 11, fontWeight: 600 }}>{authState.user.name}</p>
              <p className="truncate" style={{ fontSize: 8, color: roleCfg.color, fontWeight: 600 }}>{roleCfg.label}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 px-1.5 py-0.5 rounded-md"
              style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.08)" }}>
              <div className="size-1 rounded-full" style={{ background: "#00C853" }} />
              <span style={{ fontSize: 8, color: "#00C853", fontWeight: 700 }}>87%</span>
            </div>
          </div>
        );
      })()}
    </div>
  );

  // ── Web mode: persistent sidebar ─────────────────────────────
  if (webMode) {
    return (
      <div
        className="flex flex-col h-full flex-shrink-0"
        style={{
          width: 256,
          background: "linear-gradient(180deg, #080c1a 0%, #050710 50%, #040610 100%)",
          borderRight: "1px solid rgba(0,200,224,0.05)",
          boxShadow: "2px 0 24px rgba(0,0,0,0.25), 1px 0 0 rgba(255,255,255,0.02)",
        }}
      >
        {sidebarContent}
      </div>
    );
  }

  // ── Mobile mode: overlay drawer ──��────────────────────────────
  return (
    <AnimatePresence>
      {!collapsed && (
        <div className="contents">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            onClick={onToggle}
          />
          {/* Sidebar Panel */}
          <motion.div
            initial={{ x: -260 }}
            animate={{ x: 0 }}
            exit={{ x: -260 }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="absolute left-0 top-0 bottom-0 z-50 flex flex-col"
            style={{
              width: 256,
              background: "linear-gradient(180deg, #070b17 0%, #05070E 100%)",
              borderRight: "1px solid rgba(0,200,224,0.06)",
            }}
          >
            {sidebarContent}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ── NavGroupLabel — Sidebar section header ─────────────────────
function NavGroupLabel({ label, color, first }: { label: string; color: string; first?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 ${first ? "pt-1" : "pt-5"} pb-2`}>
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, rgba(${color},0.15), transparent)` }} />
      <span style={{ fontSize: 9, fontWeight: 700, color: `rgba(${color},0.35)`, letterSpacing: "0.12em" }}>
        {label}
      </span>
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, rgba(${color},0.15))` }} />
    </div>
  );
}

// Color mapping per nav item — danger priority gradient (red→orange→purple→cyan→green→gray)
const NAV_ITEM_COLORS: Record<string, string> = {
  emergencyHub: "#FF2D55", riskMap: "#FF9500",
  safetyIntel: "#7B5EFF", overview: "#00C8E0",
  operations: "#00C8E0", people: "#4A90D9",
  incidentRisk: "#FF9500", reportsAnalytics: "#00C853",
  governance: "#8090A5", settings: "#8090A5",
};

function SidebarNavItem({ item, active, onClick, badge }: {
  item: { id: string; icon: any; label: string };
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  const Icon = item.icon;
  const accent = NAV_ITEM_COLORS[item.id] || "#00C8E0";
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      whileHover={{ x: active ? 0 : 2 }}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl mb-0.5 transition-all duration-200 group relative overflow-hidden"
      style={{
        background: active
          ? `linear-gradient(135deg, ${accent}18 0%, ${accent}08 100%)`
          : "transparent",
        border: active ? `1px solid ${accent}20` : "1px solid transparent",
        boxShadow: active ? `0 2px 12px ${accent}0A, inset 0 1px 0 rgba(255,255,255,0.03)` : "none",
      }}
    >
      {/* Active indicator bar — color matches danger level */}
      {active && (
        <motion.div
          layoutId="sidebar-indicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
          style={{ width: 3, height: 18, background: `linear-gradient(180deg, ${accent}, ${accent}88)`, boxShadow: `0 0 8px ${accent}60` }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
      <div className="size-7 rounded-[9px] flex items-center justify-center flex-shrink-0 transition-all"
        style={{
          background: active
            ? `linear-gradient(135deg, ${accent}28 0%, ${accent}14 100%)`
            : "rgba(255,255,255,0.03)",
          border: active ? `1px solid ${accent}25` : "1px solid rgba(255,255,255,0.04)",
          boxShadow: active ? `0 2px 8px ${accent}15` : "none",
        }}>
        <Icon className="size-3.5" style={{ color: active ? accent : "rgba(255,255,255,0.3)", strokeWidth: active ? 2 : 1.5 }} />
      </div>
      <span style={{
        fontSize: 12.5,
        fontWeight: active ? 600 : 450,
        color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)",
        letterSpacing: "-0.01em",
        transition: "all 0.2s ease",
      }}>{item.label}</span>
      {badge !== undefined && badge > 0 && (
        <motion.span
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="ml-auto px-1.5 py-0.5 rounded-md"
          style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: `linear-gradient(135deg, ${accent}, ${accent}CC)`, minWidth: 18, textAlign: "center", boxShadow: `0 2px 8px ${accent}50` }}>
          {badge}
        </motion.span>
      )}
    </motion.button>
  );
}

// ═══════════════════════════════════════════════════════════════
// Topbar Component
// ═══════════════════════════════════════════════════════════════
function DashTopbar({ currentPage, notifCount, notifUnread = 0, onOpenNotifs, onToggleSidebar, onLogout, companyName, t, lang, onLangChange, webMode = false, missedCallCount = 0, onOpenMissedCalls, isRefreshing = false, lastRefreshedAt = null, onManualRefresh }: {
  currentPage: DashPage;
  notifCount: number;
  notifUnread?: number;
  onOpenNotifs?: () => void;
  onToggleSidebar: () => void;
  onLogout: () => void;
  companyName: string;
  t: (k: string) => string;
  lang: Lang;
  onLangChange: (l: Lang) => void;
  webMode?: boolean;
  missedCallCount?: number;
  onOpenMissedCalls?: () => void;
  isRefreshing?: boolean;
  lastRefreshedAt?: Date | null;
  onManualRefresh?: () => void;
}) {
  // Only pages that can actually be currentPage (after PAGE_ALIASES + PAGE_TO_HUB redirects)
  const pageInfo: Partial<Record<DashPage, { title: string; desc: string; group: string }>> = {
    // ── Core Hub Pages (Sidebar) ──
    overview: { title: t("pg.overview"), desc: "Real-time operations center", group: "OPERATIONS" },
    emergencyHub: { title: "Emergency Hub", desc: "Unified incident management center", group: "OPERATIONS" },
    riskMap: { title: t("pg.risk"), desc: "Live situational awareness", group: "OPERATIONS" },
    safetyIntel: { title: "Safety Intelligence", desc: "AI-powered predictive risk engine", group: "OPERATIONS" },
    operations: { title: "Operations Hub", desc: "Journeys, workforce, comms & connectivity", group: "OPERATIONS" },
    people: { title: "People & Teams", desc: "Directory, buddy system, readiness & scores", group: "OPERATIONS" },
    incidentRisk: { title: "Incident & Risk", desc: "Investigation, CAPA & risk assessment", group: "COMPLIANCE" },
    reportsAnalytics: { title: "Reports & Analytics", desc: "Compliance reports, metrics & scheduling", group: "COMPLIANCE" },
    governance: { title: "Governance", desc: "Audit trail & access control", group: "SYSTEM" },
    settings: { title: t("pg.settings"), desc: "Company config & integrations", group: "MANAGEMENT" },
    // ── Standalone Pages (not inside hubs) ──
    location: { title: "Location & Zones", desc: "Sites, zones & geofencing", group: "MANAGEMENT" },
    billing: { title: "Plans & Billing", desc: "Subscription & usage management", group: "MANAGEMENT" },
    csvGuide: { title: "CSV Field Guide", desc: "Bulk import documentation", group: "MANAGEMENT" },
    weatherAlerts: { title: "Weather Alerts", desc: "Environmental hazard monitoring", group: "SAFETY TOOLS" },
    rrpAnalytics: { title: "Response Analytics", desc: "Response performance, heatmaps & comparisons", group: "OPERATIONS" },
  };

  const info = pageInfo[currentPage] || { title: currentPage, desc: "", group: "SOSphere" };

  return (
    <div className="relative z-30 flex items-center gap-3 px-6 pb-3"
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        paddingTop: webMode ? 18 : 14,
        background: webMode ? "linear-gradient(180deg, rgba(7,11,23,0.98) 0%, rgba(7,11,23,0.92) 100%)" : "transparent",
        backdropFilter: webMode ? "blur(24px)" : "none",
      }}>
      {/* Menu toggle — hidden in web mode since sidebar is always visible */}
      {!webMode && (
        <button onClick={onToggleSidebar} className="size-9 rounded-[10px] flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <Layers className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
        </button>
      )}

      {/* Page title with breadcrumb — company name removed (already in sidebar) */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span style={{ fontSize: 10, color: (
            { OPERATIONS: "rgba(0,200,224,0.4)", COMPLIANCE: "rgba(0,200,83,0.4)", SYSTEM: "rgba(128,144,165,0.4)", "SAFETY TOOLS": "rgba(255,150,0,0.4)", MANAGEMENT: "rgba(74,144,217,0.4)" } as Record<string, string>
          )[info.group] || "rgba(0,200,224,0.4)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {info.group}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-white truncate" style={{ fontSize: webMode ? 18 : 15, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {info.title}
          </p>
          {webMode && (
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", fontWeight: 400, letterSpacing: "-0.005em" }}>
              {info.desc}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Offline Status */}
        <OfflineIndicator />
        {/* Last Refreshed + Manual Refresh */}
        {webMode && (
          <button
            onClick={() => onManualRefresh?.()}
            disabled={isRefreshing}
            title={lastRefreshedAt ? `Last updated: ${lastRefreshedAt.toLocaleTimeString()}` : "Refresh data"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all"
            style={{
              background: isRefreshing ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${isRefreshing ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.06)"}`,
              opacity: isRefreshing ? 0.7 : 1,
            }}
          >
            <RefreshCw
              className="size-3.5"
              style={{
                color: isRefreshing ? "#00C8E0" : "rgba(255,255,255,0.3)",
                animation: isRefreshing ? "spin 1s linear infinite" : "none",
              }}
            />
            {lastRefreshedAt && !isRefreshing && (
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>
                {lastRefreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {isRefreshing && (
              <span style={{ fontSize: 10, color: "#00C8E0", fontWeight: 600 }}>Syncing…</span>
            )}
          </button>
        )}
        {/* Language Picker */}
        <LanguagePicker lang={lang} onChange={onLangChange} compact />
        {/* Missed Calls Badge */}
        <button
          onClick={() => onOpenMissedCalls?.()}
          className="relative size-9 rounded-[10px] flex items-center justify-center transition-all"
          style={{
            background: missedCallCount > 0 ? "rgba(255,150,0,0.08)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${missedCallCount > 0 ? "rgba(255,150,0,0.15)" : "rgba(255,255,255,0.06)"}`,
          }}
        >
          <PhoneMissed className="size-3.5" style={{ color: missedCallCount > 0 ? "#FF9500" : "rgba(255,255,255,0.35)" }} />
          {missedCallCount > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center rounded-full" style={{
              minWidth: 16, height: 16, padding: "0 4px",
              background: "linear-gradient(135deg, #FF9500, #FF6B00)",
              fontSize: 9, fontWeight: 800, color: "#fff",
              boxShadow: "0 2px 8px rgba(255,150,0,0.4)",
            }}>
              {missedCallCount > 9 ? "9+" : missedCallCount}
            </span>
          )}
        </button>
        {/* Notifications */}
        <NotificationsBellButton
          unreadCount={notifUnread}
          onClick={() => onOpenNotifs?.()}
        />
        {/* Logout */}
        <button onClick={onLogout} className="size-9 rounded-[10px] flex items-center justify-center transition-all"
          style={{ background: "rgba(255,45,85,0.05)", border: "1px solid rgba(255,45,85,0.1)" }}>
          <LogOut className="size-3.5" style={{ color: "rgba(255,45,85,0.45)" }} />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Missed Calls Panel — Slide-over with call back support
// ═══════════════════════════════════════════════════════════════
function MissedCallsPanel({ calls, onClose, onMarkSeen, onCallBack }: {
  calls: MissedCall[];
  onClose: () => void;
  onMarkSeen: (id: string) => void;
  onCallBack: (call: MissedCall) => void;
}) {
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const unseenCount = calls.filter(c => !c.seen).length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[180] flex justify-end"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ x: 380 }}
        animate={{ x: 0 }}
        exit={{ x: 380 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="h-full flex flex-col"
        style={{
          width: 380,
          background: "linear-gradient(180deg, #080c1a 0%, #050710 100%)",
          borderLeft: "1px solid rgba(255,150,0,0.08)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="size-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(255,150,0,0.1)", border: "1px solid rgba(255,150,0,0.15)" }}>
            <PhoneMissed className="size-4" style={{ color: "#FF9500" }} />
          </div>
          <div className="flex-1">
            <p className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>Missed Calls</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
              {unseenCount > 0 ? `${unseenCount} unseen` : "All caught up"}
            </p>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <X className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
          </button>
        </div>

        {/* Call list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ scrollbarWidth: "none" }}>
          {calls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="size-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <Phone className="size-6" style={{ color: "rgba(255,255,255,0.15)" }} />
              </div>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>No missed calls</p>
            </div>
          ) : calls.map((call) => (
            <motion.div
              key={call.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl p-3"
              style={{
                background: call.seen ? "rgba(255,255,255,0.02)" : "rgba(255,150,0,0.04)",
                border: `1px solid ${call.seen ? "rgba(255,255,255,0.04)" : "rgba(255,150,0,0.1)"}`,
              }}
            >
              <div className="flex items-start gap-3">
                {/* Unseen indicator */}
                <div className="relative mt-1">
                  <div className="size-9 rounded-xl flex items-center justify-center"
                    style={{
                      background: call.seen ? "rgba(255,255,255,0.04)" : "rgba(255,150,0,0.1)",
                      border: `1px solid ${call.seen ? "rgba(255,255,255,0.06)" : "rgba(255,150,0,0.15)"}`,
                    }}>
                    <PhoneMissed className="size-3.5" style={{ color: call.seen ? "rgba(255,255,255,0.3)" : "#FF9500" }} />
                  </div>
                  {!call.seen && (
                    <div className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full"
                      style={{ background: "#FF9500", boxShadow: "0 0 6px rgba(255,150,0,0.5)" }} />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>
                    {call.employeeName}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {call.zone && (
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                        {call.zone}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>•</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                      {call.missedOn === "desktop" ? "Desktop" : call.missedOn === "phone" ? "Phone" : "Both"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <Clock className="size-2.5" style={{ color: "rgba(255,255,255,0.2)" }} />
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                      {formatTime(call.timestamp)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1.5">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onCallBack(call)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{
                      background: "linear-gradient(135deg, rgba(0,200,83,0.15), rgba(0,200,83,0.05))",
                      border: "1px solid rgba(0,200,83,0.2)",
                    }}
                  >
                    <Phone className="size-3" style={{ color: "#00C853" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853" }}>Call Back</span>
                  </motion.button>
                  {!call.seen && (
                    <button
                      onClick={() => onMarkSeen(call.id)}
                      className="px-3 py-1 rounded-lg"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.3)",
                      }}
                    >
                      Mark Seen
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
