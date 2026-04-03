// ═══════════════════════════════════════════════════════════════
// MOBILE COMPANY — Lightweight Plan & Billing System
// Mirrors CompanyContext.tsx from web (4 plans + Trial + Billing)
// ═══════════════════════════════════════════════════════════════

export type PlanTier = "starter" | "growth" | "business" | "enterprise";
export type BillingStatus = "active" | "trial" | "trial_expired" | "past_due" | "suspended" | "cancelled";

// ── Account Status (used by PricingPage UI) ──
export type AccountStatus =
  | "trial_active"
  | "trial_ending"
  | "trial_expired"
  | "active"
  | "payment_failed"
  | "grace_period"
  | "suspended";

// ── Map BillingStatus → AccountStatus for PricingPage ──
export function toAccountStatus(
  status: BillingStatus,
  trialDaysLeft?: number,
): AccountStatus {
  if (status === "trial") {
    return (trialDaysLeft !== undefined && trialDaysLeft <= 3) ? "trial_ending" : "trial_active";
  }
  const map: Record<BillingStatus, AccountStatus> = {
    active: "active",
    trial: "trial_active",
    trial_expired: "trial_expired",
    past_due: "payment_failed",
    suspended: "suspended",
    cancelled: "suspended",
  };
  return map[status] ?? "trial_active";
}

// ── Plan Feature Matrix ──
export interface PlanConfig {
  tier: PlanTier;
  label: string;
  labelAr: string;
  color: string;
  maxEmployees: number;       // -1 = unlimited
  maxZones: number;
  maxEmergencies: number;     // concurrent, -1 = unlimited
  features: PlanFeature[];
  price: number;              // USD/month
}

export type PlanFeature =
  | "basic_dashboard"
  | "emergency_management"
  | "employee_management"
  | "zone_management"
  | "attendance"
  | "incident_history"
  | "risk_map"
  | "command_center"
  | "wall_mode"
  | "audit_logs"
  | "api_access"
  | "custom_branding"
  | "sla_management"
  | "advanced_analytics"
  | "multi_site"
  | "ai_co_admin"
  | "custom_reports";

const PLAN_CONFIGS: Record<PlanTier, PlanConfig> = {
  starter: {
    tier: "starter", label: "Starter", labelAr: "ستارتر", color: "#00C8E0",
    maxEmployees: 25, maxZones: 3, maxEmergencies: 5, price: 149,
    features: ["basic_dashboard", "emergency_management", "employee_management", "zone_management", "attendance"],
  },
  growth: {
    tier: "growth", label: "Growth", labelAr: "قروث", color: "#7B5EFF",
    maxEmployees: 100, maxZones: 10, maxEmergencies: 20, price: 349,
    features: [
      "basic_dashboard", "emergency_management", "employee_management", "zone_management",
      "attendance", "incident_history", "risk_map", "command_center", "audit_logs",
    ],
  },
  business: {
    tier: "business", label: "Business", labelAr: "بزنس", color: "#F59E0B",
    maxEmployees: 500, maxZones: -1, maxEmergencies: -1, price: 799,
    features: [
      "basic_dashboard", "emergency_management", "employee_management", "zone_management",
      "attendance", "incident_history", "risk_map", "command_center", "wall_mode",
      "audit_logs", "api_access", "sla_management", "advanced_analytics",
      "ai_co_admin", "custom_reports",
    ],
  },
  enterprise: {
    tier: "enterprise", label: "Enterprise", labelAr: "إنتربرايز", color: "#00C853",
    maxEmployees: -1, maxZones: -1, maxEmergencies: -1, price: 0,
    features: [
      "basic_dashboard", "emergency_management", "employee_management", "zone_management",
      "attendance", "incident_history", "risk_map", "command_center", "wall_mode",
      "audit_logs", "api_access", "custom_branding", "sla_management", "advanced_analytics", "multi_site",
      "ai_co_admin", "custom_reports",
    ],
  },
};

// ── Company Profile ──
export interface CompanyProfile {
  id: string;
  name: string;
  nameAr: string;
  plan: PlanTier;
  billingStatus: BillingStatus;
  billingCycle?: "monthly" | "annual";
  employeeCount: number;
  trialEndsAt?: Date;       // only if trial
  createdAt: Date;
}

// ── Company State ──
export interface CompanyState {
  company: CompanyProfile;
  planConfig: PlanConfig;
}

export function createCompanyState(
  plan: PlanTier = "starter",
  billingStatus: BillingStatus = "trial",
  employeeCount = 12,
): CompanyState {
  const trialEndsAt = billingStatus === "trial"
    ? new Date(Date.now() + 14 * 86400000)
    : billingStatus === "trial_expired"
      ? new Date(Date.now() - 86400000)
      : undefined;

  return {
    company: {
      id: "COM-001",
      name: "SafeGuard Industries",
      nameAr: "صناعات سيف جارد",
      plan,
      billingStatus,
      employeeCount,
      trialEndsAt,
      createdAt: new Date("2025-06-01"),
    },
    planConfig: PLAN_CONFIGS[plan],
  };
}

// ── Feature Gates ──
export function hasFeature(state: CompanyState, feature: PlanFeature): boolean {
  return state.planConfig.features.includes(feature);
}

export function isFeatureLocked(state: CompanyState, feature: PlanFeature): boolean {
  return !hasFeature(state, feature);
}

// ── Billing Gates ──
export function isTrial(state: CompanyState): boolean {
  return state.company.billingStatus === "trial";
}

export function isTrialExpired(state: CompanyState): boolean {
  return state.company.billingStatus === "trial_expired";
}

export function trialDaysRemaining(state: CompanyState): number {
  if (!state.company.trialEndsAt) return 0;
  return Math.max(0, Math.ceil((state.company.trialEndsAt.getTime() - Date.now()) / 86400000));
}

export function isPastDue(state: CompanyState): boolean {
  return state.company.billingStatus === "past_due";
}

export function canCreateEmergency(state: CompanyState): boolean {
  const s = state.company.billingStatus;
  return s === "active" || s === "trial";
}

export function isAccountBlocked(state: CompanyState): boolean {
  const s = state.company.billingStatus;
  return s === "trial_expired" || s === "suspended" || s === "cancelled";
}

// ── Usage ──
export function employeeUsagePercent(state: CompanyState): number {
  if (state.planConfig.maxEmployees === -1) return 0;
  return Math.round((state.company.employeeCount / state.planConfig.maxEmployees) * 100);
}

export function employeesRemaining(state: CompanyState): number {
  if (state.planConfig.maxEmployees === -1) return Infinity;
  return Math.max(0, state.planConfig.maxEmployees - state.company.employeeCount);
}

export function effectiveEmployeeLimit(state: CompanyState): string {
  return state.planConfig.maxEmployees === -1 ? "∞" : String(state.planConfig.maxEmployees);
}

export { PLAN_CONFIGS };