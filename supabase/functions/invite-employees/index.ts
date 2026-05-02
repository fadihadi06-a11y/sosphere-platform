// ═══════════════════════════════════════════════════════════════
// SOSphere — Edge Function: invite-employees
// Sends Supabase Auth invitations using service_role key
// Called from enterprise-import-wizard.tsx after CSV import
//
// Deploy: supabase functions deploy invite-employees
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

interface InviteRequest {
  employees: {
    email: string;
    full_name?: string;
    company_id: string;
  }[];
  redirect_to?: string;
}

interface InviteResult {
  email: string;
  success: boolean;
  error?: string;
  // #149 fix (2026-05-02): when Supabase Auth refuses to send a new invite
  // because the email already has a confirmed user, we no longer pretend
  // the invite was sent. Instead we surface this distinct state so the
  // owner sees "this person already has a SOSphere account — they can
  // sign in directly" rather than the misleading "invitation sent" toast.
  skipped_existing?: boolean;
}

Deno.serve(async (req: Request) => {
  // B-M1: origin allowlist via ALLOWED_ORIGINS env
  const corsHeaders = buildCorsHeaders(req);
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth: verify caller is authenticated ──────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Create admin client with service_role key ─────────────
    // SERVICE_ROLE_KEY is set as Supabase secret (never exposed to frontend)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── Verify caller session ─────────────────────────────────
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Parse request body ────────────────────────────────────
    const body: InviteRequest = await req.json();
    const { employees, redirect_to } = body;

    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return new Response(
        JSON.stringify({ error: "employees array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Rate limit: max 500 per call ──────────────────────────
    if (employees.length > 500) {
      return new Response(
        JSON.stringify({ error: "Maximum 500 employees per request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ──────────────────────────────────────────────────────────
    // B-11 (2026-04-25): the prior code validated ownership of
    // employees[0].company_id only. Any subsequent row could target
    // a different company, letting any tenant owner spam invites
    // under another tenant's branding. The fix:
    //   1. Require every row to declare a company_id.
    //   2. Require ALL rows to use the SAME company_id (no mixing).
    //   3. Verify the caller owns that company.
    // ──────────────────────────────────────────────────────────
    const declaredCompanyIds = new Set<string>();
    for (const e of employees) {
      if (!e.company_id) {
        return new Response(
          JSON.stringify({ error: "Every employee row must declare a company_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      declaredCompanyIds.add(e.company_id);
    }
    if (declaredCompanyIds.size !== 1) {
      return new Response(
        JSON.stringify({
          error: "Mixed company_id values are not allowed in a single invite batch",
          companies: Array.from(declaredCompanyIds),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const companyId = Array.from(declaredCompanyIds)[0];

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("owner_id", user.id)
      .single();

    if (!company) {
      return new Response(
        JSON.stringify({ error: "You do not own this company" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Send invitations in batches of 10 ────────────────────
    // Supabase recommends small batches to avoid rate limiting
    const results: InviteResult[] = [];
    const batchSize = 10;
    const redirectTo = redirect_to || `${Deno.env.get("SITE_URL") || "https://sosphere.app"}/welcome`;

    for (let i = 0; i < employees.length; i += batchSize) {
      const batch = employees.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (emp) => {
          // Validate email format
          if (!emp.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emp.email)) {
            return { email: emp.email, success: false, error: "Invalid email format" };
          }

          const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(emp.email, {
            redirectTo,
            data: {
              full_name: emp.full_name || "",
              company_id: emp.company_id,
              role: "employee",
            },
          });

          if (error) {
            // #149 fix (2026-05-02): When the email already has a CONFIRMED
            // auth.users record, Supabase Auth's inviteUserByEmail returns
            // an error like "User already registered" and refuses to send
            // a new invitation email — by design, to prevent abuse.
            //
            // PRE-FIX: this branch silently flipped success=true with a
            // tagged error, the summary counted it as "sent", and the UI
            // toasted "Invitation sent" even though no email had left the
            // server. Owner waited for an email that never came.
            //
            // NEW: surface "skipped_existing" as a distinct result. The
            // invitation row in public.invitations stays pending so when
            // the existing user signs in to /app, accept_invitation RPC
            // adds them to the company. The UI shows actionable copy.
            const looksLikeAlreadyExists = /already|registered|exists/i.test(error.message || "");
            if (looksLikeAlreadyExists) {
              return {
                email: emp.email,
                success: false,
                skipped_existing: true,
                error: "User already has a SOSphere account. No invite email was sent. They can sign in directly to /app — they will be added to your company on next sign-in.",
              };
            }
            return { email: emp.email, success: false, error: error.message };
          }

          return { email: emp.email, success: true };
        })
      );

      batchResults.forEach((result, idx) => {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          results.push({ email: batch[idx].email, success: false, error: result.reason?.message });
        }
      });

      // Small delay between batches to respect rate limits
      if (i + batchSize < employees.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // ── Summary ───────────────────────────────────────────────
    // sent  = invites that actually reached an inbox.
    // skipped_existing = the email already had a confirmed account,
    //                    so Supabase refused to send a new invite.
    //                    The invitation row is still pending and will
    //                    be auto-claimed when the existing user signs in.
    // failed = any other error (validation, rate limit, network, etc.).
    const sent             = results.filter(r => r.success === true).length;
    const skipped_existing = results.filter(r => r.skipped_existing === true).length;
    const failed           = results.filter(r => r.success === false && !r.skipped_existing).length;

    return new Response(
      JSON.stringify({
        // top-level success: the function executed without crashing.
        // The per-email outcome is in `summary` and `results` — UI must
        // inspect those, not just the top-level boolean.
        success: true,
        summary: { total: employees.length, sent, failed, skipped_existing },
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[invite-employees] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
