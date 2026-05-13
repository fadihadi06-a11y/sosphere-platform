// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — forgery-probe (R-5 — runtime PoC for L5-SEC-1)
// ─────────────────────────────────────────────────────────────────────────
// THE GAP THIS CLOSES
//   L5-SEC-1 (2026-05-12) closed the audit-actor-forgery vulnerability:
//   the log_sos_audit RPC now overrides p_actor with auth.uid() for any
//   authenticated caller. The contract tests verify this AT THE SOURCE
//   LEVEL (regex over the migration SQL). The DB smoke tests verified
//   it for the postgres / service_role / anon paths.
//
//   But the actual THREAT SCENARIO — an authenticated user posting via
//   PostgREST with a forged p_actor — was never exercised at runtime.
//   The DO-block simulations inside MCP execute_sql have session_user
//   = 'postgres' which trips the superuser_override branch BEFORE the
//   auth_uid pin. So those tests cover postgres, not the real
//   authenticator + auth.uid context that prod attackers hit.
//
// WHAT THIS PROBE DOES
//   1. Ensures a designated probe user exists (creates if missing via
//      admin.createUser; refreshes password each run via
//      admin.updateUserById so the probe is idempotent).
//   2. Signs in as the probe user (anon client + signInWithPassword) to
//      get a REAL authenticated JWT.
//   3. POSTs to PostgREST rpc/log_sos_audit using THAT JWT, with a
//      DELIBERATELY FORGED p_actor (a fixed dead-beef UUID).
//   4. Reads the row back via the service-role admin client and asserts:
//        • row.actor === probeUserId          (auth.uid() override worked)
//        • row.actor !== forgedUserId         (forgery rejected)
//        • metadata.actor_id_source === 'auth_uid'        (path proven)
//        • metadata.actor_id_claim_overridden === forgedUserId (recorded)
//   5. Returns a structured pass/fail report. Leaves the audit row in
//      place — it IS the forensic record proving the defense fired.
//
// AUTH
//   Same PROBE_SECRET bearer pattern as twilio-config-probe + sos-inbound-probe.
//
// REQUIRED SUPABASE SECRETS
//   PROBE_SECRET                (bearer-token auth on this endpoint)
//   SUPABASE_URL                (auto-set)
//   SUPABASE_ANON_KEY           (auto-set — for the probe-user sign-in)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-set — for admin user CRUD + readback)
//
// USAGE FROM A CRON JOB
//   curl -X POST https://<project>.functions.supabase.co/forgery-probe \
//     -H "Authorization: Bearer $PROBE_SECRET"
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Fixed identity for the probe row. Real Twilio MessageSids are SM-prefixed;
 * audit_log actions are plain text. Using a stable prefix lets the cleanup +
 * dashboard filtering ignore probe rows cleanly. */
const PROBE_USER_EMAIL = "forgery-probe@sosphere.internal";
/** The forged actor we attempt to inject — a deliberately-named UUID so
 * forensic readers can recognize it instantly. */
