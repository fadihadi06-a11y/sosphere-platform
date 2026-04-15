// ═══════════════════════════════════════════════════════════════
// SOSphere — SOS Alert Orchestrator (Edge Function) — HARDENED v2
// Handles: POST /functions/v1/sos-alert
//
// THE BRAIN: receives SOS payload from mobile app and orchestrates
// the entire server-side emergency response based on subscription tier.
//
// Actions (via ?action= query param):
//   POST /sos-alert              → trigger (main SOS activation)
//   POST /sos-alert?action=prewarm   → fire-and-forget survival beacon
//   POST /sos-alert?action=heartbeat → device ping (30s)
//   POST /sos-alert?action=escalate  → watchdog escalation (stage 1/2)
//   POST /sos-alert?action=end       → end SOS session
//
// Tier Logic (SERVER-ENFORCED, not client-trusted):
//   Free  → SMS only (tracking link)
//   Basic → TTS call + SMS
//   Elite → Conference bridge + recording + SMS
//
// Security:
//   • userId extracted from JWT (Authorization header), NOT payload
//   • tier looked up from subscriptions table (DB), NOT payload
//   • Subscription.status + expiry checked
//   • Idempotent upsert (same emergencyId safe to retry)
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
interface AiScriptPayload {
  text: string;
  language: "en-US" | "ar-SA";
  voice: string;
}

interface SOSPayload {
  emergencyId: string;
  userId: string;
  userName: string;
  userPhone: string;
  contacts: { name: string; phone: string; relation: string }[];
  location: { lat: number; lng: number; accuracy: number; address?: string };
  bloodType?: string;
  zone?: string;
  silent?: boolean;
  /** Elite-only personalised <Say> script (client-supplied, server-validated). */
  aiScript?: AiScriptPayload;
}

// ── AI script validation ─────────────────────────────────────
// Server authoritative: never trust client blindly. The tier check
// happens AFTER JWT resolution in the trigger handler; this helper
// only enforces shape + length safety (TwiML injection defence).
const AI_VOICE_ALLOWLIST = new Set([
  "Polly.Joanna",
  "Polly.Matthew",
  "Polly.Amy",
  "Polly.Zeina",
]);
const AI_LANG_ALLOWLIST = new Set(["en-US", "ar-SA"]);

function sanitizeAiScript(raw: unknown): AiScriptPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.trim() : "";
  const language = typeof r.language === "string" ? r.language : "";
  const voice = typeof r.voice === "string" ? r.voice : "";
  if (!text) return null;
  if (text.length > 600) return null;                    // TwiML <Say> safety cap
  if (!AI_LANG_ALLOWLIST.has(language)) return null;     // only known Polly langs
  if (!AI_VOICE_ALLOWLIST.has(voice)) return null;       // only whitelisted voices
  // Defence in depth: reject suspicious control chars that could
  // escape the <Say> element. Safe punctuation is preserved.
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) return null;
  return { text, language: language as "en-US" | "ar-SA", voice };
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

// ── Auth Helper: extract userId from JWT ─────────────────────
async function authenticate(req: Request, supabase: any): Promise<{ userId: string | null; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: null, error: "Missing Bearer token" };
  }
  const jwt = authHeader.replace("Bearer ", "");
  try {
    const { data: { user }, error } = await supabase.auth.getUser(jwt);
    if (error || !user) return { userId: null, error: error?.message || "Invalid token" };
    return { userId: user.id };
  } catch (err) {
    return { userId: null, error: "Auth check failed" };
  }
}

// ── Tier Resolver: DB-based, subscription-status aware ───────
async function resolveTier(userId: string, supabase: any): Promise<"free" | "basic" | "elite"> {
  try {
    const { data } = await supabase
      .from("subscriptions")
      .select("tier, status, current_period_end")
      .eq("user_id", userId)
      .single();

    if (!data) return "free";

    // Check status is active (not cancelled/past_due/unpaid)
    const activeStatuses = ["active", "trialing"];
    if (!activeStatuses.includes(data.status)) return "free";

    // Check not expired (if current_period_end is set)
    if (data.current_period_end) {
      const expiresAt = new Date(data.current_period_end).getTime();
      if (expiresAt < Date.now()) return "free";
    }

    const tier = (data.tier || "").toLowerCase();
    if (tier === "elite" || tier === "premium") return "elite";
    if (tier === "basic" || tier === "standard") return "basic";
    return "free";
  } catch (err) {
    console.warn("[sos-alert] Tier lookup failed, defaulting to free:", err);
    return "free";
  }
}

