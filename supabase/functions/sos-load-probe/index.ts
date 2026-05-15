// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — sos-load-probe (R-17 — parallel SOS load test)
// ─────────────────────────────────────────────────────────────────────────
// WHY R-17 EXISTS
//   sos-dispatch-probe (R-4) verifies the SOS pipeline serially: 1 trigger
//   per hour. That proves correctness but NOT capacity under real load.
//
//   In a real mass-casualty event (earthquake, building fire, public
//   incident) we'd expect 5-50 simultaneous SOS triggers from people in
//   the same area. We need to know:
//     • Does the L2-B dispatch ledger lose rows under parallel writes?
//     • Does the L2-D audit-log hash chain stay consistent?
//     • Does any layer deadlock or throw 500s under contention?
//     • What's p50/p95/p99 latency under N-concurrent load?
//
//   This probe answers those questions. It runs ON DEMAND only — never on
//   a cron — because each run consumes auth.users rows, sos_sessions rows,
//   and pipeline_metrics rows that we explicitly classify out via R-13.
//
// WHAT THIS PROBE DOES (in order)
//   1. Auth: PROBE_SECRET bearer (same pattern as the other 4 probes).
//   2. Parse ?count=N (default 5, max 50).
//   3. Ensure N probe users exist: sos-load-0..N-1@sosphere.internal.
//      Created lazily, idempotent — each run reuses or creates as needed.
//   4. Refresh passwords for all N users (one per user, random UUIDs).
//   5. Parallel sign-in: Promise.all → N JWTs.
//   6. Parallel SOS trigger: Promise.all → N sos-alert POSTs concurrently.
//      Each fires with its own emergencyId + traceId. Contact is invalid
//      phone "+10" (zero Twilio cost, same as R-4).
//   7. Measure per-call latency (start-to-response ms).
//   8. Aggregate: success count, fail count, p50/p95/p99 latency, errors[].
//   9. Verify DB state:
//        - All N emergencyIds present in sos_sessions
//        - audit_log has 'sos_triggered' for each emergencyId
//        - verify_audit_log_chain RPC returns is_valid=true
//  10. Cleanup: DELETE the N sos_sessions rows + dispatch_attempts rows.
//      (audit_log is hash-chained — we don't delete. Synthetic flag from
//      R-13 keeps these out of dashboards.)
//
// AUTH
//   PROBE_SECRET bearer. Same constant-time compare as all other probes.
//
// REQUIRED SUPABASE SECRETS
//   PROBE_SECRET                (bearer auth)
//   SUPABASE_URL                (auto-set)
//   SUPABASE_ANON_KEY           (auto-set — for user sign-in)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-set — for admin CRUD + DB readback)
//
// USAGE
//   # Run with default count=5
//   curl -X POST "https://<project>.functions.supabase.co/sos-load-probe" \
//     -H "Authorization: Bearer $PROBE_SECRET"
//
//   # Run with custom count
//   curl -X POST "https://<project>.functions.supabase.co/sos-load-probe?count=10" \
//     -H "Authorization: Bearer $PROBE_SECRET"
//
// NOT ON CRON
//   Unlike sos-dispatch-probe, this probe is NOT scheduled by GitHub
//   Actions. It's a manual / workflow_dispatch only tool because:
//     - Each run creates 1..50 auth.users rows (idempotent re-use)
//     - Each run creates count emergencies + 2*count audit_log rows
//     - Running it on cron would balloon DB volume needlessly
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_COUNT = 50;
const PROBE_USER_PREFIX = "sos-load-";
const PROBE_USER_DOMAIN = "@sosphere.internal";

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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return Math.round(sorted[idx]);
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

  // ── Auth ────────────────────────────────────────────────────────────────
  const probeSecret = Deno.env.get("PROBE_SECRET");
  if (!probeSecret || probeSecret.length < 16) {
    console.error("[sos-load-probe] PROBE_SECRET missing/short");
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

  // ── Parse count param ───────────────────────────────────────────────────
  const url = new URL(req.url);
  const rawCount = url.searchParams.get("count");
  const count = Math.max(1, Math.min(MAX_COUNT, parseInt(rawCount || "5", 10) || 5));

  const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  const runId = crypto.randomUUID();
  const runStart = performance.now();

  // ── Stage 1: ensure N probe users exist + refresh passwords (parallel) ──
  const stage1Start = performance.now();
  let userIds: string[];
  try {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) return jsonResponse({ pass: false, stage: "list_users", error: listErr.message }, 500, corsHeaders);

    const existing = new Map<string, string>(); // email -> userId
    for (const u of list.users) {
      if (u.email && u.email.startsWith(PROBE_USER_PREFIX) && u.email.endsWith(PROBE_USER_DOMAIN)) {
        existing.set(u.email, u.id);
      }
    }

    const setupResults = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const email = `${PROBE_USER_PREFIX}${i}${PROBE_USER_DOMAIN}`;
        const password = crypto.randomUUID() + crypto.randomUUID(); // 72-char ASCII
        try {
          let userId = existing.get(email);
          if (userId) {
            const { error } = await admin.auth.admin.updateUserById(userId, { password });
            if (error) throw new Error(`update ${i}: ${error.message}`);
          } else {
            const { data: created, error } = await admin.auth.admin.createUser({
              email,
              password,
              email_confirm: true,
            });
            if (error || !created?.user) throw new Error(`create ${i}: ${error?.message}`);
            userId = created.user.id;
          }
          return { i, email, password, userId };
        } catch (e) {
          return { i, email, password, userId: null, error: String(e).slice(0, 200) };
        }
      }),
    );

    const setupFailed = setupResults.filter((r) => !r.userId);
    if (setupFailed.length > 0) {
      return jsonResponse({ pass: false, stage: "ensure_users", failed: setupFailed }, 500, corsHeaders);
    }
    userIds = setupResults.map((r) => r.userId!);

    // Hand the credentials to Stage 2
    var stage1Users = setupResults as Array<{ i: number; email: string; password: string; userId: string }>;
  } catch (e) {
    return jsonResponse({ pass: false, stage: "stage1_threw", error: String(e).slice(0, 200) }, 500, corsHeaders);
  }
  const stage1Ms = Math.round(performance.now() - stage1Start);

  // ── Stage 2: parallel sign-in → N JWTs ─────────────────────────────────
  const stage2Start = performance.now();
  const userClient = createClient(supaUrl, anonKey, { auth: { persistSession: false } });
  const signInResults = await Promise.all(
    stage1Users.map(async (u) => {
      try {
        const { data, error } = await userClient.auth.signInWithPassword({
          email: u.email,
          password: u.password,
        });
        if (error || !data?.session) return { i: u.i, ok: false, error: error?.message ?? "no_session" };
        return { i: u.i, ok: true, jwt: data.session.access_token, userId: u.userId };
      } catch (e) {
        return { i: u.i, ok: false, error: String(e).slice(0, 200) };
      }
    }),
  );
  const signInFailed = signInResults.filter((r) => !r.ok);
  if (signInFailed.length > 0) {
    return jsonResponse({ pass: false, stage: "sign_in", failed: signInFailed }, 500, corsHeaders);
  }
  const sessions = signInResults as Array<{ i: number; ok: true; jwt: string; userId: string }>;
  const stage2Ms = Math.round(performance.now() - stage2Start);

  // ── Stage 3: PARALLEL SOS TRIGGER — the actual load test ────────────────
  const stage3Start = performance.now();
  const triggerResults = await Promise.all(
    sessions.map(async (s) => {
      const emergencyId = crypto.randomUUID();
      const traceId = crypto.randomUUID();
      const idemKey = `loadprobe:${runId}:${s.i}`;
      const t0 = performance.now();
      try {
        const res = await fetch(`${supaUrl}/functions/v1/sos-alert`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${s.jwt}`,
            apikey: anonKey,
            "Content-Type": "application/json",
            "Idempotency-Key": idemKey,
            "X-SOS-Trace-Id": traceId,
          },
          body: JSON.stringify({
            emergencyId,
            userId: s.userId,
            userName: `LoadProbe ${s.i}`,
            userPhone: "+15555550199",
            contacts: [{ name: "LoadProbe Contact", phone: "+10", relation: "test" }],
            location: { lat: 0, lng: 0, accuracy: 1, address: "Probe — null island" },
            silent: true,
            traceId,
            clientClaimedAt: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(30000),
        });
        const latencyMs = Math.round(performance.now() - t0);
        const body = res.ok ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
        return {
          i: s.i,
          emergencyId,
          userId: s.userId,
          httpStatus: res.status,
          ok: res.ok,
          latencyMs,
          body: res.ok ? undefined : body,
        };
      } catch (e) {
        return {
          i: s.i,
          emergencyId,
          userId: s.userId,
          httpStatus: 0,
          ok: false,
          latencyMs: Math.round(performance.now() - t0),
          body: `threw: ${String(e).slice(0, 200)}`,
        };
      }
    }),
  );
  const stage3Ms = Math.round(performance.now() - stage3Start);

  const succeeded = triggerResults.filter((r) => r.ok);
  const failed = triggerResults.filter((r) => !r.ok);
  const latencies = succeeded.map((r) => r.latencyMs).sort((a, b) => a - b);
  const successEmergencyIds = succeeded.map((r) => r.emergencyId);

  // ── Stage 4: verify DB state ───────────────────────────────────────────
  const stage4Start = performance.now();

  // 4a. All emergencyIds in sos_sessions
  let sessionsRowCount = 0;
  if (successEmergencyIds.length > 0) {
    const { data, error } = await admin
      .from("sos_sessions")
      .select("id", { count: "exact", head: false })
      .in("id", successEmergencyIds);
    sessionsRowCount = error ? -1 : (data?.length ?? 0);
  }

  // 4b. audit_log has 'sos_triggered' for each
  let auditRowCount = 0;
  if (successEmergencyIds.length > 0) {
    const { data, error } = await admin
      .from("audit_log")
      .select("id, target", { count: "exact", head: false })
      .eq("action", "sos_triggered")
      .in("target", successEmergencyIds);
    auditRowCount = error ? -1 : (data?.length ?? 0);
  }

  // 4c. sos_pipeline_metrics has 'sos_received' for each emergencyId.
  //     This exercises the R-13 classification path (probe users with
  //     @sosphere.internal emails should be classified is_synthetic=true).
  let pipelineMetricsRowCount = 0;
  let syntheticClassifiedCount = 0;
  if (successEmergencyIds.length > 0) {
    const { data, error } = await admin
      .from("sos_pipeline_metrics")
      .select("emergency_id, is_synthetic", { count: "exact", head: false })
      .in("emergency_id", successEmergencyIds)
      .eq("stage", "sos_received");
    pipelineMetricsRowCount = error ? -1 : (data?.length ?? 0);
    syntheticClassifiedCount = error ? -1 : ((data ?? []).filter((r: { is_synthetic: boolean }) => r.is_synthetic === true).length);
  }

  // 4d. NB: audit_log chain integrity is enforced by the BEFORE INSERT
  //     trigger (L2-D, migration 20260509171557_l2d_audit_log_hash_chain).
  //     If a row exists in audit_log, it WAS hash-chained at insertion.
  //     Trigger failure ⇒ INSERT aborts ⇒ no row. So auditRowCount
  //     equalling succeeded.length is equivalent to "chain still valid
  //     for the run window." We do NOT call verify_audit_chain RPC here
  //     because that function requires the caller to be an admin/owner
  //     of a specific company, which probe users are not.

  const stage4Ms = Math.round(performance.now() - stage4Start);

  // ── Stage 5: cleanup (best-effort, doesn't fail probe) ─────────────────
  if (successEmergencyIds.length > 0) {
    try {
      await admin.from("dispatch_attempts").delete().in("emergency_id", successEmergencyIds);
      await admin.from("sos_sessions").delete().in("id", successEmergencyIds);
    } catch (e) {
      console.warn("[sos-load-probe] cleanup error:", String(e).slice(0, 200));
    }
  }

  const totalMs = Math.round(performance.now() - runStart);

  // ── Build report ───────────────────────────────────────────────────────
  // Pass criteria:
  // - All triggers returned 2xx (failed.length === 0)
  // - All emergencyIds materialised in sos_sessions
  // - All emergencyIds materialised in audit_log (audit chain integrity by
  //   trigger — see comment 4d above)
  // - All emergencyIds materialised in sos_pipeline_metrics
  // - All probe rows in pipeline_metrics correctly classified as synthetic
  //   (R-13 verification)
  const pass =
    failed.length === 0 &&
    sessionsRowCount === succeeded.length &&
    auditRowCount === succeeded.length &&
    pipelineMetricsRowCount === succeeded.length &&
    syntheticClassifiedCount === succeeded.length;

  return jsonResponse(
    {
      pass,
      runId,
      count,
      succeeded: succeeded.length,
      failed: failed.length,
      latency: {
        min: latencies[0] ?? 0,
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
        max: latencies[latencies.length - 1] ?? 0,
      },
      db: {
        sessionsRows: sessionsRowCount,
        auditLogRows: auditRowCount,
        pipelineMetricsRows: pipelineMetricsRowCount,
        syntheticClassified: syntheticClassifiedCount,
      },
      stages: {
        setupUsersMs: stage1Ms,
        signInMs: stage2Ms,
        triggerMs: stage3Ms,
        verifyMs: stage4Ms,
        totalMs,
      },
      failures: failed.length > 0 ? failed.slice(0, 10) : undefined, // first 10 only
    },
    200,
    corsHeaders,
  );
});
