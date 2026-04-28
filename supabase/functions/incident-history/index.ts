// ═══════════════════════════════════════════════════════════════════════════
// incident-history (2026-04-28) — list a civilian's past SOS incidents.
//
// PURPOSE:
//   Powers the "Incident History" page in the individual dashboard. The
//   page used to read localStorage only — meaning a user who switched
//   browser/device saw zero history, AND retroactive PDFs (the headline
//   benefit of upgrading from Free → Basic/Elite) were impossible.
//
//   This endpoint returns the canonical, server-side list of incidents
//   for the calling user, drawn from sos_sessions. The companion
//   `incident-report-data` function then assembles a per-incident
//   IndividualReportData payload that the client renders into a tier-
//   appropriate PDF.
//
// SECURITY:
//   • JWT required (Authorization: Bearer <jwt>); anon access blocked.
//   • The user-scoped client uses the JWT, so RLS on sos_sessions
//     (sos_sessions_self_read policy) does the heavy lifting — we
//     never trust a user_id passed in the body.
//   • Anti-abuse: a `limit` query param (default 200, max 500) caps
//     response size. Pagination knob for future growth.
//   • CORS: same allowlist pattern as every other edge function.
//
// PRODUCT NOTES:
//   • Free, basic, and elite users all see their full history here. The
//     PDF generation is gated separately (`incident-report-data` returns
//     the data for both basic and elite — it's the client's choice of
//     tier in `generateIndividualReport(data, tier)` that determines
//     what's actually rendered).
//   • Includes both terminal (resolved/canceled/ended) and in-flight
//     (active/escalated) sessions. The UI can hide the latter from the
//     "Past Incidents" view if it wants.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",").map((s) => s.trim()).filter(Boolean);

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

Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Both GET and POST accepted; POST is the canonical form (matches the
  // pattern used by other edge functions like dashboard-actions). GET
  // is allowed because this endpoint has no body.
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Missing token" }), { status: 401, headers: CORS });
  }

  // Verify the JWT and resolve user_id. Use anon-key client + user JWT
  // so that RLS on sos_sessions naturally scopes the SELECT to this user.
  const userClient = createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });
  }
  const userId = userData.user.id;

  // Optional limit param (default 200, max 500). Anti-abuse cap on the
  // server side so a malicious client can't request a million rows.
  const url = new URL(req.url);
  let limit = 200;
  const limitParam = url.searchParams.get("limit");
  if (limitParam) {
    const n = parseInt(limitParam, 10);
    if (Number.isFinite(n) && n > 0 && n <= 500) limit = n;
  }

  // The SELECT below uses ONLY columns confirmed to exist in production
  // schema (verified 2026-04-28 against information_schema). Notably
  // absent from sos_sessions: ended_at, recording_seconds, photo_count,
  // end_reason — those fields are written by sos-alert/index.ts but
  // that DDL never landed. Treat them as missing here; the per-incident
  // assembler (`incident-report-data`) substitutes safe defaults so the
  // PDF still renders honestly ("Not recorded").
  try {
    const { data, error } = await userClient
      .from("sos_sessions")
      .select(`
        id, status, tier,
        started_at, triggered_at, created_at, resolved_at, last_heartbeat,
        lat, lng, last_lat, last_lng, accuracy, address, zone,
        escalated, escalation_stage, contact_count, silent_mode,
        company_id
      `)
      .eq("user_id", userId)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) {
      console.warn("[incident-history] query error:", error);
      return new Response(JSON.stringify({ error: "Query failed" }), { status: 500, headers: CORS });
    }

    // Shape the response for the client. We pre-compute a few derived
    // fields the UI needs so the client doesn't have to know about
    // the schema quirks (started_at vs created_at fallback, etc.).
    const incidents = (data || []).map((row: any) => {
      const startedAt = row.started_at ?? row.triggered_at ?? row.created_at;
      const endedAt = row.resolved_at ?? row.last_heartbeat ?? null;
      // Duration in seconds (best-effort — null if either timestamp missing)
      let durationSec: number | null = null;
      if (startedAt && endedAt) {
        const a = new Date(startedAt).getTime();
        const b = new Date(endedAt).getTime();
        if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
          durationSec = Math.round((b - a) / 1000);
        }
      }
      const isTerminal = ["resolved", "canceled", "cancelled", "ended"].includes(row.status);
      return {
        id: row.id,
        status: row.status,
        tier: row.tier ?? null,
        startedAt,
        endedAt,
        durationSec,
        isTerminal,
        location: {
          lat: row.last_lat ?? row.lat ?? null,
          lng: row.last_lng ?? row.lng ?? null,
          accuracy: row.accuracy ?? null,
          address: row.address ?? null,
        },
        zone: row.zone ?? null,
        escalated: row.escalated ?? false,
        escalationStage: row.escalation_stage ?? null,
        contactCount: row.contact_count ?? null,
        silentMode: row.silent_mode ?? false,
        companyId: row.company_id ?? null,
      };
    });

    return new Response(
      JSON.stringify({
        ok: true,
        userId,
        count: incidents.length,
        incidents,
      }),
      { status: 200, headers: CORS },
    );
  } catch (err) {
    console.error("[incident-history] unexpected error:", err);
    // Don't leak err.message to the client (G-30 pattern).
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: CORS });
  }
});
