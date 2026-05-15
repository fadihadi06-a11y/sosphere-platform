#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — deploy + auto-update-manifest wrapper (R-15)
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//   R-6's manifest-based drift detection requires running `npm run drift:update`
//   after every legitimate `supabase functions deploy`. Forgetting it makes
//   R-6 false-positive on the next probe run — which keeps biting us.
//   This wrapper fuses the two steps so the human can't forget:
//
//     npm run deploy:fn <slug>
//
//   Does:
//     1. supabase functions deploy <slug> --project-ref <ref>
//     2. on success → node scripts/check-function-drift.mjs --update-manifest
//     3. git add supabase/functions/.deploy-manifest.json
//     4. Print the next commit + push instructions (does NOT auto-commit:
//        the developer should see + approve the manifest diff)
//
// USAGE
//   $env:SUPABASE_PROJECT_REF = "rtfhkbskgrasamhjraul"  # or set persistently
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."             # for drift:update
//   npm run deploy:fn sos-alert
//
// EXIT
//   0 on success (deploy AND manifest update both clean)
//   non-zero if either step fails — manifest stays pinned to last good
// ═══════════════════════════════════════════════════════════════════════════

import { spawnSync } from "node:child_process";

const slug = process.argv[2];
if (!slug) {
  console.error("usage: npm run deploy:fn <slug>");
  process.exit(2);
}

const projectRef = process.env.SUPABASE_PROJECT_REF;
if (!projectRef) {
  console.error("ERROR: SUPABASE_PROJECT_REF env var required.");
  process.exit(2);
}

console.log(`[deploy] step 1/3 — supabase functions deploy ${slug}`);
const dep = spawnSync(
  "npx",
  ["supabase", "functions", "deploy", slug, "--project-ref", projectRef],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (dep.status !== 0) {
  console.error(`[deploy] supabase deploy FAILED (exit ${dep.status}) — manifest untouched.`);
  process.exit(dep.status || 1);
}

console.log(`\n[deploy] step 2/3 — refreshing deploy manifest`);
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

console.log(`\n[deploy] step 3/3 — staging manifest for commit`);
const add = spawnSync("git", ["add", "supabase/functions/.deploy-manifest.json"], { stdio: "inherit" });
if (add.status !== 0) {
  console.warn(`[deploy] git add returned ${add.status} — stage the manifest manually.`);
}

console.log(`\n[deploy] DONE. Next steps:`);
console.log(`   git diff --cached supabase/functions/.deploy-manifest.json   # review change`);
console.log(`   git commit -m "deploy: ${slug} @ \$(date -u +%Y-%m-%dT%H:%MZ)"`);
console.log(`   git push origin main`);
console.log(`\n[deploy] R-6 function-drift probe should now stay green for this slug.`);
