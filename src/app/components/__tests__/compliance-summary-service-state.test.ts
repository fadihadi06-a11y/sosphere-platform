// ═══════════════════════════════════════════════════════════════
// SOSphere — compliance-summary-service contract
// ─────────────────────────────────────────────────────────────
// 2026-06-02 (8th application of the world-class pattern). Tests
// lock the pure helpers + in-memory state so a future refactor
// cannot silently misclassify compliance health or break the cache:
//
//   1. classifyComplianceHealth null → "unknown"
//   2. classifyComplianceHealth open investigation → "red"
//   3. classifyComplianceHealth expired training → "red"
//   4. classifyComplianceHealth >5 missed checkins → "red"
//   5. classifyComplianceHealth high-risk register → "amber"
//   6. classifyComplianceHealth training expiring soon → "amber"
//   7. classifyComplianceHealth clean → "green"
//   8. formatPercent handles divide-by-zero
//   9. dailyCheckinAverage rounds to 1 decimal
//  10. setCachedSummary + getCachedSummary + clearComplianceSummaryCache contract
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

const lsStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem:    (k: string) => lsStore[k] ?? null,
  setItem:    (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
  clear:      () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
});

async function loadFresh() {
  vi.resetModules();
  return await import("../compliance-summary-service");
}

const baseSummary = () => ({
  company_id:    "c1",
  since:         new Date().toISOString(),
  generated_at:  new Date().toISOString(),
  employees:     { total: 10, on_shift: 5, off_shift: 5 },
  sos:           { total_30d: 2, resolved_30d: 2, last_7d: 0 },
  risk:          { total: 3, high_count: 0, medium_count: 1, low_count: 2 },
  investigations:{ total: 0, open_count: 0, closed_count: 0, with_report: 0 },
  training:      { total: 5, valid_count: 5, expired_count: 0, expiring_soon: 0 },
  checkins:      { total_30d: 60, checkins_30d: 60, missed_30d: 0, warnings_30d: 0 },
});

describe("compliance-summary-service — 8th pattern contract", () => {
  beforeEach(() => {
    for (const k of Object.keys(lsStore)) delete lsStore[k];
  });

  it("1. classifyComplianceHealth null → unknown", async () => {
    const { classifyComplianceHealth } = await loadFresh();
    expect(classifyComplianceHealth(null)).toBe("unknown");
  });

  it("2. classifyComplianceHealth open investigation → red", async () => {
    const { classifyComplianceHealth } = await loadFresh();
    const s = baseSummary();
    s.investigations.open_count = 1;
    expect(classifyComplianceHealth(s)).toBe("red");
  });

  it("3. classifyComplianceHealth expired training → red", async () => {
    const { classifyComplianceHealth } = await loadFresh();
    const s = baseSummary();
    s.training.expired_count = 1;
    expect(classifyComplianceHealth(s)).toBe("red");
  });

  it("4. classifyComplianceHealth >5 missed checkins → red", async () => {
    const { classifyComplianceHealth } = await loadFresh();
    const s = baseSummary();
    s.checkins.missed_30d = 6;
    expect(classifyComplianceHealth(s)).toBe("red");
    s.checkins.missed_30d = 5;  // exactly 5 is NOT red
    expect(classifyComplianceHealth(s)).toBe("green");
  });

  it("5. classifyComplianceHealth high-risk → amber", async () => {
    const { classifyComplianceHealth } = await loadFresh();
    const s = baseSummary();
    s.risk.high_count = 2;
    expect(classifyComplianceHealth(s)).toBe("amber");
  });

  it("6. classifyComplianceHealth training expiring soon → amber", async () => {
    const { classifyComplianceHealth } = await loadFresh();
    const s = baseSummary();
    s.training.expiring_soon = 3;
    expect(classifyComplianceHealth(s)).toBe("amber");
  });

  it("7. classifyComplianceHealth clean → green", async () => {
    const { classifyComplianceHealth } = await loadFresh();
    expect(classifyComplianceHealth(baseSummary())).toBe("green");
  });

  it("8. formatPercent handles divide-by-zero", async () => {
    const { formatPercent } = await loadFresh();
    expect(formatPercent(5, 10)).toBe("50%");
    expect(formatPercent(0, 0)).toBe("0%");
    expect(formatPercent(3, 0)).toBe("0%");
    expect(formatPercent(1, 3)).toBe("33%");
  });

  it("9. dailyCheckinAverage rounds to 1 decimal", async () => {
    const { dailyCheckinAverage } = await loadFresh();
    expect(dailyCheckinAverage({ total_30d: 0, checkins_30d: 60, missed_30d: 0, warnings_30d: 0 }, 30)).toBe(2);
    expect(dailyCheckinAverage({ total_30d: 0, checkins_30d: 100, missed_30d: 0, warnings_30d: 0 }, 30)).toBe(3.3);
    expect(dailyCheckinAverage(null, 30)).toBe(0);
  });

  it("10. setCachedSummary + get + clear contract", async () => {
    const svc = await loadFresh();
    expect(svc.getCachedSummary()).toBeNull();
    const s = baseSummary();
    svc.setCachedSummary(s);
    expect(svc.getCachedSummary()?.company_id).toBe("c1");
    expect(lsStore["sosphere_compliance_summary"]).toBeTruthy();
    svc.clearComplianceSummaryCache();
    expect(svc.getCachedSummary()).toBeNull();
    expect(lsStore["sosphere_compliance_summary"]).toBeUndefined();
  });
});
