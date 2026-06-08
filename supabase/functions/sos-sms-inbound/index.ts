// ═══════════════════════════════════════════════════════════════
// SOSphere — sos-sms-inbound (Twilio inbound SMS webhook)
// ─────────────────────────────────────────────────────────────
// L2-F: when a contact replies to the alert SMS during an active
// SOS, this endpoint captures the reply, classifies it (is it an
// acknowledgement?), broadcasts to the user's emergency screen
// via Realtime, and records to the sos_sms_replies ledger.
//
// Twilio configuration:
//   Console → Phone Numbers → [your number] → Messaging
//   "A MESSAGE COMES IN" webhook URL =
//     https://<project>.functions.supabase.co/sos-sms-inbound
//   Method: POST
//
// What this endpoint guarantees:
//   1. Twilio signature is validated (fail-closed on missing
//      TWILIO_AUTH_TOKEN — never silently accept).
//   2. Idempotent on Twilio MessageSid (a webhook retry returns
//      the existing row id, not a duplicate).
//   3. Resolves the inbound `From` to the most recent ACTIVE
//      sos_sessions whose contact_snapshot[].phone matches. If
//      no active session matches, the reply is still logged but
//      flagged with NULL contact_index — the security team
//      needs to see every inbound, not just expected ones.
//   4. Ack keyword detection runs against a frozen allowlist —
//      keywords are language-agnostic short tokens (ON MY WAY,
//      911, POLICE, AMBULANCE, OK, YES, COMING, EN ROUTE, OMW,
//      911 CALLED) plus Arabic equivalents.
//   5. On positive ack: calls record_sos_pipeline_acked (same
//      RPC the IVR Press-1 path uses for L1-C metric continuity).
//   6. Broadcasts on `sos-live:${companyId}` (or
//      `sos-live:civilian:${userId}` for non-B2B SOS owners)
//      with event = "sms_reply" — same channel the dashboard
//      already subscribes to for `sos_triggered` events.
//
// Required Supabase secrets:
//   TWILIO_AUTH_TOKEN
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleProbe } from "../_shared/probe-handler.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS — same pattern as twilio-status for consistency. Twilio itself
// doesn't need CORS (it's a server-to-server POST), but allow
// dashboard preflight in case a future support tool POSTs here.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app,capacitor://localhost,https://localhost")
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


