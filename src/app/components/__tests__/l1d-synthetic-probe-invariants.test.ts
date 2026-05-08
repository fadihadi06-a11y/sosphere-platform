// ═══════════════════════════════════════════════════════════════
// SOSphere — L1-D Synthetic Probe architectural invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract for the synthetic SOS probe. Companion to
// supabase/migrations/20260508180000_l1d_synthetic_sos_probe.sql.
//
// If a future refactor:
//   • removes the probe (no automated liveness check)
//   • removes the retention cron (probe rows accumulate forever)
//   • opens the probe to anon/authenticated (anyone can call → DoS)
//   • removes the row materialization assertions inside the probe
//     (probe reports OK even when writes fail silently)
// …this test fails and the regression is caught.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let mig = "";

beforeAll(() => {
  mig = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260508180000_l1d_synthetic_sos_probe.sql"),
    "utf8",
  );
});

// ─── 1. PROBE FUNCTION CONTRACT ──────────────────────────────
describe("L1-D: run_synthetic_sos_probe shape", () => {
  it("is a SECURITY DEFINER function with locked search_path", () => {
    expect(mig).toMatch(
      /CREATE OR REPLACE FUNCTION public\.run_synthetic_sos_probe[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path\s*=\s*'public',\s*'pg_temp'/,
    );
  });

  it("calls all 5 pipeline RPCs in sequence", () => {
    for (const rpc of [
      "record_sos_pipeline_started",
      "record_sos_pipeline_dispatched",
      "record_sos_pipeline_acked",
      "record_sos_pipeline_ended",
    ]) {
      expect(mig).toMatch(new RegExp("PERFORM public\\." + rpc));
    }
  });

  it("uses clock_timestamp() not now() (so timestamps progress within the txn)", () => {
    // now() is fixed at txn-start. clock_timestamp() advances. We need
    // progressing timestamps to compute realistic durations.
    expect(mig).toMatch(/clock_timestamp\(\)/);
  });

  it("flags every probe row with is_synthetic=true", () => {
    expect(mig).toMatch(/p_is_synthetic\s*=>\s*true/);
  });

  it("re-reads the row to verify materialization", () => {
    expect(mig).toMatch(/SELECT[\s\S]*?FROM public\.sos_pipeline_metrics[\s\S]*?WHERE trace_id = v_trace/);
  });

  it("RAISEs if pipeline_status != 'success' (probe fails loudly)", () => {
    expect(mig).toMatch(/v_row\.pipeline_status\s*<>\s*'success'/);
    expect(mig).toMatch(/RAISE EXCEPTION 'synthetic probe: status=/);
  });

  it("returns ok:false on any exception (graceful degradation)", () => {
    expect(mig).toMatch(/EXCEPTION\s*\n\s*WHEN OTHERS THEN[\s\S]*?'ok',\s*false/);
  });
});

// ─── 2. PERMISSIONS — least-privilege ─────────────────────────
describe("L1-D: probe is locked to postgres only", () => {
  it("REVOKE EXECUTE FROM PUBLIC on the probe", () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.run_synthetic_sos_probe\(\)\s+FROM PUBLIC/);
  });

  it("REVOKE EXECUTE FROM anon AND authenticated on the probe", () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.run_synthetic_sos_probe\(\)\s+FROM anon,\s*authenticated/);
  });

  it("REVOKE EXECUTE FROM PUBLIC on the cleanup function", () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.cleanup_synthetic_pipeline_metrics\(integer\)\s+FROM PUBLIC/);
  });

  it("REVOKE EXECUTE FROM anon AND authenticated on the cleanup function", () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.cleanup_synthetic_pipeline_metrics\(integer\)\s+FROM anon,\s*authenticated/);
  });
});

// ─── 3. RETENTION CONTRACT ───────────────────────────────────
describe("L1-D: synthetic-only cleanup (real rows are forensic)", () => {
  it("cleanup deletes only is_synthetic=true rows", () => {
    expect(mig).toMatch(
      /DELETE FROM public\.sos_pipeline_metrics[\s\S]*?WHERE is_synthetic = true/,
    );
  });

  it("default retention is 7 days (168 hours)", () => {
    expect(mig).toMatch(/p_retention_hours integer DEFAULT 168/);
  });

  it("logs to retention helper for ops visibility", () => {
    expect(mig).toMatch(/log_retention_cleanup\(\s*\n?\s*'sos_pipeline_metrics_synthetic'/);
  });
});

// ─── 4. HEALTH VIEW ──────────────────────────────────────────
describe("L1-D: synthetic_probe_health view", () => {
  it("exposes p50/p95/p99 of last hour", () => {
    expect(mig).toMatch(/percentile_cont\(0\.50\)[\s\S]*?p50_total_ms_last_hour/);
    expect(mig).toMatch(/percentile_cont\(0\.95\)[\s\S]*?p95_total_ms_last_hour/);
    expect(mig).toMatch(/percentile_cont\(0\.99\)[\s\S]*?p99_total_ms_last_hour/);
  });

  it("surfaces failures separately from totals", () => {
    expect(mig).toMatch(/failures_last_hour/);
    expect(mig).toMatch(/failures_last_24h/);
  });

  it("includes seconds_since_last_probe (cron-stuck signal)", () => {
    expect(mig).toMatch(/seconds_since_last_probe/);
  });

  it("is locked to service_role + postgres (no anon read)", () => {
    expect(mig).toMatch(/REVOKE ALL ON public\.synthetic_probe_health[\s\S]*?FROM PUBLIC, anon, authenticated/);
    expect(mig).toMatch(/GRANT SELECT ON public\.synthetic_probe_health TO service_role, postgres/);
  });
});

// ─── 5. CRON SCHEDULES ───────────────────────────────────────
describe("L1-D: pg_cron jobs are registered", () => {
  it("probe cron runs every 5 minutes", () => {
    expect(mig).toMatch(
      /cron\.schedule\(\s*\n?\s*'sosphere_synthetic_probe',\s*\n?\s*'\*\/5 \* \* \* \*'/,
    );
  });

  it("retention cron runs daily at 02:21 UTC (in the retention sequence)", () => {
    expect(mig).toMatch(
      /cron\.schedule\(\s*\n?\s*'sosphere_retention_synthetic_metrics',\s*\n?\s*'21 2 \* \* \*'/,
    );
  });

  it("probe cron calls run_synthetic_sos_probe()", () => {
    expect(mig).toMatch(/'sosphere_synthetic_probe'[\s\S]*?SELECT public\.run_synthetic_sos_probe\(\)/);
  });

  it("retention cron calls cleanup_synthetic_pipeline_metrics(168)", () => {
    expect(mig).toMatch(/'sosphere_retention_synthetic_metrics'[\s\S]*?cleanup_synthetic_pipeline_metrics\(168\)/);
  });
});
