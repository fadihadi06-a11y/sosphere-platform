// ═══════════════════════════════════════════════════════════════
// SOSphere — geofence-service (Phase 2 CRIT-3 world-class)
// ─────────────────────────────────────────────────────────────
// Real-time zone-membership detection on the mobile side.
//
// Architecture (mirrors CRIT-2 / CRIT-4 / CRIT-3-invitation):
//   • DB is THE source of truth (zones table = canonical runtime
//     definitions, geofence_events = the immutable transition log)
//   • All writes go through SECDEF RPC record_geofence_event which
//     derives company_id from the zone and verifies the caller is
//     a member (mobile clients cannot forge events for foreign companies)
//   • This module holds in-memory _serverZones + _membership state;
//     it is wiped on logout via clearGeofenceState() to prevent
//     cross-user leakage on shared devices.
//
// Hysteresis: GPS noise is the cardinal source of phantom transitions.
// A single sample crossing the boundary is treated as NOISE, not as a
// transition. We require N consecutive samples agreeing on the new
// state before flipping. The default threshold is 2 samples which,
// at the default GPS sampling rate (~5-10s) gives ~10-20s before a
// transition fires — fast enough for safety, slow enough to ignore
// momentary GPS jumps caused by urban canyons / multi-path.
//
// Accuracy band: a GPS fix carries an `accuracy` meters value (1-sigma
// horizontal). We treat the user as "inside the zone" whenever the
// circle of radius `accuracy` around the fix INTERSECTS the zone —
// i.e. distance(fix, zone.center) <= zone.radius + accuracy. This is
// the standard generous-inside rule used by iOS CoreLocation and
// Google Geofencing API — it prevents false EXIT events at zone
// edges when accuracy degrades.
//
// This file contains:
//   1. Pure helpers: haversineMeters, isPointInsideCircle,
//      isPointInsidePolygon, computeMembership, decideTransitions.
//      All Vitest-testable without any DOM or network.
//   2. Lifecycle helpers: initGeofenceService, clearGeofenceState.
//   3. Per-sample hook: evaluateGpsSample (called by
//      offline-gps-tracker.ts:processPosition).
//   4. RPC wrapper: recordGeofenceEvent.
// ═══════════════════════════════════════════════════════════════

export interface Zone {
  id: string;
  name?: string;
  /** Center latitude in degrees. */
  lat: number;
  /** Center longitude in degrees. */
  lng: number;
  /** Radius in meters (circular zone). */
  radiusMeters?: number;
  /** Optional polygon vertices [{lat, lng}, ...] — overrides radius if present. */
  polygon?: Array<{ lat: number; lng: number }>;
}

export interface GpsSample {
  lat: number;
  lng: number;
  /** 1-sigma horizontal accuracy in meters (from GeolocationCoordinates). */
  accuracy?: number;
  /** Sample time in ms since epoch (from GeolocationPosition.timestamp). */
  timestamp: number;
}

export interface TransitionDecision {
  entered: string[];   // zone ids the user just entered
  exited:  string[];   // zone ids the user just exited
  /** Zones the user is currently considered inside (post-transition state). */
  insideNow: string[];
}

/** Default hysteresis: 2 consecutive agreeing samples before flipping. */
export const DEFAULT_HYSTERESIS_SAMPLES = 2;
/** Default accuracy budget cap (meters). Fixes with worse accuracy are
 *  treated as if they had this value — prevents pathological 2km
 *  accuracy readings from making the whole city "inside every zone". */
export const MAX_ACCURACY_BAND_METERS = 50;

// ───────── PURE HELPERS ─────────

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number { return (deg * Math.PI) / 180; }

/** Great-circle distance between two lat/lng pairs, in meters.
 *  2026-06-03 consolidation: 5 prior duplicate implementations
 *  (shared-store, offline-gps-tracker, sar-engine, evacuation-screen,
 *  neighbor-alert-service:haversineKm) now import from here under
 *  their original local names — single source of truth. Smoke:
 *  Riyadh -> Jeddah = 843 km (Vincenty reference 845, ±5 tolerance
 *  locked by geofence-service-state.test.ts). */
export function haversineMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Is the GPS fix inside a circular zone, accounting for accuracy?
 *  Generous-inside rule: the user counts as inside whenever their
 *  accuracy circle intersects the zone circle. */
