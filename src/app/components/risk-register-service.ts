// ═══════════════════════════════════════════════════════════════
// SOSphere — Risk Register Service (P3-#11b)
// ─────────────────────────────────────────────────────────────
// Thin data-access layer on top of the `risk_register` and
// `training_records` Supabase tables. Everything the page needs to
// read or mutate lives here so the component stays focused on UI.
//
// Design notes:
//   • All fetches are safe-by-default: if the user isn't bound to a
//     company yet, or the table doesn't exist (pre-migration dev
//     environments), we resolve to an empty array instead of throwing.
//     The page already has a localStorage + MOCK fallback, so an empty
//     fetch result simply means "no server data, use what you have".
//   • Upserts are fire-and-forget from the UI side — they log a
//     warning on failure but never block the user. Compliance of this
//     data is important, but losing a single control-status edit is
//     not an emergency; the user can retry.
//   • `status` for training records is computed from `expiry_date`,
//     not stored, so we never serialize it. The server is the source
//     of dates; the client derives "expiring_soon" / "expired".
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";
import { logAuditEvent } from "./audit-log-store";

// Mirror the types used by dashboard-risk-register.tsx. Importing from
// the page would create a circular dep, so we redeclare them here.
type RiskLevel = "extreme" | "high" | "medium" | "low" | "negligible";
type Likelihood = 1 | 2 | 3 | 4 | 5;
type Consequence = 1 | 2 | 3 | 4 | 5;
type ControlStatus = "effective" | "partially_effective" | "ineffective" | "not_implemented";

export interface RiskEntry {
  id: string;
  zone: string;
  hazard: string;
  description: string;
  category: "physical" | "chemical" | "biological" | "ergonomic" | "psychosocial" | "environmental";
  likelihood: Likelihood;
  consequence: Consequence;
  riskScore: number;
  riskLevel: RiskLevel;
  existingControls: string[];
  controlStatus: ControlStatus;
  preventiveMeasures: string[];
  responsiblePerson: string;
  reviewDate: Date;
  lastReviewedBy: string;
  isoReference: string;
}

export interface TrainingRecord {
  id: string;
  employeeName: string;
  certification: string;
  issueDate: Date;
  expiryDate: Date;
  status: "valid" | "expiring_soon" | "expired";
  provider: string;
  zone: string;
}

// ── Risk Register ───────────────────────────────────────────────

function rowToRisk(row: any): RiskEntry {
  return {
    id: row.id,
    zone: row.zone,
    hazard: row.hazard,
    description: row.description ?? "",
    category: row.category,
    likelihood: row.likelihood as Likelihood,
    consequence: row.consequence as Consequence,
    riskScore: row.risk_score,
    riskLevel: row.risk_level as RiskLevel,
    existingControls: Array.isArray(row.existing_controls) ? row.existing_controls : [],
    controlStatus: row.control_status as ControlStatus,
    preventiveMeasures: Array.isArray(row.preventive_measures) ? row.preventive_measures : [],
    responsiblePerson: row.responsible_person ?? "",
    reviewDate: row.review_date ? new Date(row.review_date) : new Date(),
    lastReviewedBy: row.last_reviewed_by ?? "",
    isoReference: row.iso_reference ?? "",
  };
}

function riskToRow(r: RiskEntry, companyId: string): Record<string, any> {
  return {
    id: r.id,
    company_id: companyId,
    zone: r.zone,
    hazard: r.hazard,
    description: r.description,
    category: r.category,
    likelihood: r.likelihood,
    consequence: r.consequence,
    risk_score: r.riskScore,
    risk_level: r.riskLevel,
    existing_controls: r.existingControls,
    control_status: r.controlStatus,
    preventive_measures: r.preventiveMeasures,
    responsible_person: r.responsiblePerson,
    last_reviewed_by: r.lastReviewedBy,
    review_date: r.reviewDate.toISOString(),
    iso_reference: r.isoReference,
  };
}

/**
 * Fetch the company's risk register. Returns [] if no company context,
 * no rows, or on error — the caller decides whether to fall back to
 * a local cache or demo data.
 */
// ───────── IN-MEMORY CACHE (14th pattern app, 2026-06-03) ─────────
// Replaces the localStorage bootstrap that lived in
// dashboard-risk-register.tsx (CRIT-#4 cross-tenant leak class — same
// bug as investigations #4, fixed in commit 6b55c79). The legacy
// `sosphere_risks` key is killed inside getCachedRisks as a one-shot
// migration; the new cache lives under `sosphere_risks_cache`.

const RISKS_CACHE_KEY = "sosphere_risks_cache";
const LEGACY_RISKS_KEY = "sosphere_risks";
let _serverRisks: RiskEntry[] | null = null;

function serializeRisk(r: RiskEntry): Record<string, unknown> {
  return { ...r, reviewDate: r.reviewDate instanceof Date ? r.reviewDate.toISOString() : r.reviewDate };
}
function rehydrateRisk(raw: Record<string, unknown>): RiskEntry {
  const r = raw as unknown as RiskEntry;
  return { ...r, reviewDate: new Date(r.reviewDate as unknown as string) };
}

export function setCachedRisks(rows: RiskEntry[]): void {
  _serverRisks = rows.slice();
  try {
    localStorage.setItem(RISKS_CACHE_KEY, JSON.stringify(rows.map(serializeRisk)));
  } catch { /* unavailable */ }
}

