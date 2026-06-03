// ═══════════════════════════════════════════════════════════════
// SOSphere — Investigations Service (P3-#11c)
// ─────────────────────────────────────────────────────────────
// Data-access layer for the Incident Investigation & CAPA page.
// Keeps the Investigation type opaque to the DB layer: nested
// structures (root_causes, actions, timeline, affected_workers)
// round-trip through jsonb columns so the page keeps its shape.
//
// Safety rules (same as risk-register-service):
//   • Fetches return [] on any failure — caller decides fallback.
//   • Upserts log + return a boolean instead of throwing, so UI
//     button handlers stay snappy and never crash.
//   • Date fields serialize to ISO on the way out and get re-hydrated
//     into Date objects on the way back in.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";

// Re-declare the shapes the page uses. Keeping them local (instead of
// importing from the page) avoids circular dependencies — the page
// imports this service.

type InvestigationStatus = "open" | "investigating" | "pending_capa" | "capa_in_progress" | "closed" | "overdue";
type Severity = "critical" | "high" | "medium" | "low";
type CAPAStatus = "planned" | "in_progress" | "completed" | "overdue" | "verified";

interface RootCause {
  id: string;
  category: "human" | "equipment" | "process" | "environment" | "management";
  description: string;
  contributing: boolean;
  evidence: string[];
}

interface CorrectiveAction {
  id: string;
  type: "corrective" | "preventive";
  description: string;
  assignedTo: string;
  dueDate: Date;
  status: CAPAStatus;
  completedDate?: Date;
  verifiedBy?: string;
  notes: string;
  priority: "high" | "medium" | "low";
}

export interface Investigation {
  id: string;
  incidentId: string;
  title: string;
  description: string;
  severity: Severity;
  zone: string;
  incidentDate: Date;
  reportedBy: string;
  investigator: string;
  status: InvestigationStatus;
  rootCauses: RootCause[];
  actions: CorrectiveAction[];
  timeline: { date: Date; event: string; by: string }[];
  affectedWorkers: string[];
  isoReference: string;
  finalReportDate?: Date;
  source?: string;
}

// ── (De)serialization ─────────────────────────────────────────

/** Serialize a CorrectiveAction for jsonb — Dates become ISO strings. */
function serializeAction(a: CorrectiveAction): Record<string, any> {
  return {
    ...a,
    dueDate: a.dueDate.toISOString(),
    completedDate: a.completedDate ? a.completedDate.toISOString() : undefined,
  };
}

/** Reverse of serializeAction. Defensive against partially-populated rows. */
function hydrateAction(raw: any): CorrectiveAction {
  return {
    id: raw.id,
    type: raw.type,
    description: raw.description ?? "",
    assignedTo: raw.assignedTo ?? "",
    dueDate: raw.dueDate ? new Date(raw.dueDate) : new Date(),
    status: raw.status ?? "planned",
    completedDate: raw.completedDate ? new Date(raw.completedDate) : undefined,
    verifiedBy: raw.verifiedBy,
    notes: raw.notes ?? "",
    priority: raw.priority ?? "medium",
  };
}

function serializeTimeline(t: { date: Date; event: string; by: string }): Record<string, any> {
  return { date: t.date.toISOString(), event: t.event, by: t.by };
}

function hydrateTimeline(raw: any): { date: Date; event: string; by: string } {
  return {
    date: raw.date ? new Date(raw.date) : new Date(),
    event: raw.event ?? "",
    by: raw.by ?? "",
  };
}

function rowToInvestigation(row: any): Investigation {
  return {
    id: row.id,
    incidentId: row.incident_id ?? "",
    title: row.title,
    description: row.description ?? "",
    severity: row.severity as Severity,
    zone: row.zone ?? "",
    incidentDate: row.incident_date ? new Date(row.incident_date) : new Date(),
    reportedBy: row.reported_by ?? "",
    investigator: row.investigator ?? "",
    status: row.status as InvestigationStatus,
    rootCauses: Array.isArray(row.root_causes) ? row.root_causes : [],
    actions: Array.isArray(row.actions) ? row.actions.map(hydrateAction) : [],
    timeline: Array.isArray(row.timeline) ? row.timeline.map(hydrateTimeline) : [],
    affectedWorkers: Array.isArray(row.affected_workers) ? row.affected_workers : [],
    isoReference: row.iso_reference ?? "",
    finalReportDate: row.final_report_date ? new Date(row.final_report_date) : undefined,
    source: row.source ?? undefined,
  };
}

function investigationToRow(inv: Investigation, companyId: string): Record<string, any> {
  return {
    id: inv.id,
    company_id: companyId,
    incident_id: inv.incidentId || null,
    title: inv.title,
    description: inv.description,
    severity: inv.severity,
    zone: inv.zone,
    incident_date: inv.incidentDate.toISOString(),
    reported_by: inv.reportedBy,
    investigator: inv.investigator,
    status: inv.status,
    root_causes: inv.rootCauses,
    actions: inv.actions.map(serializeAction),
    timeline: inv.timeline.map(serializeTimeline),
    affected_workers: inv.affectedWorkers,
    iso_reference: inv.isoReference,
    final_report_date: inv.finalReportDate ? inv.finalReportDate.toISOString() : null,
    source: inv.source ?? null,
  };
}

