import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { DashPage, Employee, EmergencyItem, ZoneData } from "../dashboard-types";
import type { Role, AuthState } from "../mobile-auth";
import { createAuthState, hasPermission } from "../mobile-auth";
import { createCompanyState, hasFeature, canCreateEmergency as canCreateEmgBilling, type CompanyState, type PlanTier } from "../mobile-company";
import { isTrial as isTrialFn, isTrialExpired, trialDaysRemaining } from "../mobile-company";
import type { PriorityOverrideLog } from "../priority-engine";
import { markAsOwned, pinAsActive, clearManualPriority } from "../priority-engine";
import { detectClusters, type ZoneCluster } from "../zone-cluster-engine";
import type { IREContext } from "../intelligent-guide";
import type { AICoAdminContext } from "../ai-co-admin";
import type { IncidentReportData } from "../incident-photo-report";
import type { Lang } from "../dashboard-i18n";
import { getMissedCalls, getUnseenMissedCalls, type MissedCall } from "../shared-store";
import { fetchEmployees, fetchEmergencies, fetchZones, fetchKPIs, resolveEmergency, dispatchTeam, type KPIData } from "../api/data-layer";
import { auditEmergency, auditEmergencyResolved } from "../audit-log-store";
import { recordRRPSession } from "../rrp-analytics-store";

// =================================================================
// Trial Helpers
// =================================================================

function computeTrialFields(companyState: CompanyState) {
  const trialActive = isTrialFn(companyState);
  const trialExpired = isTrialExpired(companyState);
  const daysLeft = trialDaysRemaining(companyState);
  const endsAt = companyState.company.trialEndsAt
    ? companyState.company.trialEndsAt.toISOString()
    : null;

  return {
    trialEndsAt: endsAt,
    trialDaysLeft: daysLeft,
    isTrialActive: trialActive && daysLeft > 0,
    isTrial: trialActive || trialExpired,
  };
}

// =================================================================
// Types
// =================================================================

export interface DashboardState {
  // â”€â”€ Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  currentPage: DashPage;
  sidebarCollapsed: boolean;
  hubTabs: Record<string, string>;

  // â”€â”€ Data (will migrate to React Query) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  employees: Employee[];
  emergencies: EmergencyItem[];
  zones: ZoneData[];
  kpis: KPIData;
  lastRefreshedAt: Date | null;
  isRefreshing: boolean;

  // â”€â”€ Computed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  activeEmergencyCount: number;
  zoneClusters: ZoneCluster[];

  // â”€â”€ Auth & RBAC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  activeRole: Role;
  authState: AuthState;
  companyState: CompanyState;

  // â”€â”€ UI State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  lang: Lang;
  showCreateEmergency: boolean;
  showNotifPanel: boolean;
  showGlobalSearch: boolean;
  notifCount: number;
  notifUnread: number;

  // â”€â”€ SOS Popup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  dismissedSosIds: Set<string>;

  // â”€â”€ Incident Reports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  pendingIncidentReport: IncidentReportData | null;
  showIncidentReportPanel: boolean;

  // â”€â”€ Priority System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showPriorityModal: boolean;
  priorityOverrideTargetId: string | null;
  auditLogs: PriorityOverrideLog[];

  // â”€â”€ Employee Detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  selectedEmployee: Employee | null;

  // â”€â”€ Guided Response / IRE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showGuidedResponse: boolean;
  guidedEmergencyId: string | null;
  showIntelligentGuide: boolean;
  ireEmergencyId: string | null;
  directIreContext: IREContext | null;
  showGuideQuickPanel: boolean;
  showIreTriagePanel: boolean;

  // â”€â”€ AI Co-Admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showAICoAdmin: boolean;
  aiCoAdminContext: AICoAdminContext | null;

  // â”€â”€ Emergency Chat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showEmergencyChat: boolean;
  chatEmergencyId: string | null;
  chatEmployeeName: string;

