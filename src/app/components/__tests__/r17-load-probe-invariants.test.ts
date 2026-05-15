// ═══════════════════════════════════════════════════════════════
// R-17 (2026-05-15) — Parallel SOS load probe invariants
// ─────────────────────────────────────────────────────────────
// WHY R-17 EXISTS
//   sos-dispatch-probe (R-4) verifies the SOS pipeline serially: 1
//   trigger per hour proves correctness but not capacity. A real
//   mass-casualty event (earthquake, building fire) might produce
//   5-50 simultaneous SOS triggers from one area. We need proof that:
//     - L2-B dispatch ledger doesn't lose rows under parallel writes
//     - L2-D audit_log hash chain stays consistent under contention
//     - sos-alert latency stays within budget under load
//     - Probe rows still get R-13 synthetic classification under load
//
// THE FIX
//   New edge function sos-load-probe that:
//     - Accepts ?count=N (default 5, capped at 50)
//     - Creates N probe users with predictable emails (sos-load-i@…)
//     - Each user has its own rate-limit bucket (R-12 verified)
//     - Parallel sign-in + parallel sos-alert trigger
//     - Reports p50/p95/p99 latency + DB consistency checks
//     - Cleanup: deletes sos_sessions + dispatch_attempts rows
//     - audit_log rows stay (hash-chained, classified synthetic by R-13)
//
// CONTRACT (locked by this test)
//   1. The probe file exists with the standard 5-probe pattern
//   2. PROBE_SECRET bearer auth via constant-time compare (no === leak)
//   3. count param is parsed + clamped to [1, MAX_COUNT]
//   4. Probe users use the @sosphere.internal reserved domain
//   5. Triggers use the +10 invalid phone (zero Twilio cost)
//   6. Stages are timed (setup / signIn / trigger / verify)
//   7. DB verification checks sos_sessions + audit_log + pipeline_metrics
//   8. R-13 invariant: probe rows must be is_synthetic=true
//   9. Cleanup deletes sos_sessions + dispatch_attempts (audit_log stays)
//  10. Pass criteria: all 4 row counts match succeeded.length
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let probeSrc = "";

beforeAll(() => {
  probeSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/sos-load-probe/index.ts"),
    "utf8",
  );
});

