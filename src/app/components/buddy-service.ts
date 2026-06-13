// ═══════════════════════════════════════════════════════════════
// SOSphere — Buddy Service
// ─────────────────────────────────────────────────────────────
// Durable buddy-system pairings backed by public.buddy_pairs (company-scoped
// RLS: members read; owner/admin write). Previously pairs lived only in the
// admin's browser localStorage — so they were lost on cache clear and never
// synced across admins/devices. Buddy pairing is life-safety: when a worker
// triggers SOS the buddy is the closest responder, so the pairing MUST persist.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";

export interface BuddyPairRow {
  id: string;
  employeeAId: string;
  employeeAName: string;
  employeeBId: string;
  employeeBName: string;
  isActive: boolean;
  createdAt?: Date;
}

export async function fetchBuddyPairs(): Promise<BuddyPairRow[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { data, error } = await supabase
      .from("buddy_pairs").select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as any[]).map(r => ({
      id: r.id,
      employeeAId: r.employee_a_id,
      employeeAName: r.employee_a_name ?? "",
      employeeBId: r.employee_b_id,
      employeeBName: r.employee_b_name ?? "",
      isActive: !!r.is_active,
      createdAt: r.created_at ? new Date(r.created_at) : undefined,
    }));
  } catch { return []; }
}

export async function saveBuddyPair(args: {
  employeeAId: string; employeeAName: string;
  employeeBId: string; employeeBName: string;
  isActive?: boolean;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const companyId = getCompanyId();
  if (!companyId) return { ok: false, error: "no_company" };
  try {
    const { data, error } = await supabase.from("buddy_pairs").insert({
      company_id: companyId,
      employee_a_id: args.employeeAId, employee_a_name: args.employeeAName,
      employee_b_id: args.employeeBId, employee_b_name: args.employeeBName,
      is_active: args.isActive ?? true,
    }).select("id").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: (data as any)?.id };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function setBuddyActive(id: string, isActive: boolean): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { error } = await supabase.from("buddy_pairs").update({ is_active: isActive }).eq("id", id).eq("company_id", companyId);
    return !error;
  } catch { return false; }
}

export async function deleteBuddyPair(id: string): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { error } = await supabase.from("buddy_pairs").delete().eq("id", id).eq("company_id", companyId);
    return !error;
  } catch { return false; }
}
