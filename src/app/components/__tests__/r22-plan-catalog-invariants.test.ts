// R-22 + R-29: shared plan catalog invariants.
// Locks the contract — if a future commit silently drops a plan, this fails.

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

  it("PLAN_CATALOG includes 'basic' with monthly + annual cycles", () => {
    // R-29: Basic is the primary entry-level B2C tier at $7/mo.
    expect(catalogSrc).toMatch(
      /id:\s*["']basic["'][\s\S]{0,80}cycles:\s*\[\s*["']monthly["']\s*,\s*["']annual["']\s*\]/,
    );
  });

  it("PLAN_CATALOG includes 'elite' with monthly + annual cycles", () => {
    // R-29: Elite is the premium B2C tier at $14/mo.
    expect(catalogSrc).toMatch(
      /id:\s*["']elite["'][\s\S]{0,80}cycles:\s*\[\s*["']monthly["']\s*,\s*["']annual["']\s*\]/,
    );
  });

  it("PLAN_CATALOG includes all 4 B2B plans + basic + elite (+ deprecated personal alias)", () => {
    // R-29: civilian go-to-market is Free + Basic + Elite. 'personal' is
    // kept ONLY as a deprecated permissive alias for any stray webhook
    // event that pre-dates this commit.
    for (const id of ["starter", "growth", "business", "enterprise", "basic", "elite"]) {
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
