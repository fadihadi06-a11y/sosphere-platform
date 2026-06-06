import { probeErrorResponse } from "../_shared/safe-error.ts";
// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — sos-dispatch-probe (R-4 — end-to-end SOS orchestration verify)
// ─────────────────────────────────────────────────────────────────────────
// THE GAP THIS CLOSES
//   We had three runtime probes pre-R-4:
//     • sos-inbound-probe  → verifies L2-F inbound-SMS reply pipeline
//     • twilio-config-probe → verifies Twilio webhook URL is form-B canonical
//     • forgery-probe (R-5) → verifies L5-SEC-1 actor-forgery defense
//
//   But there was NO continuous proof that the MAIN outbound path —
//   sos-alert trigger → sos_sessions UPSERT → fanout → dispatch_attempts
//   ledger → audit_log entry → end → audit_log ended — actually still
//   works end-to-end after a deploy. A subtle schema migration, a
//   broken RPC signature, or a regression in resolveTier could silently
//   break SOS for every paying tier and we'd only learn from a real
//   emergency that didn't dispatch.
//
// WHAT THIS PROBE DOES (in order)
//   1. Auth: PROBE_SECRET bearer (same pattern as other probes).
//   2. Ensure the probe user exists (reuse forgery-probe@sosphere.internal
//      so we don't accumulate auth.users rows). Refresh password each run
//      so the probe is idempotent.
//   3. Sign in via anon key → get a real authenticated JWT.
//   4. POST sos-alert?action=trigger with a synthetic body:
//        • contacts: [{ phone: "+10" }] — a deliberately-too-short E.164
//          string that normalizeE164 rejects. This means the fanout
//          records method:"invalid_number" for the result, dispatch_attempts
//          writes outcome:"invalid", and ZERO real Twilio calls or SMS
//          fire. Probe is cost-free.
//        • Idempotency-Key: unique per run.
//        • X-SOS-Trace-Id + body.traceId so the pipeline_metrics path
//          is also exercised.
//   5. Assert response: 200, success:true, results[0].method='invalid_number'.
//   6. Assert sos_sessions row: user_id pinned to probeUserId, status=
//      'active', server_triggered_at set, trace_id matches, server_results
//      array present.
//   7. Assert dispatch_attempts: at least one row exists for this
//      emergencyId with channel='sms' and outcome='invalid'.
//   8. Assert audit_log: a row exists with action='sos_triggered',
//      target=emergencyId, and trace_id matching.
//   9. POST sos-alert?action=end → assert status flips to 'ended'.
//  10. Assert audit_log gains a 'sos_ended' row for the same target.
//  11. Cleanup: DELETE the synthetic sos_sessions + dispatch_attempts
//      rows (audit_log stays intact — it's hash-chained and the rows
//      are clearly tagged by probe-prefixed emergencyId). Cleanup
//      failure does NOT fail the probe — the probe's job is to prove
//      orchestration works, not to leave a spotless DB.
//
// AUTH
//   Same PROBE_SECRET bearer pattern as twilio-config-probe + forgery-probe.
//
// REQUIRED SUPABASE SECRETS
//   PROBE_SECRET                (bearer-token auth on this endpoint)
//   SUPABASE_URL                (auto-set)
//   SUPABASE_ANON_KEY           (auto-set — for the probe-user sign-in)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-set — for admin user CRUD + readback)
//
// RATE LIMIT NOTE
//   sos-alert enforces per-tier SOS rate limits:
//     free:  1/h, 3/d   basic: 3/h, 15/d   elite: 5/h, 30/d
//   Cron cadence is therefore CAPPED to every 4h (= 6 runs/day) so the
//   probe stays well under the free-tier daily cap. If the rate limiter
//   ever returns 429, the probe surfaces it via a typed
//   stage:"rate_limited" result so the GHA workflow can distinguish
//   "real bug" from "we ran too soon after the last run".
//
// USAGE FROM A CRON JOB
//   curl -X POST https://<project>.functions.supabase.co/sos-dispatch-probe \
//     -H "Authorization: Bearer $PROBE_SECRET"
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// R-10 (2026-05-14): use a DEDICATED probe-user identity. Previously this
// probe shared "forgery-probe@sosphere.internal" with forgery-probe to avoid
// accumulating auth.users rows. But when workflow_dispatch fires both probes
// in parallel, they each call admin.updateUserById with a fresh random
// password before signing in — one probe's password write overwrites the
// other's, and the loser's sign-in fails with HTTP 500. Each probe now uses
// its own user so the password rotations don't collide.
const PROBE_USER_EMAIL = "sos-dispatch-probe@sosphere.internal";

