// ═══════════════════════════════════════════════════════════════
// SOSphere — SAR Service
// Bridges the SAR console to REAL data: finds workers whose GPS went
// quiet (possible missing) and pulls their actual gps_trail as the
// breadcrumb trail the SAR engine analyzes. (Was demo-only before.)
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";
import type { GPSBreadcrumb } from "./sar-engine";

export interface SarCandidate {
  employee_id: string;
  name: string;
  role: string;
  last_lat: number;
  last_lng: number;
  last_seen: string;
  minutes_since: number;
}

/** Company workers whose latest GPS breadcrumb is older than staleMinutes. */
export async function getSarCandidates(companyId: string, staleMinutes = 10): Promise<SarCandidate[]> {
  const { data, error } = await supabase.rpc("get_sar_candidates", {
    p_company_id: companyId,
    p_stale_minutes: staleMinutes,
  });
  if (error) return [];
  return (data as SarCandidate[]) ?? [];
}

/** A worker's real GPS trail (oldest→newest) mapped to SAR engine breadcrumbs. */
export async function fetchWorkerTrail(employeeId: string, limit = 500): Promise<GPSBreadcrumb[]> {
  const { data, error } = await supabase
    .from("gps_trail")
    .select("lat,lng,recorded_at,accuracy,speed,heading,altitude,battery,source")
    .eq("employee_id", employeeId)
    .order("recorded_at", { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => {
    const src = String(r.source ?? "");
    const source: GPSBreadcrumb["source"] =
      src === "dead_reckoning" || src === "cell_tower" || src === "wifi" ? (src as GPSBreadcrumb["source"]) : "gps";
    return {
      lat: Number(r.lat),
      lng: Number(r.lng),
      timestamp: new Date(String(r.recorded_at)).getTime(),
      accuracy: typeof r.accuracy === "number" ? r.accuracy : 0,
      speed: typeof r.speed === "number" ? r.speed : null,
      heading: typeof r.heading === "number" ? r.heading : null,
      source,
      altitude: typeof r.altitude === "number" ? r.altitude : null,
      batteryLevel: typeof r.battery === "number" ? r.battery : null,
    };
  });
}
