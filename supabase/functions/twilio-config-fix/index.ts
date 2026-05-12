// ═══════════════════════════════════════════════════════════════
// SOSphere — twilio-config-fix (one-shot reset to canonical)
// ─────────────────────────────────────────────────────────────
// PURPOSE
//   When twilio-config-probe reports drift on an IncomingPhoneNumber
//   (sms_url pointing at demo.twilio.com, voice_url stale, etc.), this
//   function fixes it in ONE call. PATCHes each phone number on the
//   account to the canonical SOSphere config:
//     sms_url    = <functions>/sos-sms-inbound
//     sms_method = POST
//     voice_url  = <functions>/sos-bridge-twiml
//     voice_method = POST
//
//   Idempotent — calling twice sets the SAME values; Twilio just
//   returns the same row. No side effects beyond the API call.
//
//   Reusable: keep this function deployed as a "config restore"
//   one-shot. Whenever the probe alerts on drift, hit this endpoint
//   to reset. Re-run the probe → green.
//
// AUTH
//   Same PROBE_SECRET bearer pattern as twilio-config-probe +
//   sos-inbound-probe. Constant-time compare. Fail-closed on
//   missing/short secret.
//
// SCOPE LIMIT
//   This function ONLY touches phone-number-level webhook fields.
//   It does NOT modify Messaging Services, Sender Pools, or
//   TwiML Apps. If a number was previously bound to a Messaging
//   Service AND that Service routes inbound, this function's
//   sms_url PATCH effectively removes the Service binding (the
//   Twilio API behavior — setting sms_url clears messaging_service_sid).
//   That's the intended behavior here: the canonical SOSphere
//   config is direct number→webhook routing, which is simplest
//   for current scale.
//
//   For high-volume future deployment that needs Messaging Service
//   features (A2P 10DLC, geo-routing, sender rotation), this
//   function should be EXTENDED to also configure the Service's
//   inbound webhook + add numbers to its Sender Pool.
//
// REQUIRED SUPABASE SECRETS
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   PROBE_SECRET
//   SUPABASE_URL  (auto-set)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface FixResult {
  sid: string;
  phone: string;
  ok: boolean;
  status: number;
  new_sms_url: string | null;
  new_voice_url: string | null;
  new_messaging_service_sid: string | null;
  error?: string;
}

serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const probeSecret = Deno.env.get("PROBE_SECRET");
  if (!probeSecret || probeSecret.length < 16) {
    console.error("[twilio-config-fix] PROBE_SECRET missing/short — fail closed");
    return new Response(JSON.stringify({ error: "probe_misconfigured" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const authHeader = req.headers.get("Authorization") || "";
  if (!constantTimeEquals(authHeader, `Bearer ${probeSecret}`)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const twilioSid   = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const supaUrl     = Deno.env.get("SUPABASE_URL");
  if (!twilioSid || !twilioToken || !supaUrl) {
    return new Response(JSON.stringify({ error: "env_missing" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const functionsHost = supaUrl.replace(
    /^(https?:\/\/[^.]+)\.supabase\.co$/,
    "$1.functions.supabase.co",
  );
  const canonical = {
    SmsUrl:      `${functionsHost}/sos-sms-inbound`,
    SmsMethod:   "POST",
    VoiceUrl:    `${functionsHost}/sos-bridge-twiml`,
    VoiceMethod: "POST",
  };

  const auth = btoa(`${twilioSid}:${twilioToken}`);

  // 1. Fetch all phone numbers on the account.
  let phones: Array<{ sid: string; phone_number: string }> = [];
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json?PageSize=100`,
      { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      const body = await res.text();
      return new Response(JSON.stringify({ error: "twilio_list_failed", status: res.status, body: body.slice(0, 200) }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    phones = Array.isArray(data.incoming_phone_numbers) ? data.incoming_phone_numbers : [];
  } catch (e) {
    return new Response(JSON.stringify({ error: "twilio_list_threw", detail: String(e).slice(0, 200) }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // 2. PATCH each phone number to canonical. Sequential (not parallel)
  // to avoid Twilio rate limiting on accounts with many numbers.
  const results: FixResult[] = [];
  for (const p of phones) {
    const params = new URLSearchParams(canonical);
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${p.sid}.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params,
          signal: AbortSignal.timeout(8000),
        },
      );
      const data = await res.json();
      results.push({
        sid:                       p.sid,
        phone:                     p.phone_number,
        ok:                        res.ok,
        status:                    res.status,
        new_sms_url:               data.sms_url ?? null,
        new_voice_url:             data.voice_url ?? null,
        new_messaging_service_sid: data.messaging_service_sid ?? null,
        error:                     res.ok ? undefined : (data.message || data.detail || `HTTP ${res.status}`),
      });
    } catch (e) {
      results.push({
        sid:                       p.sid,
        phone:                     p.phone_number,
        ok:                        false,
        status:                    0,
        new_sms_url:               null,
        new_voice_url:             null,
        new_messaging_service_sid: null,
        error:                     String(e).slice(0, 200),
      });
    }
  }

  const fixedCount  = results.filter(r => r.ok).length;
  const failedCount = results.length - fixedCount;
  const ok = failedCount === 0 && results.length > 0;

  // Log a structured event for the audit trail.
  if (ok) {
    console.log(`[twilio-config-fix] OK: ${fixedCount}/${results.length} phones updated to canonical config`);
  } else {
    console.error("[twilio-config-fix] FAILED", JSON.stringify({
      fixed: fixedCount,
      failed: failedCount,
      results,
    }));
  }

  return new Response(JSON.stringify({
    ok,
    total:    results.length,
    fixed:    fixedCount,
    failed:   failedCount,
    canonical,
    results,
    generatedAt: new Date().toISOString(),
  }, null, 2), {
    status: ok ? 200 : 207,  // 207 Multi-Status if partial failure
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
