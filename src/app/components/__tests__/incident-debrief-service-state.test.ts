// ═══════════════════════════════════════════════════════════════
// SOSphere — incident-debrief-service contract (27th pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-06 final-audit: the 27th pattern app shipped with the
// RPC inline in post-emergency-debrief.tsx (no service module, no
// tests). This file locks the pure helpers exposed by the extracted
// service so a future refactor cannot silently change normalisation
// or stamp behaviour.
//
//   1. normalizeNote: trims whitespace
//   2. normalizeNote: empty / whitespace-only → undefined
//   3. normalizeNote: real content preserved
//   4. buildDebriefRow: stamps submittedAt at build time
//   5. buildDebriefRow: empty note → omitted from row
//   6. buildDebriefRow: feltSafe passed through unchanged
//   7. buildDebriefRow: deterministic submittedAt with fixed nowMs
//   8. normalizeFeltSafe: safe / unsure / need_help pass through
//   9. normalizeFeltSafe: unknown value → "unsure" (fail-safe default)
//  10. normalizeFeltSafe: null / undefined / object → "unsure"
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  normalizeNote, buildDebriefRow, normalizeFeltSafe,
} from "../incident-debrief-service";

describe("incident-debrief-service — 27th pattern app contract", () => {
  it("1. normalizeNote: trims whitespace", () => {
    expect(normalizeNote("  hello  ")).toBe("hello");
  });

  it("2. normalizeNote: empty / whitespace-only → undefined", () => {
    expect(normalizeNote("")).toBeUndefined();
    expect(normalizeNote("   ")).toBeUndefined();
    expect(normalizeNote("\n\t")).toBeUndefined();
  });

  it("3. normalizeNote: real content preserved", () => {
    expect(normalizeNote("I felt OK, just unsure")).toBe("I felt OK, just unsure");
  });

  it("4. buildDebriefRow: stamps submittedAt at build time", () => {
    const row = buildDebriefRow({ feltSafe: "safe", note: "ok" });
    expect(typeof row.submittedAt).toBe("string");
    // ISO 8601: YYYY-MM-DDTHH:MM:SS.sssZ
    expect(row.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("5. buildDebriefRow: empty note → omitted from row", () => {
    const row = buildDebriefRow({ feltSafe: "safe", note: "" });
    expect(row.note).toBeUndefined();
  });

  it("6. buildDebriefRow: feltSafe passed through unchanged", () => {
    expect(buildDebriefRow({ feltSafe: "safe",       note: "" }).feltSafe).toBe("safe");
    expect(buildDebriefRow({ feltSafe: "unsure",    note: "" }).feltSafe).toBe("unsure");
    expect(buildDebriefRow({ feltSafe: "need_help", note: "" }).feltSafe).toBe("need_help");
  });

  it("7. buildDebriefRow: deterministic submittedAt with fixed nowMs", () => {
    const fixed = 1733600000000; // 2024-12-07T19:33:20Z-ish
    const a = buildDebriefRow({ feltSafe: "safe", note: "x" }, fixed);
    const b = buildDebriefRow({ feltSafe: "safe", note: "x" }, fixed);
    expect(a.submittedAt).toBe(b.submittedAt);
    expect(a.submittedAt).toBe(new Date(fixed).toISOString());
  });

  it("8. normalizeFeltSafe: safe / unsure / need_help pass through", () => {
    expect(normalizeFeltSafe("safe")).toBe("safe");
    expect(normalizeFeltSafe("unsure")).toBe("unsure");
    expect(normalizeFeltSafe("need_help")).toBe("need_help");
  });

  it("9. normalizeFeltSafe: unknown value → \"unsure\" (fail-safe)", () => {
    expect(normalizeFeltSafe("happy")).toBe("unsure");
    expect(normalizeFeltSafe("SAFE")).toBe("unsure"); // case-sensitive
    expect(normalizeFeltSafe("")).toBe("unsure");
  });

  it("10. normalizeFeltSafe: null / undefined / object → \"unsure\"", () => {
    expect(normalizeFeltSafe(null)).toBe("unsure");
    expect(normalizeFeltSafe(undefined)).toBe("unsure");
    expect(normalizeFeltSafe({ value: "safe" })).toBe("unsure");
    expect(normalizeFeltSafe(42)).toBe("unsure");
  });
});
