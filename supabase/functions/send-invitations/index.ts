import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// W3-33 (B-20, 2026-04-26): escape attacker-controlled fields before HTML
// interpolation. Pre-fix: companyName, emp.name, inviteCode were inlined
// raw — a tenant registering with `<script src="evil.com/x"></script>` as
// company name would inject XSS into every employee's invite email body.
// Post-fix: escapeHtml() on every textual field, encodeURIComponent() on
// the inviteCode used in the href URL.
function escapeHtml(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
import {
  checkRateLimit,
  getRateLimitHeaders,
} from "../_shared/rate-limiter.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

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

serve(async (req) => {
  // B-M1: origin allowlist via ALLOWED_ORIGINS env
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth check: verify the caller is authenticated ──
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await sb.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Rate limit (auth tier — email blast is abuse-prone) ──
    // Invitations go to arbitrary addresses, so a compromised account
    // could blast onboarding spam to a list of targets. Auth tier
    // (10/min) means at most 500 emails per minute (batch × requests)
    // from a single user — within legitimate HR onboarding range but
    // far below spam territory.
    const rl = checkRateLimit(user.id, "auth", false);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000),
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            ...getRateLimitHeaders(rl),
            "Content-Type": "application/json",
          },
        },
      );
    }

    // ── Validate RESEND_API_KEY ──
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { employees, companyName, inviteCode, batchSize = 100 } = await req.json();

    if (!employees || !Array.isArray(employees)) {
      return new Response(JSON.stringify({ error: "Invalid employees data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ──────────────────────────────────────────────────────────────
    // B-12 (2026-04-25): the prior code accepted `inviteCode` from the
    // request body without verifying it belonged to the caller's
    // company — meaning any authenticated user could blast invitation
    // emails using ANY company's brand + invite code. The fix:
    //   - Require inviteCode in every request.
    //   - Verify it exists in `company_invites` (canonical) OR
    //     `invites` (legacy) and that its `created_by` is the caller.
    //   - Use the caller-scoped client (`sb`) so RLS provides a second
    //     layer of defense.
    // We also pass a non-empty inviteCode to the email body so the
    // template doesn't need to handle the "N/A" branch on a path we
    // now know is unreachable.
    // ──────────────────────────────────────────────────────────────
    if (!inviteCode || typeof inviteCode !== "string" || inviteCode.length < 4) {
      return new Response(
        JSON.stringify({ error: "inviteCode is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    {
      // Try the canonical table first.
      const { data: ciRow, error: ciErr } = await sb
        .from("company_invites")
        .select("invite_code, company_id, created_by")
        .eq("invite_code", inviteCode)
        .eq("created_by", user.id)
        .limit(1)
        .maybeSingle();
      let verified = !ciErr && !!ciRow;

      if (!verified) {
        // Legacy fallback to the `invites` table (older schema).
        const { data: invRow, error: invErr } = await sb
          .from("invites")
          .select("invite_code, company_id")
          .eq("invite_code", inviteCode)
          .limit(1)
          .maybeSingle();
        if (!invErr && invRow?.company_id) {
          // No created_by column on the legacy table — verify caller
          // owns the company instead.
          const { data: ownedCo } = await sb
            .from("companies")
            .select("id")
            .eq("id", invRow.company_id)
            .eq("owner_id", user.id)
            .limit(1)
            .maybeSingle();
          verified = !!ownedCo?.id;
        }
      }

      if (!verified) {
        console.warn(
          `[send-invitations] invite-code authorization FAILED user=${user.id} code=${inviteCode}`,
        );
        return new Response(
          JSON.stringify({ error: "Invalid or unauthorized inviteCode" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Rate limit: max 500 per request
    const batch = employees.slice(0, Math.min(batchSize, 500));
    const results = { sent: 0, failed: 0, errors: [] as string[] };

    for (const emp of batch) {
      if (!emp.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emp.email)) {
        results.failed++;
        results.errors.push(`${emp.email || "unknown"}: Invalid email`);
        continue;
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "SOSphere <onboarding@resend.dev>",
          to: emp.email,
          // W3-33: escape every user-controlled field before HTML interpolation.
          subject: `You have been invited to join ${escapeHtml(companyName || "a company")} on SOSphere`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: #0A1220; padding: 30px; border-radius: 16px; text-align: center;">
                <h1 style="color: #00C8E0; margin: 0;">SOSphere</h1>
                <p style="color: #ffffff; font-size: 14px;">Safety Intelligence Platform</p>
              </div>
              <div style="padding: 30px 0;">
                <h2 style="color: #0A1220;">Hi ${escapeHtml(emp.name || "there")},</h2>
                <p style="color: #444; line-height: 1.6;">
                  <strong>${escapeHtml(companyName || "Your company")}</strong> has invited you to join SOSphere.
                </p>
                <div style="background: #f5f5f5; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0;">
                  <p style="color: #666; margin: 0 0 10px;">Your Invite Code</p>
                  <h2 style="color: #00C8E0; letter-spacing: 8px; margin: 0;">${escapeHtml(inviteCode || "N/A")}</h2>
                </div>
                <ol style="color: #444; line-height: 2;">
                  <li>Download SOSphere app</li>
                  <li>Tap "Join My Company"</li>
                  <li>Enter code: <strong>${escapeHtml(inviteCode || "N/A")}</strong></li>
                  <li>Verify your phone number</li>
                </ol>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="https://sosphere.app/join/${encodeURIComponent(inviteCode || "")}"
                     style="background: #00C8E0; color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: bold;">
                    Join Now
                  </a>
                </div>
              </div>
            </div>
          `,
        }),
      });

      if (res.ok) {
        results.sent++;
      } else {
        results.failed++;
        const err = await res.json().catch(() => ({ message: "Unknown error" }));
        results.errors.push(`${emp.email}: ${err.message}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      sent: results.sent,
      failed: results.failed,
      total: batch.length,
      errors: results.errors,
    }), {
      headers: { ...corsHeaders, ...getRateLimitHeaders(rl), "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
