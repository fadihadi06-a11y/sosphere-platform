// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio TwiML Acknowledgment Handler (Edge Function)
// Handles: POST /functions/v1/twilio-twiml-ack
// Purpose: Process responder digit input (press 1 to acknowledge)
// Logs acknowledgment to audit_log and updates sos_queue record
//
// Query params:
//   emergencyId: The SOS emergency ID
//
// Twilio POST data:
//   Digits: The pressed digit (1 = acknowledge)
//   CallSid: Unique identifier for this call
//   From: Responder's phone number
//   To: Called phone number (our Twilio number)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    // Parse query parameters
    const url = new URL(req.url);
    const emergencyId = url.searchParams.get("emergencyId");

    // Validate emergencyId
    if (!emergencyId || !/^[A-Za-z0-9\-_]+$/.test(emergencyId)) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing emergencyId parameter" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse form data from Twilio webhook
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => {
      data[key] = String(value);
    });

    const digit = data.Digits;
    const callSid = data.CallSid;
    const fromNumber = data.From;
    const toNumber = data.To;

    console.log(
      `[twilio-twiml-ack] Received digit input: ${digit} | CallSid: ${callSid} | From: ${fromNumber}`
    );

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("[twilio-twiml-ack] Missing Supabase credentials");
      return buildErrorTwiml(
        "System error. The emergency team has been notified."
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let twiml: string;

    if (digit === "1") {
      // Acknowledge received
      console.log(
        `[twilio-twiml-ack] Emergency ${emergencyId} acknowledged by ${fromNumber}`
      );

      // Log to audit_log
      await supabase.from("audit_log").insert({
        id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        action: "twilio_acknowledgment_received",
        actor: "system", // Logged by the system, not a specific user
        operation: "emergency_response",
        target: fromNumber,
        created_at: new Date().toISOString(),
        metadata: {
          emergencyId,
          callSid,
          digit,
          responderPhone: fromNumber,
        },
      });

      // Update sos_queue record if it exists
      try {
        const { data: sosRecord, error: fetchError } = await supabase
          .from("sos_queue")
          .select("id")
          .eq("id", emergencyId)
          .single();

        if (!fetchError && sosRecord) {
          await supabase
            .from("sos_queue")
            .update({
              acknowledged_at: new Date().toISOString(),
              acknowledged_by: fromNumber,
              status: "acknowledged",
            })
            .eq("id", emergencyId);

          console.log(
            `[twilio-twiml-ack] Updated sos_queue record ${emergencyId} status to acknowledged`
          );
        }
      } catch (e) {
        console.warn(
          `[twilio-twiml-ack] Failed to update sos_queue: ${e instanceof Error ? e.message : String(e)}`
        );
        // Continue anyway - we've already logged the acknowledgment
      }

      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-US">Thank you. The emergency team has been notified of your acknowledgment. Stay on the line for further instructions.</Say>
  <Pause length="60"/>
</Response>`;
    } else {
      // Invalid or no input
      console.log(
        `[twilio-twiml-ack] Invalid digit input: ${digit || "none"} for emergency ${emergencyId}`
      );

      // Log invalid input attempt
      await supabase.from("audit_log").insert({
        id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        action: "twilio_invalid_input",
        actor: "system",
        operation: "emergency_response",
        target: fromNumber,
        created_at: new Date().toISOString(),
        metadata: {
          emergencyId,
          callSid,
          digit: digit || "none",
          responderPhone: fromNumber,
        },
      });

      twiml = buildErrorTwiml(
        "Invalid input. Goodbye. The emergency team has been notified."
      );
    }

    return new Response(twiml, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/xml",
      },
    });
  } catch (err) {
    console.error("[twilio-twiml-ack] Error:", err);
    return buildErrorTwiml(
      "System error. The emergency team has been notified. Goodbye."
    );
  }
});

/**
 * Build error TwiML response
 */
function buildErrorTwiml(message: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-US">${escapeXml(message)}</Say>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/xml",
    },
  });
}

/**
 * Escape XML special characters to prevent injection
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
