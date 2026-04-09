// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio SMS Sender (Edge Function)
// Sends SMS with emergency link when call is unanswered.
//
// This is Level 4 of the escalation chain.
// Cost: ~$0.0079/SMS (US) — less than 1 cent per message
//
// SMS includes a direct link to the emergency dashboard:
//   "🚨 SOS from Ahmed in Zone B
//    View: https://sosphere-platform.vercel.app/emergency/EMG-123"
//
// Required Supabase Secrets:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   SOSPHERE_BASE_URL
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
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[twilio-sms] SMS sent: ${result.sid} → ${to} (type: ${type || "general"})`);

    return new Response(
      JSON.stringify({
        messageSid: result.sid,
        status: result.status,
        to: result.to,
        from: result.from,
        segments: result.num_segments, // Each segment ~$0.0079
        callId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[twilio-sms] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
