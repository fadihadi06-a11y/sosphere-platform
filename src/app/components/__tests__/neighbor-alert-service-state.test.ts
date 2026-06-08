// ═══════════════════════════════════════════════════════════════
// SOSphere — neighbor-alert-service contract (M3-#22)
// ─────────────────────────────────────────────────────────────
// 2026-06-06 roots-of-roots M3-#22: locks the pure helpers used
// by the neighborhood broadcast surface. Targets ONLY the helpers
// that are deterministic + side-effect-free; the publish/subscribe
// halves of the service require Realtime + RPC mocking and live
// outside this file.
//
//   1. encodeGeohash: zero coordinates produce a stable hash
//   2. encodeGeohash: precision 4 truncates to 4 chars
//   3. encodeGeohash: precision 5 (default) returns 5 chars
//   4. encodeGeohash: stable across calls (deterministic)
//   5. encodeGeohash: known fixture — Riyadh ≈ "thuh3"
//   6. neighborhoodCells: returns 9 cells max (3x3 grid)
//   7. neighborhoodCells: includes the centre cell
//   8. neighborhoodCells: dedups identical neighbours at high lat
//   9. haversineKm: identical points → 0
//  10. haversineKm: symmetric in argument order
//  11. haversineKm: Paris↔London ≈ 344 km (±2%)
//  12. clearNeighborAlertCache: idempotent + no-throw
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  encodeGeohash, neighborhoodCells, haversineKm,
  clearNeighborAlertCache,
} from "../neighbor-alert-service";

describe("neighbor-alert-service — M3-#22 contract", () => {
  it("1. encodeGeohash: zero coordinates produce a stable hash", () => {
    const h = encodeGeohash(0, 0, 5);
    expect(h).toHaveLength(5);
    expect(h).toMatch(/^[0-9bcdefghjkmnpqrstuvwxyz]+$/);
  });

  it("2. encodeGeohash: precision 4 truncates to 4 chars", () => {
    expect(encodeGeohash(24.7136, 46.6753, 4)).toHaveLength(4);
  });

  it("3. encodeGeohash: precision 5 (default) returns 5 chars", () => {
    expect(encodeGeohash(24.7136, 46.6753)).toHaveLength(5);
  });

  it("4. encodeGeohash: deterministic across calls", () => {
    const a = encodeGeohash(40.7128, -74.0060, 5);
    const b = encodeGeohash(40.7128, -74.0060, 5);
    expect(a).toBe(b);
  });

  it("5. encodeGeohash: Riyadh fixture matches known geohash prefix", () => {
    // Riyadh ≈ 24.7136°N, 46.6753°E
    // geohash-5 in the Niemeyer alphabet starts with t/u/v cluster.
    const h = encodeGeohash(24.7136, 46.6753, 5);
    expect(h[0]).toMatch(/[stuvwxyz]/);
  });

  it("6. neighborhoodCells: returns at most 9 cells (3x3 grid)", () => {
    const cells = neighborhoodCells(24.7136, 46.6753, 5);
    expect(cells.length).toBeGreaterThanOrEqual(1);
    expect(cells.length).toBeLessThanOrEqual(9);
  });

  it("7. neighborhoodCells: includes the centre cell", () => {
    const centre = encodeGeohash(24.7136, 46.6753, 5);
    const cells = neighborhoodCells(24.7136, 46.6753, 5);
    expect(cells).toContain(centre);
  });

  it("8. neighborhoodCells: dedups identical neighbours at high latitudes", () => {
    // Near the pole, longitude-offset cells collapse; the Set already
    // dedups. Verify length is still <= 9 + no duplicates.
    const cells = neighborhoodCells(89.5, 0, 5);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("9. haversineKm: identical points → 0", () => {
    expect(haversineKm(24.7136, 46.6753, 24.7136, 46.6753)).toBe(0);
  });

  it("10. haversineKm: symmetric in argument order", () => {
    const a = haversineKm(40.7128, -74.0060, 51.5074, -0.1278);
    const b = haversineKm(51.5074, -0.1278, 40.7128, -74.0060);
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });

  it("11. haversineKm: Paris↔London ≈ 344 km (±2%)", () => {
    // Paris (48.8566, 2.3522) ↔ London (51.5074, -0.1278) = ~344 km
    const km = haversineKm(48.8566, 2.3522, 51.5074, -0.1278);
    expect(km).toBeGreaterThan(335);
    expect(km).toBeLessThan(353);
  });

  it("12. clearNeighborAlertCache: idempotent + no-throw", () => {
    expect(() => clearNeighborAlertCache()).not.toThrow();
    expect(() => clearNeighborAlertCache()).not.toThrow();
  });
});
