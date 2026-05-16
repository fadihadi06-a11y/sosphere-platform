#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — install git hooks (R-20 layer A)
// ─────────────────────────────────────────────────────────────────────────
// Configures git to use .githooks/ instead of the per-clone .git/hooks/
// folder. This makes hooks VERSIONED — they ship with the repo, every
// developer gets them automatically when they run `npm install`.
//
// Idempotent: re-runs are no-ops. Silent in CI (no TTY) so CI logs don't
// fill with noise. Skipped entirely outside a git working tree (e.g.,
// inside Docker build, where .git/ doesn't exist).
//
// Invoked automatically via package.json `postinstall`.
// ═══════════════════════════════════════════════════════════════════════════

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Skip outside a git working tree (Docker build, etc.)
if (!existsSync(resolve(repoRoot, ".git"))) {
  // Silent in non-TTY (CI) environments
  if (process.stdout.isTTY) console.log("[install-hooks] no .git/ found — skipping (likely Docker/CI)");
  process.exit(0);
}

// Skip if .githooks/ folder isn't checked in (cloned shallow, etc.)
if (!existsSync(resolve(repoRoot, ".githooks"))) {
  if (process.stdout.isTTY) console.log("[install-hooks] no .githooks/ folder — skipping");
  process.exit(0);
}

try {
  const current = execSync("git config --get core.hooksPath", { cwd: repoRoot, encoding: "utf8" })
    .trim();
  if (current === ".githooks") {
    if (process.stdout.isTTY) console.log("[install-hooks] ✓ already configured (core.hooksPath=.githooks)");
    process.exit(0);
  }
} catch {
  // git config exits 1 if the key isn't set — fall through to set it
}

try {
  execSync("git config core.hooksPath .githooks", { cwd: repoRoot });
  console.log("[install-hooks] ✓ configured git to use .githooks/ — pre-push gate is now active");
} catch (e) {
  console.warn("[install-hooks] WARN: could not set core.hooksPath:", String(e).slice(0, 200));
  // Don't fail npm install if hook config fails — non-fatal
  process.exit(0);
}
