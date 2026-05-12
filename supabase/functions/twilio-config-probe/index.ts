// ═══════════════════════════════════════════════════════════════
// SOSphere — twilio-config-probe (L1-D Phase 2)
// ─────────────────────────────────────────────────────────────
// THE GAP THIS CLOSES
//   Twilio webhook URLs are configured in the Twilio Console UI,
//   not in source control. A wrong, stale, or empty value silently
//   breaks the platform:
//     • sms_url missing  → L2-F inbound replies vanish
//     • sms_url stale    → replies hit the OLD project (data leak)
//     • voice_url stale  → inbound voice goes to /dev/null
//   We hit this EXACT failure mode on the L2-F push: the inbound
//   webhook was never set, replies were dropped silently for hours.
//
// WHAT THIS PROBE DOES
//   1. Fetches IncomingPhoneNumbers from Twilio's REST API.
//   2. For each phone number, compares:
//        sms_url      vs. canonical sos-sms-inbound URL
//        sms_method   vs. "POST"
//        voice_url    vs. canonical sos-bridge-twiml URL (best-effort)
//   3. Builds a per-number drift report.
//   4. On ANY drift:
//        - Logs a `twilio_webhook_drift_detected` row to audit_log
//          (so the unified compliance timeline shows it).
//        - Logs a structured console.error which Supabase log-based
//          alerts can route to Sentry / Slack.
//   5. Returns the report as JSON for the caller (cron job, dashboard).
//
// AUTH
//   Bearer token in Authorization header == PROBE_SECRET env. This
//   endpoint is callable by any cron service (Vercel cron, GitHub
//   Actions cron, supabase pg_cron + http_post). It is NOT meant
//   to be hit by end users — no exposure on the public website.
//
// REQUIRED SUPABASE SECRETS
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   PROBE_SECRET          (set this when deploying — any random 32+ char string)
//   SUPABASE_URL          (auto-set)
//   SUPABASE_SERVICE_ROLE_KEY (auto-set)
//
// USAGE FROM A CRON JOB
//   curl -X POST https://<project>.functions.supabase.co/twilio-config-probe \
//     -H "Authorization: Bearer $PROBE_SECRET"
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  detectDrift,
  type TwilioPhoneNumber,
  type TwilioMessagingService,
  type ExpectedConfig,
} from "../_shared/twilio-config-drift.ts";

