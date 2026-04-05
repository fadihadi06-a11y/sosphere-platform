// ═══════════════════════════════════════════════════════════════
// SOSphere — Dashboard Auth Guard
// ─────────────────────────────────────────────────────────────
// Checks localStorage + Supabase for session validity.
// Used as a route loader to block unauthenticated /dashboard access.
// Role-based page protection for dashboard navigation.
// ═══════════════════════════════════════════════════════════════

import { redirect } from "react-router";
import type { Role, Permission } from "../mobile-auth";

const AUTH_KEY = "sosphere_dashboard_auth";

// Session version — bump this to invalidate all existing sessions after code changes
const SESSION_VERSION = 3; // Bumped for role-based auth

export interface DashboardSession {
  name: string;
  company: string;
  loginAt: number;
  version?: number;
  role?: Role;
  userId?: string;
  permissions?: Permission[];
}

/** Set auth session after successful login */
export function setDashboardSession(
  name: string,
  company: string,
  role?: Role,
  userId?: string,
  permissions?: Permission[],
): void {
  try {
    const session: DashboardSession = {
      name, company, loginAt: Date.now(), version: SESSION_VERSION,
      role: role || "company_admin",
      userId: userId || `USR-${Date.now()}`,
      permissions,
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  } catch { /* localStorage unavailable */ }
}

/** Clear auth session on logout */
export function clearDashboardSession(): void {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch { /* localStorage unavailable */ }
}

/** Read current session (or null) */
export function getDashboardSession(): DashboardSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DashboardSession;
  } catch {
    return null;
  }
}

// FIX 9: Session TTL — 24 hours. Prevents stale sessions from persisting indefinitely.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Check if session is expired */
export function isSessionExpired(session: DashboardSession): boolean {
  // Reject sessions from older versions (pre-auth-flow fix)
  if ((session.version || 0) < SESSION_VERSION) return true;
  return Date.now() - session.loginAt > SESSION_TTL_MS;
}

/** Route loader — redirects to /dashboard?login=required if not authenticated or expired */
export function dashboardAuthLoader() {
  const session = getDashboardSession();
  if (!session) {
    throw redirect("/?authRequired=dashboard");
  }
  // FIX 9: Reject expired sessions
  if (isSessionExpired(session)) {
    clearDashboardSession();
    throw redirect("/?authRequired=dashboard&reason=expired");
  }
  return session;
}

// ═══════════════════════════════════════════════════════════════
// Page-Level Role Protection
// Maps dashboard pages to required roles/permissions.
// ═══════════════════════════════════════════════════════════════

/** Dashboard page identifiers (must match navigateTo() keys) */
export type DashboardPage =
  | "overview" | "employees" | "location" | "emergencyHub"
  | "comms" | "roles" | "billing" | "settings" | "analytics"
  | "commandCenter" | "reports" | "audit" | "geofencing"
  | "training" | "ire" | "sar";

/** Minimum role tier required for each page (lower = more powerful) */
const PAGE_ACCESS: Record<DashboardPage, {
  minTier: number;
  requiredPermission?: Permission;
  label: string;
}> = {
  overview:       { minTier: 8, label: "Dashboard Overview" },                     // Everyone
  employees:      { minTier: 7, requiredPermission: "users:view", label: "Employees" },
  location:       { minTier: 7, requiredPermission: "zones:view", label: "Location" },
  emergencyHub:   { minTier: 7, requiredPermission: "emergency:view", label: "Emergency Hub" },
  comms:          { minTier: 5, requiredPermission: "emergency:broadcast", label: "Communications" },
  geofencing:     { minTier: 4, requiredPermission: "zones:edit", label: "Geofencing" },
  training:       { minTier: 6, label: "Training Center" },
  ire:            { minTier: 6, requiredPermission: "emergency:view", label: "Incident Reports" },
  sar:            { minTier: 4, requiredPermission: "emergency:escalate", label: "SAR Missions" },
  reports:        { minTier: 4, requiredPermission: "reports:view", label: "Reports" },
  analytics:      { minTier: 3, requiredPermission: "reports:view", label: "Analytics" },
  commandCenter:  { minTier: 3, requiredPermission: "command:view", label: "Command Center" },
  roles:          { minTier: 2, requiredPermission: "users:manage", label: "Roles & Permissions" },
  audit:          { minTier: 2, requiredPermission: "audit:view", label: "Audit Log" },
  billing:        { minTier: 2, requiredPermission: "billing:view", label: "Billing" },
  settings:       { minTier: 2, requiredPermission: "settings:edit", label: "Settings" },
};

// Import role tier mapping
import { ROLE_CONFIG } from "../mobile-auth";

/**
 * Check if the current session has access to a specific page.
 * Returns { allowed, reason } so the UI can show appropriate messaging.
 */
export function canAccessPage(
  session: DashboardSession | null,
  page: DashboardPage,
): { allowed: boolean; reason?: string } {
  if (!session) return { allowed: false, reason: "Not authenticated" };

  const pageConfig = PAGE_ACCESS[page];
  if (!pageConfig) return { allowed: false, reason: "Unknown page" }; // Deny by default for security

  const userRole = session.role || "company_admin";
  const userTier = ROLE_CONFIG[userRole]?.tier || 8;

  // Check role tier
  if (userTier > pageConfig.minTier) {
    return {
      allowed: false,
      reason: `"${pageConfig.label}" requires ${getRoleNameByTier(pageConfig.minTier)} or higher`,
    };
  }

  // Check specific permission if defined
  if (pageConfig.requiredPermission && session.permissions) {
    if (!session.permissions.includes(pageConfig.requiredPermission)) {
      return {
        allowed: false,
        reason: `Missing permission: ${pageConfig.requiredPermission}`,
      };
    }
  }

  return { allowed: true };
}

/** Get role name by tier number */
function getRoleNameByTier(tier: number): string {
  const entry = Object.entries(ROLE_CONFIG).find(([_, cfg]) => cfg.tier === tier);
  return entry ? entry[1].label : `Tier ${tier}`;
}

/**
 * Get list of accessible pages for a session.
 * Used to filter sidebar navigation items.
 */
export function getAccessiblePages(session: DashboardSession | null): DashboardPage[] {
  if (!session) return [];
  return (Object.keys(PAGE_ACCESS) as DashboardPage[]).filter(
    (page) => canAccessPage(session, page).allowed,
  );
}