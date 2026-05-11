// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio request-signature computation
// ─────────────────────────────────────────────────────────────
// PURE HMAC-SHA1 logic used by:
//   • sos-inbound-probe   — to FORGE a valid signature for a
//                            synthetic Twilio-shaped payload (so
//                            the inbound webhook accepts it)
//   • test                — to verify computeTwilioSignature
//                            matches Twilio's published algorithm
//                            against a known fixture
//
// The same algorithm is used internally by sos-sms-inbound +
// twilio-status to VALIDATE incoming Twilio webhooks. We keep
// the validate side INLINED in each function (closer to the
// security envelope) and extract only the COMPUTE side here, so
// the test can prove our signing matches the spec without going
// anywhere near the validation security boundary.
//
// Twilio spec (per docs.twilio.com/usage/security):
//   1. Take the full URL Twilio is requesting (incl. query string)
//   2. Append, in alphabetical order, each form-parameter name
//      and value concatenated (key + value, no separator)
//   3. HMAC-SHA1 the resulting string with the Auth Token as the key
//   4. Base64-encode the binary digest
//
// IMPORTANT: This file is import-free of runtime globals so vitest
// (running under Node) can exercise it directly. Node 20+ exposes
// crypto.subtle + btoa as globals, matching the edge runtime API.
// ═══════════════════════════════════════════════════════════════

/** Compute Twilio's X-Twilio-Signature value for a given URL +
 * form params + auth token. Returns the base64 signature string.
 * Async because crypto.subtle is async. */
export async function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  if (!authToken) {
    throw new Error("computeTwilioSignature: authToken required");
  }
  // 1+2: build the canonical signing payload.
  const sortedKeys = Object.keys(params).sort();
  let dataToSign = url;
  for (const k of sortedKeys) dataToSign += k + params[k];

  // 3: HMAC-SHA1.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(dataToSign),
  );

  // 4: base64-encode.
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
}

/** Encode a form-params object as application/x-www-form-urlencoded
 * (the body Twilio sends and our handler expects). */
export function encodeFormBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}
