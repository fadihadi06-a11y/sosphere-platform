// ═══════════════════════════════════════════════════════════════
// SOSphere — Push edge function source-pinning (BLOCKER #19)
// ─────────────────────────────────────────────────────────────
// Pins the contract for the server-side push notification dispatcher
// (supabase/functions/send-push-notification/index.ts).
//
// HISTORY:
//   • Original (FCM era): used Firebase Cloud Messaging HTTP v1.
//   • PIVOT 2026-04-30: replaced with native Web Push protocol
//     (RFC 8030 / RFC 8291 / RFC 8292). FCM rejected our API key with
//     persistent 401 UNAUTHENTICATED despite all visible Cloud Console
//     settings being correct. Pivoting to the W3C standard removed
//     the dependency entirely.
//
// This test file was rewritten 2026-05-08 to track the Web Push
// implementation. The CONTRACTS are preserved verbatim (auth model,
// token cleanup, audit trail, env-var safe defaults) — only the
// underlying assertions changed to match Web Push patterns.
//
// If a future refactor:
//   • removes the JWT auth on calls (anyone could push to anyone)
//   • removes the per-target authorization (cross-tenant push abuse)
//   • removes UUID validation on targetUserId (id enumeration)
//   • removes token deactivation on 404/410 (infinite retries)
//   • removes the VAPID_CONFIGURED early-exit (deploy crashes when
//     env vars are missing, instead of the call site swallowing 503)
//   • removes the audit_log write (no compliance trail for sent pushes)
//   • drops the VAPID JWT cache (every send re-signs, wasted CPU)
// …this test fails and the regression is caught.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let edgeFnSrc = "";

