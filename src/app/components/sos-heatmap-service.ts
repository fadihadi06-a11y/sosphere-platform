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

// ── M4: platform-owner global SOS (sovereignty-respecting) ──
export interface GlobalSosPoint { lat: number; lng: number; weight: number; mode: "detail" | "aggregate"; company_name: string | null; }

export async function isPlatformAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_platform_admin");
  return !error && data === true;
}

export async function getGlobalSosMap(): Promise<GlobalSosPoint[]> {
  const { data, error } = await supabase.rpc("get_global_sos_map");
  if (error) return [];
  return (data as GlobalSosPoint[]) ?? [];
}
