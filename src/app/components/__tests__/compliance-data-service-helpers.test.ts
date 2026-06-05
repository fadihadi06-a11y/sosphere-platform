// ═══════════════════════════════════════════════════════════════
// SOSphere — compliance-data-service helpers contract
// ─────────────────────────────────────────────────────────────
// 2026-06-05 roots-of-roots Tier 4: pct, durationLabel, and
// rankLevel were promoted from private helpers to public exports
// so the rest of the codebase can reuse them. Lock the contract
// here so future refactors can't silently change rounding,
// padding, or severity ordering — the compliance PDF depends on
// the exact formatting and the risk-register UI depends on the
// ordinal ordering.
//
//   1. pct(0, 0)                  → "0%" (avoid div-by-zero)
//   2. pct(0, 100)                → "0%"
//   3. pct(50, 100)               → "50%"
//   4. pct(1, 3)                  → "33%" (rounded)
//   5. pct(2, 3)                  → "67%" (rounded)
//   6. durationLabel(null, x)     → "—" (no start)
//   7. durationLabel(x, null)     → "—" (no end, in-progress)
//   8. durationLabel(x, bad)      → "—" (invalid end)
//   9. durationLabel zero diff    → "0m 00s"
//  10. durationLabel <60s         → "0m SSs" with zero-pad
//  11. durationLabel >60s         → "Nm SSs"
//  12. durationLabel negative     → "0m 00s" (clamps at 0)
//  13. rankLevel "Extreme"        → 5 (case-insensitive)
//  14. rankLevel "negligible"     → 1
//  15. rankLevel unknown          → 0 (sorts last)
//  16. rankLevel sort: critical>high>medium>low>negligible
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { pct, durationLabel, rankLevel } from "../compliance-data-service";

describe("compliance-data-service helpers — Tier 4 contract", () => {
  // ── pct ─────────────────────────────────────────────────────
  it("1. pct(0, 0) → 0% (avoid div-by-zero)", () => {
    expect(pct(0, 0)).toBe("0%");
  });
  it("2. pct(0, 100) → 0%", () => {
    expect(pct(0, 100)).toBe("0%");
  });
  it("3. pct(50, 100) → 50%", () => {
    expect(pct(50, 100)).toBe("50%");
  });
  it("4. pct(1, 3) → 33% (rounded)", () => {
    expect(pct(1, 3)).toBe("33%");
  });
  it("5. pct(2, 3) → 67% (rounded)", () => {
    expect(pct(2, 3)).toBe("67%");
  });

  // ── durationLabel ───────────────────────────────────────────
  it("6. durationLabel(null, x) → — (no start)", () => {
    expect(durationLabel(null, "2026-06-05T10:00:00Z")).toBe("—");
  });
  it("7. durationLabel(x, null) → — (no end, in-progress)", () => {
    expect(durationLabel("2026-06-05T10:00:00Z", null)).toBe("—");
  });
  it("8. durationLabel(x, bad) → — (invalid end)", () => {
    expect(durationLabel("2026-06-05T10:00:00Z", "not-a-date")).toBe("—");
  });
  it("9. durationLabel zero diff → 0m 00s", () => {
    expect(durationLabel("2026-06-05T10:00:00Z", "2026-06-05T10:00:00Z")).toBe("0m 00s");
  });
  it("10. durationLabel <60s → 0m SSs with zero-pad", () => {
    expect(durationLabel("2026-06-05T10:00:00Z", "2026-06-05T10:00:05Z")).toBe("0m 05s");
    expect(durationLabel("2026-06-05T10:00:00Z", "2026-06-05T10:00:42Z")).toBe("0m 42s");
  });
  it("11. durationLabel >60s → Nm SSs", () => {
    expect(durationLabel("2026-06-05T10:00:00Z", "2026-06-05T10:02:05Z")).toBe("2m 05s");
    expect(durationLabel("2026-06-05T10:00:00Z", "2026-06-05T11:00:00Z")).toBe("60m 00s");
  });
  it("12. durationLabel negative → 0m 00s (clamps at 0)", () => {
    expect(durationLabel("2026-06-05T10:00:00Z", "2026-06-05T09:59:00Z")).toBe("0m 00s");
  });

  // ── rankLevel ────────────────────────────────────────────────
  it("13. rankLevel \"Extreme\" → 5 (case-insensitive)", () => {
    expect(rankLevel("Extreme")).toBe(5);
    expect(rankLevel("EXTREME")).toBe(5);
    expect(rankLevel("extreme")).toBe(5);
  });
  it("14. rankLevel \"negligible\" → 1", () => {
    expect(rankLevel("negligible")).toBe(1);
  });
  it("15. rankLevel unknown → 0 (sorts last)", () => {
    expect(rankLevel("")).toBe(0);
    expect(rankLevel("mild")).toBe(0);
    expect(rankLevel("severe")).toBe(0);
  });
  it("16. rankLevel sort: extreme>high>medium>low>negligible", () => {
    const sorted = ["low","extreme","medium","negligible","high"]
      .sort((a, b) => rankLevel(b) - rankLevel(a));
    expect(sorted).toEqual(["extreme","high","medium","low","negligible"]);
  });
});
