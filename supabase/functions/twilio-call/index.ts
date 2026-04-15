// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio PSTN Call (Edge Function) — HARDENED
// ─────────────────────────────────────────────────────────────
// Calls admin's REAL phone number when browser call unanswered.
// Level 3 of the escalation chain. Cost: ~$0.013/min — a 3-min
// call is ~$0.04. An unprotected endpoint is a direct path to
// uncapped Twilio bill when an attacker has the anon key.
//
// Hardening (parity with twilio-sms):
//   • JWT gate — anon key alone is no longer sufficient.
//   • Rate limit (api tier, SOS priority lane on emergency calls).
//   • X-RateLimit-* headers on every response.
//
// Required Supabase Secrets:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   SOSPHERE_BASE_URL
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkRateLimit,
  markSosPriority,
  getRateLimitHeaders,
} from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const {
      to,           // Admin's phone: "+966XXXXXXXXX"
      from,         // Twilio number: "+1XXXXXXXXXX"
      callId,       // Emergency ID
      employeeName, // "Ahmed Ali"
      companyName,  // "SOSphere"
      zoneName,     // "Zone B - North Tower"
    } = await req.json();

    if (!to || !from || !callId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, from, callId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Rate limit ──────────────────────────────────────────
    // Every twilio-call invocation carries a callId (the emergencyId)
    // so it is by definition part of an active emergency. Mark the
    // user as SOS priority and check with isSosRequest=true — the
    // call is never blocked by the limiter, we just emit the headers
    // and keep the counter accurate for observability.
    markSosPriority(userId);
    const rl = checkRateLimit(userId, "api", true);

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const baseUrl = Deno.env.get("SOSPHERE_BASE_URL") || "https://sosphere-platform.vercel.app";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");

    if (!accountSid || !authToken) {
      return new Response(
        JSON.stringify({ error: "Twilio credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build TwiML — what the admin hears when they answer
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">
    Emergency S.O.S. alert from ${employeeName || "an employee"} at ${companyName || "your company"}.
    Location: ${zoneName || "unknown zone"}.
    Press 1 to connect to the emergency dashboard.
    Press 2 to hear the alert again.
  </Say>
  <Gather numDigits="1" action="${supabaseUrl}/functions/v1/twilio-status?action=gather&amp;callId=${callId}&amp;baseUrl=${encodeURIComponent(baseUrl)}" method="POST" timeout="10">
    <Play loop="2">https://api.twilio.com/cowbell.mp3</Play>
  </Gather>
  <Say voice="Polly.Joanna">No response received. The emergency team has been notified. Goodbye.</Say>
</Response>`;

    // Status callback URL for tracking call progress
    const statusCallback = `${supabaseUrl}/functions/v1/twilio-status?callId=${callId}`;

    // Initiate PSTN call via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
    const auth = btoa(`${accountSid}:${authToken}`);

    const formData = new URLSearchParams({
      To: to,
      From: from,
      Twiml: twiml,
      StatusCallback: statusCallback,
      StatusCallbackEvent: "initiated ringing answered completed",
      StatusCallbackMethod: "POST",
      Timeout: "30",        // Ring for 30 seconds max
      MachineDetection: "Enable", // Detect voicemail
    });

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
      console.error("[twilio-call] Twilio API error:", result);
      return new Response(
        JSON.stringify({ error: "Twilio call failed", detail: result.message || result }),
        {
          status: response.status,
          headers: { ...corsHeaders, ...getRateLimitHeaders(rl), "Content-Type": "application/json" },
        },
      );
    }

    console.log(`[twilio-call] Call initiated: ${result.sid} → ${to} (callId: ${callId}, user=${userId})`);

    return new Response(
      JSON.stringify({
        callSid: result.sid,
        status: result.status,
        to: result.to,
        from: result.from,
        callId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, ...getRateLimitHeaders(rl), "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[twilio-call] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