  // â”€â”€ Cross-Hub Prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  crossHubPrompt: {
    show: boolean;
    emergencyId: string;
    emergencyName: string;
    emergencyType: string;
    severity: "critical" | "high" | "medium" | "low";
    resolvedAt: Date;
    emergencyRef: EmergencyItem;
  } | null;

  // â”€â”€ Hybrid Mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  hybridMode: string;
  tenantBannerDismissed: boolean;

  // â”€â”€ Missed Calls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  missedCalls: MissedCall[];
  unseenMissedCallCount: number;
  showMissedCallPanel: boolean;

  // â”€â”€ Session Timeout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  sessionTimeout: string;

  // â”€â”€ Free Trial â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /*
    SUPABASE_MIGRATION_POINT: trial_state
    Replace with:
    const { data } = await supabase
      .from('companies')
      .select('trial_ends_at')
      .eq('id', companyId)
      .single()
    Then compute daysLeft/isActive from data.trial_ends_at
  */
  trialEndsAt: string | null;     // ISO date string
  trialDaysLeft: number;          // calculated from trialEndsAt
  isTrialActive: boolean;         // true while trial is running (daysLeft > 0)
  isTrial: boolean;               // true if account is on trial (active or expired)
  trialBannerDismissed: boolean;  // session-only dismiss

  // â”€â”€ Trial Blocked Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  trialBlockedModal: {
    show: boolean;
    type: "employee" | "zone" | "generic";
    message: string;
  } | null;

  // â”€â”€ Plan Limit Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  planLimitModal: {
    show: boolean;
    type: "zone" | "employee";
  } | null;
}

export interface DashboardActions {
  // â”€â”€ Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  navigateTo: (page: DashPage | string) => void;
  setCurrentPage: (page: DashPage) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setHubTab: (hub: string, tab: string) => void;
  getHubTab: (hub: string) => string;

  // â”€â”€ Data Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /*
    [SUPABASE_READY] All mutations below (addEmergency, updateEmergency,
    resolveEmergency, cancelEmergencyById) will become:
      await supabase.from('emergencies').insert/update/upsert(...)
    with optimistic updates via zustand + rollback on error.
    Priority overrides (takeOwnership, handlePinAsActive, handleClearPriority)
    will write to 'emergency_audit_log' table.
  */
  addEmergency: (emergency: EmergencyItem) => void;
  updateEmergency: (id: string, updates: Partial<EmergencyItem>) => void;
  resolveEmergency: (id: string) => void;
  /** FIX AUDIT-2.2: ID-based cancel â€” matches emergencyId first, name as fallback */
  cancelEmergencyById: (emergencyId: string, fallbackName: string) => void;
  tickEmergencyTimers: () => void;

  // â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setActiveRole: (role: Role) => void;
  checkPermission: (permission: string) => boolean;

  // â”€â”€ UI State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setLang: (lang: Lang) => void;
  setShowCreateEmergency: (show: boolean) => void;
  setShowNotifPanel: (show: boolean) => void;
  setShowGlobalSearch: (show: boolean) => void;
  incrementNotifCount: () => void;
  setNotifCount: (count: number) => void;
  setNotifUnread: (count: number) => void;

  // â”€â”€ SOS Popup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  dismissSos: (id: string) => void;

  // â”€â”€ Incident Reports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setPendingIncidentReport: (report: IncidentReportData | null) => void;
  setShowIncidentReportPanel: (show: boolean) => void;

  // â”€â”€ Priority System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  takeOwnership: (id: string, adminName?: string) => void;
  handleResolve: (id: string) => void;
  handlePinAsActive: (id: string, reason: string) => void;
  handleClearPriority: (id: string) => void;
  setShowPriorityModal: (show: boolean) => void;
  setPriorityOverrideTargetId: (id: string | null) => void;

  // â”€â”€ Employee Detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setSelectedEmployee: (employee: Employee | null) => void;

  // â”€â”€ Guided Response / IRE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setShowGuidedResponse: (show: boolean) => void;
  setGuidedEmergencyId: (id: string | null) => void;
  setShowIntelligentGuide: (show: boolean) => void;
  setIreEmergencyId: (id: string | null) => void;
  setDirectIreContext: (ctx: IREContext | null) => void;
  setShowGuideQuickPanel: (show: boolean) => void;
  setShowIreTriagePanel: (show: boolean) => void;

