// ═══════════════════════════════════════════════════════════════
// R-4 (2026-05-14) — End-to-end SOS verify harness invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that the supabase/functions/sos-dispatch-probe
// edge function is wired correctly and the GHA workflow runs it on
// a cadence that fits inside the per-tier SOS rate limits.
//
// Why these tests exist (the testing layers of R-4):
//   LAYER 1 (this file): static source-level invariants. Cheap,
//     fast, run in CI on every push.
//   LAYER 2 (probe itself): live HTTP runtime probe against prod
//     Supabase, exercises every layer of sos-alert orchestration.
//   LAYER 3 (GHA cron): runs the probe every 6 hours and emails
//     repo admins on failure within ~6h of any regression.
//
// What this file guards against:
//   • A refactor that drops the PROBE_SECRET bearer auth from the
//     probe (would let anyone trigger synthetic SOS rows).
//   • A refactor that removes the "+10" invalid-phone safeguard
//     (would let the probe burn real Twilio budget every 6h).
//   • A refactor that points the probe at the wrong sos_alert
//     URL form, or the wrong audit_log column, or the wrong
//     sos_dispatch_attempts table name.
//   • A regression that re-introduces the probe-prefixed string
//     for emergencyId (sos_sessions.id is uuid, would crash).
//   • A workflow refactor that drops the 6-hour schedule or
//     accidentally moves the probe to the 15-min lane (would hit
//     the SOS rate limit by the second hourly run).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let probeSrc = "";
let workflowYml = "";
let configToml = "";

beforeAll(() => {
  probeSrc     = READ("supabase/functions/sos-dispatch-probe/index.ts");
  workflowYml  = READ(".github/workflows/probes.yml");
  configToml   = READ("supabase/config.toml");
});

