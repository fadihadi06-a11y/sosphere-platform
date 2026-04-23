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
import {
  checkRateLimit,
  markSosPriority,
  clearSosPriority,
  getRateLimitHeaders,
} from "../_shared/rate-limiter.ts";
import { clientIp } from "../_shared/api-guard.ts";

const TWILIO_SID    = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_FROM   = Deno.env.get("TWILIO_FROM_NUMBER")!;
const SUPA_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE_URL      = Deno.env.get("SOSPHERE_BASE_URL") || "https://sosphere.co";

// Default country code applied when a contact phone is in national format
// (e.g. Iraqi mobile `07xx…` or a bare local number). Twilio rejects
// anything that isn't strict E.164, so if we ship raw national-format
// strings every SMS / call silently fails with 21211. The secret is
// optional; omit it and we refuse to normalize — the call result then
// carries an explicit `invalid_number` error so clients can surface it
// instead of getting a misleading 200 from the fanout.
//
// Format: ISO-3166 alpha-2 country code (e.g. "IQ" for Iraq, "SA" for
// Saudi Arabia). We keep the mapping small — users outside these are
// expected to store contacts in full E.164 form.
const DEFAULT_COUNTRY = (Deno.env.get("SOSPHERE_DEFAULT_COUNTRY") || "IQ").toUpperCase();

// ISO-3166 alpha-2 → international dialling prefix (without the `+`).
// Additive: new markets land by appending a row.
const COUNTRY_DIAL: Record<string, string> = {
  IQ: "964", // Iraq
  SA: "966", // Saudi Arabia
  AE: "971", // UAE
  KW: "965", // Kuwait
  QA: "974", // Qatar
  BH: "973", // Bahrain
  OM: "968", // Oman
  JO: "962", // Jordan
  LB: "961", // Lebanon
  EG: "20",  // Egypt
  TR: "90",  // Türkiye
  GB: "44",  // United Kingdom
  US: "1",   // USA
};

/**
 * Normalize a phone number to E.164 (the format Twilio requires).
 *
 * Rules, applied in order:
 *   1. `+XXXXXXXXXX`  → passes through unchanged (already E.164).
 *   2. `00XXXXXXXXX`  → `+XXXXXXXXX` (common European / GCC dialling).
 *   3. `0XXXXXXXXX`   → strip the trunk zero, prefix with the default
 *                       country's dial code (e.g. IQ `07728…` → `+9647728…`).
 *   4. bare digits    → prefix with the default country's dial code.
 *   5. anything else  → `null` (unrecoverable; caller emits an error).
 *
 * Returns `null` when:
 *   • the cleaned string is empty after stripping non-digit/non-plus chars
 *   • the default country is unknown to `COUNTRY_DIAL` and the input is
 *     not already in international form
 *   • the resulting number is shorter than 8 digits (obviously invalid —
 *     prevents dialling emergency short-codes accidentally)
 */
function normalizeE164(phone: string): string | null {
  if (!phone) return null;

  // Strip whitespace, dashes, parens — keep `+` and digits only.
  const cleaned = phone.replace(/[^+\d]/g, "");
  if (!cleaned) return null;

  let normalized: string;

  if (cleaned.startsWith("+")) {
    normalized = cleaned;
  } else if (cleaned.startsWith("00")) {
    normalized = "+" + cleaned.slice(2);
  } else {
    const dial = COUNTRY_DIAL[DEFAULT_COUNTRY];
    if (!dial) return null;
    normalized = cleaned.startsWith("0")
      ? "+" + dial + cleaned.slice(1)
      : "+" + dial + cleaned;
  }

  // E.164 allows 8-15 digits after the `+`. Anything below 8 is either a
  // short-code (911, 997) or a typo — both wrong for contact dispatch.
  const digits = normalized.slice(1);
  if (digits.length < 8 || digits.length > 15 || !/^\d+$/.test(digits)) {
    return null;
  }

  return normalized;
}

