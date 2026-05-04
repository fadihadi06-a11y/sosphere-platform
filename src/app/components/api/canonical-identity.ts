/**
 * canonical-identity.ts — single entry point for "who is this user"
 *
 * FOUNDATION-1 / Phase 5d (#180): replaces ad-hoc 2-query pattern that
 * scattered identity resolution across mobile-app.tsx, dashboard-web-page.tsx,
 * and various route guards. Calls public.get_my_identity() (FOUNDATION-1
 * Phase 4 + Phase 6 invariants) which atomically returns:
 *
 *   {
 *     user_id, email, primary_role, active_company {id, name},
 *     company_role, employee_data, profile, capabilities[], warnings[]
 *   }
 *
 * BEEHIVE PROPERTY
 * ────────────────
 * Every caller in the codebase that needs to answer "is this user an owner?
 * which company? which role? what can they do?" funnels through HERE. If the
 * shape of identity changes (new field, renamed role, etc.), exactly ONE
 * file changes and the entire app stays in sync. Before this helper, that
 * answer was reconstructed in N places — and the inconsistencies were the
 * source of the warnings the get_my_identity RPC ITSELF reports.
 *
 * FALLBACK
 * ────────
 * If the RPC errors (e.g., during a migration window where the function
 * temporarily doesn't exist), we fall back to the legacy 2-query pattern:
 *   1) companies WHERE owner_id = user.id  → owner flow
 *   2) company_memberships WHERE user_id = ... AND active = true → admin flow
 * Note: the fallback uses memberships, NOT invitations (the legacy code
 * had a latent bug here — see #180 commit message).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeRpc } from "./safe-rpc";

export type PrimaryRole =
  | "owner"
  | "admin"
  | "employee"
  | "dispatcher"
  | "civilian"
  | "guest";

export interface CanonicalIdentity {
  /** UUID from auth.users — null when caller is unauthenticated */
  user_id: string | null;
  /** Verified email (auth.users.email) */
  email: string | null;
  /** The single source of truth for "what is this user". */
  primary_role: PrimaryRole;
  /** When user has an active company membership */
  active_company: { id: string; name: string } | null;
  /** Membership role within that company (owner|admin|employee|dispatcher) */
  company_role: string | null;
  /** Operational employee data (only when role IN employee/dispatcher) */
  employee_data: {
    name?: string;
    status?: string;
    role?: string;
    zone?: { id: string; name: string } | null;
    department?: string;
    phone?: string;
    verified?: boolean;
    last_seen_at?: string;
  } | null;
  /** Display metadata (NOT auth-authoritative) */
  profile: {
    full_name?: string;
    user_type?: string;
    role?: string;
  } | null;
  /** Whitelisted capabilities — UI gates should use these, not raw role */
  capabilities: string[];
  /** Invariant violations detected at read time. Empty after L1 (#179). */
  warnings: string[];
}

/**
 * Primary entry point. Calls get_my_identity() RPC; falls back to legacy
 * queries only if the RPC is unavailable. Always returns a normalized shape.
 *
 * Designed to NEVER throw — failed calls return a guest-shaped identity so
 * the UI can render the login form rather than crash.
 */
export async function loadCanonicalIdentity(
  supabase: SupabaseClient,
): Promise<CanonicalIdentity> {
  // ── E1.6-PHASE3 (2026-05-04): direct fetch first, supabase.rpc second ──
  // safeRpc bypasses supabase-js auth lock entirely. If the auth lock is
  // wedged by an unrelated boot-time acquisition (proven to happen via
  // the PHASE1 instrumentation), supabase.rpc("get_my_identity") deadlocks
  // forever. The Jobs page and any other identity-gated page MUST keep
  // working in that scenario, so we try the direct fetch first.
  try {
    const { data, error } = await safeRpc<Record<string, unknown>>("get_my_identity", {}, { timeoutMs: 6000 });
    if (!error && data && typeof data === "object") {
      return normalizeIdentity(data);
    }
    if (error && error.message !== "no-session") {
      console.warn("[canonical-identity] safeRpc failed, trying supabase.rpc:", error.message);
    }
  } catch (err) {
    console.warn("[canonical-identity] safeRpc threw, trying supabase.rpc:", err);
  }

  // ── Secondary path: supabase.rpc (uses auth lock; may deadlock) ─────
  try {
    const { data, error } = await supabase.rpc("get_my_identity");
    if (!error && data && typeof data === "object") {
      const id = data as Record<string, unknown>;
      return normalizeIdentity(id);
    }
    if (error) {
      console.warn("[canonical-identity] RPC error, falling back:", error.message);
    }
  } catch (err) {
    console.warn("[canonical-identity] RPC threw, falling back:", err);
  }

  // ── Fallback: legacy 2-query pattern (migration window safety) ──────
  return loadIdentityFallback(supabase);
}

