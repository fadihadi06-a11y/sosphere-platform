// ═══════════════════════════════════════════════════════════════
// SOSphere — step-up-service (Phase 2 CRIT-8 world-class)
// ─────────────────────────────────────────────────────────────
// MFA step-up gate for sensitive operations (revoke, suspend,
// billing, owner-transfer, audit, membership changes).
//
// Architecture (mirrors CRIT-2/3/4/4-B pattern):
//   • DB is THE source of truth — verify_sensitive_op(p_operation)
//     SECDEF RPC checks JWT aal claim server-side. Even a malicious
//     client bypassing the prompt cannot escape: every sensitive
//     write should be preceded by an RPC call that the server
//     refuses without aal2.
//   • Client step-up is UX-only: it skips the round-trip prompt
//     when AAL2 is already current in the session (because the
//     user verified MFA recently).
//   • Inline enrollment path: if the user has never enrolled a
//     factor, the gate explains it instead of refusing silently.
//     (UI integration mounts the MFAEnrollmentModal — handled by
//     consuming components.)
//   • Two related bugs are fixed in passing:
//     - R-809: mfaChallengeAndVerify hardcoded `aal: "aal2"` on
//       success regardless of actual session AAL. We now read the
//       real AAL via supabase.auth.getSession() and compare.
//
// This file contains:
//   1. Pure helpers (Vitest-testable): isSensitiveOperation,
//      classifyOpRequiredAal, mapGateResultToDecision.
//   2. RPC wrapper: gateSensitiveOp() returns the server's
//      authoritative {allowed, needs_step_up, current_aal, ...}.
//   3. requireMfa(operation) — async entry point. Returns
//      {ok: boolean, reason?: string, action?: 'open_modal'|'enroll'}
//      so the caller can react (open challenge modal, etc).
//
// UI INTEGRATION (separate concern):
//   Consuming components call requireMfa(op). If result.ok, proceed
//   with the sensitive write. If result.action === 'open_modal',
//   mount MFAChallengeModal, on verify success retry requireMfa.
//   If result.action === 'enroll', mount MFAEnrollmentModal.
//   See dashboard-roles-page.tsx for a reference integration.
// ═══════════════════════════════════════════════════════════════

export interface GateResult {
  allowed:        boolean;
  reason:         string;
  current_aal?:   string | null;
  required_aal?:  string;
  needs_step_up?: boolean;
  role?:          string | null;
  company_id?:    string | null;
}

export interface StepUpDecision {
  ok:       boolean;
  /** Why the gate refused (for logging/UI). */
  reason:   string;
  /** What the UI should do next when ok=false. */
  action?:  "open_challenge_modal" | "open_enrollment_modal" | "sign_in" | "refused";
  /** Whether the user has at least one verified MFA factor. */
  hasFactor?: boolean;
  /** Whether the SERVER said the session is already AAL2. */
  isAal2?:  boolean;
  /** Operation that was checked (echo for logging). */
  operation: string;
}

// ───────── PURE HELPERS ─────────

const SENSITIVE_NAMESPACE_RE = /^(billing|users|admin|audit|owner|membership):/;

/** Operations matching the namespace require AAL2. Pure mirror of the
 *  server regex in verify_sensitive_op — keep these two in lock-step. */
export function isSensitiveOperation(operation: string): boolean {
  if (typeof operation !== "string") return false;
  return SENSITIVE_NAMESPACE_RE.test(operation.trim());
}

/** What AAL does this operation require? */
export function classifyOpRequiredAal(operation: string): "aal1" | "aal2" {
  return isSensitiveOperation(operation) ? "aal2" : "aal1";
}

/** Translate a raw RPC GateResult into a UI-actionable decision.
 *  Pure — testable without Supabase. The `hasFactor` flag is supplied
 *  by the caller (after a list-factors check) since the RPC itself
 *  does not know about factor enrollment status. */
export function mapGateResultToDecision(
  operation: string,
  gate: GateResult,
  hasFactor: boolean,
): StepUpDecision {
  const base = { operation, hasFactor, isAal2: gate.current_aal === "aal2" };
  if (gate.allowed) {
    return { ...base, ok: true, reason: gate.reason || "ok" };
  }
  if (gate.reason === "not_authenticated") {
    return { ...base, ok: false, reason: gate.reason, action: "sign_in" };
  }
  if (gate.needs_step_up) {
    return {
      ...base,
      ok: false,
      reason: gate.reason,
      action: hasFactor ? "open_challenge_modal" : "open_enrollment_modal",
    };
  }
  return { ...base, ok: false, reason: gate.reason || "refused", action: "refused" };
}

// ───────── RPC + SESSION HELPERS ─────────

/** Call the SECDEF gate RPC. Errors are returned (never thrown) — the
 *  caller is in a sensitive-action UI path that must surface failures
 *  to the user with context. */
export async function gateSensitiveOp(operation: string): Promise<GateResult> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("verify_sensitive_op", {
      p_operation: operation,
    });
    if (error) {
      return { allowed: false, reason: `rpc_error:${error.message}` };
    }
    if (!data || typeof data !== "object") {
      return { allowed: false, reason: "rpc_no_data" };
    }
    return data as GateResult;
  } catch (err) {
    return {
      allowed: false,
      reason: `threw:${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

/** Read the REAL session AAL from Supabase. Fixes R-809 — never trust
 *  hardcoded aal values from earlier verify calls; the session is the
 *  authoritative source. */
export async function readSessionAal(): Promise<string | null> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session) return null;
    // Supabase v2 session has aal on the user object via
    // currentAuthenticationMethods, OR we can decode the access token
    // (the canonical source). Decode for accuracy.
    const token = data.session.access_token;
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.aal === "string" ? payload.aal.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Does the user have at least one VERIFIED MFA factor? Determines
 *  whether the gate offers challenge-now vs enrollment. */
export async function hasVerifiedFactor(): Promise<boolean> {
  try {
    const { mfaListFactorsLockFree } = await import("./api/mfa-client");
    const factors = await mfaListFactorsLockFree();
    if (!factors || typeof factors !== "object") return false;
    // Shape varies across mfa-client versions — try both totp.length
    // and a flat list.
    const list = Array.isArray((factors as { totp?: unknown[] }).totp)
      ? ((factors as { totp: Array<{ status?: string }> }).totp)
      : Array.isArray((factors as { all?: unknown[] }).all)
        ? ((factors as { all: Array<{ status?: string }> }).all)
        : [];
    return list.some(f => f && (f as { status?: string }).status === "verified");
  } catch {
    return false;
  }
}

/** Main entry. Run BEFORE any sensitive operation. Returns a
 *  StepUpDecision the caller uses to either proceed or mount the
 *  appropriate modal.  Logs are emitted to console.warn for refused
 *  cases so we can detect bypass-attempts in dev. */
export async function requireMfa(operation: string): Promise<StepUpDecision> {
  if (!operation || typeof operation !== "string") {
    return {
      ok: false, reason: "operation_required", action: "refused",
      operation: operation ?? "(missing)",
    };
  }
  const gate = await gateSensitiveOp(operation);
  const hasFactor = gate.needs_step_up ? await hasVerifiedFactor() : false;
  const decision = mapGateResultToDecision(operation, gate, hasFactor);
  if (!decision.ok) {
    console.warn(
      `[StepUp] refused operation=${operation} reason=${decision.reason} action=${decision.action ?? "(none)"} aal=${gate.current_aal ?? "?"} hasFactor=${hasFactor}`,
    );
  }
  return decision;
}
