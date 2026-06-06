// ═══════════════════════════════════════════════════════════════
// SOSphere — evacuation-service (10th pattern application)
// ─────────────────────────────────────────────────────────────
// Server-state durable evacuations. Replaces a localStorage-only
// implementation where every artefact (ActiveEvacuation,
// EmployeeEvacuationStatus, EvacuationPoint) lived on the admin's
// browser tab — tab close = data gone. Workers who came online AFTER
// the broadcast missed the evacuation forever.
//
// Architecture (10th application of the established pattern):
//   • DB = source of truth (evacuations + evacuation_acks tables)
//   • 4 SECDEF RPCs gate all writes:
//     start_evacuation (admin only), ack_evacuation (worker),
//     end_evacuation (admin), get_active_evacuations (admin reader)
//   • In-memory _activeEvacuations + bootstrap cache
//   • clearEvacuationCache() called by complete-logout
//   • Pure helpers (Vitest-testable): classifyAckProgress,
//      formatTriggeredAge
//
// This file contains:
//   1. Types + pure helpers
//   2. RPC wrappers
//   3. In-memory cache
// ═══════════════════════════════════════════════════════════════

export type EvacuationStatus = "active" | "completed" | "cancelled";
export type AckPhase = "acknowledged" | "evacuating" | "arrived";

export interface ActiveEvacuation {
  id:                  string;
  zone_id:             string | null;
  zone_name:           string | null;
  reason:              string | null;
  triggered_by:        string | null;
  assembly_point_id:   string | null;
  assembly_point_name: string | null;
  triggered_at:        string;
  ack_count:           number;
  arrived_count:       number;
}

// ───────── PURE HELPERS ─────────

export type AckProgress = "none" | "partial" | "most" | "complete";

/** Bucket the ack progress against a target headcount.
 *  Pure — testable. Caller supplies expected total (eg total workforce
 *  or per-zone count). */
export function classifyAckProgress(
  arrivedCount: number,
  totalExpected: number,
): AckProgress {
  if (totalExpected <= 0) return "none";
  const ratio = arrivedCount / totalExpected;
  if (ratio <= 0)      return "none";
  if (ratio < 0.5)     return "partial";
  if (ratio < 1.0)     return "most";
  return "complete";
}

/** Human-friendly "triggered N min ago" label. Pure. */
export function formatTriggeredAge(
  triggeredAt: string,
  nowMs: number = Date.now(),
): string {
  const t = new Date(triggeredAt).getTime();
  if (!Number.isFinite(t)) return "just now";
  const ageSec = Math.max(0, Math.round((nowMs - t) / 1000));
  if (ageSec < 60)   return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
  return `${Math.round(ageSec / 3600)}h ago`;
}

// ───────── IN-MEMORY CACHE ─────────

let _activeEvacuations: ActiveEvacuation[] | null = null;

export function setCachedEvacuations(rows: ActiveEvacuation[]): void {
  _activeEvacuations = rows.slice();
  try {
    localStorage.setItem("sosphere_active_evacuations", JSON.stringify(rows));
  } catch { /* unavailable */ }
}

