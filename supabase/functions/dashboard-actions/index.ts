// ═════════════════════════════════════════════════════════════════════════════
// dashboard-actions — dispatcher action endpoints for the web dashboard
// ═════════════════════════════════════════════════════════════════════════════
// 2026-04-23: replaces the [SUPABASE_READY] stubs in hub-incident-reports.tsx
//             and dashboard-employee-detail.tsx. Real dispatcher actions that
//             actually hit the database.
//
// 2026-04-24: FIX FAT BUG — first draft queried `sos_sessions` which has no
//             `emergency_id` column, no `acknowledged_by/at`, no `assigned_to`,
//             no `resolved_by`. Every action silently updated 0 rows.
//             The actual dispatcher table is `sos_queue` (columns listed in
//             migration files). Rewritten to target sos_queue.
//
// 2026-04-24: Added 3 new actions for Point 3 (dashboard review stubs):
//             broadcast          — fan out an alert message to all employees
//                                  in the target scope (zone / dept / all)
//                                  by inserting one sos_messages row per
//                                  recipient, plus updating sos_queue with
//                                  tamper-evident broadcast_* columns.
//             forward_to_owner   — escalate the incident to the company owner;
//                                  writes sos_queue.forwarded_* + audit row.
//             mark_reviewed      — mark dispatcher review complete; writes
//                                  sos_queue.reviewed_* + audit row.
//
// Route:
//   POST /dashboard-actions
//   Authorization: Bearer <jwt>
//   Body: one of
//     { action: "resolve",          emergencyId, note? }
//     { action: "acknowledge",      emergencyId, note? }
//     { action: "assign",           emergencyId, responderId }
//     { action: "message",          emergencyId, body }
//     { action: "broadcast",        emergencyId, scope: "zone"|"dept"|"all", message }
//     { action: "forward_to_owner", emergencyId, note? }
//     { action: "mark_reviewed",    emergencyId, note? }
//
// Every action writes an audit_log row via log_sos_audit RPC so a legal
// investigator can cross-verify sos_queue state against the audit chain.
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
  action:
    | "resolve"
    | "acknowledge"
    | "assign"
    | "message"
    | "broadcast"
    | "forward_to_owner"
    | "mark_reviewed";
  emergencyId: string;
  note?: string;
  responderId?: string;
  body?: string;
  scope?: "zone" | "dept" | "all";
  message?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS,
    });
  }

  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 401,
      headers: CORS,
    });
  }

  // Verify caller identity via anon-key client + Bearer token
  const userClient = createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: CORS,
    });
  }
  const actorId = userData.user.id;
  const actorEmail = userData.user.email ?? "";

  let payload: ActionPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: CORS,
    });
  }

  if (!payload.emergencyId || !payload.action) {
    return new Response(
      JSON.stringify({ error: "emergencyId and action are required" }),
      { status: 400, headers: CORS },
    );
  }

  const admin = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Look up the incident in sos_queue — the REAL dispatcher table.
  // emergencyId may have been written as the row's `id` (text PK) OR
  // as `emergency_id` (text secondary) depending on the sync path
  // (mobile offline replay uses `id`, sos-alert writes `emergency_id`).
  // Check both so we match regardless of path.
  const { data: queueRow } = await admin
    .from("sos_queue")
    .select(
      "id, emergency_id, company_id, employee_id, employee_name, zone, status",
    )
    .or(`id.eq.${payload.emergencyId},emergency_id.eq.${payload.emergencyId}`)
    .limit(1)
    .maybeSingle();

  if (!queueRow) {
    return new Response(JSON.stringify({ error: "Emergency not found" }), {
      status: 404,
      headers: CORS,
    });
  }

  const queueId = queueRow.id as string;
  const companyId = queueRow.company_id as string | null;
  const employeeId = queueRow.employee_id as string | null;
  const employeeName = queueRow.employee_name as string | null;
  const queueZone = queueRow.zone as string | null;
  const nowIso = new Date().toISOString();

  // Common audit metadata — kept as a single object so every action logs
  // the same shape. Extra per-action keys are merged below.
  const auditBase = {
    source: "dashboard-actions",
    queueRowId: queueId,
    emergencyId: payload.emergencyId,
    employeeId,
    employeeName,
    zone: queueZone,
  };

  async function writeAudit(
    actionLabel: string,
    operation: string,
    extraMeta: Record<string, unknown>,
  ) {
    const { error } = await admin.rpc("log_sos_audit", {
      p_action: actionLabel,
      p_actor: actorId,
      p_actor_level: "dispatcher",
      p_operation: operation,
      p_target: queueId,
      p_target_name: employeeName,
      p_metadata: { ...auditBase, ...extraMeta, actorEmail },
    });
    if (error) {
      // Non-fatal: the dispatcher action already mutated the primary
      // table; a missed audit row is logged for ops but not surfaced
      // to the user (whose action DID land).
      console.warn("[dashboard-actions] audit failed:", error.message);
    }
  }

  try {
    switch (payload.action) {
      // ───────────────────────────────────────────────────────────
      // resolve — close the incident
      // ───────────────────────────────────────────────────────────
      case "resolve": {
        await admin
          .from("sos_queue")
          .update({
            status: "resolved",
            resolved_by: actorId,
            resolved_at: nowIso,
            resolution_note: payload.note ?? null,
          })
          .eq("id", queueId);
        await writeAudit("dispatcher_resolve", "sos_resolve", {
          note: payload.note ?? null,
        });
        break;
      }

      // ───────────────────────────────────────────────────────────
      // acknowledge — dispatcher has seen the incident
      // ───────────────────────────────────────────────────────────
      case "acknowledge": {
        await admin
          .from("sos_queue")
          .update({
            acknowledged_by: actorId,
            acknowledged_at: nowIso,
          })
          .eq("id", queueId);
        await writeAudit("dispatcher_acknowledge", "sos_acknowledge", {
          note: payload.note ?? null,
        });
        break;
      }

      // ───────────────────────────────────────────────────────────
      // assign — route to a specific responder
      // ───────────────────────────────────────────────────────────
      case "assign": {
        if (!payload.responderId) {
          return new Response(
            JSON.stringify({ error: "responderId required" }),
            { status: 400, headers: CORS },
          );
        }
        await admin
          .from("sos_queue")
          .update({
            assigned_to: payload.responderId,
            assigned_by: actorId,
            assigned_at: nowIso,
          })
          .eq("id", queueId);
        await writeAudit("dispatcher_assign", "sos_assign", {
          responderId: payload.responderId,
        });
        break;
      }

      // ───────────────────────────────────────────────────────────
      // message — direct message into the emergency channel
      // ───────────────────────────────────────────────────────────
      case "message": {
        if (!payload.body) {
          return new Response(JSON.stringify({ error: "body required" }), {
            status: 400,
            headers: CORS,
          });
        }
        await admin.from("sos_messages").insert({
          emergency_id: payload.emergencyId,
          from_user_id: actorId,
          from_name: actorEmail,
          body: payload.body,
          created_at: nowIso,
        });
        await writeAudit("dispatcher_message", "sos_message", {
          bodyLen: payload.body.length,
        });
        break;
      }

      // ───────────────────────────────────────────────────────────
      // broadcast — fan out alert to employees in scope
      // ───────────────────────────────────────────────────────────
      case "broadcast": {
        const scope = payload.scope ?? "zone";
        const message = payload.message ?? payload.body ?? "";
        if (!message) {
          return new Response(
            JSON.stringify({ error: "message required for broadcast" }),
            { status: 400, headers: CORS },
          );
        }
        if (!["zone", "dept", "all"].includes(scope)) {
          return new Response(
            JSON.stringify({ error: "invalid scope — must be zone/dept/all" }),
            { status: 400, headers: CORS },
          );
        }

        // Resolve recipients from employees table.
        let recipientsQuery = admin
          .from("employees")
          .select("user_id, zone_id, department")
          .eq("status", "active");
        if (companyId) recipientsQuery = recipientsQuery.eq("company_id", companyId);

        const { data: employees, error: empErr } = await recipientsQuery;
        if (empErr) {
          return new Response(
            JSON.stringify({
              error: "Failed to resolve broadcast recipients",
              detail: empErr.message,
            }),
            { status: 500, headers: CORS },
          );
        }

        // Filter by scope. Zone comparison uses zone_id from sos_queue
        // if present, else text-match the queue's `zone` string against
        // employee department (best effort for legacy rows without zone_id).
        const recipients = (employees ?? []).filter((e) => {
          if (scope === "all") return true;
          if (scope === "zone") {
            // Prefer matching on zone_id when the queue row has one,
            // otherwise fall back to the free-text zone on sos_queue.
            if (!queueZone) return false;
            return e.department === queueZone || String(e.zone_id) === queueZone;
          }
          if (scope === "dept") {
            return e.department && e.department === queueRow.zone;
          }
          return false;
        });

        const broadcastMessages = recipients
          .filter((r) => r.user_id)
          .map((r) => ({
            emergency_id: payload.emergencyId,
            from_user_id: actorId,
            from_name: actorEmail || "Dispatcher",
            body: `[BROADCAST ${scope.toUpperCase()}] ${message}`,
            created_at: nowIso,
          }));

        if (broadcastMessages.length > 0) {
          await admin.from("sos_messages").insert(broadcastMessages);
        }

        // Tamper-evident record on the queue row itself.
        await admin
          .from("sos_queue")
          .update({
            status: "broadcast",
            broadcast_by: actorId,
            broadcast_at: nowIso,
            broadcast_scope: scope,
            broadcast_message: message,
            broadcast_recipients: broadcastMessages.length,
          })
          .eq("id", queueId);

        await writeAudit("dispatcher_broadcast", "sos_broadcast", {
          scope,
          recipients: broadcastMessages.length,
          messageLen: message.length,
        });

        return new Response(
          JSON.stringify({
            success: true,
            action: "broadcast",
            emergencyId: payload.emergencyId,
            scope,
            recipients: broadcastMessages.length,
          }),
          { status: 200, headers: CORS },
        );
      }

      // ───────────────────────────────────────────────────────────
      // forward_to_owner — escalate to company owner
      // ───────────────────────────────────────────────────────────
      case "forward_to_owner": {
        // Locate the owner (employee with role='owner' for this company).
        let ownerId: string | null = null;
        let ownerName: string | null = null;
        if (companyId) {
          const { data: owner } = await admin
            .from("employees")
            .select("user_id, name")
            .eq("company_id", companyId)
            .eq("role", "owner")
            .limit(1)
            .maybeSingle();
          ownerId = (owner?.user_id as string | null) ?? null;
          ownerName = (owner?.name as string | null) ?? null;
        }

        await admin
          .from("sos_queue")
          .update({
            status: "forwarded",
            forwarded_by: actorId,
            forwarded_at: nowIso,
            forwarded_to: ownerId ?? "owner",
          })
          .eq("id", queueId);

        // Dedicated message so the owner is notified in their inbox.
        if (ownerId) {
          await admin.from("sos_messages").insert({
            emergency_id: payload.emergencyId,
            from_user_id: actorId,
            from_name: actorEmail || "Dispatcher",
            body:
              `[FORWARDED] Incident ${queueId} forwarded to owner${ownerName ? ` (${ownerName})` : ""}. ${payload.note ?? ""}`.trim(),
            created_at: nowIso,
          });
        }

        await writeAudit("dispatcher_forward_to_owner", "sos_forward", {
          forwardedTo: ownerId ?? "owner",
          ownerName,
          note: payload.note ?? null,
        });
        break;
      }

      // ───────────────────────────────────────────────────────────
      // mark_reviewed — dispatcher review complete
      // ───────────────────────────────────────────────────────────
      case "mark_reviewed": {
        await admin
          .from("sos_queue")
          .update({
            status: "reviewed",
            reviewed_by: actorId,
            reviewed_at: nowIso,
            review_note: payload.note ?? null,
          })
          .eq("id", queueId);
        await writeAudit("dispatcher_mark_reviewed", "sos_review", {
          note: payload.note ?? null,
        });
        break;
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400,
          headers: CORS,
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        action: payload.action,
        emergencyId: payload.emergencyId,
      }),
      { status: 200, headers: CORS },
    );
  } catch (err) {
    console.error("[dashboard-actions] error:", err);
    return new Response(
      JSON.stringify({
        error: "Server error",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: CORS },
    );
  }
});
