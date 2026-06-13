// ═══════════════════════════════════════════════════════════════
// SOSphere — Pre-Shift Checklist Service
// ─────────────────────────────────────────────────────────────
// Durable pre-shift safety checklist submissions backed by
// public.checklist_submissions (company-scoped RLS, mirrors `evidence`).
//
// Worker side: submitChecklistSubmission() persists the worker's completed
// checklist as a real compliance record. Dashboard side:
// fetchChecklistSubmissions() loads real submissions for the admin view.
// No fabricated data — if there is no company / no backend, callers render an
// honest empty state.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";

export interface ChecklistSubmissionInput {
  companyId: string;
  employeeId: string;
  employeeName: string;
  templateId: string;
  templateName: string;
  completedItems: string[];
  flaggedItems: string[];
  totalItems: number;
  isComplete: boolean;
  zone?: string;
}

export interface ChecklistSubmissionRow {
  id: string;
  companyId: string;
  employeeId: string | null;
  employeeName: string;
  templateId: string;
  templateName: string | null;
  completedItems: string[];
  flaggedItems: string[];
  totalItems: number;
  isComplete: boolean;
  zone: string | null;
  submittedAt: Date;
}

/** Worker persists their pre-shift checklist. Returns {ok,id?,error?}. */
export async function submitChecklistSubmission(
  input: ChecklistSubmissionInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!input.companyId) return { ok: false, error: "no_company" };
  try {
    const { data, error } = await supabase
      .from("checklist_submissions")
      .insert({
        company_id: input.companyId,
        employee_id: input.employeeId || null,
        employee_name: input.employeeName || "Worker",
        template_id: input.templateId,
        template_name: input.templateName || null,
        completed_items: input.completedItems ?? [],
        flagged_items: input.flaggedItems ?? [],
        total_items: input.totalItems ?? 0,
        is_complete: !!input.isComplete,
        zone: input.zone || null,
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[Checklist] submit insert failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id as string };
  } catch (e) {
    console.warn("[Checklist] submit threw:", e);
    return { ok: false, error: (e as Error).message };
  }
}

/** Dashboard loads real submissions for a company (most recent first). */
export async function fetchChecklistSubmissions(
  companyId: string,
  limit = 100,
): Promise<ChecklistSubmissionRow[]> {
  if (!companyId) return [];
  try {
    const { data, error } = await supabase
      .from("checklist_submissions")
      .select("*")
      .eq("company_id", companyId)
      .order("submitted_at", { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) return [];
    return data.map((r: {
      id: string; company_id: string; employee_id: string | null; employee_name: string;
      template_id: string; template_name: string | null; completed_items: string[] | null;
      flagged_items: string[] | null; total_items: number; is_complete: boolean;
      zone: string | null; submitted_at: string;
    }): ChecklistSubmissionRow => ({
      id: String(r.id),
      companyId: r.company_id,
      employeeId: r.employee_id,
      employeeName: r.employee_name || "Worker",
      templateId: r.template_id,
      templateName: r.template_name,
      completedItems: r.completed_items ?? [],
      flaggedItems: r.flagged_items ?? [],
      totalItems: Number(r.total_items) || 0,
      isComplete: !!r.is_complete,
      zone: r.zone,
      submittedAt: new Date(r.submitted_at),
    }));
  } catch (e) {
    console.warn("[Checklist] fetch threw:", e);
    return [];
  }
}
