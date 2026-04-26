// SOSphere sos-bridge-twiml edge function
// v11: conference bridge + Elite AI script.
// v12 (G-17): action=accept REQUIRES gtok; userPhone server-derived.
// v13 (G-27): atomic claim on bridge_dialed_at — only one Twilio dial fires.
// v14 (G-41 B-20 2026-04-26): every outbound fetch now has an 8s
//    AbortSignal.timeout(). Pre-fix a Twilio API partial network partition
//    (SYN accepted, data never sent) would hang Deno workers indefinitely.
//    Under load this exhausts worker pool and DoSes the emergency path.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signGatherToken, verifyGatherToken } from "../_shared/gather-token.ts";

const FETCH_TIMEOUT_MS = 8000;  // G-41: Twilio API p99 < 2s; 8s is generous.

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",").map((s) => s.trim()).filter(Boolean);
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
function getBaseUrl(req: Request): string {
  const envUrl = Deno.env.get("SUPABASE_URL");
  if (envUrl) return envUrl;
  return new URL(req.url).origin;
}

async function resolveUserPhone(emergencyId: string): Promise<string | null> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || !emergencyId || emergencyId === "UNKNOWN") return null;
    const supabase = createClient(url, key);
    const { data: session } = await supabase
      .from("sos_sessions").select("user_id, company_id").eq("id", emergencyId).maybeSingle();
    if (!session) return null;
    const userId = (session as any).user_id as string | null;
    if (!userId) return null;
    const { data: profile } = await supabase
      .from("profiles").select("phone").eq("id", userId).maybeSingle();
    if ((profile as any)?.phone) return (profile as any).phone as string;
    const { data: emp } = await supabase
      .from("employees").select("phone").eq("user_id", userId).maybeSingle();
    if ((emp as any)?.phone) return (emp as any).phone as string;
    return null;
  } catch (err) {
    console.warn("[sos-bridge] resolveUserPhone failed:", err);
    return null;
  }
}

async function claimBridgeDial(emergencyId: string): Promise<boolean> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || !emergencyId) return false;
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("sos_sessions")
      .update({ bridge_dialed_at: new Date().toISOString() })
      .eq("id", emergencyId)
      .is("bridge_dialed_at", null)
      .select("id").maybeSingle();
    if (error) {
      console.warn(`[sos-bridge] claimBridgeDial DB error eid=${emergencyId}:`, error.message);
      return true;  // fail-open during emergency
    }
    return !!data;
  } catch (err) {
    console.warn("[sos-bridge] claimBridgeDial threw — fail-open:", err);
    return true;
  }
}

interface StoredAiScript { text: string; language: "en-US" | "ar-SA"; voice: string; }
const AI_VOICE_ALLOWLIST = new Set(["Polly.Joanna", "Polly.Matthew", "Polly.Amy", "Polly.Zeina"]);
const AI_LANG_ALLOWLIST = new Set(["en-US", "ar-SA"]);

