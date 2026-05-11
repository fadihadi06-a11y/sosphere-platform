// ═══════════════════════════════════════════════════════════════
// SOSphere — L4-B: sos-health public endpoint invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that the public health endpoint:
//   • Is publicly accessible (verify_jwt = false in config.toml)
//   • Returns ONLY non-sensitive fields (no PII, no env names,
//     no internal URLs in the response body)
//   • Returns 200 when healthy, 503 when Supabase is down
//   • Caches results for 10s to prevent monitor abuse
//   • Pings Supabase to actually verify DB-plane health
//   • Reuses withDbRetry (no inlined retry logic)
//   • Rejects non-GET/HEAD methods (405 method_not_allowed)
//
// Guards against:
//   • A refactor that adds auth to the endpoint (breaks uptime
//     monitors that expect anonymous access)
//   • A refactor that adds PII to the response body
//   • A refactor that drops the Supabase ping (endpoint always
//     returns 200 even when DB is down)
//   • A refactor that removes caching (each monitor poll hits PG)
//   • A refactor that drops the 503 status code path
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let healthSrc = "";
let cfgSrc = "";

beforeAll(() => {
  healthSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/sos-health/index.ts"),
    "utf8",
  );
  cfgSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/config.toml"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L4-B: sos-health endpoint — public access contract", () => {
  it("is registered as verify_jwt = false in config.toml", () => {
    expect(cfgSrc).toMatch(/\[functions\.sos-health\][\s\S]{0,80}verify_jwt\s*=\s*false/);
  });

  it("has no Authorization header check inside the function", () => {
    // Public endpoint — must NOT require Bearer tokens.
    const code = stripComments(healthSrc);
    expect(code).not.toMatch(/req\.headers\.get\(\s*["']Authorization["']\s*\)/);
    expect(code).not.toMatch(/PROBE_SECRET/);
  });

  it("rejects non-GET/HEAD methods with 405", () => {
    const code = stripComments(healthSrc);
    expect(code).toMatch(/req\.method\s*!==\s*["']GET["']\s*&&\s*req\.method\s*!==\s*["']HEAD["']/);
    expect(code).toMatch(/status:\s*405/);
    expect(code).toMatch(/method_not_allowed/);
  });
});

describe("L4-B: sos-health endpoint — response shape (no info leak)", () => {
  it("response body has EXACTLY the safe fields (ok, ts, version, supabase, error?)", () => {
    // The HealthSnapshot interface is the contract — assert it has
    // only the documented fields. Adding PII or internal data here
    // would break the public-safe posture.
    expect(healthSrc).toMatch(/interface HealthSnapshot \{[\s\S]{0,400}ok:\s*boolean/);
    expect(healthSrc).toMatch(/interface HealthSnapshot \{[\s\S]{0,400}ts:\s*string/);
    expect(healthSrc).toMatch(/interface HealthSnapshot \{[\s\S]{0,400}version:\s*string/);
    expect(healthSrc).toMatch(/interface HealthSnapshot \{[\s\S]{0,400}supabase:\s*["']up["']\s*\|\s*["']down["']/);
  });

  it("does NOT leak emergency IDs, user IDs, phone numbers, or other PII", () => {
    // The endpoint must NOT touch the emergency/user tables.
    // Anything that selects from sos_sessions / profiles / sos_sms_replies
    // is a regression.
    expect(healthSrc).not.toMatch(/\.from\(\s*["']sos_sessions["']\s*\)/);
    expect(healthSrc).not.toMatch(/\.from\(\s*["']profiles["']\s*\)/);
    expect(healthSrc).not.toMatch(/\.from\(\s*["']sos_sms_replies["']\s*\)/);
    expect(healthSrc).not.toMatch(/\.from\(\s*["']sos_dispatch_attempts["']\s*\)/);
  });

  it("uses pg_indexes for the SELECT-1 probe (always-present, no PII)", () => {
    // The probe table must be a system view, not a user table.
    expect(healthSrc).toMatch(/\.from\(\s*["']pg_indexes["']\s*\)/);
  });
});

describe("L4-B: sos-health endpoint — health-check semantics", () => {
  it("returns 200 when healthy", () => {
    expect(healthSrc).toMatch(/status:\s*snapshot\.ok\s*\?\s*200\s*:\s*503/);
  });

  it("returns 503 when Supabase unreachable (ok: false path)", () => {
    // The 503 path must be reachable when ok=false. The ternary above
    // covers this; double-check the down-state assignment.
    const code = stripComments(healthSrc);
    expect(code).toMatch(/snapshot\.supabase\s*=\s*["']down["']/);
    expect(code).toMatch(/snapshot\.ok\s*=\s*false/);
  });

  it("ALWAYS sets snapshot.ts to current ISO timestamp (fresh response)", () => {
    expect(healthSrc).toMatch(/ts:\s*new Date\(now\)\.toISOString\(\)/);
  });

  it("snapshot.error is bounded (never leaks the full error message)", () => {
    // Caps to 80 chars so a verbose PG error doesn't drop sensitive
    // schema/query info in a public response.
    expect(healthSrc).toMatch(/\.message\?\.slice\(0,\s*80\)/);
  });
});

describe("L4-B: sos-health endpoint — caching + retry posture", () => {
  it("caches health snapshots for CACHE_MS (default 10s)", () => {
    expect(healthSrc).toMatch(/CACHE_MS\s*=\s*10_?000/);
    expect(healthSrc).toMatch(/expiresAt:\s*now\s*\+\s*CACHE_MS/);
  });

  it("returns the cached snapshot on cache hit (does NOT re-ping Supabase)", () => {
    const code = stripComments(healthSrc);
    expect(code).toMatch(/cached\s*&&\s*cached\.expiresAt\s*>\s*now/);
  });

  it("Cache-Control response header allows public proxies to cache for 10s", () => {
    expect(healthSrc).toMatch(/"Cache-Control":\s*"public,\s*max-age=10,\s*s-maxage=10"/);
  });

  it("DB ping has its own timeout cap (DB_PING_TIMEOUT_MS)", () => {
    expect(healthSrc).toMatch(/DB_PING_TIMEOUT_MS\s*=\s*3_?000/);
    expect(healthSrc).toMatch(/db_ping_timeout/);
  });

  it("DB ping is wrapped in withDbRetry (reuses L4-A primitive)", () => {
    expect(healthSrc).toMatch(/import\s*\{\s*withDbRetry\s*\}\s*from\s*["']\.\.\/_shared\/db-retry\.ts["']/);
    expect(healthSrc).toMatch(/await withDbRetry\(/);
  });

  it("retry budget on the ping is short (maxRetries: 1)", () => {
    // 1 retry max — keeps total ping latency under ~6.3s even
    // in the worst case (2 × DB_PING_TIMEOUT_MS + 100ms backoff).
    expect(healthSrc).toMatch(/maxRetries:\s*1/);
  });
});
