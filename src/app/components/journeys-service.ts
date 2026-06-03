// ═══════════════════════════════════════════════════════════════
// SOSphere — Journeys Service (P3-#11f)
// ─────────────────────────────────────────────────────────────
// Data-access layer for the Journey Management page. Journeys used
// to live only in localStorage, which made them invisible to other
// admins and to the compliance PDF's "On-Route Incident" section.
//
// Design notes:
//   • Waypoints are serialized as jsonb (Date fields round-trip as
//     ISO strings) so the client's nested shape survives a full
//     browser reload + server fetch unchanged.
//   • Fetches return [] on failure — the caller decides fallback.
//   • Upserts log + return a boolean instead of throwing, so UI
//     handlers stay snappy and never crash on a transient network
//     hiccup.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";

// Local types mirror the Journey Management page's exports. Keeping
// them local (instead of importing from the page) avoids circular
// dependencies — the page imports this service.

type JourneyStatus = "active" | "completed" | "delayed" | "deviated" | "sos";
type WaypointStatus = "pending" | "arrived" | "missed" | "skipped";

export interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  eta: Date;
  arrivedAt?: Date;
  status: WaypointStatus;
}

export interface Journey {
  id: string;
  employeeName: string;
  employeeId: string;
  origin: string;
  destination: string;
  startTime: Date;
  estimatedEnd: Date;
  actualEnd?: Date;
  waypoints: Waypoint[];
  status: JourneyStatus;
  currentLocation?: string;
  distanceCovered: number;
  totalDistance: number;
  vehicleType: string;
}

// ── (De)serialization ─────────────────────────────────────────

function serializeWaypoint(w: Waypoint): Record<string, any> {
  return {
    id: w.id,
    name: w.name,
    lat: w.lat,
    lng: w.lng,
    eta: w.eta.toISOString(),
    arrivedAt: w.arrivedAt ? w.arrivedAt.toISOString() : undefined,
    status: w.status,
  };
}

function hydrateWaypoint(raw: any): Waypoint {
  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    lat: typeof raw.lat === "number" ? raw.lat : 0,
    lng: typeof raw.lng === "number" ? raw.lng : 0,
    eta: raw.eta ? new Date(raw.eta) : new Date(),
    arrivedAt: raw.arrivedAt ? new Date(raw.arrivedAt) : undefined,
    status: (raw.status as WaypointStatus) ?? "pending",
  };
}

function rowToJourney(row: any): Journey {
  return {
    id: row.id,
    employeeName: row.employee_name ?? "",
    employeeId: row.employee_id ?? "",
    origin: row.origin ?? "",
    destination: row.destination ?? "",
    startTime: row.start_time ? new Date(row.start_time) : new Date(),
    estimatedEnd: row.estimated_end ? new Date(row.estimated_end) : new Date(),
    actualEnd: row.actual_end ? new Date(row.actual_end) : undefined,
    waypoints: Array.isArray(row.waypoints) ? row.waypoints.map(hydrateWaypoint) : [],
    status: (row.status as JourneyStatus) ?? "active",
    currentLocation: row.current_location ?? undefined,
    distanceCovered: typeof row.distance_covered === "number" ? row.distance_covered : Number(row.distance_covered) || 0,
    totalDistance: typeof row.total_distance === "number" ? row.total_distance : Number(row.total_distance) || 0,
    vehicleType: row.vehicle_type ?? "",
  };
}

function journeyToRow(j: Journey, companyId: string): Record<string, any> {
  return {
    id: j.id,
    company_id: companyId,
    employee_id: j.employeeId || null,
    employee_name: j.employeeName,
    origin: j.origin,
    destination: j.destination,
    start_time: j.startTime.toISOString(),
    estimated_end: j.estimatedEnd.toISOString(),
    actual_end: j.actualEnd ? j.actualEnd.toISOString() : null,
    waypoints: j.waypoints.map(serializeWaypoint),
    status: j.status,
    current_location: j.currentLocation ?? null,
    distance_covered: j.distanceCovered,
    total_distance: j.totalDistance,
    vehicle_type: j.vehicleType,
  };
}

// ── Public API ────────────────────────────────────────────────

