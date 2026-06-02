// ═══════════════════════════════════════════════════════════════
// SOSphere — discreet-session-service (Phase 2 CRIT-9 world-class)
// ─────────────────────────────────────────────────────────────
// Server-state architecture for the Discreet SOS engine.
//
// Pre-fix (audit): discreet-sos-mode-v2.ts held its entire session
// state in a module-level singleton + a 2-min heartbeat that emitted
// to the event bus only (employeeId hardcoded "discreet-sos-user").
// Closing the tab lost everything; no dashboard listener; no DB row.
//
// Architecture (mirrors CRIT-2/3/4/4-B/8 pattern — 6th application):
//   • DB = source of truth (discreet_sessions + discreet_session_pings)
//   • 4 SECDEF RPCs gate all writes; employee_id pinned via auth.uid()
//     server-side (mobile clients cannot forge sessions for others)
//   • Auto-timeout enforced on the server (heartbeat past the deadline
//     auto-flips status to 'timed_out' — a malicious offline client
//     cannot keep a session alive past its TTL)
//   • In-memory _activeSession + bootstrap cache for instant resume
//     after a brief reload; clearDiscreetSessionState() called on logout
//   • Pure helpers (computeHeartbeatAge, classifyStatus) Vitest-testable
//
// This file contains:
//   1. Pure helpers + types
//   2. RPC wrappers: startDiscreetSession, heartbeatDiscreetSession,
//      endDiscreetSession, loadActiveDiscreetSessions
//   3. In-memory state + setActive/clear/getActive
// ═══════════════════════════════════════════════════════════════

export type DiscreetMode = "blackout" | "low_battery";
export type DiscreetStatus =
  | "active" | "warned" | "timed_out" | "exited" | "admin_cleared";

export interface DiscreetSessionState {
  sessionId: string;
  mode:      DiscreetMode;
  startedAt: number;      // ms epoch
  autoTimeoutAt: number;  // ms epoch
  lastHeartbeatAt?: number;
}

export interface ActiveDiscreetRow {
  id:                string;
  employee_id:       string;
  mode:              DiscreetMode;
  status:            DiscreetStatus;
  last_lat:          number | null;
  last_lng:          number | null;
  last_accuracy_m:   number | null;
  last_heartbeat_at: string | null;  // ISO
  auto_timeout_at:   string;
  started_at:        string;
  heartbeat_age_sec: number;
}

// ───────── PURE HELPERS ─────────

/** Heartbeat freshness classification — pure, testable. */
export type HeartbeatHealth = "fresh" | "stale" | "missing" | "expired";

/** Default thresholds (seconds):
 *  - fresh: ≤ 180s (last 3 minutes)
 *  - stale: ≤ 600s (last 10 minutes, but worker still might be alive)
 *  - missing: > 600s
 *  - expired: heartbeat_age_sec is null OR auto_timeout_at < now */
export function classifyHeartbeat(
  heartbeatAgeSec: number | null | undefined,
  autoTimeoutAt: string | undefined,
  nowMs: number = Date.now(),
): HeartbeatHealth {
  if (autoTimeoutAt && new Date(autoTimeoutAt).getTime() < nowMs) return "expired";
  if (heartbeatAgeSec == null) return "missing";
  if (heartbeatAgeSec <= 180) return "fresh";
  if (heartbeatAgeSec <= 600) return "stale";
  return "missing";
}

/** Color hint for a status (used by dashboard panel rendering). Pure. */
export function statusColor(status: DiscreetStatus): string {
  switch (status) {
    case "active":         return "#FF2D55";  // red — active danger
    case "warned":         return "#FF9500";  // orange — about to timeout
    case "timed_out":      return "#FF3B30";  // dark red — went silent
    case "admin_cleared":  return "#00C853";  // green — resolved by admin
    case "exited":         return "#8E8E93";  // gray — user exited normally
    default:               return "#8E8E93";
  }
}

// ───────── IN-MEMORY STATE ─────────

let _activeSession: DiscreetSessionState | null = null;

