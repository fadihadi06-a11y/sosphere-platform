// ═══════════════════════════════════════════════════════════════
// SOSphere — FCM push edge function source-pinning (BLOCKER #19)
// ─────────────────────────────────────────────────────────────
// Pins the contract for the server-side push notification dispatcher
// (supabase/functions/send-push-notification/index.ts).
//
// The function exists so we can deliver push notifications without
// shipping the Firebase Admin SDK (which doesn't run cleanly on Deno
// Edge Functions). It signs an OAuth2 JWT, exchanges it for an access
// token, and POSTs to Firebase Cloud Messaging HTTP v1.
//
// If a future refactor:
//   • removes the JWT auth (anyone could push to anyone)
//   • removes the per-target authorization (cross-tenant push abuse)
//   • removes UUID validation on targetUserId (id enumeration)
//   • removes token deactivation on UNREGISTERED (infinite retries)
//   • removes the FCM_CONFIGURED early-exit (deploy crashes when env
//     vars are missing, instead of the call site swallowing 503)
//   • removes the audit_log write (no compliance trail for sent pushes)
//   • drops the OAuth2 token cache (every send re-signs a JWT — wasted
//     CPU and exhausted Google token endpoint quota)
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
  it("declares the 3 FCM env vars (PROJECT_ID, SERVICE_ACCOUNT_EMAIL, SERVICE_ACCOUNT_KEY)", () => {
    expect(edgeFnSrc).toContain("FCM_PROJECT_ID");
    expect(edgeFnSrc).toContain("FCM_SERVICE_ACCOUNT_EMAIL");
    expect(edgeFnSrc).toContain("FCM_SERVICE_ACCOUNT_KEY");
  });

  it("has a single FCM_CONFIGURED truthiness check derived from all 3 vars", () => {
    expect(edgeFnSrc).toContain("FCM_CONFIGURED");
    expect(edgeFnSrc).toContain("!!(FCM_PROJECT_ID && FCM_SERVICE_ACCOUNT_EMAIL && FCM_SERVICE_ACCOUNT_KEY)");
  });

  it("returns 503 with reason='fcm_not_configured' when env vars missing", () => {
    // Caller can swallow the 503 cleanly; the Firebase setup step
    // is OPTIONAL post-deploy, NOT a blocker for the function deploying.
    expect(edgeFnSrc).toContain('error: "fcm_not_configured"');
    expect(edgeFnSrc).toMatch(/!FCM_CONFIGURED[\s\S]{0,300}status: 503/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / OAuth2 access-token caching", () => {
  it("caches token in module memory keyed by expiry", () => {
    expect(edgeFnSrc).toContain("_cachedToken");
    expect(edgeFnSrc).toMatch(/_cachedToken\.expiresAt > now \+ 60/);
  });

  it("signs JWT with RSASSA-PKCS1-v1_5 + SHA-256 (RS256)", () => {
    expect(edgeFnSrc).toContain("RSASSA-PKCS1-v1_5");
    expect(edgeFnSrc).toContain('"SHA-256"');
    expect(edgeFnSrc).toMatch(/alg:\s*"RS256"/);
  });

  it("uses correct OAuth2 grant_type (jwt-bearer)", () => {
    expect(edgeFnSrc).toContain("urn:ietf:params:oauth:grant-type:jwt-bearer");
  });

  it("uses correct OAuth2 scope (firebase.messaging)", () => {
    expect(edgeFnSrc).toContain("https://www.googleapis.com/auth/firebase.messaging");
  });

  it("base64url-encodes header/claims (no padding, dash/underscore)", () => {
    // The OAuth2 JWT MUST use base64url, not standard base64. A regression
    // that uses standard base64 produces "Invalid JWT signature" from Google.
    expect(edgeFnSrc).toMatch(/replace\(\/=\/g, ""\)\.replace\(\/\\\+\/g, "-"\)\.replace\(\/\\\/\/g, "_"\)/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / FCM HTTP v1 message API", () => {
  it("posts to /v1/projects/{PROJECT_ID}/messages:send", () => {
    expect(edgeFnSrc).toContain("https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send");
  });

  it("uses Bearer access_token in the Authorization header", () => {
    expect(edgeFnSrc).toMatch(/Authorization:\s*`Bearer \$\{params\.accessToken\}`/);
  });

  it("payload includes notification + data + android.priority=high", () => {
    expect(edgeFnSrc).toContain("notification:");
    expect(edgeFnSrc).toMatch(/priority:\s*"high"/);
    expect(edgeFnSrc).toContain('channel_id: "sosphere_emergency"');
  });

  it("includes APNS payload for iOS sound + content-available", () => {
    expect(edgeFnSrc).toContain("apns:");
    expect(edgeFnSrc).toContain('"content-available": 1');
  });

  it("string-coerces data fields (FCM v1 requires strings only)", () => {
    expect(edgeFnSrc).toMatch(/typeof v === "string" \? v : JSON\.stringify\(v\)/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / authorization model (defence in depth)", () => {
  it("requires a JWT (no anon push)", () => {
    expect(edgeFnSrc).toContain("Missing token");
    expect(edgeFnSrc).toContain("Bearer");
  });

  it("validates targetUserId as a UUID (id-enumeration defence)", () => {
    expect(edgeFnSrc).toContain("UUID_RE");
    expect(edgeFnSrc).toContain("Invalid targetUserId");
  });

  it("title and body are bounded (anti-payload-abuse)", () => {
    expect(edgeFnSrc).toMatch(/title.*length > 200/);
    expect(edgeFnSrc).toMatch(/messageBody.*length > 1000/);
  });

  it("self-push always allowed (caller === target)", () => {
    expect(edgeFnSrc).toMatch(/callerUserId !== targetUserId/);
  });

  it("cross-user push requires shared company_membership", () => {
    expect(edgeFnSrc).toMatch(/from\("company_memberships"\)[\s\S]{0,500}\.eq\("user_id", callerUserId\)/);
    expect(edgeFnSrc).toContain("sharedCompany");
  });

  it("returns 403 when authorization fails", () => {
    expect(edgeFnSrc).toContain('"Not authorized to push to this user"');
    expect(edgeFnSrc).toMatch(/sharedCompany && !isContact[\s\S]{0,200}status: 403/);
  });

  it("service-role bypasses per-target authorization (internal calls)", () => {
    // sos-alert needs to be able to push to contacts/buddies that the
    // user being SOS'd hasn't explicitly added to their company.
    expect(edgeFnSrc).toContain("isServiceRole");
    expect(edgeFnSrc).toContain("jwt === SUPA_SERVICE_ROLE");
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / token lifecycle (dead-token cleanup)", () => {
  it("queries push_tokens by user_id + is_active=true", () => {
    expect(edgeFnSrc).toMatch(/from\("push_tokens"\)[\s\S]{0,200}\.eq\("user_id", targetUserId\)[\s\S]{0,200}\.eq\("is_active", true\)/);
  });

  it("returns 200 with sent_count=0 (not error) when no tokens exist", () => {
    // A user with no push setup is normal, not an error condition.
    expect(edgeFnSrc).toMatch(/No active push tokens for target user/);
  });

  it("deactivates tokens on UNREGISTERED / 404 / INVALID_ARGUMENT", () => {
    expect(edgeFnSrc).toContain("UNREGISTERED|INVALID_ARGUMENT");
    expect(edgeFnSrc).toMatch(/is_active: false/);
    expect(edgeFnSrc).toMatch(/result\.tokenInvalid/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / observability & security hardening", () => {
  it("writes audit_log entry with action='push_notification_sent'", () => {
    expect(edgeFnSrc).toContain('action: "push_notification_sent"');
    expect(edgeFnSrc).toContain('category: "communications"');
  });

  it("audit body_preview is truncated to 80 chars (PII minimization)", () => {
    expect(edgeFnSrc).toMatch(/body_preview: messageBody\.slice\(0, 80\)/);
  });

  it("audit failures list is truncated to 5 entries (response size cap)", () => {
    expect(edgeFnSrc).toMatch(/failures\.slice\(0, 5\)/);
  });

  it("CORS uses an allowlist (not wildcard)", () => {
    expect(edgeFnSrc).toContain("ALLOWED_ORIGINS");
    expect(edgeFnSrc).not.toMatch(/Access-Control-Allow-Origin.*\*/);
  });

  it("does not log private key or service account key to console", () => {
    // Defensive: a dev who debugs by console.log-ing FCM_SERVICE_ACCOUNT_KEY
    // would expose the private key in Supabase logs forever.
    expect(edgeFnSrc).not.toMatch(/console\.[a-z]+\([^)]*FCM_SERVICE_ACCOUNT_KEY/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #19 / promise-of-no-leak guards", () => {
  it("never trusts callerUserId from request body — only from JWT", () => {
    // The body is parsed AFTER auth; callerUserId comes from
    // userClient.auth.getUser(). A regression that reads it from body
    // would be a cross-tenant impersonation vector.
    expect(edgeFnSrc).toMatch(/userClient\.auth\.getUser\(\)/);
    expect(edgeFnSrc).not.toMatch(/body\.callerUserId|body\.caller_user_id/);
  });

  it("explicitly imports admin client only after authorization branch", () => {
    // Defence-in-depth: even though the admin client only reads
    // push_tokens / company_memberships, we want it created AFTER the
    // body has been validated and (for non-service-role) after auth.
    const adminCreate = edgeFnSrc.indexOf('createClient(SUPA_URL, SUPA_SERVICE_ROLE');
    const bodyParse = edgeFnSrc.indexOf("await req.json()");
    expect(bodyParse).toBeGreaterThan(0);
    expect(adminCreate).toBeGreaterThan(bodyParse);
  });
});
