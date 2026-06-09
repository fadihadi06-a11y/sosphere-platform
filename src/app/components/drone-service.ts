// ═══════════════════════════════════════════════════════════════
// SOSphere — Drone Service
// Client over the drone control-plane: drones, incidents, missions,
// and live telemetry (realtime). The platform stores only light
// control data — never video. Keys generated server-side, hashed.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";

export interface Drone {
  id: string; company_id: string; name: string; zone: string | null;
  status: "offline" | "online" | "busy" | "maintenance";
  battery: number | null; last_lat: number | null; last_lng: number | null;
  last_seen_at: string | null; source: "simulator" | "mavlink"; created_at: string;
}

export interface DroneMission {
  id: string; company_id: string; incident_id: string; drone_id: string | null;
  operator_id: string | null;
  status: "pending" | "approved" | "enroute" | "onsite" | "returning" | "completed" | "aborted";
  target_lat: number; target_lng: number; stream_url: string | null; approved_at: string | null; created_at: string;
}

export interface Telemetry {
  id: number; drone_id: string; mission_id: string | null;
  lat: number; lng: number; altitude: number | null; battery: number | null;
  heading: number | null; speed: number | null;
  status: "idle" | "takeoff" | "enroute" | "onsite" | "returning" | null;
  recorded_at: string;
}

// ── drones ──
export async function listDrones(companyId: string): Promise<Drone[]> {
  const { data, error } = await supabase.from("drones").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
  if (error) return [];
  return (data as Drone[]) ?? [];
}
export async function createDrone(companyId: string, name: string, zone: string): Promise<{ ok: boolean; id?: string; agentKey?: string; error?: string }> {
  const { data, error } = await supabase.rpc("create_drone", { p_company_id: companyId, p_name: name, p_zone: zone || null });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as { ok?: boolean; id?: string; agent_key?: string };
  return { ok: !!d.ok, id: d.id, agentKey: d.agent_key };
}
export async function deleteDrone(droneId: string): Promise<boolean> {
  const { error } = await supabase.rpc("delete_drone", { p_drone_id: droneId });
  return !error;
}

// ── incidents / missions ──
export async function reportIncident(companyId: string, lat: number, lng: number, zone?: string): Promise<{ ok: boolean; missionId?: string; error?: string }> {
  const { data, error } = await supabase.rpc("report_drone_incident", { p_company_id: companyId, p_lat: lat, p_lng: lng, p_zone: zone || null });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as { ok?: boolean; mission_id?: string };
  return { ok: !!d.ok, missionId: d.mission_id };
}
export async function listActiveMissions(companyId: string): Promise<DroneMission[]> {
  const { data, error } = await supabase.from("drone_missions").select("*")
    .eq("company_id", companyId)
    .in("status", ["pending", "approved", "enroute", "onsite", "returning"])
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data as DroneMission[]) ?? [];
}
export async function approveMission(missionId: string, droneId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("approve_drone_mission", { p_mission_id: missionId, p_drone_id: droneId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── telemetry ──
export async function listTelemetry(missionId: string, limit = 200): Promise<Telemetry[]> {
  const { data, error } = await supabase.from("drone_telemetry").select("*")
    .eq("mission_id", missionId).order("recorded_at", { ascending: true }).limit(limit);
  if (error) return [];
  return (data as Telemetry[]) ?? [];
}

// ── realtime ──
export function subscribeTelemetry(missionId: string, onRow: (t: Telemetry) => void): () => void {
  const ch = supabase.channel(`tel-${missionId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "drone_telemetry", filter: `mission_id=eq.${missionId}` },
      (p: { new: Telemetry }) => onRow(p.new))
    .subscribe();
  return () => { void supabase.removeChannel(ch); };
}
export function subscribeMissions(companyId: string, onChange: () => void): () => void {
  const ch = supabase.channel(`mis-${companyId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "drone_missions", filter: `company_id=eq.${companyId}` },
      () => onChange())
    .subscribe();
  return () => { void supabase.removeChannel(ch); };
}

// ── data sovereignty (per-company) ──
export interface AccessAudit { id: string; action: string; actor_email: string | null; reason: string | null; created_at: string; }

export async function getDataAccessMode(companyId: string): Promise<"private" | "support_allowed"> {
  const { data } = await supabase.from("companies").select("data_access_mode").eq("id", companyId).maybeSingle();
  return ((data as { data_access_mode?: string } | null)?.data_access_mode === "support_allowed") ? "support_allowed" : "private";
}
export async function setDataAccessMode(companyId: string, mode: "private" | "support_allowed"): Promise<boolean> {
  const { error } = await supabase.rpc("set_company_data_access_mode", { p_company_id: companyId, p_mode: mode });
  return !error;
}
export async function listAccessAudit(companyId: string): Promise<AccessAudit[]> {
  const { data, error } = await supabase.from("access_audit_log")
    .select("id,action,actor_email,reason,created_at").eq("company_id", companyId)
    .order("created_at", { ascending: false }).limit(50);
  if (error) return [];
  return (data as AccessAudit[]) ?? [];
}
