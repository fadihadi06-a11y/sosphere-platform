// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — Stripe Plan Catalog (R-22 single source of truth, R-29 corrected)
// ═══════════════════════════════════════════════════════════════════════════

export type Cycle = "monthly" | "annual";

export interface PlanDef {
  /** Stable plan identifier — used as both `tier` and `plan` in subscriptions row. */
  id: string;
  /** B2B (company-scoped) or B2C (user-scoped). */
  scope: "b2b" | "b2c";
  /** Display name (for ops / dashboards). */
  name: string;
  /** Cycles this plan supports. */
  cycles: Cycle[];
}

export const PLAN_CATALOG: PlanDef[] = [
  // ── B2B plans (company-scoped) ──
  { id: "starter",    scope: "b2b", name: "Starter",    cycles: ["monthly", "annual"] },
  { id: "growth",     scope: "b2b", name: "Growth",     cycles: ["monthly", "annual"] },
  { id: "business",   scope: "b2b", name: "Business",   cycles: ["monthly", "annual"] },
  { id: "enterprise", scope: "b2b", name: "Enterprise", cycles: ["monthly", "annual"] },

  // ── B2C plans (user-scoped) ──
  // R-29 (2026-05-17): go-to-market is Free + Basic ($7/mo) + Elite ($14/mo).
  // R-22 wrongly added "Personal" $4.99 based on a stale entry in
  // src/app/constants/pricing.ts INDIVIDUAL_PLANS. That has been corrected.
  // ALWAYS keep in sync with INDIVIDUAL_PLANS — Free is not a Stripe plan
  // so it's intentionally absent from this catalog.
  { id: "basic",      scope: "b2c", name: "Basic",      cycles: ["monthly", "annual"] },
  { id: "elite",      scope: "b2c", name: "Elite",      cycles: ["monthly", "annual"] },

  // ── Deprecated: kept as inert alias for back-compat ──
  // R-22 briefly introduced "personal" but no real subscription was ever
  // created at that tier (only test-mode Stripe artifacts). Kept as a
  // permissive alias so any orphan webhook events from a stray test
  // checkout still map to a known plan rather than dumping to
  // stripe_unmapped_events.
  { id: "personal",   scope: "b2c", name: "Personal (deprecated)", cycles: ["monthly", "annual"] },
];

/** All valid plan IDs (for input validation). */
export const VALID_PLAN_IDS = PLAN_CATALOG.map((p) => p.id);

/** All valid billing cycles. */
export const VALID_CYCLES: Cycle[] = ["monthly", "annual"];

/**
 * Build the Supabase secret key holding a given (plan, cycle)'s Stripe price ID.
 * Example: priceEnvKey("basic", "annual") → "STRIPE_PRICE_BASIC_ANNUAL"
 */
export function priceEnvKey(planId: string, cycle: Cycle): string {
  return `STRIPE_PRICE_${planId.toUpperCase()}_${cycle.toUpperCase()}`;
}

/**
 * Map a Stripe price ID back to its plan ID by walking the catalog and
 * checking each env var. Returns null if no match — caller decides whether
 * that's a fatal error (UnmappedPriceError) or a soft skip (add-on event).
 *
 * The envGetter callback abstracts Deno.env.get vs process.env vs test mock.
 */
export function lookupPlanByPriceEnv(
  priceId: string | undefined,
  envGetter: (k: string) => string | undefined,
): string | null {
  if (!priceId) return null;
  for (const plan of PLAN_CATALOG) {
    for (const cycle of plan.cycles) {
      if (envGetter(priceEnvKey(plan.id, cycle)) === priceId) return plan.id;
    }
  }
  return null;
}

/** Check whether a plan id exists in the catalog. */
export function isValidPlanId(id: string): boolean {
  return VALID_PLAN_IDS.includes(id);
}

/** Look up a plan definition by id. */
export function getPlanDef(id: string): PlanDef | undefined {
  return PLAN_CATALOG.find((p) => p.id === id);
}
