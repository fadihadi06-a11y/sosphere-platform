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
  /**
   * FIX 2026-04-24 (Point 5): user-controlled Emergency Packet privacy
   * toggles. The mobile client writes these to localStorage from the
   * Emergency Packet screen; sos-emergency.tsx reads them at trigger
   * time and forwards them here. We honor them when building the SMS
   * content AND persist them on sos_queue.metadata.packet_modules so
   * the company dashboard (for employees) and the PDF report can render
   * EXACTLY what pieces of the user's profile were shared. Defaults:
   * every field true (open-by-default for older clients + first-run
   * users). location is a literal true because omitting GPS from an
   * SOS is incoherent — it's the whole point.
   */
  packetModules?: {
    location: true;
    medical: boolean;
    contacts: boolean;
    device: boolean;
    recording: boolean;
    incident: boolean;
  };
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
    /** Max duration of the whole call in seconds. Hard cap so a stuck
     *  conference cannot bleed Twilio billing indefinitely. Twilio
     *  terminates the call when this elapses. Default 180s = 3min
     *  (enough for a real emergency handoff, short enough to bound
     *  cost at $0.045/call worst case). */
    timeLimitSec?: number;
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
      // FIX 2026-04-24 Fix #6: hard cap on call duration to bound cost.
      TimeLimit: String(opts.timeLimitSec ?? 180),
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

// ──────────────────────────────────────────────────────────────────────
// G-3 / G-4 (B-20, 2026-04-25): authenticate prewarm too — but accept the
// JWT inside the BODY because sendBeacon (used by survival-beacon paths
// during page unload / Capacitor app death) cannot set HTTP headers.
// The body-token path is functionally identical to the header path: we
// run supabase.auth.getUser(token) and use its result. The header path
// remains the primary; body-token is only consulted as a fallback.
// ──────────────────────────────────────────────────────────────────────
async function authenticateBodyOrHeader(
  req: Request,
  supabase: any,
  bodyToken: string | undefined,
): Promise<{ userId: string | null; error?: string }> {
  // 1. Header path (regular fetch / supabase.functions.invoke)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const jwt = authHeader.replace("Bearer ", "");
    try {
      const { data: { user }, error } = await supabase.auth.getUser(jwt);
      if (!error && user) return { userId: user.id };
    } catch { /* fall through to body token */ }
  }
  // 2. Body-token path (sendBeacon survival beacon)
  if (typeof bodyToken === "string" && bodyToken.length > 20) {
    try {
      const { data: { user }, error } = await supabase.auth.getUser(bodyToken);
      if (!error && user) return { userId: user.id };
    } catch { /* fall through */ }
  }
  return { userId: null, error: "No valid token in header or body" };
}

// ── Tier Resolver: DB-based, subscription-status aware ───────
// W3-14 (B-20, 2026-04-26): tier resolution is now company-aware.
//
// Pre-fix: resolveTier only looked at `subscriptions.user_id = JWT subject`.
// In a B2B deployment, the OWNER pays for the company plan; employees
// don't have their own subscription row. So every paying B2B employee
// resolved to "free" — no TTS, no conference bridge, no recording.
// Direct violation of paid contract.
//
// Post-fix: resolution order
//   1. Personal subscription (civilian path) — existing
//   2. If none / free / inactive: profiles.active_company_id
//   3. companies.owner_user_id
//   4. Owner's subscription → mapped to civilian tier
//
// Mapping company tiers → civilian tiers:
//   starter / growth / business / enterprise → all unlock "elite" features
//   (B2B always gets the strongest fanout; HR/insurance contracts demand it).
//
// FAIL-SECURE: any DB error keeps the previous behavior. We never silently
// upgrade — only when the chain reaches a real active company subscription.

const ACTIVE_STATUSES = ["active", "trialing"];
const COMPANY_TIERS = new Set(["starter", "growth", "business", "enterprise"]);

function mapTierString(raw: string): "free" | "basic" | "elite" {
  const t = (raw || "").toLowerCase();
  if (t === "elite" || t === "premium") return "elite";
  if (t === "basic" || t === "standard") return "basic";
  if (COMPANY_TIERS.has(t)) return "elite";  // B2B → strongest fanout
  return "free";
}

function isStatusActive(status: string | null | undefined, periodEnd: string | null | undefined): boolean {
  if (!status || !ACTIVE_STATUSES.includes(status)) return false;
  if (periodEnd) {
    const expiresAt = new Date(periodEnd).getTime();
    if (expiresAt < Date.now()) return false;
  }
  return true;
}

