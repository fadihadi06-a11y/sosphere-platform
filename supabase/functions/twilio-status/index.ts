// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio Status Webhook (Edge Function)
// Receives call/SMS status updates from Twilio and:
//   1. Logs them to Supabase DB (call_events table)
//   2. Broadcasts updates via Supabase Realtime
//   3. Handles Gather input (admin pressed 1 to accept)
//
// Also handles escalation logic:
//   - If call goes to voicemail → trigger SMS
//   - If call unanswered after 30s → trigger SMS
//
// Required Supabase Secrets:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   SOSPHERE_BASE_URL
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// B-09 (2026-04-25): self-signed gather-token to close the
// signature-bypass hole the prior code left open for action=gather.
import { verifyGatherToken } from "../_shared/gather-token.ts";

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

async function validateTwilioSignature(
  req: Request,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  const sigHeader = req.headers.get("X-Twilio-Signature");
  if (!sigHeader) return false;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    console.error("[twilio-status] TWILIO_AUTH_TOKEN missing — rejecting request (fail closed)");
    return false;
  }
  const sortedKeys = Object.keys(params).sort();
  let dataToSign = url;
  for (const k of sortedKeys) dataToSign += k + params[k];
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataToSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return sigB64 === sigHeader;
}

async function endConference(conferenceSid: string): Promise<void> {
  const twilioSid   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  try {
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Conferences/${conferenceSid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ Status: "completed" }),
      }
    );
    console.log(`[twilio-status] Conference ${conferenceSid} explicitly ended`);
  } catch (err) {
    console.error(`[twilio-status] Failed to end conference ${conferenceSid}:`, err);
  }
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const url = new URL(req.url);
    const callId = url.searchParams.get("callId") || "";
    const action = url.searchParams.get("action") || "status";
    const type = url.searchParams.get("type") || "call";
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => { data[key] = String(value); });

    // L1-D Phase 3 fix: Supabase's gateway terminates TLS and forwards
    // plain HTTP to the function container, so req.url's protocol is
    // "http:" internally. Twilio signs the webhook URL as configured
    // (always "https:"). Coerce to https here so the canonical URL
    // matches what Twilio signed. Same fix applied to sos-sms-inbound.
    const canonicalUrl = req.url.replace(/^http:\/\//, "https://");

    // B-09: gather requires gtok; other actions require Twilio signature
    if (action === "gather") {
      const gtok = url.searchParams.get("gtok");
      const tokRes = await verifyGatherToken(gtok, callId);
      if (!tokRes.ok) {
        console.warn(`[twilio-status] gather token verification FAILED reason=${tokRes.reason} callId=${callId} — rejecting`);
        return new Response(JSON.stringify({ error: "Invalid gather token" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const twilioOk = await validateTwilioSignature(req, canonicalUrl, data);
      if (!twilioOk) {
        console.warn(`[twilio-status] gather: Twilio signature did not validate (callId=${callId}) — gtok was OK so proceeding`);
      }
    } else {
      const valid = await validateTwilioSignature(req, canonicalUrl, data);
      if (!valid) {
        console.warn("[twilio-status] Signature validation FAILED — rejecting request");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    console.log(`[twilio-status] ${action} | type=${type} | callId=${callId} | status=${data.CallStatus || data.MessageStatus || data.StatusCallbackEvent || "unknown"}`);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (type === "conference") {
      const event = data.StatusCallbackEvent;
      const conferenceSid = data.ConferenceSid;
      console.log(`[twilio-status] Conference event: ${event} conf=${conferenceSid} callId=${callId}`);
      await logCallEvent(supabase, callId, `conf_${event}`, data);
      if (event === "participant-leave" && conferenceSid) {
        try {
          const twilioSid   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
          const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
          const partsRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Conferences/${conferenceSid}/Participants.json`,
            { headers: { Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}` } }
          );
          const partsData = await partsRes.json();
          const count = partsData.participants?.length ?? 0;
          if (count === 0) {
            console.log(`[twilio-status] Conference ${conferenceSid} empty — killing it to stop billing`);
            await endConference(conferenceSid);
          }
        } catch (err) {
          console.error("[twilio-status] Failed to check conference participants:", err);
        }
      }
      return new Response(JSON.stringify({ received: true, event, conferenceSid }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "gather") {
      const digit = data.Digits;
      const baseUrl = url.searchParams.get("baseUrl") || Deno.env.get("SOSPHERE_BASE_URL") || "";
      if (digit === "1") {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna">\n    Thank you. Opening the emergency dashboard now.\n    The dashboard link has been sent to your phone.\n    Stay on the line for updates.\n  </Say>\n  <Pause length="60"/>\n  <Say voice="Polly.Joanna">The call has ended. Please check the dashboard for updates.</Say>\n</Response>`;
        // W3-29: validate target phone against DB allowlist
        if (data.From && baseUrl && callId) {
          const target = String(data.Called || data.From).replace(/[^+\d]/g, "");
          const allowed = await resolveAllowedEscalationPhones(supabase, callId);
          if (allowed.has(target)) {
            await sendEscalationSMS(supabaseUrl, target, callId, baseUrl);
          } else {
            console.warn(`[twilio-status] gather: phone ${target} not in allowlist for callId=${callId} — refusing escalation SMS`);
          }
        }
        await logCallEvent(supabase, callId, "accepted", data);

        // L1-C: this is the SLA-critical "acknowledged" event — a contact
        // pressed 1 to confirm receipt. Resolve trace_id from either the
        // gather URL query param (sos-alert appends &trace_id=… per the
        // L1-A wiring) OR from the session row by callId. UPDATE WHERE
        // responder_acked_at IS NULL means first ack wins (idempotent).
        // Best-effort — never block the TwiML response.
        try {
          let ackTraceId = url.searchParams.get("trace_id") || null;
          if (!ackTraceId && callId) {
            const { data: sess } = await supabase
              .from("sos_sessions")
              .select("trace_id")
              .eq("id", callId)
              .maybeSingle();
            ackTraceId = (sess as unknown as { trace_id?: string | null })?.trace_id || null;
          }
          if (ackTraceId) {
            await supabase.rpc("record_sos_pipeline_acked", {
              p_trace_id: ackTraceId,
              p_contacts_reached: 1,
            });
          }
        } catch (e) {
          console.warn("[twilio-status] pipeline_metrics acked failed (non-fatal):", e);
        }
        await supabase.channel(`call-${callId}`).send({
          type: "broadcast",
          event: "call_status",
          payload: { callId, status: "accepted", adminPhone: data.Called },
        });
        return new Response(twiml, { headers: { ...corsHeaders, "Content-Type": "text/xml" } });
      } else if (digit === "2") {
        // W3-26 (B-20, 2026-04-26): the previous Redirect to twilio-call?replay
        // hit a JWT-required endpoint and 401'd — IVR Press-2 was effectively
        // dead. Twilio doesn't carry our Supabase JWT, and the replay path was
        // never wired to accept the signed Twilio webhook in lieu of JWT.
        // Inline a graceful response: acknowledge + hang up. The dispatcher
        // dashboard already has a "call again" affordance for the operator
        // side; the IVR repeat-message flow is a nice-to-have we can wire
        // properly post-launch via a public Twilio-signed endpoint.
        const replayTwiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna">If you need to hear the alert again, please call back. Goodbye.</Say>\n  <Hangup/>\n</Response>`;
        return new Response(replayTwiml, { headers: { ...corsHeaders, "Content-Type": "text/xml" } });
      } else {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna">Invalid input. Goodbye.</Say>\n</Response>`;
        return new Response(twiml, { headers: { ...corsHeaders, "Content-Type": "text/xml" } });
      }
    }

    if (type === "call") {
      const callStatus = data.CallStatus;
      const callSid = data.CallSid;
      const answeredBy = data.AnsweredBy;
      await logCallEvent(supabase, callId, callStatus, data);
      if (callId) {
        // A-17 / W3 TIER 2 (B-20, 2026-04-26): use try/finally so the
        // channel cleanup fires even if .send() rejects. Pre-fix: rejected
        // channel.send() left the handle leaked (setTimeout was inside try).
        const channel = supabase.channel(`call-${callId}`);
        try {
          await channel.send({
            type: "broadcast",
            event: "call_status",
            payload: { callId, callSid, status: callStatus, answeredBy, timestamp: new Date().toISOString() },
          });
        } catch (e) {
          console.warn("[twilio-status] Broadcast failed:", e);
        } finally {
          setTimeout(() => supabase.removeChannel(channel), 3000);
        }
      }

      // ── L2-E Phase 2 (2026-05-10): retry-or-escalate decision ─────────
      // The original-fanout call leg from sos-alert carries
      // contactIndex, attemptN, tier in the statusCallback URL. On final
      // status:
      //   • no-answer / busy + attemptN < MAX_CALL_ATTEMPTS  → retry call.
      //                                                        SKIP SMS so
      //                                                        the contact
      //                                                        doesn't get
      //                                                        spammed during
      //                                                        the in-flight
      //                                                        retry ring.
      //   • no-answer / busy + attemptN ≥ MAX_CALL_ATTEMPTS  → fire SMS
      //                                                        (cascade
      //                                                        exhausted).
      //   • failed                                          → fire SMS
      //                                                        (Twilio-side
      //                                                        fault, retry
      //                                                        unlikely to
      //                                                        help and may
      //                                                        amplify load).
      //   • completed + machine_start (voicemail)           → fire SMS
      //                                                        (contact has
      //                                                        a chance to
      //                                                        see voicemail
      //                                                        AND text).
      //   • completed + human                               → no SMS
      //                                                        (already
      //                                                        reached).
      // Twilio fires StatusCallback for many statuses; we only act on
      // FINAL statuses (no-answer, busy, failed, completed) to avoid
      // duplicate decisions on `initiated`/`ringing`/`answered`.
      const MAX_CALL_ATTEMPTS = 2;
      const contactIndex = parseInt(url.searchParams.get("contactIndex") || "-1", 10);
      const attemptN     = parseInt(url.searchParams.get("attemptN") || "1", 10);
      const tierParam    = url.searchParams.get("tier") || "";
      const isFinalStatus = ["completed", "no-answer", "busy", "failed", "canceled"].includes(callStatus);
      const isRecoverableNoAnswer = callStatus === "no-answer" || callStatus === "busy";
      const isVoicemail = callStatus === "completed" && answeredBy === "machine_start";
      const isFailed = callStatus === "failed";

      let didFireRetry = false;
      if (
        isFinalStatus &&
        isRecoverableNoAnswer &&
        attemptN < MAX_CALL_ATTEMPTS &&
        callId &&
        contactIndex >= 0
      ) {
        try {
          didFireRetry = await fireRetryCall(
            supabase,
            callId,
            contactIndex,
            tierParam,
            attemptN + 1,
            url.searchParams.get("trace_id"),
          );
        } catch (e) {
          console.error("[twilio-status] retry call failed (will fall through to SMS):", e);
        }
      }

      const shouldEscalateToSMS =
        !didFireRetry &&
        (
          (isRecoverableNoAnswer && attemptN >= MAX_CALL_ATTEMPTS) ||
          isFailed ||
          isVoicemail
        );
      if (shouldEscalateToSMS && callId) {
        console.log(`[twilio-status] Escalating to SMS for callId=${callId} (status=${callStatus}, attemptN=${attemptN}, didFireRetry=${didFireRetry})`);
        const baseUrl = Deno.env.get("SOSPHERE_BASE_URL") || "";
        const adminPhoneRaw = data.Called || data.To;
        if (adminPhoneRaw && baseUrl) {
          // W3-29: validate against DB allowlist before SMS
          const target = String(adminPhoneRaw).replace(/[^+\d]/g, "");
          const allowed = await resolveAllowedEscalationPhones(supabase, callId);
          if (allowed.has(target)) {
            await sendEscalationSMS(supabaseUrl, target, callId, baseUrl);
          } else {
            console.warn(`[twilio-status] escalate: phone ${target} not in allowlist for callId=${callId} — refusing SMS`);
          }
        }
      }
    }

    if (type === "sms") {
      const messageStatus = data.MessageStatus;
      await logCallEvent(supabase, callId, `sms_${messageStatus}`, data);
    }

    return new Response(
      JSON.stringify({ received: true, callId, action, type }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[twilio-status] Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function logCallEvent(
  supabase: any,
  callId: string,
  status: string,
  rawData: Record<string, string>,
) {
  // Existing call_events write — operational telemetry.
  try {
    await supabase.from("call_events").insert({
      id: `CE-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      call_id: callId,
      status,
      call_sid: rawData.CallSid || rawData.MessageSid || null,
      from_number: rawData.From || null,
      to_number: rawData.To || rawData.Called || null,
      duration: rawData.CallDuration ? parseInt(rawData.CallDuration) : null,
      answered_by: rawData.AnsweredBy || null,
      raw_data: rawData,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[twilio-status] Failed to log call_event:", e);
  }

  // W3-46 (B-20, 2026-04-26): also write to audit_log via log_sos_audit RPC.
  // Pre-fix: Twilio call lifecycle (initiated/ringing/answered/completed/
  // busy/no-answer/failed) was visible only in `call_events` — the
  // dashboard's compliance reports + forensic timeline read from
  // `audit_log` so the evidence chain had a black hole between SOS-trigger
  // (auditted) and SOS-resolve (auditted) for the actual call delivery
  // events. Now: each Twilio status mirrors into audit_log with the
  // emergencyId target and the relevant metadata. Failures are
  // best-effort — telemetry must never block a Twilio webhook.
  try {
    const auditAction = `twilio_${status}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60);
    await supabase.rpc("log_sos_audit", {
      p_action: auditAction,
      p_actor: "twilio_webhook",
      p_actor_level: "system",
      p_operation: "telephony",
      p_target: callId || null,
      p_target_name: rawData.From || rawData.Called || null,
      p_metadata: {
        call_sid: rawData.CallSid || rawData.MessageSid || null,
        duration: rawData.CallDuration ? parseInt(rawData.CallDuration) : null,
        answered_by: rawData.AnsweredBy || null,
        twilio_status: status,
        severity: status === "failed" || status === "no-answer" ? "warning" : "info",
      },
    });
  } catch (e) {
    console.warn("[twilio-status] Failed to mirror to audit_log:", e);
  }
}

// W3-29 (B-20, 2026-04-26): resolve allowed escalation phones for callId
// from the DB instead of trusting the (signed but attacker-controlled)
// Twilio From/Called payload. Pre-fix: an attacker who calls our Twilio
// number triggered a webhook with their own number in `From`; we then
// fired escalation SMS to that attacker's phone — phishing seed.
// Post-fix: only phones that exist in either:
//   • profiles.phone for sos_sessions.user_id (the SOS owner)
//   • company_memberships → profiles.phone for the SOS company's admins
// are accepted. Caller phone (data.From / data.Called) is matched against
// this allowlist; mismatch → escalation skipped + warned.
async function resolveAllowedEscalationPhones(
  supabase: any,
  callId: string,
): Promise<Set<string>> {
  const allowed = new Set<string>();
  try {
    const { data: session } = await supabase.from("sos_sessions")
      .select("user_id, company_id").eq("id", callId).maybeSingle();
    if (!session?.user_id) return allowed;
    // SOS owner
    const { data: ownerProfile } = await supabase.from("profiles")
      .select("phone").eq("id", session.user_id).maybeSingle();
    if (ownerProfile?.phone) allowed.add(String(ownerProfile.phone).replace(/[^+\d]/g, ""));
    // Company admins
    if (session.company_id) {
      const { data: members } = await supabase.from("company_memberships")
        .select("user_id, role")
        .eq("company_id", session.company_id)
        .eq("active", true)
        .in("role", ["owner", "super_admin", "admin"]);
      const adminIds = (members || []).map((m: any) => m.user_id);
      if (adminIds.length > 0) {
        const { data: adminProfiles } = await supabase.from("profiles")
          .select("phone").in("id", adminIds);
        for (const p of adminProfiles || []) {
          if (p.phone) allowed.add(String(p.phone).replace(/[^+\d]/g, ""));
        }
      }
    }
  } catch (e) {
    console.warn("[twilio-status] resolveAllowedEscalationPhones failed:", e);
  }
  return allowed;
}

// ── L2-E Phase 2 (2026-05-10) ─────────────────────────────────────────
// Fire ONE retry call for a fanout leg that ended in no-answer/busy.
// Rebuilds the same tier-appropriate TwiML URL from sos_sessions
// (we don't trust any field from the Twilio webhook payload for this
// — the same allowlist principle as escalation SMS).
//
// Returns true if the retry was successfully dispatched (or attempted),
// false if we couldn't dispatch (missing session, bad contact index,
// Twilio API error). False => caller falls through to SMS escalation
// so the contact still gets *some* signal.
async function fireRetryCall(
  supabase: any,
  callId: string,
  contactIndex: number,
  tierParam: string,
  nextAttemptN: number,
  traceId: string | null,
): Promise<boolean> {
  const twilioSid   = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom  = Deno.env.get("TWILIO_FROM_NUMBER");
  const supaUrl     = Deno.env.get("SUPABASE_URL");
  const baseUrl     = Deno.env.get("SOSPHERE_BASE_URL") || "";
  if (!twilioSid || !twilioToken || !twilioFrom || !supaUrl) {
    console.warn("[twilio-status] retry: missing Twilio/Supabase env — skipping retry");
    return false;
  }

  // Resolve session + contact from DB (trusted source). We use
  // contact_snapshot (frozen at trigger time) so a mid-SOS phone edit
  // does NOT change the dialed number for the retry — that would
  // diverge from the L2-B audit ledger expectation.
  const { data: session } = await supabase
    .from("sos_sessions")
    .select("id, user_id, company_id, user_name, user_phone, tier, contact_snapshot, trace_id, lat, lng, accuracy, blood_type, started_at, status")
    .eq("id", callId)
    .maybeSingle();
  if (!session) {
    console.warn(`[twilio-status] retry: no session for callId=${callId} — skipping`);
    return false;
  }
  // If the SOS is already resolved (responder ack'd, user canceled, or
  // auto-closed) — don't retry. The L1-C contract is already satisfied.
  if (session.status && session.status !== "active") {
    console.log(`[twilio-status] retry: session status=${session.status} — skipping retry (SOS already resolved)`);
    return false;
  }
  const snapshot = Array.isArray(session.contact_snapshot) ? session.contact_snapshot : [];
  const contact = snapshot[contactIndex];
  if (!contact?.phone || !contact?.name) {
    console.warn(`[twilio-status] retry: contact_snapshot[${contactIndex}] missing for callId=${callId}`);
    return false;
  }
  const cleanPhone = String(contact.phone).replace(/[^+\d]/g, "");
  // Use the session's tier as the authoritative source; tierParam from
  // the URL is best-effort (tamper-resistant only because the URL was
  // built by sos-alert, but DB is the trust root).
  const tier = String(session.tier || tierParam || "basic").toLowerCase();
  const userName = String(session.user_name || "Unknown");
  const userPhone = String(session.user_phone || "");
  const trackUrl = `${baseUrl}/track?eid=${callId}`;

  // Tier-appropriate TwiML URL — must match what sos-alert built on
  // the first attempt so the contact hears the same script. Free +
  // Basic use announce mode; Elite uses bridge conference.
  let twimlUrl: string;
  let timeLimitSec: number;
  if (tier === "elite") {
    twimlUrl = `${supaUrl}/functions/v1/sos-bridge-twiml?emergencyId=${encodeURIComponent(callId)}&caller=${encodeURIComponent(userName)}&contactName=${encodeURIComponent(contact.name)}&userPhone=${encodeURIComponent(userPhone)}&trackUrl=${encodeURIComponent(trackUrl)}`;
    timeLimitSec = 120;
  } else if (tier === "basic") {
    twimlUrl = `${supaUrl}/functions/v1/sos-bridge-twiml?mode=announce&emergencyId=${encodeURIComponent(callId)}&caller=${encodeURIComponent(userName)}&contactName=${encodeURIComponent(contact.name)}&trackUrl=${encodeURIComponent(trackUrl)}`;
    timeLimitSec = 60;
  } else {
    // free (or unknown — fall through to safest minimal call)
    twimlUrl = `${supaUrl}/functions/v1/sos-bridge-twiml?mode=announce&emergencyId=${encodeURIComponent(callId)}&caller=${encodeURIComponent(userName)}&contactName=${encodeURIComponent(contact.name)}&trackUrl=${encodeURIComponent(trackUrl)}`;
    timeLimitSec = 30;
  }

  // New per-attempt statusCallback so the NEXT final-status webhook
  // sees attemptN=2 and skips retry. trace_id is preserved end-to-end
  // so the L1-A timeline links every retry to the original SOS.
  const statusCbParams = new URLSearchParams({
    callId,
    contactIndex: String(contactIndex),
    attemptN: String(nextAttemptN),
    tier,
  });
  const effectiveTrace = traceId || session.trace_id;
  if (effectiveTrace) statusCbParams.set("trace_id", effectiveTrace);
  const statusCb = `${supaUrl}/functions/v1/twilio-status?${statusCbParams.toString()}`;

  // Fire the Twilio call. Same shape as sos-alert's twilioCall() —
  // we keep this inline (rather than importing) because edge functions
  // are independently deployed and we don't want a coupling that
  // breaks if sos-alert is mid-deploy.
  const auth = btoa(`${twilioSid}:${twilioToken}`);
  const params = new URLSearchParams({
    To: cleanPhone,
    From: twilioFrom,
    Url: twimlUrl,
    StatusCallback: statusCb,
    StatusCallbackMethod: "POST",
    StatusCallbackEvent: "initiated ringing answered completed",
    Timeout: "30",
    TimeLimit: String(timeLimitSec),
    MachineDetection: "Enable",
  });
  let retrySid: string | null = null;
  let retryOutcome: "sent" | "failed" = "failed";
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`,
      {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    const body = await res.json();
    if (res.ok && body?.sid) {
      retrySid = body.sid;
      retryOutcome = "sent";
      console.log(`[twilio-status] retry call dispatched: callId=${callId} idx=${contactIndex} attempt=${nextAttemptN} sid=${retrySid}`);
    } else {
      console.error(`[twilio-status] retry call API error:`, body);
    }
  } catch (err) {
    console.error(`[twilio-status] retry call fetch threw:`, err);
  }

  // L2-B ledger: append the retry attempt regardless of outcome so the
  // dispatch_attempts table is the canonical "what we tried" record.
  // Failure to log must not block — same best-effort pattern as the
  // primary fanout writes in sos-alert.
  try {
    const channel = tier === "elite" ? "bridge_call" : "tts_call";
    await supabase.rpc("record_sos_dispatch_attempt", {
      p_emergency_id:  callId,
      p_contact_index: contactIndex,
      p_channel:       channel,
      p_outcome:       retryOutcome,
      p_trace_id:      effectiveTrace ?? null,
      p_company_id:    session.company_id ?? null,
      p_user_id:       session.user_id ?? null,
      p_contact_name:  contact.name,
      p_contact_phone: cleanPhone,
      p_provider_sid:  retrySid,
    });
  } catch (e) {
    console.warn("[twilio-status] retry ledger write failed (non-fatal):", e);
  }

  // We "fired" the retry only if Twilio accepted it. If the API call
  // failed, return false so the caller falls through to SMS escalation
  // — the contact still gets something.
  return retryOutcome === "sent";
}

async function sendEscalationSMS(
  supabaseUrl: string,
  adminPhone: string,
  callId: string,
  baseUrl: string,
) {
  try {
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER") || "";
    if (!twilioFrom) {
      console.warn("[twilio-status] No TWILIO_FROM_NUMBER set, skipping SMS escalation");
      return;
    }
    const smsBody = [
      `🚨 SOSphere Emergency Alert`,
      ``,
      `A call was made but not answered.`,
      `Open the dashboard immediately:`,
      `${baseUrl}/emergency/${callId}`,
    ].join("\n");
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = btoa(`${accountSid}:${authToken}`);
    await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: adminPhone, From: twilioFrom, Body: smsBody }).toString(),
    });
    console.log(`[twilio-status] Escalation SMS sent to ${adminPhone}`);
  } catch (e) {
    console.error("[twilio-status] Escalation SMS failed:", e);
  }
}
