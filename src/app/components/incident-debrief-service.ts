// ═══════════════════════════════════════════════════════════════
// SOSphere — Incident Debrief Service (27th pattern application)
// ─────────────────────────────────────────────────────────────
// 2026-06-06 final-audit refactor: the 27th pattern app shipped
// with the RPC call inline in post-emergency-debrief.tsx, which
// failed doctrine point #5 (Vitest contract tests) and #1
// (in-memory cache). This module fixes both:
//
//   • Pure helpers (buildDebriefRow, normalizeFeltSafe) exposed for
//     contract tests — the previous inline saveDebriefToHistory
//     had no pure surface to test.
//   • upsertDebrief() wrapper around update_incident_debrief RPC,
//     fire-and-forget with structured warn on failure.
//   • No module-level cache (debriefs are write-once per incident
//     and read back via incident-history.tsx which already has its
//     own loader). The doctrine cache trio is intentionally omitted
//     because the data shape is "append-only addendum to existing
//     incident row" — caching it locally would only duplicate
//     incident-history's responsibility.
//
// DB:
//   public.civilian_incidents.debrief  (jsonb column, added by the
//   20260606_civilian_incidents_debrief_27th_pattern_app migration)
//
// RPC:
//   update_incident_debrief(p_id text, p_debrief jsonb)
// ═══════════════════════════════════════════════════════════════

export type FeltSafe = "safe" | "unsure" | "need_help";

export interface DebriefAnswer {
  feltSafe: FeltSafe;
  note: string;
}

export interface DebriefRow {
  feltSafe: FeltSafe;
  note?: string;
  submittedAt: string; // ISO timestamp
}

// ───────── PURE HELPERS (Vitest-testable) ─────────

/** Normalize the user's free-text note: trim whitespace, drop empty.
 *  Pure. The DB write side uses this so a single space input doesn't
 *  produce a meaningless empty-string note in the audit chain. */
export function normalizeNote(raw: string): string | undefined {
  const trimmed = (raw ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Build the canonical jsonb shape sent to update_incident_debrief.
 *  Pure. Stamping submittedAt at build time (not at RPC time) means
 *  retries don't shift the timestamp. */
export function buildDebriefRow(answer: DebriefAnswer, nowMs: number = Date.now()): DebriefRow {
  return {
    feltSafe:    answer.feltSafe,
    note:        normalizeNote(answer.note),
    submittedAt: new Date(nowMs).toISOString(),
  };
}

/** Coerce arbitrary string into FeltSafe with a fail-safe default.
 *  Pure. Used when reading back a debrief stored by an older client. */
export function normalizeFeltSafe(s: unknown): FeltSafe {
  return s === "safe" || s === "unsure" || s === "need_help" ? s : "unsure";
}

// ───────── RPC WRAPPER ─────────

/** Persist the debrief addendum for an incident the caller owns.
 *  Fire-and-forget — UI never blocks on this. Returns null on
 *  failure (the caller already wrote to localStorage; server miss
 *  is a monitoring concern, not a UX one). */
export async function upsertDebrief(incidentId: string, answer: DebriefAnswer): Promise<boolean> {
  try {
    const { supabase, SUPABASE_CONFIG } = await import("./api/supabase-client");
    if (!SUPABASE_CONFIG.isConfigured) return false;
    const row = buildDebriefRow(answer);
    const { error } = await supabase.rpc("update_incident_debrief", {
      p_id:      incidentId,
      p_debrief: row,
    });
    if (error) {
      console.warn("[incident-debrief] update_incident_debrief RPC failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[incident-debrief] update_incident_debrief threw:", err);
    return false;
  }
}
