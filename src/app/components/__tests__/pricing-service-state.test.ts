// ═══════════════════════════════════════════════════════════════
// SOSphere — pricing-service contract (20th pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-04 fresh-audit #4: lock pure helpers + cache so the
// pricing-page tier-recommendation + plan-filter logic cannot
// silently drift from constants/pricing.ts.
//
//  1. cache: empty by default
//  2. cache: set → get returns slice
//  3. filterByKind: unified returns only unified plans
//  4. filterByKind: addon kind filters correctly
//  5. findPlanById: returns matching row
//  6. findPlanById: missing id → undefined (no exception)
//  7. recommendUnifiedTier: <=25 → starter
//  8. recommendUnifiedTier: 26-100 → growth
//  9. recommendUnifiedTier: 101-500 → business
// 10. recommendUnifiedTier: >500 → enterprise
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import {
  setCachedPlans, getCachedPlans,
  filterByKind, findPlanById, recommendUnifiedTier,
  type PlanRow,
} from "../pricing-service";

const plan = (over: Partial<PlanRow> = {}): PlanRow => ({
  id: "p1", kind: "unified", name: "Starter", name_ar: null, description: null,
  color: null, monthly_price: 99, annual_price: 990, annual_monthly: 82,
  employee_min: 1, employee_max: 25, features: [], cta_label: null,
  is_active: true, sort_order: 1, ...over,
} as any);

describe("pricing-service — fresh-audit #4 contract", () => {
  beforeEach(() => { setCachedPlans([]); });

  it("1. cache: empty by default", () => {
    expect(getCachedPlans()).toEqual([]);
  });

  it("2. cache: set → get returns slice", () => {
    const rows = [plan({ id: "p1" })];
    setCachedPlans(rows);
    const got = getCachedPlans();
    expect(got).toEqual(rows);
    expect(got).not.toBe(rows);
  });

  it("3. filterByKind: unified returns only unified plans", () => {
    const out = filterByKind([
      plan({ id: "u1", kind: "unified" }),
      plan({ id: "a1", kind: "addon" }),
      plan({ id: "u2", kind: "unified" }),
    ], "unified");
    expect(out).toHaveLength(2);
    expect(out.every(r => r.kind === "unified")).toBe(true);
  });

  it("4. filterByKind: addon kind filters correctly", () => {
    const out = filterByKind([
      plan({ id: "u1", kind: "unified" }),
      plan({ id: "a1", kind: "addon" }),
    ], "addon");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a1");
  });

  it("5. findPlanById: returns matching row", () => {
    const r = findPlanById([plan({ id: "p1" }), plan({ id: "p2" })], "p2");
    expect(r?.id).toBe("p2");
  });

  it("6. findPlanById: missing id → undefined (no exception)", () => {
    expect(findPlanById([plan({ id: "p1" })], "missing")).toBeUndefined();
  });

  it("7. recommendUnifiedTier: <=25 → starter", () => {
    expect(recommendUnifiedTier(1)).toBe("starter");
    expect(recommendUnifiedTier(25)).toBe("starter");
  });

  it("8. recommendUnifiedTier: 26-100 → growth", () => {
    expect(recommendUnifiedTier(26)).toBe("growth");
    expect(recommendUnifiedTier(100)).toBe("growth");
  });

  it("9. recommendUnifiedTier: 101-500 → business", () => {
    expect(recommendUnifiedTier(101)).toBe("business");
    expect(recommendUnifiedTier(500)).toBe("business");
  });

  it("10. recommendUnifiedTier: >500 → enterprise", () => {
    expect(recommendUnifiedTier(501)).toBe("enterprise");
    expect(recommendUnifiedTier(10000)).toBe("enterprise");
  });
});
