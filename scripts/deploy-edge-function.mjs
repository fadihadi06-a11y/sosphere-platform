#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — deploy + auto-update-manifest wrapper (R-15 + R-15.5)
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//   R-6's manifest-based drift detection requires running `npm run drift:update`
//   after every legitimate `supabase functions deploy`. Forgetting it makes
//   R-6 false-positive on the next probe run — which keeps biting us.
//   This wrapper fuses the two steps so the human can't forget:
//
//     npm run deploy:fn <slug>                       → stages manifest; you commit
//     npm run deploy:fn <slug> -- --auto-commit      → also commits + pushes (R-15.5)
//
//   Steps:
//     1. supabase functions deploy <slug> --project-ref <ref>
//     2. on success → node scripts/check-function-drift.mjs --update-manifest
//     3. git add supabase/functions/.deploy-manifest.json
//     4. (--auto-commit only) git commit -m "deploy: <slug> @ <UTC ISO>"
//     5. (--auto-commit only) git push origin <current-branch>
//
// USAGE
//   $env:SUPABASE_PROJECT_REF = "rtfhkbskgrasamhjraul"     # or set persistently
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."                 # for drift:update
//   npm run deploy:fn sos-alert
//   npm run deploy:fn sos-alert -- --auto-commit
//
// EXIT
//   0 on success (all attempted steps clean)
//   non-zero if any step fails — partial state is reported, manifest stays
//   pinned to last good state on deploy failure.
//
// SAFETY NOTES (R-15.5)
//   - --auto-commit will NOT proceed if there is nothing to commit (i.e.
//     manifest already current). It exits 0 with a "nothing to commit" notice.
//   - It pushes to the CURRENT branch, never assumes "main". If you're on a
//     feature branch, the push goes there.
//   - Any commit / push failure exits non-zero with a clear "rollback me"
//     message — the deploy is already LIVE, but the developer must finish
//     the commit/push by hand.
// ═══════════════════════════════════════════════════════════════════════════

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("-"));
const autoCommit = args.includes("--auto-commit") || args.includes("-y");

if (!slug) {
  console.error("usage: npm run deploy:fn <slug> [-- --auto-commit]");
  process.exit(2);
}

const projectRef = process.env.SUPABASE_PROJECT_REF;
if (!projectRef) {
  console.error("ERROR: SUPABASE_PROJECT_REF env var required.");
  process.exit(2);
}

const totalSteps = autoCommit ? 5 : 3;

// R-20 Layer B: verify-before-deploy. Run `npm run verify` to catch JSON
// parse errors, ESLint warnings above threshold, migration drift, and
// vitest failures BEFORE we ship any code to Supabase. Bypass with
// --skip-verify if you know what you're doing (e.g., emergency rollback).
const skipVerify = args.includes("--skip-verify");
if (!skipVerify) {
  console.log(`[deploy] step 0 — npm run verify (pre-deploy gate)`);
  const ver = spawnSync("npm", ["run", "--silent", "verify"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (ver.status !== 0) {
    console.error(`[deploy] verify FAILED (exit ${ver.status}) — deploy aborted.`);
    console.error(`[deploy] Fix the failing gate, OR bypass with --skip-verify if certain.`);
    process.exit(ver.status || 1);
  }
  console.log(`[deploy] ✓ verify green. Proceeding to deploy.`);
} else {
  console.warn(`[deploy] WARNING: --skip-verify in use. Hope you know what you're doing.`);
}

console.log(`[deploy] step 1/${totalSteps} — supabase functions deploy ${slug}`);
const dep = spawnSync(
  "npx",
  ["supabase", "functions", "deploy", slug, "--project-ref", projectRef],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (dep.status !== 0) {
  console.error(`[deploy] supabase deploy FAILED (exit ${dep.status}) — manifest untouched.`);
  process.exit(dep.status || 1);
}

console.log(`\n[deploy] step 2/${totalSteps} — refreshing deploy manifest`);
const upd = spawnSync(
  "node",
  ["scripts/check-function-drift.mjs", "--update-manifest"],
  { stdio: "inherit" },
);
if (upd.status !== 0) {
  console.error(`[deploy] manifest update FAILED (exit ${upd.status}).`);
  console.error(`[deploy] WARNING: deployed function is LIVE but manifest is stale.`);
  console.error(`[deploy] Run \`npm run drift:update\` manually, then commit.`);
  process.exit(upd.status || 1);
}

console.log(`\n[deploy] step 3/${totalSteps} — staging manifest for commit`);
const add = spawnSync("git", ["add", "supabase/functions/.deploy-manifest.json"], { stdio: "inherit" });
if (add.status !== 0) {
  console.warn(`[deploy] git add returned ${add.status} — stage the manifest manually.`);
}

// ─── R-15.5: optional auto-commit + push ────────────────────────────────────
if (!autoCommit) {
  console.log(`\n[deploy] DONE. Next steps:`);
  console.log(`   git diff --cached supabase/functions/.deploy-manifest.json   # review change`);
  console.log(`   git commit -m "deploy: ${slug} @ \$(date -u +%Y-%m-%dT%H:%MZ)"`);
  console.log(`   git push origin main`);
  console.log(`\n[deploy] R-6 function-drift probe should now stay green for this slug.`);
  console.log(`[deploy] tip: pass \`-- --auto-commit\` to commit + push automatically.`);
  process.exit(0);
}

// Check there's something to commit. If `drift:update` resulted in no change
// (e.g. someone deployed an identical bundle), git commit would fail.
const diff = spawnSync(
  "git",
  ["diff", "--cached", "--quiet", "supabase/functions/.deploy-manifest.json"],
  { stdio: "pipe" },
);
if (diff.status === 0) {
  console.log(`\n[deploy] manifest already current — nothing to commit. DONE.`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const commitMsg = `deploy: ${slug} @ ${stamp}`;

console.log(`\n[deploy] step 4/${totalSteps} — git commit -m "${commitMsg}"`);
const com = spawnSync("git", ["commit", "-m", commitMsg], { stdio: "inherit" });
if (com.status !== 0) {
  console.error(`[deploy] git commit FAILED (exit ${com.status}).`);
  console.error(`[deploy] Deploy is LIVE + manifest staged; finish the commit/push by hand.`);
  process.exit(com.status || 1);
}

// Discover current branch — never assume "main".
const branchProc = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
const branch = (branchProc.stdout || "").trim();
if (!branch || branch === "HEAD") {
  console.error(`[deploy] could not determine current branch (got "${branch}").`);
  console.error(`[deploy] Push manually: git push origin <branch>`);
  process.exit(1);
}

console.log(`\n[deploy] step 5/${totalSteps} — git push origin ${branch}`);
const push = spawnSync("git", ["push", "origin", branch], { stdio: "inherit" });
if (push.status !== 0) {
  console.error(`[deploy] git push FAILED (exit ${push.status}).`);
  console.error(`[deploy] Commit is local; finish the push by hand:  git push origin ${branch}`);
  process.exit(push.status || 1);
}

console.log(`\n[deploy] DONE — deploy + manifest + commit + push all clean.`);
console.log(`[deploy] R-6 function-drift probe should stay green for ${slug}.`);