// ── Public API ────────────────────────────────────────────────

// ───────── IN-MEMORY CACHE (13th pattern app, 2026-06-03) ─────────
// Replaces the localStorage bootstrap that lived in
// dashboard-incident-investigation.tsx (CRIT-#4 cross-tenant leak class:
// the page used `localStorage.getItem("sosphere_investigations")` as
// its initial state, so a tenant switch on a shared device showed the
// previous tenant's investigations until the server reconciliation
// completed). The cache key is moved here under sosphere_investigations_cache
// (separate from the legacy key) and is cleared by completeLogout.

const INVESTIGATIONS_CACHE_KEY = "sosphere_investigations_cache";
const LEGACY_KEY = "sosphere_investigations";
let _serverInvestigations: Investigation[] | null = null;

function serializeInvestigation(inv: Investigation): Record<string, unknown> {
  return {
    ...inv,
    incidentDate: inv.incidentDate instanceof Date ? inv.incidentDate.toISOString() : inv.incidentDate,
    finalReportDate: inv.finalReportDate instanceof Date ? inv.finalReportDate.toISOString() : inv.finalReportDate,
    timeline: inv.timeline.map(t => ({ ...t, date: t.date instanceof Date ? t.date.toISOString() : t.date })),
    actions: inv.actions.map(a => ({
      ...a,
      dueDate: a.dueDate instanceof Date ? a.dueDate.toISOString() : a.dueDate,
      completedDate: a.completedDate instanceof Date ? a.completedDate.toISOString() : a.completedDate,
    })),
  };
}
function rehydrateInvestigation(raw: Record<string, unknown>): Investigation {
  const i = raw as unknown as Investigation;
  return {
    ...i,
    incidentDate: new Date(i.incidentDate as unknown as string),
    finalReportDate: i.finalReportDate ? new Date(i.finalReportDate as unknown as string) : undefined,
    timeline: i.timeline.map(t => ({ ...t, date: new Date(t.date as unknown as string) })),
    actions: i.actions.map(a => ({
      ...a,
      dueDate: new Date(a.dueDate as unknown as string),
      completedDate: a.completedDate ? new Date(a.completedDate as unknown as string) : undefined,
    })),
  };
}

export function setCachedInvestigations(rows: Investigation[]): void {
  _serverInvestigations = rows.slice();
  try {
    localStorage.setItem(INVESTIGATIONS_CACHE_KEY, JSON.stringify(rows.map(serializeInvestigation)));
  } catch { /* unavailable */ }
}

export function getCachedInvestigations(): Investigation[] {
  if (_serverInvestigations) return _serverInvestigations.slice();
  try {
    // One-shot legacy migration: kill the unscoped sosphere_investigations
    // key (CRIT-#4 cross-tenant leak class). removeItem is idempotent.
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(INVESTIGATIONS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
      if (Array.isArray(parsed)) {
        const rehydrated = parsed.map(rehydrateInvestigation);
        _serverInvestigations = rehydrated;
        return rehydrated.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function clearInvestigationsCache(): void {
  _serverInvestigations = null;
  try {
    localStorage.removeItem(INVESTIGATIONS_CACHE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* unavailable */ }
}

/** Fetch all investigations for the current company, newest first. */
export async function fetchInvestigations(): Promise<Investigation[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { data, error } = await supabase
      .from("investigations")
      .select("*")
      .eq("company_id", companyId)
      .order("incident_date", { ascending: false });
    if (error || !data) return [];
    const rows = data.map(rowToInvestigation);
    // 2026-06-03 13th pattern app: populate the bootstrap cache so the
    // page can paint instantly on next mount instead of re-fetching.
    setCachedInvestigations(rows);
    return rows;
  } catch (err) {
    console.warn("[investigations-service] fetch:", err);
    return [];
  }
}

export async function upsertInvestigation(inv: Investigation): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { error } = await supabase
      .from("investigations")
      .upsert(investigationToRow(inv, companyId), { onConflict: "id" });
    if (error) {
      console.warn("[investigations-service] upsert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[investigations-service] upsert exception:", err);
    return false;
  }
}

export async function upsertInvestigationBatch(investigations: Investigation[]): Promise<number> {
  if (investigations.length === 0) return 0;
  const companyId = getCompanyId();
  if (!companyId) return 0;
  try {
    const rows = investigations.map((i) => investigationToRow(i, companyId));
    const { error } = await supabase
      .from("investigations")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("[investigations-service] batch upsert failed:", error.message);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.warn("[investigations-service] batch upsert exception:", err);
    return 0;
  }
}
