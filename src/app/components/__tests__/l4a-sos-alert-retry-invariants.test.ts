// ═══════════════════════════════════════════════════════════════
// SOSphere — L4-A: sos-alert critical-path retry invariants
// ─────────────────────────────────────────────────────────────
// Layer 4 (infrastructure resilience): the SOS critical path
// MUST be wrapped in withDbRetry so a 200ms Postgres reconnect
// or a transient PgBouncer 503 doesn't drop the dispatch claim.
//
// Locks the contract that:
//   • sos-alert imports withDbRetry from _shared
//   • the sos_sessions UPSERT is wrapped
//   • the atomic-claim UPDATE is wrapped
//   • the helper module is the single source (no inlined retry
//     logic in sos-alert)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let alertSrc = "";
let retrySrc = "";

beforeAll(() => {
  alertSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/sos-alert/index.ts"),
    "utf8",
  );
  retrySrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/_shared/db-retry.ts"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L4-A: shared retry module is the source of truth", () => {
  it("exports withDbRetry, isTransientError, sleepMs", () => {
    expect(retrySrc).toMatch(/export async function withDbRetry/);
    expect(retrySrc).toMatch(/export function isTransientError/);
    expect(retrySrc).toMatch(/export function sleepMs/);
  });

  it("is Node-compatible (no Deno globals, no https:// imports)", () => {
    // The module is imported by both edge functions (Deno) and the
    // vitest behavior test (Node). It must avoid runtime-coupled APIs.
    expect(retrySrc).not.toMatch(/from\s+["']https?:\/\//);
    expect(retrySrc).not.toMatch(/\bDeno\./);
  });

  it("defaults are tuned for the SOS critical-path budget", () => {
    expect(retrySrc).toMatch(/DEFAULT_MAX_RETRIES\s*=\s*2/);
    expect(retrySrc).toMatch(/DEFAULT_INITIAL_BACKOFF_MS\s*=\s*200/);
    expect(retrySrc).toMatch(/DEFAULT_BACKOFF_CAP_MS\s*=\s*800/);
  });

  it("classifies transient errors correctly (HTTP 5xx + PG 08*** + network)", () => {
    // The PURE LOGIC test (l4a-db-retry-unit.test.ts) covers behavior.
    // This invariant locks that the classification function continues
    // to exist with the right SHAPE in the source.
    expect(retrySrc).toMatch(/e\.status >= 500/);
    expect(retrySrc).toMatch(/\/\^08\//);  // /^08/.test(code)
    expect(retrySrc).toMatch(/AbortError/);
    expect(retrySrc).toMatch(/fetch failed/);
  });
});

describe("L4-A: sos-alert imports the retry helper (not an inline copy)", () => {
  it("imports withDbRetry from _shared/db-retry.ts", () => {
    expect(alertSrc).toMatch(/import\s*\{\s*withDbRetry\s*\}\s*from\s*["']\.\.\/_shared\/db-retry\.ts["']/);
  });

  it("does NOT inline its own withDbRetry definition (would diverge from the unit-tested copy)", () => {
    const code = stripComments(alertSrc);
    expect(code).not.toMatch(/^export async function withDbRetry/m);
    expect(code).not.toMatch(/^async function withDbRetry/m);
  });
});

describe("L4-A: sos-alert wraps the critical-path writes", () => {
  it("the sos_sessions UPSERT (Step 1 — insert-if-missing) is wrapped in withDbRetry", () => {
    const code = stripComments(alertSrc);
    // The 'Step 1' block must contain a withDbRetry call wrapping
    // the supabase.from("sos_sessions").upsert(...).
    expect(code).toMatch(/withDbRetry\(async \(attempt\)\s*=>\s*\{[\s\S]{0,400}supabase\.from\(\s*["']sos_sessions["']\s*\)\.upsert/);
  });

  it("the sos_sessions atomic-claim UPDATE (Step 2) is wrapped in withDbRetry", () => {
    const code = stripComments(alertSrc);
    expect(code).toMatch(/withDbRetry\(async \(attempt\)\s*=>\s*\{[\s\S]{0,400}supabase[\s\S]{0,100}\.from\(\s*["']sos_sessions["']\s*\)[\s\S]{0,200}\.update/);
  });

  it("the wrapper rethrows errors so withDbRetry sees them (not swallowed)", () => {
    const code = stripComments(alertSrc);
    // Inside the UPSERT wrapper, the .upsert call's error must be
    // rethrown via `if (error) throw error;` — otherwise transient
    // errors silently succeed and retry is dead code.
    expect(code).toMatch(/upsert\([\s\S]{0,1500}if \(error\) throw error/);
  });

  it("retry attempts are surfaced via console.warn (operational visibility)", () => {
    // When the retry kicks in (attempt > 0), the wrapper logs so
    // ops dashboards can see "this SOS needed a retry to dispatch".
    // Required for the L1-A pipeline_metrics correlation.
    expect(alertSrc).toMatch(/UPSERT retry/);
    expect(alertSrc).toMatch(/atomic-claim retry/);
  });
});