  // â”€â”€ AI Co-Admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setShowAICoAdmin: (show: boolean) => void;
  setAICoAdminContext: (ctx: AICoAdminContext | null) => void;

  // â”€â”€ Emergency Chat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setShowEmergencyChat: (show: boolean) => void;
  setChatEmergencyId: (id: string | null) => void;
  setChatEmployeeName: (name: string) => void;

  // â”€â”€ Cross-Hub Prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setCrossHubPrompt: (prompt: DashboardState["crossHubPrompt"]) => void;

  // â”€â”€ Misc â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setHybridMode: (mode: string) => void;
  setTenantBannerDismissed: (dismissed: boolean) => void;

  // â”€â”€ Missed Calls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  refreshMissedCalls: () => void;
  setShowMissedCallPanel: (show: boolean) => void;
  markMissedCallSeenInStore: (callId: string) => void;

  // â”€â”€ Session Timeout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setSessionTimeout: (timeout: string) => void;

  // â”€â”€ Company State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setCompanyState: (state: CompanyState) => void;

  // â”€â”€ Free Trial â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  dismissTrialBanner: () => void;
  refreshTrialState: () => void;

  // â”€â”€ Trial Blocked Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showTrialBlockedModalAction: (type: "employee" | "zone" | "generic", message: string) => void;
  hideTrialBlockedModal: () => void;
  /** Returns true if trial is expired and action should be blocked */
  checkTrialGuard: (type: "employee" | "zone" | "generic") => boolean;

  // â”€â”€ Plan Limit Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showPlanLimitModalAction: (type: "zone" | "employee") => void;
  hidePlanLimitModal: () => void;
  /** Returns true if plan limit is reached and action should be blocked */
  checkPlanLimitGuard: (type: "zone" | "employee") => boolean;

  // â”€â”€ Batch/Reset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  initDashboard: () => Promise<void>;
  refreshDashboard: () => Promise<void>;
  dispatchTeamToEmergency: (emergencyId: string, responders: string[], note?: string) => Promise<boolean>;
  resolveEmergencyById: (emergencyId: string) => Promise<boolean>;
  reset: () => void;
}

// =================================================================
// Page Navigation Helpers (extracted from company-dashboard.tsx)
// =================================================================

const PAGE_ALIASES: Record<string, DashPage> = {
  zones: "location",
  geofencing: "location",
  gpsCompliance: "location",
};

const PAGE_TO_HUB: Record<string, { hub: DashPage; tab: string }> = {
  workforce:              { hub: "operations",       tab: "workforce" },
  comms:                  { hub: "operations",       tab: "comms" },
  offlineMonitor:         { hub: "operations",       tab: "offline" },
  journeyMgmt:            { hub: "operations",       tab: "journey" },
  employees:              { hub: "people",            tab: "directory" },
  buddySystem:            { hub: "people",            tab: "buddy" },
  checklist:              { hub: "people",            tab: "checklist" },
  safetyScore:            { hub: "people",            tab: "score" },
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
  emergencies:            { hub: "emergencyHub",      tab: "active" },
  commandCenter:          { hub: "emergencyHub",      tab: "active" },
  incidents:              { hub: "incidentRisk",      tab: "investigation" },
  attendance:             { hub: "operations",        tab: "workforce" },
  shiftScheduling:        { hub: "operations",        tab: "workforce" },
  broadcast:              { hub: "operations",        tab: "comms" },
  evacuation:             { hub: "operations",        tab: "comms" },
  employeeStatus:         { hub: "people",            tab: "directory" },
};

const DEFAULT_HUB_TABS: Record<string, string> = {
  emergencyHub: "active",
  operations: "missions",
  people: "directory",
  incidentRisk: "investigation",
  reportsAnalytics: "reports",
  governance: "audit",
};

// =================================================================
// Initial State
// =================================================================

