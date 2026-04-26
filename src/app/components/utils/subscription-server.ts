// ═══════════════════════════════════════════════════════════════════════════
// utils/subscription-server — server-authoritative civilian tier resolver
// ─────────────────────────────────────────────────────────────────────────
// 2026-04-25 (B-17): the mobile app maintained `userPlan` purely in React
// state, set by callbacks like `onUpgrade(plan)`. Two failure modes:
//
//   1. The Stripe Checkout flow flips the local flag *before* Stripe even
//      processes the payment. A user could close the tab, the webhook
//      never fires, and they'd still see "Elite" features locally.
//
//   2. Cross-device login (sign in on a fresh phone) had NO mechanism to
//      learn the user's paid tier — they'd get reset to 'free'.
//
// Both are fixed by making the server (subscriptions table, populated by
// stripe-webhook) the single source of truth and reading it on every
// session restore via `get_my_subscription_tier()` RPC.
//
// The RPC returns one of:
//   'free' | 'basic' | 'elite' | 'starter' | 'growth' | 'business' | 'enterprise'
//
// We normalise to the civilian-app userPlan domain { free | pro | employee }:
//   free        → 'free'
//   basic|elite → 'pro'         (civilian paid)
//   any company tier → 'employee' is set by the EMPLOYEE login path,
//      not by this helper — civilians never receive a company tier here.
//
// FAIL-SECURE: any RPC error / network failure / unexpected shape →
// 'free'. We never silently grant paid access from a failed read.
// ═══════════════════════════════════════════════════════════════════════════

export type CivilianUserPlan = "free" | "pro" | "employee";

export interface ServerTierResult {
  /** Civilian-app domain plan. */
  plan: CivilianUserPlan;
  /** Raw tier string the server returned, for telemetry. */
  rawTier: string;
  /** Why we chose this plan — useful for log-grep. */
  reason:
    | "server_active_pro"
    | "server_free"
    | "server_unknown_tier"
    | "rpc_error"
    | "rpc_no_data"
    | "rpc_threw";
}

const PRO_TIERS = new Set(["basic", "elite"]);
const COMPANY_TIERS = new Set(["starter", "growth", "business", "enterprise"]);

/**
 * Read the active server-side tier and translate to civilian userPlan.
 *
 * Pure function — takes a thunk returning `{ data, error }` so it stays
 * decoupled from supabase-js shape (and trivially testable).
 */
export async function fetchCivilianTier(
  rpcFn: () => Promise<{ data: unknown; error: unknown | null }>,
  currentUserPlan: CivilianUserPlan = "free",
): Promise<ServerTierResult> {
  // EMPLOYEE plan is owned by the corporate login path — this helper
  // never overrides it. A civilian who is also logged into a company
  // workspace stays on 'employee' until they actively switch.
  if (currentUserPlan === "employee") {
    return { plan: "employee", rawTier: "employee", reason: "server_unknown_tier" };
  }

  let resp: { data: unknown; error: unknown | null };
  try {
    resp = await rpcFn();
  } catch {
    return { plan: "free", rawTier: "", reason: "rpc_threw" };
  }

  if (resp.error) {
    return { plan: "free", rawTier: "", reason: "rpc_error" };
  }
  if (resp.data === null || resp.data === undefined) {
    return { plan: "free", rawTier: "", reason: "rpc_no_data" };
  }

  const raw = String(resp.data).toLowerCase().trim();
  if (raw === "free" || raw === "") {
    return { plan: "free", rawTier: raw, reason: "server_free" };
  }
  if (PRO_TIERS.has(raw)) {
    return { plan: "pro", rawTier: raw, reason: "server_active_pro" };
  }
  if (COMPANY_TIERS.has(raw)) {
    // A civilian session shouldn't have a company tier mapped to user_id,
    // but if it does (admin testing / data migration) we default to 'free'
    // — corporate login is the only path that flips to 'employee'.
    return { plan: "free", rawTier: raw, reason: "server_unknown_tier" };
  }
  return { plan: "free", rawTier: raw, reason: "server_unknown_tier" };
}
