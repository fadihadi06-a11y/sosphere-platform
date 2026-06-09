// ═══════════════════════════════════════════════════════════════
// SOSphere — Drone Service
// Client over the drone control-plane: register/list/retire drones.
// Registration generates the agent key server-side (returned ONCE);
// only a SHA-256 hash is stored. Listing is RLS-protected member read.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";

export interface Drone {
  id: string;
  company_id: string;
  name: string;
  zone: string | null;
  status: "offline" | "online" | "busy" | "maintenance";
  battery: number | null;
  last_lat: number | null;
  last_lng: number | null;
  last_seen_at: string | null;
  source: "simulator" | "mavlink";
  created_at: string;
}

export async function listDrones(companyId: string): Promise<Drone[]> {
  const { data, error } = await supabase
    .from("drones")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data as Drone[]) ?? [];
}

export async function createDrone(
  companyId: string,
  name: string,
  zone: string,
): Promise<{ ok: boolean; id?: string; agentKey?: string; error?: string }> {
  const { data, error } = await supabase.rpc("create_drone", {
    p_company_id: companyId,
    p_name: name,
    p_zone: zone || null,
  });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as { ok?: boolean; id?: string; agent_key?: string };
  return { ok: !!d.ok, id: d.id, agentKey: d.agent_key };
}

export async function deleteDrone(droneId: string): Promise<boolean> {
  const { error } = await supabase.rpc("delete_drone", { p_drone_id: droneId });
  return !error;
}
