// ═══════════════════════════════════════════════════════════════
// SOSphere — Generated Reports Service (22nd pattern application)
// ─────────────────────────────────────────────────────────────
// Closes the C-4 follow-up. RECENT_REPORTS in compliance-reports.tsx
// previously rendered 5 hardcoded fixture rows under the user's real
// company name — false-document liability. The earlier cleanup
// commit emptied the array as a stopgap; this service is the proper
// fix: every PDF generation persists a row to generated_reports,
// and the dashboard reads them back via get_generated_reports.
//
// Architecture (matches the 21 prior pattern applications):
//   • DB = source of truth (generated_reports + 2 SECDEF RPCs).
//   • In-memory cache + bootstrap localStorage.
//   • clearGeneratedReportsCache() called by complete-logout.
// ═══════════════════════════════════════════════════════════════

import { getCompanyId } from "./shared-store";

export type ReportType = "incident" | "monthly" | "quarterly" | "audit" | "custom" | "performance";
export type ReportFormat = "detailed" | "executive" | "legal";

export interface GeneratedReportRow {
  id:              string;
  title:           string;
  type:            ReportType;
  period:          string | null;
  sections:        string[];
  page_count:      number | null;
  size_bytes:      number | null;
  filename:        string | null;
  verification_id: string | null;
  format:          ReportFormat;
  was_encrypted:   boolean;
  auto_scheduled:  boolean;
  generated_at:    string;
}

// ───────── IN-MEMORY CACHE ─────────

const REPORTS_CACHE_KEY = "sosphere_generated_reports_cache";
let _serverReports: GeneratedReportRow[] | null = null;

export function setCachedGeneratedReports(rows: GeneratedReportRow[]): void {
  _serverReports = rows.slice();
  try {
    localStorage.setItem(REPORTS_CACHE_KEY, JSON.stringify(rows));
  } catch { /* unavailable */ }
}

export function getCachedGeneratedReports(): GeneratedReportRow[] {
  if (_serverReports) return _serverReports.slice();
  try {
    const raw = localStorage.getItem(REPORTS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GeneratedReportRow[];
      if (Array.isArray(parsed)) {
        _serverReports = parsed;
        return parsed.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function clearGeneratedReportsCache(): void {
  _serverReports = null;
  try { localStorage.removeItem(REPORTS_CACHE_KEY); } catch { /* unavailable */ }
}

// ───────── PURE HELPERS ─────────

/** Compute a human-friendly size string from a byte count. Pure. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const mb = bytes / 1_048_576;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${Math.max(1, Math.round(kb))} KB`;
}

// ───────── RPC WRAPPERS ─────────

/** Persist a freshly-generated report. Fire-and-forget — caller
 *  should not await. Returns null on failure (the PDF was still
 *  saved locally; only the audit trail row failed). */
export async function recordGeneratedReport(args: {
  id:              string;
  title:           string;
  type:            ReportType;
  period?:         string | null;
  sections?:       string[];
  pageCount?:      number | null;
  sizeBytes?:      number | null;
  filename?:       string | null;
  verificationId?: string | null;
  format?:         ReportFormat;
  wasEncrypted?:   boolean;
  autoScheduled?:  boolean;
}): Promise<string | null> {
  const companyId = getCompanyId();
  if (!companyId) return null;
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("record_generated_report", {
      p_company_id:      companyId,
      p_id:              args.id,
      p_title:           args.title,
      p_type:            args.type,
      p_period:          args.period ?? null,
      p_sections:        args.sections ?? [],
      p_page_count:      args.pageCount ?? null,
      p_size_bytes:      args.sizeBytes ?? null,
      p_filename:        args.filename ?? null,
      p_verification_id: args.verificationId ?? null,
      p_format:          args.format ?? "detailed",
      p_was_encrypted:   args.wasEncrypted ?? false,
      p_auto_scheduled:  args.autoScheduled ?? false,
    });
    if (error) {
      console.warn("[generated-reports] record failed:", error.message);
      return null;
    }
    return typeof data === "string" ? data : null;
  } catch (err) {
    console.warn("[generated-reports] record threw:", err);
    return null;
  }
}

export async function loadGeneratedReports(limit: number = 50): Promise<GeneratedReportRow[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_generated_reports", {
      p_company_id: companyId,
      p_limit:      limit,
    });
    if (error || !Array.isArray(data)) return [];
    const rows = data as GeneratedReportRow[];
    setCachedGeneratedReports(rows);
    return rows;
  } catch (err) {
    console.warn("[generated-reports] load threw:", err);
    return [];
  }
}
