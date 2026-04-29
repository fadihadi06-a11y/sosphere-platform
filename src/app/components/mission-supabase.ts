// ═══════════════════════════════════════════════════════════════
// SOSphere — Mission Control: Supabase data layer (Wave 1 / T1.1)
// ─────────────────────────────────────────────────────────────
// Replaces the localStorage-only `getAllMissions()` from
// `mission-store.ts` with a real Supabase read + realtime
// subscription. The localStorage layer is kept as a fallback
// for offline + as a write-through cache for cross-tab updates,
// but the DASHBOARD's source of truth is now the `missions`
// table.
//
// RLS policies on missions ensure admins/owners see only their
// own company's rows. Realtime publication for missions/mission_gps/
// mission_heartbeats was added in migration
// 20260429180000_w1_t11_missions_realtime_publication.sql.
//
// What this module does:
//   1. `loadMissionsFromSupabase()` — one-shot fetch (used on
//      cold start or as a fallback if realtime stutters).
//   2. `subscribeToMissions(onChange)` — Supabase realtime
//      subscription that fires `onChange()` on every mutation.
//   3. `useSupabaseMissions(companyId)` — React hook that
//      composes the above two. Returns `{missions, loading,
//      error, isLive}`. Drop-in replacement for the old
//      `getAllMissions()` polling.
//   4. `mapDbRowToMission()` — translates the DB row shape into
//      the existing `Mission` TS interface so the UI does not
//      have to change.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "./api/supabase-client";
import type { Mission, MissionStatus } from "./mission-store";

// ── DB row shape matches the public.missions schema ─────────────
interface DbMissionRow {
  id: string;
  company_id: string | null;
  employee_id: number | null;
  title: string | null;
  from_location: string | null;
  to_location: string | null;
  vehicle: string | null;
  status: string;
  start_time: string | null;
  duration_hours: number | null;
  estimated_duration_min: number | null;
  waypoints: unknown;
  notes: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  origin_lat: number | null;
  origin_lng: number | null;
  actual_start: string | null;
  actual_end: string | null;
  created_at: string;
  // Optional joined employee
  employees?: { name?: string | null } | null;
}

// ── Status translation (DB strings → TS MissionStatus) ──────────
// The DB uses lowercase canonical names. If the DB ever stores a
// status the TS enum doesn't recognise, we fall back to "created"
// to keep the UI from crashing.
const KNOWN_STATUSES: ReadonlyArray<MissionStatus> = [
  "created",
  "notified",
  "ready",
  "en_route_out",
  "arrived_site",
  "working",
  "en_route_back",
  "completed",
  "cancelled",
  "alert",
];

function coerceStatus(raw: string | null | undefined): MissionStatus {
  if (!raw) return "created";
  const lc = raw.toLowerCase();
  return (KNOWN_STATUSES as readonly string[]).includes(lc)
    ? (lc as MissionStatus)
    : "created";
}

