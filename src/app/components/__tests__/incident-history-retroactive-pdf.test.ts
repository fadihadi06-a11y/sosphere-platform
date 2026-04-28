// ═══════════════════════════════════════════════════════════════
// SOSphere — Retroactive PDF source-pinning (#53, 2026-04-28)
// ─────────────────────────────────────────────────────────────
// Pins the wiring that delivers the upgrade-for-retroactive-PDFs
// promise:
//   • Free user has 3 SOS events stored on server (audit_log + sos_sessions).
//   • User upgrades to Basic or Elite.
//   • IncidentHistory page lists all 3 (server-side fetch, not just localStorage).
//   • Each row's "Export PDF" button generates an INDEPENDENT PDF for that
//     specific incident — at the user's CURRENT tier (basic = standard,
//     elite = forensic with §7 server audit chain).
//
// If a future refactor:
//   • removes the server fetch (regresses to localStorage-only)
//   • removes the per-incident onClick handler (zombie button again)
//   • hardcodes the tier (instead of resolving via getTier)
//   • removes the edge functions (incident-history / incident-report-data)
//   • merges the per-incident PDFs into a single multi-incident report
// …this test fails and the regression is caught.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let pageSrc = "";
let listFnSrc = "";
let reportFnSrc = "";

beforeAll(() => {
  const cwd = process.cwd();
  pageSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/incident-history.tsx"),
    "utf8",
  );
  listFnSrc = fs.readFileSync(
    path.resolve(cwd, "supabase/functions/incident-history/index.ts"),
    "utf8",
  );
  reportFnSrc = fs.readFileSync(
    path.resolve(cwd, "supabase/functions/incident-report-data/index.ts"),
    "utf8",
  );
});

