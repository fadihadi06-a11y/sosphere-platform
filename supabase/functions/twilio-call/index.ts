// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio PSTN Call (Edge Function)
// Calls admin's REAL phone number when browser call unanswered.
//
// This is Level 3 of the escalation chain.
// Cost: ~$0.013/min (US) — a 3-min SOS call costs ~$0.04
//
// Required Supabase Secrets:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   SOSPHERE_BASE_URL  (e.g. https://sosphere-platform.vercel.app)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[twilio-call] Call initiated: ${result.sid} → ${to} (callId: ${callId})`);

    return new Response(
      JSON.stringify({
        callSid: result.sid,
        status: result.status,
        to: result.to,
        from: result.from,
        callId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[twilio-call] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
