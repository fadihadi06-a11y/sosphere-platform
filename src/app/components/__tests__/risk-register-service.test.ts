// ═══════════════════════════════════════════════════════════════
// SOSphere — Training Status Computation Tests (P3-#13)
// ─────────────────────────────────────────────────────────────
// `computeTrainingStatus` is the derivation from expiry_date that
// powers the Certifications panel and the compliance PDF's training
// block. Storing the derived `status` in Supabase would let it go
// stale as clocks tick — instead we compute it client-side and test
// the boundary days carefully here.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { computeTrainingStatus } from "../risk-register-service";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

describe("computeTrainingStatus", () => {
  it("is 'valid' for a certification expiring far in the future", () => {
    const expiry = new Date(Date.now() + 180 * MS_PER_DAY);
    expect(computeTrainingStatus(expiry)).toBe("valid");
  });

  it("is 'expiring_soon' when expiry is within 30 days", () => {
    const expiry = new Date(Date.now() + 10 * MS_PER_DAY);
    expect(computeTrainingStatus(expiry)).toBe("expiring_soon");
  });

  it("is 'expiring_soon' at exactly 30 days (inclusive upper bound)", () => {
    // 30 days out is still within the warning window — the rule is "<= 30"
    const expiry = new Date(Date.now() + 30 * MS_PER_DAY);
    expect(computeTrainingStatus(expiry)).toBe("expiring_soon");
  });

  it("is 'valid' at 31 days (just outside the window)", () => {
    // Small epsilon so floor-rounding doesn't drop us back to 30.
    const expiry = new Date(Date.now() + 31 * MS_PER_DAY + 1000);
    expect(computeTrainingStatus(expiry)).toBe("valid");
  });

  it("is 'expired' for any past date", () => {
    const expiry = new Date(Date.now() - 1 * MS_PER_DAY);
    expect(computeTrainingStatus(expiry)).toBe("expired");
  });

  it("is 'expired' even for a cert that expired an hour ago", () => {
    // Make sure the boundary at exactly now() doesn't misclassify.
    const expiry = new Date(Date.now() - 60 * 60 * 1000);
    expect(computeTrainingStatus(expiry)).toBe("expired");
  });
});
