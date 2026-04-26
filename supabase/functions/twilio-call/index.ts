// SOSphere twilio-call edge function
// v9 (B-09 2026-04-25): emits gtok in <Gather>
// v10 (B-20 2026-04-25): fixes G-15 (client-supplied `from` -> caller-ID
//                        spoof) and G-16 (TwiML injection via unescaped
//                        employeeName/companyName/zoneName).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, markSosPriority, getRateLimitHeaders } from "../_shared/rate-limiter.ts";
import { signGatherToken } from "../_shared/gather-token.ts";

function escapeXml(unsafe: string | null | undefined): string {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",").map(s => s.trim()).filter(Boolean);
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

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userId = await authenticate(req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: "Valid Bearer token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { to, callId, employeeName, companyName, zoneName } = await req.json();

    // G-15 (B-20): `from` is server-side only.
    const from = Deno.env.get("TWILIO_FROM_NUMBER") || "";
    if (!from) {
      console.error("[twilio-call] TWILIO_FROM_NUMBER env not configured");
      return new Response(
        JSON.stringify({ error: "Twilio sender number not configured on server" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!to || !callId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, callId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    markSosPriority(userId);
    const rl = checkRateLimit(userId, "api", true);

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken  = Deno.env.get("TWILIO_AUTH_TOKEN");
    const baseUrl    = Deno.env.get("SOSPHERE_BASE_URL") || "https://sosphere-platform.vercel.app";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!accountSid || !authToken) {
      return new Response(
        JSON.stringify({ error: "Twilio credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const gtok = await signGatherToken(callId);

    // G-16 (B-20): escape user-controlled strings before TwiML interpolation.
    const safeEmployee = escapeXml(employeeName || "an employee");
    const safeCompany  = escapeXml(companyName  || "your company");
    const safeZone     = escapeXml(zoneName     || "unknown zone");

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">
    Emergency S.O.S. alert from ${safeEmployee} at ${safeCompany}.
    Location: ${safeZone}.
    Press 1 to connect to the emergency dashboard.
    Press 2 to hear the alert again.
  </Say>
  <Gather numDigits="1" action="${supabaseUrl}/functions/v1/twilio-status?action=gather&amp;callId=${callId}&amp;baseUrl=${encodeURIComponent(baseUrl)}&amp;gtok=${encodeURIComponent(gtok)}" method="POST" timeout="10">
    <Play loop="2">https://api.twilio.com/cowbell.mp3</Play>
  </Gather>
  <Say voice="Polly.Joanna">No response received. The emergency team has been notified. Goodbye.</Say>
</Response>`;

    const statusCallback = `${supabaseUrl}/functions/v1/twilio-status?callId=${callId}`;
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
    const auth = btoa(`${accountSid}:${authToken}`);
    const formData = new URLSearchParams({
      To: to, From: from, Twiml: twiml, StatusCallback: statusCallback,
      StatusCallbackEvent: "initiated ringing answered completed",
      StatusCallbackMethod: "POST", Timeout: "30", MachineDetection: "Enable",
    });
    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("[twilio-call] Twilio API error:", result);
      return new Response(
        JSON.stringify({ error: "Twilio call failed", detail: result.message || result }),
        { status: response.status, headers: { ...corsHeaders, ...getRateLimitHeaders(rl), "Content-Type": "application/json" } },
      );
    }
    console.log(`[twilio-call] Call initiated: ${result.sid} -> ${to} (callId: ${callId}, user=${userId})`);
    return new Response(
      JSON.stringify({ callSid: result.sid, status: result.status, to: result.to, from: result.from, callId }),
      { status: 200, headers: { ...corsHeaders, ...getRateLimitHeaders(rl), "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[twilio-call] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