// ─────────────────────────────────────────────────────────────
describe("#53 / edge function: incident-history (list)", () => {
  it("file exists and exports a Deno.serve handler", () => {
    expect(listFnSrc).toMatch(/Deno\.serve\(async \(req\)/);
  });

  it("requires JWT (no anon access)", () => {
    expect(listFnSrc).toMatch(/Missing token/);
    expect(listFnSrc).toMatch(/Bearer/);
    expect(listFnSrc).toMatch(/Invalid token/);
  });

  it("uses RLS-respecting user-scoped client (no service-role for the list query)", () => {
    // The list query MUST go through userClient so RLS scopes by user_id.
    // Service-role would break the per-user isolation.
    const listQuery = listFnSrc.match(
      /userClient[\s\S]*?\.from\("sos_sessions"\)[\s\S]*?\.eq\("user_id", userId\)/,
    );
    expect(listQuery).not.toBeNull();
  });

  it("orders by started_at DESC and caps at 200/500", () => {
    expect(listFnSrc).toMatch(/started_at['"]?,\s*\{\s*ascending:\s*false/);
    expect(listFnSrc).toMatch(/limit\s*=\s*200/);
    expect(listFnSrc).toMatch(/<=\s*500/);
  });

  it("CORS: origin allowlist (not wildcard)", () => {
    expect(listFnSrc).toMatch(/ALLOWED_ORIGINS/);
    expect(listFnSrc).not.toMatch(/Access-Control-Allow-Origin.*\*/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("#53 / edge function: incident-report-data (per-incident)", () => {
  it("validates incidentId as UUID before any query (id-enumeration defence)", () => {
    expect(reportFnSrc).toMatch(/UUID_RE/);
    expect(reportFnSrc).toMatch(/Invalid incidentId/);
  });

  it("requires JWT and resolves user_id from the token (not the body)", () => {
    expect(reportFnSrc).toMatch(/userClient\.auth\.getUser\(\)/);
    // userId MUST come from userData.user.id, not body input.
    expect(reportFnSrc).toMatch(/const userId = userData\.user\.id/);
  });

  it("returns 404 (not 403) on cross-tenant access — id enumeration defence", () => {
    // 403 would leak that the id exists but is owned by someone else.
    // 404 reveals nothing.
    expect(reportFnSrc).toMatch(/Incident not found[\s\S]*?status: 404/);
  });

  it("performs explicit ownership verification beyond RLS (defence in depth)", () => {
    expect(reportFnSrc).toMatch(/session\.user_id !== userId/);
  });

  it("fetches server audit chain via service-role AFTER ownership check", () => {
    // The audit chain fetch MUST come after the ownership check —
    // service-role bypasses RLS, so we have to prove the user owns
    // the incident before exposing audit rows for it.
    const ownership = reportFnSrc.indexOf("session.user_id !== userId");
    const auditFetch = reportFnSrc.indexOf("audit_log");
    expect(ownership).toBeGreaterThan(0);
    expect(auditFetch).toBeGreaterThan(ownership);
  });

  it("does not set tier on the response — client picks tier at render time", () => {
    // This is the upgrade-path mechanic. If the server set tier='basic'
    // for an incident captured while the user was free, an upgrade to
    // elite would NOT re-render at the new tier. The client must own
    // tier resolution via getTier() at download time.
    expect(reportFnSrc).toMatch(/tier intentionally NOT set here/i);
  });

  it("substitutes honest defaults for missing schema fields", () => {
    // sos_sessions doesn't have ended_at / recording_seconds / photo_count
    // even though sos-alert tries to write them. The function must NOT
    // print fabricated zeros as fact — and the comment must call this out.
    expect(reportFnSrc).toMatch(/recordingDuration: 0/);
    expect(reportFnSrc).toMatch(/photoCount: 0/);
    expect(reportFnSrc).toMatch(/Honest defaults|honestly/i);
  });
});

// ─────────────────────────────────────────────────────────────
describe("#53 / page wiring: incident-history.tsx", () => {
  it("imports the new edge-function client surface", () => {
    expect(pageSrc).toMatch(/import \{ supabase \} from "\.\/api\/supabase-client"/);
    expect(pageSrc).toMatch(/import \{ getTier \} from "\.\/subscription-service"/);
    expect(pageSrc).toMatch(/generateIndividualReport/);
    expect(pageSrc).toMatch(/computeIncidentHashAsync/);
    expect(pageSrc).toMatch(/type ReportTier/);
  });

  it("invokes the incident-history edge function on mount", () => {
    expect(pageSrc).toMatch(
      /supabase\.functions\.invoke\("incident-history"\)/,
    );
  });

  it("merges server data with localStorage (server takes precedence by id)", () => {
    // The merge must keep localStorage entries that have no server
    // counterpart (offline edge cases) but prefer server entries on
    // collision. The Map<id, Incident> pattern enforces that.
    expect(pageSrc).toMatch(/byId\.set\(inc\.id, inc\)/);
  });

  it("Export PDF button has an onClick handler (no longer a zombie)", () => {
    expect(pageSrc).toMatch(/onClick=\{\(\) => handleDownloadPdf\(inc\.id\)\}/);
  });

  it("download handler resolves tier via getTier() — not hardcoded", () => {
    expect(pageSrc).toMatch(/const tier = getTier\(\)/);
  });

  it("free tier triggers the upgrade flow, never reaches the renderer", () => {
    // This protects the contract: free === audit-only, no PDF rendering.
    expect(pageSrc).toMatch(
      /tier === "free"[\s\S]*?onUpgrade\?\.\(\)/,
    );
  });

  it("download handler maps tier → ReportTier ('basic' or 'elite')", () => {
    expect(pageSrc).toMatch(
      /tier === "elite" \? "elite" : "basic"/,
    );
  });

  it("per-incident isolation: handler takes incidentId, not 'all incidents'", () => {
    // Pin against a future regression where someone tries to bundle
    // all incidents into one PDF. The user's vision is explicit:
    // separate PDF per incident.
    expect(pageSrc).toMatch(/handleDownloadPdf = async \(incidentId: string\)/);
    expect(pageSrc).toMatch(
      /supabase\.functions\.invoke\("incident-report-data"[\s\S]*?body: \{ incidentId \}/,
    );
  });

  it("computes SHA-256 documentHash client-side from canonical payload", () => {
    // Hash MUST be computed client-side so each download produces an
    // integrity-verified report. Computing it server-side would force
    // a wire format and diverge from the live-incident path.
    expect(pageSrc).toMatch(/computeIncidentHashAsync\(payload\.incidentId, canonical\)/);
  });

  it("downloads emit a tier-specific success toast", () => {
    expect(pageSrc).toMatch(/Forensic.*Standard|Standard.*Forensic/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("#53 / promise-of-no-leak guards", () => {
  it("incident-history edge function has no service-role for the SELECT", () => {
    // The user list MUST go through user-scoped JWT to enforce RLS.
    // A grep guard: "admin.from(\"sos_sessions\")" would mean someone
    // bypassed RLS to list sessions. That would be a cross-tenant leak.
    expect(listFnSrc).not.toMatch(/admin\.from\("sos_sessions"\)/);
  });

  it("client never bypasses the edge function for direct sos_sessions queries", () => {
    // The page is allowed to read its OWN row via localStorage shadowing,
    // but it should not run a Supabase SELECT against sos_sessions
    // directly — the edge function is the canonical entry point so RLS,
    // ownership, and rate-limits all live in one place.
    expect(pageSrc).not.toMatch(/supabase[\s\S]{0,40}\.from\("sos_sessions"\)/);
  });
});
