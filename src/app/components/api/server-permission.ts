// ═══════════════════════════════════════════════════════════════
// SOSphere — Server-side Permission Verification  (S-C2)
// ─────────────────────────────────────────────────────────────
// Client-side role/permission checks (canAccessPage, etc.) are
// FINE for UI gating — they show/hide buttons based on the
// session.role cached in localStorage. But they MUST NOT be the
// only line of defence for destructive / sensitive actions,
// because a motivated user can edit localStorage directly to
// elevate their own `role` field and bypass every client check.
//
// This module wraps the `verify_permission(TEXT)` Supabase RPC —
// which is SECURITY DEFINER and queries the authoritative
// `employees` / `companies` tables with `auth.uid()`. The result
// is the source of truth and the ONLY acceptable check before
// running a billing / audit / admin / user-management action.
//
// A short in-memory cache (per-permission, 30s) avoids N+1
// round-trips when a page renders multiple gated elements. The
// cache is cleared on logout via completeLogout() so a session
// change cannot leak stale permissions.
//
// USAGE (at call-site of any destructive or privileged action):
//
//   import { verifyPermissionServer } from "./api/server-permission";
//
//   const { allowed, reason, role } =
//     await verifyPermissionServer("billing:update");
//   if (!allowed) {
//     showError(`Access denied: ${reason ?? "server declined"}`);
//     return;
//   }
//   // ...proceed with the action
//
// The RPC response shape is:
//   { allowed: boolean, role?: string, company_id?: string, reason?: string }
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";

export interface ServerPermissionResult {
  allowed: boolean;
  role?: string;
  company_id?: string;
  reason?: string;
}

/** Reason codes the RPC may return. Client can localise these. */
export type ServerPermissionReason =
  | "unauthenticated"
  | "no_role"
  | "insufficient_role"
  | "rpc_error"
  | "network_error";

// Short-TTL cache so a page can gate multiple buttons without
// hammering the server. 30 s is small enough that a permission
// revocation takes effect on the next page nav in the worst case.
interface CacheEntry {
  result: ServerPermissionResult;
  expiresAt: number;
}
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

/**
 * Check a permission against the server. ALWAYS prefer this over
 * reading `session.permissions` from localStorage before doing
 * anything destructive.
 *
 * Fails CLOSED on any error — if the RPC can't be reached, we
 * return `{ allowed: false, reason: "network_error" }` rather than
 * optimistically allowing the action.
 */
export async function verifyPermissionServer(
  permission: string,
  opts: { bypassCache?: boolean } = {},
): Promise<ServerPermissionResult> {
  if (!permission || typeof permission !== "string") {
    return { allowed: false, reason: "rpc_error" };
  }

  const now = Date.now();
  if (!opts.bypassCache) {
    const hit = cache.get(permission);
    if (hit && hit.expiresAt > now) return hit.result;
  }

  try {
    const { data, error } = await supabase.rpc("verify_permission", {
      p_permission: permission,
    });

    if (error) {
      console.warn("[server-permission] RPC error:", error.message);
      return { allowed: false, reason: "rpc_error" };
    }

    // Normalise: the RPC returns a jsonb object with at least `allowed`.
    const result: ServerPermissionResult = {
      allowed: Boolean(data?.allowed),
      role: typeof data?.role === "string" ? data.role : undefined,
      company_id:
        typeof data?.company_id === "string" ? data.company_id : undefined,
      reason: typeof data?.reason === "string" ? data.reason : undefined,
    };

    cache.set(permission, { result, expiresAt: now + CACHE_TTL_MS });
    return result;
  } catch (err) {
    console.warn("[server-permission] network/unexpected error:", err);
    return { allowed: false, reason: "network_error" };
  }
}

/**
 * Clear the in-memory permission cache. Called on logout / session
 * change so the next check always hits the server with the new user.
 */
export function clearPermissionCache(): void {
  cache.clear();
}

/**
 * Convenience: returns true/false only. Use this when you don't
 * care about the reason (e.g. hiding a button). For destructive
 * actions, prefer verifyPermissionServer() so you can surface
 * why the server declined.
 */
export async function isPermissionAllowed(
  permission: string,
): Promise<boolean> {
  const r = await verifyPermissionServer(permission);
  return r.allowed;
}
