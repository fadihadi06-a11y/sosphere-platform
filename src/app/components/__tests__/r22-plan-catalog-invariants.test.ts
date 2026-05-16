// ═══════════════════════════════════════════════════════════════
// R-22 (2026-05-16) — Shared plan catalog invariants
// ─────────────────────────────────────────────────────────────
// CONTEXT
//   Before R-22, stripe-checkout (line 144) and stripe-webhook (line 269)
//   each maintained their OWN copy of the valid plan list:
//     ["starter", "growth", "business", "enterprise", "basic", "elite"]
//   Both missed "personal" (B2C $4.99/mo + $39.99/yr, added in pricing.ts
//   when civilian plans launched). The result:
//     - stripe-checkout: VALID_PLAN_IDS.includes('personal') === false →
//       civilian POST gets 400 Invalid plan
//     - stripe-webhook: lookupPlanByPriceEnv returns null for Personal
//       price → UnmappedPriceError → stripe_unmapped_events (not the
//       subscriptions table)
//   This was a HIGH revenue bug — every B2C subscription attempt
//   silently failed.
//
//   Discovered by R-21 Layer 2 ORPHANS.md connectivity scan.
//
// ROOT FIX
//   _shared/plan-catalog.ts is the SINGLE source of truth. Both functions
//   import from it. To add a new plan, edit the catalog once.
//
// CONTRACT (locked by this test)
//   - The shared catalog file exists and exports the canonical helpers
//   - It includes "personal" with both monthly + annual cycles
//   - stripe-checkout imports VALID_PLAN_IDS, VALID_CYCLES, priceEnvKey
//     from the shared module
//   - stripe-webhook imports lookupPlanByPriceEnv from the shared module
//   - Neither function still has the hardcoded array pattern
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let catalogSrc = "";
let checkoutSrc = "";
let webhookSrc = "";

beforeAll(() => {
  catalogSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/_shared/plan-catalog.ts"),
    "utf8",
  );
  checkoutSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/stripe-checkout/index.ts"),
    "utf8",
  );
  webhookSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/stripe-webhook/index.ts"),
    "utf8",
  );
});

describe("R-22: shared plan catalog file", () => {
  it("plan-catalog.ts exists with substantive content", () => {
    expect(catalogSrc.length).toBeGreaterThan(1000);
  });

  it("exports VALID_PLAN_IDS, VALID_CYCLES, priceEnvKey, lookupPlanByPriceEnv", () => {
    expect(catalogSrc).toMatch(/export const VALID_PLAN_IDS/);
    expect(catalogSrc).toMatch(/export const VALID_CYCLES/);
    expect(catalogSrc).toMatch(/export function priceEnvKey/);
    expect(catalogSrc).toMatch(/export function lookupPlanByPriceEnv/);
  });

  it("PLAN_CATALOG includes 'personal' with monthly + annual cycles", () => {
    // The line should look like:
    //   { id: "personal", scope: "b2c", name: "Personal", cycles: ["monthly", "annual"] }
    expect(catalogSrc).toMatch(
      /id:\s*["']personal["'][\s\S]{0,80}cycles:\s*\[\s*["']monthly["']\s*,\s*["']annual["']\s*\]/,
    );
  });

  it("PLAN_CATALOG includes all 4 B2B plans + personal + 2 legacy aliases", () => {
    for (const id of ["starter", "growth", "business", "enterprise", "personal", "basic", "elite"]) {
      expect(catalogSrc, `plan-catalog missing id: ${id}`).toMatch(
        new RegExp(`id:\\s*["']${id}["']`),
      );
    }
  });

  it("priceEnvKey produces the STRIPE_PRICE_<PLAN>_<CYCLE> shape", () => {
    expect(catalogSrc).toMatch(/STRIPE_PRICE_\$\{[^}]+toUpperCase\(\)\}_\$\{[^}]+toUpperCase\(\)\}/);
  });

  it("lookupPlanByPriceEnv accepts an envGetter callback (testable)", () => {
    expect(catalogSrc).toMatch(/envGetter:\s*\(k:\s*string\)\s*=>\s*string\s*\|\s*undefined/);
  });
});

describe("R-22: stripe-checkout uses the shared catalog (no hardcoded array)", () => {
  it("imports from _shared/plan-catalog.ts", () => {
    expect(checkoutSrc).toMatch(/from\s+["']\.\.\/_shared\/plan-catalog\.ts["']/);
  });

  it("imports VALID_PLAN_IDS, VALID_CYCLES, priceEnvKey", () => {
    expect(checkoutSrc).toMatch(/VALID_PLAN_IDS/);
    expect(checkoutSrc).toMatch(/VALID_CYCLES/);
    expect(checkoutSrc).toMatch(/priceEnvKey/);
  });

  it("validation uses VALID_PLAN_IDS, not a hardcoded array", () => {
    expect(checkoutSrc).toMatch(/VALID_PLAN_IDS\.includes\(planId\)/);
    // Hardcoded array must be GONE
    expect(checkoutSrc).not.toMatch(/validPlans:\s*PlanId\[\]\s*=\s*\[/);
  });
});

describe("R-22: stripe-webhook uses the shared catalog (no hardcoded array)", () => {
  it("imports lookupPlanByPriceEnv from _shared/plan-catalog.ts", () => {
    expect(webhookSrc).toMatch(
      /import\s*\{\s*lookupPlanByPriceEnv\s+as\s+sharedLookupPlan\s*\}\s*from\s+["']\.\.\/_shared\/plan-catalog\.ts["']/,
    );
  });

  it("local lookupPlanByPriceEnv delegates to the shared helper", () => {
    expect(webhookSrc).toMatch(
      /function lookupPlanByPriceEnv[\s\S]{0,200}return sharedLookupPlan\(priceId,/,
    );
  });

  it("does NOT contain the old hardcoded plans array", () => {
    expect(webhookSrc).not.toMatch(
      /const plans\s*=\s*\[\s*["']starter["']\s*,\s*["']growth["']/,
    );
  });
});
