// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio SMS Sender (Edge Function) — HARDENED
// ─────────────────────────────────────────────────────────────
// Sends SMS via Twilio. Prior version had two critical gaps:
//   1. No authentication — the anon key (which ships in the mobile
//      app and web bundle) was enough to send an SMS to any number.
//      A leaked anon key = uncapped Twilio bill.
//   2. No rate limiting — a single abuser could spam hundreds of
//      messages a minute.
//
// This version:
//   • Requires a JWT (auth gate before Twilio fan-out). The mobile
//     app already has a session, so this is transparent for real use.
//   • Rate-limited per userId at the "api" tier, with SOS priority
//     lane: any call carrying `type: "sos" | "escalation"` is
//     treated as emergency and never blocked.
//   • Rate-limit headers on every response so the client can
//     self-throttle instead of retrying into a 429 wall.
//
// Cost: ~$0.0079/SMS (US) — less than 1 cent per message
//
// Required Supabase Secrets:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   SOSPHERE_BASE_URL
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (for JWT verification)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkRateLimit,
  getRateLimitHeaders,
} from "../_shared/rate-limiter.ts";
import { clientIp } from "../_shared/api-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// JWT authentication — returns userId on success, null on failure.
// We create a fresh client per request rather than hoisting to
// module scope because Edge Function cold-starts can share workers
// across projects and a module-scope client leaks between them.
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth gate (SECURITY-CRITICAL) ────────────────────────
    // Must come before ANY Twilio call — otherwise a leaked anon key
    // is an open-ended SMS spigot on our Twilio bill.
    const userId = await authenticate(req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: "Valid Bearer token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const {
      to,           // Recipient phone: "+966XXXXXXXXX"
      from,         // Twilio number: "+1XXXXXXXXXX"
      callId,       // Emergency ID: "EMG-ABC123"
      employeeName, // "Ahmed Ali"
      companyName,  // "SOSphere"
      zoneName,     // "Zone B - North Tower"
      priority,     // "emergency" | "urgent" | "normal"
      type,         // "sos" | "broadcast" | "escalation"
      customMessage,// Optional custom text
    } = await req.json();

    if (!to || !from) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, from" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Rate limit (SOS lane applies to sos/escalation types) ─
    // Emergency SMS flows inherit the SOS priority lane, so they
    // are never blocked even under sustained load. Non-emergency
    // broadcast messages go through the normal "api" tier limit.
    const isSos = type === "sos" || type === "escalation";
    const rl = checkRateLimit(userId, "api", isSos);
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

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const baseUrl = Deno.env.get("SOSPHERE_BASE_URL") || "https://sosphere-platform.vercel.app";

    if (!accountSid || !authToken) {
      return new Response(
        JSON.stringify({ error: "Twilio credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build SMS message based on type
    let body: string;

    if (customMessage) {
      // Custom broadcast message
      body = `[${companyName || "SOSphere"}] ${customMessage}`;
      if (callId) {
        body += `\n\nView: ${baseUrl}/emergency/${callId}`;
      }
    } else if (type === "sos" || type === "escalation") {
      // SOS emergency SMS
      const emoji = priority === "emergency" ? "🚨" : "⚠️";
      body = [
        `${emoji} SOS ALERT — ${companyName || "SOSphere"}`,
        ``,
        `Employee: ${employeeName || "Unknown"}`,
        `Location: ${zoneName || "Unknown Zone"}`,
        `Priority: ${(priority || "emergency").toUpperCase()}`,
        ``,
        `Open Dashboard:`,
        `${baseUrl}/emergency/${callId || ""}`,
        ``,
        `This is an automated emergency alert.`,
      ].join("\n");
    } else {
      // General broadcast SMS
      body = [
        `[${companyName || "SOSphere"}] ${priority === "emergency" ? "🚨 EMERGENCY" : "📢 Alert"}`,
        ``,
        employeeName ? `From: ${employeeName}` : "",
        zoneName ? `Zone: ${zoneName}` : "",
        ``,
        callId ? `View: ${baseUrl}/broadcast/${callId}` : "",
      ].filter(Boolean).join("\n");
    }

    // Truncate to SMS limit (1600 chars for Twilio, but keep under 320 for cost)
    if (body.length > 320) {
      body = body.substring(0, 310) + `...\n${baseUrl}`;
    }

    // Send SMS via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = btoa(`${accountSid}:${authToken}`);

    const formData = new URLSearchParams({
      To: to,
      From: from,
      Body: body,
    });

    // Optional: status callback for delivery tracking
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (supabaseUrl) {
      formData.append("StatusCallback", `${supabaseUrl}/functions/v1/twilio-status?type=sms&callId=${callId || ""}`);
    }

    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[twilio-sms] Twilio API error:", result);
      return new Response(
        JSON.stringify({ error: "SMS send failed", detail: result.message || result }),
        {
          status: response.status,
          headers: { ...corsHeaders, ...getRateLimitHeaders(rl), "Content-Type": "application/json" },
        },
      );
    }

    console.log(`[twilio-sms] SMS sent: ${result.sid} → ${to} (type: ${type || "general"}, user=${userId}, from ip=${clientIp(req)})`);

    return new Response(
      JSON.stringify({
        messageSid: result.sid,
        status: result.status,
        to: result.to,
        from: result.from,
        segments: result.num_segments, // Each segment ~$0.0079
        callId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, ...getRateLimitHeaders(rl), "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[twilio-sms] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
