// ═══════════════════════════════════════════════════════════════
// SOSphere — MfaGateController (Phase 2 CRIT-8 v2)
// ─────────────────────────────────────────────────────────────
// Singleton component mounted ONCE at each app root (mobile-app.tsx +
// dashboard-web-page.tsx). Listens for "sosphere:mfa-gate-show"
// CustomEvents (dispatched by gateWithMfa from mfa-gate.ts) and runs
// the inline challenge → verify → retry flow without forcing the user
// to navigate to Settings manually.
//
// State machine:
//
//   idle ─── show event ──→ checking
//                              │
//                ┌─────────────┼─────────────┐
//                ▼             ▼             ▼
//            allowed=true  challenge    enrollment
//             resolve(t)    needed       needed
//                          │             │
//                          ▼             ▼
//                       mount         mount
//                       challenge     enrollment
//                       modal         modal
//                          │             │
//                ┌─────────┼─────────┐   │
//                ▼         ▼         ▼   ▼
//            verified  cancel  (recovery)
//             re-check    │      → enroll → re-check
//             resolve     resolve(f)
//
// The controller is fail-safe: any uncaught error in a state
// transition resolves the pending promise as false so the calling
// sensitive op falls through to its own refusal path.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useRef } from "react";
import { onMfaGateRequest, type MfaGateRequest } from "./mfa-gate";

type ModalMode = "challenge" | "enroll" | null;

interface PendingState {
  operation: string;
  resolve:   (ok: boolean) => void;
  factorId?: string;
  mode:      ModalMode;
}

export function MfaGateController() {
  const [pending, setPending] = useState<PendingState | null>(null);
  // useRef to avoid stale-closure problems inside the modal callbacks
  const pendingRef = useRef<PendingState | null>(null);
  pendingRef.current = pending;

  // Lazy-imported modal components (kept out of the initial bundle
  // for users who never trigger a sensitive op).
  const [Challenge, setChallenge] = useState<React.ComponentType<{
    factorId: string;
    onVerified: (mode: "totp" | "recovery") => void;
    onCancel: () => void;
  }> | null>(null);
  const [Enrollment, setEnrollment] = useState<React.ComponentType<{
    onComplete: () => void;
    onCancel: () => void;
  }> | null>(null);

  useEffect(() => {
    const off = onMfaGateRequest(async (request: MfaGateRequest) => {
      // Race-protect: if a prior request is still pending, refuse the
      // new one to avoid stacking modals. The caller can retry.
      if (pendingRef.current) {
        request.resolve(false);
        return;
      }
      try {
        const { requireMfa } = await import("./step-up-service");
        const decision = await requireMfa(request.operation);
        if (decision.ok) {
          request.resolve(true);
          return;
        }
        if (decision.action === "sign_in" || decision.action === "refused" || !decision.action) {
          request.resolve(false);
          return;
        }
        // Need to mount a modal — figure out which one.
        if (decision.action === "open_challenge_modal") {
          const { mfaListFactorsLockFree } = await import("./api/mfa-client");
          const factors = await mfaListFactorsLockFree();
          // mfa-client returns shape {totp: [{id, status}, ...], ...}
          const list = (factors as { totp?: Array<{ id: string; status: string }> } | null)?.totp ?? [];
          const verified = list.find(f => f.status === "verified");
          if (!verified) {
            // Decision said challenge but factors say none — fall through to enroll
            await mountChallengeOrEnroll(request, "enroll", null);
            return;
          }
          await mountChallengeOrEnroll(request, "challenge", verified.id);
        } else if (decision.action === "open_enrollment_modal") {
          await mountChallengeOrEnroll(request, "enroll", null);
        } else {
          request.resolve(false);
        }
      } catch (err) {
        console.warn("[MfaGateController] request handler threw:", err);
        request.resolve(false);
      }
    });
    return off;
  }, []);

  async function mountChallengeOrEnroll(
    request: MfaGateRequest,
    mode: "challenge" | "enroll",
    factorId: string | null,
  ): Promise<void> {
    // Lazy-load the modal component the first time we need it.
    try {
      if (mode === "challenge" && !Challenge) {
        const mod = await import("./mfa-challenge-modal");
        setChallenge(() => mod.MFAChallengeModal);
      }
      if (mode === "enroll" && !Enrollment) {
        const mod = await import("./mfa-enrollment-modal");
        setEnrollment(() => mod.MFAEnrollmentModal);
      }
    } catch (err) {
      console.warn("[MfaGateController] failed to import modal:", err);
      request.resolve(false);
      return;
    }
    setPending({
      operation: request.operation,
      resolve:   request.resolve,
      factorId:  factorId ?? undefined,
      mode,
    });
  }

  // ───── Verify-success handler (challenge path) ─────
  async function handleVerified(_verifiedMode: "totp" | "recovery"): Promise<void> {
    const p = pendingRef.current;
    if (!p) return;
    try {
      // Re-check the server gate now that session is (hopefully) aal2
      const { requireMfa } = await import("./step-up-service");
      const d2 = await requireMfa(p.operation);
      p.resolve(d2.ok);
    } catch {
      p.resolve(false);
    } finally {
      setPending(null);
    }
  }

  // ───── Enroll-complete handler (enrollment path) ─────
  async function handleEnrollmentComplete(): Promise<void> {
    const p = pendingRef.current;
    if (!p) return;
    try {
      // After enrollment we still need the user to verify a TOTP code
      // to upgrade session AAL — Supabase only marks the factor verified,
      // doesn't auto-elevate session. So fetch the new factorId and pivot
      // into the challenge modal.
      const { mfaListFactorsLockFree } = await import("./api/mfa-client");
      const factors = await mfaListFactorsLockFree();
      const list = (factors as { totp?: Array<{ id: string; status: string }> } | null)?.totp ?? [];
      const verified = list.find(f => f.status === "verified");
      if (!verified) {
        p.resolve(false);
        setPending(null);
        return;
      }
      // Pivot to challenge mode with the newly-enrolled factor
      if (!Challenge) {
        const mod = await import("./mfa-challenge-modal");
        setChallenge(() => mod.MFAChallengeModal);
      }
      setPending({ ...p, mode: "challenge", factorId: verified.id });
    } catch {
      p.resolve(false);
      setPending(null);
    }
  }

  function handleCancel(): void {
    const p = pendingRef.current;
    if (p) p.resolve(false);
    setPending(null);
  }

  // ───── Render ─────
  if (!pending) return null;
  if (pending.mode === "challenge" && Challenge && pending.factorId) {
    return (
      <Challenge
        factorId={pending.factorId}
        onVerified={handleVerified}
        onCancel={handleCancel}
      />
    );
  }
  if (pending.mode === "enroll" && Enrollment) {
    return (
      <Enrollment
        onComplete={handleEnrollmentComplete}
        onCancel={handleCancel}
      />
    );
  }
  return null;
}
