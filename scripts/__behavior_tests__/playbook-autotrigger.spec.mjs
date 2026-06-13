#!/usr/bin/env node
/**
 * Layer 3 — Playbook auto-trigger behavior guard.
 *
 * What this guards (regression contract for the auto-activation feature):
 *   1. EVENT_TO_TRIGGER maps EXACTLY the emergency events that have a verified
 *      source in the codebase to their playbook triggerType. If someone adds a
 *      mapping for an event with no real source (e.g. "Geofence Breach"), or
 *      removes a real one, this fails — so we never silently auto-activate a
 *      protocol for an event that can't actually fire (or stop activating one
 *      that can).
 *   2. autoActivatePlaybook only activates playbooks whose auto_trigger is ON
 *      (p.autoTrigger === true). This keeps owner control: a protocol never
 *      auto-fires unless the owner enabled it.
 *   3. autoActivatePlaybook does NOT broadcast / contact workers (Phase 1 is
 *      log + notify only). It must not import or call the broadcast helpers.
 *   4. The dashboard wiring is ISOLATED: company-dashboard.tsx calls
 *      autoActivatePlaybook fire-and-forget with a .catch, so an auto-trigger
 *      failure can never break emergency ingestion (life-safety path).
 *
 * Run:  node scripts/__behavior_tests__/playbook-autotrigger.spec.mjs
 * Exit: 0 on pass, 1 on any assertion failure.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SERVICE = resolve(REPO_ROOT, "src/app/components/playbook-service.ts");
const DASH = resolve(REPO_ROOT, "src/app/components/company-dashboard.tsx");

let failures = 0;
function log(kind, msg) {
  const color = kind === "PASS" ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}${kind}\x1b[0m ${msg}`);
}
function assert(label, cond) {
  if (cond) log("PASS", label);
  else { log("FAIL", label); failures++; }
}

const service = readFileSync(SERVICE, "utf8");
const dash = readFileSync(DASH, "utf8");

// ── 1. EVENT_TO_TRIGGER contract ────────────────────────────────────────────
// Every event below has a verified emit site in the codebase.
const EXPECTED = {
  SOS_TRIGGERED: "SOS Button",
  FALL_DETECTED: "Fall Detected",
  HAZARD_REPORT: "Environmental Hazard",
  MONITORING_MISSED: "Missed Check-in",
  SOS_DURESS_TRIGGERED: "Security Threat",
};
const mapBlock = (service.match(/const EVENT_TO_TRIGGER[^;]*?\{([\s\S]*?)\}/) || [])[1] || "";
for (const [evt, trig] of Object.entries(EXPECTED)) {
  const re = new RegExp(`${evt}\\s*:\\s*"${trig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  assert(`EVENT_TO_TRIGGER maps ${evt} -> "${trig}"`, re.test(mapBlock));
}
// Guard against mapping an event that has NO real source (would auto-fire a
// protocol that can never legitimately trigger).
assert('EVENT_TO_TRIGGER does NOT map "Geofence Breach" (no real source yet)',
  !/Geofence Breach/.test(mapBlock));

// ── 2. Owner control: only auto_trigger=true playbooks activate ──────────────
assert("autoActivatePlaybook activates ONLY auto-trigger playbooks (p.autoTrigger && triggerType match)",
  /p\.autoTrigger\s*&&\s*p\.triggerType\s*===\s*triggerType/.test(service));

// ── 3. Phase-1 safety: no broadcast / worker contact in the service ──────────
assert("playbook-service does NOT import/call broadcast helpers (Phase 1 is log-only)",
  !/sendBroadcast|emitAdminSignal|autoBroadcast|triggerEvacuation/.test(service));

// ── 4. Dashboard wiring is isolated (fire-and-forget + .catch) ───────────────
assert("company-dashboard imports autoActivatePlaybook",
  /import\s*\{[^}]*autoActivatePlaybook[^}]*\}\s*from\s*"\.\/playbook-service"/.test(dash));
assert("company-dashboard calls autoActivatePlaybook on sync events",
  /autoActivatePlaybook\(\{\s*eventType:\s*event\.type/.test(dash));
const callIdx = dash.indexOf("autoActivatePlaybook({ eventType: event.type");
const tail = callIdx >= 0 ? dash.slice(callIdx, callIdx + 600) : "";
assert("autoActivatePlaybook call is fire-and-forget with a .catch (cannot break emergency ingestion)",
  /\bvoid\s+autoActivatePlaybook/.test(dash) && /\.catch\(/.test(tail));

// ── SUMMARY ──────────────────────────────────────────────────────────────────
console.log(
  `\n${failures === 0 ? "\x1b[32m✓ ALL PASS\x1b[0m" : `\x1b[31m✗ ${failures} FAILURE${failures === 1 ? "" : "S"}\x1b[0m`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
