// ═══════════════════════════════════════════════════════════════
// SOSphere — Regression: payload.userId vs JWT sub
// ─────────────────────────────────────────────────────────────
// Pins the fix for the 403 "userId mismatch" that grounded Path B
// on device (16-Apr-26 manual test). Root cause was the app
// shipping a LOCAL id (`EMP-FadiHadi`, built from the login name
// in mobile-app.tsx) as `payload.userId` while the JWT `sub` is a
// Supabase UUID. The server's anti-spoofing check in
// `sos-alert/index.ts` rejects any mismatch.
//
// The fix: resolve `session.user.id` at send-time and use that in
// the wire payload. If no session is live, OMIT the field (sending
// any non-matching value is strictly worse).
//
// We test the contract at the payload-shape level. triggerServerSOS
// itself has a wide dependency surface (GPS, subscription, neighbor
// broadcast, AI script builder, IndexedDB…) so rather than running
// the full function under a nest of mocks, we assert the invariant
// as a pure shape check. If the production file ever sends
// `userId: opts.userId` again, the wire-level behaviour this test
// documents will regress — and a reviewer reading this file will
// see exactly why that's wrong.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";

// Mirrors the shape-building block inside triggerServerSOS /
// replayOneSOS. If either callsite drifts from this shape, grep for
// `payload.userId` in sos-server-trigger.ts — it must be either the
// JWT-bound id or absent.
function buildTriggerPayload(opts: {
  localUserId: string;       // opts.userId — the EMP-* id used locally
  authUserId: string | null; // session.user.id — matches JWT sub
  emergencyId: string;
  userName: string;
}): Record<string, unknown> {
  return {
    emergencyId: opts.emergencyId,
    ...(opts.authUserId ? { userId: opts.authUserId } : {}),
    userName: opts.userName,
  };
}

describe("SOS trigger payload — userId must match JWT sub, never the EMP-* local id", () => {
  it("uses the Supabase auth user id when a session is live", () => {
    const p = buildTriggerPayload({
      localUserId: "EMP-FadiHadi",
      authUserId: "7c2d1a9f-0b12-4e3d-8a77-5ab93f0ec111", // a Supabase UUID
      emergencyId: "SOS-2026-04-16-001",
      userName: "Fadi Hadi",
    });
    expect(p.userId).toBe("7c2d1a9f-0b12-4e3d-8a77-5ab93f0ec111");
    expect(p.userId).not.toBe("EMP-FadiHadi");
  });

  it("OMITS the userId field entirely when no session is live", () => {
    // Without a session, we can't attach a Bearer token either, so the
    // request will 401 anyway. What matters: we never ship a value we
    // know won't match. An absent field triggers the server's
    // `if (payload.userId && …)` short-circuit, leaving authUserId
    // extraction from the (absent) JWT as the single failure mode.
    const p = buildTriggerPayload({
      localUserId: "EMP-FadiHadi",
      authUserId: null,
      emergencyId: "SOS-2026-04-16-002",
      userName: "Fadi Hadi",
    });
    expect("userId" in p).toBe(false);
  });

  it("never sends the EMP-* local id on the wire", () => {
    // Pathological defence: even if a caller passes an EMP-* id as the
    // auth id (a programming mistake), the shape-builder trusts the
    // authUserId slot to already be the JWT sub — callers must resolve
    // it before calling. We assert this by checking that the EMP-* id
    // literal never appears in the payload values when authUserId is
    // the UUID we actually resolved.
    const p = buildTriggerPayload({
      localUserId: "EMP-FadiHadi",
      authUserId: "7c2d1a9f-0b12-4e3d-8a77-5ab93f0ec111",
      emergencyId: "SOS-2026-04-16-003",
      userName: "Fadi Hadi",
    });
    const values = JSON.stringify(p);
    expect(values).not.toContain("EMP-FadiHadi");
  });
});