/** Fetch all journeys for the current company, newest first. */
// ───────── IN-MEMORY CACHE (15th pattern app, 2026-06-03) ─────────
// Replaces the localStorage bootstrap that lived in
// journey-management.tsx (CRIT-#4 cross-tenant leak class — same bug
// as investigations #4 + risk-register #3). The legacy `sosphere_journeys`
// key is killed inside getCachedJourneys as a one-shot migration; the
// new cache lives under `sosphere_journeys_cache`.

const JOURNEYS_CACHE_KEY = "sosphere_journeys_cache";
const LEGACY_JOURNEYS_KEY = "sosphere_journeys";
let _serverJourneys: Journey[] | null = null;

function serializeJourney(j: Journey): Record<string, unknown> {
  return {
    ...j,
    startTime: j.startTime instanceof Date ? j.startTime.toISOString() : j.startTime,
    estimatedEnd: j.estimatedEnd instanceof Date ? j.estimatedEnd.toISOString() : j.estimatedEnd,
    actualEnd: j.actualEnd instanceof Date ? j.actualEnd.toISOString() : j.actualEnd,
    waypoints: (j.waypoints || []).map((w) => ({
      ...w,
      eta: w.eta instanceof Date ? w.eta.toISOString() : w.eta,
      arrivedAt: w.arrivedAt instanceof Date ? w.arrivedAt.toISOString() : w.arrivedAt,
    })),
  };
}
function rehydrateJourney(raw: Record<string, unknown>): Journey {
  const j = raw as unknown as Journey;
  return {
    ...j,
    startTime: new Date(j.startTime as unknown as string),
    estimatedEnd: new Date(j.estimatedEnd as unknown as string),
    actualEnd: j.actualEnd ? new Date(j.actualEnd as unknown as string) : undefined,
    waypoints: (j.waypoints || []).map((w) => ({
      ...w,
      eta: w.eta ? new Date(w.eta as unknown as string) : new Date(),
      arrivedAt: w.arrivedAt ? new Date(w.arrivedAt as unknown as string) : undefined,
    })),
  };
}

export function setCachedJourneys(rows: Journey[]): void {
  _serverJourneys = rows.slice();
  try {
    localStorage.setItem(JOURNEYS_CACHE_KEY, JSON.stringify(rows.map(serializeJourney)));
  } catch { /* unavailable */ }
}

export function getCachedJourneys(): Journey[] {
  if (_serverJourneys) return _serverJourneys.slice();
  try {
    // One-shot legacy migration: kill the unscoped `sosphere_journeys`
    // key (CRIT-#4 cross-tenant leak class). removeItem is idempotent.
    localStorage.removeItem(LEGACY_JOURNEYS_KEY);
    const raw = localStorage.getItem(JOURNEYS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
      if (Array.isArray(parsed)) {
        const rehydrated = parsed.map(rehydrateJourney);
        _serverJourneys = rehydrated;
        return rehydrated.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function clearJourneysCache(): void {
  _serverJourneys = null;
  try {
    localStorage.removeItem(JOURNEYS_CACHE_KEY);
    localStorage.removeItem(LEGACY_JOURNEYS_KEY);
  } catch { /* unavailable */ }
}

export async function fetchJourneys(): Promise<Journey[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { data, error } = await supabase
      .from("journeys")
      .select("*")
      .eq("company_id", companyId)
      .order("start_time", { ascending: false })
      .limit(200);
    if (error || !data) return [];
    const rows = data.map(rowToJourney);
    setCachedJourneys(rows);
    return rows;
  } catch (err) {
    console.warn("[journeys-service] fetch:", err);
    return [];
  }
}

export async function upsertJourney(j: Journey): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { error } = await supabase
      .from("journeys")
      .upsert(journeyToRow(j, companyId), { onConflict: "id" });
    if (error) {
      console.warn("[journeys-service] upsert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[journeys-service] upsert exception:", err);
    return false;
  }
}

export async function upsertJourneyBatch(journeys: Journey[]): Promise<number> {
  if (journeys.length === 0) return 0;
  const companyId = getCompanyId();
  if (!companyId) return 0;
  try {
    const rows = journeys.map((j) => journeyToRow(j, companyId));
    const { error } = await supabase
      .from("journeys")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("[journeys-service] batch upsert failed:", error.message);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.warn("[journeys-service] batch upsert exception:", err);
    return 0;
  }
}
