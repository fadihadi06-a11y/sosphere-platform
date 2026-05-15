// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — sos-load-probe (R-17 + R-18-G — parallel SOS load test)
// ─────────────────────────────────────────────────────────────────────────
// EVOLUTION
//   R-17  first version: parallel sign-in + parallel trigger.
//   R-18-F sign-in batching attempt: blocked by Supabase Auth rate limit.
//   R-18-G THIS: sticky JWT cache in sos_probe_session_cache table.
//                Seed once (slow), reuse forever (fast). No Auth limit.
//
// MODES
//   ?seed=true&count=N   Seed mode — create N probe users SLOWLY (one per
//                        SEED_DELAY_MS, default 11s). Idempotent. Total
//                        time ≈ N*11s. Run ONCE before doing load tests.
//   ?count=N             Load mode — load cached JWTs, refresh expiring
//                        ones, fire N parallel sos-alert triggers,
//                        report aggregate metrics + DB consistency.
//
// USAGE
//   # ONE-TIME (seeds 50 users; ~9 min):
//   curl -X POST "$URL/sos-load-probe?seed=true&count=50" \
//     -H "Authorization: Bearer $PROBE_SECRET"
//
//   # Then run load tests — instant setup:
//   curl -X POST "$URL/sos-load-probe?count=20" -H ...
//   curl -X POST "$URL/sos-load-probe?count=50" -H ...
//
// REQUIRED SUPABASE SECRETS
//   PROBE_SECRET                (bearer auth)
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto)
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_COUNT = 100;
const PROBE_USER_PREFIX = "sos-load-";
const PROBE_USER_DOMAIN = "@sosphere.internal";
// Auth rate limit is 30 sign-ins / 5 min = 6 / minute. 11s between seeds
// gives us ~5.4 / minute — comfortably under the limit.
const SEED_DELAY_MS = 11000;
// Refresh JWT if it'll expire in less than this window.
const REFRESH_LEEWAY_MS = 60_000;

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

