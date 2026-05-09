// ═══════════════════════════════════════════════════════════════
// SOSphere — L1-E Pipeline Health Dashboard architectural invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract for the operator-facing health summary RPC
// AND the React page that consumes it. Companion to:
//   • supabase/migrations/20260508190000_l1e_pipeline_health_dashboard_rpc.sql
//   • src/app/components/dashboard-pipeline-health-page.tsx
//
// If a future refactor:
//   • removes the admin/owner gate from the RPC (anyone can read org-wide telemetry)
//   • removes the locked search_path (mutable-search-path attack vector)
//   • opens EXECUTE to anon (DoS / data leak)
//   • removes the Sentry alarm wiring from the page (silent regression — failures
//     visible on screen but never paged)
// …this test fails and the regression is caught.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let mig = "";
let page = "";

beforeAll(() => {
  mig = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260508190000_l1e_pipeline_health_dashboard_rpc.sql"),
    "utf8",
  );
  page = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/dashboard-pipeline-health-page.tsx"),
    "utf8",
  );
});

// ─── 1. RPC FUNCTION CONTRACT ────────────────────────────────
describe("L1-E: get_pipeline_health_summary shape", () => {
  it("is a SECURITY DEFINER function with locked search_path", () => {
    expect(mig).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_pipeline_health_summary[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path\s*=\s*'public',\s*'pg_temp'/,
    );
  });

  it("is STABLE (read-only — never INSERTs/UPDATEs)", () => {
    expect(mig).toMatch(/STABLE/);
  });

  it("returns jsonb (single round-trip payload)", () => {
    expect(mig).toMatch(/RETURNS jsonb/);
  });

  it("rejects unauthenticated callers with 'unauthorized: must be logged in'", () => {
    expect(mig).toMatch(/IF v_caller IS NULL THEN[\s\S]*?RAISE EXCEPTION 'unauthorized: must be logged in'/);
  });

  it("requires active admin/owner membership in some company", () => {
    expect(mig).toMatch(/EXISTS\s*\(\s*\n?\s*SELECT 1 FROM public\.company_memberships[\s\S]*?role IN \('admin','owner'\)/);
    expect(mig).toMatch(/RAISE EXCEPTION 'unauthorized: caller is not an active admin\/owner of any company'/);
  });

  it("aggregates synthetic_probe_health (L1-D dependency)", () => {
    expect(mig).toMatch(/FROM public\.synthetic_probe_health/);
  });

  it("computes real_24h totals filtered to is_synthetic = false", () => {
    expect(mig).toMatch(/count\(\*\) FILTER \(WHERE is_synthetic = false\)/);
  });

  it("returns at most 10 recent failures (forensic triage budget)", () => {
    expect(mig).toMatch(/LIMIT 10/);
  });

  it("scopes recent failures to last 24 hours", () => {
    // appears twice in the function — once for real_24h aggregate, once for failures list
    const matches = mig.match(/created_at > now\(\) - interval '24 hours'/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

// ─── 2. PERMISSIONS — defense in depth ───────────────────────
describe("L1-E: RPC EXECUTE grants are double-locked", () => {
  it("REVOKE EXECUTE FROM PUBLIC", () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_pipeline_health_summary\(\)\s+FROM PUBLIC/);
  });

  it("REVOKE EXECUTE FROM anon (explicit, not just via PUBLIC)", () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_pipeline_health_summary\(\)\s+FROM anon/);
  });

  it("GRANT EXECUTE TO authenticated (the internal admin check is the real gate)", () => {
    expect(mig).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.get_pipeline_health_summary\(\)\s+TO authenticated/);
  });
});

// ─── 3. PAGE CONTRACT — Sentry alarm wiring is mandatory ─────
describe("L1-E: PipelineHealthPage Sentry alarm contract", () => {
  it("imports captureException from sentry-client", () => {
    expect(page).toMatch(/import\s*\{[^}]*captureException[^}]*\}\s*from\s*["']\.\/sentry-client["']/);
  });

  it("calls captureException for detected anomalies (alarm-on-anomaly)", () => {
    expect(page).toMatch(/captureException\(/);
    expect(page).toMatch(/area:\s*["']l1e-pipeline-health["']/);
  });

  it("declares all four anomaly levels (ok / warning / error / fatal)", () => {
    expect(page).toMatch(/type AnomalyLevel\s*=\s*["']ok["']\s*\|\s*["']warning["']\s*\|\s*["']error["']\s*\|\s*["']fatal["']/);
  });

  it("dedupes Sentry events by signature (no spam on parked dashboards)", () => {
    // Must track which signatures have already been fired in a ref/Set so
    // an operator who leaves the page open doesn't generate one event per poll.
    expect(page).toMatch(/firedSentry/);
    expect(page).toMatch(/firedSentry\.current\.add/);
  });

  it("flags 'probe-stuck' when synthetic probe is older than the threshold", () => {
    expect(page).toMatch(/STALE_PROBE_THRESHOLD_SEC/);
    expect(page).toMatch(/signature:\s*["']probe-stuck["']/);
  });

  it("flags 'probe-never-ran' as fatal (highest severity)", () => {
    expect(page).toMatch(/signature:\s*["']probe-never-ran["']/);
    expect(page).toMatch(/level:\s*["']fatal["']/);
  });

  it("flags 'real-failures-24h' as error when real users impacted", () => {
    expect(page).toMatch(/signature:\s*["']real-failures-24h["']/);
  });
});

// ─── 4. PAGE TYPES MUST MATCH synthetic_probe_health VIEW ──
// Regression: a hand-rolled SyntheticHealth interface had a phantom
// `successes_last_24h` field that the view doesn't expose. The UI read
// `undefined`, divided by it, and rendered "0% success rate" in orange
// on production while the pipeline was actually 100% healthy. This test
// keeps the interface honest by enforcing the LACK of phantom fields.
describe("L1-E: SyntheticHealth interface matches the view", () => {
  it("does NOT declare phantom successes_last_* fields (view only exposes failures)", () => {
    // Strip line + block comments so the documentation explaining WHY the
    // phantom field was removed doesn't trip the regex (this regression
    // already happened once during the initial fix).
    const codeOnly = page
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/successes_last_hour\b/);
    expect(codeOnly).not.toMatch(/successes_last_24h\b/);
    expect(codeOnly).not.toMatch(/last_success_at\b/);
  });

  it("derives the success-rate metric from (probes - failures), not a phantom field", () => {
    expect(page).toMatch(/probes_last_24h\s*\??\?\?\s*0/);
    expect(page).toMatch(/failures_last_24h\s*\??\?\?\s*0/);
    expect(page).toMatch(/probes24\s*-\s*failures24/);
  });
});

// ─── 5. PAGE CONTRACT — RPC & auth handling ──────────────────
describe("L1-E: PipelineHealthPage RPC integration", () => {
  it("calls get_pipeline_health_summary via safeRpc (auth-lock-free)", () => {
    expect(page).toMatch(/safeRpc<HealthPayload>\(\s*\n?\s*["']get_pipeline_health_summary["']/);
  });

  it("handles 'unauthorized' RPC error as a friendly empty state, not a hard error", () => {
    // A non-admin who lands on this page shouldn't see a stack trace —
    // they should see the operator-only message.
    expect(page).toMatch(/msg\.includes\(["']unauthorized["']\)/);
    expect(page).toMatch(/setUnauthorized\(true\)/);
  });

  it("polls the RPC at a bounded interval (cleared on unmount)", () => {
    expect(page).toMatch(/setInterval/);
    expect(page).toMatch(/clearInterval/);
  });
});
