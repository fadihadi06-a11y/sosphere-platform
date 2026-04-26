// ═══════════════════════════════════════════════════════════════════════════
// _shared/gather-token — self-signed token for Twilio <Gather> callbacks
// ─────────────────────────────────────────────────────────────────────────
// 2026-04-25 (B-09): the prior code in twilio-status skipped the Twilio
//   X-Twilio-Signature check for `action=gather` because the team
//   originally believed Twilio could not sign that URL. An attacker on
//   the public internet could therefore POST a forged gather payload
//   (Digits=1, plus arbitrary `From` / `Called` / `adminPhone` query
//   params) and reroute escalation SMS / calls.
//
// Fix: emit our own short-lived HMAC-SHA256 token in the Gather action
//   URL when twilio-call builds the TwiML. twilio-status then requires
//   the token to be present + valid before processing any gather
//   payload. The token binds:
//     - the call_id (so a token issued for callA can't drive callB)
//     - an expiry timestamp (default 30 minutes — well past any sane
//       human IVR response window but short enough to prevent replay)
//
// Token format: `expiry_unix.hmac_base64url`
//   - expiry_unix: ASCII decimal seconds
//   - hmac:        HMAC-SHA256(`g:${callId}:${expiry}`, SECRET)
//                  encoded url-safe base64 with no padding
//
// Secret: GATHER_TOKEN_SECRET env var if set; otherwise reuses
//   TWILIO_AUTH_TOKEN (which is already a strong shared secret known
//   only to the SOSphere edge functions). Falling back to the Twilio
//   auth token ensures the fix works on existing deployments without
//   a new env var; operators may rotate to a dedicated secret later.
// ═══════════════════════════════════════════════════════════════════════════

const TOKEN_TTL_SECONDS = 30 * 60; // 30 minutes — IVR window + buffer

function getSecret(): string {
  const dedicated = Deno.env.get("GATHER_TOKEN_SECRET");
  if (dedicated && dedicated.length >= 16) return dedicated;
  const fallback = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
  return fallback;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64urlEncode(new Uint8Array(sig));
}

/**
 * Issue a gather token for a given call. Returns a string like
 * `1714080000.AbCdEf...`. URL-safe — can be put directly into a
 * TwiML <Gather action="...?gtok=..."> attribute.
 */
export async function signGatherToken(
  callId: string,
  ttlSeconds: number = TOKEN_TTL_SECONDS,
): Promise<string> {
  if (!callId) throw new Error("signGatherToken: callId required");
  const secret = getSecret();
  if (!secret) throw new Error("signGatherToken: no secret available");
  const expiry = Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds);
  const mac = await hmacSign(`g:${callId}:${expiry}`, secret);
  return `${expiry}.${mac}`;
}

/**
 * Verify a gather token against the call it was supposed to be issued
 * for. Returns { ok: true } when:
 *   - format is correct
 *   - expiry hasn't passed
 *   - HMAC matches with constant-time comparison
 * Otherwise returns { ok: false, reason }.
 */
export async function verifyGatherToken(
  token: string | null | undefined,
  callId: string | null | undefined,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!token) return { ok: false, reason: "missing_token" };
  if (!callId) return { ok: false, reason: "missing_callId" };
  const secret = getSecret();
  if (!secret) return { ok: false, reason: "secret_unavailable" };

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed_token" };
  }
  const expiryStr = token.slice(0, dot);
  const providedMac = token.slice(dot + 1);
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry <= 0) {
    return { ok: false, reason: "malformed_expiry" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (expiry < now) return { ok: false, reason: "expired" };

  const expectedMac = await hmacSign(`g:${callId}:${expiry}`, secret);

  // Constant-time comparison
  if (expectedMac.length !== providedMac.length) {
    return { ok: false, reason: "mac_length_mismatch" };
  }
  let diff = 0;
  for (let i = 0; i < expectedMac.length; i++) {
    diff |= expectedMac.charCodeAt(i) ^ providedMac.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, reason: "mac_mismatch" };
  return { ok: true };
}