describe("R-4: sos-dispatch-probe edge function — auth invariants", () => {
  it("requires PROBE_SECRET bearer with constant-time compare", () => {
    expect(probeSrc).toMatch(/Deno\.env\.get\(\s*["']PROBE_SECRET["']\s*\)/);
    expect(probeSrc).toMatch(/function constantTimeEquals/);
    expect(probeSrc).toMatch(/constantTimeEquals\(\s*authHeader\s*,\s*`Bearer \$\{probeSecret\}`\s*\)/);
  });

  it("fails closed when PROBE_SECRET is missing or short", () => {
    expect(probeSrc).toMatch(/!probeSecret\s*\|\|\s*probeSecret\.length\s*<\s*16/);
    expect(probeSrc).toMatch(/probe_misconfigured/);
  });

  it("rejects non-POST methods (405)", () => {
    expect(probeSrc).toMatch(/req\.method\s*!==\s*["']POST["']/);
    expect(probeSrc).toMatch(/method_not_allowed/);
  });
});

describe("R-4: sos-dispatch-probe — cost-safety invariants", () => {
  it("uses a deliberately invalid contact phone (+10) so no Twilio call/SMS fires", () => {
    // "+10" is too short to normalize to E.164. sos-alert.normalizeE164
    // returns null for <8 digits, which makes fanout record
    // method:'invalid_number' and ZERO real Twilio API calls fire.
    expect(probeSrc).toMatch(/phone:\s*["']\+10["']/);
  });

  it("uses crypto.randomUUID() for emergencyId (sos_sessions.id is a uuid column)", () => {
    // ROOT-LEVEL FIX (R-4 live-run-1 finding): sos_sessions.id is `uuid`,
    // not `text`. A probe-prefixed string like "probe-dispatch-*" makes
    // Postgres throw "invalid input syntax for type uuid" before any row
    // is even inserted, crashing the whole orchestration with HTTP 500.
    // Probe rows are still distinguishable from real incidents because
    // they're all owned by the single shared probe user (probeUserId),
    // so dashboards filter probe rows by user_id.
    expect(probeSrc).toMatch(/const emergencyId\s*=\s*crypto\.randomUUID\(\)/);
    // Defensive: no leftover "probe-dispatch-" template literal.
    expect(probeSrc).not.toMatch(/`probe-dispatch-\$\{/);
  });

  it("uses its own dedicated probe-user identity (R-10: no race with forgery-probe)", () => {
    // Pre-R-10 both probes shared forgery-probe@sosphere.internal — when run
    // in parallel via workflow_dispatch, each probe's admin.updateUserById
    // password write stomped the other's, leaving one with a stale password
    // and a 500 on sign-in. Dedicated identities eliminate the race.
    expect(probeSrc).toMatch(/sos-dispatch-probe@sosphere\.internal/);
    expect(probeSrc).not.toMatch(/PROBE_USER_EMAIL\s*=\s*["']forgery-probe@/);
  });

  it("includes silent:true so any client-side UI hooks stay quiet", () => {
    expect(probeSrc).toMatch(/silent:\s*true/);
  });
});

describe("R-4: sos-dispatch-probe — orchestration coverage", () => {
  it("posts to sos-alert?action=trigger (default action, explicit URL)", () => {
    // Form-A URL is required because edge-function -> edge-function is
    // an internal call; form-B isn't needed here. Both are valid
    // Supabase routing forms; form-A is the legacy /functions/v1/ path.
    expect(probeSrc).toMatch(/\$\{supaUrl\}\/functions\/v1\/sos-alert/);
  });

  it("posts to sos-alert?action=end after the trigger assertions", () => {
    expect(probeSrc).toMatch(/sos-alert\?action=end/);
  });

  it("reads sos_sessions to verify status and ownership pin", () => {
    expect(probeSrc).toMatch(/\.from\(\s*["']sos_sessions["']\s*\)/);
    expect(probeSrc).toMatch(/session_user_pinned_to_probe/);
    expect(probeSrc).toMatch(/session_server_triggered_at_set/);
  });

  it("reads sos_dispatch_attempts (correct table name — not 'dispatch_attempts')", () => {
    expect(probeSrc).toMatch(/\.from\(\s*["']sos_dispatch_attempts["']\s*\)/);
    expect(probeSrc).not.toMatch(/\.from\(\s*["']dispatch_attempts["']\s*\)/);
  });

  it("reads audit_log for sos_triggered AND sos_ended", () => {
    expect(probeSrc).toMatch(/\.from\(\s*["']audit_log["']\s*\)/);
    expect(probeSrc).toMatch(/sos_triggered/);
    expect(probeSrc).toMatch(/sos_ended/);
  });

  it("threads trace_id end-to-end (header + body + assertions)", () => {
    expect(probeSrc).toMatch(/X-SOS-Trace-Id/);
    expect(probeSrc).toMatch(/traceId,?$/m);                  // body field
    expect(probeSrc).toMatch(/session_trace_id_matches/);
    expect(probeSrc).toMatch(/dispatch_trace_id_threaded/);
    expect(probeSrc).toMatch(/trigger_audit_trace_id_matches/);
    expect(probeSrc).toMatch(/end_audit_trace_id_matches/);
  });

  it("treats HTTP 429 (rate-limited) as pass:true with rate_limited:true", () => {
    expect(probeSrc).toMatch(/triggerRes\.status\s*===\s*429/);
    expect(probeSrc).toMatch(/rate_limited:\s*true/);
  });
});

describe("R-4: sos-dispatch-probe — cleanup invariants", () => {
  it("deletes the synthetic sos_sessions + sos_dispatch_attempts rows", () => {
    expect(probeSrc).toMatch(
      /admin[\s\S]{0,200}\.from\(\s*["']sos_dispatch_attempts["']\s*\)\.delete\(\)/,
    );
    expect(probeSrc).toMatch(
      /admin[\s\S]{0,200}\.from\(\s*["']sos_sessions["']\s*\)\.delete\(\)/,
    );
  });

  it("does NOT delete audit_log rows (hash-chained, must stay append-only)", () => {
    expect(probeSrc).not.toMatch(
      /\.from\(\s*["']audit_log["']\s*\)[\s\S]{0,100}\.delete\(\)/,
    );
  });

  it("cleanup failures do NOT fail the probe (orchestration verification is the goal)", () => {
    expect(probeSrc).toMatch(/Stage 12: cleanup/);
    expect(probeSrc).toMatch(/best-effort/i);
  });
});

describe("R-4: sos-dispatch-probe — HTTP semantics", () => {
  it("returns HTTP 500 on pass:false so curl -f in GHA exits non-zero", () => {
    expect(probeSrc).toMatch(/pass\s*\?\s*200\s*:\s*500/);
  });

  it("returns a structured asserts{} object covering every layer", () => {
    expect(probeSrc).toMatch(/asserts\s*=\s*\{/);
    for (const key of [
      "trigger_success_flag",
      "trigger_result_is_invalid_number",
      "session_row_exists",
      "session_user_pinned_to_probe",
      "session_status_active",
      "dispatch_sms_invalid_row_exists",
      "trigger_audit_row_exists",
      "trigger_audit_actor_is_probe",
      "session_status_ended",
      "end_audit_row_exists",
    ]) {
      expect(probeSrc).toMatch(new RegExp(key));
    }
  });
});

describe("R-4: probes.yml workflow — schedule + filter invariants", () => {
  it("declares BOTH cron schedules: */15 (fast probes) AND 0 */6 (dispatch probe)", () => {
    expect(workflowYml).toMatch(/cron:\s*["']?\*\/15 \* \* \* \*["']?/);
    expect(workflowYml).toMatch(/cron:\s*["']?0 \*\/6 \* \* \*["']?/);
  });

  it("dispatch-probe job is gated to the 6-hour schedule + workflow_dispatch only", () => {
    expect(workflowYml).toMatch(
      /dispatch-probe[\s\S]{0,500}github\.event\.schedule\s*==\s*['"]0 \*\/6 \* \* \*['"]/,
    );
  });

  it("the three fast probes are gated to the 15-min schedule (don't run on 6h tick)", () => {
    const fastProbes = ["inbound-probe", "config-drift-probe", "forgery-probe"];
    for (const job of fastProbes) {
      const re = new RegExp(
        `${job}:[\\s\\S]{0,500}github\\.event\\.schedule\\s*==\\s*['"]\\*/15 \\* \\* \\* \\*['"]`,
      );
      expect(workflowYml).toMatch(re);
    }
  });

  it("dispatch-probe step asserts pass:true (treats rate_limited as pass)", () => {
    expect(workflowYml).toMatch(/sos-dispatch-probe/);
    expect(workflowYml).toMatch(/rate_limited/);
  });

  it("dispatch-probe job has a 3-minute timeout (probe takes ~3-5s; gives DB write headroom)", () => {
    expect(workflowYml).toMatch(/dispatch-probe[\s\S]{0,200}timeout-minutes:\s*3/);
  });
});

describe("R-4: supabase/config.toml registration", () => {
  it("registers sos-dispatch-probe with verify_jwt=false (PROBE_SECRET handles auth)", () => {
    expect(configToml).toMatch(
      /\[functions\.sos-dispatch-probe\][\s\S]{0,100}verify_jwt\s*=\s*false/,
    );
  });

  it("registers forgery-probe with verify_jwt=false (was missing from config — R-4 also fixes this)", () => {
    expect(configToml).toMatch(
      /\[functions\.forgery-probe\][\s\S]{0,100}verify_jwt\s*=\s*false/,
    );
  });
});
