// ═══════════════════════════════════════════════════════════════
// R-15 (2026-05-15) — auto-update manifest after every deploy
// ─────────────────────────────────────────────────────────────
// WHY R-15 EXISTS
//   R-6's manifest-based drift detection requires `npm run drift:update`
//   after every legitimate `supabase functions deploy <slug>`. Forgetting
//   that step makes R-6 false-positive on the next probe run.
//
//   It bit us multiple times in one week:
//     - After R-13 (sos-alert deploy) — manifest not updated → R-6 red
//     - After R-10 (sos-dispatch-probe v4) — caught in MCP deploy flow
//
//   The root fix is to make the two steps inseparable. R-15 adds a
//   `npm run deploy:fn <slug>` wrapper that:
//     1. Runs supabase functions deploy
//     2. On success, runs drift:update
//     3. Stages the manifest for commit
//     4. Prints the commit + push instructions
//
//   The developer cannot deploy without the manifest being current.
//
// CONTRACT (locked by this test)
//   - scripts/deploy-edge-function.mjs exists + node-syntax-checkable
//   - It REQUIRES SUPABASE_PROJECT_REF env var
//   - It calls `supabase functions deploy <slug> --project-ref ...`
//   - On deploy success, it invokes scripts/check-function-drift.mjs
//     with --update-manifest
//   - It stages the manifest via `git add`
//   - package.json exposes `deploy:fn` npm script
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

let wrapperSrc = "";

beforeAll(() => {
  wrapperSrc = fs.readFileSync(
    path.resolve(process.cwd(), "scripts/deploy-edge-function.mjs"),
    "utf8",
  );
});

describe("R-15: deploy wrapper is well-formed", () => {
  it("scripts/deploy-edge-function.mjs exists", () => {
    expect(wrapperSrc.length).toBeGreaterThan(200);
  });

  it("passes node --check", () => {
    const r = spawnSync("node", ["--check", "scripts/deploy-edge-function.mjs"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
});

describe("R-15: wrapper enforces the manifest-current contract", () => {
  it("requires SUPABASE_PROJECT_REF env var (fail-closed)", () => {
    expect(wrapperSrc).toMatch(/process\.env\.SUPABASE_PROJECT_REF/);
    expect(wrapperSrc).toMatch(/SUPABASE_PROJECT_REF env var required/);
  });

  it("invokes `supabase functions deploy` as step 1", () => {
    expect(wrapperSrc).toMatch(/\[deploy\] step 1\/3 — supabase functions deploy/);
    expect(wrapperSrc).toMatch(/\[\s*["']supabase["']\s*,\s*["']functions["']\s*,\s*["']deploy["']\s*,/);
  });

  it("aborts manifest update if deploy fails (manifest stays at last good pin)", () => {
    expect(wrapperSrc).toMatch(/supabase deploy FAILED[\s\S]{0,200}manifest untouched/);
    expect(wrapperSrc).toMatch(/process\.exit\(dep\.status/);
  });

  it("invokes check-function-drift.mjs --update-manifest as step 2", () => {
    expect(wrapperSrc).toMatch(/\[deploy\] step 2\/3/);
    expect(wrapperSrc).toMatch(/scripts\/check-function-drift\.mjs[\s\S]{0,100}--update-manifest/);
  });

  it("warns + exits non-zero if manifest update fails (deploy succeeded but pin stale)", () => {
    expect(wrapperSrc).toMatch(/manifest update FAILED/);
    expect(wrapperSrc).toMatch(/deployed function is LIVE but manifest is stale/);
  });

  it("stages the manifest via git add as step 3", () => {
    expect(wrapperSrc).toMatch(/\[deploy\] step 3\/3 — staging manifest/);
    expect(wrapperSrc).toMatch(/git[\s\S]{0,30}add[\s\S]{0,80}\.deploy-manifest\.json/);
  });

  it("prints next-step commit + push instructions", () => {
    expect(wrapperSrc).toMatch(/git commit/);
    expect(wrapperSrc).toMatch(/git push/);
  });
});

describe("R-15: package.json exposes the npm script", () => {
  it("has `deploy:fn` script pointing at the wrapper", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts["deploy:fn"]).toBe("node scripts/deploy-edge-function.mjs");
  });
});
