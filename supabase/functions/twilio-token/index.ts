// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio Token Generator (Edge Function)
// Generates Access Token for Twilio Voice SDK (browser calls)
//
// Browser ↔ Browser calls are FREE (data only, no PSTN).
// This is Level 2 of the escalation chain.
//
// Required Supabase Secrets:
//   TWILIO_ACCOUNT_SID
//   TWILIO_API_KEY_SID
//   TWILIO_API_KEY_SECRET
//   TWILIO_TWIML_APP_SID
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkRateLimit,
  getRateLimitHeaders,
} from "../_shared/rate-limiter.ts";

// B-M1: origin allowlist via ALLOWED_ORIGINS env
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}
function buildCorsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// JWT gate — without this, anyone with the anon key could mint a
// 1-hour Twilio voice token and burn through the account's voice
// minutes. The token itself is identity-bound (Twilio signs with
// our secret), but identity is client-supplied, so the only
// defense against abuse is requiring a real user session here.
async function authenticate(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  if (!SUPA_URL || !SUPA_KEY) return null;
  const jwt = authHeader.replace("Bearer ", "");
  try {
    const supabase = createClient(SUPA_URL, SUPA_KEY);
    const { data: { user }, error } = await supabase.auth.getUser(jwt);
    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

// Twilio JWT generation (manual — no npm dependency needed)
function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlStr(str: string): string {
  return base64url(new TextEncoder().encode(str));
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64url(new Uint8Array(sig));
}

async function createTwilioToken(
  accountSid: string,
  apiKeySid: string,
  apiKeySecret: string,
  twimlAppSid: string,
  identity: string,
  ttl: number = 3600,
): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttl;

  // Twilio Access Token structure
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };

  const grants: Record<string, any> = {
    identity,
    voice: {
      incoming: { allow: true },
      outgoing: { application_sid: twimlAppSid },
    },
  };

  const payload = {
    jti: `${apiKeySid}-${now}`,
    iss: apiKeySid,
    sub: accountSid,
    iat: now,
    exp: expiresAt,
    grants,
  };

  const headerB64 = base64urlStr(JSON.stringify(header));
  const payloadB64 = base64urlStr(JSON.stringify(payload));
  const signature = await hmacSign(apiKeySecret, `${headerB64}.${payloadB64}`);

  return {
    token: `${headerB64}.${payloadB64}.${signature}`,
    expiresAt,
  };
}

serve(async (req) => {
  // B-M1: origin allowlist via ALLOWED_ORIGINS env
  const corsHeaders = buildCorsHeaders(req);
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth gate (SECURITY-CRITICAL) ────────────────────────
    const userId = await authenticate(req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: "Valid Bearer token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Rate limit (auth tier — token minting is costly by proxy) ──
    // We use the auth tier (10/min) rather than api (60/min) because
    // a legitimate client refreshes the token ~once per hour. Anyone
    // hitting this endpoint more than a few times a minute is trying
    // to brute-force identities.
    const rl = checkRateLimit(userId, "auth", false);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000),
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            ...getRateLimitHeaders(rl),
            "Content-Type": "application/json",
          },
        },
      );
    }

    const { identity } = await req.json();

    // DD-6 (2026-04-27): identity length cap. Twilio identity is meant to
    // be a short stable handle (typically the user's uid). Anything over
    // 256 chars is a payload-fuzzing or DoS probe — reject early.
    if (typeof identity !== "string" || identity.length === 0 || identity.length > 256) {
      return new Response(
        JSON.stringify({ error: "identity is required (1..256 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Read secrets from environment
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID");
    const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET");
    const twimlAppSid = Deno.env.get("TWILIO_TWIML_APP_SID");

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      return new Response(
        JSON.stringify({
          error: "Twilio not configured",
          missing: [
            !accountSid && "TWILIO_ACCOUNT_SID",
            !apiKeySid && "TWILIO_API_KEY_SID",
            !apiKeySecret && "TWILIO_API_KEY_SECRET",
            !twimlAppSid && "TWILIO_TWIML_APP_SID",
          ].filter(Boolean),
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { token, expiresAt } = await createTwilioToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
      twimlAppSid,
      identity,
      3600, // 1 hour
    );

    // DD-3 (2026-04-27): no identity / userId in production logs (PII guard).
    console.log(`[twilio-token] Token generated (caller=${userId.slice(0,8)}…)`);

    return new Response(
      JSON.stringify({ token, expiresAt, identity }),
      {
        status: 200,
        headers: { ...corsHeaders, ...getRateLimitHeaders(rl), "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    // DD-1 (2026-04-27): full error logged server-side ONLY. Client gets
    // an opaque message + a request id for support correlation. Stack
    // traces / internal paths must never reach untrusted clients.
    const reqId = "rq-" + Math.random().toString(36).slice(2, 10);
    console.error(`[twilio-token] [${reqId}] Error:`, err);
    return new Response(
      JSON.stringify({ error: "Internal server error", request_id: reqId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
