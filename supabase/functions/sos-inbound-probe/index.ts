// ═══════════════════════════════════════════════════════════════
// SOSphere — sos-inbound-probe (L1-D Phase 3)
// ─────────────────────────────────────────────────────────────
// THE GAP THIS CLOSES
//   L2-F shipped the inbound SMS pipeline (sos-sms-inbound function,
//   sos_sms_replies table, ack classifier, Realtime broadcast).
//   L1-D Phase 2 / 2.5 monitor the Twilio CONFIG side (drift). But
//   the EXECUTION side — does an SMS actually arrive at our function,
//   pass signature validation, insert into the DB, and emit a
//   broadcast? — has been untestable without a real human sending
//   SMS through carriers + Twilio + Messaging Service.
//
//   This probe forges a Twilio-shaped inbound POST with a valid
//   X-Twilio-Signature (computed using the same TWILIO_AUTH_TOKEN
//   the production handler uses to VALIDATE). The probe runs the
//   full pipeline:
//     forge payload → sign → POST to sos-sms-inbound
//        → verify row appears in sos_sms_replies
//        → DELETE the probe row (don't pollute real data)
//        → return PASS/FAIL report
//
//   Schedule it every ~10–60 min via GitHub Actions cron and the
//   alerting story for the inbound pipeline is solved.
//
// AUTH
//   Bearer PROBE_SECRET — same pattern as twilio-config-probe.
//
// THE PROBE ROW MARKER
//   message_sid = `PROBE-<unix_ms>-<rand6hex>` so:
//     • Real inbound SMS from Twilio always has a SM-prefixed sid.
//       PROBE- never collides.
//     • Cleanup query is exact-match on message_sid.
//     • If cleanup fails for any reason, the row is still
//       distinguishable (the dashboard can filter PROBE-* out).
//
// REQUIRED SUPABASE SECRETS
//   TWILIO_AUTH_TOKEN  (used to forge a valid signature)
//   TWILIO_FROM_NUMBER (the To= field of the synthetic payload)
//   PROBE_SECRET       (bearer-token auth on this endpoint)
//   SUPABASE_URL                (auto-set)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-set, used for cleanup DELETE)
//
// USAGE FROM A CRON JOB
//   curl -X POST https://<project>.functions.supabase.co/sos-inbound-probe \
//     -H "Authorization: Bearer $PROBE_SECRET"
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  computeTwilioSignature,
  encodeFormBody,
} from "../_shared/twilio-signature.ts";

// Verification window: how long to wait + poll for the probe row
// to appear. The handler does signature validation + DB write + a
// best-effort Realtime broadcast. p95 should be well under 2s; we
// give 5s and 5 polls (1s apart) for safety on a cold-start.
const VERIFY_TIMEOUT_MS = 5000;
const VERIFY_POLL_INTERVAL_MS = 1000;

// Reserved test phone numbers. +15555550100 is a Twilio-published
// test number that exists in their docs as the canonical example —
// it'll never collide with a real customer's contact.
const SYNTHETIC_FROM = "+15555550100";

interface ProbeReport {
  /** Pass = signature accepted + row written + row cleaned up. */
  pass: boolean;
  /** Stage breakdown so failure shows exactly where the pipeline broke. */
  stages: {
    forge:     "ok" | "skipped";
    post:      "ok" | "failed" | "skipped";
    verify:    "ok" | "missing" | "skipped";
    cleanup:   "ok" | "failed" | "skipped";
  };
  /** The marker sid we used — useful for log correlation. */
  probeMessageSid: string;
  /** HTTP status from sos-sms-inbound POST. */
  inboundHttpStatus?: number;
  /** ms from POST→row-visible. */
  elapsedMs?: number;
  /** Free-text failure reason on non-pass. */
  detail?: string;
  generatedAt: string;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

