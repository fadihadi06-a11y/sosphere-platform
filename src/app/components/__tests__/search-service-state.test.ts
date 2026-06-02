// ═══════════════════════════════════════════════════════════════
// SOSphere — search-service contract
// ─────────────────────────────────────────────────────────────
// 2026-06-02 (9th application of the world-class pattern). Tests
// lock the pure helpers so a future refactor cannot silently
// regress search ranking, grouping, or debouncing:
//
//   1. isQueryTooShort: empty/whitespace → true
//   2. isQueryTooShort: 1 char → true (matches server-side rule)
//   3. isQueryTooShort: 2+ chars → false
//   4. isQueryTooShort: non-string → true (fail-safe)
//   5. groupByType buckets each type correctly
//   6. groupByType returns empty arrays for absent types
//   7. mergeAndSort orders by score desc then title asc
//   8. mergeAndSort is stable across equal scores
//   9. makeDebouncer fires once after wait
//  10. makeDebouncer.cancel prevents the pending fire
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isQueryTooShort,
  groupByType,
  mergeAndSort,
  makeDebouncer,
  MIN_QUERY_LENGTH,
  type SearchResult,
} from "../search-service";

const R = (over: Partial<SearchResult> = {}): SearchResult => ({
  type: "employee", id: "x", title: "Test", subtitle: "", snippet: "", score: 50,
  ...over,
});

describe("search-service — 9th pattern contract", () => {
  it("1. isQueryTooShort: empty/whitespace → true", () => {
    expect(isQueryTooShort("")).toBe(true);
    expect(isQueryTooShort("   ")).toBe(true);
    expect(isQueryTooShort("\t\n")).toBe(true);
  });

  it("2. isQueryTooShort: 1 char → true (matches server-side rule)", () => {
    expect(isQueryTooShort("a")).toBe(true);
    expect(isQueryTooShort(" b ")).toBe(true); // trimmed length 1
  });

  it("3. isQueryTooShort: 2+ chars → false", () => {
    expect(isQueryTooShort("ab")).toBe(false);
    expect(isQueryTooShort("hello world")).toBe(false);
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  it("4. isQueryTooShort: non-string → true (fail-safe)", () => {
    // @ts-expect-error - testing runtime safety
    expect(isQueryTooShort(null)).toBe(true);
    // @ts-expect-error
    expect(isQueryTooShort(undefined)).toBe(true);
    // @ts-expect-error
    expect(isQueryTooShort(42)).toBe(true);
  });

  it("5. groupByType buckets each type correctly", () => {
    const rows = [
      R({ type: "employee",   id: "e1" }),
      R({ type: "zone",       id: "z1" }),
      R({ type: "invitation", id: "i1" }),
      R({ type: "emergency",  id: "s1" }),
      R({ type: "employee",   id: "e2" }),
    ];
    const g = groupByType(rows);
    expect(g.employee).toHaveLength(2);
    expect(g.zone).toHaveLength(1);
    expect(g.invitation).toHaveLength(1);
    expect(g.emergency).toHaveLength(1);
  });

  it("6. groupByType returns empty arrays for absent types", () => {
    const g = groupByType([R({ type: "employee" })]);
    expect(g.zone).toEqual([]);
    expect(g.invitation).toEqual([]);
    expect(g.emergency).toEqual([]);
  });

  it("7. mergeAndSort orders by score desc then title asc", () => {
    const rows = [
      R({ score: 50, title: "Banana", id: "1" }),
      R({ score: 100, title: "Apple", id: "2" }),
      R({ score: 80, title: "Cherry", id: "3" }),
    ];
    const sorted = mergeAndSort(rows);
    expect(sorted.map(r => r.id)).toEqual(["2", "3", "1"]);
  });

  it("8. mergeAndSort is stable across equal scores (title tiebreak)", () => {
    const rows = [
      R({ score: 80, title: "Charlie", id: "1" }),
      R({ score: 80, title: "Alpha",   id: "2" }),
      R({ score: 80, title: "Bravo",   id: "3" }),
    ];
    const sorted = mergeAndSort(rows);
    expect(sorted.map(r => r.title)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  describe("makeDebouncer", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("9. fires once after wait", () => {
      const fn = vi.fn();
      const d = makeDebouncer(fn, 200);
      d.trigger("a");
      d.trigger("b");
      d.trigger("c");
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("c");
    });

    it("10. cancel prevents the pending fire", () => {
      const fn = vi.fn();
      const d = makeDebouncer(fn, 200);
      d.trigger("a");
      d.cancel();
      vi.advanceTimersByTime(1000);
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
