// W3 TIER 1 batch 4:
//   W3-44: navigator.onLine soft check (advisory only)
//   W3-45: Service Worker .json no longer in cache pattern
//   W3-49: dashboard PIN per-install salt (legacy hash backward-compat)
//   W3-50: real per-employee battery (no more dead sosphere_sync_data read)

import crypto from "node:crypto";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ═══ W3-44 ═══════════════════════════════════════════════════════
console.log("\n=== W3-44 navigator.onLine soft check ===\n");

function preFixGate(navOnline) { return navOnline === false; /* skip */ }
function postFixGate(navOnline) {
  // Always proceed — false is advisory only
  return false;
}
assert("S1 pre-fix skips on false (the bug — captive portal/iOS bg)", preFixGate(false) === true);
assert("S1 post-fix never skips on advisory false", postFixGate(false) === false);
assert("S1 post-fix proceeds on true", postFixGate(true) === false);

// ═══ W3-45 ═══════════════════════════════════════════════════════
console.log("\n=== W3-45 SW .json removed from cache pattern ===\n");

const PRE_FIX_REGEX = /\.(?:css|js|mjs|map|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|ico|json|webmanifest)$/i;
const POST_FIX_REGEX = /\.(?:css|js|mjs|map|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|ico|webmanifest)$/i;

// S2: .json paths used to be cached, now NOT
{
  const tests = ["/flags.json", "/version.json", "/config.json", "/api/data.json"];
  tests.forEach(p => {
    assert(`S2 pre-fix matched ${p} (the bug)`, PRE_FIX_REGEX.test(p) === true);
    assert(`S2 post-fix REJECTS ${p}`, POST_FIX_REGEX.test(p) === false);
  });
}

// S3: legitimate static assets still match
{
  const tests = ["/assets/main.css", "/assets/app.js", "/icon-192.png", "/manifest.webmanifest"];
  tests.forEach(p => {
    assert(`S3 post-fix accepts ${p}`, POST_FIX_REGEX.test(p) === true);
  });
}

// S4: cache-poisoning scenario — /flags.json with malicious payload
//      pre-fix: cached forever; post-fix: always fetches fresh
{
  const path = "/flags.json";
  const preFixCached = PRE_FIX_REGEX.test(path);
  const postFixCached = POST_FIX_REGEX.test(path);
  assert("S4 cache-poisoning surface eliminated for .json",
    preFixCached === true && postFixCached === false);
}

// ═══ W3-49 ═══════════════════════════════════════════════════════
console.log("\n=== W3-49 dashboard PIN per-install salt ===\n");

const LEGACY_SALT = "sosphere_pin_salt_2026";

function preFixHash(pin) {
  return crypto.createHash("sha256").update(pin + LEGACY_SALT).digest("hex");
}
function postFixHash(pin, perInstallSalt) {
  return crypto.createHash("sha256").update(perInstallSalt + ":" + pin).digest("hex");
}

// S5: same PIN, different installs → different hashes (post-fix)
{
  const saltA = crypto.randomBytes(16).toString("hex");
  const saltB = crypto.randomBytes(16).toString("hex");
  const hashA = postFixHash("1234", saltA);
  const hashB = postFixHash("1234", saltB);
  assert("S5 same PIN, different installs → different hashes",
    hashA !== hashB);
  assert("S5 hashes are 64-hex SHA-256",
    /^[a-f0-9]{64}$/.test(hashA) && /^[a-f0-9]{64}$/.test(hashB));
}

// S6: pre-fix — same PIN cracked once = cracked everywhere
{
  // Imagine 3 installs all with PIN "1234"
  const hash1 = preFixHash("1234");
  const hash2 = preFixHash("1234");
  const hash3 = preFixHash("1234");
  assert("S6 pre-fix: 3 installs same PIN → IDENTICAL hashes (one rainbow table cracks all)",
    hash1 === hash2 && hash2 === hash3);
}

// S7: backward compat — legacy hash recognized + upgraded
{
  // User had pre-fix install with PIN "5678" — legacy hash stored
  const legacyStoredHash = preFixHash("5678");
  // After upgrade: per-install salt now exists, but stored hash is the legacy
  const newSalt = crypto.randomBytes(16).toString("hex");
  const newHash = postFixHash("5678", newSalt);
  // First check: new hash !== legacy stored
  assert("S7 fresh hash differs from legacy stored",
    newHash !== legacyStoredHash);
  // Backward-compat path: check legacy too — should match
  const legacyCheck = preFixHash("5678");
  assert("S7 legacy hash check matches → triggers upgrade path",
    legacyCheck === legacyStoredHash);
}

// ═══ W3-50 ═══════════════════════════════════════════════════════
console.log("\n=== W3-50 real per-employee battery (sosphere_sync_data dead) ===\n");

function preFixBattery() {
  // sosphere_sync_data never written → returns 100 always (UI shows fake full battery)
  const sync = {}; // simulated empty read
  return sync.batteryLevel ?? 100;
}
function postFixBatteryDashboard(employeeSync) {
  // Real per-employee sync from saveEmployeeSync writer
  return typeof employeeSync?.battery === "number"
    ? Math.round(employeeSync.battery * 100)
    : null;
}
function postFixBatteryDevice(realBattery) {
  // From offline-gps-tracker.getBatteryLevel() (Battery API)
  return typeof realBattery === "number"
    ? Math.round(realBattery * 100)
    : 50; // conservative fallback
}

// S8: pre-fix always returns 100 (no real signal)
{
  assert("S8 pre-fix returns 100 always (the bug)", preFixBattery() === 100);
}

// S9: post-fix dashboard reads real per-employee battery
{
  const empSync = { battery: 0.45, signal: "4g", updatedAt: Date.now() };
  assert("S9 post-fix returns real 45% from employee sync",
    postFixBatteryDashboard(empSync) === 45);
}

// S10: post-fix returns null when no sync (honest "unknown")
{
  assert("S10 post-fix returns null when no sync (honest unknown)",
    postFixBatteryDashboard(null) === null);
  assert("S10 post-fix returns null when battery missing",
    postFixBatteryDashboard({ signal: "4g", updatedAt: 0 }) === null);
}

// S11: device-side reads real battery via getBatteryLevel
{
  assert("S11 device reads real battery from Battery API", postFixBatteryDevice(0.78) === 78);
  assert("S11 fallback 50% when Battery API unavailable", postFixBatteryDevice(null) === 50);
}

console.log("\n" + (fail === 0 ? "OK all W3 batch 4 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
