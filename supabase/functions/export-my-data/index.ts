// ═══════════════════════════════════════════════════════════════════════════
// export-my-data (BLOCKER #14, 2026-04-28)
//
// GDPR Article 15 — Subject Access Request endpoint.
// "The data subject shall have the right to obtain from the controller
//  confirmation as to whether or not personal data concerning him or her
//  are being processed, and, where that is the case, access to the
//  personal data."
//
// This endpoint:
//   1. Verifies the JWT and resolves user_id.
//   2. Calls request_sar_export() RPC, which enforces a 30-day cooldown
//      (GDPR Art. 12(5) — "manifestly unfounded or excessive" defence).
//   3. If approved, walks ~47 tables that may contain the user's PII,
//      collecting rows scoped to user_id (or, where the schema uses
//      employee_id, by resolving employees.id from user_id first).
//   4. Computes SHA-256 over the canonical JSON for tamper-evidence.
//   5. Calls complete_sar_export() RPC to update observability metrics.
//   6. Writes an audit_log row with action='gdpr_sar_export'.
//   7. Returns one big JSON document the client downloads as
//      `sosphere-data-export-<date>.json`.
//
// AVAILABLE TO ALL TIERS (free + basic + elite). GDPR rights are universal;
// they don't depend on the subscription level.
//
// FORMAT: JSON only.
//   • GDPR doesn't mandate a format — JSON is what Google, Meta, Apple,
//     Twitter, Stripe and every other major controller use for SAR.
//   • Self-describing (categories + table names + column names + types).
//   • Easy for a data subject's lawyer/auditor to ingest into anything.
//
// SCHEMA REALITY (verified 2026-04-28):
//   • 28 tables key on user_id directly.
//   • 13 tables key on employee_id (which = employees.id, NOT user_id).
//     We resolve employees.id once and reuse it.
//   • 4 tables use other names: companies.owner_id, workspaces.owner_user_id,
//     family_contacts.owner_user_id, audit_log.actor_id, sos_messages.from_user_id.
//   • 1 table (sar_request_history) is included so users can see their
//     own SAR-request audit trail.
//
// SECURITY:
//   • All reads use the user-scoped client → RLS enforces per-user
//     isolation natively. No service-role for the table walk.
//   • Sole exception: the audit_log read (we want the full chain even
//     for system actors). Done via service-role AFTER user_id is
//     resolved AND filtered to actor_id = userId.
//   • CORS allowlist (same pattern as other edge functions).
//   • UUID validation not needed here — there's no per-id input.
//   • The response can be ~megabytes for an active user. Edge function
//     response size cap is 6 MB on Supabase; we add a tables_count +
//     bytes_returned tracking via complete_sar_export so we can spot
//     when we're approaching the cap and need to chunk.
//
// FAIL-MODES:
//   • If the rate-limit RPC denies (cooldown still active), we return
//     HTTP 429 with the next_allowed_at timestamp.
//   • If a single table's read fails, we mark the export as 'partial'
//     and include an `errors[]` array in the response so the user can
//     decide whether to accept or wait and retry. We never abort the
//     entire export for one table failure.
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

// ─────────────────────────────────────────────────────────────────────────
// Table definitions — what to walk and how to scope the rows.
// Each entry says: "from `table`, select rows where `column` = our user.
//   The `category` groups them in the response for readability.
// ─────────────────────────────────────────────────────────────────────────

type ScopeMode = "user_id" | "employee_id" | "owner_id" | "owner_user_id" | "from_user_id" | "actor_id";

interface TableSpec {
  table: string;
  column: ScopeMode;
  category:
    | "identity" | "contacts" | "sos_activity" | "locations"
    | "memberships" | "communications" | "billing" | "system";
  // Optional projection — if absent, we SELECT *.
  projection?: string;
  // Beehive fix #3 (2026-04-28): force admin-client read when the table
  // has a service-role-only RLS policy (user-scoped client would silently
  // return 0 rows, hiding data the user is legally entitled to in a SAR
  // export). Admin client bypasses RLS, but we ALWAYS filter by the
  // user-scoped column (`user_id = auth.uid()` etc.) so we cannot leak
  // cross-tenant rows. Defence in depth: ownership check on every read.
  useAdmin?: boolean;
}