function buildInitialCompanyState(): CompanyState {

  try {
    const regStr = typeof window !== "undefined" ? localStorage.getItem("sos_reg_result") : null;
    if (regStr) {
      const reg = JSON.parse(regStr);
      return createCompanyState(reg.plan as PlanTier, "trial", reg.employeeCount ?? 12);
    }
  } catch {}
  return createCompanyState(); // defaults: starter, trial, 12
}

const _initialCompanyState = buildInitialCompanyState();
const _initialTrialFields = computeTrialFields(_initialCompanyState);

const initialState: DashboardState = {
  currentPage: "overview",
  sidebarCollapsed: true, // will be set by webMode
  hubTabs: { ...DEFAULT_HUB_TABS },

  employees: [],
  emergencies: [],
  zones: [],
  kpis: { activeEmergencies: 0, onDutyCount: 0, totalEmployees: 0, resolvedToday: 0, avgResponseTimeSec: 0, complianceRate: 0 },
  lastRefreshedAt: null,
  isRefreshing: false,

  activeEmergencyCount: 0,
  zoneClusters: [],

  activeRole: "company_admin",
  authState: createAuthState("company_admin"),
  /*
    SUPABASE_MIGRATION_POINT: company_state
    Replace localStorage with:
    const { data } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single()
    useStore.setState({ companyState: buildCompanyState(data) })
  */
  companyState: _initialCompanyState,

  lang: "en",
  showCreateEmergency: false,
  showNotifPanel: false,
  showGlobalSearch: false,
  notifCount: 5,
  notifUnread: 5,

  dismissedSosIds: new Set(),

  pendingIncidentReport: null,
  showIncidentReportPanel: false,

  showPriorityModal: false,
  priorityOverrideTargetId: null,
  auditLogs: [],

  selectedEmployee: null,

  showGuidedResponse: false,
  guidedEmergencyId: null,
  showIntelligentGuide: false,
  ireEmergencyId: null,
  directIreContext: null,
  showGuideQuickPanel: false,
  showIreTriagePanel: false,

  showAICoAdmin: false,
  aiCoAdminContext: null,

  showEmergencyChat: false,
  chatEmergencyId: null,
  chatEmployeeName: "",

  crossHubPrompt: null,

  hybridMode: "multi-site",
  tenantBannerDismissed: true,

  missedCalls: [],
  unseenMissedCallCount: 0,
  showMissedCallPanel: false,

  sessionTimeout: "30m",

  // â”€â”€ Free Trial (initialized from companyState) â”€â”€
  trialEndsAt: _initialTrialFields.trialEndsAt,
  trialDaysLeft: _initialTrialFields.trialDaysLeft,
  isTrialActive: _initialTrialFields.isTrialActive,
  isTrial: _initialTrialFields.isTrial,
  trialBannerDismissed: false,

  // â”€â”€ Trial Blocked Modal â”€â”€
  trialBlockedModal: null,

  // â”€â”€ Plan Limit Modal â”€â”€
  planLimitModal: null,
};

// =================================================================
// Recompute derived state
// =================================================================

function recompute(emergencies: EmergencyItem[]) {
  return {
    activeEmergencyCount: emergencies.filter(e => e.status === "active").length,
    zoneClusters: detectClusters(emergencies),
  };
}

// =================================================================
// Store
// =================================================================