interface CacheRow {
  probe_index: number;
  user_id: string;
  email: string;
  password: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);

  // ── Auth ────────────────────────────────────────────────────────────────
  const probeSecret = Deno.env.get("PROBE_SECRET");
  if (!probeSecret || probeSecret.length < 16) {
    return jsonResponse({ error: "probe_misconfigured" }, 500, corsHeaders);
  }
  const authHeader = req.headers.get("Authorization") || "";
  if (!constantTimeEquals(authHeader, `Bearer ${probeSecret}`)) {
    return jsonResponse({ error: "unauthorized" }, 401, corsHeaders);
  }

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: "env_missing" }, 500, corsHeaders);
  }

  const url = new URL(req.url);
  const rawCount = url.searchParams.get("count");
  const count = Math.max(1, Math.min(MAX_COUNT, parseInt(rawCount || "5", 10) || 5));
  const isSeed = url.searchParams.get("seed") === "true";

  const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  const runId = crypto.randomUUID();
  const runStart = performance.now();

  // ═══════════════════════════════════════════════════════════════════════
  // SEED MODE
  // ═══════════════════════════════════════════════════════════════════════
  if (isSeed) {
    const seedStart = performance.now();
    const userClient = createClient(supaUrl, anonKey, { auth: { persistSession: false } });
    const seedResults: Array<{ i: number; ok: boolean; error?: string }> = [];

    // Look up existing probe users once
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) return jsonResponse({ pass: false, stage: "list_users", error: listErr.message }, 500, corsHeaders);
    const existingByEmail = new Map<string, string>();
    for (const u of list.users) {
      if (u.email?.startsWith(PROBE_USER_PREFIX) && u.email?.endsWith(PROBE_USER_DOMAIN)) {
        existingByEmail.set(u.email, u.id);
      }
    }

    for (let i = 0; i < count; i++) {
      const email = `${PROBE_USER_PREFIX}${i}${PROBE_USER_DOMAIN}`;
      const password = crypto.randomUUID() + crypto.randomUUID();
      try {
        let userId = existingByEmail.get(email);
        if (userId) {
          const { error } = await admin.auth.admin.updateUserById(userId, { password });
          if (error) throw new Error(`update: ${error.message}`);
        } else {
          const { data: created, error } = await admin.auth.admin.createUser({
            email, password, email_confirm: true,
          });
          if (error || !created?.user) throw new Error(`create: ${error?.message}`);
          userId = created.user.id;
        }

        // Sign in to get JWT pair
        const { data: session, error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
        if (signInErr || !session?.session) throw new Error(`sign_in: ${signInErr?.message}`);

        // Upsert into cache
        const expiresAtIso = new Date(Date.now() + session.session.expires_in * 1000).toISOString();
        const { error: upsertErr } = await admin
          .from("sos_probe_session_cache")
          .upsert(
            {
              probe_index: i,
              user_id: userId,
              email,
              password,
              access_token: session.session.access_token,
              refresh_token: session.session.refresh_token,
              expires_at: expiresAtIso,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "probe_index" },
          );
        if (upsertErr) throw new Error(`upsert: ${upsertErr.message}`);

        seedResults.push({ i, ok: true });
      } catch (e) {
        seedResults.push({ i, ok: false, error: String(e).slice(0, 200) });
      }

      // Pace ourselves under the Auth rate-limit bucket. Skip after the last.
      if (i < count - 1) await new Promise((r) => setTimeout(r, SEED_DELAY_MS));
    }

    const okCount = seedResults.filter((r) => r.ok).length;
    return jsonResponse(
      {
        mode: "seed",
        pass: okCount === count,
        count,
        seeded: okCount,
        failed: count - okCount,
        elapsedMs: Math.round(performance.now() - seedStart),
        failures: seedResults.filter((r) => !r.ok).slice(0, 20),
      },
      200,
      corsHeaders,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LOAD MODE
  // ═══════════════════════════════════════════════════════════════════════

  // Stage 1 — load cache for [0..count)
  const stage1Start = performance.now();
  const { data: cachedRows, error: loadErr } = await admin
    .from("sos_probe_session_cache")
    .select("probe_index, user_id, email, password, access_token, refresh_token, expires_at")
    .lt("probe_index", count)
    .order("probe_index", { ascending: true });
  if (loadErr) return jsonResponse({ pass: false, stage: "load_cache", error: loadErr.message }, 500, corsHeaders);

  const rows = (cachedRows ?? []) as CacheRow[];
  if (rows.length < count) {
    return jsonResponse(
      {
        pass: false,
        stage: "cache_incomplete",
        message: `Cache has ${rows.length} rows but need ${count}. Run seed mode first: ?seed=true&count=${count}`,
        haveIndexes: rows.map((r) => r.probe_index),
        missingIndexes: Array.from({ length: count }, (_, i) => i).filter(
          (i) => !rows.some((r) => r.probe_index === i),
        ),
      },
      400,
      corsHeaders,
    );
  }
  const stage1Ms = Math.round(performance.now() - stage1Start);

  // Stage 2 — refresh JWTs that expire within REFRESH_LEEWAY_MS
  const stage2Start = performance.now();
  const userClient = createClient(supaUrl, anonKey, { auth: { persistSession: false } });
  const now = Date.now();
  const refreshResults = await Promise.all(
    rows.map(async (r) => {
      const expiresMs = new Date(r.expires_at).getTime();
      if (expiresMs - now > REFRESH_LEEWAY_MS) {
        return { i: r.probe_index, ok: true, refreshed: false, jwt: r.access_token, userId: r.user_id };
      }
      // Need refresh
      try {
        const { data, error } = await userClient.auth.refreshSession({ refresh_token: r.refresh_token });
        if (error || !data?.session) {
          return { i: r.probe_index, ok: false, refreshed: false, error: error?.message ?? "no_session_on_refresh" };
        }
        const newExpiresAtIso = new Date(Date.now() + data.session.expires_in * 1000).toISOString();
        await admin
          .from("sos_probe_session_cache")
          .update({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: newExpiresAtIso,
          })
          .eq("probe_index", r.probe_index);
        return {
          i: r.probe_index,
          ok: true,
          refreshed: true,
          jwt: data.session.access_token,
          userId: r.user_id,
        };
      } catch (e) {
        return { i: r.probe_index, ok: false, refreshed: false, error: String(e).slice(0, 200) };
      }
    }),
  );
  const refreshFailed = refreshResults.filter((r) => !r.ok);
  if (refreshFailed.length > 0) {
    return jsonResponse({ pass: false, stage: "refresh", failed: refreshFailed }, 500, corsHeaders);
  }
  const sessions = refreshResults as Array<{ i: number; ok: true; jwt: string; userId: string; refreshed: boolean }>;
  const refreshedCount = sessions.filter((s) => s.refreshed).length;
  const stage2Ms = Math.round(performance.now() - stage2Start);

  // Stage 3 — THE LOAD TEST (fully parallel sos-alert triggers)
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

  // Stage 4 — DB consistency verification
  const stage4Start = performance.now();

  let sessionsRowCount = 0;
  if (successEmergencyIds.length > 0) {
    const { data, error } = await admin
      .from("sos_sessions")
      .select("id", { count: "exact", head: false })
      .in("id", successEmergencyIds);
    sessionsRowCount = error ? -1 : (data?.length ?? 0);
  }

  let auditRowCount = 0;
  if (successEmergencyIds.length > 0) {
    const { data, error } = await admin
      .from("audit_log")
      .select("id, target", { count: "exact", head: false })
      .eq("action", "sos_triggered")
      .in("target", successEmergencyIds);
    auditRowCount = error ? -1 : (data?.length ?? 0);
  }

  let pipelineMetricsRowCount = 0;
  let syntheticClassifiedCount = 0;
  let pipelineMetricsError: string | null = null;
  if (successEmergencyIds.length > 0) {
    const { data, error } = await admin
      .from("sos_pipeline_metrics")
      .select("emergency_id, is_synthetic")
      .in("emergency_id", successEmergencyIds);
    if (error) {
      pipelineMetricsRowCount = -1;
      syntheticClassifiedCount = -1;
      pipelineMetricsError = error.message;
    } else {
      pipelineMetricsRowCount = data?.length ?? 0;
      syntheticClassifiedCount = (data ?? []).filter(
        (r: { is_synthetic: boolean }) => r.is_synthetic === true,
      ).length;
    }
  }

  const stage4Ms = Math.round(performance.now() - stage4Start);

  // Cleanup (best-effort)
  if (successEmergencyIds.length > 0) {
    try {
      await admin.from("dispatch_attempts").delete().in("emergency_id", successEmergencyIds);
      await admin.from("sos_sessions").delete().in("id", successEmergencyIds);
    } catch (e) {
      console.warn("[sos-load-probe] cleanup error:", String(e).slice(0, 200));
    }
  }

  const totalMs = Math.round(performance.now() - runStart);

  const pass =
    failed.length === 0 &&
    sessionsRowCount === succeeded.length &&
    auditRowCount === succeeded.length &&
    pipelineMetricsRowCount === succeeded.length &&
    syntheticClassifiedCount === succeeded.length;

  return jsonResponse(
    {
      mode: "load",
      pass,
      runId,
      count,
      succeeded: succeeded.length,
      failed: failed.length,
      refreshedJwts: refreshedCount,
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
        pipelineMetricsError,
      },
      stages: {
        loadCacheMs: stage1Ms,
        refreshMs: stage2Ms,
        triggerMs: stage3Ms,
        verifyMs: stage4Ms,
        totalMs,
      },
      failures: failed.length > 0 ? failed.slice(0, 10) : undefined,
    },
    200,
    corsHeaders,
  );
});
