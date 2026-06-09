// ═══════════════════════════════════════════════════════════════
// SOSphere — Family Live Location Service
// Opt-in, family-scoped location sharing (RLS: only same-family members
// can read; you write only your own row). Realtime updates.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";

export interface FamilyMemberLoc {
  user_id: string; name: string;
  lat: number | null; lng: number | null; accuracy: number | null;
  sharing: boolean; updated_at: string;
}

export async function getFamilyLocations(): Promise<FamilyMemberLoc[]> {
  const { data, error } = await supabase.rpc("get_family_locations");
  if (error) return [];
  return (data as FamilyMemberLoc[]) ?? [];
}

export async function upsertFamilyLocation(lat: number, lng: number, accuracy: number | null, sharing: boolean): Promise<boolean> {
  const { error } = await supabase.rpc("upsert_family_location", { p_lat: lat, p_lng: lng, p_accuracy: accuracy, p_sharing: sharing });
  return !error;
}

export function subscribeFamilyLocations(onChange: () => void): () => void {
  const ch = supabase.channel("family-loc")
    .on("postgres_changes", { event: "*", schema: "public", table: "family_locations" }, () => onChange())
    .subscribe();
  return () => { void supabase.removeChannel(ch); };
}