/**
 * Map the JSONB blob returned by the RPC into the typed CanonicalIdentity.
 * Tolerant of missing fields — defaults to safe guest shape.
 */
function normalizeIdentity(raw: Record<string, unknown>): CanonicalIdentity {
  const ac = raw.active_company as Record<string, unknown> | null | undefined;
  const ed = raw.employee_data as Record<string, unknown> | null | undefined;
  const pr = raw.profile as Record<string, unknown> | null | undefined;
  const caps = Array.isArray(raw.capabilities) ? (raw.capabilities as string[]) : [];
  const warns = Array.isArray(raw.warnings) ? (raw.warnings as string[]) : [];
  return {
    user_id: typeof raw.user_id === "string" ? raw.user_id : null,
    email: typeof raw.email === "string" ? raw.email : null,
    primary_role: ((raw.primary_role as string) || "guest") as PrimaryRole,
    active_company: ac && typeof ac.id === "string"
      ? { id: ac.id as string, name: (ac.name as string) || "Your Company" }
      : null,
    company_role: typeof raw.company_role === "string" ? raw.company_role : null,
    employee_data: ed && typeof ed.name === "string"
      ? {
          name: ed.name as string,
          status: ed.status as string | undefined,
          role: ed.role as string | undefined,
          zone: (ed.zone && typeof ed.zone === "object")
            ? ed.zone as { id: string; name: string }
            : null,
          department: ed.department as string | undefined,
          phone: ed.phone as string | undefined,
          verified: ed.verified as boolean | undefined,
          last_seen_at: ed.last_seen_at as string | undefined,
        }
      : null,
    profile: pr
      ? {
          full_name: pr.full_name as string | undefined,
          user_type: pr.user_type as string | undefined,
          role: pr.role as string | undefined,
        }
      : null,
    capabilities: caps,
    warnings: warns,
  };
}

/**
 * Legacy fallback: only used if the RPC errors. Reads:
 *   • auth.getSession() for user_id + email
 *   • companies WHERE owner_id = user.id      → owner detection
 *   • company_memberships WHERE user_id = ... AND active = true → role
 *   • companies (joined) for active_company.name
 *
 * NOTE: deliberately does NOT read invitations. The legacy dashboard code
 * used invitations as a proxy for "is this user an admin", which is wrong:
 * invitations are workflow history, memberships are current state.
 * This bug was the actual root cause of "stale invitee shown as admin"
 * issues (#180 commit body for details).
 */
async function loadIdentityFallback(
  supabase: SupabaseClient,
): Promise<CanonicalIdentity> {
  const guest: CanonicalIdentity = {
    user_id: null,
    email: null,
    primary_role: "guest",
    active_company: null,
    company_role: null,
    employee_data: null,
    profile: null,
    capabilities: ["public.read"],
    warnings: ["fallback_path_used"],
  };

  try {
    const { data: sessionRes } = await supabase.auth.getSession();
    const user = sessionRes.session?.user;
    if (!user) return guest;

    const base: CanonicalIdentity = {
      ...guest,
      user_id: user.id,
      email: user.email || null,
      primary_role: "civilian",
      capabilities: ["public.read", "self.read", "self.update"],
    };

    // 1. Owner check
    const { data: ownedCompany } = await supabase
      .from("companies")
      .select("id, name")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (ownedCompany) {
      return {
        ...base,
        primary_role: "owner",
        company_role: "owner",
        active_company: { id: ownedCompany.id, name: ownedCompany.name || "Your Company" },
      };
    }

    // 2. Active membership check (the CORRECT source of truth, not invitations)
    const { data: membership } = await supabase
      .from("company_memberships")
      .select("company_id, role, companies(name)")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (membership) {
      const co = (membership as { companies?: { name?: string } | null }).companies;
      return {
        ...base,
        primary_role: (membership.role as PrimaryRole) || "employee",
        company_role: membership.role,
        active_company: {
          id: membership.company_id,
          name: co?.name || "Your Company",
        },
      };
    }

    return base;
  } catch (err) {
    console.warn("[canonical-identity] fallback threw, returning guest:", err);
    return guest;
  }
}
