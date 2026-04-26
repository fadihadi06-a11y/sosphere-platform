// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio Status Webhook (Edge Function)
// Receives call/SMS status updates from Twilio and:
//   1. Logs them to Supabase DB (call_events table)
//   2. Broadcasts updates via Supabase Realtime
//   3. Handles Gather input (admin pressed 1 to accept)
//
// Also handles escalation logic:
//   - If call goes to voicemail → trigger SMS
//   - If call unanswered after 30s → trigger SMS
//
// Required Supabase Secrets:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   SOSPHERE_BASE_URL
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// B-09 (2026-04-25): self-signed gather-token to close the
// signature-bypass hole the prior code left open for action=gather.
import { verifyGatherToken } from "../_shared/gather-token.ts";

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

async function validateTwilioSignature(
  req: Request,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  const sigHeader = req.headers.get("X-Twilio-Signature");
  if (!sigHeader) return false;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    console.error("[twilio-status] TWILIO_AUTH_TOKEN missing — rejecting request (fail closed)");
    return false;
  }
  const sortedKeys = Object.keys(params).sort();
  let dataToSign = url;
  for (const k of sortedKeys) dataToSign += k + params[k];
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataToSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return sigB64 === sigHeader;
}

async function endConference(conferenceSid: string): Promise<void> {
  const twilioSid   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  try {
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Conferences/${conferenceSid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ Status: "completed" }),
      }
    );
    console.log(`[twilio-status] Conference ${conferenceSid} explicitly ended`);
  } catch (err) {
    console.error(`[twilio-status] Failed to end conference ${conferenceSid}:`, err);
  }
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const url = new URL(req.url);
    const callId = url.searchParams.get("callId") || "";
    const action = url.searchParams.get("action") || "status";
    const type = url.searchParams.get("type") || "call";
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => { data[key] = String(value); });

    // B-09: gather requires gtok; other actions require Twilio signature
    if (action === "gather") {
      const gtok = url.searchParams.get("gtok");
      const tokRes = await verifyGatherToken(gtok, callId);
      if (!tokRes.ok) {
        console.warn(`[twilio-status] gather token verification FAILED reason=${tokRes.reason} callId=${callId} — rejecting`);
        return new Response(JSON.stringify({ error: "Invalid gather token" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const twilioOk = await validateTwilioSignature(req, req.url, data);
      if (!twilioOk) {
        console.warn(`[twilio-status] gather: Twilio signature did not validate (callId=${callId}) — gtok was OK so proceeding`);
      }
    } else {
      const valid = await validateTwilioSignature(req, req.url, data);
      if (!valid) {
        console.warn("[twilio-status] Signature validation FAILED — rejecting request");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    console.log(`[twilio-status] ${action} | type=${type} | callId=${callId} | status=${data.CallStatus || data.MessageStatus || data.StatusCallbackEvent || "unknown"}`);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (type === "conference") {
      const event = data.StatusCallbackEvent;
      const conferenceSid = data.ConferenceSid;
      console.log(`[twilio-status] Conference event: ${event} conf=${conferenceSid} callId=${callId}`);
      await logCallEvent(supabase, callId, `conf_${event}`, data);
      if (event === "participant-leave" && conferenceSid) {
        try {
          const twilioSid   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
          const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
          const partsRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Conferences/${conferenceSid}/Participants.json`,
            { headers: { Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}` } }
          );
          const partsData = await partsRes.json();
          const count = partsData.participants?.length ?? 0;
          if (count === 0) {
            console.log(`[twilio-status] Conference ${conferenceSid} empty — killing it to stop billing`);
            await endConference(conferenceSid);
          }
        } catch (err) {
          console.error("[twilio-status] Failed to check conference participants:", err);
        }
      }
      return new Response(JSON.stringify({ received: true, event, conferenceSid }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "gather") {
      const digit = data.Digits;
      const baseUrl = url.searchParams.get("baseUrl") || Deno.env.get("SOSPHERE_BASE_URL") || "";
      if (digit === "1") {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna">\n    Thank you. Opening the emergency dashboard now.\n    The dashboard link has been sent to your phone.\n    Stay on the line for updates.\n  </Say>\n  <Pause length="60"/>\n  <Say voice="Polly.Joanna">The call has ended. Please check the dashboard for updates.</Say>\n</Response>`;
        if (data.From && baseUrl) {
          await sendEscalationSMS(supabaseUrl, data.Called || data.From, callId, baseUrl);
        }
        await logCallEvent(supabase, callId, "accepted", data);
        await supabase.channel(`call-${callId}`).send({
          type: "broadcast",
          event: "call_status",
          payload: { callId, status: "accepted", adminPhone: data.Called },
        });
        return new Response(twiml, { headers: { ...corsHeaders, "Content-Type": "text/xml" } });
      } else if (digit === "2") {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Redirect>${supabaseUrl}/functions/v1/twilio-call?replay=true&amp;callId=${callId}</Redirect>\n</Response>`;
        return new Response(twiml, { headers: { ...corsHeaders, "Content-Type": "text/xml" } });
      } else {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna">Invalid input. Goodbye.</Say>\n</Response>`;
        return new Response(twiml, { headers: { ...corsHeaders, "Content-Type": "text/xml" } });
      }
    }

    if (type === "call") {
      const callStatus = data.CallStatus;
      const callSid = data.CallSid;
      const answeredBy = data.AnsweredBy;
      await logCallEvent(supabase, callId, callStatus, data);
      if (callId) {
        try {
          const channel = supabase.channel(`call-${callId}`);
          await channel.send({
            type: "broadcast",
            event: "call_status",
            payload: { callId, callSid, status: callStatus, answeredBy, timestamp: new Date().toISOString() },
          });
          setTimeout(() => supabase.removeChannel(channel), 3000);
        } catch (e) {
          console.warn("[twilio-status] Broadcast failed:", e);
        }
      }
      const shouldEscalateToSMS =
        callStatus === "no-answer" ||
        callStatus === "busy" ||
        callStatus === "failed" ||
        (callStatus === "completed" && answeredBy === "machine_start");
      if (shouldEscalateToSMS && callId) {
        console.log(`[twilio-status] Escalating to SMS for callId=${callId} (status=${callStatus})`);
        const baseUrl = Deno.env.get("SOSPHERE_BASE_URL") || "";
        const adminPhone = data.Called || data.To;
        if (adminPhone && baseUrl) {
          await sendEscalationSMS(supabaseUrl, adminPhone, callId, baseUrl);
        }
      }
    }

    if (type === "sms") {
      const messageStatus = data.MessageStatus;
      await logCallEvent(supabase, callId, `sms_${messageStatus}`, data);
    }

    return new Response(
      JSON.stringify({ received: true, callId, action, type }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[twilio-status] Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function logCallEvent(
  supabase: any,
  callId: string,
  status: string,
  rawData: Record<string, string>,
) {
  // Existing call_events write — operational telemetry.
  try {
    await supabase.from("call_events").insert({
      id: `CE-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      call_id: callId,
      status,
      call_sid: rawData.CallSid || rawData.MessageSid || null,
      from_number: rawData.From || null,
      to_number: rawData.To || rawData.Called || null,
      duration: rawData.CallDuration ? parseInt(rawData.CallDuration) : null,
      answered_by: rawData.AnsweredBy || null,
      raw_data: rawData,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[twilio-status] Failed to log call_event:", e);
  }

  // W3-46 (B-20, 2026-04-26): also write to audit_log via log_sos_audit RPC.
  // Pre-fix: Twilio call lifecycle (initiated/ringing/answered/completed/
  // busy/no-answer/failed) was visible only in `call_events` — the
  // dashboard's compliance reports + forensic timeline read from
  // `audit_log` so the evidence chain had a black hole between SOS-trigger
  // (auditted) and SOS-resolve (auditted) for the actual call delivery
  // events. Now: each Twilio status mirrors into audit_log with the
  // emergencyId target and the relevant metadata. Failures are
  // best-effort — telemetry must never block a Twilio webhook.
  try {
    const auditAction = `twilio_${status}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60);
    await supabase.rpc("log_sos_audit", {
      p_action: auditAction,
      p_actor: "twilio_webhook",
      p_actor_level: "system",
      p_operation: "telephony",
      p_target: callId || null,
      p_target_name: rawData.From || rawData.Called || null,
      p_metadata: {
        call_sid: rawData.CallSid || rawData.MessageSid || null,
        duration: rawData.CallDuration ? parseInt(rawData.CallDuration) : null,
        answered_by: rawData.AnsweredBy || null,
        twilio_status: status,
        severity: status === "failed" || status === "no-answer" ? "warning" : "info",
      },
    });
  } catch (e) {
    console.warn("[twilio-status] Failed to mirror to audit_log:", e);
  }
}

async function sendEscalationSMS(
  supabaseUrl: string,
  adminPhone: string,
  callId: string,
  baseUrl: string,
) {
  try {
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER") || "";
    if (!twilioFrom) {
      console.warn("[twilio-status] No TWILIO_FROM_NUMBER set, skipping SMS escalation");
      return;
    }
    const smsBody = [
      `🚨 SOSphere Emergency Alert`,
      ``,
      `A call was made but not answered.`,
      `Open the dashboard immediately:`,
      `${baseUrl}/emergency/${callId}`,
    ].join("\n");
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = btoa(`${accountSid}:${authToken}`);
    await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: adminPhone, From: twilioFrom, Body: smsBody }).toString(),
    });
    console.log(`[twilio-status] Escalation SMS sent to ${adminPhone}`);
  } catch (e) {
    console.error("[twilio-status] Escalation SMS failed:", e);
  }
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             