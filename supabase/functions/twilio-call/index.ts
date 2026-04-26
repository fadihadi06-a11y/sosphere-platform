// SOSphere twilio-call edge function
// v9 (B-09):  emits gtok in <Gather>
// v10 (G-15/G-16): server-side `from` + escapeXml on TwiML.
// v11 (G-12): server-side `to` derivation against admin/owner phones.
// v12 (G-5  B-20 2026-04-26): adds mode parameter:
//   - mode="admin" (default): the SOS escalation path. `to` must be an
//     admin/owner phone of the emergency's company. (existing G-12 logic)
//   - mode="employee_callback": admin-clicks-Callback path. `to` must be
//     the SOS owner's own phone (resolved via sos_sessions.user_id ->
//     profiles.phone). The CALLER (JWT user) must be an admin/owner of
//     the emergency's company — a worker cannot use this path to call
//     other workers. Pre-fix the admin UI used a setTimeout simulation
//     and never actually called Twilio.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, markSosPriority, getRateLimitHeaders } from "../_shared/rate-limiter.ts";
import { signGatherToken } from "../_shared/gather-token.ts";

function escapeXml(unsafe: string | null | undefined): string {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function normalizePhone(p: string | null | undefined): string {
  if (!p) return "";
  const trimmed = String(p).trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",").map(s => s.trim()).filter(Boolean);
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

const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

async function authenticate(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  if (!SUPA_URL || !SUPA_KEY) return null;
  const jwt = authHeader.replace("Bearer ", "");
  try {
    const supabase = createClient(SUPA_URL, SUPA_KEY);
    const { data: { user }, error } = await supabase.auth.getUser(jwt);
    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

// G-12: admin/owner phones for `mode=admin` (escalation direction).
async function resolveAdminPhones(
  admin: ReturnType<typeof createClient>,
  callId: string,
): Promise<{ companyId: string | null; phones: Set<string> }> {
  const phones = new Set<string>();
  const { data: session } = await admin
    .from("sos_sessions").select("company_id").eq("id", callId).maybeSingle();
  const companyId = (session as any)?.company_id ?? null;
  if (!companyId) return { companyId: null, phones };
  const { data: profileRows } = await admin
    .from("company_memberships")
    .select("user_id, role, active, profiles:profiles!company_memberships_user_id_fkey(phone)")
    .eq("company_id", companyId).in("role", ["admin", "owner"]).eq("active", true);
  for (const r of (profileRows as any[]) || []) {
    const ph = normalizePhone(r?.profiles?.phone);
    if (ph) phones.add(ph);
  }
  const { data: empRows } = await admin
    .from("employees").select("phone, role, status")
    .eq("company_id", companyId).in("role", ["admin", "owner"]).eq("status", "active");
  for (const r of (empRows as any[]) || []) {
    const ph = normalizePhone(r?.phone);
    if (ph) phones.add(ph);
  }
  return { companyId, phones };
}

// G-5: SOS owner's phone for `mode=employee_callback` (admin -> employee).
// Returns the owner phone PLUS the company_id so the caller-authorisation
// check can confirm the caller is admin/owner of the same company.
async function resolveEmployeeCallbackTarget(
  admin: ReturnType<typeof createClient>,
  callId: string,
): Promise<{ companyId: string | null; ownerPhone: string | null }> {
  const { data: session } = await admin
    .from("sos_sessions")
    .select("user_id, company_id").eq("id", callId).maybeSingle();
  if (!session) return { companyId: null, ownerPhone: null };
  const userId = (session as any).user_id as string | null;
  const companyId = (session as any).company_id as string | null;
  if (!userId) return { companyId, ownerPhone: null };
  // Try profiles.phone first, fall back to employees.phone (per company schema).
  const { data: profile } = await admin
    .from("profiles").select("phone").eq("id", userId).maybeSingle();
  let ph = normalizePhone((profile as any)?.phone);
  if (!ph) {
    const { data: emp } = await admin
      .from("employees").select("phone").eq("user_id", userId).maybeSingle();
    ph = normalizePhone((emp as any)?.phone);
  }
  return { companyId, ownerPhone: ph || null };
}

// G-5: caller must be admin/owner of the emergency's company to use
// the employee_callback mode. A regular employee CANNOT use this path
// to call other employees — prevents harassment + toll-fraud variants.
async function callerIsCompanyAdmin(
  admin: ReturnType<typeof createClient>,
  userId: string,
  companyId: string,
): Promise<boolean> {
  const { data: m } = await admin
    .from("company_memberships")
    .select("role").eq("company_id", companyId).eq("user_id", userId)
    .eq("active", true).maybeSingle();
  return !!m && ["admin", "owner"].includes((m as any).role);
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userId = await authenticate(req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: "Valid Bearer token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { to, callId, employeeName, companyName, zoneName } = body;
    const mode: "admin" | "employee_callback" = body.mode === "employee_callback" ? "employee_callback" : "admin";

    const from = Deno.env.get("TWILIO_FROM_NUMBER") || "";
    if (!from) {
      console.error("[twilio-call] TWILIO_FROM_NUMBER env not configured");
      return new Response(
        JSON.stringify({ error: "Twilio sender number not configured on server" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!to || !callId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, callId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(SUPA_URL, SUPA_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // G-12 + G-5: per-mode `to` validation.
    let companyIdForLog: string | null = null;
    if (mode === "admin") {
      const { companyId, phones } = await resolveAdminPhones(admin, callId);
      if (!companyId) {
        return new Response(
          JSON.stringify({ error: "Emergency is not company-scoped or does not exist" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const targetNorm = normalizePhone(to);
      if (!targetNorm || !phones.has(targetNorm)) {
        console.warn(`[twilio-call] mode=admin target=${to} not in admin/owner phones for company=${companyId}`);
        return new Response(
          JSON.stringify({ error: "Recipient not authorised for this emergency" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      companyIdForLog = companyId;
    } else {
      // mode=employee_callback
      const { companyId, ownerPhone } = await resolveEmployeeCallbackTarget(admin, callId);
      if (!companyId) {
        return new Response(
          JSON.stringify({ error: "Emergency is not company-scoped or does not exist" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const isAdmin = await callerIsCompanyAdmin(admin, userId, companyId);
      if (!isAdmin) {
        console.warn(`[twilio-call] mode=employee_callback caller=${userId} not admin/owner of company=${companyId}`);
        return new Response(
          JSON.stringify({ error: "Only company admins/owners may call back the SOS owner" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const targetNorm = normalizePhone(to);
      if (!targetNorm || !ownerPhone || targetNorm !== ownerPhone) {
        console.warn(`[twilio-call] mode=employee_callback target=${to} != owner-phone=${ownerPhone} for callId=${callId}`);
        return new Response(
          JSON.stringify({ error: "Recipient is not the SOS owner for this emergency" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      companyIdForLog = companyId;
    }

    markSosPriority(userId);
    const rl = checkRateLimit(userId, "api", true);

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken  = Deno.env.get("TWILIO_AUTH_TOKEN");
    const baseUrl    = Deno.env.get("SOSPHERE_BASE_URL") || "https://sosphere-platform.vercel.app";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!accountSid || !authToken) {
      return new Response(
        JSON.stringify({ error: "Twilio credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const gtok = await signGatherToken(callId);
    const safeEmployee = escapeXml(employeeName || "an employee");
    const safeCompany  = escapeXml(companyName  || "your company");
    const safeZone     = escapeXml(zoneName     || "unknown zone");

    // Two TwiML scripts — admin escalation vs employee callback.
    const twiml = mode === "admin"
      ? `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna" language="en-US">\n    Emergency S.O.S. alert from ${safeEmployee} at ${safeCompany}.\n    Location: ${safeZone}.\n    Press 1 to connect to the emergency dashboard.\n    Press 2 to hear the alert again.\n  </Say>\n  <Gather numDigits="1" action="${supabaseUrl}/functions/v1/twilio-status?action=gather&amp;callId=${callId}&amp;baseUrl=${encodeURIComponent(baseUrl)}&amp;gtok=${encodeURIComponent(gtok)}" method="POST" timeout="10">\n    <Play loop="2">https://api.twilio.com/cowbell.mp3</Play>\n  </Gather>\n  <Say voice="Polly.Joanna">No response received. The emergency team has been notified. Goodbye.</Say>\n</Response>`
      : `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna" language="en-US">\n    This is a callback from ${safeCompany}. Your supervisor is checking on your safety after the recent S.O.S. alert. Please stay on the line.\n  </Say>\n  <Pause length="1"/>\n  <Say voice="Polly.Joanna">Connecting you now. The call may be recorded for safety.</Say>\n</Response>`;

    const statusCallback = `${supabaseUrl}/functions/v1/twilio-status?callId=${callId}&type=${mode}`;
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
    const auth = btoa(`${accountSid}:${authToken}`);
    const formData = new URLSearchParams({
      To: to, From: from, Twiml: twiml, StatusCallback: statusCallback,
      StatusCallbackEvent: "initiated ringing answered completed",
      StatusCallbackMethod: "POST", Timeout: "30", MachineDetection: "Enable",
    });
    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("[twilio-call] Twilio API error:", result);
      return new Response(
        JSON.stringify({ error: "Twilio call failed" }),
        { status: response.status, headers: { ...corsHeaders, ...getRateLimitHeaders(rl), "Content-Type": "application/json" } },
      );
    }
    console.log(`[twilio-call] mode=${mode} call initiated: ${result.sid} -> ${to} (callId=${callId}, user=${userId}, company=${companyIdForLog})`);
    return new Response(
      JSON.stringify({ callSid: result.sid, status: result.status, to: result.to, from: result.from, callId, mode }),
      { status: 200, headers: { ...corsHeaders, ...getRateLimitHeaders(rl), "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[twilio-call] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
