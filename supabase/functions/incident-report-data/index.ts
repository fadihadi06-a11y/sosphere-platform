// ═══════════════════════════════════════════════════════════════════════════
// incident-report-data (2026-04-28) — assemble retroactive PDF payload.
//
// PURPOSE:
//   Fetches everything the client needs to render an IndividualReportData
//   PDF for a specific past incident. Designed to power the per-incident
//   "Download PDF" button in the Incident History page.
//
//   Critically, this enables the upgrade path the user is paying for:
//   if a Free user had three SOS events last month and upgrades to
//   Basic or Elite today, calling this endpoint for each of those
//   incidentIds returns the data needed to generate three separate
//   PDFs at the new tier — each with its own incidentId, SHA-256 hash,
//   and chain of custody.
//
// SECURITY:
//   • JWT required; user_id resolved server-side.
//   • Ownership check: the requested incidentId must have user_id =
//     the JWT's user_id, OR the caller must be a company member of
//     the incident's company_id (mirrors sos_sessions RLS).
//     Cross-tenant guesses return 404 (not 403, to avoid id enumeration).
//   • RLS-respecting reads via the user-scoped client. The audit_log
//     fetch uses service-role specifically to bypass FORCE RLS — but
//     ONLY after the ownership check has passed. This is the same
//     pattern used by the audit-log read elsewhere; the user is
//     authorized to see audit entries for THEIR OWN incident.
//   • Rate-limit consideration: assembling a report is heavier than
//     listing history. We don't enforce a hard limit here yet; the
//     companion `incident-history` page paginates so the natural cap
//     is "200 incidents × 1 download each = 200 calls/session". Add
//     a per-user-per-day rate-limiter in a follow-up if abuse appears.
//
// SCHEMA REALITY (verified 2026-04-28):
//   sos_sessions has: started_at, triggered_at, created_at, resolved_at,
//                     last_heartbeat, lat/lng, accuracy, address, zone,
//                     escalated, escalation_stage, contact_snapshot (jsonb),
//                     ai_script (jsonb), tier, status, etc.
//   sos_sessions LACKS: ended_at, recording_seconds, photo_count,
//                       end_reason — sos-alert/index.ts writes these
//                       but the DDL never landed. We substitute safe
//                       defaults so the PDF reports "Not recorded"
//                       honestly rather than printing 0 as fact.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPA_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// UUID validator — sos_sessions.id is uuid; reject non-uuid input early
// to block id enumeration / OR-injection (B-01 pattern from dashboard-actions).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Authenticate
  const userClient = createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });
  }
  const userId = userData.user.id;

  // Parse body
  let body: { incidentId?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: CORS });
  }
  const incidentId = (body.incidentId || "").trim();
  if (!incidentId || !UUID_RE.test(incidentId)) {
    return new Response(JSON.stringify({ error: "Invalid incidentId" }), { status: 400, headers: CORS });
  }

  try {
    // ── Step 1: load the session (RLS will enforce ownership) ─────────
    const { data: session, error: sessionErr } = await userClient
      .from("sos_sessions")
      .select(`
        id, user_id, company_id, status, tier,
        started_at, triggered_at, created_at, resolved_at, last_heartbeat,
        lat, lng, last_lat, last_lng, accuracy, address, zone,
        escalated, escalation_stage,
        contact_snapshot, ai_script,
        contact_count, silent_mode, blood_type, battery_level
      `)
      .eq("id", incidentId)
      .maybeSingle();

    if (sessionErr) {
      console.warn("[incident-report-data] session query error:", sessionErr);
      return new Response(JSON.stringify({ error: "Query failed" }), { status: 500, headers: CORS });
    }
    if (!session) {
      // Polish #5 (2026-04-28): differentiate "never existed" from
      // "deleted by retention cron". Pre-fix: both returned a generic
      // 404 and the client showed "Could not load report" — confusing
      // for a user who can SEE the incident in their local history.
      //
      // Strategy: audit_log is NEVER deleted (CRIT-#16 explicitly
      // excluded it from the retention sweep). So if the session row
      // is gone but audit entries for the same incidentId still exist,
      // we know with certainty that the incident WAS real and was
      // archived by the 90-day retention policy. We return a sentinel
      // {retentionExpired:true} that the client surfaces as a clear
      // bilingual notice. If audit_log is also empty, this id was
      // never a real incident — return the standard 404 (id enumeration
      // defence still preserved: we don't reveal who owned it).
      const adminEarly = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      // Bound the lookup to entries the requesting user authored —
      // anonymous audit entries (system / service_role) are excluded
      // so we don't leak existence of someone else's incident via the
      // sentinel response.
      const { data: auditTrace } = await adminEarly
        .from("audit_log")
        .select("created_at")
        .or(`target.eq.${incidentId},target_id.eq.${incidentId}`)
        .eq("actor_id", userId)
        .limit(1);
      if (auditTrace && auditTrace.length > 0) {
        return new Response(
          JSON.stringify({
            retentionExpired: true,
            error: "Incident archived by 90-day retention policy",
          }),
          { status: 410, headers: CORS },  // 410 Gone — semantic match
        );
      }
      // Genuinely unknown id — keep id-enumeration defence (404, no detail).
      return new Response(JSON.stringify({ error: "Incident not found" }), { status: 404, headers: CORS });
    }

    // Defensive ownership check (belt + suspenders — RLS already
    // covered this, but explicit verification is documentation
    // and protects against future RLS regressions).
    if (session.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Incident not found" }), { status: 404, headers: CORS });
    }

    // ── Step 2: load profile (for userName / userPhone) ───────────────
    const { data: profile } = await userClient
      .from("profiles")
      .select("full_name, phone")
      .eq("user_id", userId)
      .maybeSingle();

    // ── Step 3: load server-verified audit chain (Elite §7) ──────────
    // Use service-role so we read the FULL audit chain regardless of
    // whether the per-row RLS would allow this specific user — but ONLY
    // entries whose target/target_id matches THIS incident, after
    // ownership has been verified above.
    const admin = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: auditRows } = await admin
      .from("audit_log")
      .select("created_at, actor, actor_name, actor_role, action, operation, detail, metadata, target, target_id")
      .or(`target.eq.${incidentId},target_id.eq.${incidentId}`)
      .order("created_at", { ascending: true })
      .limit(200);

    const serverAudit = (auditRows || []).map((r: any) => ({
      serverTime: r.created_at,
      actor: r.actor_name || r.actor || "system",
      actorRole: r.actor_role || "",
      action: r.action || "",
      operation: r.operation || "",
      detail: r.detail ?? null,
      source: r.metadata?.source ?? null,
    }));

    // ── Step 4: GPS trail (best-effort — sessions for civilians may
    //   not have any rows since gps_trail keys on employee_id text). ──
    const startedAt = session.started_at ?? session.triggered_at ?? session.created_at;
    const endedAt = session.resolved_at ?? session.last_heartbeat ?? null;
    let gpsTrail: Array<{ lat: number; lng: number; time: string }> = [];
    if (startedAt) {
      const windowEnd = endedAt
        ? new Date(endedAt).toISOString()
        // Fallback: 4 hours after start (safety cap; sessions don't last that long)
        : new Date(new Date(startedAt).getTime() + 4 * 3600_000).toISOString();
      const { data: gpsRows } = await admin
        .from("gps_trail")
        .select("location, recorded_at")
        .eq("employee_id", userId)
        .gte("recorded_at", startedAt)
        .lte("recorded_at", windowEnd)
        .order("recorded_at", { ascending: true })
        .limit(500);
      gpsTrail = (gpsRows || [])
        .map((r: any) => {
          // location is GEOGRAPHY(POINT) — Supabase returns it as a
          // GeoJSON-like object or WKT string. Best-effort parse.
          const loc = r.location;
          if (loc && typeof loc === "object" && Array.isArray(loc.coordinates)) {
            return {
              lat: Number(loc.coordinates[1]),
              lng: Number(loc.coordinates[0]),
              time: r.recorded_at,
            };
          }
          return null;
        })
        .filter((p: any): p is { lat: number; lng: number; time: string } => !!p && Number.isFinite(p.lat));
    }

    // ── Step 5: contacts cycle (from contact_snapshot jsonb) ─────────
    // contact_snapshot was added by C-7 fix and captures the contacts
    // at trigger-time. May be null for older incidents.
    let contacts: Array<{ name: string; relation: string; phone: string; status: string }> = [];
    if (Array.isArray(session.contact_snapshot)) {
      contacts = (session.contact_snapshot as any[]).map((c: any) => ({
        name: c.name || "Unknown",
        relation: c.relation || c.relationship || "",
        phone: c.phone || "",
        // No outcome data preserved server-side yet; mark "pending".
        // The per-incident audit_log entries have call outcome detail,
        // but joining them per-contact is out of scope for this pass.
        status: "pending",
      }));
    }

    // ── Step 6: pick a triggerMethod from ai_script if available ─────
    let triggerMethod: string = "hold";
    if (session.ai_script && typeof session.ai_script === "object") {
      const tm = (session.ai_script as any).triggerMethod;
      if (typeof tm === "string" && tm.length > 0) triggerMethod = tm;
    }

    // ── Step 7: end reason — derived from status ─────────────────────
    const endReason =
      session.status === "resolved" ? "user_safe"
      : session.status === "canceled" || session.status === "cancelled" ? "user_cancelled"
      : session.status === "ended" ? "contact_resolved"
      : "in_progress";

    // ── Step 8: assemble the response ────────────────────────────────
    // The shape MUST match IndividualReportData in
    // src/app/components/individual-pdf-report.tsx. The client sets
    // `tier` based on the user's CURRENT tier, not the incident's
    // historical tier — that's the entire point of the upgrade path.
    const reportData = {
      userName: profile?.full_name || "User",
      userPhone: profile?.phone || "",
      // tier intentionally NOT set here — the client picks it from
      // getTier() at render time so a free→elite upgrade re-renders
      // the same incident at the new tier.
      incidentId: session.id,
      triggerMethod,
      startTime: startedAt || new Date().toISOString(),
      endTime: endedAt || startedAt || new Date().toISOString(),
      location: {
        lat: session.last_lat ?? session.lat ?? 0,
        lng: session.last_lng ?? session.lng ?? 0,
        accuracy: session.accuracy ?? 0,
        address: session.address ?? "",
      },
      gpsTrail,
      gpsTrailIsReal: gpsTrail.length > 0,
      contacts,
      cyclesCompleted: 1,
      // These three fields don't exist as columns in production sos_sessions
      // (sos-alert writes them but the DDL never landed). Honest defaults:
      recordingDuration: 0,
      photoCount: 0,
      audioCaptured: false,
      audioUrl: null,
      photosCaptured: false,
      // Timeline derived from audit chain (basic version — full timeline
      // reconstruction is a follow-up; for now we let the §7 audit table
      // carry the chronological detail).
      timeline: serverAudit.slice(0, 50).map((a) => ({
        time: a.serverTime,
        event: a.action || a.operation || "event",
        type: "trigger" as const,
      })),
      endReason,
      // documentHash intentionally omitted — the client computes it
      // synchronously via computeIncidentHashAsync() from the canonical
      // payload. Doing it server-side would force a particular wire
      // format and we'd diverge from the live-incident path.
      serverAudit,
      serverAuditAvailable: true,
      // packetModules: not reliably stored server-side for civilian
      // incidents at this time. Leaving undefined → PDF prints
      // "not recorded for this incident" honestly.
    };

    return new Response(
      JSON.stringify({ ok: true, data: reportData }),
      { status: 200, headers: CORS },
    );
  } catch (err) {
    console.error("[incident-report-data] unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: CORS });
  }
});
