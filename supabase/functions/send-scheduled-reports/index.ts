// ═══════════════════════════════════════════════════════════════
// send-scheduled-reports — cron-invoked scheduled compliance report sender
// ─────────────────────────────────────────────────────────────
// Invoked by public.trigger_scheduled_reports() (pg_cron, every 15 min), one
// POST per due email_schedules row, with an x-cron-secret header.
//
// For the schedule it: builds a REAL summary from live company data
// (sos_queue incidents, employees, resolution rate), emails it to every
// recipient via Resend with a dashboard link, then marks the schedule sent
// and advances next_run by its frequency.
//
// Secret model mirrors weather-fetch: x-cron-secret is checked against the
// vault cron_shared_secret (via get_cron_shared_secret RPC) with a CRON_SECRET
// env fallback. No auth.uid() — runs as service_role only.
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const CRON_SECRET_ENV      = Deno.env.get("CRON_SECRET") ?? "";
const FROM_EMAIL           = Deno.env.get("REPORT_FROM_EMAIL") ?? "SOSphere Reports <onboarding@resend.dev>";
const DASHBOARD_URL        = Deno.env.get("DASHBOARD_URL") ?? "https://sosphere.co/dashboard";

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function nextRunFrom(freq: string, from: Date): string {
  const d = new Date(from);
  if (freq === "daily") d.setDate(d.getDate() + 1);
  else if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "monthly") { d.setMonth(d.getMonth() + 1); d.setDate(1); }
  else { d.setMonth(d.getMonth() + 3); d.setDate(1); } // quarterly
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

async function getCronSharedSecret(client: ReturnType<typeof createClient>): Promise<string> {
  try {
    const { data, error } = await client.rpc("get_cron_shared_secret");
    if (!error && typeof data === "string" && data) return data;
  } catch { /* fall through to env */ }
  return CRON_SECRET_ENV;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405 });
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  // ── verify cron secret ──
  const provided = req.headers.get("x-cron-secret") ?? "";
  const expected = await getCronSharedSecret(admin);
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }

  let body: { scheduleId?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const scheduleId = body.scheduleId;
  if (!scheduleId) {
    return new Response(JSON.stringify({ ok: false, error: "missing_scheduleId" }), { status: 400 });
  }

  // ── load the schedule ──
  const { data: sched, error: schedErr } = await admin
    .from("email_schedules").select("*").eq("id", scheduleId).single();
  if (schedErr || !sched) {
    return new Response(JSON.stringify({ ok: false, error: "schedule_not_found" }), { status: 404 });
  }
  if (!sched.enabled) {
    return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), { status: 200 });
  }
  const recipients: string[] = (sched.recipients ?? []).filter((e: string) => /\S+@\S+\.\S+/.test(e));
  if (recipients.length === 0) {
    // nothing to send to — still advance next_run so it doesn't spin
    await admin.from("email_schedules").update({
      last_run: new Date().toISOString(), next_run: nextRunFrom(sched.frequency, new Date()), updated_at: new Date().toISOString(),
    }).eq("id", scheduleId);
    return new Response(JSON.stringify({ ok: true, skipped: "no_recipients" }), { status: 200 });
  }

  // ── build REAL summary from live data ──
  const companyId = sched.company_id;
  const { data: company } = await admin.from("companies").select("name").eq("id", companyId).single();
  const companyName = company?.name ?? "Your company";

  const since = new Date(); since.setDate(since.getDate() - 30);
  const { data: sosRows } = await admin
    .from("sos_queue").select("status, recorded_at").eq("company_id", companyId).gte("recorded_at", since.toISOString());
  const incidents = sosRows?.length ?? 0;
  const resolved = (sosRows ?? []).filter((r: { status?: string }) => r.status === "resolved").length;
  const resolutionRate = incidents > 0 ? Math.round((resolved / incidents) * 100) : 100;

  const { count: employeeCount } = await admin
    .from("employees").select("id", { count: "exact", head: true }).eq("company_id", companyId);

  const period = sched.frequency.charAt(0).toUpperCase() + sched.frequency.slice(1);
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0A1220; padding: 28px; border-radius: 16px; text-align: center;">
        <h1 style="color: #00C8E0; margin: 0;">SOSphere</h1>
        <p style="color: #ffffff; font-size: 13px; margin: 4px 0 0;">${escapeHtml(period)} Safety Report — ${escapeHtml(companyName)}</p>
      </div>
      <div style="padding: 24px 0;">
        <p style="color:#444; line-height:1.6;">Your scheduled <strong>${escapeHtml(sched.name)}</strong> safety summary (last 30 days):</p>
        <table style="width:100%; border-collapse:collapse; margin:16px 0;">
          <tr><td style="padding:10px; background:#f5f7fa; border-radius:8px;">Emergencies (30d)</td><td style="padding:10px; text-align:right; font-weight:800;">${incidents}</td></tr>
          <tr><td style="padding:10px;">Resolution rate</td><td style="padding:10px; text-align:right; font-weight:800; color:${resolutionRate >= 90 ? "#00A046" : resolutionRate >= 70 ? "#C77700" : "#C0392B"};">${resolutionRate}%</td></tr>
          <tr><td style="padding:10px; background:#f5f7fa; border-radius:8px;">Workers</td><td style="padding:10px; text-align:right; font-weight:800;">${employeeCount ?? 0}</td></tr>
        </table>
        <div style="text-align:center; margin: 24px 0;">
          <a href="${escapeHtml(DASHBOARD_URL)}" style="background:#00C8E0; color:#04240F; text-decoration:none; font-weight:800; padding:12px 22px; border-radius:10px; display:inline-block;">Open full report in dashboard</a>
        </div>
        <p style="color:#999; font-size:11px; line-height:1.5;">You are receiving this because a SOSphere admin scheduled a ${escapeHtml(sched.frequency)} report. The full PDF (incidents, corrective actions, zone risk) is available in your dashboard.</p>
      </div>
    </div>`;

  // ── send via Resend (one message, all recipients) ──
  let sent = false; let sendError = "";
  if (RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: recipients,
          subject: `${period} Safety Report — ${companyName}`,
          html,
        }),
      });
      sent = res.ok;
      if (!res.ok) sendError = `resend_${res.status}`;
    } catch (e) { sendError = String((e as Error).message); }
  } else {
    sendError = "resend_not_configured";
  }

  // ── advance schedule (mark sent + next_run) regardless, to avoid spin ──
  await admin.from("email_schedules").update({
    last_run: new Date().toISOString(),
    next_run: nextRunFrom(sched.frequency, new Date()),
    updated_at: new Date().toISOString(),
  }).eq("id", scheduleId);

  return new Response(JSON.stringify({ ok: sent, recipients: recipients.length, error: sendError || undefined }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