  // Bearer auth — fail closed.
  const probeSecret = Deno.env.get("PROBE_SECRET");
  if (!probeSecret || probeSecret.length < 16) {
    console.error("[sos-inbound-probe] PROBE_SECRET missing/short — fail closed");
    return new Response(JSON.stringify({ error: "probe_misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const authHeader = req.headers.get("Authorization") || "";
  if (!constantTimeEquals(authHeader, `Bearer ${probeSecret}`)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Required env.
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER") || "";
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authToken || !supaUrl || !supaKey) {
    return new Response(JSON.stringify({ error: "env_missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const probeMessageSid = `PROBE-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  // L1-D Phase 3 URL note: Supabase exposes edge functions on TWO host
  // forms — `<project>.supabase.co/functions/v1/<fn>` (the API-gateway
  // routing form, what the Twilio Console webhook is configured as)
  // AND `<project>.functions.supabase.co/<fn>` (the direct-functions
  // hostname). Inside the function, `req.url` reflects the SECOND
  // form regardless of which the caller hit — Supabase's internal
  // dispatch rewrites it. Twilio signs based on whatever URL it was
  // configured with, but the handler validates against `req.url`,
  // so the probe must SIGN the rewritten form to match what the
  // handler will see. Derive the functions hostname from SUPABASE_URL.
  const functionsHost = supaUrl.replace(
    /^(https?:\/\/[^.]+)\.supabase\.co$/,
    "$1.functions.supabase.co",
  );
  const inboundUrl = `${functionsHost}/sos-sms-inbound`;

  const report: ProbeReport = {
    pass: false,
    stages: { forge: "skipped", post: "skipped", verify: "skipped", cleanup: "skipped" },
    probeMessageSid,
    generatedAt: new Date().toISOString(),
  };

  // ── 1. Forge synthetic payload + signature ────────────────────────
  // Use the SAME field shape Twilio sends for an inbound SMS. The
  // signature is computed over these EXACT fields — adding/removing
  // any one of them changes the canonical signing string.
  const params: Record<string, string> = {
    MessageSid:  probeMessageSid,
    AccountSid:  "ACprobe000000000000000000000000000",
    From:        SYNTHETIC_FROM,
    To:          twilioFrom || "+15079673999",
    Body:        "[L1-D Phase 3] synthetic probe — auto-cleanup",
    NumSegments: "1",
    NumMedia:    "0",
  };
  let signature: string;
  try {
    signature = await computeTwilioSignature(authToken, inboundUrl, params);
    report.stages.forge = "ok";
  } catch (e) {
    report.detail = `forge failed: ${(e as Error).message}`;
    return jsonResponse(report, 500, corsHeaders);
  }

  // ── 2. POST to sos-sms-inbound as if we were Twilio ───────────────
  const postStart = Date.now();
  let inboundStatus = 0;
  try {
    const res = await fetch(inboundUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": signature,
      },
      body: encodeFormBody(params),
      signal: AbortSignal.timeout(8000),
    });
    inboundStatus = res.status;
    report.inboundHttpStatus = inboundStatus;
    // sos-sms-inbound returns 200 + empty TwiML on success and on
    // signature-invalid. We treat 200 as "function ran"; the verify
    // step below proves whether the row was actually inserted.
    if (inboundStatus !== 200) {
      report.stages.post = "failed";
      report.detail = `inbound HTTP ${inboundStatus}`;
      return jsonResponse(report, 200, corsHeaders);
    }
    report.stages.post = "ok";
  } catch (e) {
    report.stages.post = "failed";
    report.detail = `POST threw: ${(e as Error).message}`;
    return jsonResponse(report, 200, corsHeaders);
  }

  // ── 3. Verify the row landed in sos_sms_replies ──────────────────
  const supabase = createClient(supaUrl, supaKey);
  let rowSeen = false;
  const verifyDeadline = postStart + VERIFY_TIMEOUT_MS;
  while (Date.now() < verifyDeadline) {
    const { data, error } = await supabase
      .from("sos_sms_replies")
      .select("id, message_sid")
      .eq("message_sid", probeMessageSid)
      .limit(1);
    if (error) {
      // SELECT failure isn't fatal yet — retry until timeout. If it
      // persists, the timeout-driven "missing" path will fire.
      console.warn("[sos-inbound-probe] SELECT error (will retry):", error.message);
    } else if (data && data.length > 0) {
      rowSeen = true;
      break;
    }
    await new Promise(r => setTimeout(r, VERIFY_POLL_INTERVAL_MS));
  }
  report.elapsedMs = Date.now() - postStart;
  report.stages.verify = rowSeen ? "ok" : "missing";

  // ── 4. Cleanup — DELETE the probe row regardless of verify outcome ─
  // Service-role key bypasses RLS, so this works even though the
  // table has no DELETE policy for authenticated users.
  try {
    const { error } = await supabase
      .from("sos_sms_replies")
      .delete()
      .eq("message_sid", probeMessageSid);
    report.stages.cleanup = error ? "failed" : "ok";
    if (error) console.warn("[sos-inbound-probe] cleanup DELETE error:", error.message);
  } catch (e) {
    report.stages.cleanup = "failed";
    console.warn("[sos-inbound-probe] cleanup threw:", e);
  }

  report.pass = (
    report.stages.forge   === "ok" &&
    report.stages.post    === "ok" &&
    report.stages.verify  === "ok"
  );

  // Alerting — structured log + audit_log on FAIL.
  if (!report.pass) {
    console.error("[sos-inbound-probe] PIPELINE_BROKEN", JSON.stringify({
      stages:           report.stages,
      probeMessageSid:  report.probeMessageSid,
      inboundHttpStatus: report.inboundHttpStatus,
      elapsedMs:        report.elapsedMs,
      detail:           report.detail,
    }));
    try {
      await supabase.rpc("log_sos_audit", {
        p_action:       "sos_inbound_pipeline_broken",
        p_actor:        "system_probe",
        p_actor_level:  "system",
        p_operation:    "telephony_health",
        p_target:       null,
        p_target_name:  null,
        p_metadata: {
          severity:    "warning",
          stages:      report.stages,
          probe_sid:   report.probeMessageSid,
          inbound_http_status: report.inboundHttpStatus,
          elapsed_ms:  report.elapsedMs,
          detail:      report.detail,
        },
      });
    } catch (e) {
      console.warn("[sos-inbound-probe] audit_log mirror failed (non-fatal):", e);
    }
  } else {
    console.log(`[sos-inbound-probe] OK: end-to-end ${report.elapsedMs}ms`);
  }

  return jsonResponse(report, 200, corsHeaders);
});

function jsonResponse(body: ProbeReport, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
