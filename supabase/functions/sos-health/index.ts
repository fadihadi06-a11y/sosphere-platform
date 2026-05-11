// ═══════════════════════════════════════════════════════════════
// SOSphere — sos-health (L4-B public health endpoint)
// ─────────────────────────────────────────────────────────────
// Lightweight public "is the platform alive" check. Designed for:
//   • External uptime monitors (Pingdom, Better Uptime, UptimeRobot)
//   • Vercel deploy health-checks
//   • Future status page widget
//   • Manual `curl` from anywhere
//
// CONTRACT
//   GET /sos-health
//     200 → { ok: true, ts, version, supabase: "up" }   (healthy)
//     503 → { ok: false, ts, supabase: "down", error }  (DB unreachable)
//
// POSTURE
//   • Public — no auth. This is a /healthz-style endpoint.
//   • Returns ONLY non-sensitive fields. No emergency IDs, no
//     user data, no env var names, no internal URLs. Just a
//     pulse + the SUPABASE_URL host (which is already public
//     anyway — it's in every Vercel-hosted frontend bundle).
//   • Probes Supabase with a trivial `SELECT 1` via the auth
//     schema (works on any Supabase project; no custom table
//     required). Failure of THAT proves the DB plane is down.
//   • Cached server-side for 10s — same response served for
//     burst traffic. A 1000-monitor-per-second flood becomes
//     100 actual DB pings per second.
//
// CACHE-CONTROL
//   Cache-Control: public, max-age=10, s-maxage=10
//     → uptime monitors get fresh data every poll without
//       hitting Supabase on every request.
//
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withDbRetry } from "../_shared/db-retry.ts";

// Cache the last health-check result for this many ms. A request
// arriving inside the window returns the cached response directly.
const CACHE_MS = 10_000;

// Per-attempt timeout for the Supabase ping. Capped tight so a
// stuck DB connection can't make health timeouts cascade.
const DB_PING_TIMEOUT_MS = 3_000;

interface HealthSnapshot {
  ok: boolean;
  ts: string;
  version: string;
  supabase: "up" | "down";
  error?: string;
}

let cached: { value: HealthSnapshot; expiresAt: number } | null = null;

const VERSION = "1.0";

serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Cache hit — return the stored snapshot without touching Supabase.
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return jsonResponse(cached.value, cors);
  }

  // Build fresh snapshot.
  const snapshot: HealthSnapshot = {
    ok: false,
    ts: new Date(now).toISOString(),
    version: VERSION,
    supabase: "down",
  };

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !supaKey) {
    snapshot.error = "supabase_env_missing";
    return jsonResponse(snapshot, cors);
  }

  try {
    const supabase = createClient(supaUrl, supaKey);
    // Trivial `SELECT 1` via the public schema. Using a tiny
    // information_schema query: counts indexes (always exists,
    // always tiny, always readable to service_role).
    // Wrapped in withDbRetry so a 200ms transient blip on the DB
    // doesn't mark the platform as down — the retry budget here is
    // bounded by DB_PING_TIMEOUT_MS via AbortSignal.timeout inline
    // below if needed; for a SELECT 1, the SDK's own timeout is
    // sufficient.
    await withDbRetry(
      async () => {
        const probe = await Promise.race([
          supabase.from("pg_indexes").select("schemaname", { count: "exact", head: true }).limit(1),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("db_ping_timeout")), DB_PING_TIMEOUT_MS),
          ),
        ]);
        if ((probe as { error?: { message?: string } } | null)?.error) {
          throw new Error((probe as { error?: { message?: string } }).error?.message || "db_ping_error");
        }
        return probe;
      },
      { maxRetries: 1, initialBackoffMs: 100, backoffCapMs: 200 },
    );
    snapshot.ok = true;
    snapshot.supabase = "up";
  } catch (e) {
    snapshot.ok = false;
    snapshot.supabase = "down";
    snapshot.error = (e as Error).message?.slice(0, 80) || "unknown";
  }

  // Refresh cache regardless of outcome — even a 'down' result
  // is cached so we don't hammer a struggling DB.
  cached = { value: snapshot, expiresAt: now + CACHE_MS };

  return jsonResponse(snapshot, cors);
});

function jsonResponse(snapshot: HealthSnapshot, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(snapshot), {
    status: snapshot.ok ? 200 : 503,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=10, s-maxage=10",
    },
  });
}