// B-M1: origin allowlist via ALLOWED_ORIGINS env
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}
function buildCors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Vary": "Origin",
    // P2-#8: allow Idempotency-Key through CORS preflight so browsers
    // don't strip it. Header is case-insensitive on the wire but listed
    // lowercase here per RFC 7230 recommendations for preflight matching.
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ─────────────────────────────────────────────────────────────
// B-C4/B-H1: request-scoped idempotency cache helpers.
// Checks idempotency_cache table (see 20260417_idempotency_cache.sql).
// If a prior response exists for the same (function_name, key),
// returns it so we never double-execute side effects. On miss, caller
// executes the action, then calls `storeIdempotency` with the result.
// ─────────────────────────────────────────────────────────────
async function lookupIdempotency(
  supabase: any,
  functionName: string,
  key: string,
): Promise<{ status: number; body: unknown } | null> {
  if (!key) return null;
  try {
    const { data } = await supabase
      .from("idempotency_cache")
      .select("response_body, response_status, expires_at")
      .eq("function_name", functionName)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (!data) return null;
    // Expiry-aware — expired rows are ignored (pg_cron / app can prune).
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
    return { status: data.response_status ?? 200, body: data.response_body };
  } catch (err) {
    console.warn("[sos-alert] idempotency lookup failed:", err);
    return null;
  }
}