export function getCachedEvacuations(): ActiveEvacuation[] {
  if (_activeEvacuations) return _activeEvacuations.slice();
  try {
    const raw = localStorage.getItem("sosphere_active_evacuations");
    if (raw) {
      const parsed = JSON.parse(raw) as ActiveEvacuation[];
      if (Array.isArray(parsed)) {
        _activeEvacuations = parsed;
        return parsed.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function clearEvacuationCache(): void {
  _activeEvacuations = null;
  try { localStorage.removeItem("sosphere_active_evacuations");
  // 2026-06-06 M2-#3 (25th pattern app): also unsubscribe the CDC
  // listener so a shared device doesn't keep mirroring the previous
  // tenant's evacuations into the cache after logout. Idempotent.
  try { stopEvacuationsCdc(); } catch { /* best effort */ }
} catch { /* unavailable */ }
}

// ───────── RPC WRAPPERS ─────────

export interface StartEvacuationArgs {
  companyId:           string;
  zoneId?:             string | null;
  zoneName?:           string | null;
  reason?:             string | null;
  assemblyPointId?:    string | null;
  assemblyPointName?:  string | null;
  metadata?:           Record<string, unknown>;
}

/** Admin-only. Returns the new evacuation id or null on failure. */
export async function startEvacuation(args: StartEvacuationArgs): Promise<string | null> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("start_evacuation", {
      p_company_id:          args.companyId,
      p_zone_id:             args.zoneId             ?? null,
      p_zone_name:           args.zoneName           ?? null,
      p_reason:              args.reason             ?? null,
      p_assembly_point_id:   args.assemblyPointId    ?? null,
      p_assembly_point_name: args.assemblyPointName  ?? null,
      p_metadata:            args.metadata           ?? {},
    });
    if (error || !data) {
      console.warn("[Evac] start_evacuation failed:", error?.message);
      return null;
    }
    return String(data);
  } catch (err) {
    console.warn("[Evac] start threw:", err);
    return null;
  }
}

export interface AckEvacuationArgs {
  evacuationId: string;
  phase:        AckPhase;
  lat?:         number;
  lng?:         number;
  accuracy?:    number;
}

export async function ackEvacuation(args: AckEvacuationArgs): Promise<string | null> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("ack_evacuation", {
      p_evacuation_id: args.evacuationId,
      p_phase:         args.phase,
      p_lat:           args.lat      ?? null,
      p_lng:           args.lng      ?? null,
      p_accuracy:      args.accuracy ?? null,
    });
    if (error) {
      console.warn("[Evac] ack_evacuation failed:", error.message);
      return null;
    }
    return typeof data === "string" ? data : null;
  } catch (err) {
    console.warn("[Evac] ack threw:", err);
    return null;
  }
}

export async function endEvacuation(args: {
  evacuationId: string;
  action?: "completed" | "cancelled";
}): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.rpc("end_evacuation", {
      p_evacuation_id: args.evacuationId,
      p_action:        args.action ?? "completed",
    });
    if (error) {
      console.warn("[Evac] end_evacuation failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[Evac] end threw:", err);
    return false;
  }
}

export async function loadActiveEvacuations(
  companyId: string,
): Promise<{ ok: boolean; rows: ActiveEvacuation[]; error?: string }> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_active_evacuations", {
      p_company_id: companyId,
    });
    if (error) return { ok: false, rows: [], error: error.message };
    const rows = Array.isArray(data) ? (data as ActiveEvacuation[]) : [];
    setCachedEvacuations(rows);
    return { ok: true, rows };
  } catch (err) {
    return {
      ok: false, rows: [],
      error: err instanceof Error ? err.message : "Unexpected error",
    };
  }
}

// ───────── CDC SUBSCRIPTION (M2-#3, 25th pattern app, 2026-06-06) ─────────
// evacuations has CDC infrastructure (shared-store.ts:_cdcChannel) but no
// consumer until now. Closes the worker-late-join gap: admin triggers
// evacuation, worker comes online a minute after the broadcast, the
// EVACUATION_TRIGGERED SyncEvent is already gone — without CDC the
// worker sees nothing. The listener below replaces the matching cache
// row (insert / update) so the next loadActiveEvacuations() reads the
// fresh shape, AND so the evacuation-screen's render picks it up via
// the cached state without polling.

let _evacuationsCdcUnsubscribe: (() => void) | null = null;

export function startEvacuationsCdc(): void {
  if (_evacuationsCdcUnsubscribe) return;
  void import("./shared-store").then(({ subscribeCdc }) => {
    if (_evacuationsCdcUnsubscribe) return; // race
    _evacuationsCdcUnsubscribe = subscribeCdc("evacuations", (row, _op) => {
      const r = row as ActiveEvacuation;
      if (!r || !r.id) return;
      // Merge into the in-memory cache; dedup by id and put the most
      // recent state up front. We don't try to surgically diff fields —
      // the row is authoritative, replacing it preserves correctness.
      const current = getCachedEvacuations();
      const next = [r, ...current.filter((e) => e.id !== r.id)];
      setCachedEvacuations(next);
    });
  }).catch((err) => {
    console.warn("[evacuation-service] CDC subscribe failed:", err);
  });
}

export function stopEvacuationsCdc(): void {
  if (_evacuationsCdcUnsubscribe) {
    _evacuationsCdcUnsubscribe();
    _evacuationsCdcUnsubscribe = null;
  }
}

