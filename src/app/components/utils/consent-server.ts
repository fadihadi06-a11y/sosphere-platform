// ═══════════════════════════════════════════════════════════════════════════
// utils/consent-server — server-authoritative consent persistence (B-08)
// ─────────────────────────────────────────────────────────────────────────
// 2026-04-25 (B-08): the prior code stored consent only in localStorage.
//   An attacker (or a tampered client / hostile script in a shared browser
//   profile) could write `sosphere_tos_consent` and skip the consent flow
//   entirely. GDPR Art. 7 requires consent that the controller can DEMONSTRATE
//   — local-only flags are not demonstrable.
//
// New contract:
//   • localStorage remains a fast cache for offline/anonymous users (the
//     consent screens fire BEFORE auth — we have no session to write to
//     yet at that moment).
//   • Once a session exists, the server is authoritative. We mirror the
//     local consent into `profiles.{tos_consent_*, gps_consent_*}` via the
//     `record_consent` RPC.
//   • On every session restore, we query `get_consent_state()` and, if
//     the server says "no consent" while localStorage says "yes", we
//     treat it as a tampered local state and force the consent flow
//     again. The user is NOT logged out — just routed back through the
//     screens.
//   • RPC failures fail-secure: on persistent network errors we route
//     to the consent flow rather than honor a possibly-stale local cache.
//     This mirrors the F-B age-verification pattern.
// ═══════════════════════════════════════════════════════════════════════════

export type ConsentKind = "tos" | "gps";
export type GpsDecision = "granted" | "declined";

export interface ServerConsentState {
  tos: { at: string | null; version: string | null };
  gps: { at: string | null; decision: GpsDecision | null };
}

export interface RpcLike<T> {
  (): Promise<{ data: T | null; error: unknown }>;
}

export interface ConsentVerdict {
  /** True only when the relevant consents have positive timestamps on the server. */
  done: boolean;
  reason:
    | "ok_server"          // server confirmed both consents
    | "ok_local_no_session" // anon user, fall back to local cache
    | "missing_tos"        // server has no tos_consent_at
    | "missing_gps"        // server has no gps_consent_at
    | "rpc_error"          // RPC failed even after retry — treat as missing
    | "tampered_local";    // local cache says yes, server says no
}

const TOS_CONSENT_KEY = "sosphere_tos_consent";
const GPS_CONSENT_KEY = "sosphere_gps_consent";

/** Best-effort write of a consent decision to the server. Never throws. */
export async function mirrorConsentToServer(
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
  kind: ConsentKind,
  opts: { version?: string; decision?: GpsDecision } = {},
): Promise<{ ok: boolean; reason: string }> {
  try {
    const args: Record<string, unknown> = { p_kind: kind };
    if (kind === "tos") args.p_version = opts.version ?? "1.0";
    if (kind === "gps") args.p_decision = opts.decision ?? "granted";
    const { data, error } = await rpc("record_consent", args);
    if (error) return { ok: false, reason: "rpc_error" };
    if (data && typeof data === "object" && "ok" in (data as Record<string, unknown>)) {
      const r = data as { ok: boolean; reason?: string };
      return { ok: r.ok === true, reason: r.reason ?? (r.ok ? "ok" : "unknown") };
    }
    return { ok: false, reason: "unexpected_shape" };
  } catch {
    return { ok: false, reason: "exception" };
  }
}

/** Fetch the server consent state with one retry. Fail-secure on persistent error. */
export async function fetchServerConsent(
  rpc: () => Promise<{ data: unknown; error: unknown }>,
  opts: { maxAttempts?: number; retryDelayMs?: number; totalTimeoutMs?: number } = {},
): Promise<ServerConsentState | null> {
  const max = Math.max(1, opts.maxAttempts ?? 2);
  const delay = Math.max(0, opts.retryDelayMs ?? 400);
  const ceiling = Math.max(100, opts.totalTimeoutMs ?? 5000);
  const startedAt = Date.now();

  for (let i = 0; i < max; i++) {
    if (Date.now() - startedAt >= ceiling) return null;
    try {
      const remaining = ceiling - (Date.now() - startedAt);
      const res = await Promise.race<{ data: unknown; error: unknown }>([
        rpc(),
        new Promise<{ data: unknown; error: unknown }>((_, rej) =>
          setTimeout(() => rej(new Error("consent_state_timeout")), Math.max(50, remaining))),
      ]);
      if (!res.error) {
        const d = res.data as Partial<ServerConsentState> | null;
        if (d && typeof d === "object" && "tos" in d && "gps" in d) {
          return d as ServerConsentState;
        }
        return { tos: { at: null, version: null }, gps: { at: null, decision: null } };
      }
    } catch {
      // retry
    }
    if (i < max - 1) await new Promise((r) => setTimeout(r, delay));
  }
  return null;
}

/**
 * Decide whether the consent flow is needed. Server is authoritative when
 * a session exists. localStorage is the fallback for the pre-auth window.
 */
export async function verifyConsentDone(opts: {
  hasSession: boolean;
  hasLocalTos: () => boolean;
  hasLocalGps: () => boolean;
  fetchServer: () => Promise<ServerConsentState | null>;
}): Promise<ConsentVerdict> {
  if (!opts.hasSession) {
    const localOk = opts.hasLocalTos() && opts.hasLocalGps();
    return {
      done: localOk,
      reason: localOk ? "ok_local_no_session" : "missing_tos",
    };
  }

  const server = await opts.fetchServer();
  if (server === null) {
    return { done: false, reason: "rpc_error" };
  }

  const tosOk = !!server.tos.at;
  const gpsOk = !!server.gps.at;

  if (tosOk && gpsOk) return { done: true, reason: "ok_server" };

  // Server says no consent. If local also says no → genuinely missing.
  // If local says yes → tampered (or server-side wipe / cross-device).
  // Either way, route to consent flow.
  const localOk = opts.hasLocalTos() && opts.hasLocalGps();
  if (localOk) return { done: false, reason: "tampered_local" };
  if (!tosOk)  return { done: false, reason: "missing_tos" };
  return { done: false, reason: "missing_gps" };
}

/** Rebuild the local cache from a server snapshot (e.g. after cross-device login). */
export function rehydrateLocalConsent(server: ServerConsentState): void {
  try {
    if (server.tos.at) {
      localStorage.setItem(TOS_CONSENT_KEY, JSON.stringify({
        accepted: true,
        timestamp: new Date(server.tos.at).getTime(),
        version: server.tos.version ?? "1.0",
      }));
    }
    if (server.gps.at && server.gps.decision === "granted") {
      localStorage.setItem(GPS_CONSENT_KEY, JSON.stringify({
        allowed: true,
        timestamp: new Date(server.gps.at).getTime(),
        declinedWarningShown: false,
      }));
    }
  } catch {
    // localStorage may be disabled (private mode) — non-fatal.
  }
}