export function getCachedRisks(): RiskEntry[] {
  if (_serverRisks) return _serverRisks.slice();
  try {
    // One-shot legacy migration: kill the unscoped `sosphere_risks`
    // key (CRIT-#4 cross-tenant leak class). removeItem is idempotent.
    localStorage.removeItem(LEGACY_RISKS_KEY);
    const raw = localStorage.getItem(RISKS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
      if (Array.isArray(parsed)) {
        const rehydrated = parsed.map(rehydrateRisk);
        _serverRisks = rehydrated;
        return rehydrated.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function clearRisksCache(): void {
  _serverRisks = null;
  try {
    localStorage.removeItem(RISKS_CACHE_KEY);
    localStorage.removeItem(LEGACY_RISKS_KEY);
  } catch { /* unavailable */ }
}

export async function fetchRiskRegister(): Promise<RiskEntry[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { data, error } = await supabase
      .from("risk_register")
      .select("*")
      .eq("company_id", companyId)
      .order("risk_score", { ascending: false });
    if (error || !data) return [];
    const rows = data.map(rowToRisk);
    setCachedRisks(rows);
    return rows;
  } catch (err) {
    console.warn("[risk-service] fetchRiskRegister:", err);
    return [];
  }
}

/** Fire-and-forget upsert for a single risk row. */
export async function upsertRisk(risk: RiskEntry): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { error } = await supabase
      .from("risk_register")
      .upsert(riskToRow(risk, companyId), { onConflict: "id" });
    if (error) {
      console.warn("[risk-service] upsertRisk failed:", error.message);
      return false;
    }
    // fresh-audit #5: risk-register edits feed compliance reports +
    // ISO 31000 risk treatment plans. Logged at warning severity for
    // critical/high risks so they surface in the audit feed; info for
    // medium/low changes.
    try {
      logAuditEvent("data_modify", "risk_upserted", {
        detail: `${risk.hazard} in ${risk.zone} (${risk.riskLevel})`,
        targetId: risk.id,
        targetName: risk.hazard,
        severity: risk.riskLevel === "extreme" || risk.riskLevel === "high"
          ? "warning" : "info",
      });
    } catch { /* audit best-effort */ }
    return true;
  } catch (err) {
    console.warn("[risk-service] upsertRisk exception:", err);
    return false;
  }
}

/** Bulk upsert — used when seeding from a CSV or syncing a localStorage cache. */
export async function upsertRiskBatch(risks: RiskEntry[]): Promise<number> {
  if (risks.length === 0) return 0;
  const companyId = getCompanyId();
  if (!companyId) return 0;
  try {
    const rows = risks.map((r) => riskToRow(r, companyId));
    const { error } = await supabase
      .from("risk_register")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("[risk-service] upsertRiskBatch failed:", error.message);
      return 0;
    }
    try {
      logAuditEvent("data_modify", "risks_batch_upserted", {
        detail: `${rows.length} risk entries upserted (batch)`,
        severity: "info",
      });
    } catch { /* audit best-effort */ }
    return rows.length;
  } catch (err) {
    console.warn("[risk-service] upsertRiskBatch exception:", err);
    return 0;
  }
}

// ── Training Records ────────────────────────────────────────────

const EXPIRING_SOON_DAYS = 30;

/**
 * Derive training status from the expiry date. Kept in one place so
 * the page and exports agree on "what counts as expiring soon".
 */
export function computeTrainingStatus(expiryDate: Date): TrainingRecord["status"] {
  const now = Date.now();
  const diffDays = (expiryDate.getTime() - now) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return "expired";
  if (diffDays <= EXPIRING_SOON_DAYS) return "expiring_soon";
  return "valid";
}

function rowToTraining(row: any): TrainingRecord {
  const expiryDate = row.expiry_date ? new Date(row.expiry_date) : new Date();
  return {
    id: row.id,
    employeeName: row.employee_name,
    certification: row.certification,
    issueDate: row.issue_date ? new Date(row.issue_date) : new Date(),
    expiryDate,
    status: computeTrainingStatus(expiryDate),
    provider: row.provider ?? "",
    zone: row.zone ?? "",
  };
}

function trainingToRow(t: TrainingRecord, companyId: string): Record<string, any> {
  return {
    id: t.id,
    company_id: companyId,
    employee_name: t.employeeName,
    certification: t.certification,
    provider: t.provider,
    zone: t.zone,
    issue_date: t.issueDate.toISOString(),
    expiry_date: t.expiryDate.toISOString(),
    // status is derived — never serialized.
  };
}

export async function fetchTrainingRecords(): Promise<TrainingRecord[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { data, error } = await supabase
      .from("training_records")
      .select("*")
      .eq("company_id", companyId)
      .order("expiry_date", { ascending: true });
    if (error || !data) return [];
    return data.map(rowToTraining);
  } catch (err) {
    console.warn("[risk-service] fetchTrainingRecords:", err);
    return [];
  }
}

export async function upsertTrainingRecord(record: TrainingRecord): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { error } = await supabase
      .from("training_records")
      .upsert(trainingToRow(record, companyId), { onConflict: "id" });
    if (error) {
      console.warn("[risk-service] upsertTrainingRecord failed:", error.message);
      return false;
    }
    // fresh-audit #5: training records gate worker zone access.
    // A missing cert audit trail is an ISO 45001 §7.2 finding.
    try {
      logAuditEvent("data_modify", "training_record_upserted", {
        detail: `${record.certification} for ${record.employeeName} (expires ${record.expiryDate.toISOString().slice(0,10)})`,
        targetId: record.id,
        targetName: record.employeeName,
        severity: record.status === "expired" ? "warning" : "info",
      });
    } catch { /* audit best-effort */ }
    return true;
  } catch (err) {
    console.warn("[risk-service] upsertTrainingRecord exception:", err);
    return false;
  }
}
