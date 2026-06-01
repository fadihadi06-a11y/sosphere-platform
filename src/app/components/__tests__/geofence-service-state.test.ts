// ═══════════════════════════════════════════════════════════════
// SOSphere — geofence-service contract
// ─────────────────────────────────────────────────────────────
// Phase 2 CRIT-3 (2026-06-01): mobile-side zone-membership detection.
//
// These tests lock the architectural contract for the geometry +
// hysteresis logic so a future refactor cannot silently regress:
//
//   1.  haversineMeters matches a known reference distance (Riyadh
//       to Jeddah ~860 km — verifies algorithm + sign conventions)
//   2.  isPointInsideCircle is generous-inside (accuracy band widens
//       the zone, prevents false EXIT at the edge)
//   3.  isPointInsideCircle caps the accuracy band so a pathological
//       2km accuracy fix does NOT make every zone "inside"
//   4.  isPointInsidePolygon ray-casts correctly (inside/outside/edge)
//   5.  isPointInsidePolygon rejects degenerate polygons (<3 vertices)
//   6.  computeMembership applies polygon WHEN present, else circle
//   7.  decideTransitions requires N consecutive agreeing samples
//       before flipping state (no single-sample noise leaks through)
//   8.  decideTransitions resets the pending buffer when the candidate
//       reverts to the previous state (oscillating sample = no transition)
//   9.  setServerZones + clearGeofenceState wipe in-memory state
//       (verifies the logout-safety contract — no cross-user leakage)
//  10.  evaluateGpsSample is a pure function of (state + sample) —
//       fires no transitions when zones list is empty (no side effects
//       on uninit'd module — safe to import lazily on every GPS sample)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage + window so any incidental imports inside the
// service don't blow up under Node test env.
const lsStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => lsStore[k] ?? null,
  setItem: (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
  clear: () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
});
vi.stubGlobal("window", { dispatchEvent: () => {} });

async function loadFresh() {
  vi.resetModules();
  return await import("../geofence-service");
}

// Riyadh, KSA — used as a stable reference point in many tests
const RIYADH = { lat: 24.7136, lng: 46.6753 };
// Jeddah — ~860 km away
const JEDDAH = { lat: 21.4858, lng: 39.1925 };

const ZONE_A = {
  id: "zone-a",
  name: "Site A",
  lat: RIYADH.lat,
  lng: RIYADH.lng,
  radiusMeters: 100,
};
const ZONE_B = {
  id: "zone-b",
  name: "Polygon B",
  lat: RIYADH.lat,
  lng: RIYADH.lng,
  // small square polygon around Riyadh (~200m on a side)
  polygon: [
    { lat: 24.7140, lng: 46.6750 },
    { lat: 24.7140, lng: 46.6760 },
    { lat: 24.7130, lng: 46.6760 },
    { lat: 24.7130, lng: 46.6750 },
  ],
};