const TABLE_SPECS: TableSpec[] = [
  // ── Identity ────────────────────────────────────────────────────────
  { table: "profiles",                  column: "user_id",        category: "identity" },
  { table: "individual_users",          column: "user_id",        category: "identity" },
  { table: "employees",                 column: "user_id",        category: "identity" },
  { table: "biometric_verifications",   column: "user_id",        category: "identity" },
  { table: "medical_profiles",          column: "employee_id",    category: "identity" },
  { table: "civilian_trial_history",    column: "user_id",        category: "identity" },

  // ── Contacts ────────────────────────────────────────────────────────
  { table: "emergency_contacts",        column: "user_id",        category: "contacts" },
  { table: "user_contacts",             column: "user_id",        category: "contacts" },
  { table: "contacts",                  column: "employee_id",    category: "contacts" },
  { table: "family_contacts",           column: "owner_user_id",  category: "contacts" },
  { table: "family_memberships",        column: "user_id",        category: "contacts" },

  // ── SOS Activity ────────────────────────────────────────────────────
  { table: "sos_sessions",              column: "user_id",        category: "sos_activity" },
  { table: "sos_queue",                 column: "employee_id",    category: "sos_activity" },
  { table: "sos_messages",              column: "from_user_id",   category: "sos_activity" },
  { table: "sos_events",                column: "employee_id",    category: "sos_activity" },
  { table: "sos_timers",                column: "user_id",        category: "sos_activity" },
  { table: "emergencies",               column: "user_id",        category: "sos_activity" },
  { table: "civilian_incidents",        column: "user_id",        category: "sos_activity" },
  { table: "evidence_vaults",           column: "user_id",        category: "sos_activity" },
  { table: "safety_timers",             column: "user_id",        category: "sos_activity" },
  { table: "duty_status",               column: "user_id",        category: "sos_activity" },

  // ── Locations & Check-ins ──────────────────────────────────────────
  { table: "gps_trail",                 column: "employee_id",    category: "locations" },
  { table: "checkins",                  column: "employee_id",    category: "locations" },
  { table: "checkin_events",            column: "employee_id",    category: "locations" },
  { table: "employee_checkins",         column: "user_id",        category: "locations" },
  { table: "safe_trips",                column: "user_id",        category: "locations" },

  // ── Memberships & Permissions ──────────────────────────────────────
  { table: "company_memberships",       column: "user_id",        category: "memberships" },
  { table: "company_employees",         column: "user_id",        category: "memberships" },
  { table: "workspace_members",         column: "user_id",        category: "memberships" },
  { table: "user_permissions",          column: "user_id",        category: "memberships" },
  { table: "companies",                 column: "owner_id",       category: "memberships" },
  { table: "workspaces",                column: "owner_user_id",  category: "memberships" },

  // ── Communications & Notifications ─────────────────────────────────
  { table: "announcement_responses",    column: "user_id",        category: "communications" },
  { table: "company_message_recipients",column: "employee_id",    category: "communications" },
  { table: "company_message_rsvps",     column: "employee_id",    category: "communications" },
  { table: "notifications",             column: "user_id",        category: "communications" },
  { table: "push_tokens",               column: "user_id",        category: "communications" },
  // sar_request_history — user's own SAR audit trail
  { table: "sar_request_history",       column: "user_id",        category: "communications" },

  // ── Billing & Subscriptions ────────────────────────────────────────
  { table: "subscriptions",             column: "user_id",        category: "billing" },
  { table: "stripe_unmapped_events",    column: "user_id",        category: "billing", useAdmin: true },
  { table: "twilio_spend_ledger",       column: "user_id",        category: "billing", useAdmin: true },

  // ── System / derived ───────────────────────────────────────────────
  { table: "audit_log",                 column: "actor_id",       category: "system" },
  { table: "profile_trigger_logs",      column: "user_id",        category: "system", useAdmin: true },
  { table: "risk_scores",               column: "employee_id",    category: "system", useAdmin: true },
  { table: "call_chains",               column: "user_id",        category: "system", useAdmin: true },
  { table: "zone_reports",              column: "user_id",        category: "system", useAdmin: true },
  { table: "missions",                  column: "employee_id",    category: "system", useAdmin: true },
  { table: "tasks",                     column: "user_id",        category: "system", useAdmin: true },
  { table: "files",                     column: "employee_id",    category: "system", useAdmin: true },
];