const FORGED_USER_ID = "00000000-dead-beef-0000-000000000000";

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonResponse(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);
  }

  // ── Auth: PROBE_SECRET bearer (fail-closed) ─────────────────────────────
  const probeSecret = Deno.env.get("PROBE_SECRET");
  if (!probeSecret || probeSecret.length < 16) {
    console.error("[forgery-probe] PROBE_SECRET missing/short — fail closed");
    return jsonResponse({ error: "probe_misconfigured" }, 500, corsHeaders);
  }
  const authHeader = req.headers.get("Authorization") || "";
  if (!constantTimeEquals(authHeader, `Bearer ${probeSecret}`)) {
    return jsonResponse({ error: "unauthorized" }, 401, corsHeaders);
  }

  // ── Required env ────────────────────────────────────────────────────────
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: "env_missing" }, 500, corsHeaders);
  }

  const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  const probePassword = crypto.randomUUID() + crypto.randomUUID(); // 72 chars, ASCII

  // ── Stage 1: ensure probe user exists (idempotent) ──────────────────────
  let probeUserId: string;
  try {
    // List users + filter — admin.listUsers paginates; for a small project
    // page 1 (1000 users) covers it. Real prod would use admin.getUserByEmail
    // (added in supabase-js v2.27+).
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) return jsonResponse({ pass: false, stage: "list_users", error: listErr.message }, 500, corsHeaders);
    const existing = list.users.find((u) => u.email === PROBE_USER_EMAIL);
    if (existing) {
      probeUserId = existing.id;
      const { error: updErr } = await admin.auth.admin.updateUserById(probeUserId, { password: probePassword });
      if (updErr) return jsonResponse({ pass: false, stage: "update_user", error: updErr.message }, 500, corsHeaders);
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: PROBE_USER_EMAIL,
        password: probePassword,
        email_confirm: true,
      });
      if (createErr || !created?.user) {
        return jsonResponse({ pass: false, stage: "create_user", error: createErr?.message }, 500, corsHeaders);
      }
      probeUserId = created.user.id;
    }
  } catch (e) {
    return jsonResponse({ pass: false, stage: "ensure_user_threw", error: String(e).slice(0, 200) }, 500, corsHeaders);
  }

  // ── Stage 2: sign in as probe user → get authenticated JWT ──────────────
  const userClient = createClient(supaUrl, anonKey, { auth: { persistSession: false } });
  const { data: session, error: signInErr } = await userClient.auth.signInWithPassword({
    email: PROBE_USER_EMAIL,
    password: probePassword,
  });
  if (signInErr || !session?.session) {
    return jsonResponse({ pass: false, stage: "sign_in", error: signInErr?.message }, 500, corsHeaders);
  }
  const userJwt = session.session.access_token;

  // ── Stage 3: forgery attempt — call log_sos_audit with the user JWT + forged p_actor
  const action = `forgery_probe_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const rpcRes = await fetch(`${supaUrl}/rest/v1/rpc/log_sos_audit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userJwt}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_action: action,
      p_actor: FORGED_USER_ID,         // ← THE FORGERY: client claims to be someone else
      p_actor_level: "admin",          // ← Also tries to claim admin role
      p_operation: "security_test",
      p_metadata: { reason: "R-5 forgery PoC — should be overridden by L5-SEC-1 fix" },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!rpcRes.ok) {
    const body = await rpcRes.text().catch(() => "");
    return jsonResponse({
      pass: false,
      stage: "rpc_call",
      httpStatus: rpcRes.status,
      body: body.slice(0, 500),
      probeUserId,
    }, 200, corsHeaders);
  }

  // ── Stage 4: read the row back via service-role + assert defense fired ──
  // Small wait for write visibility (eventual consistency on replicas)
  await new Promise((r) => setTimeout(r, 300));
  const { data: rows, error: readErr } = await admin
    .from("audit_log")
    .select("id, actor, actor_role, metadata")
    .eq("action", action)
    .order("created_at", { ascending: false })
    .limit(1);
  if (readErr || !rows || rows.length === 0) {
    return jsonResponse({
      pass: false,
      stage: "row_missing",
      error: readErr?.message,
      probeUserId,
      action,
    }, 200, corsHeaders);
  }
  const row = rows[0] as { id: string; actor: string; actor_role: string; metadata: Record<string, unknown> };

  // ── Stage 5: assertions ─────────────────────────────────────────────────
  const asserts = {
    actor_pinned_to_auth_uid:        row.actor === probeUserId,
    actor_is_not_forged:             row.actor !== FORGED_USER_ID,
    metadata_source_is_auth_uid:     (row.metadata?.actor_id_source as string) === "auth_uid",
    metadata_records_forgery_claim:  (row.metadata?.actor_id_claim_overridden as string) === FORGED_USER_ID,
  };
  const pass = Object.values(asserts).every(Boolean);

  // ── Result ──────────────────────────────────────────────────────────────
  return jsonResponse({
    pass,
    probeUserId,
    forgedUserId: FORGED_USER_ID,
    action,
    auditRowId: row.id,
    rowActor: row.actor,
    rowActorRole: row.actor_role,
    metadata: row.metadata,
    asserts,
    generatedAt: new Date().toISOString(),
    note: pass
      ? "L5-SEC-1 defense fired: forged p_actor was overridden with auth.uid() and the attempted claim was recorded in metadata.actor_id_claim_overridden."
      : "FAIL — L5-SEC-1 actor-forgery defense did NOT fire. Investigate immediately.",
  }, pass ? 200 : 500, corsHeaders);
});