// ── Edge function HTTP handler ─────────────────────────────────────
serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Bearer-token auth — fail closed on any anomaly.
  const probeSecret = Deno.env.get("PROBE_SECRET");
  if (!probeSecret || probeSecret.length < 16) {
    console.error("[twilio-config-probe] PROBE_SECRET missing/short — fail closed");
    return new Response(JSON.stringify({ error: "probe_misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const authHeader = req.headers.get("Authorization") || "";
  const expectedAuth = `Bearer ${probeSecret}`;
  if (!constantTimeEquals(authHeader, expectedAuth)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const twilioSid   = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const supaUrl     = Deno.env.get("SUPABASE_URL");
  const supaKey     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!twilioSid || !twilioToken || !supaUrl || !supaKey) {
    return new Response(JSON.stringify({ error: "twilio_or_supabase_env_missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Compute expected config from env. Canonical form is the
  // functions.supabase.co hostname — same form req.url shows inside
  // the handler (per L1-D Phase 3 discovery: Supabase rewrites the
  // API-gateway form `/functions/v1/<fn>` to `<fn>.functions.supabase.co`
  // internally). twilio-config-fix configures phones to this form, so
  // the probe's expected MUST match.
  const functionsHost = supaUrl.replace(
    /^(https?:\/\/[^.]+)\.supabase\.co$/,
    "$1.functions.supabase.co",
  );
  const expected: ExpectedConfig = {
    smsUrl:    `${functionsHost}/sos-sms-inbound`,
    smsMethod: "POST",
    voiceUrl:  `${functionsHost}/sos-bridge-twiml`,
  };

  // Fetch IncomingPhoneNumbers from Twilio.
  const twilioAuth = btoa(`${twilioSid}:${twilioToken}`);
  let phones: TwilioPhoneNumber[] = [];
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json?PageSize=100`,
      {
        headers: { Authorization: `Basic ${twilioAuth}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      console.error(`[twilio-config-probe] Twilio API error ${res.status}:`, body.slice(0, 200));
      return new Response(JSON.stringify({ error: "twilio_api_error", status: res.status }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    phones = Array.isArray(data.incoming_phone_numbers) ? data.incoming_phone_numbers : [];
  } catch (e) {
    console.error("[twilio-config-probe] Twilio fetch threw:", e);
    return new Response(JSON.stringify({ error: "twilio_fetch_failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // L1-D Phase 2.5: also fetch Messaging Services. Twilio's Messaging
  // Services API lives on a DIFFERENT host (messaging.twilio.com vs
  // api.twilio.com). When a phone is bound to a Service, the Service's
  // inbound_request_url is the authoritative router — not the number's
  // sms_url. detectDrift uses both lists to apply routing-aware checks.
  // Failure to fetch Services is non-fatal — we still report on phones.
  let services: TwilioMessagingService[] = [];
  try {
    const res = await fetch(
      `https://messaging.twilio.com/v1/Services?PageSize=100`,
      {
        headers: { Authorization: `Basic ${twilioAuth}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.ok) {
      const data = await res.json();
      services = Array.isArray(data.services) ? data.services : [];
    } else {
      const body = await res.text();
      console.warn(`[twilio-config-probe] Services API ${res.status} (non-fatal):`, body.slice(0, 200));
    }
  } catch (e) {
    console.warn("[twilio-config-probe] Services fetch threw (non-fatal):", e);
  }

  const report = detectDrift(phones, expected, services);

  // L1-D Phase 2.5: alerting now covers BOTH phone-level and
  // Service-level drift. The structured log line and the audit_log
  // metadata include drift_summary for each axis so a single alert
  // hit gives admins the full picture without an extra query.
  if (report.driftedCount > 0) {
    console.error("[twilio-config-probe] DRIFT_DETECTED", JSON.stringify({
      driftedCount: report.driftedCount,
      total:        report.total,
      phones:       report.phones.filter((p) => p.issues.length > 0).map((p) => ({
        sid:        p.sid,
        phone:      p.phoneNumber,
        issueCount: p.issues.length,
        fields:     p.issues.map((i) => i.field),
        routedVia:  p.routedVia,
      })),
      services:     report.services.filter((s) => s.issues.length > 0).map((s) => ({
        sid:        s.sid,
        name:       s.friendlyName,
        issueCount: s.issues.length,
        fields:     s.issues.map((i) => i.field),
      })),
    }));
    try {
      const supabase = createClient(supaUrl, supaKey);
      await supabase.rpc("log_sos_audit", {
        p_action:       "twilio_webhook_drift_detected",
        p_actor:        "system_probe",
        p_actor_level:  "system",
        p_operation:    "telephony_config",
        p_target:       null,
        p_target_name:  null,
        p_metadata: {
          severity:      "warning",
          drifted_count: report.driftedCount,
          total_entities: report.total,
          expected_sms_url: expected.smsUrl,
          phone_drift_summary: report.phones
            .filter((p) => p.issues.length > 0)
            .map((p) => ({
              phone:      p.phoneNumber,
              routed_via: p.routedVia,
              issues: p.issues.map((i) => `${i.field}: expected=${i.expected.slice(0, 80)} actual=${i.actual.slice(0, 80)}`),
            })),
          service_drift_summary: report.services
            .filter((s) => s.issues.length > 0)
            .map((s) => ({
              service: s.friendlyName,
              sid:     s.sid,
              issues:  s.issues.map((i) => `${i.field}: expected=${i.expected.slice(0, 80)} actual=${i.actual.slice(0, 80)}`),
            })),
        },
      });
    } catch (e) {
      console.warn("[twilio-config-probe] audit_log mirror failed (non-fatal):", e);
    }
  } else {
    console.log(`[twilio-config-probe] OK: ${report.cleanCount}/${report.total} entities clean (${report.phones.length} phones + ${report.services.length} services)`);
  }

  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

/** Constant-time string compare to defeat timing attacks against
 * PROBE_SECRET. Returns false on length mismatch (also constant-time
 * after the early return — length is non-secret). */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
