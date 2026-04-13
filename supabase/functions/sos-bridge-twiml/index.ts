// ═══════════════════════════════════════════════════════════════
// SOSphere — Elite Call Bridge TwiML (Edge Function)
// Handles: GET/POST /functions/v1/sos-bridge-twiml
//
// For Elite tier: Creates a conference bridge between the SOS user
// and their emergency contact. Both parties are connected and
// the call is recorded in Twilio cloud.
//
// Flow:
//   1. Twilio calls the emergency contact
//   2. TwiML announces the SOS emergency
//   3. Contact presses 1 to accept → joined into conference
//   4. Server then calls the SOS user and joins them too
//   5. Both are on a recorded conference line
//
// Query params:
//   emergencyId, caller, contactName, userPhone, trackUrl
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const emergencyId = url.searchParams.get("emergencyId") || "UNKNOWN";
  const caller      = decodeURIComponent(url.searchParams.get("caller") || "Someone");
  const contactName = decodeURIComponent(url.searchParams.get("contactName") || "");
  const userPhone   = decodeURIComponent(url.searchParams.get("userPhone") || "");
  const trackUrl    = decodeURIComponent(url.searchParams.get("trackUrl") || "");
  const action      = url.searchParams.get("action") || "announce";

  // ── ACTION: join-user — TwiML for the SOS user joining conference ──
  if (action === "join-user") {
    const confName = `sos-${emergencyId}`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">You are being connected to your emergency contact. Stay calm.</Say>
  <Dial>
    <Conference
      record="record-from-start"
      recordingStatusCallback="${url.origin}/functions/v1/twilio-status?callId=${escapeXml(emergencyId)}&amp;type=recording"
      recordingStatusCallbackEvent="completed"
      startConferenceOnEnter="true"
      endConferenceOnExit="false"
      waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.soft-rock"
    >${escapeXml(confName)}</Conference>
  </Dial>
</Response>`;

    return new Response(twiml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml" },
    });
  }

  // ── ACTION: accept — contact pressed 1, join conference + call user ──
  if (action === "accept") {
    const confName = `sos-${emergencyId}`;

    // Also trigger a call to the SOS user to join them into the conference
    // This is done via Twilio REST API from here
    if (userPhone) {
      try {
        const twilioSid   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
        const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
        const twilioFrom  = Deno.env.get("TWILIO_FROM_NUMBER")!;
        const joinTwiml   = `${url.origin}/functions/v1/sos-bridge-twiml?action=join-user&emergencyId=${encodeURIComponent(emergencyId)}`;

        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: userPhone.replace(/[^+\d]/g, ""),
            From: twilioFrom,
            Url: joinTwiml,
            Timeout: "20",
          }),
        });
        console.log(`[sos-bridge] Called user ${userPhone} to join conference ${confName}`);
      } catch (err) {
        console.error("[sos-bridge] Failed to call user into conference:", err);
      }
    }

    // Join the contact into the conference
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Connecting you now. The call is being recorded for safety.</Say>
  <Dial>
    <Conference
      record="record-from-start"
      recordingStatusCallback="${url.origin}/functions/v1/twilio-status?callId=${escapeXml(emergencyId)}&amp;type=recording"
      recordingStatusCallbackEvent="completed"
      startConferenceOnEnter="true"
      endConferenceOnExit="false"
      waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.soft-rock"
    >${escapeXml(confName)}</Conference>
  </Dial>
</Response>`;

    return new Response(twiml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml" },
    });
  }

  // ── DEFAULT: announce — initial TwiML for contact ──────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || url.origin;
  const gatherUrl = `${url.origin}/functions/v1/sos-bridge-twiml?action=accept&emergencyId=${encodeURIComponent(emergencyId)}&userPhone=${encodeURIComponent(userPhone)}`;

  const announcement = `Emergency Alert from SOSphere. ${escapeXml(caller)} has triggered an SOS emergency and needs immediate help. Emergency I D: ${escapeXml(emergencyId)}.`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${announcement}</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">${announcement}</Say>
  <Gather numDigits="1" action="${escapeXml(gatherUrl)}" method="POST" timeout="15">
    <Say voice="Polly.Joanna">Press 1 to connect with ${escapeXml(caller)} now. Press 2 to hear this message again.</Say>
  </Gather>
  <Say voice="Polly.Joanna">No response received. An SMS with the emergency details has been sent to your phone. Goodbye.</Say>
</Response>`;

  return new Response(twiml, {
    headers: { ...corsHeaders, "Content-Type": "application/xml" },
  });
});