/**
 * Constant-time string compare. L5-SEC-5 (2026-05-12): defeats per-byte
 * timing oracle. Length check is non-secret (base64-SHA1 = 28 chars).
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validateTwilioSignature(
  req: Request,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  const sigHeader = req.headers.get("X-Twilio-Signature");
  if (!sigHeader) return false;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    console.error("[sos-sms-inbound] TWILIO_AUTH_TOKEN missing — rejecting (fail closed)");
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
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataToSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  const ok = constantTimeEquals(sigB64, sigHeader);
  // L1-D Phase 3 debug: when the signature does NOT match, log
  // the inputs (NOT the auth token) so the probe can diagnose
  // what URL/params the handler is actually hashing. Logs only on
  // mismatch — production traffic that validates is untouched.
  if (!ok) {
    // L5-SEC-6 (2026-05-12): redacted. Previously logged computed_sig
    // (deterministic HMAC over inputs) and token_len (oracle). Now we
    // log only the URL we hashed + sorted param keys + a truncated
    // prefix of the received signature for log-correlation.
    console.error("[sos-sms-inbound] SIG_MISMATCH_DEBUG", JSON.stringify({
      url_seen: url,
      params_sorted_keys: sortedKeys,
      params_values_lengths: sortedKeys.map(k => params[k]?.length ?? 0),
      received_sig_prefix: sigHeader.slice(0, 6) + "...",
    }));
  }
  return ok;
}

// ── Ack keyword detection ─────────────────────────────────────────────
// FROZEN allowlist. Adding a keyword later is a 2-line diff but must be
// reviewed because every keyword change flips a contact's reply from
// "logged" to "logged + ack pipeline_metric + dashboard banner".
//
// Each entry is a regex source string. We compile them all once at
// module load. Matching is case-insensitive AND word-boundary aware
// so a reply like "i'm ok now, on my way" matches both "OK" and
// "ON MY WAY" without false-positives on "smokey".
//
// Arabic equivalents are included because Arabic-speaking contacts in
// our primary deployment region (Iraq) will reply in Arabic. The Arabic
// regex uses Unicode codepoints to avoid surprises with right-to-left
// text rendering in source.
const ACK_KEYWORDS: Array<{ keyword: string; pattern: RegExp }> = [
  // English — order: longer / more specific first so the matcher
  // reports the highest-signal keyword when multiple overlap.
  { keyword: "ON MY WAY",     pattern: /\bon\s+my\s+way\b/i },
  { keyword: "EN ROUTE",      pattern: /\ben\s+route\b/i },
  { keyword: "911 CALLED",    pattern: /\b911\s+called\b/i },
  { keyword: "CALLED 911",    pattern: /\bcalled\s+911\b/i },
  { keyword: "AMBULANCE",     pattern: /\bambulance\b/i },
  { keyword: "POLICE",        pattern: /\bpolice\b/i },
  { keyword: "COMING",        pattern: /\bcoming\b/i },
  { keyword: "OMW",           pattern: /\bomw\b/i },
  { keyword: "911",           pattern: /\b911\b/i },
  { keyword: "OK",            pattern: /\bo+k+\b/i },         // matches OK, OKK, OKAY-ish (the \bo+k+\b is intentional)
  { keyword: "OKAY",          pattern: /\bokay\b/i },
  { keyword: "YES",           pattern: /\byes\b/i },
  { keyword: "GOT IT",        pattern: /\bgot\s+it\b/i },
  // Arabic — أحسن etc. used to avoid RTL display issues.
  // "حسناً" (ok)              → matches the stem حسن with optional tanween
  { keyword: "AR_OK",         pattern: /حسن/u },
  // "تمام" (got it / done)
  { keyword: "AR_OK_2",       pattern: /تمام/u },
  // "قادم" / "قادمون" (coming)
  { keyword: "AR_COMING",     pattern: /قادم/u },
  // "في الطريق" (on the way) — match the core word طريق
  { keyword: "AR_EN_ROUTE",   pattern: /طريق/u },
  // "شرطة" (police)
  { keyword: "AR_POLICE",     pattern: /شرط/u },
  // "إسعاف" / "اسعاف" (ambulance)
  { keyword: "AR_AMBULANCE",  pattern: /إ?اسعاف|إسعاف/u },
];

interface AckResult {
  isAck: boolean;
  keyword: string | null;
}

export function detectAck(body: string): AckResult {
  if (!body) return { isAck: false, keyword: null };
  const trimmed = body.trim();
  for (const { keyword, pattern } of ACK_KEYWORDS) {
    if (pattern.test(trimmed)) return { isAck: true, keyword };
  }
  return { isAck: false, keyword: null };
}

// ── Session resolution ────────────────────────────────────────────────
// Given an inbound `From` phone, find the most recent ACTIVE SOS this
// contact is associated with. Match against contact_snapshot[].phone
// (which was frozen at trigger time) — not against profiles, because
// the trust root for "which SOS does this reply belong to?" is the
// fanout-time snapshot.
//
// Returns null if no active session matches — the caller still logs
// the reply with NULL contact_index so the security audit covers
// EVERY inbound to our Twilio number.
interface ResolvedSession {
  emergencyId: string;
  traceId: string | null;
  companyId: string | null;
  userId: string | null;
  contactIndex: number;
  contactName: string;
}

async function resolveSessionByFromPhone(
  supabase: any,
  fromPhone: string,
): Promise<ResolvedSession | null> {
  const cleanFrom = String(fromPhone).replace(/[^+\d]/g, "");
  if (!cleanFrom) return null;

  // Query: most recent active SOS where any contact_snapshot[].phone
  // matches. R-37 (LAUNCH_AUDIT #4): extended from 1h to 6h because a
  // contact arriving ON SCENE 70+ minutes later texting "I'm here" or
  // "ambulance taking him" is a real and common pattern — the original
  // 1h window dropped those inbound updates as UNMATCHED with no
  // broadcast to the user's screen or admin dashboard.
  // 6h covers virtually all in-emergency post-arrival replies while
  // still rejecting stale 12h+ accidental replies.
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: sessions } = await supabase
    .from("sos_sessions")
    .select("id, trace_id, company_id, user_id, contact_snapshot, started_at")
    .eq("status", "active")
    .gte("started_at", sixHoursAgo)
    .order("started_at", { ascending: false })
    .limit(50);
  if (!sessions || sessions.length === 0) return null;

  for (const s of sessions) {
    const snap = Array.isArray(s.contact_snapshot) ? s.contact_snapshot : [];
    for (let i = 0; i < snap.length; i++) {
      const cp = String(snap[i]?.phone || "").replace(/[^+\d]/g, "");
      if (cp && cp === cleanFrom) {
        return {
          emergencyId: s.id,
          traceId: s.trace_id ?? null,
          companyId: s.company_id ?? null,
          userId: s.user_id ?? null,
          contactIndex: i,
          contactName: String(snap[i]?.name || ""),
        };
      }
    }
  }
  return null;
}

// ── Realtime broadcast ────────────────────────────────────────────────
// Broadcast on the SAME tenant-scoped channel that sos-alert uses for
// the `sos_triggered` event. The user's emergency screen already
// subscribes there for live updates. Event name `sms_reply` is new
// and dedicated — no client code shape changes required to add the
// listener.
async function broadcastSmsReply(
  supabase: any,
  resolved: ResolvedSession,
  payload: {
    body: string;
    fromPhone: string;
    isAck: boolean;
    ackKeyword: string | null;
    messageSid: string;
  },
): Promise<void> {
  const scopedChannel = resolved.companyId
    ? `sos-live:${resolved.companyId}`
    : `sos-live:civilian:${resolved.userId}`;
  const ch = supabase.channel(scopedChannel);
  try {
    await ch.send({
      type: "broadcast",
      event: "sms_reply",
      payload: {
        emergencyId: resolved.emergencyId,
        contactIndex: resolved.contactIndex,
        contactName: resolved.contactName,
        fromPhone: payload.fromPhone,
        body: payload.body,
        isAck: payload.isAck,
        ackKeyword: payload.ackKeyword,
        messageSid: payload.messageSid,
        ts: Date.now(),
      },
    });
    console.log(`[sos-sms-inbound] broadcast sms_reply on ${scopedChannel} emergency=${resolved.emergencyId} ack=${payload.isAck}`);
  } catch (e) {
    console.warn("[sos-sms-inbound] Realtime broadcast failed:", e);
  } finally {
    setTimeout(() => supabase.removeChannel(ch), 2000);
  }
}

// ── Main handler ──────────────────────────────────────────────────────
serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    // 2026-06-06 M3-#23 (long-tail): shared synthetic-monitoring probe.
    // Caller sends POST ?action=probe with body { probe: true, probeId }.
    const probeUrl = new URL(req.url);
    if (probeUrl.searchParams.get("action") === "probe") {
      return await handleProbe(req, {
        functionName: "sos-sms-inbound",
        cors: cors,
        // // Twilio/webhook function — no JWT auth, probe is body-shape filtered.
      });
    }

  // Empty TwiML acknowledgement — never auto-reply. Auto-reply on an
  // SOS line would create a feedback loop and confuse the contact.
  const emptyTwiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
  const xmlHeaders = { ...cors, "Content-Type": "text/xml" };

  try {
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((v, k) => { data[k] = String(v); });

    // L1-D Phase 3 fix: Supabase's gateway terminates TLS and forwards
    // plain HTTP to the function container, so req.url's protocol is
    // "http:" internally. Twilio signs the webhook URL as configured
    // (always "https:"). The canonical URL must match what Twilio
    // signed - coerce to https here. Safe because edge functions are
    // ONLY reachable externally via HTTPS; the http:// is a routing
    // artefact, not a real network protocol.
    const canonicalUrl = req.url.replace(/^http:\/\//, "https://");
    const valid = await validateTwilioSignature(req, canonicalUrl, data);
    if (!valid) {
      console.warn("[sos-sms-inbound] Twilio signature invalid - rejecting");
      // L1-D Phase 3 debug + L5-SEC-6 (2026-05-12): the PROBE-* echo
      // path is now gated behind a per-call X-Probe-Secret header that
      // must match the PROBE_SECRET env var. Pre-fix, anyone could
      // probe by setting MessageSid=PROBE-x — leaking the URL the
      // handler hashes + param keys to unauthenticated callers. The
      // legitimate sos-inbound-probe edge function already sets the
      // header in its synthetic POST.
      const debugMsgSid = String(data.MessageSid || "");
      const probeSecret = Deno.env.get("PROBE_SECRET") || "";
      const probeHeader = req.headers.get("X-Probe-Secret") || "";
      const isProbe = debugMsgSid.startsWith("PROBE-")
        && probeSecret.length >= 16
        && constantTimeEquals(probeHeader, probeSecret);
      const errBody = isProbe
        ? { error: "Invalid signature", debug_url: canonicalUrl, debug_param_keys: Object.keys(data).sort() }
        : { error: "Invalid signature" };
      return new Response(JSON.stringify(errBody), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const messageSid = String(data.MessageSid || "");
    const fromPhone  = String(data.From || "");
    const toPhone    = String(data.To   || "");
    const body       = String(data.Body || "");
    if (!messageSid || !fromPhone || !body) {
      console.warn("[sos-sms-inbound] missing required fields", { messageSid: !!messageSid, fromPhone: !!fromPhone, body: !!body });
      // Still return 200 + empty TwiML so Twilio doesn't retry with the same
      // malformed payload (would just hammer us with no improvement).
      return new Response(emptyTwiml, { headers: xmlHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase    = createClient(supabaseUrl, supabaseKey);

    // Detect ack BEFORE resolving session — even an unmatched-phone
    // reply that says "ON MY WAY" is worth flagging in the audit log.
    const ack = detectAck(body);
    const bodyNormalized = body.trim().toLowerCase().slice(0, 200);

    // Resolve the SOS this reply belongs to (or null).
    const resolved = await resolveSessionByFromPhone(supabase, fromPhone);

    // Persist to ledger (idempotent on message_sid).
    // If resolved is null, emergency_id is set to a stable "unmatched"
    // marker so the row is still queryable. The forensic audit query
    // will surface unmatched replies for human review.
    const emergencyIdForLog = resolved?.emergencyId || `UNMATCHED-${fromPhone}`;
    try {
      await supabase.rpc("record_sos_sms_reply", {
        p_emergency_id:    emergencyIdForLog,
        p_message_sid:     messageSid,
        p_from_phone:      fromPhone,
        p_to_phone:        toPhone,
        p_body:            body,
        p_body_normalized: bodyNormalized,
        p_is_ack:          ack.isAck,
        p_ack_keyword:     ack.keyword,
        p_trace_id:        resolved?.traceId ?? null,
        p_company_id:      resolved?.companyId ?? null,
        p_user_id:         resolved?.userId ?? null,
        p_contact_index:   resolved?.contactIndex ?? null,
        p_contact_name:    resolved?.contactName ?? null,
      });
    } catch (e) {
      console.error("[sos-sms-inbound] record_sos_sms_reply failed:", e);
      // Continue — telemetry must not block the webhook reply.
    }

    // Mirror to audit_log for the unified compliance timeline. Same
    // best-effort pattern as twilio-status. Severity = "info" for
    // non-ack replies, "warning" for the (rare) case where the SOS
    // contact says something resembling a refusal — we don't classify
    // refusals yet (Phase 2 of L2-F if needed), but the action label
    // makes the row distinguishable.
    try {
      await supabase.rpc("log_sos_audit", {
        p_action:       ack.isAck ? "sms_reply_ack" : "sms_reply",
        p_actor:        "twilio_inbound",
        p_actor_level:  "system",
        p_operation:    "telephony",
        p_target:       resolved?.emergencyId ?? null,
        p_target_name:  resolved?.contactName ?? fromPhone,
        p_metadata: {
          message_sid:    messageSid,
          from_phone:     fromPhone,
          to_phone:       toPhone,
          contact_index:  resolved?.contactIndex ?? null,
          is_ack:         ack.isAck,
          ack_keyword:    ack.keyword,
          body_preview:   bodyNormalized.slice(0, 80),
          unmatched:      resolved === null,
        },
      });
    } catch (e) {
      console.warn("[sos-sms-inbound] audit_log mirror failed:", e);
    }

    // L1-C pipeline_acked: a positive ack from a known contact
    // satisfies the same SLA contract as IVR Press-1. Record once
    // (RPC is idempotent on first-ack-wins via responder_acked_at).
    if (ack.isAck && resolved?.traceId) {
      try {
        await supabase.rpc("record_sos_pipeline_acked", {
          p_trace_id:         resolved.traceId,
          p_contacts_reached: 1,
        });
      } catch (e) {
        console.warn("[sos-sms-inbound] pipeline_acked failed (non-fatal):", e);
      }
    }

    // Broadcast to the user's emergency screen.
    if (resolved) {
      await broadcastSmsReply(supabase, resolved, {
        body,
        fromPhone,
        isAck: ack.isAck,
        ackKeyword: ack.keyword,
        messageSid,
      });
    }

    return new Response(emptyTwiml, { headers: xmlHeaders });
  } catch (err) {
    console.error("[sos-sms-inbound] unhandled error:", err);
    // Return 200 + empty TwiML even on error — Twilio retries on 5xx,
    // and we don't want a transient failure to cause webhook storms.
    // The error is logged for debugging.
    return new Response(emptyTwiml, { headers: xmlHeaders });
  }
});
