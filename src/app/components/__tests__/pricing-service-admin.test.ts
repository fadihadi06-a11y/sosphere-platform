// ═══════════════════════════════════════════════════════════════
// pricing-service admin helpers — 28th pattern app contract tests
// ─────────────────────────────────────────────────────────────
// 2026-06-08 — Covers the pure surface of the upsert/delete flow:
// normalizePlanInput (trim + clamp) and validatePlanInput (id format,
// kind enum, name presence). The RPC wrappers themselves are
// fire-and-forget over the network and not in scope for unit tests;
// the server-side RAISE EXCEPTIONs cover the same invariants from
// the DB side.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  normalizePlanInput,
  validatePlanInput,
  type PlanInput,
} from "../pricing-service";

const BASE: PlanInput = {
  id:   "starter",
  kind: "unified",
  name: "Starter",
};

describe("pricing-service: normalizePlanInput", () => {
  it("trims whitespace on id, name, name_ar, description, color", () => {
    const out = normalizePlanInput({
      ...BASE,
      id:          "  starter ",
      name:        "  Starter Plan  ",
      name_ar:     "  مبتدئ  ",
      description: "  Best for small teams  ",
      color:       "  #FF0000  ",
    });
    expect(out.id).toBe("starter");
    expect(out.name).toBe("Starter Plan");
    expect(out.name_ar).toBe("مبتدئ");
    expect(out.description).toBe("Best for small teams");
    expect(out.color).toBe("#FF0000");
  });

  it("converts whitespace-only optional strings to null", () => {
    const out = normalizePlanInput({
      ...BASE,
      name_ar:     "   ",
      description: "",
      color:       "   ",
    });
    expect(out.name_ar).toBeNull();
    expect(out.description).toBeNull();
    expect(out.color).toBeNull();
  });

  it("clamps negative numeric fields to 0", () => {
    const out = normalizePlanInput({
      ...BASE,
      monthly_price:        -50,
      annual_price:         -600,
      annual_monthly:       -50,
      max_employees:        -25,
      max_zones:            -3,
      extra_employee_price: -1.5,
    });
    expect(out.monthly_price).toBe(0);
    expect(out.annual_price).toBe(0);
    expect(out.annual_monthly).toBe(0);
    expect(out.max_employees).toBe(0);
    expect(out.max_zones).toBe(0);
    expect(out.extra_employee_price).toBe(0);
  });

  it("preserves positive numeric values unchanged", () => {
    const out = normalizePlanInput({
      ...BASE,
      monthly_price:        49,
      annual_price:         499,
      annual_monthly:       41.58,
      max_employees:        25,
      max_zones:            5,
      extra_employee_price: 2,
    });
    expect(out.monthly_price).toBe(49);
    expect(out.annual_price).toBe(499);
    expect(out.annual_monthly).toBe(41.58);
    expect(out.max_employees).toBe(25);
    expect(out.max_zones).toBe(5);
    expect(out.extra_employee_price).toBe(2);
  });

  it("filters blank features and trims survivors", () => {
    const out = normalizePlanInput({
      ...BASE,
      features: ["  GPS tracking  ", "", "  ", "SOS button"],
    });
    expect(out.features).toEqual(["GPS tracking", "SOS button"]);
  });

  it("returns empty features array when features omitted", () => {
    const out = normalizePlanInput({ ...BASE });
    expect(out.features).toEqual([]);
  });

  it("defaults sort_order to 100 when missing or non-finite", () => {
    expect(normalizePlanInput({ ...BASE }).sort_order).toBe(100);
    expect(normalizePlanInput({ ...BASE, sort_order: NaN }).sort_order).toBe(100);
    expect(normalizePlanInput({ ...BASE, sort_order: 5 }).sort_order).toBe(5);
  });

  it("defaults active to true when missing", () => {
    expect(normalizePlanInput({ ...BASE }).active).toBe(true);
    expect(normalizePlanInput({ ...BASE, active: false }).active).toBe(false);
  });

  it("defaults popular to false when missing", () => {
    expect(normalizePlanInput({ ...BASE }).popular).toBe(false);
    expect(normalizePlanInput({ ...BASE, popular: true }).popular).toBe(true);
  });

  it("treats null numeric inputs as null (no implicit zero)", () => {
    const out = normalizePlanInput({
      ...BASE,
      monthly_price: null,
      annual_price:  null,
    });
    expect(out.monthly_price).toBeNull();
    expect(out.annual_price).toBeNull();
  });
});

describe("pricing-service: validatePlanInput", () => {
  it("returns null for a valid plan input", () => {
    expect(validatePlanInput({ ...BASE })).toBeNull();
  });

  it("rejects empty or single-char id", () => {
    expect(validatePlanInput({ ...BASE, id: "" })).toMatch(/id must be at least/);
    expect(validatePlanInput({ ...BASE, id: "a" })).toMatch(/id must be at least/);
  });

  it("rejects ids with uppercase, spaces, or symbols", () => {
    expect(validatePlanInput({ ...BASE, id: "Starter" })).toMatch(/lowercase/);
    expect(validatePlanInput({ ...BASE, id: "starter plan" })).toMatch(/lowercase/);
    expect(validatePlanInput({ ...BASE, id: "starter!" })).toMatch(/lowercase/);
  });

  it("accepts ids with dashes and underscores", () => {
    expect(validatePlanInput({ ...BASE, id: "starter_plan" })).toBeNull();
    expect(validatePlanInput({ ...BASE, id: "starter-plan" })).toBeNull();
    expect(validatePlanInput({ ...BASE, id: "tier_2_pro" })).toBeNull();
  });

  it("rejects unknown kind", () => {
    // @ts-expect-error testing runtime validation against an invalid string
    expect(validatePlanInput({ ...BASE, kind: "premium" })).toMatch(/kind must be/);
  });

  it("accepts all three valid kinds", () => {
    expect(validatePlanInput({ ...BASE, kind: "unified" })).toBeNull();
    expect(validatePlanInput({ ...BASE, kind: "individual" })).toBeNull();
    expect(validatePlanInput({ ...BASE, kind: "addon" })).toBeNull();
  });

  it("rejects missing name", () => {
    expect(validatePlanInput({ ...BASE, name: "" })).toMatch(/name required/);
    expect(validatePlanInput({ ...BASE, name: "a" })).toMatch(/name required/);
  });
});
