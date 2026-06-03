// ═══════════════════════════════════════════════════════════════
// SOSphere — Dashboard Auth Guard  (12th pattern application)
// ─────────────────────────────────────────────────────────────
// SECURITY MODEL (post-2026-06-03 refactor):
//
//   1. Supabase JWT is the only cryptographic authentication.
//      supabase.auth.getUser() hits /auth/v1/user and revalidates the
//      JWT against the server — this is the trust anchor.
//
//   2. RLS + SECDEF RPCs (verify_permission + verify_sensitive_op)
//      are the DATA gates. A forged localStorage cannot read any row
//      because every supabase.from(...) call carries the real JWT.
//
//   3. `role` and `permissions` come from authenticated-role.ts which
//      calls supabase.auth.getUser() + reads employees.role (RLS-scoped
//      to user_id = auth.uid()). Never stored in localStorage.
//
//   4. localStorage holds ONLY display-hint fields (name, company,
//      loginAt) under a NON-AUTH key `sosphere_dashboard_hint`. The
//      key was renamed from `sosphere_dashboard_auth` to make the
//      non-trust semantics self-documenting and to pass the
//      no-localStorage-auth lint-guard rule. A forged hint can lie
//      about the displayed NAME, but cannot grant page access (every
//      canAccessPage call uses the server-resolved role).
//
// Pre-refactor problem (R-837 / R-841 / R-970): role and permissions
// WERE in localStorage under `sosphere_dashboard_auth`. A forged blob
// would show all admin sidebar tabs (UI integrity bug — data was
// still safe via RLS). This refactor removes that class of bug AND
// the misleading key name that suggested auth was being persisted.
//
// Migration: any existing `sosphere_dashboard_auth` key on disk is
// removed on first load (handled by clearLegacyDashboardAuthKey).
// New writes use `sosphere_dashboard_hint`.
// ═══════════════════════════════════════════════════════════════

import { redirect } from "react-router";
import type { Role, Permission } from "../mobile-auth";
import { ROLE_CONFIG, ROLE_PERMISSIONS } from "../mobile-auth";
import { getAuthenticatedRole, type RoleResolution } from "../api/authenticated-role";

// Display hint key — NOT auth. Holds name/company/loginAt only so the
// sidebar can paint instantly while the server role resolves.
const HINT_KEY = "sosphere_dashboard_hint";
// Legacy key (pre-2026-06-03 refactor) that held role/permissions.
// One-shot migration removes it on first load.
const LEGACY_AUTH_KEY = "sosphere_dashboard_auth";

const SESSION_VERSION = 1; // V1 of the hint format (post-2026-06-03 rename)

// ───────── DISPLAY-HINT SESSION (localStorage) ─────────

export interface DashboardSession {
  name:     string;
  company:  string;
  loginAt:  number;
  version?: number;
}

/** Set the display-hint session after a successful PIN+MFA login.
 *  Never store role/permissions — those are server-state. */
export function setDashboardSession(name: string, company: string): void {
  try {
    const session: DashboardSession = {
      name, company, loginAt: Date.now(), version: SESSION_VERSION,
    };
    localStorage.setItem(HINT_KEY, JSON.stringify(session));
    // Defensive: kill any legacy auth blob that might survive a
    // partial migration on a returning user's browser.
    localStorage.removeItem(LEGACY_AUTH_KEY);
  } catch { /* localStorage unavailable */ }
}

/** Drop the display-hint session on logout. Also removes the legacy
 *  pre-refactor key so a shared device cannot leak a stale forged blob. */
export function clearDashboardSession(): void {
  try {
    localStorage.removeItem(HINT_KEY);
    localStorage.removeItem(LEGACY_AUTH_KEY);
  } catch { /* unavailable */ }
}

/** Read the display-hint session (or null). NEVER trust the fields for
 *  access control — they are advisory display hints only. */
