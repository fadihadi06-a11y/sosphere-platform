// ═══════════════════════════════════════════════════════════════
// SOSphere — Authenticated Role Resolver  (S-H7)
// ─────────────────────────────────────────────────────────────
// `dashboard-auth-guard.ts` reads `session.role` directly from a
// localStorage-cached DashboardSession object. That's fine for
// showing/hiding UI, but NOT safe as the sole authority for any
// action that could change data — a user can edit localStorage
// and self-promote to "super_admin".
//
// This module provides the server-authoritative alternative:
//
//   getAuthenticatedRole() — calls supabase.auth.getUser() (which
//     hits the server to validate the JWT, not the locally-cached
//     session), then reads `employees.role` for that user_id.
//     Returns { role, companyId, userId, verified: true } or
//     { verified: false, reason } on failure.
//
// Use this BEFORE any destructive / privileged operation where
// `verifyPermissionServer()` from api/server-permission.ts is
// too coarse. For pure UI gating, keep using the localStorage
// session — this call has a network round-trip.
//
// A small cache (15 s TTL) prevents re-fetching on rapid renders.
// Cleared on logout via the `sosphere:logged-out` event.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";

export interface AuthenticatedRole {
  verified: true;
  userId: string;
  role: string;
  companyId: string | null;
}

export interface RoleResolutionFailure {
  verified: false;
  reason:
    | "no_session"         // getUser() returned no user (signed out or expired)
    | "no_employee_row"    // user authed but no row in employees table
    | "network_error";
}

export type RoleResolution = AuthenticatedRole | RoleResolutionFailure;

const CACHE_TTL_MS = 15_000;
let cache: { result: RoleResolution; expiresAt: number } | null = null;

// Auto-clear cache on logout event so the next call after sign-out
// doesn't return a stale role for the previous user.
if (typeof window !== "undefined") {
  window.addEventListener("sosphere:logged-out", () => { cache = null; });
}

/**
 * Resolve the current user's role using server-validated auth.
 * Safe to call from non-security paths (it's cached), but any
 * destructive action should ALSO call verifyPermissionServer()
 * for action-specific checks.
 */
export async function getAuthenticatedRole(
  opts: { bypassCache?: boolean } = {},
): Promise<RoleResolution> {
  const now = Date.now();
  if (!opts.bypassCache && cache && cache.expiresAt > now) {
    return cache.result;
  }

  try {
    // supabase.auth.getUser() hits /auth/v1/user and revalidates
    // the JWT against the server — this is different from
    // getSession() which only decodes the locally-stored token.
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.id) {
      const result: RoleResolution = { verified: false, reason: "no_session" };
      cache = { result, expiresAt: now + CACHE_TTL_MS };
      return result;
    }

    // Pull role from the employees table. RLS restricts this to
    // rows where user_id = auth.uid(), so a user cannot peek at
    // another user's role even with a malformed query.
    const { data, error: empErr } = await supabase
      .from("employees")
      .select("role, company_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (empErr) {
      return { verified: false, reason: "network_error" };
    }
    if (!data?.role) {
      // User is authenticated but has no employee row. They may be
      // a `company_owner` (which is tracked on the companies table
      // under owner_id) — fall through to that check.
      const { data: ownerCompany } = await supabase
        .from("companies")
        .select("id")
        .eq("owner_id", user.id)
        .maybeSingle();
      if (ownerCompany?.id) {
        const result: AuthenticatedRole = {
          verified: true,
          userId: user.id,
          role: "company_owner",
          companyId: ownerCompany.id,
        };
        cache = { result, expiresAt: now + CACHE_TTL_MS };
        return result;
      }
      const result: RoleResolution = { verified: false, reason: "no_employee_row" };
      cache = { result, expiresAt: now + CACHE_TTL_MS };
      return result;
    }

    const result: AuthenticatedRole = {
      verified: true,
      userId: user.id,
      role: String(data.role),
      companyId: data.company_id ?? null,
    };
    cache = { result, expiresAt: now + CACHE_TTL_MS };
    return result;
  } catch {
    return { verified: false, reason: "network_error" };
  }
}

/** Explicitly clear the role cache (used by completeLogout). */
export function clearRoleCache(): void {
  cache = null;
}
