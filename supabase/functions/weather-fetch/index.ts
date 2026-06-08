// ═══════════════════════════════════════════════════════════════
// SOSphere — Weather Fetch v2 (29th pattern app + cron sweep)
// ─────────────────────────────────────────────────────────────
// 2026-06-08 v2 — adds ?action=sweep mode for the pg_cron sweep
// (trigger_weather_sweep → net.http_post → here). Cron path uses
// x-cron-secret + record_weather_observation_cron RPC (service_role
// write, no auth.uid() check). User path stays unchanged.
//
// MODES (via ?action= query param)
//   default      → POST + Bearer JWT, RPC: record_weather_observation
//   ?action=probe → synthetic monitoring (see _shared/probe-handler.ts)
//   ?action=sweep → POST + x-cron-secret header, RPC:
//                   record_weather_observation_cron (system write)
//
// SECRETS (Supabase Function Secrets)
//   OPENWEATHER_API_KEY — required
//   CRON_SECRET         — env fallback for vault.cron_shared_secret
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/api-guard.ts";
import { handleProbe } from "../_shared/probe-handler.ts";
import { safeErrorResponse } from "../_shared/safe-error.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENWEATHER_API_KEY   = Deno.env.get("OPENWEATHER_API_KEY") ?? "";
const OPENWEATHER_USE_ONECALL = Deno.env.get("OPENWEATHER_USE_ONECALL") === "true";
const CRON_SECRET_ENV       = Deno.env.get("CRON_SECRET") ?? "";

// Cache the vault-resolved cron secret per Edge isolate (~5 min lifetime).
let _cachedCronSecret: string | null = null;
let _cachedCronSecretAt = 0;
const CRON_SECRET_TTL_MS = 5 * 60 * 1000;

async function getCronSharedSecret(client: ReturnType<typeof createClient>): Promise<string> {
  if (_cachedCronSecret !== null && Date.now() - _cachedCronSecretAt < CRON_SECRET_TTL_MS) {
    return _cachedCronSecret;
  }
  try {
    const { data, error } = await client.rpc("get_cron_shared_secret");
    if (!error && typeof data === "string" && data.length > 0) {
      _cachedCronSecret = data;
      _cachedCronSecretAt = Date.now();
      return data;
    }
  } catch { /* fall through to env */ }
  _cachedCronSecret = CRON_SECRET_ENV;
  _cachedCronSecretAt = Date.now();
  return CRON_SECRET_ENV;
}

interface FetchBody { companyId: string; zoneId?: string | null; lat: number; lng: number; }

/** Shared OpenWeather call. Returns normalized result or error reason. */
async function fetchOpenWeather(lat: number, lng: number):
  Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; status: number; reason: string }> {
  const endpoint = OPENWEATHER_USE_ONECALL
    ? `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric&exclude=minutely,hourly,daily`
    : `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric`;
  try {
    const r = await fetch(endpoint, {
      headers: { "User-Agent": "SOSphere/1.0 (safety-platform)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.warn(`[weather-fetch] provider ${r.status}:`, text.slice(0, 200));
      return { ok: false, status: 502, reason: `provider_${r.status}` };
    }
    const payload = await r.json();
    return { ok: true, payload };
  } catch (err) {
    console.warn("[weather-fetch] provider threw:", String((err as Error)?.message ?? err).slice(0, 200));
    return { ok: false, status: 502, reason: "provider_unreachable" };
  }
}

serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // ── Probe mode ───────────────────────────────────────────────
  if (action === "probe") {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return await handleProbe(req, {
      functionName: "weather-fetch",
      cors,
      supabase: supabaseAdmin,
      authenticate: async (r) => {
        const auth = r.headers.get("Authorization") ?? "";
        const jwt = auth.replace(/^Bearer\s+/i, "").trim();
        if (!jwt) return null;
        const { data, error } = await supabaseAdmin.auth.getUser(jwt);
        if (error || !data.user) return null;
        return { userId: data.user.id, email: data.user.email ?? undefined };
      },
      logToAudit: true,
    });
  }

  // ── Sweep mode (cron-invoked, system-write) ──────────────────
  if (action === "sweep") {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const providedSecret = req.headers.get("x-cron-secret") ?? "";
    const expectedSecret = await getCronSharedSecret(supabaseAdmin);
    if (!expectedSecret || providedSecret !== expectedSecret) {
      console.warn(`[weather-fetch sweep] rejected: header_len=${providedSecret.length} expected_len=${expectedSecret.length}`);
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!OPENWEATHER_API_KEY) {
      return new Response(JSON.stringify({ error: "weather_provider_not_configured" }), {
        status: 503, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    let body: FetchBody;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!body?.companyId || !Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180) {
      return new Response(JSON.stringify({ error: "invalid_coordinates" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const fetched = await fetchOpenWeather(body.lat, body.lng);
    if (!fetched.ok) {
      return new Response(JSON.stringify({ error: fetched.reason }), {
        status: fetched.status, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    try {
      const { data, error } = await supabaseAdmin.rpc("record_weather_observation_cron", {
        p_company_id: body.companyId,
        p_zone_id:    body.zoneId ?? null,
        p_lat:        body.lat,
        p_lng:        body.lng,
        p_payload:    fetched.payload,
      });
      if (error) {
        console.warn("[weather-fetch sweep] record_weather_observation_cron failed:", error.message);
        return new Response(JSON.stringify({ error: "persist_failed", detail: error.message }), {
          status: 500, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, id: data, mode: "sweep", provider: "openweather" }), {
        status: 200, headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (rpcErr) {
      return safeErrorResponse(rpcErr, cors);
    }
  }

  // ── User mode (default) ──────────────────────────────────────
  if (!OPENWEATHER_API_KEY) {
    return new Response(JSON.stringify({ error: "weather_provider_not_configured" }), {
      status: 503, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  let body: FetchBody;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!body?.companyId || !Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180) {
    return new Response(JSON.stringify({ error: "invalid_coordinates" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth:   { autoRefreshToken: false, persistSession: false },
  });
  const fetched = await fetchOpenWeather(body.lat, body.lng);
  if (!fetched.ok) {
    return new Response(JSON.stringify({ error: fetched.reason }), {
      status: fetched.status, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  try {
    const { data, error } = await supabaseUser.rpc("record_weather_observation", {
      p_company_id: body.companyId,
      p_zone_id:    body.zoneId ?? null,
      p_lat:        body.lat,
      p_lng:        body.lng,
      p_payload:    fetched.payload,
    });
    if (error) {
      console.warn("[weather-fetch] record_weather_observation failed:", error.message);
      return new Response(JSON.stringify({ error: "persist_failed", detail: error.message }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, id: data, mode: "user", provider: "openweather" }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (rpcErr) {
    return safeErrorResponse(rpcErr, cors);
  }
});
