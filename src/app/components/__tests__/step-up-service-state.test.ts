// ═══════════════════════════════════════════════════════════════
// SOSphere — step-up-service contract
// ─────────────────────────────────────────────────────────────
// Phase 2 CRIT-8 (2026-06-01): client-side MFA step-up gate for
// sensitive operations. The CANONICAL gate is server-side
// (verify_sensitive_op RPC) — this client helper is UX-only.
//
// These tests lock the contract so future refactors cannot
// silently downgrade the gate logic:
//
//   1.  isSensitiveOperation matches billing:* (regex aligned with server)
//   2.  isSensitiveOperation matches users:*, admin:*, audit:*, owner:*,
//       membership:* (the full sensitive namespace)
//   3.  isSensitiveOperation rejects non-sensitive ops (checkin:, gps:, etc.)
//   4.  isSensitiveOperation handles malformed input safely
//   5.  classifyOpRequiredAal returns aal2 for sensitive, aal1 otherwise
//   6.  mapGateResultToDecision: allowed=true → ok=true, no action
//   7.  mapGateResultToDecision: not_authenticated → action=sign_in
//   8.  mapGateResultToDecision: needs_step_up + hasFactor → open_challenge_modal
//   9.  mapGateResultToDecision: needs_step_up + !hasFactor → open_enrollment_modal
//  10.  mapGateResultToDecision: refused (other) → action=refused
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  isSensitiveOperation,
  classifyOpRequiredAal,
  mapGateResultToDecision,
  type GateResult,
} from "../step-up-service";

describe("step-up-service — Phase 2 CRIT-8 contract", () => {
  it("1. isSensitiveOperation matches billing:* namespace", () => {
    expect(isSensitiveOperation("billing:cancel_trial")).toBe(true);
    expect(isSensitiveOperation("billing:upgrade")).toBe(true);
    expect(isSensitiveOperation("billing:portal")).toBe(true);
  });

  it("2. isSensitiveOperation matches all 6 sensitive namespaces", () => {
    expect(isSensitiveOperation("users:revoke_access")).toBe(true);
    expect(isSensitiveOperation("admin:change_role")).toBe(true);
    expect(isSensitiveOperation("audit:export")).toBe(true);
    expect(isSensitiveOperation("owner:transfer")).toBe(true);
    expect(isSensitiveOperation("membership:suspend")).toBe(true);
  });

  it("3. isSensitiveOperation rejects non-sensitive operations", () => {
    expect(isSensitiveOperation("checkin:submit")).toBe(false);
    expect(isSensitiveOperation("gps:record")).toBe(false);
    expect(isSensitiveOperation("sos:trigger")).toBe(false);
    expect(isSensitiveOperation("read:zones")).toBe(false);
    expect(isSensitiveOperation("billing")).toBe(false); // no colon
    expect(isSensitiveOperation(":billing")).toBe(false); // leading colon
  });

  it("4. isSensitiveOperation handles malformed input safely", () => {
    // @ts-expect-error – verifying runtime safety
    expect(isSensitiveOperation(null)).toBe(false);
    // @ts-expect-error – verifying runtime safety
    expect(isSensitiveOperation(undefined)).toBe(false);
    // @ts-expect-error – verifying runtime safety
    expect(isSensitiveOperation(42)).toBe(false);
    expect(isSensitiveOperation("")).toBe(false);
    expect(isSensitiveOperation("   ")).toBe(false);
  });

  it("5. classifyOpRequiredAal returns aal2 for sensitive, aal1 otherwise", () => {
    expect(classifyOpRequiredAal("billing:cancel")).toBe("aal2");
    expect(classifyOpRequiredAal("admin:suspend")).toBe("aal2");
    expect(classifyOpRequiredAal("checkin:submit")).toBe("aal1");
    expect(classifyOpRequiredAal("read:dashboard")).toBe("aal1");
  });

  it("6. mapGateResultToDecision: allowed=true → ok=true, no action", () => {
    const gate: GateResult = {
      allowed: true, reason: "ok", current_aal: "aal2", required_aal: "aal2",
    };
    const d = mapGateResultToDecision("billing:cancel", gate, true);
    expect(d.ok).toBe(true);
    expect(d.action).toBeUndefined();
    expect(d.isAal2).toBe(true);
  });

  it("7. mapGateResultToDecision: not_authenticated → action=sign_in", () => {
    const gate: GateResult = {
      allowed: false, reason: "not_authenticated", current_aal: null,
    };
    const d = mapGateResultToDecision("billing:cancel", gate, false);
    expect(d.ok).toBe(false);
    expect(d.action).toBe("sign_in");
  });

  it("8. mapGateResultToDecision: needs_step_up + hasFactor → open_challenge_modal", () => {
    const gate: GateResult = {
      allowed: false, reason: "step_up_required", needs_step_up: true,
      current_aal: "aal1", required_aal: "aal2",
    };
    const d = mapGateResultToDecision("billing:cancel", gate, true);
    expect(d.ok).toBe(false);
    expect(d.action).toBe("open_challenge_modal");
    expect(d.hasFactor).toBe(true);
  });

  it("9. mapGateResultToDecision: needs_step_up + !hasFactor → open_enrollment_modal", () => {
    const gate: GateResult = {
      allowed: false, reason: "step_up_required", needs_step_up: true,
      current_aal: "aal1", required_aal: "aal2",
    };
    const d = mapGateResultToDecision("billing:cancel", gate, false);
    expect(d.ok).toBe(false);
    expect(d.action).toBe("open_enrollment_modal");
    expect(d.hasFactor).toBe(false);
  });

  it("10. mapGateResultToDecision: refused (other reason) → action=refused", () => {
    const gate: GateResult = {
      allowed: false, reason: "rpc_error:something", needs_step_up: false,
    };
    const d = mapGateResultToDecision("billing:cancel", gate, true);
    expect(d.ok).toBe(false);
    expect(d.action).toBe("refused");
  });
});
