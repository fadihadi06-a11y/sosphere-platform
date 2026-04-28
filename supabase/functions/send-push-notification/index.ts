// ═══════════════════════════════════════════════════════════════════════════
// send-push-notification (BLOCKER #19, 2026-04-28)
//
// Server-side push notification dispatcher using Firebase Cloud Messaging
// HTTP v1 API. Companion to fcm-push.ts (client) which collects device
// tokens into the public.push_tokens table.
//
// WHY HTTP v1 INSTEAD OF FIREBASE ADMIN SDK?
//   • The Admin SDK requires Node bindings that don't run on Deno Edge
//     Functions cleanly. The HTTP v1 REST API works from any HTTP
//     client and supports the same payload shape.
//   • Auth is OAuth2: we sign a JWT with the service account private
//     key, exchange it for a 1-hour access token, cache the token in
//     module memory, and reuse until expiry.
//
// AUTHORIZATION MODEL (defence in depth):
//   The caller must pass a Supabase JWT. We resolve the caller's user_id
//   from the JWT, then verify they're allowed to push to the targetUserId:
//     1) self    — caller === target (notification to your own devices)
//     2) company — caller and target share an active company_membership
//     3) contact — target appears in caller's emergency_contacts
//     4) service-role — bypasses the above (sos-alert internal calls)
//   Anything else returns 403. Never trust target_user_id alone — that
//   would let any logged-in user push to anyone with a known UUID.
//
// FAIL-MODES:
//   • Firebase env vars missing → 503 with clear reason (deploy-time
//     misconfiguration; the call site should swallow this, not crash).
//   • OAuth2 token fetch failure → 503 (transient; retryable).
//   • No push_tokens for target → 200 with sent_count=0 (not an error;
//     user simply hasn't enabled push on any device).
//   • FCM rejects a token (invalid/unregistered) → mark token is_active=false
//     in push_tokens so we don't keep retrying it.
//
// ENVIRONMENT VARIABLES (set via `supabase secrets set`):
//   FCM_PROJECT_ID            — e.g. "sosphere-prod"
//   FCM_SERVICE_ACCOUNT_EMAIL — e.g. "fcm-sender@sosphere-prod.iam.gserviceaccount.com"
//   FCM_SERVICE_ACCOUNT_KEY   — the PEM private key from the service-account JSON
//                               (the "private_key" field, with literal \n escapes)
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPA_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FCM_PROJECT_ID = Deno.env.get("FCM_PROJECT_ID") || "";
const FCM_SERVICE_ACCOUNT_EMAIL = Deno.env.get("FCM_SERVICE_ACCOUNT_EMAIL") || "";
const FCM_SERVICE_ACCOUNT_KEY = Deno.env.get("FCM_SERVICE_ACCOUNT_KEY") || "";

const FCM_CONFIGURED = !!(FCM_PROJECT_ID && FCM_SERVICE_ACCOUNT_EMAIL && FCM_SERVICE_ACCOUNT_KEY);

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",").map((s) => s.trim()).filter(Boolean);

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function buildCors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────────────
// OAuth2 access-token caching. We sign a fresh JWT, exchange for an
// access token (valid 3600s), and cache it in module memory until 60s
// before expiry. Concurrent invocations share the same cached token.
// ─────────────────────────────────────────────────────────────────────────
let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && _cachedToken.expiresAt > now + 60) {
    return _cachedToken.token;
  }

  // Build the JWT for OAuth2 token exchange.
  // Header: { alg: RS256, typ: JWT }
  // Claims: { iss, scope, aud, exp, iat }
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: FCM_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const enc = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const headerB64 = enc(header);
  const claimsB64 = enc(claims);
  const signingInput = `${headerB64}.${claimsB64}`;

  // Import the PEM private key. The env var contains literal \n escapes
  // (because shell-set strings can't carry real newlines).
  const pem = FCM_SERVICE_ACCOUNT_KEY.replace(/\\n/g, "\n");
  const pkcs8 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binaryKey = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const jwt = `${signingInput}.${sigB64}`;

  // Exchange JWT for access token.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`OAuth2 token exchange failed: ${tokenRes.status} ${text}`);
  }
  const tokenData = await tokenRes.json() as { access_token: string; expires_in: number };
  _cachedToken = {
    token: tokenData.access_token,
    expiresAt: now + (tokenData.expires_in || 3600),
  };
  return _cachedToken.token;
}

