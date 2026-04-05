import { supabase, SUPABASE_CONFIG } from "./supabase-client";

// ══════════════════════════════════════════════
// Permissions Service — ربط الصلاحيات بـ Supabase
// ══════════════════════════════════════════════

/** جلب صلاحيات مستخدم */
export async function getUserPermissions(companyId: string, userId: string) {
  if (!SUPABASE_CONFIG.isConfigured) return null;
  try {
    const { data, error } = await supabase
      .from("user_permissions")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .single();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

/** جلب كل صلاحيات الشركة */
export async function getCompanyPermissions(companyId: string) {
  if (!SUPABASE_CONFIG.isConfigured) return [];
  try {
    const { data, error } = await supabase
      .from("user_permissions")
      .select("*")
      .eq("company_id", companyId);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/** حفظ صلاحيات مستخدم */
export async function saveUserPermissions(
  companyId: string,
  userId: string,
  permissions: string[],
  level: string,
  role: string,
  assignedZones: string[],
  updatedBy: string
) {
  if (!SUPABASE_CONFIG.isConfigured) return null;
  try {
    const { data, error } = await supabase
      .from("user_permissions")
      .upsert({
        company_id: companyId,
        user_id: userId,
        permissions,
        level,
        role,
        assigned_zones: assignedZones,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,user_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  } catch (e) {
    console.warn("[Permissions] Save failed:", e);
    return null;
  }
}

/** إرسال دعوة */
export async function sendInvitation(
  companyId: string,
  email: string,
  role: string,
  level: string,
  invitedBy: string
) {
  if (!SUPABASE_CONFIG.isConfigured) return null;
  try {
    const { data, error } = await supabase
      .from("invitations")
      .insert({
        company_id: companyId,
        email,
        role,
        level,
        invited_by: invitedBy,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  } catch (e) {
    console.warn("[Permissions] Invitation failed:", e);
    return null;
  }
}

/** قبول أو رفض طلب انضمام */
export async function updateInvitationStatus(
  invitationId: string,
  status: "accepted" | "rejected"
) {
  if (!SUPABASE_CONFIG.isConfigured) return;
  try {
    const { error } = await supabase
      .from("invitations")
      .update({ status })
      .eq("id", invitationId);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[Permissions] Status update failed:", e);
  }
}

/** جلب الدعوات المعلقة */
export async function getPendingInvitations(companyId: string) {
  if (!SUPABASE_CONFIG.isConfigured) return [];
  try {
    const { data, error } = await supabase
      .from("invitations")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}