/** Constant-time string compare for the bearer-token check. Mirrors the
 *  forgery-probe / twilio-config-probe helper so a future audit of
 *  PROBE_SECRET handling stays single-pattern. */
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
    console.error("[sos-dispatch-probe] PROBE_SECRET missing/short — fail closed");
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
  // 2026-06-06 R-4 hotfix (mirrors the R-5 forgery-probe hotfix):
  // bcrypt caps password length at 72 bytes and Supabase Auth enforces
  // that before hashing. The previous 2x randomUUID build was exactly
  // 72 (on the boundary) AND lacked the uppercase + symbol classes
  // the project's new password policy requires. One UUID (36 chars)
  // + "Aa1!" stuffer (4 chars) = 40 chars total - well under the cap,
  // covers all four classes: uppercase (A), lowercase (UUID),
  // digit (1 + UUID digits), symbol (! and UUID hyphens).
  const probePassword = "Aa1!" + crypto.randomUUID();

  // ── Stage 1: ensure probe user exists (idempotent) ──────────────────────
  let probeUserId: string;
  try {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) {
      // H (2026-05-27): err.message removed from response. Closes #578.
      console.error("[probe-error] list_users:", listErr);
      return jsonResponse({ pass: false, stage: "list_users", error: "list_users_failed" }, 500, corsHeaders);
    }
    const existing = list.users.find((u) => u.email === PROBE_USER_EMAIL);
    if (existing) {
      probeUserId = existing.id;
      const { error: updErr } = await admin.auth.admin.updateUserById(probeUserId, { password: probePassword });
      if (updErr) {
        console.error("[probe-error] update_user:", updErr);
        return jsonResponse({ pass: false, stage: "update_user", error: "update_user_failed" }, 500, corsHeaders);
      }
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: PROBE_USER_EMAIL,
        password: probePassword,
        email_confirm: true,
      });
      if (createErr || !created?.user) {
        console.error("[probe-error] create_user:", createErr);
        return jsonResponse({ pass: false, stage: "create_user", error: "create_user_failed" }, 500, corsHeaders);
      }
      probeUserId = created.user.id;
    }
  } catch (e) {
    return probeErrorResponse(e, 500, corsHeaders, "sos-dispatch-probe.ensure_user");
  }

  // ── Stage 2: sign in as probe user → get authenticated JWT ──────────────
  const userClient = createClient(supaUrl, anonKey, { auth: { persistSession: false } });
  const { data: session, error: signInErr } = await userClient.auth.signInWithPassword({
    email: PROBE_USER_EMAIL,
    password: probePassword,
  });
  if (signInErr || !session?.session) {
    console.error("[probe-error] sign_in:", signInErr);
    return jsonResponse({ pass: false, stage: "sign_in", error: "sign_in_failed" }, 500, corsHeaders);
  }
  const userJwt = session.session.access_token;

  // ── Stage 3: TRIGGER SOS via sos-alert ──────────────────────────────────
  // sos_sessions.id is a `uuid` column — must be a strict UUID. We can't
  // use a "probe-dispatch-*" prefix string. Probe rows are still distinct
  // from real incidents because they're all owned by the single probe
  // user (user_id = probeUserId), so dashboards filter by user_id (or
  // by trigger_source if set; we leave it default here).
  const emergencyId = crypto.randomUUID();
  const traceId = crypto.randomUUID();
  const idemKey = `probe:${emergencyId}`;
  const clientClaimedAt = new Date().toISOString();

  const triggerBody = {
    emergencyId,
    userId: probeUserId,
    userName: "SOS Dispatch Probe",
    userPhone: "+15555550199",
    contacts: [
      // Deliberately too-short E.164 — sos-alert's normalizeE164 returns
      // null for <8 digits, which makes fanout record method:"invalid_number"
      // and ZERO real Twilio API calls fire. This is the whole reason the
      // probe is cost-free and safe to run on a cron.
      { name: "Probe Synthetic Contact", phone: "+10", relation: "test" },
    ],
    location: { lat: 0, lng: 0, accuracy: 1, address: "Probe — null island" },
    silent: true,
    traceId,
    clientClaimedAt,
  };

  const triggerRes = await fetch(`${supaUrl}/functions/v1/sos-alert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userJwt}`,
      apikey: anonKey,
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey,
      "X-SOS-Trace-Id": traceId,
    },
    body: JSON.stringify(triggerBody),
    signal: AbortSignal.timeout(20000),
  });

  // Rate-limit response is a soft pass — surfaces "ran too soon" without
  // failing the cron, because the cause is cron cadence vs. tier cap, not
  // a regression. The GHA workflow can treat rate_limited as pass:true.
  if (triggerRes.status === 429) {
    const body = await triggerRes.json().catch(() => ({}));
    return jsonResponse({
      pass: true,
      rate_limited: true,
      stage: "trigger",
      note: "sos-alert returned 429 — probe ran inside the per-tier SOS rate-limit window. Not a regression.",
      detail: body,
    }, 200, corsHeaders);
  }
  if (!triggerRes.ok) {
    const body = await triggerRes.text().catch(() => "");
    return jsonResponse({
      pass: false,
      stage: "trigger",
      httpStatus: triggerRes.status,
      body: body.slice(0, 500),
      probeUserId,
      emergencyId,
    }, 500, corsHeaders);
  }
  const triggerJson = await triggerRes.json() as {
    success?: boolean;
    emergencyId?: string;
    tier?: string;
    results?: Array<{ method?: string; error?: string }>;
  };

  // ── Stage 4: wait briefly for the async dispatch_attempts ledger flush ──
  // The fanout writes sos_sessions inline but dispatch_attempts is fired
  // via `void (async () => …)()` so it lands ~50-200ms after the response.
  // Same pattern as forgery-probe's eventual-consistency wait.
  await new Promise((r) => setTimeout(r, 800));

  // ── Stage 5: read sos_sessions and assert ───────────────────────────────
  const { data: sessRow, error: sessErr } = await admin
    .from("sos_sessions")
    .select("id, user_id, status, server_triggered_at, trace_id, tier, server_results")
    .eq("id", emergencyId)
    .maybeSingle();
  if (sessErr || !sessRow) {
    if (sessErr) console.error("[probe-error] read_session:", sessErr);
    return jsonResponse({
      pass: false,
      stage: "read_session",
      error: sessErr ? "read_session_failed" : "no_row",
      probeUserId,
      emergencyId,
      triggerResponse: triggerJson,
    }, 500, corsHeaders);
  }

  // ── Stage 6: read dispatch_attempts ─────────────────────────────────────
  const { data: dispatchRows, error: dispatchErr } = await admin
    .from("sos_dispatch_attempts")
    .select("id, channel, outcome, contact_index, trace_id, contact_phone")
    .eq("emergency_id", emergencyId);
  if (dispatchErr) {
    console.error("[probe-error] read_dispatch_attempts:", dispatchErr);
    return jsonResponse({
      pass: false,
      stage: "read_dispatch_attempts",
      error: "read_dispatch_attempts_failed",
      probeUserId,
      emergencyId,
    }, 500, corsHeaders);
  }

  // ── Stage 7: read audit_log for sos_triggered ───────────────────────────
  const { data: triggerAuditRows, error: triggerAuditErr } = await admin
    .from("audit_log")
    .select("id, action, target, actor, trace_id, metadata")
    .eq("target", emergencyId)
    .eq("action", "sos_triggered")
    .order("created_at", { ascending: false })
    .limit(1);
  if (triggerAuditErr) {
    console.error("[probe-error] read_trigger_audit:", triggerAuditErr);
    return jsonResponse({
      pass: false,
      stage: "read_trigger_audit",
      error: "read_trigger_audit_failed",
      probeUserId,
      emergencyId,
    }, 500, corsHeaders);
  }
  const triggerAudit = triggerAuditRows?.[0] ?? null;

  // ── Stage 8: END SOS via sos-alert ──────────────────────────────────────
  const endRes = await fetch(`${supaUrl}/functions/v1/sos-alert?action=end`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userJwt}`,
      apikey: anonKey,
      "Content-Type": "application/json",
      "Idempotency-Key": `${idemKey}:end`,
      "X-SOS-Trace-Id": traceId,
    },
    body: JSON.stringify({
      emergencyId,
      reason: "probe_complete",
      recordingSec: 0,
      photos: 0,
      comment: "R-4 sos-dispatch-probe end-of-run",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!endRes.ok) {
    const body = await endRes.text().catch(() => "");
    return jsonResponse({
      pass: false,
      stage: "end",
      httpStatus: endRes.status,
      body: body.slice(0, 500),
      probeUserId,
      emergencyId,
    }, 500, corsHeaders);
  }

  await new Promise((r) => setTimeout(r, 400));

  // ── Stage 9: re-read sos_sessions to confirm ended ──────────────────────
  const { data: endedRow, error: endedErr } = await admin
    .from("sos_sessions")
    .select("id, status, ended_at, end_reason")
    .eq("id", emergencyId)
    .maybeSingle();
  if (endedErr || !endedRow) {
    if (endedErr) console.error("[probe-error] read_session_after_end:", endedErr);
    return jsonResponse({
      pass: false,
      stage: "read_session_after_end",
      error: endedErr ? "read_session_after_end_failed" : "no_row",
      probeUserId,
      emergencyId,
    }, 500, corsHeaders);
  }

  // ── Stage 10: read audit_log for sos_ended ──────────────────────────────
  const { data: endAuditRows, error: endAuditErr } = await admin
    .from("audit_log")
    .select("id, action, target, actor, trace_id, metadata")
    .eq("target", emergencyId)
    .eq("action", "sos_ended")
    .order("created_at", { ascending: false })
    .limit(1);
  if (endAuditErr) {
    console.error("[probe-error] read_end_audit:", endAuditErr);
    return jsonResponse({
      pass: false,
      stage: "read_end_audit",
      error: "read_end_audit_failed",
      probeUserId,
      emergencyId,
    }, 500, corsHeaders);
  }
  const endAudit = endAuditRows?.[0] ?? null;

  // ── Stage 11: assertions ─────────────────────────────────────────────────
  const smsInvalidRow = (dispatchRows ?? []).find(
    (r) => r.channel === "sms" && r.outcome === "invalid",
  );

  const asserts = {
    // Trigger HTTP response
    trigger_success_flag:               triggerJson.success === true,
    trigger_emergency_id_echoes:        triggerJson.emergencyId === emergencyId,
    trigger_has_results_array:          Array.isArray(triggerJson.results) && triggerJson.results.length === 1,
    trigger_result_is_invalid_number:   triggerJson.results?.[0]?.method === "invalid_number",
    // sos_sessions row state post-trigger
    session_row_exists:                 !!sessRow,
    session_user_pinned_to_probe:       sessRow.user_id === probeUserId,
    session_status_active:              sessRow.status === "active",
    session_server_triggered_at_set:    !!sessRow.server_triggered_at,
    session_trace_id_matches:           sessRow.trace_id === traceId,
    session_server_results_recorded:    Array.isArray(sessRow.server_results) && sessRow.server_results.length === 1,
    // dispatch_attempts ledger
    dispatch_sms_invalid_row_exists:    !!smsInvalidRow,
    dispatch_trace_id_threaded:         !!smsInvalidRow && smsInvalidRow.trace_id === traceId,
    // audit_log post-trigger
    trigger_audit_row_exists:           !!triggerAudit,
    trigger_audit_actor_is_probe:       triggerAudit?.actor === probeUserId,
    trigger_audit_trace_id_matches:     triggerAudit?.trace_id === traceId,
    // End state
    session_status_ended:               endedRow.status === "ended",
    session_ended_at_set:               !!endedRow.ended_at,
    session_end_reason_recorded:        endedRow.end_reason === "probe_complete",
    // audit_log post-end
    end_audit_row_exists:               !!endAudit,
    end_audit_trace_id_matches:         endAudit?.trace_id === traceId,
  };
  const pass = Object.values(asserts).every(Boolean);

  // ── Stage 12: cleanup (best-effort; never fails the probe) ──────────────
  // We leave audit_log rows intact (they're hash-chained and probe-tagged
  // by user_id = probeUserId). sos_sessions + dispatch_attempts get
  // cleaned up to keep the probe footprint small over time.
  const cleanup: Record<string, unknown> = {};
  try {
    const { error: delDispatchErr } = await admin
      .from("sos_dispatch_attempts").delete().eq("emergency_id", emergencyId);
    cleanup.dispatch_attempts_deleted = !delDispatchErr;
    if (delDispatchErr) {
      console.error("[probe-error] cleanup.dispatch_attempts:", delDispatchErr);
      cleanup.dispatch_attempts_error = "delete_failed";
    }
  } catch (e) {
    // H2 (2026-05-27): was `String(e).slice(0, 200)` which leaked stack
    // info into the response body. Log to console.error and return a
    // static marker so the operator knows an exception occurred but
    // CodeQL no longer flags the response as stack-trace-exposure.
    console.error("[probe-error] cleanup.dispatch_attempts.threw:", e);
    cleanup.dispatch_attempts_threw = "exception_thrown";
  }
  try {
    const { error: delSessErr } = await admin
      .from("sos_sessions").delete().eq("id", emergencyId);
    cleanup.session_deleted = !delSessErr;
    if (delSessErr) {
      console.error("[probe-error] cleanup.session:", delSessErr);
      cleanup.session_error = "delete_failed";
    }
  } catch (e) {
    // H2 (2026-05-27): same fix as dispatch_attempts_threw above.
    console.error("[probe-error] cleanup.session.threw:", e);
    cleanup.session_threw = "exception_thrown";
  }

  // ── Result ──────────────────────────────────────────────────────────────
  return jsonResponse({
    pass,
    probeUserId,
    emergencyId,
    traceId,
    tier: triggerJson.tier,
    triggerResult: triggerJson.results?.[0] ?? null,
    sessionAfterTrigger: {
      status: sessRow.status,
      server_triggered_at: sessRow.server_triggered_at,
      tier: sessRow.tier,
    },
    sessionAfterEnd: {
      status: endedRow.status,
      ended_at: endedRow.ended_at,
      end_reason: endedRow.end_reason,
    },
    dispatchAttemptsCount: dispatchRows?.length ?? 0,
    triggerAuditId: triggerAudit?.id ?? null,
    endAuditId:     endAudit?.id     ?? null,
    asserts,
    cleanup,
    generatedAt: new Date().toISOString(),
    note: pass
      ? "End-to-end SOS orchestration verified."
      : "FAIL — at least one end-to-end SOS orchestration assertion failed. See asserts{} for the specific gap.",
  }, pass ? 200 : 500, corsHeaders);
});