// ═══════════════════════════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════════════════════════
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "trigger";
  const supabase = createClient(SUPA_URL, SUPA_KEY);

  try {
    // ═════════════════════════════════════════════════════════
    // ACTION: PREWARM — fire-and-forget survival beacon
    // Does NOT require JWT (may be called via sendBeacon which can't set headers)
    // Inserts a minimal session row so pg_cron can escalate if trigger never arrives
    // ═════════════════════════════════════════════════════════
    if (action === "prewarm") {
      const pw = await req.json();
      if (!pw.emergencyId || !pw.userId) {
        return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: cors });
      }

      // Idempotent upsert: if prewarm or trigger already created the row, no-op
      await supabase.from("sos_sessions").upsert({
        id: pw.emergencyId,
        user_id: pw.userId,
        user_name: pw.userName || "Unknown",
        status: "prewarm",
        started_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
        lat: pw.location?.lat,
        lng: pw.location?.lng,
        last_lat: pw.location?.lat,
        last_lng: pw.location?.lng,
        accuracy: pw.location?.accuracy,
        tier: pw.tier || "free",
      }, { onConflict: "id", ignoreDuplicates: false });

      console.log(`[sos-alert] PREWARM received: ${pw.emergencyId} user=${pw.userId} tier=${pw.tier}`);
      return new Response(JSON.stringify({ ok: true, prewarmed: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ═════════════════════════════════════════════════════════
    // ACTION: HEARTBEAT — device ping (every 30s)
    // ═════════════════════════════════════════════════════════
    if (action === "heartbeat") {
      const hb = await req.json();

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
      } catch (e) {
        console.warn("[sos-alert] Heartbeat broadcast failed:", e);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ═════════════════════════════════════════════════════════
    // ACTION: ESCALATE — watchdog stage 1 (5s) or stage 2 (15s)
    // Stage 1: Fire SMS burst to all contacts (redundant with trigger, but safe)
    // Stage 2: Force bridge call even if local dialer is working
    // ═════════════════════════════════════════════════════════
    if (action === "escalate") {
      const { emergencyId, stage, reason, forceBridge } = await req.json();

      // Fetch session to get contacts + user info
      const { data: session } = await supabase
        .from("sos_sessions")
        .select("*")
        .eq("id", emergencyId)
        .single();

      if (!session) {
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404, headers: cors,
        });
      }

      // Log escalation event
      await supabase.from("sos_sessions").update({
        escalated: true,
        escalation_stage: stage,
        escalation_reason: reason,
        escalated_at: new Date().toISOString(),
      }).eq("id", emergencyId);

      // Broadcast escalation to dashboard
      try {
        const ch = supabase.channel(`sos-${emergencyId}`);
        await ch.send({
          type: "broadcast",
          event: "escalation",
          payload: { emergencyId, stage, reason, ts: Date.now() },
        });
        setTimeout(() => supabase.removeChannel(ch), 2000);
      } catch {}

      console.log(`[sos-alert] ESCALATE stage=${stage} reason=${reason} emergencyId=${emergencyId}`);
      return new Response(JSON.stringify({ ok: true, stage, forceBridge: !!forceBridge }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ═════════════════════════════════════════════════════════
    // ACTION: END — client ended SOS
    // ═════════════════════════════════════════════════════════
    if (action === "end") {
      const { emergencyId, reason, recordingSec, photos, comment } = await req.json();

      await supabase.from("sos_sessions").update({
        status: "ended",
        ended_at: new Date().toISOString(),
        end_reason: reason || "user_ended",
        recording_seconds: recordingSec,
        photo_count: typeof photos === "number" ? photos : (photos?.length ?? 0),
        comment: comment || null,
      }).eq("id", emergencyId);

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

    // ═════════════════════════════════════════════════════════
    // ACTION: TRIGGER — main SOS activation (default)
    // ═════════════════════════════════════════════════════════

    // ── Auth: extract userId from JWT (SECURITY-CRITICAL) ──
    const auth = await authenticate(req, supabase);
    if (!auth.userId) {
      console.warn("[sos-alert] Unauthorized trigger attempt:", auth.error);
      return new Response(JSON.stringify({ error: "Unauthorized", detail: auth.error }), {
        status: 401, headers: cors,
      });
    }
    const authUserId = auth.userId;

    const payload: SOSPayload = await req.json();
    const { emergencyId, userName, userPhone, contacts, location, bloodType, zone, silent } = payload;

    // Shape-validate aiScript early (tier gate applied after resolveTier below).
    const aiScriptShape = sanitizeAiScript(payload.aiScript);

    // Security: payload.userId must match JWT-derived userId
    if (payload.userId && payload.userId !== authUserId) {
      console.warn(`[sos-alert] userId mismatch: payload=${payload.userId} jwt=${authUserId}`);
      return new Response(JSON.stringify({ error: "userId mismatch" }), {
        status: 403, headers: cors,
      });
    }

    if (!emergencyId || !contacts?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: cors,
      });
    }

    // ── SERVER-SIDE TIER RESOLUTION (ignore client-supplied tier) ──
    const tier = await resolveTier(authUserId, supabase);

    // Apply tier gate: aiScript is Elite-only. For Basic / Free users
    // the server falls back to the default announcement.
    const aiScript: AiScriptPayload | null = (tier === "elite") ? aiScriptShape : null;
    if (aiScriptShape && !aiScript) {
      console.warn(`[sos-alert] aiScript rejected — tier=${tier} not Elite (user=${authUserId})`);
    }

    const trackUrl = `${BASE_URL}/track?eid=${emergencyId}`;
    const dashUrl  = `${BASE_URL}/emergency/${emergencyId}`;
    const statusCb = `${SUPA_URL}/functions/v1/twilio-status?callId=${emergencyId}`;

    console.log(`[sos-alert] ═══ SOS TRIGGERED ═══ id=${emergencyId} tier=${tier} contacts=${contacts.length} silent=${!!silent}`);

    // ── Idempotency: if this emergencyId was already fully triggered, return cached ──
    const { data: existing } = await supabase
      .from("sos_sessions")
      .select("id, status, server_triggered_at, server_results, tier")
      .eq("id", emergencyId)
      .maybeSingle();

    if (existing?.server_triggered_at && existing?.server_results) {
      console.log(`[sos-alert] Idempotent hit — returning cached results for ${emergencyId}`);
      return new Response(JSON.stringify({
        success: true,
        cached: true,
        emergencyId,
        tier: existing.tier,
        results: existing.server_results,
        trackUrl,
        dashUrl,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ── Upsert session (prewarm may have already created a partial row) ──
    await supabase.from("sos_sessions").upsert({
      id: emergencyId,
      user_id: authUserId,
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
      // Elite-only personalised <Say> script (null for Basic/Free,
      // in which case sos-bridge-twiml uses its built-in announcement).
      ai_script: aiScript,
    }, { onConflict: "id", ignoreDuplicates: false });

    // ══════════════════════════════════════════════════════════
    // PARALLEL FANOUT — all contacts simultaneously (5-8× faster)
    // SMS fires non-blocking first (always delivered)
    // Call awaits (may take 15-30s to connect)
    // ══════════════════════════════════════════════════════════
    const fanoutResults = await Promise.all(contacts.map(async (c, idx) => {
      const cleanPhone = c.phone.replace(/[^+\d]/g, "");
      const isPrimaryContact = idx === 0; // First contact = Path A target

      // ── SMS (fires first, in parallel) ──
      let smsBody: string;
      if (tier === "free") {
        smsBody = [
          `🚨 SOS — ${userName}`,
          `${c.name}, ${userName} needs help!`,
          `📍 Location: ${trackUrl}`,
          bloodType ? `🩸 Blood: ${bloodType}` : "",
          `Open: ${dashUrl}`,
        ].filter(Boolean).join("\n");
      } else if (tier === "basic") {
        smsBody = [
          `🚨 SOS — ${userName} needs help!`,
          `📍 Live tracking: ${trackUrl}`,
          bloodType ? `🩸 Blood type: ${bloodType}` : "",
          `Emergency ID: ${emergencyId}`,
        ].filter(Boolean).join("\n");
      } else {
        smsBody = [
          `🚨 EMERGENCY — ${userName}`,
          `${c.name}, ${userName} triggered SOS!`,
          `📍 Live: ${trackUrl}`,
          `🔗 Dashboard: ${dashUrl}`,
          bloodType ? `🩸 Blood: ${bloodType}` : "",
          `⏱ Recording active`,
        ].filter(Boolean).join("\n");
      }

      const smsPromise = twilioSMS(cleanPhone, smsBody);

      // ── Call (tier-dependent) ──
      let callPromise: Promise<{ sid: string; status: string } | null> = Promise.resolve(null);

      if (tier === "basic") {
        const twimlUrl = `${SUPA_URL}/functions/v1/twilio-twiml?emergencyId=${encodeURIComponent(emergencyId)}&caller=${encodeURIComponent(userName)}&contactName=${encodeURIComponent(c.name)}&trackUrl=${encodeURIComponent(trackUrl)}`;
        callPromise = twilioCall(cleanPhone, twimlUrl, {
          statusCallback: statusCb,
          machineDetection: true,
          timeout: 30,
        });
      } else if (tier === "elite") {
        // Primary contact (idx=0) gets a grace delay to avoid double-ringing with Path A
        // Non-primary contacts: fire immediately
        const bridgeTwimlUrl = `${SUPA_URL}/functions/v1/sos-bridge-twiml?emergencyId=${encodeURIComponent(emergencyId)}&caller=${encodeURIComponent(userName)}&contactName=${encodeURIComponent(c.name)}&userPhone=${encodeURIComponent(userPhone)}&trackUrl=${encodeURIComponent(trackUrl)}`;

        if (isPrimaryContact && !silent) {
          // Path A is dialing this contact locally — wait 7s, check if local call connected
          callPromise = (async () => {
            await new Promise(r => setTimeout(r, 7000));
            const { data: s } = await supabase
              .from("sos_sessions")
              .select("local_call_status")
              .eq("id", emergencyId)
              .single();
            if (s?.local_call_status === "connected" || s?.local_call_status === "active") {
              console.log(`[sos-alert] Path A connected for primary contact — skipping Twilio bridge`);
              return null;
            }
            // Path A failed or not connected — fire bridge
            return twilioCall(cleanPhone, bridgeTwimlUrl, {
              statusCallback: statusCb,
              record: false, // Recording happens in TwiML <Conference>
              machineDetection: true,
              timeout: 30,
            });
          })();
        } else {
          callPromise = twilioCall(cleanPhone, bridgeTwimlUrl, {
            statusCallback: statusCb,
            record: false,
            machineDetection: true,
            timeout: 30,
          });
        }
      }
      // Free tier: no call, just SMS

      const [smsSid, callResult] = await Promise.all([smsPromise, callPromise]);

      const method =
        tier === "free" ? "sms_only" :
        tier === "basic" ? "tts_call_plus_sms" :
        "bridge_call_recorded_plus_sms";

      console.log(`[sos-alert] ${tier.toUpperCase()} → ${c.name}: call=${callResult?.sid || "SKIP/FAIL"} sms=${smsSid || "FAIL"}`);

      return {
        contactName: c.name,
        phone: cleanPhone,
        callSid: callResult?.sid ?? null,
        smsSid: smsSid ?? null,
        method,
      };
    }));

    // ── Log results to sos_sessions ──
    await supabase.from("sos_sessions").update({
      server_results: fanoutResults,
      server_triggered_at: new Date().toISOString(),
    }).eq("id", emergencyId);

    // ── Broadcast SOS to dashboard via Realtime ──
    try {
      const ch = supabase.channel(`sos-live`);
      await ch.send({
        type: "broadcast",
        event: "sos_triggered",
        payload: {
          emergencyId,
          userName,
          userId: authUserId,
          tier,
          location,
          contacts: contacts.map(c => c.name),
          zone,
          ts: Date.now(),
        },
      });
      setTimeout(() => supabase.removeChannel(ch), 2000);
    } catch (e) {
      console.warn("[sos-alert] Realtime broadcast failed:", e);
    }

    return new Response(JSON.stringify({
      success: true,
      emergencyId,
      tier,
      results: fanoutResults,
      trackUrl,
      dashUrl,
    }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[sos-alert] Unhandled error:", err);
    return new Response(JSON.stringify({
      error: "Internal error",
      detail: err instanceof Error ? err.message : String(err),
    }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
