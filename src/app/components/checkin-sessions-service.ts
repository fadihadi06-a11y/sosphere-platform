// ═══════════════════════════════════════════════════════════════
// SOSphere — Checkin Sessions Service (24th pattern application)
// ─────────────────────────────────────────────────────────────
// 2026-06-05 roots-of-roots M1-#5: the worker's ACTIVE check-in
// deadline was localStorage-only. Worker phone died / wiped / cross-
// device login → admin had no idea who was overdue until SOS fired.
//
// This service mirrors the localStorage live state to the server via
// SECDEF RPCs so:
//   • Mobile checkin-timer.tsx dual-writes (localStorage = instant UI,
//     RPC = durable cross-device share).
//   • Dashboard admin can call loadActiveCheckinSessions(companyId) to
//     render a live "due in X min" panel sorted by deadline.
//   • Logout / complete-logout calls clearCheckinSessionCache to wipe
//     the local copy (cross-tenant safety on shared devices).
//
// DB:
//   public.checkin_sessions  — PK user_id (one active session per worker)
//
// RPCs:
//   upsert_checkin_session(deadline_ts, total_sec, warning_cycle, zone)
//   clear_checkin_session()
//   get_active_checkin_sessions(company_id)
// ═══════════════════════════════════════════════════════════════

export interface CheckinSessionRow {
  user_id:               string;
  employee_name:         string;
  zone:                  string | null;
  deadline_ts:           string; // ISO timestamptz
  total_sec:             number;
  warning_cycle:         number;
  started_at:            string;
  updated_at:            string;
  seconds_until_deadline: number;
}

// ───────── IN-MEMORY CACHE ─────────

let _activeSessions: CheckinSessionRow[] | null = null;

export function setCachedActiveCheckinSessions(rows: CheckinSessionRow[]): void {
  _activeSessions = rows.slice();
}

export function getCachedActiveCheckinSessions(): CheckinSessionRow[] {
  return _activeSessions ? _activeSessions.slice() : [];
}

/** Clear the in-memory cache. Called by complete-logout so a shared
 *  device doesn't surface tenant-A's overdue list to tenant-B. */
export function clearCheckinSessionsCache(): void {
  _activeSessions = null;
}

// ───────── PURE HELPERS (Vitest-testable) ─────────

/** Compute the count + names of sessions overdue right now (seconds_until_deadline < 0). */
export function countOverdue(rows: CheckinSessionRow[], nowMs: number = Date.now()): {
  count: number;
  names: string[];
} {
  const overdue = rows.filter((r) => new Date(r.deadline_ts).getTime() < nowMs);
  return {
    count:  overdue.length,
    names:  overdue.map((r) => r.employee_name),
  };
}

/** Sort sessions by deadline ascending (most-overdue first). Pure. */
export function sortByDeadline(rows: CheckinSessionRow[]): CheckinSessionRow[] {
  return rows.slice().sort((a, b) => {
    const da = new Date(a.deadline_ts).getTime();
    const db = new Date(b.deadline_ts).getTime();
    return da - db;
  });
}

/** Format a "due in N" or "overdue by N" label. Pure. */
export function deadlineLabel(secondsUntilDeadline: number): string {
  const abs = Math.abs(secondsUntilDeadline);
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  const pad = secs.toString().padStart(2, "0");
  if (secondsUntilDeadline < 0) return `overdue ${mins}m ${pad}s`;
  if (mins === 0) return `due in ${secs}s`;
  return `due in ${mins}m ${pad}s`;
}

// ───────── RPC WRAPPERS ─────────

export interface UpsertCheckinSessionArgs {
  deadlineMs:    number;  // epoch ms — converted to ISO timestamptz
  totalSec:      number;
  warningCycle:  number;
  zone?:         string | null;
}

/** Mirror the worker's active deadline to the server. Mobile checkin-timer.tsx
 *  calls this after every localStorage write of the deadline.
 *  Returns null on failure — caller continues with localStorage as the
 *  authoritative live UI source (the server miss is monitored separately). */
export async function upsertCheckinSession(args: UpsertCheckinSessionArgs): Promise<string | null> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("upsert_checkin_session", {
      p_deadline_ts:   new Date(args.deadlineMs).toISOString(),
      p_total_sec:     args.totalSec,
      p_warning_cycle: args.warningCycle,
      p_zone:          args.zone ?? null,
    });
    if (error) {
      console.warn("[checkin-sessions] upsert RPC failed:", error.message);
      return null;
    }
    return data ? String(data) : null;
  } catch (err) {
    console.warn("[checkin-sessions] upsert threw:", err);
    return null;
  }
}

/** Clear the server-side mirror. Called from clearTimerStorage when the
 *  worker checks in / cancels / SOS fires. Idempotent — server returns
 *  true even if no row existed. */
export async function clearCheckinSession(): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.rpc("clear_checkin_session");
    if (error) {
      console.warn("[checkin-sessions] clear RPC failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[checkin-sessions] clear threw:", err);
    return false;
  }
}

/** Admin reader — dashboard calls this to render "active check-ins" panel.
 *  Returns sorted-by-deadline list. */
export async function loadActiveCheckinSessions(companyId: string): Promise<CheckinSessionRow[]> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_active_checkin_sessions", {
      p_company_id: companyId,
    });
    if (error || !Array.isArray(data)) {
      if (error) console.warn("[checkin-sessions] load RPC failed:", error.message);
      return [];
    }
    const rows = data as CheckinSessionRow[];
    setCachedActiveCheckinSessions(rows);
    return rows;
  } catch (err) {
    console.warn("[checkin-sessions] load threw:", err);
    return [];
  }
}
