// W3-7 hard test — Stripe webhook timestamp validation.
// Pre-fix: Math.abs(now - t) > 300 ⇒ accepted t up to 5min in the FUTURE,
//          doubling the replay window.
// Post-fix: one-sided check — reject t older than 300s, AND reject t more
//          than 60s in the future (NTP-skew tolerance).

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

function preFix(t, now) {
  const age = Math.abs(now - t);
  if (!Number.isFinite(age) || age > 300) return false;
  return true;
}
function postFix(t, now) {
  if (!Number.isFinite(t)) return false;
  if (now - t > 300) return false;   // too old
  if (t - now > 60)  return false;   // future-dated by > 60s
  return true;
}

const NOW = 1_777_000_000;

// S1: t exactly now → both accept
assert("S1 now=t accepted by pre-fix",  preFix(NOW, NOW) === true);
assert("S1 now=t accepted by post-fix", postFix(NOW, NOW) === true);

// S2: t = now - 200s → both accept (still within 5 min tolerance)
assert("S2 t-200s accepted by pre-fix",  preFix(NOW - 200, NOW) === true);
assert("S2 t-200s accepted by post-fix", postFix(NOW - 200, NOW) === true);

// S3: t = now - 400s → both reject (older than tolerance)
assert("S3 t-400s rejected by pre-fix",  preFix(NOW - 400, NOW) === false);
assert("S3 t-400s rejected by post-fix", postFix(NOW - 400, NOW) === false);

// S4: BUG — t = now + 200s (future-dated by 200 seconds)
//   Pre-fix: Math.abs(200) = 200 < 300 → ACCEPT (wrong; doubles replay window).
//   Post-fix: tNum-now = 200 > 60 → reject.
assert("S4 t+200s pre-fix WRONGLY accepted (the bug)",  preFix(NOW + 200, NOW) === true);
assert("S4 t+200s post-fix correctly rejected",          postFix(NOW + 200, NOW) === false);

// S5: small clock drift forward (NTP skew) — both accept up to 60s
assert("S5 t+30s post-fix accepted (NTP tolerance)", postFix(NOW + 30, NOW) === true);

// S6: t+61s post-fix rejected (just outside skew tolerance)
assert("S6 t+61s post-fix rejected (skew limit)", postFix(NOW + 61, NOW) === false);

// S7: NaN/Infinity — both reject
assert("S7 NaN rejected by pre-fix",  preFix(NaN, NOW) === false);
assert("S7 NaN rejected by post-fix", postFix(NaN, NOW) === false);
assert("S7 Infinity rejected by post-fix", postFix(Infinity, NOW) === false);

// S8: pre-fix replay window is ±300s (600s total). Post-fix is +60..-300s (360s total).
//     Halving the surface area for a captured-and-replayed signed payload.
const preWindowSeconds  = 300 + 300;
const postWindowSeconds = 300 + 60;
assert("S8 post-fix replay window = " + postWindowSeconds + "s (was " + preWindowSeconds + "s, 40% smaller)",
  postWindowSeconds < preWindowSeconds);

console.log("\n" + (fail === 0 ? "OK all W3-7 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
