// ═══════════════════════════════════════════════════════════════
// SOSphere — L1-D Phase 3: computeTwilioSignature behavior unit test
// ─────────────────────────────────────────────────────────────
// A TRUE unit test that imports the pure signing function and
// verifies it matches Twilio's published algorithm against a
// FIXED fixture. If the algorithm ever drifts (e.g., key sort
// changes, hash algorithm changes, base64 encoding changes),
// every signature we forge for the inbound probe becomes
// invalid and the probe starts reporting "post: failed" forever.
//
// Fixture: a canonical Twilio docs example.
//   url     = "https://mycompany.com/myapp.php?foo=1&bar=2"
//   params  = { Digits: "1234", To: "+18005551212", From: "+14158675309", Caller: "+14158675309", CallSid: "CA1234567890ABCDE" }
//   token   = "12345"
//   expected sig (per Twilio docs as of 2024): RSOYDt4T1cUTdK1PDd93/VVr8B8=
//
// The expected value is deterministic given the algorithm — if
// our implementation deviates by even one byte, the base64 differs.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  computeTwilioSignature,
  encodeFormBody,
} from "../../../../supabase/functions/_shared/twilio-signature";

describe("L1-D Phase 3: computeTwilioSignature — Twilio spec compliance", () => {
  it("matches Twilio's documented example signature byte-for-byte", async () => {
    // From Twilio's security docs:
    //   https://www.twilio.com/docs/usage/security#test-the-validity-of-your-webhooks
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const params = {
      CallSid: "CA1234567890ABCDE",
      Caller:  "+14158675309",
      Digits:  "1234",
      From:    "+14158675309",
      To:      "+18005551212",
    };
    const token = "12345";
    const sig = await computeTwilioSignature(token, url, params);
    expect(sig).toBe("RSOYDt4T1cUTdK1PDd93/VVr8B8=");
  });

  it("is deterministic — same inputs give same output", async () => {
    const a = await computeTwilioSignature("k", "https://x.co/p", { A: "1", B: "2" });
    const b = await computeTwilioSignature("k", "https://x.co/p", { A: "1", B: "2" });
    expect(a).toBe(b);
  });

  it("sorts keys alphabetically (B before C, regardless of insertion order)", async () => {
    const inserted_first  = await computeTwilioSignature("k", "https://x.co/p", { C: "3", A: "1", B: "2" });
    const inserted_second = await computeTwilioSignature("k", "https://x.co/p", { A: "1", B: "2", C: "3" });
    expect(inserted_first).toBe(inserted_second);
  });

  it("any param-value tweak changes the signature (no collisions)", async () => {
    const baseline = await computeTwilioSignature("k", "https://x.co/p", { A: "1", B: "2" });
    const a_changed = await computeTwilioSignature("k", "https://x.co/p", { A: "1!", B: "2" });
    expect(baseline).not.toBe(a_changed);
  });

  it("any URL tweak changes the signature", async () => {
    const baseline    = await computeTwilioSignature("k", "https://x.co/a", { A: "1" });
    const diffPath    = await computeTwilioSignature("k", "https://x.co/b", { A: "1" });
    expect(baseline).not.toBe(diffPath);
  });

  it("any auth-token tweak changes the signature (token-bound)", async () => {
    const t1 = await computeTwilioSignature("k1", "https://x.co/p", { A: "1" });
    const t2 = await computeTwilioSignature("k2", "https://x.co/p", { A: "1" });
    expect(t1).not.toBe(t2);
  });

  it("throws on missing authToken (fail-fast contract)", async () => {
    await expect(
      computeTwilioSignature("", "https://x.co/p", { A: "1" }),
    ).rejects.toThrow(/authToken/);
  });

  it("empty params + URL only is valid (still produces a base64 string)", async () => {
    const sig = await computeTwilioSignature("k", "https://x.co/p", {});
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe("L1-D Phase 3: encodeFormBody — application/x-www-form-urlencoded shape", () => {
  it("produces ampersand-separated key=value pairs", () => {
    expect(encodeFormBody({ a: "1", b: "2" })).toMatch(/^(a=1&b=2|b=2&a=1)$/);
  });

  it("URL-encodes special chars (spaces, +, =, &)", () => {
    const body = encodeFormBody({ Body: "hello world+test=foo&bar" });
    expect(body).toBe("Body=hello+world%2Btest%3Dfoo%26bar");
  });

  it("returns empty string on empty input", () => {
    expect(encodeFormBody({})).toBe("");
  });
});
