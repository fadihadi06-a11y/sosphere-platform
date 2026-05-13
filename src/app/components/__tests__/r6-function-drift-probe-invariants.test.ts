// ═══════════════════════════════════════════════════════════════
// R-6 (2026-05-14) — deployed-vs-git function drift probe invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that scripts/check-function-drift.mjs is wired
// correctly and the GHA workflow runs it on every push + 6-hour cron.
//
// Three layers of test for R-6:
//   LAYER 1 (this file): static source-level invariants. Cheap,
//     fast, run on every CI build.
//   LAYER 2 (script itself): live exec against the Supabase
//     Management API, exercises every code path that detects drift.
//   LAYER 3 (GHA): runs the script on every push + 6h cron, gates
//     PRs from merging if drift is detected.
//
// What this file guards against:
//   • A refactor that drops PAT auth (SUPABASE_ACCESS_TOKEN) — would
//     make the script run without authentication and silently report
//     no drift even when there is some.
//   • A refactor that compares unnormalized source — would false-alarm
//     on every cosmetic change (whitespace, comment edits).
//   • A refactor that hits the wrong API endpoint or wrong project ref.
//   • A workflow refactor that drops the push:branches:[main] trigger,
//     removing the per-commit safety net.
//   • An accidental removal of the allowlist file — would fail CI on
//     every run because of the legacy sos-backend functions.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let scriptSrc = "";
let allowlistJson = "";
let workflowYml = "";

beforeAll(() => {
  scriptSrc     = READ("scripts/check-function-drift.mjs");
  allowlistJson = READ("supabase/functions/.deploy-drift-allowlist.json");
  workflowYml   = READ(".github/workflows/probes.yml");
});

describe("R-6: check-function-drift.mjs — auth + env invariants", () => {
  it("requires SUPABASE_ACCESS_TOKEN env var (PAT, not service_role)", () => {
    expect(scriptSrc).toMatch(/process\.env\.SUPABASE_ACCESS_TOKEN/);
    expect(scriptSrc).toMatch(/SUPABASE_ACCESS_TOKEN env var is required/i);
  });

  it("requires SUPABASE_PROJECT_REF env var", () => {
    expect(scriptSrc).toMatch(/process\.env\.SUPABASE_PROJECT_REF/);
    expect(scriptSrc).toMatch(/SUPABASE_PROJECT_REF env var is required/i);
  });

  it("uses the Supabase Management API base URL (api.supabase.com/v1)", () => {
    expect(scriptSrc).toMatch(/https:\/\/api\.supabase\.com\/v1/);
  });

  it("sends the PAT as Bearer authorization (NOT apikey header)", () => {
    expect(scriptSrc).toMatch(/Authorization:\s*`Bearer \$\{ACCESS_TOKEN\}`/);
    // Defensive: PAT should NOT be sent as an apikey header (that's the
    // service_role pattern, which has different scope).
    expect(scriptSrc).not.toMatch(/apikey:\s*ACCESS_TOKEN/);
  });
});

