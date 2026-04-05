import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
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
          subject: `You have been invited to join ${companyName || "a company"} on SOSphere`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: #0A1220; padding: 30px; border-radius: 16px; text-align: center;">
                <h1 style="color: #00C8E0; margin: 0;">SOSphere</h1>
                <p style="color: #ffffff; font-size: 14px;">Safety Intelligence Platform</p>
              </div>
              <div style="padding: 30px 0;">
                <h2 style="color: #0A1220;">Hi ${emp.name || "there"},</h2>
                <p style="color: #444; line-height: 1.6;">
                  <strong>${companyName || "Your company"}</strong> has invited you to join SOSphere.
                </p>
                <div style="background: #f5f5f5; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0;">
                  <p style="color: #666; margin: 0 0 10px;">Your Invite Code</p>
                  <h2 style="color: #00C8E0; letter-spacing: 8px; margin: 0;">${inviteCode || "N/A"}</h2>
                </div>
                <ol style="color: #444; line-height: 2;">
                  <li>Download SOSphere app</li>
                  <li>Tap "Join My Company"</li>
                  <li>Enter code: <strong>${inviteCode || "N/A"}</strong></li>
                  <li>Verify your phone number</li>
                </ol>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="https://sosphere.app/join/${inviteCode || ""}"
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