export const useDashboardStore = create<DashboardState & DashboardActions>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // â”€â”€ Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    navigateTo: (page: DashPage | string) => {
      const alias = PAGE_ALIASES[page];
      if (alias) { set({ currentPage: alias }); return; }
      const redirect = PAGE_TO_HUB[page];
      if (redirect) {
        set(state => ({
          currentPage: redirect.hub,
          hubTabs: { ...state.hubTabs, [redirect.hub]: redirect.tab },
        }));
      } else {
        set({ currentPage: page as DashPage });
      }
    },

    setCurrentPage: (page) => set({ currentPage: page }),
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),

    setHubTab: (hub, tab) => set(s => ({
      hubTabs: { ...s.hubTabs, [hub]: tab },
    })),

    getHubTab: (hub) => {
      const s = get();
      return s.hubTabs[hub] || ""; 
    },

    // â”€â”€ Data Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    /*
      [SUPABASE_READY] All mutations below (addEmergency, updateEmergency,
      resolveEmergency, cancelEmergencyById) will become:
        await supabase.from('emergencies').insert/update/upsert(...)
      with optimistic updates via zustand + rollback on error.
      Priority overrides (takeOwnership, handlePinAsActive, handleClearPriority)
      will write to 'emergency_audit_log' table.
    */
    addEmergency: (emergency) => set(s => {
      // SOS is never blocked by trial status â€” safety first
      // SUPABASE_MIGRATION_POINT: this guarantee must be
      // enforced server-side via RLS â€” SOS table always writable
      console.log("[SUPABASE_READY] addEmergency:", emergency.id, emergency.type);
      auditEmergency(emergency.id, emergency.type, emergency.employeeName);
      const emergencies = [emergency, ...s.emergencies];
      return { emergencies, ...recompute(emergencies) };
    }),

    updateEmergency: (id, updates) => set(s => {
      console.log("[SUPABASE_READY] updateEmergency:", id, Object.keys(updates));
      const emergencies = s.emergencies.map(e =>
        e.id === id ? { ...e, ...updates } : e
      );
      return { emergencies, ...recompute(emergencies) };
    }),

    resolveEmergency: (id) => set(s => {
      console.log("[SUPABASE_READY] resolveEmergency:", id);
      const resolved = s.emergencies.find(e => e.id === id);
      if (resolved) {
        auditEmergencyResolved(id, resolved.type, resolved.employeeName);
        // REAL: Record admin response performance in RRP Analytics
        try {
          const responseSec = resolved.elapsed || 0; // seconds admin took to resolve
          recordRRPSession({
            emergencyId: id,
            employeeName: resolved.employeeName,
            zone: resolved.zone || "Unknown",
            sosType: resolved.type || "SOS",
            severity: resolved.severity || "high",
            threatLevel: resolved.severity === "critical" ? "high" : "medium",
            totalResponseTime: responseSec,
            actionsCompleted: 3,
            actionsTotal: 3,
            perActionTimes: [responseSec > 6 ? responseSec - 6 : 5, 3, 3],
            autoEscalated: false,
            ireUsed: false,
            outcome: "resolved",
          });
        } catch { /* non-blocking */ }
      }
      const emergencies = s.emergencies.map(e =>
        e.id === id ? { ...e, status: "resolved" as const } : e
      );
      const newState: Partial<DashboardState> = {
        emergencies,
        ...recompute(emergencies),
      };
      // Set cross-hub prompt if resolved
      if (resolved) {
        newState.crossHubPrompt = {
          show: true,
          emergencyId: id,
          emergencyName: resolved.employeeName,
          emergencyType: resolved.type,
          severity: resolved.severity,
          resolvedAt: new Date(),
          emergencyRef: { ...resolved, status: "resolved" as const },
        };
      }
      return newState;
    }),

    // FIX AUDIT-2.2: ID-based cancel â€” prevents resolving wrong emergency on name collision
    cancelEmergencyById: (emergencyId, fallbackName) => set(s => {
      console.log("[SUPABASE_READY] cancelEmergencyById:", emergencyId, "fallback:", fallbackName);
      let matched = false;
      const emergencies = s.emergencies.map(e => {
        // Primary: match by sourceEmergencyId (linked from mobile SOS)
        if (!matched && e.sourceEmergencyId === emergencyId && e.status === "active") {
          matched = true;
          return { ...e, status: "resolved" as const };
        }
        // Also match by direct ID
        if (!matched && e.id === emergencyId && e.status === "active") {
          matched = true;
          return { ...e, status: "resolved" as const };
        }
        return e;
      });
      // Fallback: name-based match ONLY if no ID match found (backward compat)
      if (!matched && fallbackName) {
        let fallbackDone = false;
        const fallbackEmergencies = emergencies.map(e => {
          if (!fallbackDone && e.employeeName === fallbackName && e.status === "active") {
            fallbackDone = true; // Only resolve ONE matching emergency
            return { ...e, status: "resolved" as const };
          }
          return e;
        });
        return { emergencies: fallbackEmergencies, ...recompute(fallbackEmergencies) };
      }
      return { emergencies, ...recompute(emergencies) };
    }),

    tickEmergencyTimers: () => set(s => ({
      emergencies: s.emergencies.map(e =>
        e.status !== "resolved" ? { ...e, elapsed: e.elapsed + 1 } : e
      ),
    })),

    // â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setActiveRole: (role) => set({
      activeRole: role,
      authState: createAuthState(role),
    }),

    checkPermission: (permission) => {
      return hasPermission(get().authState, permission as any);
    },

    // â”€â”€ UI State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setLang: (lang) => set({ lang }),
    setShowCreateEmergency: (show) => set({ showCreateEmergency: show }),
    setShowNotifPanel: (show) => set({ showNotifPanel: show }),
    setShowGlobalSearch: (show) => set({ showGlobalSearch: show }),
    incrementNotifCount: () => set(s => ({ notifCount: s.notifCount + 1 })),
    setNotifCount: (count) => set({ notifCount: count }),
    setNotifUnread: (count) => set({ notifUnread: count }),

    // â”€â”€ SOS Popup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    dismissSos: (id) => set(s => {
      const newSet = new Set(s.dismissedSosIds);
      newSet.add(id);
      return { dismissedSosIds: newSet };
    }),

    // â”€â”€ Incident Reports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setPendingIncidentReport: (report) => set({ pendingIncidentReport: report }),
    setShowIncidentReportPanel: (show) => set({ showIncidentReportPanel: show }),

    // â”€â”€ Priority System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    takeOwnership: (id, adminName = "Admin") => set(s => {
      console.log("[SUPABASE_READY] takeOwnership:", id, "by:", adminName);
      const owned = markAsOwned(s.emergencies, id, adminName);
      const emergencies = owned.map(e => e.id === id ? { ...e, status: "responding" as const } : e);
      return { emergencies, ...recompute(emergencies) };
    }),

    handleResolve: (id) => {
      get().resolveEmergency(id);
    },

    handlePinAsActive: (id, reason) => set(s => {
      try {
        const result = pinAsActive(s.emergencies, id, reason, "Admin");
        return {
          emergencies: result.emergencies,
          auditLogs: [...s.auditLogs, result.auditLog],
          ...recompute(result.emergencies),
        };
      } catch {
        return {};
      }
    }),

    handleClearPriority: (id) => set(s => {
      const emergencies = clearManualPriority(s.emergencies, id);
      return { emergencies, ...recompute(emergencies) };
    }),

    setShowPriorityModal: (show) => set({ showPriorityModal: show }),
    setPriorityOverrideTargetId: (id) => set({ priorityOverrideTargetId: id }),

    // â”€â”€ Employee Detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setSelectedEmployee: (employee) => set({ selectedEmployee: employee }),

    // â”€â”€ Guided Response / IRE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setShowGuidedResponse: (show) => set({ showGuidedResponse: show }),
    setGuidedEmergencyId: (id) => set({ guidedEmergencyId: id }),
    setShowIntelligentGuide: (show) => set({ showIntelligentGuide: show }),
    setIreEmergencyId: (id) => set({ ireEmergencyId: id }),
    setDirectIreContext: (ctx) => set({ directIreContext: ctx }),
    setShowGuideQuickPanel: (show) => set({ showGuideQuickPanel: show }),
    setShowIreTriagePanel: (show) => set({ showIreTriagePanel: show }),

    // â”€â”€ AI Co-Admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setShowAICoAdmin: (show) => set({ showAICoAdmin: show }),
    setAICoAdminContext: (ctx) => set({ aiCoAdminContext: ctx }),

    // â”€â”€ Emergency Chat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setShowEmergencyChat: (show) => set({ showEmergencyChat: show }),
    setChatEmergencyId: (id) => set({ chatEmergencyId: id }),
    setChatEmployeeName: (name) => set({ chatEmployeeName: name }),

    // â”€â”€ Cross-Hub Prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setCrossHubPrompt: (prompt) => set({ crossHubPrompt: prompt }),

    // â”€â”€ Misc â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setHybridMode: (mode) => set({ hybridMode: mode }),
    setTenantBannerDismissed: (dismissed) => set({ tenantBannerDismissed: dismissed }),

    // â”€â”€ Missed Calls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    refreshMissedCalls: () => set(() => ({
      missedCalls: getMissedCalls(),
      unseenMissedCallCount: getUnseenMissedCalls().length,
    })),
    setShowMissedCallPanel: (show) => set({ showMissedCallPanel: show }),
    markMissedCallSeenInStore: (callId) => set(s => {
      const wasUnseen = s.missedCalls.find(c => c.id === callId && !c.seen);
      return {
        missedCalls: s.missedCalls.map(c => c.id === callId ? { ...c, seen: true } : c),
        unseenMissedCallCount: wasUnseen ? Math.max(0, s.unseenMissedCallCount - 1) : s.unseenMissedCallCount,
      };
    }),

    // â”€â”€ Session Timeout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setSessionTimeout: (timeout) => set({ sessionTimeout: timeout }),

    // â”€â”€ Company State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setCompanyState: (state) => set({
      companyState: state,
      ...computeTrialFields(state),
    }),

    // â”€â”€ Free Trial â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    dismissTrialBanner: () => set({ trialBannerDismissed: true }),

    refreshTrialState: () => {
      const s = get();
      const fields = computeTrialFields(s.companyState);
      set(fields);
      console.log("[SUPABASE_READY] trial_refreshed: " + JSON.stringify({
        daysLeft: fields.trialDaysLeft,
        isActive: fields.isTrialActive,
      }));
    },

    // â”€â”€ Trial Blocked Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    showTrialBlockedModalAction: (type, message) => set({
      trialBlockedModal: { show: true, type, message },
    }),

    hideTrialBlockedModal: () => set({ trialBlockedModal: null }),

    /** Returns true if trial is expired and action should be blocked.
     *  If blocked, also opens the modal. */
    checkTrialGuard: (type) => {
      const s = get();
      if (!s.isTrialActive && s.isTrial) {
        const messages: Record<string, string> = {
          employee: "Your trial has ended. Upgrade your plan to add new employees.",
          zone: "Your trial has ended. Upgrade your plan to add new zones.",
          generic: "Your trial has ended. Upgrade your plan to continue.",
        };
        set({ trialBlockedModal: { show: true, type, message: messages[type] } });
        console.log("[SUPABASE_READY] trial_guard_blocked: " + JSON.stringify({ type }));
        return true;
      }
      return false;
    },

    // â”€â”€ Plan Limit Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    showPlanLimitModalAction: (type) => set({
      planLimitModal: { show: true, type },
    }),

    hidePlanLimitModal: () => set({ planLimitModal: null }),

    /** Returns true if plan limit is reached and action should be blocked.
     *  If blocked, also opens the modal. */
    checkPlanLimitGuard: (type) => {
      const s = get();
      const planConfig = s.companyState.planConfig;
      const max = type === "zone" ? planConfig.maxZones : planConfig.maxEmployees;
      const currentCount = type === "zone" ? s.zones.length : s.employees.length;
      if (max !== -1 && currentCount >= max) {
        set({ planLimitModal: { show: true, type } });
        console.log("[SUPABASE_READY] plan_limit_guard_blocked: " + JSON.stringify({
          type, current: currentCount, max, plan: s.companyState.company.plan,
        }));
        return true;
      }
      return false;
    },

    // â”€â”€ Reset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    initDashboard: async () => {
      set({ isRefreshing: true });
      try {
        const [employees, emergencies, zones, kpis] = await Promise.all([
          fetchEmployees(),
          fetchEmergencies(),
          fetchZones(),
          fetchKPIs(),
        ]);
        set({
          employees,
          emergencies,
          zones,
          kpis,
          activeEmergencyCount: emergencies.filter(e => e.status === "active").length,
          zoneClusters: detectClusters(emergencies),
          lastRefreshedAt: new Date(),
          isRefreshing: false,
        });
        console.log("[Dashboard] Loaded: emp=" + employees.length + " emg=" + emergencies.length + " zones=" + zones.length);
      } catch (e) {
        console.warn("[Dashboard] initDashboard failed, keeping mock:", e);
        set({ isRefreshing: false });
      }
    },

    refreshDashboard: async () => {
      const { initDashboard } = get();
      await initDashboard();
    },

    resolveEmergencyById: async (emergencyId: string) => {
      const { data: { session } } = await import("../api/supabase-client").then(m => m.supabase.auth.getSession());
      const resolvedBy = session?.user?.email || "admin";
      const success = await resolveEmergency(emergencyId, resolvedBy);
      if (success) {
        set(s => ({
          emergencies: s.emergencies.map(e =>
            e.id === emergencyId ? { ...e, status: "resolved" as const } : e
          ),
          activeEmergencyCount: Math.max(0, s.activeEmergencyCount - 1),
          kpis: { ...s.kpis, activeEmergencies: Math.max(0, s.kpis.activeEmergencies - 1), resolvedToday: s.kpis.resolvedToday + 1 },
        }));
      }
      return success;
    },

    dispatchTeamToEmergency: async (emergencyId: string, responders: string[], note?: string) => {
      const success = await dispatchTeam(emergencyId, responders, note);
      if (success) {
        set(s => ({
          emergencies: s.emergencies.map(e =>
            e.id === emergencyId ? { ...e, status: "active" as const } : e
          ),
        }));
      }
      return success;
    },
    reset: () => set(initialState),
  })),
);

