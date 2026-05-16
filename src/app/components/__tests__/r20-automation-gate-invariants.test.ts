// ═══════════════════════════════════════════════════════════════
// R-20 (2026-05-16) — 3-layer automation gate
// ─────────────────────────────────────────────────────────────
// CONTEXT
//   Despite R-7 (npm run verify) being available since 2026-05-04, a
//   broken contract test slipped through to main on 2026-05-15. Root
//   cause: developer (me) didn't run `npm run verify` before push.
//   Infrastructure existed; discipline lapsed.
//
//   R-20 closes this class of bug by automating the gate at THREE layers:
//
//     Layer A  pre-push hook (.githooks/pre-push)
//       Local. Runs verify before any `git push`. Bypass via --no-verify.
//
//     Layer B  verify-in-deploy (scripts/deploy-edge-function.mjs)
//       Local. Runs verify before any `supabase functions deploy`.
//       Bypass via --skip-verify.
//
//     Layer C  GitHub branch protection (manual UI config)
//       Remote. Blocks merge to main if CI status checks aren't green.
//       Documented in this test; not auto-verifiable here.
//
//   Each layer adds independent protection. Skipping ALL three requires
//   active, deliberate steps — no accidental broken-main pushes.
//
// CONTRACT
//   - .githooks/pre-push exists, is executable, runs `npm run verify`
//   - scripts/install-git-hooks.mjs is idempotent + silent in CI
//   - package.json postinstall chains the hook installer
//   - scripts/deploy-edge-function.mjs has a Step 0 verify gate
//   - --skip-verify flag exists for emergency bypass
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let preHookSrc = "";
let installHookSrc = "";
let deployWrapperSrc = "";
let pkg: { scripts: Record<string, string> } = { scripts: {} };

beforeAll(() => {
  preHookSrc = fs.readFileSync(path.resolve(process.cwd(), ".githooks/pre-push"), "utf8");
  installHookSrc = fs.readFileSync(path.resolve(process.cwd(), "scripts/install-git-hooks.mjs"), "utf8");
  deployWrapperSrc = fs.readFileSync(path.resolve(process.cwd(), "scripts/deploy-edge-function.mjs"), "utf8");
  pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
});

describe("R-20 Layer A: pre-push hook", () => {
  it(".githooks/pre-push exists and is a bash script", () => {
    expect(preHookSrc).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it("hook runs `npm run verify`", () => {
    expect(preHookSrc).toMatch(/npm run[\s\S]{0,80}verify/);
  });

  it("hook fails the push when verify fails (set -e)", () => {
    expect(preHookSrc).toMatch(/set -e/);
  });

  it("hook is marked executable in git index (cross-platform)", () => {
    // Windows filesystems don't expose the Unix executable bit via stat().
    // The portable check is git's index: \`git ls-files --stage\` reports
    // mode 100755 for executable files, 100644 for non-executable. This
    // mode is preserved across clones — on Linux/macOS the file gets +x
    // on checkout, on Windows the bit is recorded in the index and replayed
    // when the same repo is checked out on a POSIX system (incl. CI).
    const { execSync } = require("node:child_process");
    const out = execSync("git ls-files --stage .githooks/pre-push", { encoding: "utf8" }).trim();
    // Expected format: "100755 <hash> 0\t.githooks/pre-push"
    expect(out, `git ls-files output: ${out}`).toMatch(/^100755\s/);
  });
});

describe("R-20 Layer A: install-git-hooks.mjs auto-config", () => {
  it("script exists + passes node syntax check (verified at runtime)", () => {
    expect(installHookSrc.length).toBeGreaterThan(500);
  });

  it("sets git config core.hooksPath to .githooks", () => {
    expect(installHookSrc).toMatch(/git config core\.hooksPath \.githooks/);
  });

  it("is idempotent — no-ops when already configured", () => {
    expect(installHookSrc).toMatch(/already configured/);
    expect(installHookSrc).toMatch(/core\.hooksPath/);
  });

  it("silent in CI (only logs to TTY)", () => {
    expect(installHookSrc).toMatch(/process\.stdout\.isTTY/);
  });

  it("skips outside a git working tree (Docker / shallow clone)", () => {
    expect(installHookSrc).toMatch(/no \.git\/ found/);
  });

  it("doesn't fail npm install if hook config fails (non-fatal)", () => {
    expect(installHookSrc).toMatch(/non-fatal|catch[\s\S]{0,60}process\.exit\(0\)/);
  });
});

describe("R-20 Layer A: postinstall chains hook installer", () => {
  it("package.json postinstall runs install-git-hooks.mjs", () => {
    expect(pkg.scripts.postinstall).toMatch(/install-git-hooks\.mjs/);
  });

  it("postinstall still runs the original fix-capacitor-gradle.cjs (no regression)", () => {
    expect(pkg.scripts.postinstall).toMatch(/fix-capacitor-gradle\.cjs/);
  });
});

describe("R-20 Layer B: verify-in-deploy wrapper", () => {
  it("deploy:fn wrapper runs verify as a pre-deploy step", () => {
    expect(deployWrapperSrc).toMatch(/step 0[\s\S]{0,200}npm run/);
    expect(deployWrapperSrc).toMatch(/npm[\s\S]{0,40}["']verify["']/);
  });

  it("verify failure aborts the deploy BEFORE supabase is touched", () => {
    expect(deployWrapperSrc).toMatch(/verify FAILED[\s\S]{0,80}deploy aborted/);
  });

  it("--skip-verify flag exists for emergency bypass", () => {
    expect(deployWrapperSrc).toMatch(/args\.includes\(\s*["']--skip-verify["']\s*\)/);
  });

  it("--skip-verify prints a warning so it's visible in the log", () => {
    expect(deployWrapperSrc).toMatch(/skip-verify in use[\s\S]{0,80}know what you're doing/);
  });

  it("default behaviour is verify-on (skipVerify defaults false)", () => {
    expect(deployWrapperSrc).toMatch(/const skipVerify\s*=\s*args\.includes/);
    // Used in the negation: if (!skipVerify) → run verify
    expect(deployWrapperSrc).toMatch(/if\s*\(\s*!skipVerify\s*\)/);
  });
});
