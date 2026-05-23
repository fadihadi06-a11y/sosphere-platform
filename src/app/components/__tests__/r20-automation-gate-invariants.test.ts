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
import { execSync } from "node:child_process";

let preHookSrc = "";
let installHookSrc = "";
let deployWrapperSrc = "";
let verifyScriptSrc = "";
let lefthookYmlSrc = "";
let pkg: { scripts: Record<string, string> } = { scripts: {} };

beforeAll(() => {
  preHookSrc = fs.readFileSync(path.resolve(process.cwd(), ".githooks/pre-push"), "utf8");
  installHookSrc = fs.readFileSync(path.resolve(process.cwd(), "scripts/install-git-hooks.mjs"), "utf8");
  deployWrapperSrc = fs.readFileSync(path.resolve(process.cwd(), "scripts/deploy-edge-function.mjs"), "utf8");
  verifyScriptSrc = fs.readFileSync(path.resolve(process.cwd(), "scripts/verify-before-push.mjs"), "utf8");
  lefthookYmlSrc = fs.readFileSync(path.resolve(process.cwd(), "lefthook.yml"), "utf8");
  pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
});

// ────────────────────────────────────────────────────────────────────────
// P0-Z0 (2026-05-23) replaced the legacy R-20 shell-script pre-push hook
// with lefthook's auto-generated dispatcher. The hook file now starts with
// `#!/bin/sh` and delegates to `lefthook run pre-push`, which executes the
// commands declared in lefthook.yml. The R-20 CONTRACT is preserved (verify
// still runs before push); only the IMPLEMENTATION shape changed. These
// tests were updated in P0-Z2 to assert the contract at its new location.
// ────────────────────────────────────────────────────────────────────────
describe("R-20 Layer A: pre-push hook (lefthook delegation)", () => {
  it(".githooks/pre-push exists and is a shell-executable hook", () => {
    // Lefthook's hook is POSIX sh (more portable than bash), and starts with
    // a standard shebang. Accept either #!/bin/sh or #!/usr/bin/env bash so
    // the test survives a future lefthook upgrade or a manual rewrite.
    expect(preHookSrc).toMatch(/^#!(\/bin\/sh|\/usr\/bin\/env bash)/);
  });

  it("pre-push delegates to lefthook (or runs verify directly)", () => {
    // Two acceptable shapes:
    //   (a) lefthook dispatcher: contains `call_lefthook run "pre-push"`
    //   (b) legacy R-20 wrapper: contains `npm run verify`
    // Either preserves the R-20 contract.
    const isLefthookDispatcher = /call_lefthook\s+run\s+["']?pre-push["']?/.test(preHookSrc);
    const isLegacyR20Wrapper = /npm run[\s\S]{0,80}verify/.test(preHookSrc);
    expect(
      isLefthookDispatcher || isLegacyR20Wrapper,
      "pre-push must either delegate to lefthook or call `npm run verify` directly",
    ).toBe(true);
  });

  it("lefthook.yml pre-push runs `npm run verify` (R-20 gate preserved)", () => {
    // Find the pre-push: block, then assert verify-before-push command exists
    // and runs `npm run verify`. This is the new location of the R-20 gate.
    const prePushMatch = lefthookYmlSrc.match(/^pre-push:[\s\S]+?(?=^[a-z]|\Z)/m);
    expect(prePushMatch, "lefthook.yml must declare a pre-push block").toBeTruthy();
    const prePushBlock = prePushMatch![0];
    expect(prePushBlock).toMatch(/verify-before-push:/);
    expect(prePushBlock).toMatch(/npm run verify/);
  });

  it("hook propagates failures (lefthook returns non-zero on any failed command)", () => {
    // Lefthook's hook calls `call_lefthook run "pre-push"` and exits with that
    // status — equivalent to the legacy `set -e` + direct command pattern.
    // Test by structure: hook either has explicit `set -e` (legacy) or
    // invokes `call_lefthook` (which propagates exit codes by default).
    const propagatesViaLefthook = /call_lefthook/.test(preHookSrc);
    const propagatesViaSetE = /set -e/.test(preHookSrc);
    expect(
      propagatesViaLefthook || propagatesViaSetE,
      "pre-push hook must propagate command failures",
    ).toBe(true);
  });

  it("hook is marked executable in git index (cross-platform)", () => {
    // Windows filesystems don't expose the Unix executable bit via stat().
    // The portable check is git's index: `git ls-files --stage` reports
    // mode 100755 for executable files, 100644 for non-executable. This
    // mode is preserved across clones — on Linux/macOS the file gets +x
    // on checkout, on Windows the bit is recorded in the index and replayed
    // when the same repo is checked out on a POSIX system (incl. CI).
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

// ───────────────────────────────────────────────────────────────────────
// R-23 (2026-05-16) — local ↔ CI parity invariants
// CONTEXT
//   Despite R-20 being in place, R-22's push succeeded `npm run verify`
//   locally but failed 3 CI jobs (Vitest, ESLint, Security Audit) — all
//   at the `npm ci` step, because R-20 commit 2407793 added "yaml" to
//   package.json devDependencies without regenerating package-lock.json.
//   The old Gate 4 only checked the lockfile's top-level deps map, not the
//   per-package install entry (`packages["node_modules/yaml"]`). CI's
//   `npm ci` enforces both; verify enforced only one.
//
//   Additionally, two CI jobs had ZERO local mirror: Security Audit
//   (`npm audit ...`) and Vite Build (`npx vite build`). They could fail
//   in CI and verify would always say all-clean.
//
// CONTRACT
//   verify-before-push.mjs MUST contain:
//     - a Gate 4 that checks both top-level deps AND per-package entries
//     - a Gate 4b that runs `npm ci --dry-run` (exact parity with CI)
//     - a Gate 9 that runs `npm audit --audit-level=critical --omit=dev`
//     - a Gate 10 that runs `npx vite build`
//   These commands are byte-for-byte identical to the CI workflow steps.
// ───────────────────────────────────────────────────────────────────────
describe("R-23: verify-before-push mirrors CI commands exactly", () => {
  it("Gate 4 checks per-package install entries (not just top-level deps)", () => {
    expect(verifyScriptSrc).toMatch(/node_modules\/.{0,5}\+ name/);
    expect(verifyScriptSrc).toMatch(/missingInstallEntry/);
  });

  it("Gate 4b runs `npm ci --dry-run --ignore-scripts` (CI parity)", () => {
    expect(verifyScriptSrc).toMatch(
      /spawnSync\(\s*["']npm["']\s*,\s*\[\s*["']ci["']\s*,\s*["']--dry-run["']\s*,\s*["']--ignore-scripts["']/,
    );
  });

  it("Gate 9 runs `npm audit --audit-level=critical --omit=dev` (matches ci.yml audit job)", () => {
    expect(verifyScriptSrc).toMatch(
      /spawnSync\(\s*["']npm["']\s*,\s*\[\s*["']audit["']\s*,\s*["']--audit-level=critical["']\s*,\s*["']--omit=dev["']/,
    );
  });

  it("Gate 10 runs `npx vite build` (matches ci.yml build job + APK workflow)", () => {
    expect(verifyScriptSrc).toMatch(
      /spawnSync\(\s*["']npx["']\s*,\s*\[\s*["']vite["']\s*,\s*["']build["']/,
    );
  });

  it("summary uses dynamic step count (no hardcoded total)", () => {
    expect(verifyScriptSrc).toMatch(/passed: " \+ \(stepsRun - failures\.length\)/);
  });
});
