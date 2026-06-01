// ═══════════════════════════════════════════════════════════════
// SOSphere — buddy-push-service contract
// ─────────────────────────────────────────────────────────────
// Phase 2 CRIT-4-B (2026-06-01): server-side delivery of BUDDY_ALERT
// to buddy B's device with Twilio SMS fallback.
//
// These tests lock the architectural contract for the pure helpers
// so a future refactor cannot silently break the SOS-buddy chain:
//
//   1.  formatBuddyAlertTitle handles missing name
//   2.  formatBuddyAlertTitle trims whitespace and falls back
//   3.  formatBuddyAlertBody includes location language when GPS present
//   4.  formatBuddyAlertBody omits location when GPS missing
//   5.  decideDeliveryChannel: token-rich → push
//   6.  decideDeliveryChannel: no token + phone → sms
//   7.  decideDeliveryChannel: no token + no phone → none
//   8.  decideDeliveryChannel: whitespace-only phone counts as no phone
//   9.  decideDeliveryChannel: negative token count (unknown) is NOT
//       treated as push-positive by the helper (caller controls policy)
//  10.  Channel type is a discriminated union of exactly 3 values
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  formatBuddyAlertTitle,
  formatBuddyAlertBody,
  decideDeliveryChannel,
  type Channel,
} from "../buddy-push-service";

describe("buddy-push-service — Phase 2 CRIT-4-B contract", () => {
  it("1. formatBuddyAlertTitle returns generic title for empty name", () => {
    expect(formatBuddyAlertTitle("")).toBe("Your buddy needs help");
    expect(formatBuddyAlertTitle("   ")).toBe("Your buddy needs help");
  });

  it("2. formatBuddyAlertTitle trims + personalizes when name present", () => {
    expect(formatBuddyAlertTitle("Ahmed")).toBe("Ahmed needs help");
    expect(formatBuddyAlertTitle("  Sara  ")).toBe("Sara needs help");
  });

  it("3. formatBuddyAlertBody includes location language when GPS present", () => {
    const out = formatBuddyAlertBody({ selfName: "Ahmed", lat: 24.7, lng: 46.6 });
    expect(out).toContain("location");
    expect(out).toContain("Ahmed");
  });

  it("4. formatBuddyAlertBody omits location language when GPS missing", () => {
    const noLat   = formatBuddyAlertBody({ selfName: "Ahmed", lng: 46.6 });
    const noLng   = formatBuddyAlertBody({ selfName: "Ahmed", lat: 24.7 });
    const noBoth  = formatBuddyAlertBody({ selfName: "Ahmed" });
    expect(noLat).not.toContain("location");
    expect(noLng).not.toContain("location");
    expect(noBoth).not.toContain("location");
    expect(noBoth).toContain("respond");
  });

  it("5. decideDeliveryChannel: positive token count → push", () => {
    expect(decideDeliveryChannel(1, "+966500000000")).toBe("push");
    expect(decideDeliveryChannel(5, null)).toBe("push");
    expect(decideDeliveryChannel(10, "")).toBe("push");
  });

  it("6. decideDeliveryChannel: zero tokens + phone → sms", () => {
    expect(decideDeliveryChannel(0, "+966500000000")).toBe("sms");
    expect(decideDeliveryChannel(0, "555-1234")).toBe("sms");
  });

  it("7. decideDeliveryChannel: zero tokens + no phone → none", () => {
    expect(decideDeliveryChannel(0, null)).toBe("none");
    expect(decideDeliveryChannel(0, undefined)).toBe("none");
    expect(decideDeliveryChannel(0, "")).toBe("none");
  });

  it("8. decideDeliveryChannel: whitespace-only phone counts as no phone", () => {
    expect(decideDeliveryChannel(0, "   ")).toBe("none");
    expect(decideDeliveryChannel(0, "\t\n")).toBe("none");
  });

  it("9. decideDeliveryChannel: tokenCount must be > 0 to pick push (negative or zero → fall through)", () => {
    // Negative is sentinel for "unknown" — helper is pure and does
    // NOT treat unknown as positive. The notifyBuddyAlert caller
    // owns that policy decision (currently: try push when unknown).
    expect(decideDeliveryChannel(-1, "+966500000000")).toBe("sms");
    expect(decideDeliveryChannel(-1, null)).toBe("none");
  });

  it("10. Channel type is discriminated union of exactly 'push' | 'sms' | 'none'", () => {
    // Compile-time check at the type-system level — if Channel were
    // widened to string, this would still pass but the type narrowing
    // in the consumer would break. Best we can do at runtime: confirm
    // each branch is reachable via the decide function.
    const seen = new Set<Channel>();
    seen.add(decideDeliveryChannel(5, "x"));    // push
    seen.add(decideDeliveryChannel(0, "+1234")); // sms
    seen.add(decideDeliveryChannel(0, null));   // none
    expect(seen.size).toBe(3);
    expect(seen.has("push")).toBe(true);
    expect(seen.has("sms")).toBe(true);
    expect(seen.has("none")).toBe(true);
  });
});
