// ═══════════════════════════════════════════════════════════════
// R-15 + R-15.5 (2026-05-15) — auto-update manifest after every deploy
//                              + optional --auto-commit flag
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
//   The root fix is to make the two steps inseparable. R-15 added a
//   `npm run deploy:fn <slug>` wrapper that:
//     1. Runs supabase functions deploy
//     2. On success, runs drift:update
//     3. Stages the manifest for commit
//     4. Prints the commit + push instructions
//
//   R-15.5 added a `--auto-commit` flag so the developer can opt in to
//   full automation:
//     4. git commit -m "deploy: <slug> @ <UTC ISO>"
//     5. git push origin <current-branch>
//
// CONTRACT (locked by this test)
//   - scripts/deploy-edge-function.mjs exists + node-syntax-checkable
//   - It REQUIRES SUPABASE_PROJECT_REF env var
//   - It calls `supabase functions deploy <slug> --project-ref ...`
//   - On deploy success, it invokes scripts/check-function-drift.mjs
//     with --update-manifest
//   - It stages the manifest via `git add`
//   - It accepts `--auto-commit` (and `-y`) to commit + push
//   - With --auto-commit: it short-circuits cleanly if nothing to commit
//   - With --auto-commit: it pushes to the CURRENT branch, never assumes "main"
//   - With --auto-commit: commit or push failure surfaces as non-zero exit
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
    expect(wrapperSrc).toMatch(/\[deploy\] step 1\/\$\{totalSteps\} — supabase functions deploy/);
    expect(wrapperSrc).toMatch(/\[\s*["']supabase["']\s*,\s*["']functions["']\s*,\s*["']deploy["']\s*,/);
  });

  it("aborts manifest update if deploy fails (manifest stays at last good pin)", () => {
    expect(wrapperSrc).toMatch(/supabase deploy FAILED[\s\S]{0,200}manifest untouched/);
    expect(wrapperSrc).toMatch(/process\.exit\(dep\.status/);
  });

  it("invokes check-function-drift.mjs --update-manifest as step 2", () => {
    expect(wrapperSrc).toMatch(/\[deploy\] step 2\/\$\{totalSteps\}/);
    expect(wrapperSrc).toMatch(/scripts\/check-function-drift\.mjs[\s\S]{0,100}--update-manifest/);
  });

  it("warns + exits non-zero if manifest update fails (deploy succeeded but pin stale)", () => {
    expect(wrapperSrc).toMatch(/manifest update FAILED/);
    expect(wrapperSrc).toMatch(/deployed function is LIVE but manifest is stale/);
  });

  it("stages the manifest via git add as step 3", () => {
    expect(wrapperSrc).toMatch(/\[deploy\] step 3\/\$\{totalSteps\} — staging manifest/);
    expect(wrapperSrc).toMatch(/git[\s\S]{0,30}add[\s\S]{0,80}\.deploy-manifest\.json/);
  });

  it("prints next-step commit + push instructions (default mode)", () => {
    expect(wrapperSrc).toMatch(/git commit/);
    expect(wrapperSrc).toMatch(/git push/);
  });
});

describe("R-15.5: optional --auto-commit flag", () => {
  it("parses --auto-commit (and -y alias) into a boolean", () => {
    expect(wrapperSrc).toMatch(/args\.includes\(\s*["']--auto-commit["']\s*\)/);
    expect(wrapperSrc).toMatch(/args\.includes\(\s*["']-y["']\s*\)/);
  });

  it("totalSteps reflects 5 when auto-commit is on, 3 when off", () => {
    expect(wrapperSrc).toMatch(/totalSteps\s*=\s*autoCommit\s*\?\s*5\s*:\s*3/);
  });

  it("short-circuits cleanly with exit 0 when there is nothing to commit", () => {
    // `git diff --cached --quiet` returns 0 if no changes are staged.
    expect(wrapperSrc).toMatch(/git[\s\S]{0,30}diff[\s\S]{0,80}--cached[\s\S]{0,40}--quiet/);
    expect(wrapperSrc).toMatch(/manifest already current[\s\S]{0,80}nothing to commit/);
  });

  it("step 4 commits with a deterministic message containing the slug + ISO timestamp", () => {
    expect(wrapperSrc).toMatch(/\[deploy\] step 4\/\$\{totalSteps\} — git commit/);
    expect(wrapperSrc).toMatch(/new Date\(\)\.toISOString\(\)/);
    expect(wrapperSrc).toMatch(/deploy:\s*\$\{slug\}\s*@\s*\$\{stamp\}/);
  });

  it("step 5 detects the CURRENT branch — never hardcodes 'main' for the push", () => {
    expect(wrapperSrc).toMatch(/rev-parse[\s\S]{0,40}--abbrev-ref[\s\S]{0,20}HEAD/);
    expect(wrapperSrc).toMatch(/\[deploy\] step 5\/\$\{totalSteps\} — git push origin \$\{branch\}/);
  });

  it("commit failure exits non-zero with a recovery hint", () => {
    expect(wrapperSrc).toMatch(/git commit FAILED/);
    expect(wrapperSrc).toMatch(/finish the commit\/push by hand/);
  });

  it("push failure exits non-zero with a recovery hint", () => {
    expect(wrapperSrc).toMatch(/git push FAILED/);
    expect(wrapperSrc).toMatch(/Commit is local; finish the push by hand/);
  });

  it("aborts with a clear message if branch detection returns 'HEAD' (detached)", () => {
    expect(wrapperSrc).toMatch(/branch === "HEAD"/);
    expect(wrapperSrc).toMatch(/could not determine current branch/);
  });

  it("mentions the --auto-commit tip in the default-mode footer", () => {
    expect(wrapperSrc).toMatch(/--auto-commit[\s\S]{0,100}commit \+ push automatically/);
  });
});

describe("R-15: package.json exposes the npm script", () => {
  it("has `deploy:fn` script pointing at the wrapper", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts["deploy:fn"]).toBe("node scripts/deploy-edge-function.mjs");
  });
});
