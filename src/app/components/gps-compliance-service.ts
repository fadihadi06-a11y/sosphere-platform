// ═══════════════════════════════════════════════════════════════
// SOSphere — GPS Compliance Service (real data)
// Computes compliance from live gps_trail + geofences via the
// get_gps_compliance RPC, mapped to the existing ComplianceCheckResult
// shape the page already renders. Replaces the demo-driven calc.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";
import type { ComplianceCheckResult, EmployeeGPSSnapshot } from "./shared-store";

interface Row {
  employee_id: string; name: string; lat: number; lng: number;
  status: string; nearest_zone: string | null; distance_m: number | null;
  last_seen: string; minutes_since: number;
}

export async function fetchRealCompliance(): Promise<ComplianceCheckResult | null> {
  const cid = getCompanyId();
  if (!cid) return null;
  const { data, error } = await supabase.rpc("get_gps_compliance", { p_company_id: cid, p_stale_minutes: 30 });
  if (error || !data) return null;
  const rows = data as Row[];
  const mapStatus = (s: string): EmployeeGPSSnapshot["status"] =>
    s === "in_zone" ? "in-zone" : s === "out_of_zone" ? "out-of-zone" : "offline";
  const snapshots: EmployeeGPSSnapshot[] = rows.map((r) => ({
    employeeId: r.employee_id,
    employeeName: r.name,
    assignedZoneId: null,
    assignedZoneName: r.nearest_zone,
    currentLat: r.lat,
    currentLng: r.lng,
    zoneCenterLat: null,
    zoneCenterLng: null,
    zoneRadiusMeters: null,
    distanceMeters: r.distance_m != null ? Math.round(r.distance_m) : null,
    status: mapStatus(r.status),
  }));
  const inZone = snapshots.filter((s) => s.status === "in-zone").length;
  const outOfZone = snapshots.filter((s) => s.status === "out-of-zone").length;
  const offline = snapshots.filter((s) => s.status === "offline").length;
  const considered = inZone + outOfZone;
  return {
    id: `chk-${Date.now()}`,
    timestamp: Date.now(),
    totalEmployees: snapshots.length,
    inZone, outOfZone, noZone: 0, offline,
    compliancePercent: considered > 0 ? Math.round((inZone / considered) * 100) : 0,
    snapshots,
  };
}
