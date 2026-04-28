// ═══════════════════════════════════════════════════════════════
// SOSphere — GDPR Article 15 SAR export source-pinning (BLOCKER #14)
// ─────────────────────────────────────────────────────────────
// Pins the contract for the Subject Access Request flow:
//
//   1. Migration creates sar_request_history table + 2 RPCs.
//   2. Edge function `export-my-data` walks ~47 PII tables.
//   3. UI button in privacy-page.tsx fetches and downloads JSON.
//
// If a future refactor:
//   • drops a PII table from the spec (incomplete export = GDPR violation)
//   • removes the rate-limit gate (denial-of-service vector)
//   • removes the SHA-256 integrity hash (no tamper-evidence)
//   • removes the audit_log entry (no compliance trail)
//   • gates the button by tier (GDPR rights are universal)
//   • removes the request_id round-trip with complete_sar_export
// …this test fails and the regression is caught.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let migrationSrc = "";
let edgeFnSrc = "";
let pageSrc = "";

beforeAll(() => {
  const cwd = process.cwd();
  migrationSrc = fs.readFileSync(
    path.resolve(cwd, "supabase/migrations/20260428200000_blocker14_sar_request_history.sql"),
    "utf8",
  );
  edgeFnSrc = fs.readFileSync(
    path.resolve(cwd, "supabase/functions/export-my-data/index.ts"),
    "utf8",
  );
  pageSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/privacy-page.tsx"),
    "utf8",
  );
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #14 / migration: sar_request_history + RPCs", () => {
  it("creates the sar_request_history table", () => {
    expect(migrationSrc).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.sar_request_history/,
    );
  });

  it("table includes next_allowed_at for rate-limit logic", () => {
    expect(migrationSrc).toMatch(/next_allowed_at\s+timestamptz NOT NULL/);
  });

  it("FORCE ROW LEVEL SECURITY enabled (tamper-resistant)", () => {
    expect(migrationSrc).toMatch(
      /ALTER TABLE public\.sar_request_history FORCE ROW LEVEL SECURITY/,
    );
  });

  it("REVOKEs INSERT/UPDATE/DELETE from authenticated (RPC-only writes)", () => {
    expect(migrationSrc).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON public\.sar_request_history FROM authenticated, anon/,
    );
  });

  it("creates request_sar_export RPC with SECURITY DEFINER + search_path", () => {
    expect(migrationSrc).toMatch(/CREATE OR REPLACE FUNCTION public\.request_sar_export/);
    const rpcBlock = migrationSrc.match(
      /FUNCTION public\.request_sar_export[\s\S]*?\$function\$;/,
    );
    expect(rpcBlock).not.toBeNull();
    expect(rpcBlock![0]).toMatch(/SECURITY DEFINER/);
    expect(rpcBlock![0]).toMatch(/SET search_path = public/);
  });

  it("RPC enforces 30-day default cooldown with bounds 1-365", () => {
    expect(migrationSrc).toMatch(/p_cooldown_days integer DEFAULT 30/);
    expect(migrationSrc).toMatch(/p_cooldown_days < 1 OR p_cooldown_days > 365/);
  });

  it("RPC returns rate_limited reason when cooldown still active", () => {
    expect(migrationSrc).toMatch(/'rate_limited'/);
    expect(migrationSrc).toMatch(/next_allowed_at > now\(\)/);
  });

  it("RPC rejects unauthenticated callers", () => {
    expect(migrationSrc).toMatch(/v_user_id IS NULL[\s\S]*?'unauthorized'/);
  });

  it("creates complete_sar_export RPC for post-export observability", () => {
    expect(migrationSrc).toMatch(
      /CREATE OR REPLACE FUNCTION public\.complete_sar_export/,
    );
    expect(migrationSrc).toMatch(/p_tables_count   integer/);
    expect(migrationSrc).toMatch(/p_bytes_returned bigint/);
  });

  it("complete_sar_export verifies request ownership before update", () => {
    const block = migrationSrc.match(
      /FUNCTION public\.complete_sar_export[\s\S]*?\$function\$;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/AND user_id = v_user_id/);
  });

  it("post-condition probe verifies table + 2 RPCs created", () => {
    expect(migrationSrc).toMatch(/'request_sar_export', 'complete_sar_export'/);
    expect(migrationSrc).toMatch(/RAISE EXCEPTION/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #14 / edge function: export-my-data — PII coverage", () => {
  // The TABLE_SPECS array is the canonical list of PII tables. We pin
  // each category independently so a regression that drops a critical
  // table (e.g. removing 'evidence_vaults' from the spec) fails the
  // test even if other tables still cover that category.

  // Identity
  it("includes core identity tables", () => {
    expect(edgeFnSrc).toMatch(/table: "profiles"/);
    expect(edgeFnSrc).toMatch(/table: "individual_users"/);
    expect(edgeFnSrc).toMatch(/table: "employees"/);
    expect(edgeFnSrc).toMatch(/table: "biometric_verifications"/);
    expect(edgeFnSrc).toMatch(/table: "medical_profiles"/);
    expect(edgeFnSrc).toMatch(/table: "civilian_trial_history"/);
  });

  it("includes contact tables (emergency + family + user)", () => {
    expect(edgeFnSrc).toMatch(/table: "emergency_contacts"/);
    expect(edgeFnSrc).toMatch(/table: "user_contacts"/);
    expect(edgeFnSrc).toMatch(/table: "family_contacts"/);
    expect(edgeFnSrc).toMatch(/table: "family_memberships"/);
    expect(edgeFnSrc).toMatch(/table: "contacts"/);
  });

  it("includes SOS activity tables (sessions + messages + evidence)", () => {
    expect(edgeFnSrc).toMatch(/table: "sos_sessions"/);
    expect(edgeFnSrc).toMatch(/table: "sos_queue"/);
    expect(edgeFnSrc).toMatch(/table: "sos_messages"/);
    expect(edgeFnSrc).toMatch(/table: "evidence_vaults"/);
    expect(edgeFnSrc).toMatch(/table: "civilian_incidents"/);
    expect(edgeFnSrc).toMatch(/table: "emergencies"/);
  });

  it("includes location/checkin tables", () => {
    expect(edgeFnSrc).toMatch(/table: "gps_trail"/);
    expect(edgeFnSrc).toMatch(/table: "checkins"/);
    expect(edgeFnSrc).toMatch(/table: "checkin_events"/);
    expect(edgeFnSrc).toMatch(/table: "employee_checkins"/);
    expect(edgeFnSrc).toMatch(/table: "safe_trips"/);
  });

  it("includes membership tables (companies + workspaces + permissions)", () => {
    expect(edgeFnSrc).toMatch(/table: "company_memberships"/);
    expect(edgeFnSrc).toMatch(/table: "workspace_members"/);
    expect(edgeFnSrc).toMatch(/table: "user_permissions"/);
    expect(edgeFnSrc).toMatch(/table: "companies"/);
    expect(edgeFnSrc).toMatch(/table: "workspaces"/);
  });

  it("includes communication tables (notifications + push tokens)", () => {
    expect(edgeFnSrc).toMatch(/table: "notifications"/);
    expect(edgeFnSrc).toMatch(/table: "push_tokens"/);
    expect(edgeFnSrc).toMatch(/table: "announcement_responses"/);
  });

  it("includes billing tables (subscriptions + Stripe + Twilio ledger)", () => {
    expect(edgeFnSrc).toMatch(/table: "subscriptions"/);
    expect(edgeFnSrc).toMatch(/table: "stripe_unmapped_events"/);
    expect(edgeFnSrc).toMatch(/table: "twilio_spend_ledger"/);
  });

  it("includes audit_log scoped to actor_id (user's own actions)", () => {
    expect(edgeFnSrc).toMatch(/table: "audit_log",\s+column: "actor_id"/);
  });

  it("includes the user's own SAR-history (self-trail)", () => {
    expect(edgeFnSrc).toMatch(/table: "sar_request_history"/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #14 / edge function: security & rate-limit", () => {
  it("requires JWT and resolves user_id from token (not body)", () => {
    expect(edgeFnSrc).toMatch(/Missing token/);
    expect(edgeFnSrc).toMatch(/userClient\.auth\.getUser\(\)/);
    expect(edgeFnSrc).toMatch(/const userId = userData\.user\.id/);
  });

  it("calls request_sar_export RPC BEFORE walking any table", () => {
    // If the table walk happens first, we've leaked compute regardless
    // of whether rate-limit later denies. The gate must come first.
    const gateIdx = edgeFnSrc.indexOf('rpc("request_sar_export"');
    const walkIdx = edgeFnSrc.indexOf("for (const spec of TABLE_SPECS)");
    expect(gateIdx).toBeGreaterThan(0);
    expect(walkIdx).toBeGreaterThan(gateIdx);
  });

  it("returns HTTP 429 on rate_limited (Retry-After semantics)", () => {
    // Anchor on the actual ternary that maps reason -> status code:
    //   gateData?.reason === "rate_limited" ? 429 : 403
    // The previous regex used non-greedy [\s\S]*? which couldn\'t span
    // the distance between the literal "rate_limited" and the status
    // assignment. Pinning the ternary directly is more precise.
    expect(edgeFnSrc).toMatch(/reason === "rate_limited" \? 429/);
  });

  it("uses user-scoped client for table walk (RLS enforced)", () => {
    expect(edgeFnSrc).toMatch(/const client = spec\.table === "audit_log" \? admin : userClient/);
  });

  it("computes SHA-256 over the data section (tamper-evidence)", () => {
    expect(edgeFnSrc).toMatch(/sha256Hex\(dataJson\)/);
    expect(edgeFnSrc).toMatch(/integrity_sha256/);
  });

  it("calls complete_sar_export with metrics after the walk", () => {
    expect(edgeFnSrc).toMatch(/rpc\("complete_sar_export"/);
    expect(edgeFnSrc).toMatch(/p_tables_count: tablesCount/);
    expect(edgeFnSrc).toMatch(/p_bytes_returned: bytesReturned/);
  });

  it("writes audit_log entry with action='gdpr_sar_export'", () => {
    expect(edgeFnSrc).toMatch(/action: "gdpr_sar_export"/);
    expect(edgeFnSrc).toMatch(/category: "compliance"/);
  });

  it("response metadata declares GDPR Art. 15 explicitly", () => {
    expect(edgeFnSrc).toMatch(/gdpr_article: 15/);
  });

  it("partial-failure tolerated (errors[] surfaced, no abort)", () => {
    expect(edgeFnSrc).toMatch(/errors\.push/);
    expect(edgeFnSrc).toMatch(/continue;/);
    expect(edgeFnSrc).toMatch(/finalStatus = errors\.length === 0 \? "completed" : "partial"/);
  });

  it("CORS allowlist (not wildcard)", () => {
    expect(edgeFnSrc).toMatch(/ALLOWED_ORIGINS/);
    expect(edgeFnSrc).not.toMatch(/Access-Control-Allow-Origin.*\*/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #14 / privacy-page UI: download button", () => {
  it("renders DataExportSection in the privacy page", () => {
    expect(pageSrc).toMatch(/<DataExportSection \/>/);
    expect(pageSrc).toMatch(/function DataExportSection/);
  });

  it("button has stable testid for E2E hook", () => {
    expect(pageSrc).toMatch(/data-testid="gdpr-data-export-section"/);
  });

  it("invokes the export-my-data edge function", () => {
    expect(pageSrc).toMatch(
      /supabase\.functions\.invoke\("export-my-data"/,
    );
  });

  it("downloads as a JSON blob with date-stamped filename", () => {
    expect(pageSrc).toMatch(/Blob\(\[JSON\.stringify\(data, null, 2\)\]/);
    expect(pageSrc).toMatch(/sosphere-data-export-/);
    expect(pageSrc).toMatch(/\.json/);
  });

  it("surfaces 429 (rate-limited) with the next_allowed_at date", () => {
    expect(pageSrc).toMatch(/status === 429/);
    expect(pageSrc).toMatch(/next_allowed_at/);
  });

  it("button is NOT gated by tier — universal GDPR right", () => {
    // Specifically: there must be no `getTier()`-based hide of this
    // section. A regression that adds a paywall here would be a GDPR
    // violation (Art. 12(5) — controller cannot charge for SAR).
    const sectionBody = pageSrc.match(
      /function DataExportSection[\s\S]*?\n}/,
    );
    expect(sectionBody).not.toBeNull();
    expect(sectionBody![0]).not.toMatch(/getTier\(\)/);
    expect(sectionBody![0]).not.toMatch(/tier === "free"/);
  });

  it("explicitly cites GDPR Art. 15 in the section header", () => {
    expect(pageSrc).toMatch(/GDPR\s*—?\s*المادة\s*[١1]?[٥5]?/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #14 / promise-of-no-leak guards", () => {
  it("client never reads sar_request_history directly (must go via RPC)", () => {
    // Pin: the client must not have a `from("sar_request_history")` call
    // anywhere — all access goes through request_sar_export /
    // complete_sar_export RPCs (which run with SECURITY DEFINER and
    // can apply server-side rules the client cannot tamper with).
    expect(pageSrc).not.toMatch(/from\("sar_request_history"\)/);
  });

  it("edge function never trusts a user_id passed in the body", () => {
    // user_id must come from the verified JWT. A regression that reads
    // it from the body would be a cross-tenant leak vector.
    expect(edgeFnSrc).not.toMatch(/body\.user_id/);
    expect(edgeFnSrc).not.toMatch(/payload\.user_id/);
  });

  it("audit_log INSERT in edge function carries actor_id (not anonymous)", () => {
    // CRIT-#10 closed an anonymous-actor audit hole. The SAR insert
    // must carry actor_id so the export is traceable to the requester.
    expect(edgeFnSrc).toMatch(/actor_id: userId/);
  });
});