describe("geofence-service — Phase 2 CRIT-3 contract", () => {
  beforeEach(() => {
    for (const k of Object.keys(lsStore)) delete lsStore[k];
  });

  it("1. haversineMeters matches known Riyadh→Jeddah great-circle distance (~845km ± 5km)", async () => {
    const { haversineMeters } = await loadFresh();
    // Riyadh (24.7136N, 46.6753E) → Jeddah (21.4858N, 39.1925E)
    // Great-circle distance ≈ 845.1 km using R=6371000m (spherical Earth).
    // Road distance is ~860km but we're testing the math, not navigation.
    const d = haversineMeters(RIYADH.lat, RIYADH.lng, JEDDAH.lat, JEDDAH.lng);
    expect(d).toBeGreaterThan(840_000);
    expect(d).toBeLessThan(850_000);
  });

  it("2. isPointInsideCircle widens the zone by the accuracy band (generous-inside)", async () => {
    const { isPointInsideCircle } = await loadFresh();
    // Fix exactly on the 100m circle boundary, with 30m accuracy
    // → distance is 100m, radius+band = 100+30 = 130m → inside.
    // Build a point exactly 100m away by stepping ~9e-4 degrees latitude
    // (1 deg lat ≈ 111km, so 100m ≈ 0.0009 deg).
    const fixLat = RIYADH.lat + 0.0009; // ~100m north
    const result = isPointInsideCircle(fixLat, RIYADH.lng, RIYADH.lat, RIYADH.lng, 100, 30);
    expect(result).toBe(true);
    // With 0 accuracy the same point is just outside (~100m vs 100m radius)
    // — give a small fudge factor in either direction (depends on exact
    // earth radius constant). The point is the BAND made the difference,
    // which is what generous-inside is about.
    const tightResult = isPointInsideCircle(fixLat + 0.0001, RIYADH.lng, RIYADH.lat, RIYADH.lng, 100, 0);
    expect(tightResult).toBe(false);
  });

  it("3. isPointInsideCircle caps the accuracy band (MAX_ACCURACY_BAND_METERS)", async () => {
    const { isPointInsideCircle, MAX_ACCURACY_BAND_METERS } = await loadFresh();
    // A fix 500m away should NOT be "inside" a 100m zone even if accuracy
    // claims 2km — the band caps at MAX_ACCURACY_BAND_METERS (50m default),
    // so effective inclusion zone is 100+50 = 150m, and the fix at 500m is out.
    const fixLat = RIYADH.lat + 0.0045; // ~500m north
    expect(MAX_ACCURACY_BAND_METERS).toBeLessThanOrEqual(100); // sanity
    const result = isPointInsideCircle(fixLat, RIYADH.lng, RIYADH.lat, RIYADH.lng, 100, 2000);
    expect(result).toBe(false);
  });

  it("4. isPointInsidePolygon ray-casts correctly (inside/outside)", async () => {
    const { isPointInsidePolygon } = await loadFresh();
    const poly = ZONE_B.polygon;
    // Center of polygon = inside
    expect(isPointInsidePolygon(24.7135, 46.6755, poly)).toBe(true);
    // Far outside (in Jeddah)
    expect(isPointInsidePolygon(JEDDAH.lat, JEDDAH.lng, poly)).toBe(false);
    // Just outside one corner
    expect(isPointInsidePolygon(24.7100, 46.6700, poly)).toBe(false);
  });

  it("5. isPointInsidePolygon rejects degenerate polygons (<3 vertices)", async () => {
    const { isPointInsidePolygon } = await loadFresh();
    expect(isPointInsidePolygon(24.7135, 46.6755, [])).toBe(false);
    expect(isPointInsidePolygon(24.7135, 46.6755, [{ lat: 24.7140, lng: 46.6750 }])).toBe(false);
    expect(isPointInsidePolygon(24.7135, 46.6755, [
      { lat: 24.7140, lng: 46.6750 },
      { lat: 24.7140, lng: 46.6760 },
    ])).toBe(false);
  });

  it("6. computeMembership uses polygon when present, else circle", async () => {
    const { computeMembership } = await loadFresh();
    // Fix at exact Riyadh — inside both ZONE_A (circle) and ZONE_B (polygon)
    const inside = computeMembership(
      { lat: RIYADH.lat, lng: RIYADH.lng, timestamp: Date.now() },
      [ZONE_A, ZONE_B],
    );
    expect(inside.has("zone-a")).toBe(true);
    expect(inside.has("zone-b")).toBe(true);
    // Fix in Jeddah — outside both
    const outside = computeMembership(
      { lat: JEDDAH.lat, lng: JEDDAH.lng, timestamp: Date.now() },
      [ZONE_A, ZONE_B],
    );
    expect(outside.size).toBe(0);
  });

  it("7. decideTransitions requires N consecutive agreeing samples before flipping", async () => {
    const { decideTransitions, DEFAULT_HYSTERESIS_SAMPLES } = await loadFresh();
    expect(DEFAULT_HYSTERESIS_SAMPLES).toBe(2);
    const pending = new Map();
    // Sample 1: enter zone-a (prev empty, candidate {zone-a})
    let d = decideTransitions(new Set(), new Set(["zone-a"]), pending, 2);
    expect(d.entered).toEqual([]); // not yet — needs 2 samples
    expect(pending.size).toBe(1);
    // Sample 2: still inside
    d = decideTransitions(new Set(), new Set(["zone-a"]), pending, 2);
    expect(d.entered).toEqual(["zone-a"]); // confirmed
    expect(d.insideNow).toEqual(["zone-a"]);
    expect(pending.size).toBe(0);
  });

  it("8. decideTransitions resets the buffer when sample reverts (no oscillation)", async () => {
    const { decideTransitions } = await loadFresh();
    const pending = new Map();
    // Sample 1: "enter" candidate (1/2)
    let d = decideTransitions(new Set(), new Set(["zone-a"]), pending, 2);
    expect(d.entered).toEqual([]);
    expect(pending.get("zone-a")?.count).toBe(1);
    // Sample 2: candidate flips back to outside — pending buffer dropped
    d = decideTransitions(new Set(), new Set(), pending, 2);
    expect(d.entered).toEqual([]);
    expect(pending.has("zone-a")).toBe(false); // buffer reset
    // Sample 3: enter again (1/2 fresh)
    d = decideTransitions(new Set(), new Set(["zone-a"]), pending, 2);
    expect(d.entered).toEqual([]);
    expect(pending.get("zone-a")?.count).toBe(1);
  });

  it("9. setServerZones + clearGeofenceState wipe in-memory state", async () => {
    const svc = await loadFresh();
    svc.setServerZones([ZONE_A, ZONE_B]);
    expect(svc.getCachedZones()).toHaveLength(2);
    // Push membership via two confirming samples
    svc.evaluateGpsSample({ lat: RIYADH.lat, lng: RIYADH.lng, timestamp: 1 });
    svc.evaluateGpsSample({ lat: RIYADH.lat, lng: RIYADH.lng, timestamp: 2 });
    expect(svc.getCurrentMembership().length).toBeGreaterThan(0);
    // Logout — everything wipes
    svc.clearGeofenceState();
    expect(svc.getCachedZones()).toEqual([]);
    expect(svc.getCurrentMembership()).toEqual([]);
  });

  it("10. evaluateGpsSample with no zones is a safe no-op (no side effects, no transitions)", async () => {
    const svc = await loadFresh();
    // No setServerZones called → cache is null
    const d = svc.evaluateGpsSample({ lat: RIYADH.lat, lng: RIYADH.lng, timestamp: 1 });
    expect(d.entered).toEqual([]);
    expect(d.exited).toEqual([]);
    expect(d.insideNow).toEqual([]);
    // Also: evaluating with zones but a far-away sample → no transitions
    svc.setServerZones([ZONE_A]);
    const farSample = svc.evaluateGpsSample({ lat: JEDDAH.lat, lng: JEDDAH.lng, timestamp: 1 });
    expect(farSample.entered).toEqual([]);
    expect(farSample.exited).toEqual([]);
  });
});