async function resolveTier(userId: string, supabase: any): Promise<"free" | "basic" | "elite"> {
  // Step 1: personal subscription
  try {
    const { data } = await supabase
      .from("subscriptions")
      .select("tier, status, current_period_end")
      .eq("user_id", userId)
      .maybeSingle();

    if (data && isStatusActive(data.status, data.current_period_end)) {
      const personal = mapTierString(data.tier || "");
      if (personal !== "free") return personal;
    }
  } catch (err) {
    console.warn("[sos-alert] personal tier lookup failed:", err);
    // continue to company path
  }

  // Step 2: resolve user's active company
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("active_company_id")
      .eq("id", userId)
      .maybeSingle();
    const companyId = profile?.active_company_id;
    if (!companyId) return "free";

    // Step 3: company owner
    const { data: company } = await supabase
      .from("companies")
      .select("owner_user_id")
      .eq("id", companyId)
      .maybeSingle();
    const ownerId = company?.owner_user_id;
    if (!ownerId) return "free";

    // Step 4: owner's subscription
    const { data: ownerSub } = await supabase
      .from("subscriptions")
      .select("tier, status, current_period_end")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (ownerSub && isStatusActive(ownerSub.status, ownerSub.current_period_end)) {
      const tier = mapTierString(ownerSub.tier || "");
      if (tier !== "free") {
        console.log(`[sos-alert] tier resolved via company chain: user=${userId} company=${companyId} owner=${ownerId} tier=${tier}`);
        return tier;
      }
    }
    return "free";
  } catch (err) {
    console.warn("[sos-alert] company-chain tier lookup failed:", err);
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

      // ─────────────────────────────────────────────────────────────
      // G-4 (B-20, 2026-04-25): authenticate the prewarm. Pre-fix: any
      // anon caller could plant a `sos_sessions` row with an arbitrary
      // user_id and tier="elite". The JWT comes from the request header
      // OR (for sendBeacon, which can't set headers) from `pw.accessToken`
      // in the body. The body-token path is verified server-side by
      // calling auth.getUser(token) — we do NOT trust the userId field
      // alone. Fail-secure: reject if no valid token can be resolved.
      // We also force tier="free" — the real tier is resolved from the
      // subscriptions table during the `trigger` call.
      // ─────────────────────────────────────────────────────────────
      const pwAuth = await authenticateBodyOrHeader(req, supabase, pw.accessToken);
      if (!pwAuth.userId) {
        console.warn(`[sos-alert] PREWARM rejected — no valid token (id=${pw.emergencyId})`);
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
      }
      if (pwAuth.userId !== pw.userId) {
        console.warn(`[sos-alert] PREWARM userId mismatch — token=${pwAuth.userId} body=${pw.userId}`);
        return new Response(JSON.stringify({ error: "userId mismatch" }), { status: 403, headers: cors });
      }

      // W3-30 (B-20, 2026-04-26): emergencyId ownership check.
      // Pre-fix: upsert with `ignoreDuplicates: false` would OVERWRITE an
      // existing sos_sessions row owned by another user — an attacker
      // could plant a prewarm with the victim's emergencyId, hijacking
      // the victim's active session (status flipped back to "prewarm",
      // started_at reset, etc.).
      // Post-fix: if a session already exists for this id and is owned
      // by another user, reject 409. If it's owned by the same user,
      // upsert is safe (idempotent retry by the legitimate user).
      const { data: existing } = await supabase
        .from("sos_sessions").select("user_id").eq("id", pw.emergencyId).maybeSingle();
      if (existing && existing.user_id && existing.user_id !== pwAuth.userId) {
        console.warn(`[sos-alert] PREWARM rejected — emergencyId already owned by ${existing.user_id}, caller=${pwAuth.userId}`);
        return new Response(JSON.stringify({ error: "emergencyId conflict" }), { status: 409, headers: cors });
      }

      // SOS priority lane: record + observe, never block.
      const rl = checkRateLimit(pwAuth.userId, "sos", true);
      markSosPriority(pwAuth.userId);

      // Idempotent upsert. Tier is hard-coded "free" here — the real tier
      // is resolved server-side from `subscriptions` during `trigger`.
      await supabase.from("sos_sessions").upsert({
        id: pw.emergencyId,
        user_id: pwAuth.userId,             // ← from token, not body
        user_name: pw.userName || "Unknown",
        status: "prewarm",
        started_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
        lat: pw.location?.lat,
        lng: pw.location?.lng,
        last_lat: pw.location?.lat,
        last_lng: pw.location?.lng,
        accuracy: pw.location?.accuracy,
        tier: "free",                       // ← never trust client tier
      }, { onConflict: "id", ignoreDuplicates: false });

      console.log(`[sos-alert] PREWARM received: ${pw.emergencyId} user=${pwAuth.userId}`);
      return new Response(JSON.stringify({ ok: true, prewarmed: true }), {
        headers: { ...cors, ...getRateLimitHeaders(rl), "Content-Type": "application/json" },
      });
    }

    // ═════════════════════════════════════════════════════════
    // ACTION: HEARTBEAT — device ping (every 30s)
    // ═════════════════════════════════════════════════════════
    if (action === "heartbeat") {
      const hb = await req.json();

      // ─────────────────────────────────────────────────────────────
      // G-3 (B-20, 2026-04-25): authenticate + verify session ownership
      // before any DB write. Pre-fix: any anon caller could spoof a
      // victim's GPS, kill battery readings, or inflate elapsed_sec on
      // any active emergency just by knowing/guessing the emergencyId.
      // We require a valid Bearer JWT, then verify the target session's
      // user_id matches the JWT's user.id. Mismatch → 403.
      // ─────────────────────────────────────────────────────────────
      const hbAuth = await authenticate(req, supabase);
      if (!hbAuth.userId) {
        return new Response(JSON.stringify({ error: "Unauthorized", detail: hbAuth.error }), {
          status: 401, headers: cors,
        });
      }
      // Lookup the session and verify ownership.
      const { data: hbSession } = await supabase
        .from("sos_sessions")
        .select("user_id")
        .eq("id", hb.emergencyId)
        .maybeSingle();
      if (!hbSession) {
        return new Response(JSON.stringify({ error: "Session not found" }), { status: 404, headers: cors });
      }
      if (hbSession.user_id !== hbAuth.userId) {
        console.warn(`[sos-alert] HEARTBEAT ownership mismatch eid=${hb.emergencyId} jwt=${hbAuth.userId} session=${hbSession.user_id}`);
        return new Response(JSON.stringify({ error: "Forbidden: not your session" }), { status: 403, headers: cors });
      }

      // SOS priority lane — heartbeats during an active emergency
      // are life-critical and never blocked.
      const hbRl = checkRateLimit(hbAuth.userId, "sos", true);
      markSosPriority(hbAuth.userId);

      // W3-31 (B-20, 2026-04-26): validate GPS + battery + elapsed.
      // Pre-fix accepted attacker-chosen lat=999, lng=-999, battery=42,
      // elapsed=999999 — corrupts the forensic timeline of a real
      // emergency. Now: clamp to physical ranges, drop invalid fields.
      const hbLat = (typeof hb.location?.lat === "number" && Number.isFinite(hb.location.lat)
        && hb.location.lat >= -90 && hb.location.lat <= 90) ? hb.location.lat : null;
      const hbLng = (typeof hb.location?.lng === "number" && Number.isFinite(hb.location.lng)
        && hb.location.lng >= -180 && hb.location.lng <= 180) ? hb.location.lng : null;
      // batteryLevel is 0..1 by Capacitor convention; allow 0..100 too (older clients).
      const rawBat = hb.batteryLevel;
      const hbBat = (typeof rawBat === "number" && Number.isFinite(rawBat) && rawBat >= 0 && rawBat <= 100)
        ? (rawBat > 1 ? rawBat / 100 : rawBat)
        : null;
      // elapsed_sec: must be a non-negative finite number under 86400 (1 day).
      const hbElapsed = (typeof hb.elapsedSec === "number" && Number.isFinite(hb.elapsedSec)
        && hb.elapsedSec >= 0 && hb.elapsedSec <= 86400) ? Math.floor(hb.elapsedSec) : null;

      if (hb.location && (hbLat === null || hbLng === null)) {
        console.warn(`[sos-alert] heartbeat: invalid GPS rejected eid=${hb.emergencyId} lat=${hb.location?.lat} lng=${hb.location?.lng}`);
      }

      // Build update object — only include fields that passed validation
      // so we don't overwrite valid earlier values with NULLs from junk.
      const hbUpdate: Record<string, any> = {
        last_heartbeat: new Date().toISOString(),
      };
      if (hbLat !== null) hbUpdate.last_lat = hbLat;
      if (hbLng !== null) hbUpdate.last_lng = hbLng;
      if (hbBat !== null) hbUpdate.battery_level = hbBat;
      if (hbElapsed !== null) hbUpdate.elapsed_sec = hbElapsed;

      await supabase.from("sos_sessions").update(hbUpdate).eq("id", hb.emergencyId);

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

      // ─────────────────────────────────────────────────────────────
      // G-3 (B-20, 2026-04-25): authenticate + verify session ownership.
      // Pre-fix: anyone could fast-escalate any emergency by knowing
      // the emergencyId. Watchdog escalations from the user's own
      // device carry the user's JWT; admin-initiated escalations from
      // the dashboard carry the admin's JWT (and we accept admin/owner
      // of the emergency's company as the authorized caller).
      // ─────────────────────────────────────────────────────────────
      const escAuth = await authenticate(req, supabase);
      if (!escAuth.userId) {
        return new Response(JSON.stringify({ error: "Unauthorized", detail: escAuth.error }), {
          status: 401, headers: cors,
        });
      }
      const { data: escSession } = await supabase
        .from("sos_sessions")
        .select("user_id, company_id")
        .eq("id", emergencyId)
        .maybeSingle();
      if (!escSession) {
        return new Response(JSON.stringify({ error: "Session not found" }), { status: 404, headers: cors });
      }
      // Allowed callers: the SOS owner OR a company member if the session
      // is company-scoped (admin dashboard escalation path).
      let escAllowed = (escSession.user_id === escAuth.userId);
      if (!escAllowed && escSession.company_id) {
        const { data: memberCheck } = await supabase
          .from("company_memberships")
          .select("role")
          .eq("company_id", escSession.company_id)
          .eq("user_id", escAuth.userId)
          .eq("active", true)
          .maybeSingle();
        if (memberCheck && ["admin","owner"].includes(memberCheck.role)) {
          escAllowed = true;
        }
      }
      if (!escAllowed) {
        console.warn(`[sos-alert] ESCALATE ownership mismatch eid=${emergencyId} jwt=${escAuth.userId} session_user=${escSession.user_id}`);
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: cors });
      }

      // B-C4/B-H1: persist Idempotency-Key in idempotency_cache table.
      const headerIdem = req.headers.get("Idempotency-Key");
      if (!headerIdem) {
        console.warn(`[sos-alert] ESCALATE missing Idempotency-Key — falling back to composite key (eid=${emergencyId}, stage=${stage})`);
      }
      const idemKey = headerIdem || `escalate:${emergencyId}:${stage}`;

      // SOS priority — escalation is always allowed.
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

      // ─────────────────────────────────────────────────────────────
      // G-3 (B-20, 2026-04-25): require JWT and verify session owner-
      // ship before ending. Pre-fix: any anon caller could end any
      // active SOS just by knowing the emergencyId (which is shared
      // in SMS sent to all contacts). Responders dismissed; user left
      // unprotected. Now: same pattern as heartbeat / escalate.
      // ─────────────────────────────────────────────────────────────
      const endAuth = await authenticate(req, supabase);
      if (!endAuth.userId) {
        return new Response(JSON.stringify({ error: "Unauthorized", detail: endAuth.error }), {
          status: 401, headers: cors,
        });
      }

      // SOS priority — end is part of the emergency flow and must
      // never be blocked. It's also our signal to CLEAR the user's
      // SOS priority boost so non-emergency traffic goes back to
      // normal limits.
      const endRl = checkRateLimit(`eid:${emergencyId}`, "sos", true);

      // P2-#8: If this session is already ended, short-circuit. A user
      // mashing "End SOS", a network retry, or the offline replay worker
      // all land here; we must NOT re-broadcast sos_ended (which would
      // dismiss responders twice and muddy audit logs).
      const { data: current } = await supabase
        .from("sos_sessions")
        .select("status, ended_at, user_id, company_id")
        .eq("id", emergencyId)
        .maybeSingle();
      if (!current) {
        return new Response(JSON.stringify({ error: "Session not found" }), { status: 404, headers: cors });
      }
      // Allow: SOS owner OR company admin/owner (dashboard "Mark resolved").
      let endAllowed = (current.user_id === endAuth.userId);
      if (!endAllowed && current.company_id) {
        const { data: m } = await supabase
          .from("company_memberships")
          .select("role")
          .eq("company_id", current.company_id)
          .eq("user_id", endAuth.userId)
          .eq("active", true)
          .maybeSingle();
        if (m && ["admin","owner"].includes(m.role)) endAllowed = true;
      }
      if (!endAllowed) {
        console.warn(`[sos-alert] END ownership mismatch eid=${emergencyId} jwt=${endAuth.userId} session_user=${current.user_id}`);
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: cors });
      }

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

      // FIX 2026-04-24 (#28): server-side audit trail for SOS end. The
      // dashboard + compliance reports read public.audit_log; without
      // this call there was no server-verified record that a specific
      // user ended a specific incident at a specific time. Best-effort:
      // wrapped in try/catch so a failed audit never fails the SOS end.
      try {
        await supabase.rpc("log_sos_audit", {
          p_action: "sos_ended",
          p_actor: current?.user_id ?? "system",
          p_actor_level: "worker",
          p_operation: "sos_end",
          p_target: emergencyId,
          p_target_name: null,
          p_metadata: {
            reason: reason || "user_ended",
            recordingSec: recordingSec ?? null,
            photoCount: typeof photos === "number" ? photos : (photos?.length ?? 0),
            hasComment: !!comment,
            source: "sos-alert/end",
          },
        });
      } catch (e) {
        console.warn("[sos-alert] audit log (end) failed:", e);
      }

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
    const { emergencyId, userName, userPhone, location, bloodType, zone, silent } = payload;
    // `contacts` is mutable — we may clamp it server-side before fanout
    // (see "FIX 2026-04-24 (#7)" block below). Declared with `let` so the
    // slice re-assignment below is type-safe under Deno's strict mode.
    let contacts = payload.contacts;
    // FIX 2026-04-24 (Point 5): normalize packetModules — always returns
    // a concrete object so downstream SMS-building code never has to
    // deal with optional fields. Older clients or missing field → all
    // modules on (backward-compatible open default).
    const packet = {
      location: true as const,
      medical:   payload.packetModules?.medical   !== false,
      contacts:  payload.packetModules?.contacts  !== false,
      device:    payload.packetModules?.device    !== false,
      recording: payload.packetModules?.recording !== false,
      incident:  payload.packetModules?.incident  !== false,
    };

    // Shape-validate aiScript early (tier gate applied after resolveTier below).
    const aiScriptShape = sanitizeAiScript(payload.aiScript);

    // W3-1 (B-20, 2026-04-26): payload.userId can be a human-readable
    // EMP-* identifier from the civilian flow OR the auth UUID — both are
    // tolerated. The JWT (authUserId) is the source of truth used for
    // all DB writes. We log a notice when they differ so legacy callers
    // get cleaned up, but we do NOT fail the request — that 403 silently
    // broke every civilian server-side SOS leg pre-fix.
    if (payload.userId && payload.userId !== authUserId) {
      console.log(`[sos-alert] userId differs from JWT (using JWT): payload=${payload.userId} jwt=${authUserId}`);
    }
    // From here on every reference uses authUserId (JWT-derived UUID).

    if (!emergencyId || !contacts?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: cors,
      });
    }

    // ── SERVER-SIDE TIER RESOLUTION (ignore client-supplied tier) ──
    const tier = await resolveTier(authUserId, supabase);

    // FIX 2026-04-24 (pre-launch audit #6+#7): server-side tier limits.
    //
    // TIER_CAP mirrors src/app/components/subscription-service.ts TIER_CONFIG
    // exactly. Keep the two in sync until the post-launch v1.1 refactor
    // moves tier config to a DB table.
    //
    // Numbers are also used for:
    //   (a) clamping the contact array (defence against tampered client)
    //   (b) per-tier SOS rate limits (check_sos_rate_limit RPC below)
    //   (c) Twilio call TimeLimit (cap max conference duration)
    const TIER_CAP: Record<string, { maxContacts: number; callDurationSec: number }> = {
      free:  { maxContacts: 1,  callDurationSec: 45  },
      basic: { maxContacts: 6,  callDurationSec: 60  },
      elite: { maxContacts: 10, callDurationSec: 120 },
    };
    const tierLimits  = TIER_CAP[tier] ?? TIER_CAP.free;
    const tierCap     = tierLimits.maxContacts;
    const originalCount = Array.isArray(contacts) ? contacts.length : 0;
    if (originalCount > tierCap) {
      console.warn(`[sos-alert] contacts clamped: tier=${tier} received=${originalCount} capped=${tierCap} user=${authUserId}`);
      contacts = contacts.slice(0, tierCap);
    }

    // FIX 2026-04-24 (#6): per-tier SOS trigger rate limit.
    // Guards against a compromised account hammering SOS to burn
    // Twilio budget. Caps:
    //   free:  1/hour, 3/day
    //   basic: 3/hour, 15/day
    //   elite: 5/hour, 30/day
    // Real emergencies are rare; anyone hitting these caps is either
    // an attacker or has a sensor miscalibration — either way, we
    // stop billing and tell them to contact support.
    const SOS_RATE_LIMITS: Record<string, { perHour: number; perDay: number }> = {
      free:  { perHour: 1, perDay: 3  },
      basic: { perHour: 3, perDay: 15 },
      elite: { perHour: 5, perDay: 30 },
    };
    const userRateLimits = SOS_RATE_LIMITS[tier] ?? SOS_RATE_LIMITS.free;
    {
      const { data: usage, error: usageErr } = await supabase.rpc(
        "check_sos_rate_limit",
        { p_user_id: authUserId, p_hours: 1, p_days: 1 },
      );
      // ───────────────────────────────────────────────────────────────
      // B-10 (2026-04-25): the prior code logged on RPC error and
      // proceeded — i.e. it FAILED OPEN. A user with a slow / erroring
      // database hop could burn unlimited Twilio budget before the
      // limiter ever ran. The new behavior is FAIL-SECURE: we return
      // 503 so the client retries, and we audit the metering failure so
      // ops gets a Sentry alert long before any real bill damage.
      //
      // Trade-off: a rare DB hiccup will briefly block a legitimate
      // SOS. But:
      //   - DB outages are <1 in 10^6 events
      //   - A single retry resolves it
      //   - The alternative is open-ended bill exposure
      //   - The error response tells the user to dial local services
      //     directly so they are NEVER stranded
      // ───────────────────────────────────────────────────────────────
      if (usageErr) {
        console.error(
          `[sos-alert] CRITICAL: rate-limit RPC failed tier=${tier} user=${authUserId}:`,
          usageErr,
        );
        // Best-effort audit so ops sees the metering miss. We don't
        // await anything that would slow the response further.
        try {
          await supabase.rpc("log_sos_audit", {
            p_action: "rate_limit_check_failed",
            p_actor: authUserId,
            p_actor_level: "civilian",
            p_operation: "sos_metering_miss",
            p_target: emergencyId,
            p_target_name: userName ?? null,
            p_metadata: {
              tier,
              error_message: usageErr.message ?? String(usageErr),
              source: "sos-alert",
            },
          });
        } catch (auditEx) {
          console.error("[sos-alert] audit of rate-limit failure also failed:", auditEx);
        }
        return new Response(
          JSON.stringify({
            error: "rate_limit_check_failed",
            tier,
            retry_after_sec: 5,
            message:
              "We could not verify your SOS quota right now. Please try again in a few seconds. If this is a real emergency, call 911/999/112 directly.",
          }),
          { status: 503, headers: cors },
        );
      }

      // RPC succeeded — apply the configured limits.
      if (usage) {
        const hourCount = (usage as { last_hour?: number; last_day?: number }).last_hour ?? 0;
        const dayCount  = (usage as { last_hour?: number; last_day?: number }).last_day  ?? 0;
        if (hourCount >= userRateLimits.perHour) {
          console.warn(`[sos-alert] rate limit (hour) tier=${tier} user=${authUserId} count=${hourCount}`);
          return new Response(JSON.stringify({
            error: "rate_limit_exceeded",
            scope: "hour",
            tier,
            limit: userRateLimits.perHour,
            retry_after_sec: 3600,
            message: "You've hit the hourly SOS limit. If this is a real emergency, call 911/999/112 directly. Contact support if you believe this is an error.",
          }), { status: 429, headers: cors });
        }
        if (dayCount >= userRateLimits.perDay) {
          console.warn(`[sos-alert] rate limit (day) tier=${tier} user=${authUserId} count=${dayCount}`);
          return new Response(JSON.stringify({
            error: "rate_limit_exceeded",
            scope: "day",
            tier,
            limit: userRateLimits.perDay,
            retry_after_sec: 86400,
            message: "You've hit the daily SOS limit. If this is a real emergency, call 911/999/112 directly.",
          }), { status: 429, headers: cors });
        }
      }
    }

    // Apply tier gate: aiScript is Elite-only. For Basic / Free users
    // the server falls back to the default announcement.
    const aiScript: AiScriptPayload | null = (tier === "elite") ? aiScriptShape : null;
    if (aiScriptShape && !aiScript) {
      console.warn(`[sos-alert] aiScript rejected — tier=${tier} not Elite (user=${authUserId})`);
    }

    const trackUrl = `${BASE_URL}/track?eid=${emergencyId}`;
    const dashUrl  = `${BASE_URL}/emergency/${emergencyId}`;
    const statusCb = `${SUPA_URL}/functions/v1/twilio-status?callId=${emergencyId}`;

    console.log(`[sos-alert] ═══ SOS TRIGGERED ═══ id=${emergencyId} tier=${tier} contacts=${contacts.length}/${originalCount} silent=${!!silent}`);

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
    // W3-28 (B-20, 2026-04-26): early "sos_dispatch_started" audit row.
    // Pre-fix: if Promise.all (line below) throws partway, or if the rich
    // post-fanout audit (further down) also fails, we lose ALL evidence
    // that the SOS was even dispatched. Forensic black hole.
    // Post-fix: write a barebones checkpoint BEFORE the fanout starts, so
    // there is always at least one breadcrumb proving the trigger was
    // received, even when the fanout silently dies. Wrapped in try/catch
    // — if THIS fails, we still try the fanout (audit failure must never
    // block emergency dispatch).
    try {
      await supabase.rpc("log_sos_audit", {
        p_action: "sos_dispatch_started",
        p_actor: authUserId,
        p_actor_level: "worker",
        p_operation: "sos_trigger",
        p_target: emergencyId,
        p_target_name: userName,
        p_metadata: {
          tier,
          contactCount: contacts.length,
          checkpoint: "pre_fanout",
          severity: "info",
        },
      });
    } catch (e) {
      console.warn("[sos-alert] pre-fanout audit checkpoint failed (non-fatal):", e);
    }

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
      // FIX 2026-04-24 (Point 5): every line below is gated by the
      // relevant packet module. Location is always on (it's the point).
      // Medical / device / recording / incident are honored strictly —
      // if the user turned a module OFF in the Emergency Packet screen,
      // that line is omitted from every outbound SMS, for every tier.
      let smsBody: string;
      if (tier === "free") {
        smsBody = [
          `🚨 SOS — ${userName}`,
          `${c.name}, ${userName} needs help!`,
          `📍 Location: ${trackUrl}`,
          (packet.medical && bloodType) ? `🩸 Blood: ${bloodType}` : "",
          `Open: ${dashUrl}`,
        ].filter(Boolean).join("\n");
      } else if (tier === "basic") {
        smsBody = [
          `🚨 SOS — ${userName} needs help!`,
          `📍 Live tracking: ${trackUrl}`,
          (packet.medical && bloodType) ? `🩸 Blood type: ${bloodType}` : "",
          packet.incident ? `Emergency ID: ${emergencyId}` : "",
        ].filter(Boolean).join("\n");
      } else {
        smsBody = [
          `🚨 EMERGENCY — ${userName}`,
          `${c.name}, ${userName} triggered SOS!`,
          `📍 Live: ${trackUrl}`,
          `🔗 Dashboard: ${dashUrl}`,
          (packet.medical && bloodType) ? `🩸 Blood: ${bloodType}` : "",
          packet.recording ? `⏱ Recording active` : "",
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
          timeLimitSec: tierLimits.callDurationSec, // 60s for basic
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
              timeLimitSec: tierLimits.callDurationSec, // 120s for elite
            });
          })();
        } else {
          callPromise = twilioCall(cleanPhone, bridgeTwimlUrl, {
            statusCallback: statusCb,
            record: false,
            machineDetection: true,
            timeout: 30,
            timeLimitSec: tierLimits.callDurationSec, // 120s for elite
          });
        }
      }
      // Free tier: no call, just SMS

      // W3-27 (B-20, 2026-04-26): per-contact timeout. Pre-fix one stuck
      // Twilio API call (e.g., partial network partition with no TCP RST)
      // would hang the inner Promise.all forever, which in turn hung the
      // OUTER Promise.all over all contacts → entire SOS fanout stalled
      // until Deno's 150s worker timeout. Now: race each leg with a 20s
      // cap; on timeout we record null sid + a "timeout" method label
      // and let the rest of the fanout finish normally.
      const FANOUT_TIMEOUT_MS = 20000;
      const smsTimed: Promise<string | null> = Promise.race([
        smsPromise.then((v) => v ?? null).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FANOUT_TIMEOUT_MS)),
      ]);
      const callTimed: Promise<{ sid: string } | null> = Promise.race([
        callPromise.then((v) => v ?? null).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FANOUT_TIMEOUT_MS)),
      ]);
      const [smsSid, callResult] = await Promise.all([smsTimed, callTimed]);

      const method =
        tier === "free" ? "sms_only" :
        tier === "basic" ? "tts_call_plus_sms" :
        "bridge_call_recorded_plus_sms";

      console.log(`[sos-alert] ${tier.toUpperCase()} → ${c.name}: call=${callResult?.sid || "SKIP/FAIL/TIMEOUT"} sms=${smsSid || "FAIL/TIMEOUT"}`);

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

    // FIX 2026-04-24 Fix #6: record Twilio spend to the ledger.
    // Rough estimates: SMS ≈ $0.0075, call ≈ $0.015/min.
    // For the call we don't know actual duration at fire-time (call
    // may still be ringing), so we estimate using the tier's TimeLimit
    // as the worst case. Twilio status webhooks can refine later.
    try {
      // Resolve company_id if the user is an employee (so ledger
      // aggregates per company for the budget check).
      let ledgerCompanyId: string | null = null;
      try {
        const { data: emp } = await supabase
          .from("employees")
          .select("company_id")
          .eq("user_id", authUserId)
          .limit(1)
          .maybeSingle();
        ledgerCompanyId = (emp?.company_id as string | null) ?? null;
      } catch { /* civilian — no company row */ }

      const SMS_COST   = 0.0075;
      const CALL_PER_S = 0.015 / 60; // $0.015/min
      const callCostEstimate = tierLimits.callDurationSec * CALL_PER_S;

      for (const r of fanoutResults) {
        if (r.smsSid) {
          await supabase.rpc("record_twilio_spend", {
            p_company_id:    ledgerCompanyId,
            p_user_id:       authUserId,
            p_emergency_id:  emergencyId,
            p_channel:       "sms",
            p_twilio_sid:    r.smsSid,
            p_cost_estimate: SMS_COST,
            p_duration_sec:  null,
          });
        }
        if (r.callSid) {
          await supabase.rpc("record_twilio_spend", {
            p_company_id:    ledgerCompanyId,
            p_user_id:       authUserId,
            p_emergency_id:  emergencyId,
            p_channel:       "call",
            p_twilio_sid:    r.callSid,
            p_cost_estimate: callCostEstimate,
            p_duration_sec:  tierLimits.callDurationSec,
          });
        }
      }
    } catch (ledgerErr) {
      console.warn("[sos-alert] spend ledger write failed (non-fatal):", ledgerErr);
    }

    // FIX 2026-04-24 (#28): server-verified audit trail for the TRIGGER
    // path. Previously no row was ever written to audit_log from here,
    // so compliance reports + the dashboard audit page had no evidence
    // that a real SOS had been dispatched. Metadata captures the
    // actionable facts that investigators need: tier, contact count,
    // silent-mode, call/SMS success summary, zone, location.
    try {
      const deliverySummary = fanoutResults.reduce(
        (acc, r) => {
          if (r.callSid) acc.callsFired++;
          if (r.smsSid) acc.smsFired++;
          if ((r as any).error === "invalid_number") acc.invalidNumbers++;
          return acc;
        },
        { callsFired: 0, smsFired: 0, invalidNumbers: 0 },
      );
      await supabase.rpc("log_sos_audit", {
        p_action: "sos_triggered",
        p_actor: authUserId,
        p_actor_level: "worker",
        p_operation: "sos_trigger",
        p_target: emergencyId,
        p_target_name: userName,
        p_metadata: {
          tier,
          contactCount: contacts.length,
          silent: !!silent,
          zone: zone ?? null,
          location: {
            lat: location.lat,
            lng: location.lng,
            accuracy: location.accuracy ?? null,
          },
          delivery: deliverySummary,
          // FIX 2026-04-24 (Point 5): pin the packet privacy state into
          // the audit trail. This is what the PDF (Section 4 + 7) and
          // the company dashboard read to render "what was shared with
          // contacts" — proving to a legal investigator that we didn't
          // ship data the user had turned off.
          packetModules: packet,
          source: "sos-alert/trigger",
        },
      });
    } catch (e) {
      console.warn("[sos-alert] audit log (trigger) failed:", e);
    }

    // ── Broadcast SOS to dashboard via Realtime ──
    // W3-3 (B-20, 2026-04-26): tenant-scoped channel.
    // Pre-fix: `sos-live` was a GLOBAL channel — every authenticated
    // Realtime subscriber received every tenant's SOS payload (employee
    // name, lat/lng, contact names, blood-typed). Cross-tenant PHI leak.
    // Post-fix: channel is `sos-live:${companyId}` for B2B, or
    // `sos-live:civilian:${userId}` for civilian (so the user's own
    // dashboard can subscribe but no one else can). The civilian channel
    // name can only be guessed by knowing the user's UUID, and Supabase
    // Realtime Authorization (post-launch hardening) will further gate
    // subscriptions by JWT claim.
    try {
      // Resolve company for this SOS — look up user's active_company_id
      let scopedChannel: string;
      try {
        const { data: prof } = await supabase
          .from("profiles").select("active_company_id").eq("id", authUserId).maybeSingle();
        const companyId = prof?.active_company_id;
        scopedChannel = companyId
          ? `sos-live:${companyId}`
          : `sos-live:civilian:${authUserId}`;
      } catch {
        scopedChannel = `sos-live:civilian:${authUserId}`;
      }
      const ch = supabase.channel(scopedChannel);
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
      console.log(`[sos-alert] broadcast on tenant-scoped channel: ${scopedChannel}`);
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
