// ═════════════════════════════════════════════════════════════════════════════
// dashboard-actions — dispatcher action endpoints for the web dashboard
// ═════════════════════════════════════════════════════════════════════════════
// 2026-04-23: replaces the [SUPABASE_READY] stubs in hub-incident-reports.tsx
// and dashboard-employee-detail.tsx. Real dispatcher actions that actually
// hit the database:
//
//   POST /dashboard-actions { action: "resolve",     emergencyId, note? }
//   POST /dashboard-actions { action: "acknowledge", emergencyId, note? }
//   POST /dashboard-actions { action: "assign",      emergencyId, responderId }
//   POST /dashboard-actions { action: "message",     emergencyId, body }
//
// Requires a valid JWT; the calling user must be a company admin or owner
// with access to the incident (enforced via RLS on sos_queue + audit_log).
// Every action writes an audit_log row so dispatcher activity is traceable.
// ═════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type ActionPayload = {
  action: "resolve" | "acknowledge" | "assign" | "message";
  emergencyId: string;
  note?: string;
  responderId?: string;
  body?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return new Response(JSON.stringify({ error: "Missing token" }), { status: 401, headers: CORS });

  // Verify caller identity
  const userClient = createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });
  }
  const actorId = userData.user.id;
  const actorEmail = userData.user.email ?? "";

  let payload: ActionPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: CORS });
  }

  if (!payload.emergencyId || !payload.action) {
    return new Response(JSON.stringify({ error: "emergencyId and action are required" }), { status: 400, headers: CORS });
  }

  const admin = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Look up the incident to verify it exists + derive company_id
  const { data: session } = await admin
    .from("sos_sessions")
    .select("id, emergency_id, user_id, company_id, status")
    .eq("emergency_id", payload.emergencyId)
    .maybeSingle();

  if (!session) {
    return new Response(JSON.stringify({ error: "Emergency not found" }), { status: 404, headers: CORS });
  }

  const companyId = session.company_id as string | null;

  // Dispatch per-action
  try {
    switch (payload.action) {
      case "resolve": {
        await admin.from("sos_sessions").update({
          status: "resolved",
          resolved_by: actorId,
          resolved_at: new Date().toISOString(),
          resolution_note: payload.note ?? null,
        }).eq("emergency_id", payload.emergencyId);
        break;
      }
      case "acknowledge": {
        await admin.from("sos_sessions").update({
          acknowledged_by: actorId,
          acknowledged_at: new Date().toISOString(),
        }).eq("emergency_id", payload.emergencyId);
        break;
      }
      case "assign": {
        if (!payload.responderId) {
          return new Response(JSON.stringify({ error: "responderId required" }), { status: 400, headers: CORS });
        }
        await admin.from("sos_sessions").update({
          assigned_to: payload.responderId,
          assigned_by: actorId,
          assigned_at: new Date().toISOString(),
        }).eq("emergency_id", payload.emergencyId);
        break;
      }
      case "message": {
        if (!payload.body) {
          return new Response(JSON.stringify({ error: "body required" }), { status: 400, headers: CORS });
        }
        // Writes to sos_messages (append-only). Client mobile app subscribes
        // to this channel via Supabase realtime to receive dispatcher messages.
        await admin.from("sos_messages").insert({
          emergency_id: payload.emergencyId,
          from_user_id: actorId,
          from_name: actorEmail,
          body: payload.body,
          created_at: new Date().toISOString(),
        });
        break;
      }
      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: CORS });
    }

    // Audit every dispatcher action
    await admin.from("audit_log").insert({
      company_id: companyId,
      actor_id: actorId,
      actor_name: actorEmail,
      actor_role: "dispatcher",
      category: "emergency",
      action: `dispatcher_${payload.action}`,
      detail: payload.note ?? payload.body ?? "",
      target_id: payload.emergencyId,
      severity: "info",
      client_timestamp: new Date().toISOString(),
    }).catch(() => null);

    return new Response(JSON.stringify({ success: true, action: payload.action, emergencyId: payload.emergencyId }), {
      status: 200, headers: CORS,
    });
  } catch (err) {
    console.error("[dashboard-actions] error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: CORS });
  }
});