export function setActiveSession(s: DiscreetSessionState | null): void {
  _activeSession = s;
  try {
    if (s) localStorage.setItem("sosphere_discreet_session", JSON.stringify(s));
    else   localStorage.removeItem("sosphere_discreet_session");
  } catch { /* localStorage unavailable */ }
}

export function getActiveSession(): DiscreetSessionState | null {
  if (_activeSession) return _activeSession;
  try {
    const raw = localStorage.getItem("sosphere_discreet_session");
    if (raw) {
      const parsed = JSON.parse(raw) as DiscreetSessionState;
      // Bootstrap cache: validate auto_timeout hasn't passed
      if (parsed.autoTimeoutAt > Date.now()) {
        _activeSession = parsed;
        return parsed;
      }
      localStorage.removeItem("sosphere_discreet_session");
    }
  } catch { /* ignore */ }
  return null;
}

export function clearDiscreetSessionState(): void {
  _activeSession = null;
  try { localStorage.removeItem("sosphere_discreet_session"); } catch { /* ignore */ }
}

// ───────── RPC WRAPPERS ─────────

/** Start a discreet session via SECDEF RPC. Returns the session id (and
 *  caches it locally) or null on failure. */
export async function startDiscreetSession(args: {
  mode: DiscreetMode;
  lat?: number;
  lng?: number;
  accuracy?: number;
  timeoutMin?: number;
}): Promise<string | null> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("start_discreet_session", {
      p_mode:        args.mode,
      p_lat:         args.lat ?? null,
      p_lng:         args.lng ?? null,
      p_accuracy:    args.accuracy ?? null,
      p_timeout_min: args.timeoutMin ?? 60,
    });
    if (error || !data) {
      console.warn("[Discreet] start_discreet_session failed:", error?.message);
      return null;
    }
    const sessionId = String(data);
    const startedAt = Date.now();
    setActiveSession({
      sessionId,
      mode:          args.mode,
      startedAt,
      autoTimeoutAt: startedAt + (args.timeoutMin ?? 60) * 60_000,
      lastHeartbeatAt: startedAt,
    });
    return sessionId;
  } catch (err) {
    console.warn("[Discreet] start threw:", err);
    return null;
  }
}

export async function heartbeatDiscreetSession(args: {
  sessionId: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  battery?: number;
}): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("heartbeat_discreet_session", {
      p_session_id: args.sessionId,
      p_lat:        args.lat ?? null,
      p_lng:        args.lng ?? null,
      p_accuracy:   args.accuracy ?? null,
      p_battery:    args.battery ?? null,
    });
    if (error) {
      console.warn("[Discreet] heartbeat failed:", error.message);
      return false;
    }
    const ok = data === true;
    if (ok && _activeSession) {
      _activeSession.lastHeartbeatAt = Date.now();
    } else if (!ok) {
      // Server says session is no longer active (timed_out etc) — clear local
      clearDiscreetSessionState();
    }
    return ok;
  } catch (err) {
    console.warn("[Discreet] heartbeat threw:", err);
    return false;
  }
}

export async function endDiscreetSession(args: {
  sessionId: string;
  reason?: "exited" | "admin_cleared" | "timed_out";
}): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.rpc("end_discreet_session", {
      p_session_id: args.sessionId,
      p_reason:     args.reason ?? "exited",
    });
    if (error) {
      console.warn("[Discreet] end failed:", error.message);
      return false;
    }
    clearDiscreetSessionState();
    return true;
  } catch (err) {
    console.warn("[Discreet] end threw:", err);
    return false;
  }
}

export async function loadActiveDiscreetSessions(
  companyId: string,
): Promise<{ ok: boolean; rows: ActiveDiscreetRow[]; error?: string }> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_active_discreet_sessions", {
      p_company_id: companyId,
    });
    if (error) return { ok: false, rows: [], error: error.message };
    return { ok: true, rows: Array.isArray(data) ? (data as ActiveDiscreetRow[]) : [] };
  } catch (err) {
    return { ok: false, rows: [], error: err instanceof Error ? err.message : "Unexpected" };
  }
}
