// ═══════════════════════════════════════════════════════════════
// SOSphere — Playbook Usage Service (P3-#11g)
// ─────────────────────────────────────────────────────────────
// Tracks per-company execution counts + last-used timestamps for
// each emergency response playbook. We don't persist playbook
// *definitions* (those are client-side constants with icon
// components and localized strings) — we only persist the tiny
// dynamic slice: how often a team has run each one, and when.
//
// The dashboard merges this back into the in-memory Playbook state
// so the "28 runs" counter shown on the page is the real team
// counter, not a device-local one. The compliance PDF's
// "Response Playbook Summary" section reads from the same source.
//
// Writes use an atomic RPC (increment_playbook_use) to avoid
// read-modify-write races when two admins run the same playbook
// concurrently.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";

export interface PlaybookUsage {
  playbookId: string;
  useCount: number;
  lastUsedAt?: Date;
}

/** Fetch usage rows for the current company, keyed by playbookId. */
export async function fetchPlaybookUsage(): Promise<Map<string, PlaybookUsage>> {
  const companyId = getCompanyId();
  const byId = new Map<string, PlaybookUsage>();
  if (!companyId) return byId;
  try {
    const { data, error } = await supabase
      .from("playbook_usage")
      .select("playbook_id, use_count, last_used_at")
      .eq("company_id", companyId);
    if (error || !data) return byId;
    for (const row of data as any[]) {
      byId.set(row.playbook_id, {
        playbookId: row.playbook_id,
        useCount: typeof row.use_count === "number" ? row.use_count : Number(row.use_count) || 0,
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
      });
    }
  } catch (err) {
    console.warn("[playbook-usage] fetch:", err);
  }
  return byId;
}

/**
 * Atomically increment use_count and set last_used_at for a playbook.
 * Safe under concurrent callers — the work happens inside a plpgsql
 * function with an ON CONFLICT upsert, so two simultaneous runs both
 * land. Returns a boolean instead of throwing so the UI handler can
 * keep running even if the network blips.
 */
export async function incrementPlaybookUse(playbookId: string): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { error } = await supabase.rpc("increment_playbook_use", {
      p_company_id: companyId,
      p_playbook_id: playbookId,
    });
    if (error) {
      console.warn("[playbook-usage] rpc failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[playbook-usage] rpc exception:", err);
    return false;
  }
}