// ─────────────────────────────────────────────────────────────────────────
// Send a single FCM message. Returns true on accepted, false on rejected.
// On 404/UNREGISTERED we deactivate the token in push_tokens.
// ─────────────────────────────────────────────────────────────────────────
async function sendFcmMessage(params: {
  accessToken: string;
  fcmToken: string;
  title: string;
  body: string;
  data: Record<string, string>;
}): Promise<{ ok: boolean; reason?: string; tokenInvalid?: boolean }> {
  const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
  const payload = {
    message: {
      token: params.fcmToken,
      notification: {
        title: params.title,
        body: params.body,
      },
      data: params.data,
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channel_id: "sosphere_emergency",
        },
      },
      apns: {
        payload: {
          aps: { sound: "default", "content-available": 1 },
        },
      },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true };

  const text = await res.text();
  // FCM error codes: UNREGISTERED / INVALID_ARGUMENT means the token is
  // dead; we should stop retrying it.
  const tokenInvalid = res.status === 404
    || /UNREGISTERED|INVALID_ARGUMENT/i.test(text);
  return { ok: false, reason: `${res.status} ${text.slice(0, 200)}`, tokenInvalid };
}

// ─────────────────────────────────────────────────────────────────────────
// Main handler.
// ─────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  // Fail fast if FCM isn't configured. Edge function still deploys —
  // call sites can detect 503 with reason="fcm_not_configured" and
  // fall back to other channels (SMS, in-app). This makes Firebase
  // setup an OPTIONAL post-deploy step, not a blocker.
  if (!FCM_CONFIGURED) {
    return new Response(
      JSON.stringify({
        error: "fcm_not_configured",
        message: "FCM_PROJECT_ID / FCM_SERVICE_ACCOUNT_EMAIL / FCM_SERVICE_ACCOUNT_KEY env vars are not set on this Supabase project.",
      }),
      { status: 503, headers: CORS },
    );
  }

  // ── 1) Auth ──────────────────────────────────────────────────────
  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Missing token" }), { status: 401, headers: CORS });
  }

  // Detect service-role calls (internal callers like sos-alert) by
  // comparing the JWT to the service-role key. service-role bypasses
  // the per-target authorization check below.
  const isServiceRole = (jwt === SUPA_SERVICE_ROLE);

  let callerUserId: string | null = null;
  if (!isServiceRole) {
    const userClient = createClient(SUPA_URL, SUPA_ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });
    }
    callerUserId = userData.user.id;
  }

  // ── 2) Parse body ────────────────────────────────────────────────
  let body: {
    targetUserId?: string;
    title?: string;
    body?: string;
    data?: Record<string, string>;
  };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: CORS });
  }
  const targetUserId = (body.targetUserId || "").trim();
  const title = (body.title || "").trim();
  const messageBody = (body.body || "").trim();
  const data = body.data || {};

  if (!targetUserId || !UUID_RE.test(targetUserId)) {
    return new Response(JSON.stringify({ error: "Invalid targetUserId" }), { status: 400, headers: CORS });
  }
  if (!title || title.length > 200) {
    return new Response(JSON.stringify({ error: "title required (1-200 chars)" }), { status: 400, headers: CORS });
  }
  if (!messageBody || messageBody.length > 1000) {
    return new Response(JSON.stringify({ error: "body required (1-1000 chars)" }), { status: 400, headers: CORS });
  }

  const admin = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 3) Authorization (only for non-service-role callers) ─────────
  if (!isServiceRole && callerUserId) {
    if (callerUserId !== targetUserId) {
      // Allowed if (a) shared company OR (b) target in caller's emergency_contacts.
      const { data: cm } = await admin
        .from("company_memberships")
        .select("company_id")
        .eq("user_id", callerUserId)
        .eq("active", true);
      const callerCompanies = new Set((cm || []).map((r: any) => r.company_id));

      let sharedCompany = false;
      if (callerCompanies.size > 0) {
        const { data: tm } = await admin
          .from("company_memberships")
          .select("company_id")
          .eq("user_id", targetUserId)
          .eq("active", true);
        sharedCompany = (tm || []).some((r: any) => callerCompanies.has(r.company_id));
      }

      let isContact = false;
      if (!sharedCompany) {
        // emergency_contacts has a phone but no FK to auth.users; we
        // can't reliably resolve "is targetUserId one of caller's
        // contacts?" without phone-number normalisation. For safety
        // we DENY in this branch — if real-world need emerges, add a
        // user_contacts row with an explicit user_id linkage.
        isContact = false;
      }

      if (!sharedCompany && !isContact) {
        return new Response(
          JSON.stringify({ error: "Not authorized to push to this user" }),
          { status: 403, headers: CORS },
        );
      }
    }
  }

  // ── 4) Fetch target's active push tokens ─────────────────────────
  const { data: tokens, error: tokenErr } = await admin
    .from("push_tokens")
    .select("id, token, platform")
    .eq("user_id", targetUserId)
    .eq("is_active", true);
  if (tokenErr) {
    console.warn("[send-push-notification] push_tokens query failed:", tokenErr);
    return new Response(JSON.stringify({ error: "Token lookup failed" }), { status: 500, headers: CORS });
  }
  if (!tokens || tokens.length === 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        sent_count: 0,
        failed_count: 0,
        note: "No active push tokens for target user",
      }),
      { status: 200, headers: CORS },
    );
  }

  // ── 5) Get Google access token + send to each device ─────────────
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken();
  } catch (err) {
    console.error("[send-push-notification] OAuth2 token fetch failed:", err);
    return new Response(
      JSON.stringify({ error: "fcm_oauth_failed", message: String(err).slice(0, 200) }),
      { status: 503, headers: CORS },
    );
  }

  // String-coerce data values (FCM v1 requires string-only data fields).
  const stringData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = typeof v === "string" ? v : JSON.stringify(v);
  }

  let sentCount = 0;
  let failedCount = 0;
  const failures: Array<{ tokenId: string; reason: string }> = [];

  for (const t of tokens) {
    const result = await sendFcmMessage({
      accessToken,
      fcmToken: t.token,
      title,
      body: messageBody,
      data: stringData,
    });
    if (result.ok) {
      sentCount++;
    } else {
      failedCount++;
      failures.push({ tokenId: t.id, reason: result.reason || "unknown" });
      // Deactivate dead tokens so we don't keep retrying them.
      if (result.tokenInvalid) {
        try {
          await admin
            .from("push_tokens")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("id", t.id);
        } catch (e) {
          console.warn("[send-push-notification] token deactivation failed:", e);
        }
      }
    }
  }

  // ── 6) audit_log entry (best-effort) ─────────────────────────────
  try {
    await admin.from("audit_log").insert({
      id: crypto.randomUUID(),
      action: "push_notification_sent",
      actor: isServiceRole ? "service_role" : (callerUserId || "anonymous"),
      actor_id: callerUserId,
      actor_role: isServiceRole ? "system" : "user",
      operation: "PUSH",
      target: targetUserId,
      category: "communications",
      severity: failedCount > 0 ? "warning" : "info",
      metadata: {
        title,
        body_preview: messageBody.slice(0, 80),
        target_user_id: targetUserId,
        sent_count: sentCount,
        failed_count: failedCount,
        failures: failures.slice(0, 5),
        is_service_role: isServiceRole,
      },
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[send-push-notification] audit_log write failed:", err);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      sent_count: sentCount,
      failed_count: failedCount,
      target_token_count: tokens.length,
      failures: failures.slice(0, 5),
    }),
    { status: 200, headers: CORS },
  );
});
