#!/usr/bin/env node
/**
 * Safety Score — honesty/regression guard.
 *
 * Contract this protects (after the move from a fabricated gamification
 * leaderboard to the REAL, server-computed company safety score):
 *   1. The service calls the real server engine `get_safety_score_history`
 *      (resolved/total emergency outcomes) — not a hardcoded number.
 *   2. The dashboard component no longer ships a hardcoded LEADERBOARD /
 *      DEMO_LEADERBOARD array — the leaderboard is derived from live store
 *      employees.
 *   3. No fabricated per-worker streak/points are displayed (the "{x}d streak"
 *      and "+{x} pts" strings are gone).
 *   4. "Safety Champion" is awarded only to a strictly-unique top scorer
 *      (uniqueTop guard) — never crowned on a tie at the baseline.
 *
 * Run:  node scripts/__behavior_tests__/safety-score.spec.mjs
 * Exit: 0 on pass, 1 on any failure.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SERVICE = readFileSync(resolve(ROOT, "src/app/components/safety-score-service.ts"), "utf8");
const COMP = readFileSync(resolve(ROOT, "src/app/components/safety-gamification.tsx"), "utf8");

let failures = 0;
const assert = (label, cond) => {
  console.log(`${cond ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}`);
  if (!cond) failures++;
};

assert("service calls real RPC get_safety_score_history",
  /\.rpc\(\s*["']get_safety_score_history["']/.test(SERVICE));
assert("service is company-scoped (getCompanyId)",
  /getCompanyId\(\)/.test(SERVICE));
assert("component no longer ships a hardcoded LEADERBOARD/DEMO array",
  !/DEMO_LEADERBOARD/.test(COMP) && !/const\s+LEADERBOARD\s*[:=]/.test(COMP));
assert("leaderboard derived from live store employees",
  /useDashboardStore\(s => s\.employees\)/.test(COMP) && /\[\.\.\.storeEmployees\]/.test(COMP));
assert("no fabricated per-worker streak displayed",
  !/d streak/.test(COMP));
assert("no fabricated per-worker points displayed",
  !/\+\{worker\.pointsThisMonth\}/.test(COMP));
assert("Safety Champion requires a strictly-unique top scorer",
  /uniqueTop/.test(COMP) && /ranked\[0\]\.score > ranked\[1\]\.score/.test(COMP));
assert("component surfaces the real company score card",
  /CompanySafetyScoreCard/.test(COMP) && /fetchSafetyScoreHistory/.test(COMP));

console.log(`\n${failures === 0 ? "\x1b[32m✓ ALL PASS\x1b[0m" : `\x1b[31m✗ ${failures} FAILURE(S)\x1b[0m`}\n`);
process.exit(failures === 0 ? 0 : 1);