async function loadAiScript(emergencyId: string): Promise<StoredAiScript | null> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || !emergencyId || emergencyId === "UNKNOWN") return null;
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("sos_sessions").select("ai_script").eq("id", emergencyId).maybeSingle();
    if (error || !data?.ai_script) return null;
    const s = data.ai_script as Record<string, unknown>;
    const text = typeof s.text === "string" ? s.text.trim().slice(0, 600) : "";
    const language = typeof s.language === "string" ? s.language : "";
    const voice = typeof s.voice === "string" ? s.voice : "";
    if (!text || !AI_LANG_ALLOWLIST.has(language) || !AI_VOICE_ALLOWLIST.has(voice)) return null;
    return { text, language: language as "en-US" | "ar-SA", voice };
  } catch (err) {
    console.warn("[sos-bridge] loadAiScript failed:", err);
    return null;
  }
}
function sayTag(defaultText: string, ai: StoredAiScript | null): string {
  if (ai) return `<Say voice="${escapeXml(ai.voice)}" language="${escapeXml(ai.language)}">${escapeXml(ai.text)}</Say>`;
  return `<Say voice="Polly.Joanna">${escapeXml(defaultText)}</Say>`;
}
function buildConferenceTwiml(confName: string, emergencyId: string, baseUrl: string): string {
  const recordingCb = `${baseUrl}/functions/v1/twilio-status?callId=${escapeXml(emergencyId)}&amp;type=recording`;
  const confStatusCb = `${baseUrl}/functions/v1/twilio-status?callId=${escapeXml(emergencyId)}&amp;type=conference`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna">Connecting now. The call is being recorded for safety.</Say>\n  <Dial timeLimit="3600">\n    <Conference\n      record="record-from-start"\n      recordingStatusCallback="${recordingCb}"\n      recordingStatusCallbackEvent="completed"\n      statusCallback="${confStatusCb}"\n      statusCallbackEvent="start end join leave"\n      statusCallbackMethod="POST"\n      startConferenceOnEnter="true"\n      endConferenceOnExit="false"\n      maxParticipants="2"\n      waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.soft-rock"\n    >${escapeXml(confName)}</Conference>\n  </Dial>\n</Response>`;
}

serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const baseUrl = getBaseUrl(req);
  const emergencyId = url.searchParams.get("emergencyId") || "UNKNOWN";
  const caller      = decodeURIComponent(url.searchParams.get("caller") || "Someone");
  const action      = url.searchParams.get("action") || "announce";
  const gtok        = url.searchParams.get("gtok") || "";

  const ai = await loadAiScript(emergencyId);

  if (action === "join-user") {
    const confName = `sos-${emergencyId}`;
    const twiml = buildConferenceTwiml(confName, emergencyId, baseUrl).replace(
      `<Say voice="Polly.Joanna">Connecting now. The call is being recorded for safety.</Say>`,
      `<Say voice="Polly.Joanna">You are being connected to your emergency contact. The call is recorded. Stay calm.</Say>`,
    );
    return new Response(twiml, { headers: { ...corsHeaders, "Content-Type": "application/xml" } });
  }

  if (action === "accept") {
    const tokRes = await verifyGatherToken(gtok, emergencyId);
    if (!tokRes.ok) {
      console.warn(`[sos-bridge] accept rejected — gtok ${tokRes.reason} (eid=${emergencyId})`);
      const denyTwiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna">Authorization failed. Goodbye.</Say>\n  <Hangup/>\n</Response>`;
      return new Response(denyTwiml, { status: 403, headers: { ...corsHeaders, "Content-Type": "application/xml" } });
    }

    const confName = `sos-${emergencyId}`;
    const wonClaim = await claimBridgeDial(emergencyId);
    if (wonClaim) {
      const dbPhone = await resolveUserPhone(emergencyId);
      if (dbPhone) {
        try {
          const twilioSid   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
          const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
          const twilioFrom  = Deno.env.get("TWILIO_FROM_NUMBER")!;
          const joinTwiml   = `${baseUrl}/functions/v1/sos-bridge-twiml?action=join-user&emergencyId=${encodeURIComponent(emergencyId)}`;
          const statusCb    = `${baseUrl}/functions/v1/twilio-status?callId=${encodeURIComponent(emergencyId)}&type=user-join`;
          // G-41: AbortSignal.timeout so a Twilio partial-partition can't hang the worker.
          const callRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`, {
            method: "POST",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: {
              Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: dbPhone.replace(/[^+\d]/g, ""),
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
            console.log(`[sos-bridge] Called user (db-phone) to join conference ${confName}`);
          }
        } catch (err) {
          console.error("[sos-bridge] Exception calling user into conference:", err);
        }
      } else {
        console.warn(`[sos-bridge] accept: no db phone for eid=${emergencyId} — contact joins alone`);
      }
    } else {
      console.log(`[sos-bridge] accept: bridge already dialed for eid=${emergencyId} — skipping duplicate dial (G-27)`);
    }

    const twiml = buildConferenceTwiml(confName, emergencyId, baseUrl);
    return new Response(twiml, { headers: { ...corsHeaders, "Content-Type": "application/xml" } });
  }

  // default: announce
  let gtokSigned = "";
  try { gtokSigned = await signGatherToken(emergencyId); }
  catch (err) { console.error("[sos-bridge] signGatherToken failed in announce:", err); }
  const gatherUrl = `${baseUrl}/functions/v1/sos-bridge-twiml?action=accept&emergencyId=${encodeURIComponent(emergencyId)}&caller=${encodeURIComponent(caller)}&gtok=${encodeURIComponent(gtokSigned)}`;
  const defaultAnnouncement =
    `Emergency Alert from SOSphere. ${caller} has triggered an SOS emergency and needs immediate help. Emergency I D: ${emergencyId}.`;
  const announceTag = sayTag(defaultAnnouncement, ai);
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  ${announceTag}\n  <Pause length="1"/>\n  ${announceTag}\n  <Gather numDigits="1" action="${escapeXml(gatherUrl)}" method="POST" timeout="15">\n    <Say voice="Polly.Joanna">Press 1 to connect with ${escapeXml(caller)} now. Press 2 to hear this message again.</Say>\n  </Gather>\n  <Say voice="Polly.Joanna">No response received. An SMS with the emergency details has been sent. Goodbye.</Say>\n  <Hangup/>\n</Response>`;
  return new Response(twiml, { headers: { ...corsHeaders, "Content-Type": "application/xml" } });
});
