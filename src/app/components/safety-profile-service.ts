// ═══════════════════════════════════════════════════════════════
// SOSphere — Safety Profile Sync
// Server backup of Medical ID + Emergency Contacts (own-data RLS) so
// they survive device switch / reinstall. The on-device encrypted blob
// stays the fast path; this mirrors it to user_safety_profile.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";

async function uid(): Promise<string | null> {
  try { const { data } = await supabase.auth.getUser(); return data.user?.id ?? null; } catch { return null; }
}

export async function pullSafetyProfile(): Promise<{ medical: unknown | null; contacts: unknown[] | null } | null> {
  const id = await uid(); if (!id) return null;
  const { data, error } = await supabase.from("user_safety_profile").select("medical,contacts").eq("user_id", id).maybeSingle();
  if (error) return null;
  return { medical: (data?.medical ?? null), contacts: ((data?.contacts as unknown[]) ?? null) };
}

export async function pushMedical(medical: unknown): Promise<boolean> {
  const id = await uid(); if (!id) return false;
  const { error } = await supabase.from("user_safety_profile").upsert({ user_id: id, medical, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return !error;
}

export async function pushContacts(contacts: unknown): Promise<boolean> {
  const id = await uid(); if (!id) return false;
  const { error } = await supabase.from("user_safety_profile").upsert({ user_id: id, contacts, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return !error;
}
