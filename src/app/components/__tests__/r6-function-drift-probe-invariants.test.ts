// ═══════════════════════════════════════════════════════════════
// R-6 (2026-05-14) — deployed-vs-git function drift probe invariants
// ─────────────────────────────────────────────────────────────
// AFTER live-run-3 pivot, R-6 no longer attempts byte-for-byte source
// comparison. Supabase CLI transpiles TS→JS + bundles imports before
// deploy, so deployed source never matches local source byte-equal.
//
// Current design: pin Supabase's published `ezbr_sha256` (canonical
// fingerprint of the deployed bundle) into a manifest file. R-6 --check
// compares live ezbr vs pinned ezbr. Mismatch = someone deployed without
// updating the manifest (or via Studio UI, or from another machine).
//
// LAYERS
//   LAYER 1 (this file): static source-level invariants.
//   LAYER 2 (script): live exec against Supabase Management API.
//   LAYER 3 (GHA): runs the script on every push + 6h cron.
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
    expect(scriptSrc).not.toMatch(/apikey:\s*ACCESS_TOKEN/);
  });
});

describe("R-6: ezbr_sha256 manifest-based comparison (post-pivot)", () => {
  it("uses `ezbr_sha256` field from /projects/{ref}/functions metadata", () => {
    expect(scriptSrc).toMatch(/ezbr_sha256/);
    expect(scriptSrc).toMatch(/\/projects\/\$\{[^}]+\}\/functions/);
  });

  it("does NOT decode ESZIP bundles (deliberately pivoted away from byte-compare)", () => {
    expect(scriptSrc).not.toMatch(/@deno\/eszip/);
    expect(scriptSrc).not.toMatch(/EszipParser/);
    expect(scriptSrc).not.toMatch(/parseBytes/);
  });

  it("reads the manifest file from supabase/functions/.deploy-manifest.json", () => {
    expect(scriptSrc).toMatch(/\.deploy-manifest\.json/);
    expect(scriptSrc).toMatch(/MANIFEST_FILE/);
  });

  it("supports --update-manifest mode to regenerate the manifest from live state", () => {
    expect(scriptSrc).toMatch(/--update-manifest/);
    expect(scriptSrc).toMatch(/MODE\s*=.*update/);
  });

  it("--update-manifest writes ezbr + version + pinned_at per entry", () => {
    expect(scriptSrc).toMatch(/ezbr:\s+fn\.ezbr_sha256/);
    expect(scriptSrc).toMatch(/version:\s+fn\.version/);
    expect(scriptSrc).toMatch(/pinned_at:/);
  });

  it("--check compares pinned.ezbr to fn.ezbr_sha256 (exact-string match)", () => {
    expect(scriptSrc).toMatch(/pinned\.ezbr\s*===\s*fn\.ezbr_sha256/);
  });
});

describe("R-6: check-function-drift.mjs — report categories", () => {
  it("categorizes into in_sync / drifted / orphan_deployed / orphan_local / foreign_entrypoint / missing_from_manifest", () => {
    for (const cat of [
      "in_sync", "drifted", "orphan_deployed", "orphan_local",
      "foreign_entrypoint", "missing_from_manifest",
    ]) {
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

describe("R-6: exit code policy", () => {
  it("exits 1 on drift (so curl/GHA detects failure)", () => {
    expect(scriptSrc).toMatch(/process\.exit\(\s*fail\s*\?\s*1\s*:\s*0\s*\)/);
  });

  it("exits 2 on config error (missing env vars)", () => {
    expect(scriptSrc).toMatch(/process\.exit\(\s*2\s*\)/);
  });

  it("drifted + missing_from_manifest + non-allowlisted foreign all count as FAIL", () => {
    expect(scriptSrc).toMatch(/report\.drifted\.length\s*>\s*0/);
    expect(scriptSrc).toMatch(/report\.missing_from_manifest\.length\s*>\s*0/);
    expect(scriptSrc).toMatch(/unallowedForeign\.length\s*>\s*0/);
  });
});

describe("R-6: allowlist file is well-formed JSON", () => {
  it("parses as JSON and has an `entries` array", () => {
    const parsed = JSON.parse(allowlistJson);
    expect(parsed.entries).toBeInstanceOf(Array);
  });

  it("every entry has a slug + reason of meaningful length", () => {
    const parsed = JSON.parse(allowlistJson);
    for (const e of parsed.entries) {
      expect(typeof e.slug).toBe("string");
      expect(e.slug.length).toBeGreaterThan(0);
      expect(typeof e.reason).toBe("string");
      expect(e.reason.length).toBeGreaterThan(10);
    }
  });

  it("includes the 7 known legacy sos-backend / ops-probe slugs", () => {
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
  it("declares the push trigger on main (paths-filtered)", () => {
    expect(workflowYml).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(workflowYml).toMatch(/paths:\s*\n[\s\S]{0,300}supabase\/functions\/\*\*/);
    expect(workflowYml).toMatch(/scripts\/check-function-drift\.mjs/);
  });

  it("declares function-drift-probe job gated to push + 6h cron + workflow_dispatch", () => {
    expect(workflowYml).toMatch(/function-drift-probe:/);
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
    expect(workflowYml).toMatch(/function-drift-probe[\s\S]{0,1200}actions\/setup-node@v4[\s\S]{0,200}node-version:\s*["']?20/);
  });

  it("function-drift-probe has a 5-minute timeout", () => {
    expect(workflowYml).toMatch(/function-drift-probe[\s\S]{0,300}timeout-minutes:\s*5/);
  });

  it("workflow comment mentions FIVE jobs across THREE cadences", () => {
    expect(workflowYml).toMatch(/Five jobs across three cadences/);
  });
});

describe("R-6: package.json + supporting files", () => {
  it("provides a `drift:update` npm script for refreshing the manifest after deploy", () => {
    const pkg = JSON.parse(READ("package.json"));
    expect(pkg.scripts["drift:update"]).toMatch(/--update-manifest/);
  });

  it("does NOT keep @deno/eszip as a dependency (no longer needed after pivot)", () => {
    const pkg = JSON.parse(READ("package.json"));
    const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    expect(all["@deno/eszip"]).toBeUndefined();
  });
});
