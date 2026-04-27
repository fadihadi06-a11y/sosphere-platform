// ═══════════════════════════════════════════════════════════════════════════
// dashboard-actions — dispatcher action endpoints
//   B-01 (2026-04-25): validates emergencyId format + scopes by company_id
//                      (cross-tenant guesses now return 404).
//   G-20 (B-20, 2026-04-26): replaces wildcard CORS with origin allowlist —
//                      mirrors the buildCorsHeaders pattern used by every
//                      other edge function. A malicious page that exfiltrates
//                      a JWT via XSS can no longer call delete/resolve cross-
//                      origin and have the browser deliver the response.
//   G-30 (B-20, 2026-04-26): 500 response no longer includes raw err.message;
//                      schema/table names stay out of the public response.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

// G-20: origin allowlist — same pattern as twilio-call, stripe-checkout, sos-alert.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",").map(s => s.trim()).filter(Boolean);
function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}
function buildCors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

type ActionPayload = {
  action:
    | "resolve" | "acknowledge" | "assign" | "message"
    | "broadcast" | "forward_to_owner" | "mark_reviewed";
  emergencyId: string;
  note?: string;
  responderId?: string;
  body?: string;
  scope?: "zone" | "dept" | "all";
  message?: string;
};

Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Missing token" }), { status: 401, headers: CORS });
  }

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
  try { payload = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: CORS });
  }
  if (!payload.emergencyId || !payload.action) {
    return new Response(JSON.stringify({ error: "emergencyId and action are required" }), { status: 400, headers: CORS });
  }

  // B-01: block OR-injection by validating id format.
  if (!/^[A-Za-z0-9_-]+$/.test(payload.emergencyId)) {
    return new Response(JSON.stringify({ error: "Invalid emergencyId format" }), { status: 400, headers: CORS });
  }

  const admin = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve caller company.
  let callerCompanyId: string | null = null;
  try {
    const { data: cc } = await userClient.rpc("current_company_id");
    if (typeof cc === "string" && cc.length > 0) callerCompanyId = cc;
  } catch (e) {
    console.warn("[dashboard-actions] current_company_id rpc failed:", e);
  }
  if (!callerCompanyId) {
    const { data: ownedCo } = await admin
      .from("companies").select("id").eq("owner_id", actorId).limit(1).maybeSingle();
    if (ownedCo?.id) callerCompanyId = ownedCo.id as string;
  }
  if (!callerCompanyId) {
    return new Response(JSON.stringify({ error: "Caller is not a member of any company" }), { status: 403, headers: CORS });
  }

  // Look up incident scoped by company_id (B-01 critical fix).
  const { data: queueRow } = await admin
    .from("sos_queue")
    .select("id, emergency_id, company_id, employee_id, employee_name, zone, status")
    .eq("company_id", callerCompanyId)
    .or(`id.eq.${payload.emergencyId},emergency_id.eq.${payload.emergencyId}`)
    .limit(1).maybeSingle();

  if (!queueRow) {
    return new Response(JSON.stringify({ error: "Emergency not found" }), { status: 404, headers: CORS });
  }

  const queueId = queueRow.id as string;
  const companyId = queueRow.company_id as string | null;
  const employeeId = queueRow.employee_id as string | null;
  const employeeName = queueRow.employee_name as string | null;
  const queueZone = queueRow.zone as string | null;
  const nowIso = new Date().toISOString();

  const auditBase = {
    source: "dashboard-actions",
    queueRowId: queueId,
    emergencyId: payload.emergencyId,
    employeeId, employeeName,
    zone: queueZone,
  };

  async function writeAudit(actionLabel: string, operation: string, extraMeta: Record<string, unknown>) {
    const { error } = await admin.rpc("log_sos_audit", {
      p_action: actionLabel,
      p_actor: actorId,
      p_actor_level: "dispatcher",
      p_operation: operation,
      p_target: queueId,
      p_target_name: employeeName,
      p_metadata: { ...auditBase, ...extraMeta, actorEmail },
    });
    if (error) console.warn("[dashboard-actions] audit failed:", error.message);
  }

  try {
    switch (payload.action) {
      case "resolve": {
        await admin.from("sos_queue").update({
          status: "resolved", resolved_by: actorId, resolved_at: nowIso,
          resolution_note: payload.note ?? null,
        }).eq("id", queueId);
        await writeAudit("dispatcher_resolve", "sos_resolve", { note: payload.note ?? null });
        break;
      }
      case "acknowledge": {
        await admin.from("sos_queue").update({
          acknowledged_by: actorId, acknowledged_at: nowIso,
        }).eq("id", queueId);
        await writeAudit("dispatcher_acknowledge", "sos_acknowledge", { note: payload.note ?? null });
        break;
      }
      case "assign": {
        if (!payload.responderId) {
          return new Response(JSON.stringify({ error: "responderId required" }), { status: 400, headers: CORS });
        }
        // CRIT-#4 (2026-04-27): cross-company assignment was previously
        // possible — caller could pass a responderId belonging to
        // company B while operating on company A's incident. Now we
        // verify the responder is an active employee of the SAME
        // company that owns the incident (resolved above as companyId).
        if (!companyId) {
          return new Response(JSON.stringify({ error: "incident has no company; cannot assign" }), { status: 400, headers: CORS });
        }
        const { data: respCheck, error: respErr } = await admin
          .from("employees")
          .select("user_id, company_id, status")
          .eq("user_id", payload.responderId)
          .eq("company_id", companyId)
          .eq("status", "active")
          .maybeSingle();
        if (respErr || !respCheck) {
          return new Response(JSON.stringify({ error: "responderId is not an active employee of this company" }), { status: 403, headers: CORS });
        }
        await admin.from("sos_queue").update({
          assigned_to: payload.responderId,
          assigned_by: actorId, assigned_at: nowIso,
        }).eq("id", queueId);
        await writeAudit("dispatcher_assign", "sos_assign", { responderId: payload.responderId });
        break;
      }
      case "message": {
        if (!payload.body) {
          return new Response(JSON.stringify({ error: "body required" }), { status: 400, headers: CORS });
        }
        await admin.from("sos_messages").insert({
          emergency_id: payload.emergencyId,
          from_user_id: actorId, from_name: actorEmail,
          body: payload.body, created_at: nowIso,
        });
        await writeAudit("dispatcher_message", "sos_message", { bodyLen: payload.body.length });
        break;
      }
      case "broadcast": {
        const scope = payload.scope ?? "zone";
        const message = payload.message ?? payload.body ?? "";
        // CRIT-#5 (2026-04-27): resolve the SOS owner's department once
        // up-front so scope="dept" can target the correct employee
        // group. employee_id on sos_queue is nullable — degrade to
        // empty array of recipients if missing.
        let queueOwnerDept: string | null = null;
        if (queueRow?.employee_id) {
          const { data: ownerEmp } = await admin.from("employees")
            .select("department").eq("user_id", queueRow.employee_id)
            .maybeSingle();
          queueOwnerDept = (ownerEmp?.department as string | null) ?? null;
        }
        if (!message) {
          return new Response(JSON.stringify({ error: "message required for broadcast" }), { status: 400, headers: CORS });
        }
        if (!(["zone", "dept", "all"]).includes(scope)) {
          return new Response(JSON.stringify({ error: "invalid scope - must be zone/dept/all" }), { status: 400, headers: CORS });
        }
        let recipientsQuery = admin.from("employees")
          .select("user_id, zone_id, department").eq("status", "active");
        if (companyId) recipientsQuery = recipientsQuery.eq("company_id", companyId);
        const { data: employees, error: empErr } = await recipientsQuery;
        if (empErr) {
          // G-30: do not leak DB error text in response.
          console.error("[dashboard-actions] resolve recipients failed:", empErr);
          return new Response(JSON.stringify({ error: "Failed to resolve broadcast recipients" }), { status: 500, headers: CORS });
        }
        const recipients = (employees ?? []).filter((e) => {
          if (scope === "all") return true;
          if (scope === "zone") {
            if (!queueZone) return false;
            return e.department === queueZone || String(e.zone_id) === queueZone;
          }
          if (scope === "dept") {
            // CRIT-#5 (2026-04-27): previously compared e.department to
            // queueRow.zone (always false unless dept names match zone
            // names). The correct join is the SOS-owner's department,
            // resolved earlier as queueOwnerDept.
            return e.department && queueOwnerDept && e.department === queueOwnerDept;
          }
          return false;
        });
        const broadcastMessages = recipients.filter((r) => r.user_id).map((r) => ({
          emergency_id: payload.emergencyId,
          from_user_id: actorId,
          from_name: actorEmail || "Dispatcher",
          body: `[BROADCAST ${scope.toUpperCase()}] ${message}`,
          created_at: nowIso,
        }));
        if (broadcastMessages.length > 0) {
          await admin.from("sos_messages").insert(broadcastMessages);
        }
        await admin.from("sos_queue").update({
          status: "broadcast",
          broadcast_by: actorId, broadcast_at: nowIso,
          broadcast_scope: scope, broadcast_message: message,
          broadcast_recipients: broadcastMessages.length,
        }).eq("id", queueId);
        await writeAudit("dispatcher_broadcast", "sos_broadcast", {
          scope, recipients: broadcastMessages.length, messageLen: message.length,
        });
        return new Response(JSON.stringify({
          success: true, action: "broadcast",
          emergencyId: payload.emergencyId,
          scope, recipients: broadcastMessages.length,
        }), { status: 200, headers: CORS });
      }
      case "forward_to_owner": {
        // CRIT-#6 (2026-04-27): previously queried employees for
        // role='owner' — fragile because: (a) employee row may be
        // inactive/deleted, (b) employee.role isn't authoritative —
        // companies.owner_id IS. Now we go directly to the canonical
        // source. Owner name fetched from profiles for display.
        let ownerId: string | null = null;
        let ownerName: string | null = null;
        if (companyId) {
          const { data: company } = await admin.from("companies")
            .select("owner_id").eq("id", companyId).maybeSingle();
          ownerId = (company?.owner_id as string | null) ?? null;
          if (ownerId) {
            const { data: prof } = await admin.from("profiles")
              .select("full_name").eq("id", ownerId).maybeSingle();
            ownerName = (prof?.full_name as string | null) ?? null;
          }
        }
        await admin.from("sos_queue").update({
          status: "forwarded",
          forwarded_by: actorId, forwarded_at: nowIso,
          forwarded_to: ownerId ?? "owner",
        }).eq("id", queueId);
        if (ownerId) {
          await admin.from("sos_messages").insert({
            emergency_id: payload.emergencyId,
            from_user_id: actorId,
            from_name: actorEmail || "Dispatcher",
            body: `[FORWARDED] Incident ${queueId} forwarded to owner${ownerName ? ` (${ownerName})` : ""}. ${payload.note ?? ""}`.trim(),
            created_at: nowIso,
          });
        }
        await writeAudit("dispatcher_forward_to_owner", "sos_forward", {
          forwardedTo: ownerId ?? "owner", ownerName, note: payload.note ?? null,
        });
        break;
      }
      case "mark_reviewed": {
        await admin.from("sos_queue").update({
          status: "reviewed",
          reviewed_by: actorId, reviewed_at: nowIso,
          review_note: payload.note ?? null,
        }).eq("id", queueId);
        await writeAudit("dispatcher_mark_reviewed", "sos_review", { note: payload.note ?? null });
        break;
      }
      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: CORS });
    }
    return new Response(JSON.stringify({
      success: true, action: payload.action, emergencyId: payload.emergencyId,
    }), { status: 200, headers: CORS });
  } catch (err) {
    // G-30 (B-20): log full error server-side, return generic message client-side.
    console.error("[dashboard-actions] error:", err);
    return new Response(JSON.stringify({ error: "Server error" }),
      { status: 500, headers: CORS });
  }
});
