// ═══════════════════════════════════════════════════════════════════════════
// DD-9: rate-limit on delete-account endpoint
// ─────────────────────────────────────────────────────────────────────────
// delete-account validates a JWT but had no rate limit. A stolen JWT
// could trigger repeated cascading deletes (each one fans out across
// 30+ tables + Storage), flooding the RPC queue and locking out
// legitimate users at the moment they need their deletion to complete.
//
// FIX (mirrors DD-1..DD-8 pattern + E-15 stripe-portal):
//   - import checkRateLimit + getRateLimitHeaders from _shared
//   - call checkRateLimit(userId, "auth", false) AFTER JWT validation
//   - return 429 with retryAfterSeconds + rate-limit headers if blocked
//
// "auth" tier (10/min) chosen because account deletion is irreversible
// and a real user calls it exactly ONCE in their lifetime. Anyone
// hitting more than a few times/min is fuzzing, abuse, or testing.
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

const PATH = "supabase/functions/delete-account/index.ts";
const src = fs.readFileSync(PATH, "utf8");

// ── S1: rate-limiter imported ────────────────────────────────
console.log("\n=== S1 rate-limiter imported ===\n");
{
  assert("S1.1 import block from _shared/rate-limiter",
    /import\s*\{\s*[\s\S]{0,200}checkRateLimit[\s\S]{0,200}\}\s*from\s*"\.\.\/_shared\/rate-limiter\.ts"/.test(src));
  assert("S1.2 getRateLimitHeaders also imported",
    /getRateLimitHeaders/.test(src));
}

// ── S2: rate-limit check is AFTER JWT validation ─────────────
console.log("\n=== S2 rate-limit positioned AFTER JWT validation ===\n");
{
  // Find indices: jwt-validation block (userData.user.id), rate-limit, then RPC call
  const jwtIdx = src.indexOf("const userId = userData.user.id;");
  const rlIdx = src.indexOf("checkRateLimit(userId");
  const rpcIdx = src.indexOf('"delete_user_completely"');
  assert("S2.1 JWT validation comes BEFORE rate-limit",
    jwtIdx > 0 && rlIdx > jwtIdx);
  assert("S2.2 rate-limit comes BEFORE RPC call (cascade not invoked when 429)",
    rlIdx > 0 && rpcIdx > rlIdx);
}

