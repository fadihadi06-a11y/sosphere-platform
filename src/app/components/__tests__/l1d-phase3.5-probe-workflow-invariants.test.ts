// ═══════════════════════════════════════════════════════════════
// SOSphere — L1-D Phase 3.5: probe-workflow invariants
// ─────────────────────────────────────────────────────────────
// Locks the shape of the GitHub Actions cron workflow that runs
// the two synthetic probes every 15 minutes. A probe that's never
// run is just code, not observability — so the schedule + the
// pass-assertion are themselves part of the L1-D contract.
//
// Guards against:
//   • A refactor that drops the cron schedule (probes go silent
//     until someone manually triggers them)
//   • A refactor that relaxes the pass assertion ("|| true" appended
//     to the exit-code path — workflow goes green even on probe-fail)
//   • A refactor that removes one of the two probes from the
//     workflow (silently halves the monitoring coverage)
//   • A refactor that drops the timeout-minutes cap (a stuck probe
//     could hang the workflow runner indefinitely)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let workflowSrc = "";

beforeAll(() => {
  workflowSrc = fs.readFileSync(
    path.resolve(process.cwd(), ".github/workflows/probes.yml"),
    "utf8",
  );
});

describe("L1-D Phase 3.5: probe workflow — schedule + triggers", () => {
  it("runs every 15 minutes via cron", () => {
    // The L1-D drift-detection latency goal is 15 min. The cron
    // expression MUST match — a stretched cadence weakens the
    // signal without ever showing up in the dashboard.
    expect(workflowSrc).toMatch(/cron:\s*["']?\*\/15 \* \* \* \*["']?/);
  });

  it("supports manual workflow_dispatch (for ad-hoc post-deploy runs)", () => {
    expect(workflowSrc).toMatch(/workflow_dispatch:/);
  });

  it("concurrency cancels in-flight runs (no pile-up during incidents)", () => {
    expect(workflowSrc).toMatch(/concurrency:[\s\S]{0,80}cancel-in-progress:\s*true/);
  });
});

describe("L1-D Phase 3.5: both probes are wired", () => {
  it("inbound-probe job exists + hits sos-inbound-probe", () => {
    expect(workflowSrc).toMatch(/inbound-probe:/);
    expect(workflowSrc).toMatch(/\/sos-inbound-probe/);
  });

  it("config-drift-probe job exists + hits twilio-config-probe", () => {
    expect(workflowSrc).toMatch(/config-drift-probe:/);
    expect(workflowSrc).toMatch(/\/twilio-config-probe/);
  });

  it("each job has a timeout cap (no infinite runs)", () => {
    const matches = workflowSrc.match(/timeout-minutes:\s*\d+/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("L1-D Phase 3.5: pass-assertion contract (the load-bearing check)", () => {
  it("inbound-probe FAILS the run when .pass !== 'true'", () => {
    // The shell script must compare .pass to "true" and exit 1
    // otherwise. A "|| true" appended anywhere downstream would
    // mask probe failures — assert NO such suffix exists.
    expect(workflowSrc).toMatch(/if \[ "\$pass" != "true" \]; then[\s\S]{0,200}exit 1/);
  });

  it("config-drift-probe FAILS the run when .driftedCount !== 0", () => {
    expect(workflowSrc).toMatch(/if \[ "\$drifted" != "0" \]; then[\s\S]{0,500}exit 1/);
  });

  it("both probes use set -euo pipefail (strict shell — no silent failures)", () => {
    const matches = workflowSrc.match(/set -euo pipefail/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("missing-secret guard exits 2 (distinct from probe-failure exit 1)", () => {
    // Distinguishing exit codes lets failure analytics tell
    // "infrastructure not configured" from "infrastructure broken".
    expect(workflowSrc).toMatch(/Missing SUPA_FN_URL or PROBE_SECRET secret[\s\S]{0,100}exit 2/);
  });
});

describe("L1-D Phase 3.5: auth + URL construction", () => {
  it("uses Bearer auth via PROBE_SECRET (same as the probe handlers)", () => {
    expect(workflowSrc).toMatch(/Authorization: Bearer \$PROBE_SECRET/);
  });

  it("URL targets are constructed from SUPA_FN_URL secret (no hard-coded project ids)", () => {
    expect(workflowSrc).toMatch(/\$SUPA_FN_URL\/sos-inbound-probe/);
    expect(workflowSrc).toMatch(/\$SUPA_FN_URL\/twilio-config-probe/);
  });

  it("curl uses -fsSL (-f makes 4xx/5xx fail the run)", () => {
    const matches = workflowSrc.match(/curl -fsSL/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
