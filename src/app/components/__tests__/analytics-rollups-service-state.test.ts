// ═══════════════════════════════════════════════════════════════
// SOSphere — analytics-rollups-service contract (23rd pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-04 fresh-audit #4: lock the pure helpers + in-memory
// cache trio so a future refactor cannot silently break the
// compliance PDF's admin-performance + safety-score-history blocks.
//
//  1. cache trio AdminPerformance: get-empty → set → get returns slice
//  2. cache trio AdminPerformance: get returns COPY, not same ref
//  3. cache trio SafetyScoreHistory: set → get returns slice
//  4. clearAnalyticsRollupsCache wipes BOTH caches
//  5. formatResponseTime(0) → dash placeholder
//  6. formatResponseTime(45) → "45s"
//  7. formatResponseTime(125) → "2m 5s"
//  8. formatResponseTime(60) → "1m 0s"
//  9. scoreTier(95) → PLATINUM
// 10. scoreTier(85) → GOLD
// 11. scoreTier(75) → SILVER
// 12. scoreTier(50) → BRONZE
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import {
  setCachedAdminPerformance, getCachedAdminPerformance,
  setCachedSafetyScoreHistory, getCachedSafetyScoreHistory,
  clearAnalyticsRollupsCache,
  formatResponseTime, scoreTier,
  type AdminPerformanceRow, type SafetyScoreMonthRow,
} from "../analytics-rollups-service";

const adminRow = (id: string): AdminPerformanceRow => ({
  user_id: id, display_name: `Admin ${id}`, role: "company_admin",
  incidents_handled: 5, avg_response_sec: 45, current_streak: 3,
});
const safetyRow = (label: string): SafetyScoreMonthRow => ({
  month_label: label, sos_count: 10, resolved_count: 9, safety_score: 90,
});

describe("analytics-rollups-service — fresh-audit #4 contract", () => {
  beforeEach(() => { clearAnalyticsRollupsCache(); });

  it("1. AdminPerformance cache: empty by default → set → get", () => {
    expect(getCachedAdminPerformance()).toEqual([]);
    setCachedAdminPerformance([adminRow("u1")]);
    expect(getCachedAdminPerformance()).toHaveLength(1);
  });

  it("2. AdminPerformance cache returns COPY (mutations don't leak)", () => {
    setCachedAdminPerformance([adminRow("u1")]);
    const a = getCachedAdminPerformance();
    const b = getCachedAdminPerformance();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("3. SafetyScoreHistory cache: set → get returns slice", () => {
    setCachedSafetyScoreHistory([safetyRow("Jan"), safetyRow("Feb")]);
    expect(getCachedSafetyScoreHistory()).toHaveLength(2);
  });

  it("4. clearAnalyticsRollupsCache wipes BOTH caches (logout safety)", () => {
    setCachedAdminPerformance([adminRow("u1")]);
    setCachedSafetyScoreHistory([safetyRow("Jan")]);
    clearAnalyticsRollupsCache();
    expect(getCachedAdminPerformance()).toEqual([]);
    expect(getCachedSafetyScoreHistory()).toEqual([]);
  });

  it("5. formatResponseTime(0) → dash placeholder", () => {
    expect(formatResponseTime(0)).toBe("—");
  });
  it("6. formatResponseTime(45) → \"45s\"", () => {
    expect(formatResponseTime(45)).toBe("45s");
  });
  it("7. formatResponseTime(125) → \"2m 5s\"", () => {
    expect(formatResponseTime(125)).toBe("2m 5s");
  });
  it("8. formatResponseTime(60) → \"1m 0s\"", () => {
    expect(formatResponseTime(60)).toBe("1m 0s");
  });

  it("9. scoreTier(95) → PLATINUM", () => {
    expect(scoreTier(95)).toBe("PLATINUM");
  });
  it("10. scoreTier(85) → GOLD", () => {
    expect(scoreTier(85)).toBe("GOLD");
  });
  it("11. scoreTier(75) → SILVER", () => {
    expect(scoreTier(75)).toBe("SILVER");
  });
  it("12. scoreTier(50) → BRONZE", () => {
    expect(scoreTier(50)).toBe("BRONZE");
  });
});