beforeAll(() => {
  const cwd = process.cwd();
  edgeFnSrc = fs.readFileSync(
    path.resolve(cwd, "supabase/functions/send-push-notification/index.ts"),
    "utf8",
  );
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / config + safe defaults", () => {
  it("declares the 3 VAPID env vars (PUBLIC_KEY, PRIVATE_KEY, SUBJECT)", () => {
    expect(edgeFnSrc).toContain("VAPID_PUBLIC_KEY");
    expect(edgeFnSrc).toContain("VAPID_PRIVATE_KEY");
    expect(edgeFnSrc).toContain("VAPID_SUBJECT");
  });

  it("has a single VAPID_CONFIGURED truthiness check derived from both keys", () => {
    expect(edgeFnSrc).toMatch(
      /VAPID_CONFIGURED\s*=\s*!!\(\s*VAPID_PUBLIC_KEY\s*&&\s*VAPID_PRIVATE_KEY\s*\)/,
    );
  });

  it("returns 503 with reason='vapid_not_configured' when env vars missing", () => {
    expect(edgeFnSrc).toMatch(/!VAPID_CONFIGURED/);
    expect(edgeFnSrc).toContain('"vapid_not_configured"');
    expect(edgeFnSrc).toMatch(/status:\s*503/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / VAPID JWT signing + caching (RFC 8292)", () => {
  it("caches signed JWTs in a per-audience map keyed by expiry", () => {
    expect(edgeFnSrc).toMatch(/_cachedJwts\s*=\s*new\s+Map/);
    expect(edgeFnSrc).toMatch(/expiresAt/);
  });

  it("signs JWT with ECDSA P-256 + SHA-256 (ES256) — required by RFC 8292", () => {
    expect(edgeFnSrc).toMatch(/alg:\s*"ES256"/);
    expect(edgeFnSrc).toMatch(/name:\s*"ECDSA"/);
    expect(edgeFnSrc).toMatch(/namedCurve:\s*"P-256"/);
    expect(edgeFnSrc).toMatch(/hash:\s*"SHA-256"/);
  });

  it("uses 'mailto:' or https subject (RFC 8292 § 2.1)", () => {
    expect(edgeFnSrc).toMatch(/sub:\s*VAPID_SUBJECT/);
    expect(edgeFnSrc).toContain("mailto:");
  });

  it("JWT expires within 24 hours (RFC 8292 max — we use 6h)", () => {
    expect(edgeFnSrc).toMatch(/exp\s*=\s*now\s*\+\s*6\s*\*\s*3600/);
  });

  it("caches private key import for hot-path performance", () => {
    expect(edgeFnSrc).toMatch(/_cachedPrivateKey/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / Web Push aes128gcm encryption (RFC 8188 / RFC 8291)", () => {
  it("uses Content-Encoding: aes128gcm header (RFC 8188 § 2)", () => {
    expect(edgeFnSrc).toMatch(/"Content-Encoding":\s*"aes128gcm"/);
  });

  it("uses VAPID Authorization header format 'vapid t=<JWT>, k=<PUBLIC>'", () => {
    expect(edgeFnSrc).toMatch(/"Authorization":\s*"vapid t=" \+ jwt \+ ", k=" \+ VAPID_PUBLIC_KEY/);
  });

  it("derives content-encryption key via HKDF-Extract+Expand (RFC 5869)", () => {
    // The implementation has a hand-rolled hkdfExpand because WebCrypto's
    // built-in HKDF couples Extract+Expand — must keep separation.
    expect(edgeFnSrc).toMatch(/function\s+hkdfExpand/);
    expect(edgeFnSrc).toMatch(/function\s+hmacSha256/);
  });

  it("generates ephemeral ECDH P-256 keypair per message (RFC 8291 § 3.4)", () => {
    expect(edgeFnSrc).toMatch(
      /generateKey\(\s*\{\s*name:\s*"ECDH",\s*namedCurve:\s*"P-256"\s*\}/,
    );
    expect(edgeFnSrc).toMatch(/deriveBits/);
  });

  it("uses AES-GCM with 12-byte nonce, 16-byte CEK (RFC 8188)", () => {
    expect(edgeFnSrc).toMatch(/hkdfExpand[\s\S]*"Content-Encoding: aes128gcm\\0"[\s\S]*16\)/);
    expect(edgeFnSrc).toMatch(/hkdfExpand[\s\S]*"Content-Encoding: nonce\\0"[\s\S]*12\)/);
    expect(edgeFnSrc).toMatch(/AES-GCM/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / authorization model (defence in depth)", () => {
  it("requires a JWT (no anon push)", () => {
    expect(edgeFnSrc).toMatch(/!jwt/);
    expect(edgeFnSrc).toContain('"Missing token"');
  });

  it("validates targetUserId as a UUID (id-enumeration defence)", () => {
    expect(edgeFnSrc).toMatch(/UUID_RE\s*=\s*\//);
    expect(edgeFnSrc).toMatch(/UUID_RE\.test\(targetUserId\)/);
  });

  it("title and body are bounded (anti-payload-abuse)", () => {
    expect(edgeFnSrc).toMatch(/title\.length\s*>\s*200/);
    expect(edgeFnSrc).toMatch(/messageBody\.length\s*>\s*1000/);
  });

  it("self-push always allowed (caller === target)", () => {
    expect(edgeFnSrc).toMatch(/callerUserId\s*!==\s*targetUserId/);
  });

  it("cross-user push requires shared company_membership", () => {
    expect(edgeFnSrc).toMatch(/sharedCompany/);
    expect(edgeFnSrc).toMatch(/from\("company_memberships"\)/);
  });

  it("returns 403 when authorization fails", () => {
    expect(edgeFnSrc).toContain('"Not authorized to push to this user"');
    expect(edgeFnSrc).toMatch(/!sharedCompany[\s\S]{0,200}status:\s*403/);
  });

  it("service-role bypasses per-target authorization (internal calls)", () => {
    expect(edgeFnSrc).toMatch(/isServiceRole\s*=\s*\(\s*jwt\s*===\s*SUPA_SERVICE_ROLE\s*\)/);
    expect(edgeFnSrc).toMatch(/!isServiceRole\s*&&\s*callerUserId/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / token lifecycle (dead-token cleanup)", () => {
  it("deactivates tokens on HTTP 404 / 410 (RFC 8030 § 7.3 — endpoint gone)", () => {
    // Web Push servers return 404 (subscription not found) or 410 (gone)
    // for permanently-dead endpoints. These map to the FCM-era
    // UNREGISTERED / NOT_FOUND statuses 1:1 — the contract is preserved,
    // only the wire signal changed.
    expect(edgeFnSrc).toMatch(/res\.status\s*===\s*404\s*\|\|\s*res\.status\s*===\s*410/);
    expect(edgeFnSrc).toMatch(/is_active:\s*false/);
    expect(edgeFnSrc).toMatch(/result\.dead/);
  });

  it("only marks tokens dead — never deletes the row (forensic trail)", () => {
    // The push_tokens row stays, just is_active=false. This preserves
    // history for compliance + lets ops audit churn rates.
    expect(edgeFnSrc).toMatch(
      /from\("push_tokens"\)\s*\.update\(\s*\{\s*is_active:\s*false/,
    );
    expect(edgeFnSrc).not.toMatch(/from\("push_tokens"\)\s*\.delete/);
  });

  it("query filters by is_active=true so dead tokens never receive (graceful)", () => {
    expect(edgeFnSrc).toMatch(/from\("push_tokens"\)[\s\S]*\.eq\(\s*"is_active",\s*true\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / audit trail + observability", () => {
  it("writes audit_log row with action=push_notification_sent", () => {
    expect(edgeFnSrc).toMatch(/from\("audit_log"\)[\s\S]*?\.insert/);
    expect(edgeFnSrc).toMatch(/action:\s*"push_notification_sent"/);
  });

  it("audit metadata captures sent_count, failed_count, transport identifier", () => {
    expect(edgeFnSrc).toMatch(/sent_count:/);
    expect(edgeFnSrc).toMatch(/failed_count:/);
    expect(edgeFnSrc).toMatch(/transport:\s*"web-push-aes128gcm"/);
  });

  it("audit row preserves caller distinction (service_role vs user)", () => {
    expect(edgeFnSrc).toMatch(/is_service_role:\s*isServiceRole/);
    expect(edgeFnSrc).toMatch(/actor_role:\s*isServiceRole\s*\?\s*"system"\s*:\s*"user"/);
  });

  it("audit failure is non-fatal (best-effort, never blocks send)", () => {
    expect(edgeFnSrc).toMatch(
      /catch\s*\(\s*err\s*\)\s*\{[\s\S]*?audit_log[\s\S]*?failed/,
    );
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / response shape + CORS hygiene", () => {
  it("response includes sent_count + failed_count + target_token_count", () => {
    expect(edgeFnSrc).toMatch(/sent_count:\s*sentCount/);
    expect(edgeFnSrc).toMatch(/failed_count:\s*failedCount/);
    expect(edgeFnSrc).toMatch(/target_token_count:\s*tokens\.length/);
  });

  it("CORS allowlist driven by ALLOWED_ORIGINS env (no wildcard)", () => {
    expect(edgeFnSrc).toMatch(/ALLOWED_ORIGINS\.includes\(origin\)/);
    expect(edgeFnSrc).not.toMatch(/Access-Control-Allow-Origin"\s*:\s*"\*"/);
  });

  it("OPTIONS preflight returns 200 with CORS headers", () => {
    expect(edgeFnSrc).toMatch(/req\.method\s*===\s*"OPTIONS"/);
  });

  it("only POST is accepted; other methods get 405", () => {
    expect(edgeFnSrc).toMatch(/status:\s*405/);
    expect(edgeFnSrc).toContain('"Method not allowed"');
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / partial failure tolerance", () => {
  it("iterates per-token, never aborts on first failure (continues to next)", () => {
    // The for-loop must not have a thrown error escape; one bad token
    // can't black-hole pushes for the other registrations.
    expect(edgeFnSrc).toMatch(/for\s*\(\s*const\s+t\s+of\s+tokens\s*\)/);
    expect(edgeFnSrc).toMatch(/sentCount\+\+/);
    expect(edgeFnSrc).toMatch(/failedCount\+\+/);
  });

  it("returns 200 even when all sends fail (the API call succeeded; sends are async)", () => {
    // 200 + sent_count=0 + failed_count=N is the right response — the
    // push API succeeded, the asynchronous deliveries didn't. Anything
    // else makes the caller mistake transient delivery failure for
    // backend outage. The sent_count is in the response BODY, status 200
    // is in the Response options arg that follows it.
    expect(edgeFnSrc).toMatch(/sent_count:\s*sentCount[\s\S]{0,300}status:\s*200/);
  });
});