function ts(s: string | null | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

// ──────────────────────────────────────────────────────────────
// DB row → Mission (the shape the UI already expects)
// We default unknown / not-yet-tracked fields rather than throw,
// so the UI keeps rendering even if the DB row is sparse.
// ──────────────────────────────────────────────────────────────
export function mapDbRowToMission(row: DbMissionRow): Mission {
  const startMs = ts(row.start_time);
  const durationMs =
    (row.estimated_duration_min ?? (row.duration_hours ?? 0) * 60) * 60_000;
  const scheduledEnd = startMs > 0 ? startMs + durationMs : 0;

  // The DB uses bigint for employee_id; the Mission interface
  // wants a string identifier. We coerce so existing UI lookups
  // continue to work.
  const employeeId =
    row.employee_id !== null && row.employee_id !== undefined
      ? String(row.employee_id)
      : "unknown";
  const employeeName =
    row.employees?.name ?? (employeeId !== "unknown" ? `Employee #${employeeId}` : "Unknown");

  const origin = {
    name: row.from_location ?? "Origin",
    lat: row.origin_lat ?? 0,
    lng: row.origin_lng ?? 0,
  };
  const destination = {
    name: row.to_location ?? "Destination",
    lat: row.dest_lat ?? 0,
    lng: row.dest_lng ?? 0,
  };

  return {
    id: row.id,
    employeeId,
    employeeName,
    assignedBy: row.company_id ?? "system",
    createdAt: ts(row.created_at),
    scheduledStart: startMs,
    scheduledEnd,
    origin,
    destination,
    // No separate return-to in the DB schema — fall back to origin.
    returnTo: origin,
    arrivalRadius: 50,
    status: coerceStatus(row.status),
    departedAt: ts(row.actual_start) || undefined,
    arrivedHomeAt: ts(row.actual_end) || undefined,
    // Tracking arrays default empty until we wire mission_gps /
    // mission_heartbeats in T1.3 (Playback). The UI handles empty.
    gpsTrack: [],
    returnTrack: [],
    heartbeats: [],
    alerts: [],
    offlineBuffer: [],
    notes: row.notes ?? "",
    vehicleType: row.vehicle ?? "",
  };
}

// ──────────────────────────────────────────────────────────────
// One-shot read of all missions for the caller's tenant. RLS
// policies on `missions` automatically scope this to the user's
// company; we do not need a manual `.eq("company_id", ...)`.
// ──────────────────────────────────────────────────────────────
export async function loadMissionsFromSupabase(): Promise<Mission[]> {
  const { data, error } = await supabase
    .from("missions")
    .select("*, employees(name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.warn("[mission-supabase] load failed:", error.message);
    throw error;
  }
  return (data ?? []).map((r) => mapDbRowToMission(r as DbMissionRow));
}

// ──────────────────────────────────────────────────────────────
// Subscribe to realtime mutations on `missions`. Returns an
// unsubscribe function. Caller is responsible for re-fetching
// when `onChange` fires (or we could pass the row payload, but
// re-fetch is simpler and avoids drift).
// ──────────────────────────────────────────────────────────────
export function subscribeToMissions(onChange: () => void): () => void {
  // Each subscription gets its own channel name to avoid collisions
  // when MULTIPLE Mission Control instances mount (e.g. two tabs).
  const channelName = `missions-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "missions" },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

// ──────────────────────────────────────────────────────────────
// React hook — drop-in replacement for the old localStorage
// polling pattern in mission-control.tsx. Returns the live
// missions list plus loading / error / isLive flags so the UI
// can show a "syncing…" state if needed.
//
// `companyId` is currently informational only — RLS handles
// scoping. We accept it for forward-compat (in case RLS is
// loosened later and we need a manual filter).
// ──────────────────────────────────────────────────────────────
export function useSupabaseMissions(_companyId?: string | null): {
  missions: Mission[];
  loading: boolean;
  error: string | null;
  isLive: boolean;
  refresh: () => void;
} {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await loadMissionsFromSupabase();
      if (mountedRef.current) {
        setMissions(list);
        setError(null);
        setLoading(false);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError((e as Error)?.message || "load_failed");
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const unsub = subscribeToMissions(() => {
      // Realtime fired — debounce by re-reading once.
      void refresh();
      setIsLive(true);
    });
    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, [refresh]);

  return { missions, loading, error, isLive, refresh };
}

// ──────────────────────────────────────────────────────────────
// WRITE PATHS (Wave 1 / T1.1 — keeping the existing UI unchanged)
//
// These mirror the createMission / cancelMission helpers in
// mission-store.ts but persist to Supabase. The realtime
// subscription will then push the change back to all open
// dashboards including the one that initiated it.
//
// We intentionally do NOT remove the localStorage write paths
// in mission-store.ts yet — they still serve as an offline
// scratchpad and as the source for older code (employee mobile
// flows). Once the mobile flows are also migrated, the
// localStorage layer can be retired.
// ──────────────────────────────────────────────────────────────

export interface CreateMissionInput {
  employeeId: string;
  employeeName: string;
  scheduledStart: number;
  estimatedDurationMin: number;
  origin: { name: string; lat: number; lng: number };
  destination: { name: string; lat: number; lng: number };
  vehicleType: string;
  notes: string;
  title?: string;
}

/**
 * Insert a mission row. Returns the new row id on success.
 * RLS handles tenant scoping — the caller must be a member/owner
 * of a company; the row will be tagged with that company_id via
 * the (auth.jwt() ->> 'company_id') policy.
 *
 * Note: employee_id in the DB is bigint; if the caller passes a
 * non-numeric employeeId (e.g. legacy "EMP-name") we coerce to
 * null so the insert doesn't crash. The TS Mission interface
 * already shapes employeeId as a string so this is a known gap
 * we paper over until the employees table mapping is unified.
 */
export async function createMissionInSupabase(
  input: CreateMissionInput,
  companyId: string,
): Promise<string | null> {
  const empIdNum = Number(input.employeeId);
  const employee_id = Number.isFinite(empIdNum) ? empIdNum : null;

  const { data, error } = await supabase
    .from("missions")
    .insert({
      company_id: companyId,
      employee_id,
      title: input.title ?? `${input.origin.name} → ${input.destination.name}`,
      from_location: input.origin.name,
      to_location: input.destination.name,
      vehicle: input.vehicleType,
      status: "created",
      start_time: new Date(input.scheduledStart).toISOString(),
      duration_hours: Math.round(input.estimatedDurationMin / 60),
      estimated_duration_min: input.estimatedDurationMin,
      origin_lat: input.origin.lat,
      origin_lng: input.origin.lng,
      dest_lat: input.destination.lat,
      dest_lng: input.destination.lng,
      notes: input.notes,
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[mission-supabase] createMissionInSupabase failed:", error.message);
    return null;
  }
  return (data?.id as string) ?? null;
}

/**
 * Mark a mission cancelled. RLS ensures the caller owns or is
 * a member of the mission's company.
 */
export async function cancelMissionInSupabase(missionId: string): Promise<boolean> {
  const { error } = await supabase
    .from("missions")
    .update({
      status: "cancelled",
      actual_end: new Date().toISOString(),
    })
    .eq("id", missionId);
  if (error) {
    console.warn("[mission-supabase] cancelMissionInSupabase failed:", error.message);
    return false;
  }
  return true;
}

