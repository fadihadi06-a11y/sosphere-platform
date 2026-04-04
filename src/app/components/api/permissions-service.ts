import { supabase } from "./supabase-client";

// ══════════════════════════════════════════════
// Permissions Service — ربط الصلاحيات بـ Supabase
// ══════════════════════════════════════════════

/** جلب صلاحيات مستخدم */
export async function getUserPermissions(companyId: string, userId: string) {
  const { data, error } = await supabase
    .from("user_permissions")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .single();
  if (error) return null;
  return data;
}

/** جلب كل صلاحيات الشركة */
export async function getCompanyPermissions(companyId: string) {
  const { data, error } = await supabase
    .from("user_permissions")
    .select("*")
    .eq("company_id", companyId);
  if (error) return [];
  return data || [];
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
}

/** إرسال دعوة */
export async function sendInvitation(
  companyId: string,
  email: string,
  role: string,
  level: string,
  invitedBy: string
) {
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
}

/** قبول أو رفض طلب انضمام */
export async function updateInvitationStatus(
  invitationId: string,
  status: "accepted" | "rejected"
) {
  const { error } = await supabase
    .from("invitations")
    .update({ status })
    .eq("id", invitationId);
  if (error) throw new Error(error.message);
}

/** جلب الدعوات المعلقة */
export async function getPendingInvitations(companyId: string) {
  const { data, error } = await supabase
    .from("invitations")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) return [];
  return data || [];
}