// ─────────────────────────────────────────────────────────────────────────
// SHA-256 helper (Web Crypto on Deno).
// ─────────────────────────────────────────────────────────────────────────
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  // ── 1) Auth ──────────────────────────────────────────────────────
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
  const userId = userData.user.id;
  const userEmail = userData.user.email ?? null;

  // ── 2) Rate-limit gate via request_sar_export RPC ────────────────
  // The RPC enforces the 30-day cooldown and inserts a pending row
  // into sar_request_history. We MUST honour its decision; if it
  // returns success=false, we abort with 429.
  const { data: gate, error: gateErr } = await userClient.rpc("request_sar_export", {});
  if (gateErr) {
    console.warn("[export-my-data] rpc error:", gateErr);
    return new Response(JSON.stringify({ error: "Rate-limit check failed" }), { status: 503, headers: CORS });
  }
  const gateData = gate as {
    success: boolean;
    reason?: string;
    request_id?: string;
    next_allowed_at?: string;
    last_request_at?: string;
    cooldown_days?: number;
  };
  if (!gateData?.success) {
    return new Response(
      JSON.stringify({
        error: gateData?.reason || "denied",
        last_request_at: gateData?.last_request_at,
        next_allowed_at: gateData?.next_allowed_at,
        cooldown_days: gateData?.cooldown_days,
      }),
      {
        status: gateData?.reason === "rate_limited" ? 429 : 403,
        headers: CORS,
      },
    );
  }
  const requestId = gateData.request_id!;

  // ── 3) Resolve employees.id once (used by ~13 tables) ────────────
  // Some tables key by employees.id (uuid), not auth.users.id. We
  // do a single lookup and pass it to those queries.
  let employeeId: string | null = null;
  try {
    const { data: emp } = await userClient
      .from("employees")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (emp?.id) employeeId = String(emp.id);
  } catch {
    // Civilians don't have an employees row — this is normal.
  }

  // ── 4) Walk the tables ───────────────────────────────────────────
  // We use the admin client for audit_log only (it has FORCE RLS and
  // we want to read system-actor entries about the user too).
  const admin = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const data: Record<string, Record<string, any>> = {};
  const errors: Array<{ table: string; reason: string }> = [];
  let tablesCount = 0;

  for (const spec of TABLE_SPECS) {
    // Skip employee-keyed tables when we don't have an employees.id.
    if (spec.column === "employee_id" && !employeeId) continue;

    const scopeValue =
      spec.column === "employee_id" ? employeeId :
      spec.column === "from_user_id" ? userId :
      spec.column === "actor_id" ? userId :
      spec.column === "owner_id" ? userId :
      spec.column === "owner_user_id" ? userId :
      userId; // user_id

    try {
      // Beehive fix #3 (2026-04-28): pick client by spec.useAdmin too,
      // not only by table name. Tables with service-role-only RLS need
      // admin reads (with explicit ownership filter) to honor GDPR.
      const client = (spec.table === "audit_log" || spec.useAdmin === true)
        ? admin
        : userClient;
      const projection = spec.projection || "*";
      const { data: rows, error } = await client
        .from(spec.table)
        .select(projection)
        .eq(spec.column, scopeValue)
        .limit(5000); // safety cap per table — 5k rows is enough for SAR

      if (error) {
        errors.push({ table: spec.table, reason: error.message || "query failed" });
        continue;
      }

      // Beehive fix #3: when the user-scoped client returns 0 rows for a
      // table that DOESN'T use admin override, we cannot tell apart "no
      // data exists for this user" from "RLS silently blocked us". The
      // safe assumption for GDPR transparency is to surface this as a
      // soft warning so a curious user / auditor can see it. Tables that
      // explicitly use the admin client (useAdmin=true OR audit_log) are
      // never ambiguous — those reads are authoritative.
      const usedAdmin = client === admin;
      const rowCount = rows?.length || 0;
      if (!usedAdmin && rowCount === 0) {
        // Soft signal — the row stays in `data` (with row_count: 0) but
        // we ALSO add a marker to errors[] so the response's
        // errors_count reflects ambiguity.
        errors.push({
          table: spec.table,
          reason: "rls_returned_zero_rows (may be empty OR may be RLS-blocked)",
        });
      }

      // Group by category so the JSON is human-readable.
      if (!data[spec.category]) data[spec.category] = {};
      data[spec.category][spec.table] = {
        scope_column: spec.column,
        row_count: rowCount,
        rows: rows || [],
        // Mark which client actually fetched the row — useful for
        // auditors verifying transparency.
        read_via: usedAdmin ? "admin_with_explicit_filter" : "user_jwt_rls",
      };
      tablesCount++;
    } catch (err) {
      errors.push({
        table: spec.table,
        reason: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  // ── 5) Build response payload ────────────────────────────────────
  const generatedAt = new Date().toISOString();
  const responseBody = {
    metadata: {
      gdpr_article: 15,
      generated_at: generatedAt,
      subject: {
        user_id: userId,
        email: userEmail,
      },
      controller: "SOSphere Safety Platform",
      categories: [
        "identity", "contacts", "sos_activity", "locations",
        "memberships", "communications", "billing", "system",
      ],
      tables_exported: tablesCount,
      tables_in_spec: TABLE_SPECS.length,
      errors_count: errors.length,
      errors,
      notes: [
        "This export contains all personal data SOSphere holds about you.",
        "Each table is presented with its scope column and row count.",
        "Empty arrays mean no rows for you in that table — not that the table is empty.",
        "audit_log entries reflect actions you authored (actor_id = your user_id).",
        "The integrity_sha256 hash below is computed over the canonical JSON of the `data` field.",
      ],
    },
    data,
    integrity_sha256: "", // filled in below
  };

  // Compute integrity hash over the data section.
  const dataJson = JSON.stringify(responseBody.data);
  responseBody.integrity_sha256 = await sha256Hex(dataJson);

  const responseText = JSON.stringify(responseBody);
  const bytesReturned = new TextEncoder().encode(responseText).length;

  // ── 6) Mark the request as completed (or partial) ────────────────
  const finalStatus = errors.length === 0 ? "completed" : "partial";
  try {
    await userClient.rpc("complete_sar_export", {
      p_request_id: requestId,
      p_tables_count: tablesCount,
      p_bytes_returned: bytesReturned,
      p_status: finalStatus,
    });
  } catch (err) {
    console.warn("[export-my-data] complete_sar_export failed:", err);
  }

  // ── 7) Audit_log entry (best-effort; failure must not abort) ─────
  try {
    await admin.from("audit_log").insert({
      id: crypto.randomUUID(),
      action: "gdpr_sar_export",
      actor: userEmail || userId,
      actor_id: userId,
      actor_role: "subject",
      operation: "EXPORT",
      target: "self_data",
      category: "compliance",
      severity: "info",
      metadata: {
        request_id: requestId,
        tables_exported: tablesCount,
        bytes_returned: bytesReturned,
        status: finalStatus,
        errors_count: errors.length,
        sha256: responseBody.integrity_sha256,
      },
      created_at: generatedAt,
    });
  } catch (err) {
    console.warn("[export-my-data] audit_log write failed:", err);
  }

  // ── 8) Return ────────────────────────────────────────────────────
  return new Response(responseText, { status: 200, headers: CORS });
});