describe("R-6: check-function-drift.mjs — comparison invariants", () => {
  it("normalizes source before hashing (line endings, trailing whitespace, blank lines)", () => {
    expect(scriptSrc).toMatch(/function normalize/);
    expect(scriptSrc).toMatch(/\\r\\n/);                    // CRLF unification
    expect(scriptSrc).toMatch(/replace\(\/\\s\+\$\//);      // trailing whitespace
    expect(scriptSrc).toMatch(/n\{3,\}/);                   // collapse blank-line runs
  });

  it("strips single-line // comments from both sides (symmetric normalization)", () => {
    expect(scriptSrc).toMatch(/\/\^\\s\*\\\/\\\/\[\^\\n\]\*\$\//);
  });

  it("uses SHA-256 for the hash comparison", () => {
    expect(scriptSrc).toMatch(/crypto\.createHash\(\s*["']sha256["']\s*\)/);
  });

  it("compares deployed body via /projects/{ref}/functions/{slug}/body endpoint", () => {
    expect(scriptSrc).toMatch(/\/projects\/\$\{[^}]+\}\/functions\/\$\{[^}]+\}\/body/);
  });
});

describe("R-6: check-function-drift.mjs — report categories", () => {
  it("categorizes results into in_sync / drifted / orphan_deployed / orphan_local / foreign_entrypoint", () => {
    for (const cat of ["in_sync", "drifted", "orphan_deployed", "orphan_local", "foreign_entrypoint"]) {
      expect(scriptSrc).toMatch(new RegExp(`report\\.${cat}`));
    }
  });

  it("flags foreign entrypoints (deployed from a different developer machine / repo)", () => {
    expect(scriptSrc).toMatch(/classifyEntrypoint/);
    expect(scriptSrc).toMatch(/file:\/\/\/Users\//);
    expect(scriptSrc).toMatch(/foreign/);
  });

  it("reads + applies the allowlist (so legacy sos-backend functions don't fail CI)", () => {
    expect(scriptSrc).toMatch(/readAllowlist/);
    expect(scriptSrc).toMatch(/\.deploy-drift-allowlist\.json/);
  });
});

describe("R-6: check-function-drift.mjs — exit code policy", () => {
  it("exits 1 on drift (so curl/GHA detects failure)", () => {
    expect(scriptSrc).toMatch(/process\.exit\(\s*fail\s*\?\s*1\s*:\s*0\s*\)/);
  });

  it("exits 2 on config error (missing env vars)", () => {
    expect(scriptSrc).toMatch(/process\.exit\(\s*2\s*\)/);
  });

  it("non-allowlisted foreign entrypoints + orphan deployed functions count as FAIL", () => {
    // The exit code is `fail = drifted > 0 || unallowedForeign > 0 || unallowedOrphans > 0`
    expect(scriptSrc).toMatch(/unallowedForeign\.length\s*>\s*0/);
    expect(scriptSrc).toMatch(/unallowedOrphans\.length\s*>\s*0/);
  });

  it("orphan_local is a warning (still exit 0) — a new function not yet deployed is normal", () => {
    expect(scriptSrc).toMatch(/orphan_local.*WARN.*still exit 0/i);
  });
});

describe("R-6: allowlist file is well-formed JSON", () => {
  it("parses as JSON and has an `entries` array", () => {
    const parsed = JSON.parse(allowlistJson);
    expect(parsed.entries).toBeInstanceOf(Array);
  });

  it("every entry has a slug + reason", () => {
    const parsed = JSON.parse(allowlistJson);
    for (const e of parsed.entries) {
      expect(typeof e.slug).toBe("string");
      expect(e.slug.length).toBeGreaterThan(0);
      expect(typeof e.reason).toBe("string");
      expect(e.reason.length).toBeGreaterThan(10); // forces a meaningful reason
    }
  });

  it("includes the 7 known legacy sos-backend / ops-probe slugs (so CI doesn't false-alarm)", () => {
    const parsed = JSON.parse(allowlistJson);
    const slugs = new Set(parsed.entries.map((e: { slug: string }) => e.slug));
    for (const s of [
      "sos-dispatch",
      "company-generate-qr",
      "verify-company-checkin",
      "create-company-checkin-session",
      "trigger-emergency",
      "secrets-probe",
      "vapid-diag",
    ]) {
      expect(slugs.has(s)).toBe(true);
    }
  });
});

describe("R-6: probes.yml workflow — trigger + filter invariants", () => {
  it("declares the push trigger on main (paths-filtered to function + script changes)", () => {
    expect(workflowYml).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(workflowYml).toMatch(/paths:\s*\n[\s\S]{0,300}supabase\/functions\/\*\*/);
    expect(workflowYml).toMatch(/scripts\/check-function-drift\.mjs/);
  });

  it("declares function-drift-probe job gated to push + 6h cron + workflow_dispatch", () => {
    expect(workflowYml).toMatch(/function-drift-probe:/);
    // The if: condition must cover all three trigger paths.
    expect(workflowYml).toMatch(
      /function-drift-probe[\s\S]{0,800}github\.event_name\s*==\s*['"]push['"][\s\S]{0,200}github\.event\.schedule\s*==\s*['"]0 \*\/6 \* \* \*['"]/,
    );
  });

  it("invokes the drift script with both SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF env vars", () => {
    expect(workflowYml).toMatch(/SUPABASE_ACCESS_TOKEN:\s*\$\{\{\s*secrets\.SUPABASE_ACCESS_TOKEN\s*\}\}/);
    expect(workflowYml).toMatch(/SUPABASE_PROJECT_REF:\s*\$\{\{\s*secrets\.SUPABASE_PROJECT_REF\s*\}\}/);
    expect(workflowYml).toMatch(/node scripts\/check-function-drift\.mjs/);
  });

  it("function-drift-probe checks out the repo (needs git source for comparison)", () => {
    expect(workflowYml).toMatch(/function-drift-probe[\s\S]{0,1000}actions\/checkout@v4/);
  });

  it("function-drift-probe uses Node 20", () => {
    expect(workflowYml).toMatch(/function-drift-probe[\s\S]{0,800}actions\/setup-node@v4[\s\S]{0,100}node-version:\s*["']?20/);
  });

  it("function-drift-probe has a 5-minute timeout (drift script does N+1 API calls)", () => {
    expect(workflowYml).toMatch(/function-drift-probe[\s\S]{0,300}timeout-minutes:\s*5/);
  });

  it("workflow comment mentions FIVE jobs across THREE cadences", () => {
    expect(workflowYml).toMatch(/Five jobs across three cadences/);
  });
});