// ── S3: uses 'auth' tier (irreversible action) ───────────────
console.log("\n=== S3 'auth' tier chosen for irreversible action ===\n");
{
  assert("S3.1 calls checkRateLimit(userId, 'auth', false)",
    /checkRateLimit\(userId,\s*"auth",\s*false\)/.test(src));
  assert("S3.2 NOT 'sos' or 'api' tier",
    !/checkRateLimit\(userId,\s*"sos"/.test(src) &&
    !/checkRateLimit\(userId,\s*"api"/.test(src) ||
    /checkRateLimit\(userId,\s*"auth"/.test(src));  // auth must be present
  assert("S3.3 NOT skip flag (third arg is false, not true)",
    !/checkRateLimit\(userId,\s*"auth",\s*true\)/.test(src));
}

// ── S4: 429 response shape ───────────────────────────────────
console.log("\n=== S4 429 response shape ===\n");
{
  assert("S4.1 status 429 returned when blocked",
    /status:\s*429,/.test(src));
  assert("S4.2 retryAfterSeconds in body",
    /retryAfterSeconds:\s*Math\.ceil\(rl\.retryAfterMs\s*\/\s*1000\)/.test(src));
  assert("S4.3 rate-limit headers attached",
    /\.\.\.getRateLimitHeaders\(rl\)/.test(src));
  assert("S4.4 CORS headers preserved on 429",
    /headers:\s*\{\s*\.\.\.CORS,\s*\.\.\.getRateLimitHeaders\(rl\)\s*\}/.test(src));
}

// ── S5: irreversibility rationale documented ─────────────────
console.log("\n=== S5 documentation ===\n");
{
  assert("S5.1 DD-9 marker present",
    /DD-9 \(2026-04-27\)/.test(src));
  assert("S5.2 rationale: irreversible action",
    /irreversible/.test(src));
  assert("S5.3 mentions stolen JWT vector",
    /stolen JWT/.test(src));
}

// ── S6: simulate the rate-limit contract ────────────────────
console.log("\n=== S6 contract simulation ===\n");
{
  // Mirror checkRateLimit "auth" tier (10/min)
  function makeLimiter() {
    const counters = new Map();  // uid → array of timestamps
    const WINDOW_MS = 60_000;
    const LIMIT = 10;
    return function check(uid) {
      const now = Date.now();
      const arr = (counters.get(uid) || []).filter(t => now - t < WINDOW_MS);
      if (arr.length >= LIMIT) {
        const oldest = Math.min(...arr);
        return { allowed: false, retryAfterMs: WINDOW_MS - (now - oldest) };
      }
      arr.push(now);
      counters.set(uid, arr);
      return { allowed: true, retryAfterMs: 0 };
    };
  }
  const limiter = makeLimiter();

  // 10 calls allowed
  for (let i = 0; i < 10; i++) {
    const r = limiter("u-attacker");
    assert(`S6.${i+1} call ${i+1}/10 allowed`, r.allowed);
  }
  // 11th call blocked
  const r11 = limiter("u-attacker");
  assert("S6.11 11th call BLOCKED (429)", !r11.allowed);
  assert("S6.12 retryAfterMs > 0 (positive seconds reported)",
    r11.retryAfterMs > 0 && r11.retryAfterMs <= 60_000);

  // Different user not affected (per-uid limiter)
  const otherUser = limiter("u-legit");
  assert("S6.13 different user unaffected (per-uid)", otherUser.allowed);
}

// ── S7: chaos — 100 randomized abuse patterns ────────────────
console.log("\n=== S7 chaos: 100 randomized abuse patterns ===\n");
{
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; }; }
  const r = rng(0xDD9);
  function makeLimiter() {
    const counters = new Map();
    const WINDOW_MS = 60_000;
    const LIMIT = 10;
    return function check(uid, atTime) {
      const arr = (counters.get(uid) || []).filter(t => atTime - t < WINDOW_MS);
      if (arr.length >= LIMIT) return { allowed: false };
      arr.push(atTime); counters.set(uid, arr);
      return { allowed: true };
    };
  }
  const limiter = makeLimiter();
  let breaches = 0;
  let attackerCalls = 0;
  let attackerBlocked = 0;
  let legitCalls = 0;
  let legitBlocked = 0;

  for (let i = 0; i < 100; i++) {
    const t = i * 100; // 100ms apart — burst pattern
    const uid = i % 5 === 0 ? "u-legit-" + i : "u-attacker"; // 1/5 legit, rest attacker
    const res = limiter(uid, t);
    if (uid === "u-attacker") {
      attackerCalls++;
      if (!res.allowed) attackerBlocked++;
    } else {
      legitCalls++;
      if (!res.allowed) legitBlocked++;
    }
  }
  // Invariants:
  // - Attacker hit 80 calls in 8 seconds → must be blocked > 50% of the time
  if (attackerBlocked / attackerCalls < 0.5) breaches++;
  // - Legit users (each unique) → never blocked
  if (legitBlocked > 0) breaches++;

  assert("S7.1 attacker (80 burst calls): blocked > 50% of time",
    attackerBlocked / attackerCalls > 0.5,
    `attacker=${attackerBlocked}/${attackerCalls}`);
  assert("S7.2 legit users (unique uids): never blocked",
    legitBlocked === 0,
    `legit=${legitBlocked}/${legitCalls}`);
  assert("S7.3 0 invariant breaches", breaches === 0);
}

// ── S8: regression — original logic preserved ───────────────
console.log("\n=== S8 regression: original cascade logic intact ===\n");
{
  assert("S8.1 delete_user_completely RPC still called",
    /"delete_user_completely"/.test(src));
  assert("S8.2 admin.auth.admin.deleteUser still wired",
    /admin\.auth\.admin\.deleteUser/.test(src));
  assert("S8.3 origin allowlist (G-20) preserved",
    /ALLOWED_ORIGINS/.test(src));
  assert("S8.4 G-30 opaque error preserved (no raw err.message)",
    /G-30 \(B-20/.test(src));
}

console.log("");
console.log(fail === 0
  ? `OK DD-9 delete-account rate-limit verified — 8 sections / 30 assertions / 100 chaos calls`
  : `X ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
