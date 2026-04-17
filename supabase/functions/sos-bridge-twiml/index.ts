// ═══════════════════════════════════════════════════════════════
// SOSphere — Elite Call Bridge TwiML (Edge Function) — HARDENED v2
// Handles: GET/POST /functions/v1/sos-bridge-twiml
//
// For Elite tier: Creates a conference bridge between the SOS user
// and their emergency contact. Both parties are connected and
// the call is recorded in Twilio cloud (evidence-grade).
//
// Flow:
//   1. Twilio calls the emergency contact (action=announce)
//   2. TwiML announces the SOS emergency + asks for DTMF '1'
//   3. Contact presses 1 → gather endpoint calls SOS user + joins contact (action=accept)
//   4. SOS user receives call → TwiML joins them into conference (action=join-user)
//   5. Both are on a recorded conference line
//   6. Conference status callbacks ensure no "ghost" conferences
//
// Hardening over v1:
//   • record attribute on <Conference> (not <Dial>) — real recording
//   • maxParticipants=2, endConferenceOnExit=false with explicit-kill webhook
//   • statusCallback covers start/end/join/leave events
//   • Explicit kill via REST API when last participant leaves (see twilio-status.ts)
//   • timeLimit safety valve on <Dial>
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Base URL resolver — prefer SUPABASE_URL env, fall back to request origin
function getBaseUrl(req: Request): string {
  const envUrl = Deno.env.get("SUPABASE_URL");
  if (envUrl) return envUrl;
  return new URL(req.url).origin;
}

// ─────────────────────────────────────────────────────────────
// AI Script loader — pulls Elite-personalised <Say> payload.
// Returns null if:
//   • The row has no ai_script (Basic/Free user, or Elite without config)
//   • The session id is unknown
//   • Supabase creds are missing in env (local/dev)
//   • Any runtime error — bridge must never break on DB flakiness.
// The sos-alert function has already validated shape + tier gate,
// so we trust the DB row but we still cap length + escape at render.
// ─────────────────────────────────────────────────────────────
interface StoredAiScript {
  text: string;
  language: "en-US" | "ar-SA";
  voice: string;
}

const AI_VOICE_ALLOWLIST = new Set([
  "Polly.Joanna", "Polly.Matthew", "Polly.Amy", "Polly.Zeina",
]);
const AI_LANG_ALLOWLIST = new Set(["en-US", "ar-SA"]);

async function loadAiScript(emergencyId: string): Promise<StoredAiScript | null> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || !emergencyId || emergencyId === "UNKNOWN") return null;
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("sos_sessions")
      .select("ai_script")
      .eq("id", emergencyId)
      .maybeSingle();
    if (error || !data?.ai_script) return null;
    const s = data.ai_script as Record<string, unknown>;
    const text = typeof s.text === "string" ? s.text.trim().slice(0, 600) : "";
    const language = typeof s.language === "string" ? s.language : "";
    const voice = typeof s.voice === "string" ? s.voice : "";
    if (!text || !AI_LANG_ALLOWLIST.has(language) || !AI_VOICE_ALLOWLIST.has(voice)) {
      return null;
    }
    return { text, language: language as "en-US" | "ar-SA", voice };
  } catch (err) {
    console.warn("[sos-bridge] loadAiScript failed:", err);
    return null;
  }
}

// Build a <Say> tag — honours optional Elite override, falls back to
// the built-in Joanna English default.
function sayTag(defaultText: string, ai: StoredAiScript | null): string {
  if (ai) {
    return `<Say voice="${escapeXml(ai.voice)}" language="${escapeXml(ai.language)}">${escapeXml(ai.text)}</Say>`;
  }
  return `<Say voice="Polly.Joanna">${escapeXml(defaultText)}</Say>`;
}

