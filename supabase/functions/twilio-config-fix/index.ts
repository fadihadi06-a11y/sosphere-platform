// ═══════════════════════════════════════════════════════════════
// SOSphere — twilio-config-fix (one-shot reset to canonical)
// ─────────────────────────────────────────────────────────────
// PURPOSE
//   When twilio-config-probe reports drift on an IncomingPhoneNumber
//   (sms_url pointing at demo.twilio.com, voice_url stale, etc.) or
//   on a Messaging Service's inbound_request_url, this function fixes
//   it in ONE call. PATCHes each entity on the account to the canonical
//   SOSphere config:
//     PHONE:
//       sms_url    = <functions>/sos-sms-inbound
//       sms_method = POST
//       voice_url  = <functions>/sos-bridge-twiml
//       voice_method = POST
//     MESSAGING SERVICE:
//       inbound_request_url = <functions>/sos-sms-inbound
//       inbound_method      = POST
//
//   Idempotent — calling twice sets the SAME values; Twilio just
//   returns the same row. No side effects beyond the API calls.
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
// SCOPE
//   1. PATCHes every IncomingPhoneNumber on the account to canonical
//      sms_url / sms_method / voice_url / voice_method.
//   2. PATCHes every Messaging Service's inbound_request_url +
//      inbound_method to canonical (form B). The Service may have NO
//      phones attached today (current scale uses direct number→webhook)
//      but we still keep its config canonical because:
//        - the probe rightly flags Service drift regardless of binding,
//        - future A2P 10DLC scaling needs the Service ready-to-route,
//        - "configured but unused" is fine; "configured wrong" is drift.
//
//   Still does NOT touch Sender Pools or TwiML Apps.
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
  kind: "phone" | "service";
  sid: string;
  /** phone_number (for kind="phone") or friendly_name (for kind="service"). */
  label: string;
  ok: boolean;
  status: number;
  new_sms_url: string | null;
  new_voice_url: string | null;
  new_messaging_service_sid: string | null;
  /** Set on kind="service" only — the patched inbound_request_url. */
  new_inbound_url: string | null;
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

  // 2. PATCH each phone number to canonical. Sequential to avoid rate limits.
  const results: FixResult[] = [];
  for (const p of phones) {
    const params = new URLSearchParams(canonical);
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${p.sid}.json`,
        {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
          signal: AbortSignal.timeout(8000),
        },
      );
      const data = await res.json();
      results.push({
        kind: "phone", sid: p.sid, label: p.phone_number, ok: res.ok, status: res.status,
        new_sms_url: data.sms_url ?? null,
        new_voice_url: data.voice_url ?? null,
        new_messaging_service_sid: data.messaging_service_sid ?? null,
        new_inbound_url: null,
        error: res.ok ? undefined : (data.message || data.detail || `HTTP ${res.status}`),
      });
    } catch (e) {
      results.push({
        kind: "phone", sid: p.sid, label: p.phone_number, ok: false, status: 0,
        new_sms_url: null, new_voice_url: null, new_messaging_service_sid: null,
        new_inbound_url: null, error: String(e).slice(0, 200),
      });
    }
  }

  // 3. Fetch + PATCH every Messaging Service. Different host: messaging.twilio.com.
  let services: Array<{ sid: string; friendly_name: string }> = [];
  try {
    const lr = await fetch(
      `https://messaging.twilio.com/v1/Services?PageSize=100`,
      { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(8000) },
    );
    if (lr.ok) {
      const data = await lr.json();
      services = Array.isArray(data.services) ? data.services : [];
    } else {
      console.warn(`[twilio-config-fix] Services list ${lr.status} (non-fatal)`);
    }
  } catch (e) {
    console.warn("[twilio-config-fix] Services list threw (non-fatal):", e);
  }

  const serviceCanonical = { InboundRequestUrl: canonical.SmsUrl, InboundMethod: canonical.SmsMethod };
  for (const s of services) {
    const params = new URLSearchParams(serviceCanonical);
    try {
      const res = await fetch(
        `https://messaging.twilio.com/v1/Services/${s.sid}`,
        {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
          signal: AbortSignal.timeout(8000),
        },
      );
      const data = await res.json();
      results.push({
        kind: "service", sid: s.sid, label: s.friendly_name, ok: res.ok, status: res.status,
        new_sms_url: null, new_voice_url: null, new_messaging_service_sid: null,
        new_inbound_url: data.inbound_request_url ?? null,
        error: res.ok ? undefined : (data.message || data.detail || `HTTP ${res.status}`),
      });
    } catch (e) {
      results.push({
        kind: "service", sid: s.sid, label: s.friendly_name, ok: false, status: 0,
        new_sms_url: null, new_voice_url: null, new_messaging_service_sid: null,
        new_inbound_url: null, error: String(e).slice(0, 200),
      });
    }
  }

  const phoneResults   = results.filter(r => r.kind === "phone");
  const serviceResults = results.filter(r => r.kind === "service");
  const fixedCount  = results.filter(r => r.ok).length;
  const failedCount = results.length - fixedCount;
  const ok = failedCount === 0 && phoneResults.length > 0;

  if (failedCount === 0) {
    console.log(`[twilio-config-fix] OK: ${phoneResults.length} phones + ${serviceResults.length} services updated to canonical`);
  } else {
    console.error("[twilio-config-fix] FAILED", JSON.stringify({ fixed: fixedCount, failed: failedCount, results }));
  }

  return new Response(JSON.stringify({
    ok,
    total:    results.length,
    fixed:    fixedCount,
    failed:   failedCount,
    phones:   { total: phoneResults.length,   fixed: phoneResults.filter(r => r.ok).length },
    services: { total: serviceResults.length, fixed: serviceResults.filter(r => r.ok).length },
    canonical,
    results,
    generatedAt: new Date().toISOString(),
  }, null, 2), {
    status: failedCount === 0 ? 200 : 207,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
