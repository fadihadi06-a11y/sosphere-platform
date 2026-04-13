// ═══════════════════════════════════════════════════════════════
// SOSphere — SOS Alert Orchestrator (Edge Function)
// Handles: POST /functions/v1/sos-alert
//
// THE BRAIN: receives SOS payload from mobile app and orchestrates
// the entire server-side emergency response based on subscription tier.
//
// Tier Logic:
//   Free  → SMS only (tracking link) — no Twilio voice
//   Basic → TTS automated call to contacts + SMS fallback
//   Elite → Call bridging (user ↔ contact) + cloud recording + SMS
//
// Endpoints:
//   POST /sos-alert           → Trigger SOS
//   POST /sos-alert?action=heartbeat → Device heartbeat ping
//   POST /sos-alert?action=end       → End SOS session
//
// Required Secrets:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SOSPHERE_BASE_URL
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TWILIO_SID    = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_FROM   = Deno.env.get("TWILIO_FROM_NUMBER")!;
const SUPA_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE_URL      = Deno.env.get("SOSPHERE_BASE_URL") || "https://sosphere.co";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Types ────────────────────────────────────────────────────
interface SOSPayload {
  emergencyId: string;
  userId: string;
  userName: string;
  userPhone: string;
  tier: "free" | "basic" | "elite";
  contacts: { name: string; phone: string; relation: string }[];
  location: { lat: number; lng: number; accuracy: number; address?: string };
  bloodType?: string;
  zone?: string;
  silent?: boolean; // Silent SOS — no local call was made
}

interface HeartbeatPayload {
  emergencyId: string;
  userId: string;
  location?: { lat: number; lng: number; accuracy: number };
  batteryLevel?: number;
  elapsedSec: number;
}

// ── Twilio Helpers ───────────────────────────────────────────
const twilioAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}`;

async function twilioCall(
  to: string,
  twimlUrl: string,
  opts: {
    statusCallback?: string;
    record?: boolean;
    machineDetection?: boolean;
    timeout?: number;
  } = {}
): Promise<{ sid: string; status: string } | null> {
  try {
    const params = new URLSearchParams({
      To: to,
      From: TWILIO_FROM,
      Url: twimlUrl,
      StatusCallbackMethod: "POST",
      StatusCallbackEvent: "initiated ringing answered completed",
      Timeout: String(opts.timeout ?? 30),
    });
    if (opts.statusCallback) params.set("StatusCallback", opts.statusCallback);
    if (opts.record) params.set("Record", "true");
    if (opts.machineDetection) params.set("MachineDetection", "Enable");

    const res = await fetch(`${twilioBase}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[sos-alert] Twilio call failed:", data.message);
      return null;
    }
    return { sid: data.sid, status: data.status };
  } catch (err) {
    console.error("[sos-alert] Twilio call error:", err);
    return null;
  }
}

