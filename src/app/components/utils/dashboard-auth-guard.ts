// ═══════════════════════════════════════════════════════════════
// SOSphere — Dashboard Auth Guard
// ─────────────────────────────────────────────────────────────
// Checks localStorage for a session flag set during login.
// Used as a route loader to block unauthenticated /dashboard access.
// ═══════════════════════════════════════════════════════════════

import { redirect } from "react-router";

const AUTH_KEY = "sosphere_dashboard_auth";

// Session version — bump this to invalidate all existing sessions after code changes
const SESSION_VERSION = 2;

export interface DashboardSession {
  name: string;
  company: string;
  loginAt: number;
  version?: number;
}

/** Set auth session after successful login */
export function setDashboardSession(name: string, company: string): void {
  try {
    const session: DashboardSession = { name, company, loginAt: Date.now(), version: SESSION_VERSION };
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