#!/usr/bin/env node
/**
 * Safety Intelligence — honesty/regression guard.
 *
 * After removing the "AI theater" (fabricated risk inputs, hardcoded KPIs,
 * static fake weather, dead-end action buttons), this locks in that the hub
 * runs on REAL data only.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const si = readFileSync(resolve(ROOT, "src/app/components/safety-intelligence.tsx"), "utf8");

let failures = 0;
const assert = (label, cond) => {
  console.log(`${cond ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}`);
  if (!cond) failures++;
};

// 1. No fabricated datasets / numbers remain.
assert("no MOCK_ALERTS dataset", !/MOCK_ALERTS/.test(si));
assert("no ENV_THREATS static weather dataset", !/ENV_THREATS/.test(si));
assert("no hardcoded 'AI Interventions' 47 hero stat", !/"AI Interventions"/.test(si));
assert("no fabricated Overview KPIs (Risks Prevented / Auto-Alerts Sent / 18s)",
  !/Risks Prevented/.test(si) && !/Auto-Alerts Sent/.test(si) && !/18s avg\. prevention/.test(si));

// 2. Site risk score is derived from real worker risks (no synthetic drift).
assert("liveScore derived from workerRisks (no useState seed 72)",
  !/useState\(72\)/.test(si) && /const liveScore = useMemo/.test(si));
assert("no synthetic drift-to-baseline interval", !/baseline = 35/.test(si));

// 3. Worker risk fed REAL inputs (real buddy/weather ctx, battery skipped).
assert("worker risk uses real ctx (buddy + weather) not seed",
  /ctx: \{ buddyEmpIds/.test(si) && /batteryLevel: null/.test(si));
assert("buddy pairs + weather loaded for real context",
  /fetchBuddyPairs\(\)/.test(si) && /loadLatestPerZone\(/.test(si));

// 4. Environment view is real weather (or honest empty state).
assert("environment driven by live weather (envWeather/weatherRows)",
  /const envWeather = useMemo/.test(si) && /No live weather data/.test(si));

// 5. Action buttons are real.
assert("Contact really calls (safeTelCall)", /safeTelCall\(emp\.phone/.test(si));
assert("Send Alert really pushes (sendBroadcast custom audience)",
  /sendBroadcast\(\{/.test(si) && /audience: \{ type: "custom"/.test(si));
assert("Locate opens the worker (no fake 'GPS coordinates updated')",
  !/GPS coordinates updated/.test(si) && /onOpenEmployeeDetail\(emp\.id\)/.test(si));

console.log(`\n${failures === 0 ? "\x1b[32m✓ ALL PASS\x1b[0m" : `\x1b[31m✗ ${failures} FAILURE(S)\x1b[0m`}\n`);
process.exit(failures === 0 ? 0 : 1);
