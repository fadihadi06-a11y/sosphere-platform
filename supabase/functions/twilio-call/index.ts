// SOSphere — Twilio Voice Call Edge Function
// Handles: POST /functions/v1/twilio-call
// Purpose: Initiate emergency voice calls from mobile app to safety admin
// Security: Validates JWT, enforces rate limits, logs to audit trail

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Rate limit: max 5 calls per user per 10 minutes
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(userId) || []).filter(t => t > now - RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, timestamps);
    return false;
  }
  timestamps.push(now);
  rateLimitMap.set(userId, timestamps);
  return true;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    // Validate JWT from Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401 });
    }
    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 });
    }

    // Rate limit check
    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: "Rate limited. Max 5 calls per 10 minutes." }), { status: 429 });
    }

    // Parse request body
    const { to, emergencyId, callerName, companyId } = await req.json();
    if (!to || !emergencyId) {
      return new Response(JSON.stringify({ error: "Missing required fields: to, emergencyId" }), { status: 400 });
    }

    // Validate phone number format (E.164)
    const cleanPhone = to.replace(/[^+\d]/g, "");
    if (!/^\+\d{7,15}$/.test(cleanPhone)) {
      return new Response(JSON.stringify({ error: "Invalid phone number format. Use E.164 (e.g., +966501234567)" }), { status: 400 });
    }

    // Initiate Twilio call
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`;
    const twimlUrl = `${SUPABASE_URL}/functions/v1/twilio-twiml?emergencyId=${emergencyId}&caller=${encodeURIComponent(callerName || "SOSphere")}`;

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: cleanPhone,
        From: TWILIO_FROM_NUMBER,
        Url: twimlUrl,
        StatusCallback: `${SUPABASE_URL}/functions/v1/twilio-status`,
        StatusCallbackMethod: "POST",
        StatusCallbackEvent: "initiated ringing answered completed",
        Timeout: "30",
        MachineDetection: "Enable",
      }),
    });

    const twilioData = await twilioResponse.json();

    if (!twilioResponse.ok) {
      // Log failure to audit
      await supabase.from("audit_log").insert({
        id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        action: "twilio_call_failed",
        actor: user.id,
        operation: "emergency_call",
        target: cleanPhone,
        created_at: new Date().toISOString(),
        metadata: { error: twilioData.message, emergencyId, companyId },
      });

      return new Response(JSON.stringify({
        error: "Failed to initiate call",
        detail: twilioData.message,
      }), { status: 502 });
    }

    // Log success to audit
    await supabase.from("audit_log").insert({
      id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      action: "twilio_call_initiated",
      actor: user.id,
      operation: "emergency_call",
      target: cleanPhone,
      created_at: new Date().toISOString(),
      metadata: { callSid: twilioData.sid, emergencyId, companyId },
    });

    return new Response(JSON.stringify({
      success: true,
      callSid: twilioData.sid,
      status: twilioData.status,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    }), { status: 500 });
  }
});
