// ═══════════════════════════════════════════════════════════════
// SOSphere — SOS Heatmap Service
// Company SOS press locations for the dashboard map heat layer.
// sos_queue is service-role-only; points come via a member-gated RPC.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";

export interface SosPoint { lat: number; lng: number; status: string; recorded_at: string | null; }

export async function getCompanySosPoints(companyId: string, limit = 1000): Promise<SosPoint[]> {
  const { data, error } = await supabase.rpc("get_company_sos_points", { p_company_id: companyId, p_limit: limit });
  if (error) return [];
  return (data as SosPoint[]) ?? [];
}