export function isPointInsideCircle(
  fixLat: number, fixLng: number,
  centerLat: number, centerLng: number,
  radiusMeters: number,
  accuracyMeters: number = 0,
): boolean {
  const d = haversineMeters(fixLat, fixLng, centerLat, centerLng);
  const band = Math.min(Math.max(0, accuracyMeters), MAX_ACCURACY_BAND_METERS);
  return d <= radiusMeters + band;
}

/** Ray-casting point-in-polygon (geographic coordinates).
 *  Treats lat/lng as planar — accurate enough for zones up to a few
 *  km on a side, which covers all realistic workplace/site geofences.
 *  For continental-scale polygons a spherical algorithm would be needed.
 *  The accuracy parameter is currently ignored for polygons; future
 *  work could buffer the polygon outward by `accuracy` meters. */
export function isPointInsidePolygon(
  fixLat: number, fixLng: number,
  vertices: Array<{ lat: number; lng: number }>,
): boolean {
  if (vertices.length < 3) return false;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lng, yi = vertices[i].lat;
    const xj = vertices[j].lng, yj = vertices[j].lat;
    const intersect = ((yi > fixLat) !== (yj > fixLat)) &&
      (fixLng < ((xj - xi) * (fixLat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** For one GPS sample + a set of zones, return the set of zones the
 *  user is currently inside (raw — no hysteresis applied yet). */
export function computeMembership(sample: GpsSample, zones: Zone[]): Set<string> {
  const out = new Set<string>();
  const acc = sample.accuracy ?? 0;
  for (const z of zones) {
    let inside = false;
    if (z.polygon && z.polygon.length >= 3) {
      inside = isPointInsidePolygon(sample.lat, sample.lng, z.polygon);
    } else if (typeof z.radiusMeters === "number" && z.radiusMeters > 0) {
      inside = isPointInsideCircle(sample.lat, sample.lng, z.lat, z.lng, z.radiusMeters, acc);
    }
    if (inside) out.add(z.id);
  }
  return out;
}

/** Pending-transition buffer entry. The buffer suppresses single-sample
 *  noise — a transition only fires when `count` reaches `threshold`. */
export interface PendingTransition {
  /** What the new state would become if the buffer flushes. */
  toState: "in" | "out";
  /** How many consecutive samples have agreed on toState so far. */
  count: number;
}

/** Pure hysteresis logic. Given:
 *   prev      — the set of zones the user was previously *considered* inside
 *   candidate — the set the latest sample would put them in (raw)
 *   pending   — map of zoneId → in-flight transition buffer
 *   threshold — how many agreeing samples needed before flipping
 *  returns the set of confirmed transitions + the new state.
 *  The function is REFERENTIALLY TRANSPARENT: pending is mutated, so
 *  the caller is expected to own the same Map across calls. */
export function decideTransitions(
  prev: Set<string>,
  candidate: Set<string>,
  pending: Map<string, PendingTransition>,
  threshold: number = DEFAULT_HYSTERESIS_SAMPLES,
): TransitionDecision {
  const entered: string[] = [];
  const exited:  string[] = [];
  const insideNow = new Set(prev);

  // Build union of zones to inspect: anywhere in prev, candidate, or pending.
  const all = new Set<string>([...prev, ...candidate, ...pending.keys()]);
  for (const zoneId of all) {
    const wasIn = prev.has(zoneId);
    const isIn  = candidate.has(zoneId);
    if (wasIn === isIn) {
      // Steady state — drop any pending buffer for this zone
      pending.delete(zoneId);
      continue;
    }
    const targetState: "in" | "out" = isIn ? "in" : "out";
    const buf = pending.get(zoneId);
    if (!buf || buf.toState !== targetState) {
      pending.set(zoneId, { toState: targetState, count: 1 });
      continue;
    }
    buf.count += 1;
    if (buf.count >= threshold) {
      // Confirm transition
      pending.delete(zoneId);
      if (targetState === "in") {
        entered.push(zoneId);
        insideNow.add(zoneId);
      } else {
        exited.push(zoneId);
        insideNow.delete(zoneId);
      }
    }
  }

  return { entered, exited, insideNow: Array.from(insideNow) };
}

// ───────── IN-MEMORY STATE (server-state pattern) ─────────

let _serverZones: Zone[] | null = null;
let _membership: Set<string> = new Set();
const _pending: Map<string, PendingTransition> = new Map();
/** Set the canonical zone list (called by initGeofenceService after
 *  loading from Supabase). Also resets membership + pending buffer. */
export function setServerZones(zones: Zone[]): void {
  _serverZones = zones.slice();
  _membership = new Set();
  _pending.clear();
}

export function clearGeofenceState(): void {
  _serverZones = null;
  _membership = new Set();
  _pending.clear();
}

export function getCachedZones(): Zone[] {
  return _serverZones ? _serverZones.slice() : [];
}

/** Read-only snapshot of current confirmed membership. */
export function getCurrentMembership(): string[] {
  return Array.from(_membership);
}

// ───────── LIFECYCLE ─────────

/** Load all zones for the given company via the RLS-scoped zones table.
 *  Caller (mobile-app.tsx on login) should invoke this once per session.
 *  Idempotent: re-calling refreshes from server. */
export async function initGeofenceService(companyId: string): Promise<void> {
  if (!companyId) return;
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase
      .from("zones")
      .select("id, name, lat, lng, lon, radius, radius_meters, type, polygon")
      .eq("company_id", companyId);
    if (error) {
      console.warn("[Geofence] init failed:", error.message);
      return;
    }
    const zones: Zone[] = (data ?? []).map((r: any) => {
      // The zones table has redundant lng/lon columns due to historic
      // migrations. Prefer lng, fall back to lon. Same for radius/radius_meters.
      const lat = typeof r.lat === "number" ? r.lat : null;
      const lng = typeof r.lng === "number" ? r.lng
                : typeof r.lon === "number" ? r.lon : null;
      if (lat == null || lng == null) return null;
      const radius = typeof r.radius_meters === "number" ? r.radius_meters
                   : typeof r.radius === "number" ? r.radius : undefined;
      // polygon column may be jsonb [{lat, lng}, ...] (optional, future use)
      let polygon: Array<{ lat: number; lng: number }> | undefined;
      if (Array.isArray(r.polygon)) {
        polygon = (r.polygon as any[])
          .filter(p => p && typeof p.lat === "number" && typeof p.lng === "number")
          .map(p => ({ lat: p.lat, lng: p.lng }));
        if (polygon.length < 3) polygon = undefined;
      }
      return { id: String(r.id), name: r.name, lat, lng, radiusMeters: radius, polygon };
    }).filter(Boolean) as Zone[];
    setServerZones(zones);
  } catch (err) {
    console.warn("[Geofence] init threw:", err);
  }
}

// ───────── PER-SAMPLE HOOK (called from offline-gps-tracker) ─────────

/** Evaluate one GPS sample against the cached zones, apply hysteresis,
 *  and return the confirmed transitions for this sample.
 *  Pure-relative-to-state: returns the transitions but DOES NOT fire
 *  side-effects (DB write, SyncEvent emit). The hook caller is
 *  responsible for those — see recordGeofenceEvent + emitSyncEvent. */
export function evaluateGpsSample(sample: GpsSample): TransitionDecision {
  if (!_serverZones || _serverZones.length === 0) {
    return { entered: [], exited: [], insideNow: Array.from(_membership) };
  }
  const candidate = computeMembership(sample, _serverZones);
  const decision = decideTransitions(_membership, candidate, _pending, DEFAULT_HYSTERESIS_SAMPLES);
  _membership = new Set(decision.insideNow);
  return decision;
}

// ───────── RPC WRAPPERS ─────────

export interface RecordGeofenceEventArgs {
  zoneId: string;
  eventType: "enter" | "exit" | "dwell";
  lat: number;
  lng: number;
  accuracy?: number | null;
  source?: "gps" | "manual" | "geofence_admin";
  occurredAt?: string | null;  // ISO 8601
}

/** Fire-and-forget RPC. Logs but does not throw on failure — the caller
 *  is in a GPS sample processing hot path that must not crash. */
export async function recordGeofenceEvent(args: RecordGeofenceEventArgs): Promise<string | null> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("record_geofence_event", {
      p_zone_id:     args.zoneId,
      p_event_type:  args.eventType,
      p_lat:         args.lat,
      p_lng:         args.lng,
      p_accuracy:    args.accuracy ?? null,
      p_source:      args.source   ?? "gps",
      p_occurred_at: args.occurredAt ?? null,
    });
    if (error) {
      console.warn("[Geofence] record_geofence_event failed:", error.message);
      return null;
    }
    return typeof data === "string" ? data : null;
  } catch (err) {
    console.warn("[Geofence] record_geofence_event threw:", err);
    return null;
  }
}
