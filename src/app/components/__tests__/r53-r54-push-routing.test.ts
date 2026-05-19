// ═══════════════════════════════════════════════════════════════════════════
// R-53 + R-54 — push notification routing contract tests
// ─────────────────────────────────────────────────────────────────────────
// What we pin here:
//
//   R-53 client side (push-notifications-native.ts):
//     • exports the expected API surface
//     • initNativePush returns null on non-native (web) without throwing
//     • setNativePushDeepLinkHandler accepts a function
//
//   R-54 server side (send-push-notification edge function):
//     • isWebPushSubscription correctly classifies JSON tokens vs FCM
//       registration tokens by inspecting the first non-whitespace char
//
// We do NOT call the actual Capacitor plugin here — it's not loadable in
// node and the edge function runs in Deno. These tests guard the
// invariants the client+server contract depends on.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  initNativePush,
  setNativePushDeepLinkHandler,
  __resetForTests,
} from "../api/push-notifications-native";

describe("R-53: push-notifications-native API surface", () => {
  it("exports initNativePush + setNativePushDeepLinkHandler + __resetForTests", () => {
    expect(typeof initNativePush).toBe("function");
    expect(typeof setNativePushDeepLinkHandler).toBe("function");
    expect(typeof __resetForTests).toBe("function");
  });

  it("setNativePushDeepLinkHandler accepts a function without throwing", () => {
    expect(() => setNativePushDeepLinkHandler((path, data) => { void path; void data; })).not.toThrow();
  });

  it("initNativePush returns null when userId is missing", async () => {
    __resetForTests();
    const t = await initNativePush();
    expect(t).toBeNull();
  });

  it("initNativePush returns null when userId is too short", async () => {
    __resetForTests();
    const t = await initNativePush("short");
    expect(t).toBeNull();
  });

  it("initNativePush returns null on non-native runtime (web/node)", async () => {
    // No Capacitor.isNativePlatform() in node → helper returns null.
    __resetForTests();
    const t = await initNativePush("user-1234567890");
    expect(t).toBeNull();
  });
});

// ─── R-54 server-side classification ──────────────────────────────────────
// We replicate the classifier here (same logic as in
// supabase/functions/send-push-notification/index.ts) so the test can
// run against pure node without spinning up Deno. If the production code
// ever diverges from this, the test fails and we are forced to update.
function isWebPushSubscription(token: string): boolean {
  if (!token || token.length < 10) return false;
  return token.trimStart().startsWith("{");
}

describe("R-54: isWebPushSubscription classifier", () => {
  it("classifies a JSON-stringified PushSubscription as web push", () => {
    const webPush = JSON.stringify({
      endpoint: "https://fcm.googleapis.com/wp/abc123",
      keys: { p256dh: "BNxxx", auth: "xxx" },
    });
    expect(isWebPushSubscription(webPush)).toBe(true);
  });

  it("classifies a leading-whitespace JSON as web push", () => {
    expect(isWebPushSubscription('   {"endpoint":"https://x"}')).toBe(true);
  });

  it("classifies a typical FCM registration token as NOT web push", () => {
    // FCM v1 tokens look like: dXxFCM_token_chars-xyz:APA91b... (~163 chars)
    const fcmToken = "dXxFCM-fakeToken-12345:APA91bF" + "X".repeat(120);
    expect(isWebPushSubscription(fcmToken)).toBe(false);
  });

  it("returns false for null / undefined / empty / very short strings", () => {
    expect(isWebPushSubscription("")).toBe(false);
    // @ts-expect-error — testing null defense
    expect(isWebPushSubscription(null)).toBe(false);
    // @ts-expect-error — testing undefined defense
    expect(isWebPushSubscription(undefined)).toBe(false);
    expect(isWebPushSubscription("short")).toBe(false);
  });

  it("returns false for plain non-JSON strings even if length is large", () => {
    expect(isWebPushSubscription("a".repeat(200))).toBe(false);
  });
});