async function twilioSMS(to: string, body: string): Promise<string | null> {
  try {
    const res = await fetch(`${twilioBase}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[sos-alert] Twilio SMS failed:", data.message);
      return null;
    }
    return data.sid;
  } catch (err) {
    console.error("[sos-alert] Twilio SMS error:", err);
    return null;
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Main Handler ─────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "trigger";
  const supabase = createClient(SUPA_URL, SUPA_KEY);

  try {
    // ═══════════════════════════════════════════════════════════
    // ACTION: HEARTBEAT — device pings every 30s
    // If heartbeat stops → device died → server continues calls
    // ═══════════════════════════════════════════════════════════
    if (action === "heartbeat") {
      const hb: HeartbeatPayload = await req.json();

      // Update active session with latest location + battery
      await supabase.from("sos_sessions").update({
        last_heartbeat: new Date().toISOString(),
        last_lat: hb.location?.lat,
        last_lng: hb.location?.lng,
        battery_level: hb.batteryLevel,
        elapsed_sec: hb.elapsedSec,
      }).eq("id", hb.emergencyId);

      // Broadcast location to dashboard via Realtime
      try {
        const ch = supabase.channel(`sos-${hb.emergencyId}`);
        await ch.send({
          type: "broadcast",
          event: "heartbeat",
          payload: {
            emergencyId: hb.emergencyId,
            location: hb.location,
            battery: hb.batteryLevel,
            elapsed: hb.elapsedSec,
            ts: Date.now(),
          },
        });
        setTimeout(() => supabase.removeChannel(ch), 2000);
      } catch {}

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // ACTION: END — client ended SOS
    // ═══════════════════════════════════════════════════════════
    if (action === "end") {
      const { emergencyId, reason, recordingSec, photos, comment } = await req.json();

      await supabase.from("sos_sessions").update({
        status: "ended",
        ended_at: new Date().toISOString(),
        end_reason: reason || "user_ended",
        recording_seconds: recordingSec,
        photo_count: photos?.length ?? 0,
        comment: comment || null,
      }).eq("id", emergencyId);

      // Broadcast end to dashboard
      try {
        const ch = supabase.channel(`sos-${emergencyId}`);
        await ch.send({
          type: "broadcast",
          event: "sos_ended",
          payload: { emergencyId, reason, ts: Date.now() },
        });
        setTimeout(() => supabase.removeChannel(ch), 2000);
      } catch {}

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // ACTION: TRIGGER — main SOS activation
    // ═══════════════════════════════════════════════════════════
    const payload: SOSPayload = await req.json();
    const { emergencyId, userId, userName, userPhone, tier, contacts, location, bloodType, zone, silent } = payload;

    if (!emergencyId || !userId || !contacts?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: cors,
      });
    }

    const trackUrl = `${BASE_URL}/track?eid=${emergencyId}`;
    const dashUrl  = `${BASE_URL}/emergency/${emergencyId}`;
    const statusCb = `${SUPA_URL}/functions/v1/twilio-status?callId=${emergencyId}`;

    console.log(`[sos-alert] ═══ SOS TRIGGERED ═══ id=${emergencyId} tier=${tier} contacts=${contacts.length} silent=${!!silent}`);

    // ── 1. Create SOS session record ──────────────────────────
    await supabase.from("sos_sessions").insert({
      id: emergencyId,
      user_id: userId,
      user_name: userName,
      user_phone: userPhone,
      tier,
      status: "active",
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      lat: location.lat,
      lng: location.lng,
      last_lat: location.lat,
      last_lng: location.lng,
      accuracy: location.accuracy,
      address: location.address || null,
      blood_type: bloodType || null,
      zone: zone || null,
      contact_count: contacts.length,
      silent_mode: !!silent,
    }).then(({ error }) => {
      if (error) console.warn("[sos-alert] Failed to insert session:", error.message);
    });

    // ── 2. Results tracker ────────────────────────────────────
    const results: {
      contactName: string;
      phone: string;
      callSid?: string | null;
      smsSid?: string | null;
      method: string;
    }[] = [];

    // ══════════════════════════════════════════════════════════
    // TIER: FREE — SMS only (tracking link)
    // ══════════════════════════════════════════════════════════
    if (tier === "free") {
      for (const c of contacts) {
        const cleanPhone = c.phone.replace(/[^+\d]/g, "");
        const smsBody = [
          `🚨 SOS — ${userName}`,
          `${c.name}, ${userName} needs help!`,
          `📍 Location: ${trackUrl}`,
          bloodType ? `🩸 Blood: ${bloodType}` : "",
          `Open: ${dashUrl}`,
        ].filter(Boolean).join("\n");

        const smsSid = await twilioSMS(cleanPhone, smsBody);
        results.push({ contactName: c.name, phone: cleanPhone, smsSid, method: "sms_only" });
        console.log(`[sos-alert] FREE → SMS to ${c.name}: ${smsSid ? "OK" : "FAILED"}`);
      }
    }

    // ══════════════════════════════════════════════════════════
    // TIER: BASIC — TTS automated call + SMS fallback
    // ══════════════════════════════════════════════════════════
    if (tier === "basic") {
      for (const c of contacts) {
        const cleanPhone = c.phone.replace(/[^+\d]/g, "");

        // Build TwiML URL for TTS announcement
        const twimlUrl = `${SUPA_URL}/functions/v1/twilio-twiml?emergencyId=${encodeURIComponent(emergencyId)}&caller=${encodeURIComponent(userName)}&contactName=${encodeURIComponent(c.name)}&trackUrl=${encodeURIComponent(trackUrl)}`;

        // Initiate Twilio call with machine detection
        const callResult = await twilioCall(cleanPhone, twimlUrl, {
          statusCallback: statusCb,
          machineDetection: true,
          timeout: 30,
        });

        // Also send SMS as backup (arrives even if call is missed)
        const smsBody = [
          `🚨 SOS — ${userName} needs help!`,
          `📍 Live tracking: ${trackUrl}`,
          bloodType ? `🩸 Blood type: ${bloodType}` : "",
          `Emergency ID: ${emergencyId}`,
        ].filter(Boolean).join("\n");
        const smsSid = await twilioSMS(cleanPhone, smsBody);

        results.push({
          contactName: c.name,
          phone: cleanPhone,
          callSid: callResult?.sid,
          smsSid,
          method: "tts_call_plus_sms",
        });

        console.log(`[sos-alert] BASIC → ${c.name}: call=${callResult?.sid || "FAILED"} sms=${smsSid || "FAILED"}`);
      }
    }

    // ══════════════════════════════════════════════════════════
    // TIER: ELITE — Call bridging + cloud recording + SMS
    // ══════════════════════════════════════════════════════════
    if (tier === "elite") {
      for (const c of contacts) {
        const cleanPhone = c.phone.replace(/[^+\d]/g, "");

        // Build bridge TwiML — calls the contact, then dials the user
        // into a conference so both are on the same recorded line
        const bridgeTwimlUrl = `${SUPA_URL}/functions/v1/sos-bridge-twiml?emergencyId=${encodeURIComponent(emergencyId)}&caller=${encodeURIComponent(userName)}&contactName=${encodeURIComponent(c.name)}&userPhone=${encodeURIComponent(userPhone)}&trackUrl=${encodeURIComponent(trackUrl)}`;

        const callResult = await twilioCall(cleanPhone, bridgeTwimlUrl, {
          statusCallback: statusCb,
          record: true,           // Cloud recording
          machineDetection: true,
          timeout: 30,
        });

        // SMS backup
        const smsBody = [
          `🚨 EMERGENCY — ${userName}`,
          `${c.name}, ${userName} triggered SOS!`,
          `📍 Live: ${trackUrl}`,
          `🔗 Dashboard: ${dashUrl}`,
          bloodType ? `🩸 Blood: ${bloodType}` : "",
          `⏱ Recording active`,
        ].filter(Boolean).join("\n");
        const smsSid = await twilioSMS(cleanPhone, smsBody);

        results.push({
          contactName: c.name,
          phone: cleanPhone,
          callSid: callResult?.sid,
          smsSid,
          method: "bridge_call_recorded_plus_sms",
        });

        console.log(`[sos-alert] ELITE → ${c.name}: bridge=${callResult?.sid || "FAILED"} sms=${smsSid || "FAILED"}`);
      }
    }

    // ── 3. Log results to sos_sessions ────────────────────────
    await supabase.from("sos_sessions").update({
      server_results: results,
      server_triggered_at: new Date().toISOString(),
    }).eq("id", emergencyId);

    // ── 4. Broadcast SOS to dashboard via Realtime ────────────
    try {
      const ch = supabase.channel(`sos-live`);
      await ch.send({
        type: "broadcast",
        event: "sos_triggered",
        payload: {
          emergencyId,
          userName,
          userId,
          tier,
          location,
          contacts: contacts.map(c => c.name),
          zone,
          ts: Date.now(),
        },
      });
      setTimeout(() => supabase.removeChannel(ch), 2000);
    } catch {}

    // ── 5. Return results to client ───────────────────────────
    return new Response(JSON.stringify({
      success: true,
      emergencyId,
      tier,
      results,
      trackUrl,
      dashUrl,
    }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[sos-alert] Unhandled error:", err);
    return new Response(JSON.stringify({
      error: "Internal server error",
      detail: err instanceof Error ? err.message : String(err),
    }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
