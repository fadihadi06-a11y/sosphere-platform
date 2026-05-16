// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — Stripe Plan Catalog (R-22 single source of truth)
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//   Before R-22, stripe-checkout and stripe-webhook each maintained their
//   own copy of the plan list as a hardcoded array:
//     const validPlans = ["starter", "growth", "business", "enterprise",
//                         "basic", "elite"];
//   These arrays drifted: src/app/constants/pricing.ts added "personal"
//   (B2C plan, $4.99/mo + $39.99/yr) but NEITHER edge function picked it
//   up. Result: any civilian who tried to subscribe to Personal was rejected
//   at stripe-checkout with HTTP 400 (validPlans.includes fails). If they
//   bypassed checkout, the webhook would dump the price to
//   stripe_unmapped_events and never write a subscription row.
//
//   Discovered by R-21 Layer 2 ORPHANS.md connectivity scan.
//
// ROOT FIX
//   This single module is the authoritative list. Both stripe-checkout
//   and stripe-webhook import VALID_PLAN_IDS and lookupPlanByPriceEnv
//   from here. To add a new plan in the future, edit this file once.
//
// ADD-ON ROADMAP
//   The 5 add-ons (extra_reports, twilio_sms, extra_zones, advanced_gps,
//   custom_branding) defined in src/app/constants/pricing.ts ADDONS are
//   tracked as a separate concern. Stripe represents them as
//   `subscription_items` on a single subscription. The current schema
//   has only one (plan, tier) per subscriptions row — supporting add-ons
//   requires either a `subscription_addons` table OR a JSONB column on
//   subscriptions. Out of scope for v1 launch. When ready, extend this
//   catalog with `kind: "addon"` entries + update the webhook to handle
//   multi-item subscriptions.
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

  // ── B2C plan (user-scoped) ──
  // R-22: previously missing, causing every Personal subscription attempt to
  // fail. ALWAYS keep in sync with src/app/constants/pricing.ts INDIVIDUAL_PLANS.
  { id: "personal",   scope: "b2c", name: "Personal",   cycles: ["monthly", "annual"] },

  // ── Legacy aliases (B-17 / W3 era) — kept for back-compat ──
  // If a customer was subscribed pre-R-22 with these IDs, webhook events
  // referencing the old prices must still map. Safe to remove ONLY after
  // a full migration of legacy subscription rows to the new IDs.
  { id: "basic",      scope: "b2c", name: "Basic (legacy)",   cycles: ["monthly", "annual"] },
  { id: "elite",      scope: "b2c", name: "Elite (legacy)",   cycles: ["monthly", "annual"] },
];

/** All valid plan IDs (for input validation). */
export const VALID_PLAN_IDS = PLAN_CATALOG.map((p) => p.id);

/** All valid billing cycles. */
export const VALID_CYCLES: Cycle[] = ["monthly", "annual"];

/**
 * Build the Supabase secret key holding a given (plan, cycle)'s Stripe price ID.
 * Example: priceEnvKey("personal", "annual") → "STRIPE_PRICE_PERSONAL_ANNUAL"
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
