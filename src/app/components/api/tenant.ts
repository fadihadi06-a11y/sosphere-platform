// ═══════════════════════════════════════════════════════════════
// SOSphere — Tenant / Company Resolver  (D-C1 / D-M10)
// ─────────────────────────────────────────────────────────────
// The codebase has several ways to obtain the current user's
// company_id:
//   • shared-store.ts#getCompanyId()       — in-memory only
//   • supabase-client.ts#getCompanyIdFromSession(session)
//                                          — parses a session arg
//   • Various service modules each read it from localStorage.
//
// These diverge when a user switches accounts or when in-memory
// state gets out of sync with auth. This module is the canonical
// resolver — it prefers the server RPC `current_company_id()`
// (SECURITY DEFINER, applied in Phase-1 migrations) and falls
// back to the cached values when offline.
//
// Order of precedence:
//   1. Server RPC  — authoritative, picks up role changes live
//   2. auth.getUser() + employees.company_id lookup  — one-shot
//      fallback when the RPC is unreachable
//   3. in-memory shared-store.getCompanyId()
//   4. DashboardSession.company (stringified company name, last resort)
//
// A small 30s cache (same TTL as server-permission.ts) avoids
// re-fetching on every render. Cleared on the logout event.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";

interface CacheEntry {
  companyId: string | null;
  expiresAt: number;
}
const CACHE_TTL_MS = 30_000;
let cache: CacheEntry | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("sosphere:logged-out", () => { cache = null; });
}

/**
 * Resolve the current user's company_id. Returns null if the
 * user is not authenticated or has no tenant association.
 *
 * Safe to await from a React effect. The cache keeps repeated
 * calls within a render cycle to a single round-trip.
 */
export async function getCompanyId(
  opts: { bypassCache?: boolean } = {},
): Promise<string | null> {
  const now = Date.now();
  if (!opts.bypassCache && cache && cache.expiresAt > now) {
    return cache.companyId;
  }

  // Step 1 — server RPC (authoritative).
  try {
    const { data, error } = await supabase.rpc("current_company_id");
    if (!error && typeof data === "string" && data.length > 0) {
      cache = { companyId: data, expiresAt: now + CACHE_TTL_MS };
      return data;
    }
  } catch {
    // RPC unreachable — fall through to lookup.
  }

  // Step 2 — direct lookup via auth.getUser() + employees.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      const { data: emp } = await supabase
        .from("employees")
        .select("company_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (emp?.company_id) {
        cache = { companyId: emp.company_id, expiresAt: now + CACHE_TTL_MS };
        return emp.company_id;
      }
      // User might be the owner (no employee row).
      const { data: owned } = await supabase
        .from("companies")
        .select("id")
        .eq("owner_id", user.id)
        .maybeSingle();
      if (owned?.id) {
        cache = { companyId: owned.id, expiresAt: now + CACHE_TTL_MS };
        return owned.id;
      }
    }
  } catch {
    // Network failure — fall through to local caches.
  }

  // Step 3 — in-memory fallback (existing shared-store singleton).
  try {
    const sharedStore = await import("../shared-store");
    const cached =
      typeof sharedStore.getCompanyId === "function"
        ? sharedStore.getCompanyId()
        : null;
    if (cached) {
      cache = { companyId: cached, expiresAt: now + CACHE_TTL_MS };
      return cached;
    }
  } catch {
    // shared-store unavailable — nothing else to try.
  }

  cache = { companyId: null, expiresAt: now + CACHE_TTL_MS };
  return null;
}

/** Synchronous last-known company_id (from the cache only). Null
 * if nothing has resolved yet. Use this for initial renders that
 * can't await — then reconcile with getCompanyId() in a useEffect. */
export function getCachedCompanyId(): string | null {
  if (!cache) return null;
  // Even expired cache entries are useful as "last known" — freshness
  // is enforced by the async path.
  return cache.companyId;
}

/** Clear the tenant cache (called by completeLogout via event). */
export function clearTenantCache(): void {
  cache = null;
}
