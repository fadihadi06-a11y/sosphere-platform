// ═══════════════════════════════════════════════════════════════
// SOSphere — Emergencies Service (17th pattern application)
// ─────────────────────────────────────────────────────────────
// Server-state durable emergency mutations. Replaces the pure
// Zustand in-memory mutations in dashboard-store.ts where:
//   * addEmergency / updateEmergency / takeOwnership / cancelEmergencyById
//     all wrote nowhere — tab refresh lost every admin decision.
//   * The mobile SOS path landed in sos_queue (via
//     project_sos_session_to_queue trigger on sos_sessions INSERT)
//     but admin-side updates lived only in browser memory.
//
// Architecture (matches the 16 prior pattern applications):
//   • DB = source of truth (sos_queue + 4 SECDEF RPCs).
//   • create_emergency_admin is an idempotent UPSERT on id — handles
//     the case where the mobile trigger AND the dashboard SyncEvent
//     handler both target the same id without duplicating rows.
//   • In-memory _serverEmergencies cache + bootstrap localStorage.
//   • clearEmergenciesCache() called by complete-logout.
//   • Pure helpers tested in emergencies-service-state.test.ts.
//
// Existing data-layer.fetchEmergencies / resolveEmergency / dispatchTeam
// remain — they're read + direct-update paths that work today. This
// service ADDS the missing admin-create + ownership + cancel + update
// paths and unifies them under the pattern doctrine.
// ═══════════════════════════════════════════════════════════════

import { getCompanyId } from "./shared-store";

export type EmergencyStatus = "active" | "investigating" | "responding" | "resolved" | "cancelled";
export type EmergencySeverity = "critical" | "high" | "medium" | "low";

export interface EmergencyRow {
  id:                 string;
  company_id:         string;
  employee_id:        string | null;
  employee_name:      string | null;
  zone:               string | null;
  lat:                number | null;
  lng:                number | null;
  severity:           EmergencySeverity;
  type:               string | null;
  status:             EmergencyStatus;
  recorded_at:        string;
  resolved_at:        string | null;
  owned_by:           string | null;
  owned_at:           string | null;
  manual_priority:    number | null;
  metadata:           Record<string, unknown> | null;
}

// ───────── IN-MEMORY CACHE ─────────

const EMG_CACHE_KEY = "sosphere_emergencies_cache";
let _serverEmergencies: EmergencyRow[] | null = null;

export function setCachedEmergencies(rows: EmergencyRow[]): void {
  _serverEmergencies = rows.slice();
  try {
    localStorage.setItem(EMG_CACHE_KEY, JSON.stringify(rows));
  } catch { /* unavailable */ }
}

export function getCachedEmergencies(): EmergencyRow[] {
  if (_serverEmergencies) return _serverEmergencies.slice();
  try {
    const raw = localStorage.getItem(EMG_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EmergencyRow[];
      if (Array.isArray(parsed)) {
        _serverEmergencies = parsed;
        return parsed.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function clearEmergenciesCache(): void {
  _serverEmergencies = null;
  try { localStorage.removeItem(EMG_CACHE_KEY); } catch { /* unavailable */ }
}

// ───────── PURE HELPERS (Vitest-testable) ─────────

/** Merge a freshly-fetched server row into the cache, deduping by id.
 *  Used by CDC listeners + post-RPC refresh paths. */
export function mergeEmergencyRow(rows: EmergencyRow[], incoming: EmergencyRow): EmergencyRow[] {
  const out = rows.filter(r => r.id !== incoming.id);
  out.unshift(incoming);
  return out;
}

/** Remove an emergency row from the cache (used on cancel + dedupe). */
export function dropEmergencyRow(rows: EmergencyRow[], id: string): EmergencyRow[] {
  return rows.filter(r => r.id !== id);
}

/** Compute the ordered priority list: manual_priority desc, then severity
 *  rank (critical > high > medium > low), then recorded_at asc (oldest
 *  unresolved first). Pure — used by the dashboard's emergency list. */
const SEVERITY_RANK: Record<EmergencySeverity, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};
export function orderByPriority(rows: EmergencyRow[]): EmergencyRow[] {
  return rows.slice().sort((a, b) => {
    const pa = a.manual_priority ?? -1;
    const pb = b.manual_priority ?? -1;
    if (pa !== pb) return pb - pa;
    const sa = SEVERITY_RANK[a.severity] ?? 0;
    const sb = SEVERITY_RANK[b.severity] ?? 0;
    if (sa !== sb) return sb - sa;
    return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
  });
}

// ───────── RPC WRAPPERS ─────────

export interface CreateEmergencyArgs {
  id:            string;
  type?:         string | null;
  severity?:     EmergencySeverity;
  employeeId?:   string | null;
  employeeName?: string | null;
  zone?:         string | null;
  lat?:          number | null;
  lng?:          number | null;
  metadata?:     Record<string, unknown>;
}

/** Idempotent admin-side create. UPSERTs on id so a worker-triggered
 *  SOS landing via the DB projection trigger + an admin SyncEvent
 *  handler firing this RPC don't duplicate the row. Returns the id
 *  on success, null on failure. */
export async function createEmergency(args: CreateEmergencyArgs): Promise<string | null> {
  try {
    const companyId = getCompanyId();
    if (!companyId) return null;
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("create_emergency_admin", {
      p_company_id:    companyId,
      p_id:            args.id,
      p_type:          args.type ?? null,
      p_severity:      args.severity ?? "high",
      p_employee_id:   args.employeeId ?? null,
      p_employee_name: args.employeeName ?? null,
      p_zone:          args.zone ?? null,
      p_lat:           args.lat ?? null,
      p_lng:           args.lng ?? null,
      p_metadata:      args.metadata ?? {},
    });
    if (error || !data) {
      console.warn("[emg-service] create failed:", error?.message);
      return null;
    }
    return String(data);
  } catch (err) {
    console.warn("[emg-service] create threw:", err);
    return null;
  }
}

export async function takeEmergencyOwnership(id: string, adminName: string): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.rpc("take_emergency_ownership", {
      p_id: id, p_admin_name: adminName,
    });
    if (error) {
      console.warn("[emg-service] take ownership failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[emg-service] take ownership threw:", err);
    return false;
  }
}

export async function cancelEmergency(id: string, reason?: string): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.rpc("cancel_emergency", {
      p_id: id, p_reason: reason ?? null,
    });
    if (error) {
      console.warn("[emg-service] cancel failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[emg-service] cancel threw:", err);
    return false;
  }
}

export interface UpdateEmergencyArgs {
  id:              string;
  type?:           string | null;
  severity?:       EmergencySeverity | null;
  zone?:           string | null;
  notes?:          string | null;
  manualPriority?: number | null;
  metadataMerge?:  Record<string, unknown> | null;
}

export async function updateEmergencyRpc(args: UpdateEmergencyArgs): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.rpc("update_emergency", {
      p_id:              args.id,
      p_type:            args.type ?? null,
      p_severity:        args.severity ?? null,
      p_zone:            args.zone ?? null,
      p_notes:           args.notes ?? null,
      p_manual_priority: args.manualPriority ?? null,
      p_metadata_merge:  args.metadataMerge ?? null,
    });
    if (error) {
      console.warn("[emg-service] update failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[emg-service] update threw:", err);
    return false;
  }
}
