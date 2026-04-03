import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { employees, companyName, inviteCode, batchSize = 100 } = await req.json();

    if (!employees || !Array.isArray(employees)) {
      return new Response(JSON.stringify({ error: "Invalid employees data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const results = { sent: 0, failed: 0, errors: [] as string[] };
    const batch = employees.slice(0, batchSize);

    for (const emp of batch) {
      if (!emp.email) continue;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "SOSphere <onboarding@resend.dev>",
          to: emp.email,
          subject: `You have been invited to join ${companyName} on SOSphere`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: #0A1220; padding: 30px; border-radius: 16px; text-align: center;">
                <h1 style="color: #00C8E0; margin: 0;">SOSphere</h1>
                <p style="color: #ffffff; font-size: 14px;">Safety Intelligence Platform</p>
              </div>
              <div style="padding: 30px 0;">
                <h2 style="color: #0A1220;">Hi ${emp.name || "there"},</h2>
                <p style="color: #444; line-height: 1.6;">
                  <strong>${companyName}</strong> has invited you to join SOSphere.
                </p>
                <div style="background: #f5f5f5; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0;">
                  <p style="color: #666; margin: 0 0 10px;">Your Invite Code</p>
                  <h2 style="color: #00C8E0; letter-spacing: 8px; margin: 0;">${inviteCode}</h2>
                </div>
                <ol style="color: #444; line-height: 2;">
                  <li>Download SOSphere app</li>
                  <li>Tap "Join My Company"</li>
                  <li>Enter code: <strong>${inviteCode}</strong></li>
                  <li>Verify your phone number</li>
                </ol>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="https://sosphere.app/join/${inviteCode}"
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
        const err = await res.json();
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