// =================================================================
// Selectors (for performance â€” prevents unnecessary re-renders)
// =================================================================

/** Only re-render when emergencies change */
export const useEmergencies = () => useDashboardStore(s => s.emergencies);

/** Only re-render when active emergency count changes */
export const useActiveEmergencyCount = () => useDashboardStore(s => s.activeEmergencyCount);

/** Only re-render when zone clusters change */
export const useZoneClusters = () => useDashboardStore(s => s.zoneClusters);

/** Only re-render when auth changes */
export const useAuth = () => useDashboardStore(s => ({
  role: s.activeRole,
  authState: s.authState,
  companyState: s.companyState,
}));

/** Only re-render when navigation changes */
export const useNavigation = () => useDashboardStore(s => ({
  currentPage: s.currentPage,
  sidebarCollapsed: s.sidebarCollapsed,
  hubTabs: s.hubTabs,
}));

/** Only re-render when lang changes */
export const useLang = () => useDashboardStore(s => s.lang);

/** Trial state selector â€” only re-renders when trial fields change */
export const useTrialState = () => useDashboardStore(s => ({
  trialEndsAt: s.trialEndsAt,
  trialDaysLeft: s.trialDaysLeft,
  isTrialActive: s.isTrialActive,
  isTrial: s.isTrial,
  trialBannerDismissed: s.trialBannerDismissed,
  trialBlockedModal: s.trialBlockedModal,
}));

/** Plan limit state selector â€” only re-renders when plan limit fields change */
export const usePlanLimitState = () => useDashboardStore(s => ({
  planLimitModal: s.planLimitModal,
}));

// =================================================================
// Auto-Refresh Hook — call in DashboardWebPage root
// =================================================================
import { useEffect } from "react";

export function useDashboardAutoRefresh(intervalMs = 30_000) {
  const refreshDashboard = useDashboardStore(s => s.refreshDashboard);
  const initDashboard = useDashboardStore(s => s.initDashboard);

  useEffect(() => {
    // Initial load
    initDashboard();

    // Auto-refresh every 30s
    const timer = setInterval(() => {
      refreshDashboard();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [initDashboard, refreshDashboard, intervalMs]);
}
