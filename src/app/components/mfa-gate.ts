// ═══════════════════════════════════════════════════════════════
// SOSphere — mfa-gate (Phase 2 CRIT-8 v2 — inline modal mounting)
// ─────────────────────────────────────────────────────────────
// Imperative API that closes the UX gap from CRIT-8 v1: callsites
// no longer have to show "go to Settings, verify, then retry" toasts.
// They call gateWithMfa(op) and the inline controller takes care of:
//   1. Server gate check (verify_sensitive_op RPC)
//   2. If allowed → resolve(true)
//   3. If needs MFA + has factor → mount MFAChallengeModal,
//      on verify re-check, resolve(ok)
//   4. If needs MFA + no factor → mount MFAEnrollmentModal,
//      on enroll mount challenge, resolve(ok)
//   5. If user cancels → resolve(false)
//
// The MfaGateController singleton component (mfa-gate-controller.tsx)
// must be mounted ONCE at the app root for this to work. We use a
// CustomEvent bus (same pattern as emitSyncEvent in shared-store) so
// the helper has zero React/JSX dependency — callsites can be plain
// async functions in any module.
//
// Defense-in-depth: the server-side verify_sensitive_op RPC remains
// the canonical gate. Even if this UI is bypassed, the sensitive op
// still refuses without aal2. The Controller is purely UX glue.
// ═══════════════════════════════════════════════════════════════

const EVENT_NAME = "sosphere:mfa-gate-show";

export interface MfaGateRequest {
  operation: string;
  resolve:   (ok: boolean) => void;
}

/**
 * Open the MFA gate for a sensitive operation. Returns a Promise that
 * resolves to true if the gate eventually let the user through (either
 * AAL2 already current, or user successfully verified MFA in the inline
 * modal), or false if the user cancelled / verification failed / the
 * server refused for non-MFA reasons.
 *
 * Throws if called server-side (no window).
 */
export function gateWithMfa(operation: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }
  if (!operation || typeof operation !== "string") {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const ev = new CustomEvent<MfaGateRequest>(EVENT_NAME, {
      detail: { operation, resolve },
    });
    window.dispatchEvent(ev);
  });
}

/**
 * Controller-side subscription helper. Used internally by
 * MfaGateController — exported here so the controller doesn't have to
 * duplicate the event name string.
 */
export function onMfaGateRequest(
  handler: (request: MfaGateRequest) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = (e: Event) => {
    const ce = e as CustomEvent<MfaGateRequest>;
    if (ce.detail && typeof ce.detail.resolve === "function") {
      handler(ce.detail);
    }
  };
  window.addEventListener(EVENT_NAME, wrapped);
  return () => window.removeEventListener(EVENT_NAME, wrapped);
}