export function getDashboardSession(): DashboardSession | null {
  try {
    // Defensive one-shot legacy migration: kill any old
    // `sosphere_dashboard_auth` blob unconditionally. removeItem is a
    // no-op on missing keys, so this is idempotent. We intentionally
    // do NOT `getItem(LEGACY_AUTH_KEY)` because reading an auth-named
    // key trips the no-localStorage-auth lint rule (and would imply
    // trust). The blob, if present, carried role/permissions in v4
    // and is no longer trusted.
    localStorage.removeItem(LEGACY_AUTH_KEY);
    const raw = localStorage.getItem(HINT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DashboardSession;
  } catch {
    return null;
  }
}

// D-M9: Session TTL tightened from 24h to 8h.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Check if the display-hint session is expired (or unknown version). */
export function isSessionExpired(session: DashboardSession): boolean {
  if ((session.version || 0) < SESSION_VERSION) return true;
  return Date.now() - session.loginAt > SESSION_TTL_MS;
}

// ───────── VERIFIED SESSION (server-state, 12th pattern app) ─────────

/** A session whose role/permissions came from the server, not localStorage. */
export interface VerifiedDashboardSession {
  hint:        DashboardSession | null;
  role:        Role;
  userId:      string;
  permissions: Permission[];
  companyId:   string | null;
}

/** Resolve role/permissions from the server and combine with the display hint.
 *  Returns null when the server cannot verify — callers SHOULD redirect to
 *  /?authRequired=dashboard. */
export async function loadVerifiedDashboardSession(): Promise<VerifiedDashboardSession | null> {
  const resolution: RoleResolution = await getAuthenticatedRole();
  if (!resolution.verified) return null;

  const role = (resolution.role as Role) || "company_admin";
  const permissions: Permission[] = ROLE_PERMISSIONS[role] ?? [];

  return {
    hint:        getDashboardSession(),
    role,
    userId:      resolution.userId,
    permissions,
    companyId:   resolution.companyId,
  };
}

/** Route loader — wires server-state auth check at navigation time.
 *  Ready to wire into the /dashboard route; left unwired in the
 *  CRIT-AUTH commit because the in-component login form on /dashboard
 *  depends on null-session pass-through. Wiring is a follow-up. */
export async function dashboardAuthLoader(): Promise<VerifiedDashboardSession> {
  const hint = getDashboardSession();
  if (hint && isSessionExpired(hint)) {
    clearDashboardSession();
    throw redirect("/?authRequired=dashboard&reason=expired");
  }
  const verified = await loadVerifiedDashboardSession();
  if (!verified) {
    throw redirect("/?authRequired=dashboard");
  }
  return verified;
}

// ═══════════════════════════════════════════════════════════════
// Page-Level Role Protection
// ═══════════════════════════════════════════════════════════════

export type DashboardPage =
  | "overview" | "employees" | "location" | "emergencyHub"
  | "comms" | "roles" | "billing" | "settings" | "analytics"
  | "commandCenter" | "reports" | "audit" | "geofencing"
  | "training" | "ire" | "sar";

const PAGE_ACCESS: Record<DashboardPage, {
  minTier:             number;
  requiredPermission?: Permission;
  label:               string;
}> = {
  overview:       { minTier: 8, label: "Dashboard Overview" },
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

/** Check if a server-verified session has access to a page.
 *  Sync — caller MUST pass a VerifiedDashboardSession from
 *  loadVerifiedDashboardSession() or dashboardAuthLoader(). */
export function canAccessPage(
  session: VerifiedDashboardSession | null,
  page: DashboardPage,
): { allowed: boolean; reason?: string } {
  if (!session) return { allowed: false, reason: "Not authenticated" };

  const pageConfig = PAGE_ACCESS[page];
  if (!pageConfig) return { allowed: false, reason: "Unknown page" };

  const userTier = ROLE_CONFIG[session.role]?.tier ?? 8;
  if (userTier > pageConfig.minTier) {
    return {
      allowed: false,
      reason: `"${pageConfig.label}" requires ${getRoleNameByTier(pageConfig.minTier)} or higher`,
    };
  }

  if (pageConfig.requiredPermission) {
    if (!session.permissions.includes(pageConfig.requiredPermission)) {
      return {
        allowed: false,
        reason: `Missing permission: ${pageConfig.requiredPermission}`,
      };
    }
  }

  return { allowed: true };
}

function getRoleNameByTier(tier: number): string {
  const entry = Object.entries(ROLE_CONFIG).find(([_, cfg]) => cfg.tier === tier);
  return entry ? entry[1].label : `Tier ${tier}`;
}

/** Get accessible pages for a verified session. */
export function getAccessiblePages(session: VerifiedDashboardSession | VerifiedDashboardSession | null): DashboardPage[] {
  if (!session) return [];
  return (Object.keys(PAGE_ACCESS) as DashboardPage[]).filter(
    (page) => canAccessPage(session, page).allowed,
  );
}