describe("R-17: sos-load-probe is well-formed", () => {
  it("file exists at expected path with substantial content", () => {
    expect(probeSrc.length).toBeGreaterThan(2000);
  });

  it("uses Deno serve() pattern same as other probes", () => {
    expect(probeSrc).toMatch(/import\s+\{\s*serve\s*\}\s+from\s+["']https:\/\/deno\.land\/std/);
    expect(probeSrc).toMatch(/serve\(async\s*\(req\)\s*=>/);
  });
});

describe("R-17: PROBE_SECRET bearer auth (matches other probes)", () => {
  it("checks PROBE_SECRET env var with length guard", () => {
    expect(probeSrc).toMatch(/Deno\.env\.get\(\s*["']PROBE_SECRET["']\s*\)/);
    expect(probeSrc).toMatch(/probeSecret\.length\s*<\s*16/);
  });

  it("uses constant-time compare (no === leak)", () => {
    expect(probeSrc).toMatch(/function\s+constantTimeEquals/);
    expect(probeSrc).toMatch(/constantTimeEquals\(authHeader,\s*`Bearer \$\{probeSecret\}`\)/);
  });

  it("returns 401 unauthorized on bearer mismatch", () => {
    expect(probeSrc).toMatch(/error:\s*["']unauthorized["'][\s\S]{0,50}401/);
  });

  it("returns 405 method_not_allowed for non-POST", () => {
    expect(probeSrc).toMatch(/method_not_allowed[\s\S]{0,50}405/);
  });
});

describe("R-17: count param is parsed + bounded", () => {
  it("parses ?count from URL search params", () => {
    expect(probeSrc).toMatch(/url\.searchParams\.get\(\s*["']count["']\s*\)/);
  });

  it("clamps to [1, MAX_COUNT] with MAX_COUNT bumped to 100 (R-18-F)", () => {
    // R-18-F: MAX_COUNT bumped from 50 to 100 once SIGNIN batching avoided
    // Supabase Auth rate-limit ceiling. The 50-cap was a probe artefact, not
    // a sos-alert limit. With batched sign-in we can stress-test up to 100
    // concurrent triggers without the Auth API masking real capacity.
    expect(probeSrc).toMatch(/const\s+MAX_COUNT\s*=\s*100/);
    expect(probeSrc).toMatch(/Math\.max\(\s*1\s*,\s*Math\.min\(\s*MAX_COUNT/);
  });

  it("R-18-F: sign-in is BATCHED (avoids Supabase Auth rate limit)", () => {
    // Auth API rate-limits /token at ~30/hr per IP. Edge function = 1 IP.
    // We batch SIGNIN_BATCH_SIZE sign-ins per SIGNIN_BATCH_DELAY_MS so the
    // bucket never trips. This does NOT weaken the load test — Stage 3
    // (the actual SOS trigger) remains fully parallel.
    expect(probeSrc).toMatch(/const\s+SIGNIN_BATCH_SIZE\s*=\s*\d+/);
    expect(probeSrc).toMatch(/const\s+SIGNIN_BATCH_DELAY_MS\s*=\s*\d+/);
    expect(probeSrc).toMatch(/offset\s*\+=\s*SIGNIN_BATCH_SIZE/);
    // Sleep between batches
    expect(probeSrc).toMatch(/setTimeout\([^)]+SIGNIN_BATCH_DELAY_MS/);
  });

  it("default count is 5 when query param omitted", () => {
    expect(probeSrc).toMatch(/parseInt\([^)]*["']5["']/);
  });
});

describe("R-17: probe users use reserved @sosphere.internal domain (R-13)", () => {
  it("uses sos-load- prefix + @sosphere.internal suffix", () => {
    expect(probeSrc).toMatch(/PROBE_USER_PREFIX\s*=\s*["']sos-load-["']/);
    expect(probeSrc).toMatch(/PROBE_USER_DOMAIN\s*=\s*["']@sosphere\.internal["']/);
  });

  it("user email format: sos-load-<i>@sosphere.internal", () => {
    expect(probeSrc).toMatch(/`\$\{PROBE_USER_PREFIX\}\$\{i\}\$\{PROBE_USER_DOMAIN\}`/);
  });
});

describe("R-17: trigger uses +10 invalid phone (zero Twilio cost — same as R-4)", () => {
  it("contacts payload has phone +10", () => {
    expect(probeSrc).toMatch(/phone:\s*["']\+10["']/);
  });
});

describe("R-17: stages are timed for observability", () => {
  it("measures setupUsers / signIn / trigger / verify / total separately", () => {
    // Each stage records BOTH a Start (performance.now()) and a Ms (the
    // delta). Distance between them inside the probe is large (full stage
    // body) so we don't constrain it — just verify both names appear.
    for (const i of [1, 2, 3, 4]) {
      expect(probeSrc, `stage${i}Start missing`).toMatch(new RegExp(`stage${i}Start\\s*=\\s*performance\\.now\\(\\)`));
      expect(probeSrc, `stage${i}Ms missing`).toMatch(new RegExp(`const\\s+stage${i}Ms\\s*=`));
    }
    expect(probeSrc).toMatch(/setupUsersMs:\s*stage1Ms/);
    expect(probeSrc).toMatch(/signInMs:\s*stage2Ms/);
    expect(probeSrc).toMatch(/triggerMs:\s*stage3Ms/);
    expect(probeSrc).toMatch(/verifyMs:\s*stage4Ms/);
    expect(probeSrc).toMatch(/totalMs/);
  });

  it("computes p50, p95, p99 latency percentiles", () => {
    expect(probeSrc).toMatch(/function\s+percentile/);
    expect(probeSrc).toMatch(/p50:\s*percentile\(latencies,\s*0\.5\)/);
    expect(probeSrc).toMatch(/p95:\s*percentile\(latencies,\s*0\.95\)/);
    expect(probeSrc).toMatch(/p99:\s*percentile\(latencies,\s*0\.99\)/);
  });
});

describe("R-17: parallel execution (the actual load test)", () => {
  it("uses Promise.all for parallel setup + sign-in + trigger", () => {
    // At least 3 Promise.all sites (stage 1, 2, 3)
    const matches = probeSrc.match(/await Promise\.all\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("each trigger uses its own emergencyId + traceId + idempotency key", () => {
    expect(probeSrc).toMatch(/const emergencyId\s*=\s*crypto\.randomUUID\(\)/);
    expect(probeSrc).toMatch(/const traceId\s*=\s*crypto\.randomUUID\(\)/);
    // idemKey scoped per-call: `loadprobe:${runId}:${s.i}`
    expect(probeSrc).toMatch(/loadprobe:\$\{runId\}:\$\{s\.i\}/);
  });
});

describe("R-17: DB verification covers all 3 critical tables", () => {
  it("queries sos_sessions for the success emergency IDs", () => {
    expect(probeSrc).toMatch(/from\(["']sos_sessions["']\)[\s\S]{0,300}\.in\(["']id["']/);
  });

  it("queries audit_log for sos_triggered action against the IDs", () => {
    expect(probeSrc).toMatch(/from\(["']audit_log["']\)[\s\S]{0,300}sos_triggered/);
  });

  it("queries sos_pipeline_metrics + asserts R-13 synthetic classification", () => {
    expect(probeSrc).toMatch(/from\(["']sos_pipeline_metrics["']\)[\s\S]{0,400}is_synthetic/);
    expect(probeSrc).toMatch(/syntheticClassifiedCount/);
  });

  it("does NOT call verify_audit_chain RPC (requires company admin auth)", () => {
    // The chain integrity check uses the indirect 'audit_log row count'
    // proxy instead, since verify_audit_chain requires the caller to be
    // an admin/owner of a specific company. See R-17 design note 4d.
    expect(probeSrc).not.toMatch(/\.rpc\(\s*["']verify_audit_chain["']/);
    expect(probeSrc).not.toMatch(/\.rpc\(\s*["']verify_audit_log_chain["']/);
  });
});

describe("R-17: cleanup leaves audit_log intact (forensic guarantee)", () => {
  it("deletes from dispatch_attempts on the run emergencyIds", () => {
    expect(probeSrc).toMatch(/from\(["']dispatch_attempts["']\)\.delete\(\)[\s\S]{0,80}\.in\(["']emergency_id["']/);
  });

  it("deletes from sos_sessions on the run emergencyIds", () => {
    expect(probeSrc).toMatch(/from\(["']sos_sessions["']\)\.delete\(\)[\s\S]{0,80}\.in\(["']id["']/);
  });

  it("does NOT delete from audit_log (hash-chained, R-13 classifies)", () => {
    // audit_log rows must persist after probe runs — the hash chain
    // can't tolerate gaps mid-chain, and R-13 classifies them as
    // synthetic so dashboards filter them out.
    expect(probeSrc).not.toMatch(/from\(["']audit_log["']\)\.delete/);
  });
});

describe("R-17: pass criteria requires ALL invariants to hold", () => {
  it("pass = no failures + all DB row counts equal succeeded", () => {
    expect(probeSrc).toMatch(/const\s+pass\s*=[\s\S]{0,500}failed\.length\s*===\s*0/);
    expect(probeSrc).toMatch(/sessionsRowCount\s*===\s*succeeded\.length/);
    expect(probeSrc).toMatch(/auditRowCount\s*===\s*succeeded\.length/);
    expect(probeSrc).toMatch(/pipelineMetricsRowCount\s*===\s*succeeded\.length/);
    expect(probeSrc).toMatch(/syntheticClassifiedCount\s*===\s*succeeded\.length/);
  });
});

describe("R-17: report body shape", () => {
  it("returns count, succeeded, failed, latency, db, stages, optional failures[]", () => {
    expect(probeSrc).toMatch(/pass,\s*runId,\s*count/);
    expect(probeSrc).toMatch(/succeeded:\s*succeeded\.length/);
    expect(probeSrc).toMatch(/failed:\s*failed\.length/);
    expect(probeSrc).toMatch(/latency:\s*\{/);
    expect(probeSrc).toMatch(/db:\s*\{/);
    expect(probeSrc).toMatch(/stages:\s*\{/);
    expect(probeSrc).toMatch(/failures:[\s\S]{0,100}slice\(0,\s*10\)/);
  });
});
