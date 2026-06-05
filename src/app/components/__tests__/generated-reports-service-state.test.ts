// ═══════════════════════════════════════════════════════════════
// SOSphere — generated-reports-service contract (22nd pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-04 fresh-audit #4: lock cache trio + formatBytes so the
// compliance report-history view never miscomputes file sizes.
//
//  1. cache: empty by default
//  2. cache: set → get returns slice
//  3. clear wipes both in-memory + localStorage
//  4. formatBytes(0) → dash
//  5. formatBytes(null) → dash (defensive)
//  6. formatBytes(undefined) → dash
//  7. formatBytes(512) → "1 KB" (rounded, floor 1)
//  8. formatBytes(2048) → "2 KB"
//  9. formatBytes(1_048_576) → "1.0 MB"
// 10. formatBytes(10_485_760) → "10.0 MB"
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
  return await import("../generated-reports-service");
}

const row = (over: any = {}): any => ({
  id: "r1", title: "Q4 Report", type: "quarterly", period: "Q4 2026",
  sections: ["intro","data"], page_count: 12, size_bytes: 1024 * 512,
  filename: "q4.pdf", verification_id: null, format: "detailed",
  was_encrypted: false, auto_scheduled: false, generated_at: "2026-06-04T10:00:00Z",
  ...over,
});

describe("generated-reports-service — fresh-audit #4 contract", () => {
  beforeEach(() => { for (const k of Object.keys(lsStore)) delete lsStore[k]; });

  it("1. cache: empty by default", async () => {
    const { getCachedGeneratedReports } = await loadFresh();
    expect(getCachedGeneratedReports()).toEqual([]);
  });

  it("2. cache: set → get returns slice", async () => {
    const { setCachedGeneratedReports, getCachedGeneratedReports } = await loadFresh();
    setCachedGeneratedReports([row()]);
    const got = getCachedGeneratedReports();
    expect(got).toHaveLength(1);
  });

  it("3. clear wipes both in-memory + localStorage", async () => {
    const { setCachedGeneratedReports, getCachedGeneratedReports, clearGeneratedReportsCache } = await loadFresh();
    setCachedGeneratedReports([row()]);
    clearGeneratedReportsCache();
    expect(getCachedGeneratedReports()).toEqual([]);
  });

  it("4. formatBytes(0) → dash", async () => {
    const { formatBytes } = await loadFresh();
    expect(formatBytes(0)).toBe("—");
  });

  it("5. formatBytes(null) → dash (defensive)", async () => {
    const { formatBytes } = await loadFresh();
    expect(formatBytes(null)).toBe("—");
  });

  it("6. formatBytes(undefined) → dash", async () => {
    const { formatBytes } = await loadFresh();
    expect(formatBytes(undefined)).toBe("—");
  });

  it("7. formatBytes(512) → at least 1 KB (floor 1)", async () => {
    const { formatBytes } = await loadFresh();
    expect(formatBytes(512)).toBe("1 KB");
  });

  it("8. formatBytes(2048) → 2 KB", async () => {
    const { formatBytes } = await loadFresh();
    expect(formatBytes(2048)).toBe("2 KB");
  });

  it("9. formatBytes(1_048_576) → 1.0 MB", async () => {
    const { formatBytes } = await loadFresh();
    expect(formatBytes(1_048_576)).toBe("1.0 MB");
  });

  it("10. formatBytes(10_485_760) → 10.0 MB", async () => {
    const { formatBytes } = await loadFresh();
    expect(formatBytes(10_485_760)).toBe("10.0 MB");
  });
});