// Build conference TwiML block (shared between join-user and accept actions)
function buildConferenceTwiml(confName: string, emergencyId: string, baseUrl: string): string {
  const recordingCb = `${baseUrl}/functions/v1/twilio-status?callId=${escapeXml(emergencyId)}&amp;type=recording`;
  const confStatusCb = `${baseUrl}/functions/v1/twilio-status?callId=${escapeXml(emergencyId)}&amp;type=conference`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Connecting now. The call is being recorded for safety.</Say>
  <Dial timeLimit="3600">
    <Conference
      record="record-from-start"
      recordingStatusCallback="${recordingCb}"
      recordingStatusCallbackEvent="completed"
      statusCallback="${confStatusCb}"
      statusCallbackEvent="start end join leave"
      statusCallbackMethod="POST"
      startConferenceOnEnter="true"
      endConferenceOnExit="false"
      maxParticipants="2"
      waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.soft-rock"
    >${escapeXml(confName)}</Conference>
  </Dial>
</Response>`;
}

serve(async (req: Request) => {
  // B-M1: origin allowlist via ALLOWED_ORIGINS env
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const baseUrl = getBaseUrl(req);
  const emergencyId = url.searchParams.get("emergencyId") || "UNKNOWN";
  const caller      = decodeURIComponent(url.searchParams.get("caller") || "Someone");
  const contactName = decodeURIComponent(url.searchParams.get("contactName") || "");
  const userPhone   = decodeURIComponent(url.searchParams.get("userPhone") || "");
  const trackUrl    = decodeURIComponent(url.searchParams.get("trackUrl") || "");
  const action      = url.searchParams.get("action") || "announce";

  // Load the Elite <Say> override once per request — null for
  // non-Elite and non-customised emergencies.
  const ai = await loadAiScript(emergencyId);

  // ═════════════════════════════════════════════════════════
  // ACTION: join-user — SOS user dialed by server, joins conference
  // ═════════════════════════════════════════════════════════
  if (action === "join-user") {
    const confName = `sos-${emergencyId}`;
    // Note: the user-facing leg is always the default English reassurance
    // (Elite script targets the CONTACT's ear, not the user's own leg).
    const twiml = buildConferenceTwiml(confName, emergencyId, baseUrl)
      .replace(
        `<Say voice="Polly.Joanna">Connecting now. The call is being recorded for safety.</Say>`,
        `<Say voice="Polly.Joanna">You are being connected to your emergency contact. The call is recorded. Stay calm.</Say>`
      );

    return new Response(twiml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml" },
    });
  }

  // ═════════════════════════════════════════════════════════
  // ACTION: accept — contact pressed 1, bridge both parties
  // ═════════════════════════════════════════════════════════
  if (action === "accept") {
    const confName = `sos-${emergencyId}`;

    // Trigger a call to the SOS user to join them into the conference
    if (userPhone) {
      try {
        const twilioSid   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
        const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
        const twilioFrom  = Deno.env.get("TWILIO_FROM_NUMBER")!;
        const joinTwiml   = `${baseUrl}/functions/v1/sos-bridge-twiml?action=join-user&emergencyId=${encodeURIComponent(emergencyId)}`;
        const statusCb    = `${baseUrl}/functions/v1/twilio-status?callId=${encodeURIComponent(emergencyId)}&type=user-join`;

        const callRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: userPhone.replace(/[^+\d]/g, ""),
            From: twilioFrom,
            Url: joinTwiml,
            StatusCallback: statusCb,
            StatusCallbackMethod: "POST",
            Timeout: "20",
          }),
        });

        if (!callRes.ok) {
          const errText = await callRes.text().catch(() => "");
          console.error(`[sos-bridge] Failed to call user into conference: ${callRes.status} ${errText}`);
        } else {
          console.log(`[sos-bridge] Called user ${userPhone} to join conference ${confName}`);
        }
      } catch (err) {
        console.error("[sos-bridge] Exception calling user into conference:", err);
      }
    }

    // Join the contact into the conference
    const twiml = buildConferenceTwiml(confName, emergencyId, baseUrl);
    return new Response(twiml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml" },
    });
  }

  // ═════════════════════════════════════════════════════════
  // DEFAULT: announce — initial TwiML for contact on inbound call
  //
  // Elite personalisation splices here: the first two <Say> tags
  // carry the user's configured message (already interpolated +
  // validated server-side). The Gather prompt and fallback lines
  // stay in the default voice — they are mechanical controls, not
  // personal content, so we don't confuse the listener by
  // switching languages mid-call.
  // ═════════════════════════════════════════════════════════
  const gatherUrl = `${baseUrl}/functions/v1/sos-bridge-twiml?action=accept&emergencyId=${encodeURIComponent(emergencyId)}&userPhone=${encodeURIComponent(userPhone)}&caller=${encodeURIComponent(caller)}`;

  const defaultAnnouncement =
    `Emergency Alert from SOSphere. ${caller} has triggered an SOS emergency and needs immediate help. Emergency I D: ${emergencyId}.`;

  // Elite users get their own script; everyone else gets the default.
  const announceTag = sayTag(defaultAnnouncement, ai);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${announceTag}
  <Pause length="1"/>
  ${announceTag}
  <Gather numDigits="1" action="${escapeXml(gatherUrl)}" method="POST" timeout="15">
    <Say voice="Polly.Joanna">Press 1 to connect with ${escapeXml(caller)} now. Press 2 to hear this message again.</Say>
  </Gather>
  <Say voice="Polly.Joanna">No response received. An SMS with the emergency details has been sent. Goodbye.</Say>
  <Hangup/>
</Response>`;

  return new Response(twiml, {
    headers: { ...corsHeaders, "Content-Type": "application/xml" },
  });
});