async function storeIdempotency(
  supabase: any,
  functionName: string,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (!key) return;
  try {
    await supabase.from("idempotency_cache").upsert(
      {
        function_name: functionName,
        idempotency_key: key,
        response_body: body,
        response_status: status,
      },
      { onConflict: "function_name,idempotency_key" },
    );
  } catch (err) {
    console.warn("[sos-alert] idempotency store failed:", err);
  }
}

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
  // B-M1: origin allowlist via ALLOWED_ORIGINS env
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "trigger";
  const supabase = createClient(SUPA_URL, SUPA_KEY);

  // ─── Rate-limit key resolution ─────────────────────────────
  // Prefer userId from JWT for authenticated actions; fall back to
  // client IP so unauthenticated hot paths (prewarm via sendBeacon)
  // are still bucketed. Every action on this endpoint is treated as
  // SOS-priority — the limiter records the hit for observability but
  // NEVER blocks, because a blocked SOS trigger is a life-safety bug.
  const ip = clientIp(req);

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

      // SOS priority lane: record + observe, never block. The limiter
      // returns allowed:true unconditionally for isSosRequest=true —
      // we still want the headers so operators can see burst load.
      const rl = checkRateLimit(pw.userId || `ip:${ip}`, "sos", true);
      markSosPriority(pw.userId);

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
        headers: { ...cors, ...getRateLimitHeaders(rl), "Content-Type": "application/json" },
      });
    }

    // ═════════════════════════════════════════════════════════
    // ACTION: HEARTBEAT — device ping (every 30s)
    // ═════════════════════════════════════════════════════════
    if (action === "heartbeat") {
      const hb = await req.json();

      // SOS priority lane — heartbeats during an active emergency
      // are life-critical and never blocked. Keep the user marked so
      // concurrent audio-upload replays inherit the priority.
      const hbRl = checkRateLimit(hb.userId || `ip:${ip}`, "sos", true);
      if (hb.userId) markSosPriority(hb.userId);

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
        headers: { ...cors, ...getRateLimitHeaders(hbRl), "Content-Type": "application/json" },
      });
    }

    // ═════════════════════════════════════════════════════════
    // ACTION: ESCALATE — watchdog stage 1 (5s) or stage 2 (15s)
    // Stage 1: Fire SMS burst to all contacts (redundant with trigger, but safe)
    // Stage 2: Force bridge call even if local dialer is working
    // ═════════════════════════════════════════════════════════
    if (action === "escalate") {
      const { emergencyId, stage, reason, forceBridge } = await req.json();
      // B-C4/B-H1: persist Idempotency-Key in idempotency_cache table.
      // If the client does not supply one we fall back to the legacy
      // composite key (warning: this is a best-effort fallback only;
      // clients SHOULD send Idempotency-Key for at-most-once semantics).
      const headerIdem = req.headers.get("Idempotency-Key");
      if (!headerIdem) {
        console.warn(`[sos-alert] ESCALATE missing Idempotency-Key — falling back to composite key (eid=${emergencyId}, stage=${stage})`);
      }
      const idemKey = headerIdem || `escalate:${emergencyId}:${stage}`;

      // SOS priority — escalation is always allowed. Key by
      // emergencyId since escalate may be triggered by a watchdog
      // that does not carry a userId.
      const escRl = checkRateLimit(`eid:${emergencyId}`, "sos", true);

      // B-C4/B-H1: cache hit short-circuit — serve previous response.
      const cached = await lookupIdempotency(supabase, "sos-alert:escalate", idemKey);
      if (cached) {
        console.log(`[sos-alert] ESCALATE idempotency cache hit key=${idemKey}`);
        return new Response(JSON.stringify(cached.body), {
          status: cached.status,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

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

      // P2-#8: A client-side timeout on the previous escalate call can
      // cause the watchdog to retry with the same stage. If we've already
      // recorded this stage (or a later one), the escalation has
      // happened — returning cached success avoids a duplicate SMS burst
      // and prevents two forced bridge calls racing for the conference.
      if (typeof session.escalation_stage === "number" && session.escalation_stage >= stage) {
        const body = { ok: true, cached: true, stage: session.escalation_stage };
        console.log(
          `[sos-alert] ESCALATE idempotent hit — stage ${stage} already ran (current=${session.escalation_stage}, key=${idemKey})`
        );
        // B-C4/B-H1: persist so future retries hit the cache before DB work.
        await storeIdempotency(supabase, "sos-alert:escalate", idemKey, 200, body);
        return new Response(
          JSON.stringify(body),
          { headers: { ...cors, "Content-Type": "application/json" } }
        );
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
      const body = { ok: true, stage, forceBridge: !!forceBridge };
      // B-C4/B-H1: store response for subsequent retries with same key.
      await storeIdempotency(supabase, "sos-alert:escalate", idemKey, 200, body);
      return new Response(JSON.stringify(body), {
        headers: { ...cors, ...getRateLimitHeaders(escRl), "Content-Type": "application/json" },
      });
    }

    // ═════════════════════════════════════════════════════════
    // ACTION: END — client ended SOS
    // ═════════════════════════════════════════════════════════
    if (action === "end") {
      const { emergencyId, reason, recordingSec, photos, comment } = await req.json();
      const idemKey = req.headers.get("Idempotency-Key") || `end:${emergencyId}`;

      // SOS priority — end is part of the emergency flow and must
      // never be blocked. It's also our signal to CLEAR the user's
      // SOS priority boost so non-emergency traffic goes back to
      // normal limits. We fetch user_id from the row (payload may
      // omit it) and clear priority after the status update.
      const endRl = checkRateLimit(`eid:${emergencyId}`, "sos", true);

      // P2-#8: If this session is already ended, short-circuit. A user
      // mashing "End SOS", a network retry, or the offline replay worker
      // all land here; we must NOT re-broadcast sos_ended (which would
      // dismiss responders twice and muddy audit logs).
      const { data: current } = await supabase
        .from("sos_sessions")
        .select("status, ended_at, user_id")
        .eq("id", emergencyId)
        .maybeSingle();

      if (current?.status === "ended" && current?.ended_at) {
        console.log(`[sos-alert] END idempotent hit — ${emergencyId} already ended (key=${idemKey})`);
        // Still safe to clear priority — idempotent.
        if (current.user_id) clearSosPriority(current.user_id);
        return new Response(JSON.stringify({ ok: true, cached: true }), {
          headers: { ...cors, ...getRateLimitHeaders(endRl), "Content-Type": "application/json" },
        });
      }

      await supabase.from("sos_sessions").update({
        status: "ended",
        ended_at: new Date().toISOString(),
        end_reason: reason || "user_ended",
        recording_seconds: recordingSec,
        photo_count: typeof photos === "number" ? photos : (photos?.length ?? 0),
        comment: comment || null,
      }).eq("id", emergencyId);

      // Emergency ended — drop the user's SOS priority boost so any
      // non-emergency requests that follow go through normal limits.
      if (current?.user_id) clearSosPriority(current.user_id);

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
        headers: { ...cors, ...getRateLimitHeaders(endRl), "Content-Type": "application/json" },
      });
    }

    // ═════════════════════════════════════════════════════════
    // ACTION: TRIGGER — main SOS activation (default)
    // ═════════════════════════════════════════════════════════

    // B-C4/B-H1: request-scoped idempotency via Idempotency-Key header.
    // If the key has a stored response, return it verbatim — prevents
    // duplicate SMS bursts when a network retry arrives mid-fanout.
    // Missing key: we still have the atomic DB claim below as a
    // secondary safeguard, but we log a warning because at-most-once
    // semantics degrade without the header.
    const triggerIdemKey = req.headers.get("Idempotency-Key");
    if (!triggerIdemKey) {
      console.warn("[sos-alert] TRIGGER missing Idempotency-Key — falling back to atomic DB claim only");
    }
    if (triggerIdemKey) {
      const cachedTrigger = await lookupIdempotency(supabase, "sos-alert:trigger", triggerIdemKey);
      if (cachedTrigger) {
        console.log(`[sos-alert] TRIGGER idempotency cache hit key=${triggerIdemKey}`);
        return new Response(JSON.stringify(cachedTrigger.body), {
          status: cachedTrigger.status,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    // ── Auth: extract userId from JWT (SECURITY-CRITICAL) ──
    const auth = await authenticate(req, supabase);
    if (!auth.userId) {
      console.warn("[sos-alert] Unauthorized trigger attempt:", auth.error);
      return new Response(JSON.stringify({ error: "Unauthorized", detail: auth.error }), {
        status: 401, headers: cors,
      });
    }
    const authUserId = auth.userId;

    // ── SOS priority lane: record + mark, NEVER block. ──
    // The rate limiter treats isSosRequest=true as unconditional
    // allow. We still want the headers (for observability) and the
    // priority mark (so follow-up heartbeat/escalate/audio-upload
    // requests inherit the high-priority multiplier).
    const triggerRl = checkRateLimit(authUserId, "sos", true);
    markSosPriority(authUserId);

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

    // B-C4/B-H1: atomic claim of the "server trigger" slot. We used to
    // read-then-write, which let two concurrent trigger requests both
    // observe `server_triggered_at = NULL` and each run the full fanout
    // — duplicate SMS bursts and double conference calls.
    //
    // New pattern:
    //   1. UPSERT the row with ON CONFLICT DO NOTHING (insert only).
    //      This creates a fresh session when the client triggered
    //      without prewarm. If a row already exists (prewarm or retry)
    //      the INSERT is skipped.
    //   2. UPDATE ... WHERE server_triggered_at IS NULL RETURNING *
    //      atomically claims the trigger. Postgres guarantees only one
    //      concurrent caller wins; the loser sees 0 rows returned and
    //      must fall back to the cached result row.
    const nowIso = new Date().toISOString();

    // Step 1: insert-if-missing. We deliberately do NOT set
    // server_triggered_at here — the conditional UPDATE below is what
    // claims triggering. Using ignoreDuplicates:true makes this safe
    // when prewarm already created the row.
    await supabase.from("sos_sessions").upsert({
      id: emergencyId,
      user_id: authUserId,
      user_name: userName,
      user_phone: userPhone,
      tier,
      status: "active",
      started_at: nowIso,
      last_heartbeat: nowIso,
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
    }, { onConflict: "id", ignoreDuplicates: true });

    // Step 2: atomic conditional UPDATE — only one caller wins the claim.
    // `select()` on an UPDATE returns the updated rows, filtered by the
    // WHERE clause. If zero rows come back, another invocation already
    // ran the fanout and we must return its cached result.
    const { data: claimed } = await supabase
      .from("sos_sessions")
      .update({
        user_id: authUserId,
        user_name: userName,
        user_phone: userPhone,
        tier,
        status: "active",
        last_heartbeat: nowIso,
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
        ai_script: aiScript,
        server_triggered_at: nowIso,
      })
      .eq("id", emergencyId)
      .is("server_triggered_at", null)
      .select("id, tier, server_triggered_at");

    // B-C4/B-H1: zero rows claimed → another trigger beat us to it.
    // Fetch the cached result row and return it. This replaces the
    // old read-then-write race.
    if (!claimed || claimed.length === 0) {
      const { data: existing } = await supabase
        .from("sos_sessions")
        .select("id, status, server_triggered_at, server_results, tier")
        .eq("id", emergencyId)
        .maybeSingle();
      console.log(`[sos-alert] Idempotent hit (atomic) — returning cached results for ${emergencyId}`);
      return new Response(JSON.stringify({
        success: true,
        cached: true,
        emergencyId,
        tier: existing?.tier,
        results: existing?.server_results || [],
        trackUrl,
        dashUrl,
      }), { headers: { ...cors, ...getRateLimitHeaders(triggerRl), "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════════════════
    // PARALLEL FANOUT — all contacts simultaneously (5-8× faster)
    // SMS fires non-blocking first (always delivered)
    // Call awaits (may take 15-30s to connect)
    // ══════════════════════════════════════════════════════════
    const fanoutResults = await Promise.all(contacts.map(async (c, idx) => {
      // E.164 normalization is STRICT: Twilio rejects anything else with
      // 21211 ("Invalid 'To' phone number"). A national-format string
      // like `07728569514` would silently burn the whole SOS — so we
      // reject early with a typed error the client can surface. Shape
      // matches the success path below so UI can iterate uniformly.
      const cleanPhone = normalizeE164(c.phone);
      if (!cleanPhone) {
        console.warn(`[sos-alert] invalid phone for contact '${c.name}': raw='${c.phone}' default_country=${DEFAULT_COUNTRY}`);
        return {
          contactName: c.name,
          phone: c.phone, // echo the raw input so UI can highlight it
          callSid: null,
          smsSid: null,
          method: "invalid_number",
          error: "invalid_number",
          message: `Contact phone '${c.phone}' is not a valid E.164 number. Save it in international form (e.g. +964…) or set SOSPHERE_DEFAULT_COUNTRY.`,
        };
      }
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
        // FIX 2026-04-23: previously pointed to `twilio-twiml` which does
        // NOT exist in this codebase — Basic tier calls always failed
        // silently. The real TwiML endpoint is `sos-bridge-twiml`, which
        // handles both bridge (Elite) and announce-only flow via the
        // `mode=announce` query param. This ensures Basic-tier users
        // actually get their outbound call with emergency details.
        const twimlUrl = `${SUPA_URL}/functions/v1/sos-bridge-twiml?mode=announce&emergencyId=${encodeURIComponent(emergencyId)}&caller=${encodeURIComponent(userName)}&contactName=${encodeURIComponent(c.name)}&trackUrl=${encodeURIComponent(trackUrl)}`;
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
    // B-C4/B-H1: server_triggered_at was set atomically in the claim
    // step above. Here we only persist the fanout results.
    await supabase.from("sos_sessions").update({
      server_results: fanoutResults,
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

    const triggerBody = {
      success: true,
      emergencyId,
      tier,
      results: fanoutResults,
      trackUrl,
      dashUrl,
    };
    // B-C4/B-H1: persist response for Idempotency-Key retries.
    if (triggerIdemKey) {
      await storeIdempotency(supabase, "sos-alert:trigger", triggerIdemKey, 200, triggerBody);
    }
    return new Response(JSON.stringify(triggerBody), {
      status: 200,
      headers: { ...cors, ...getRateLimitHeaders(triggerRl), "Content-Type": "application/json" },
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
