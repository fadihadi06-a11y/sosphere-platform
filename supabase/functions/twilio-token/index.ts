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

// CORS headers for browser requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { identity } = await req.json();

    if (!identity) {
      return new Response(
        JSON.stringify({ error: "identity is required" }),
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

    console.log(`[twilio-token] Token generated for identity: ${identity}`);

    return new Response(
      JSON.stringify({ token, expiresAt, identity }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[twilio-token] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
