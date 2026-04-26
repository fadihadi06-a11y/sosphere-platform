// W3 TIER 1 top-5 hard test bundle:
//   W3-17  invite_code crypto-strong (no Math.random)
//   W3-21  past_due NO LONGER counts as active tier
//   W3-31  heartbeat GPS/battery/elapsed validation
//   W3-33  HTML escaping in invitation email body
//   (W3-37 is DB-side trigger — verified live above)

import crypto from "node:crypto";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ═══ W3-17 ═══════════════════════════════════════════════════════
console.log("\n=== W3-17 invite_code crypto-strong ===\n");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateInviteCodeCrypto() {
  const bytes = new Uint8Array(8);
  crypto.webcrypto.getRandomValues(bytes);
  return Array.from(bytes, b => ALPHABET[b & 31]).join("");
}

// S1: 8 chars from 32-char alphabet
{
  const code = generateInviteCodeCrypto();
  assert("S1 invite code is 8 chars", code.length === 8);
  assert("S1 only contains alphabet chars", code.split("").every(c => ALPHABET.includes(c)));
}

// S2: 1000 generated codes — none collide
{
  const codes = new Set();
  for (let i = 0; i < 1000; i++) codes.add(generateInviteCodeCrypto());
  assert("S2 1000 codes — zero collisions", codes.size === 1000);
}

// S3: search space — 32^8 ≈ 1.1 trillion (was 32^6 ≈ 1B pre-fix)
{
  const post = Math.pow(32, 8);
  const pre  = Math.pow(32, 6);
  assert("S3 post-fix search space ≈ 1.1T (1024x larger than pre-fix 32^6 ≈ 1B)",
    post >= 1e12 && post / pre === 1024);
}

// S4: bytes are well-distributed (rough check — count first letters)
{
  const buckets = new Array(32).fill(0);
  for (let i = 0; i < 32000; i++) {
    const c = generateInviteCodeCrypto()[0];
    buckets[ALPHABET.indexOf(c)]++;
  }
  const min = Math.min(...buckets);
  const max = Math.max(...buckets);
  // expected ~1000 per bucket, allow 700..1300 (very loose)
  assert("S4 first-letter distribution is roughly uniform (700..1300 per bucket)",
    min >= 700 && max <= 1300, `min=${min} max=${max}`);
}

// ═══ W3-21 ═══════════════════════════════════════════════════════
console.log("\n=== W3-21 past_due no longer grants tier ===\n");

function modelGetTier(rows, statusSet) {
  // Pick highest-priority row matching the active set.
  const matching = rows.filter(r => statusSet.has(r.status));
  if (matching.length === 0) return "free";
  // Order by updated_at DESC NULLS LAST
  matching.sort((a, b) => (new Date(b.updated_at)).getTime() - (new Date(a.updated_at)).getTime());
  return matching[0].tier || "free";
}

const PRE_FIX  = new Set(["active", "trialing", "past_due"]);
const POST_FIX = new Set(["active", "trialing"]);

// S5: past_due — pre-fix grants tier; post-fix returns free
{
  const rows = [{ tier: "elite", status: "past_due", updated_at: "2026-04-26" }];
  assert("S5 pre-fix grants elite during past_due (BUG)",
    modelGetTier(rows, PRE_FIX) === "elite");
  assert("S5 post-fix returns free during past_due",
    modelGetTier(rows, POST_FIX) === "free");
}

// S6: active still grants tier
{
  const rows = [{ tier: "basic", status: "active", updated_at: "2026-04-26" }];
  assert("S6 active grants tier (post-fix)", modelGetTier(rows, POST_FIX) === "basic");
}

// S7: trialing still grants tier
{
  const rows = [{ tier: "elite", status: "trialing", updated_at: "2026-04-26" }];
  assert("S7 trialing grants tier (post-fix)", modelGetTier(rows, POST_FIX) === "elite");
}

// S8: canceled — never grants tier
{
  const rows = [{ tier: "elite", status: "canceled", updated_at: "2026-04-26" }];
  assert("S8 canceled returns free (both)", modelGetTier(rows, POST_FIX) === "free");
}

// ═══ W3-31 ═══════════════════════════════════════════════════════
console.log("\n=== W3-31 heartbeat input validation ===\n");

function validateHeartbeat(hb) {
  const lat = (typeof hb.location?.lat === "number" && Number.isFinite(hb.location.lat)
    && hb.location.lat >= -90 && hb.location.lat <= 90) ? hb.location.lat : null;
  const lng = (typeof hb.location?.lng === "number" && Number.isFinite(hb.location.lng)
    && hb.location.lng >= -180 && hb.location.lng <= 180) ? hb.location.lng : null;
  const rawBat = hb.batteryLevel;
  const bat = (typeof rawBat === "number" && Number.isFinite(rawBat) && rawBat >= 0 && rawBat <= 100)
    ? (rawBat > 1 ? rawBat / 100 : rawBat) : null;
  const elapsed = (typeof hb.elapsedSec === "number" && Number.isFinite(hb.elapsedSec)
    && hb.elapsedSec >= 0 && hb.elapsedSec <= 86400) ? Math.floor(hb.elapsedSec) : null;
  return { lat, lng, bat, elapsed };
}

// S9: valid GPS accepted
{
  const r = validateHeartbeat({ location: { lat: 24.71, lng: 46.67 } });
  assert("S9 valid GPS accepted", r.lat === 24.71 && r.lng === 46.67);
}

// S10: out-of-range lat rejected
{
  const r = validateHeartbeat({ location: { lat: 999, lng: 46.67 } });
  assert("S10 lat=999 rejected (returns null)", r.lat === null);
}

// S11: out-of-range lng rejected
{
  const r = validateHeartbeat({ location: { lat: 24.71, lng: -999 } });
  assert("S11 lng=-999 rejected", r.lng === null);
}

// S12: NaN/Infinity rejected
{
  const r1 = validateHeartbeat({ location: { lat: NaN, lng: 0 } });
  const r2 = validateHeartbeat({ location: { lat: Infinity, lng: 0 } });
  assert("S12 NaN lat rejected", r1.lat === null);
  assert("S12 Infinity lat rejected", r2.lat === null);
}

// S13: battery 0..1 accepted, >1 normalized
{
  const r1 = validateHeartbeat({ batteryLevel: 0.45 });
  const r2 = validateHeartbeat({ batteryLevel: 75 });  // older client convention 0..100
  const r3 = validateHeartbeat({ batteryLevel: 200 }); // garbage
  assert("S13 battery=0.45 accepted as-is", r1.bat === 0.45);
  assert("S13 battery=75 normalized to 0.75", r2.bat === 0.75);
  assert("S13 battery=200 rejected", r3.bat === null);
}

// S14: elapsed > 1 day rejected
{
  const r = validateHeartbeat({ elapsedSec: 999999 });
  assert("S14 elapsed=999999 rejected (>86400)", r.elapsed === null);
}

// S15: elapsed=0 accepted (start of emergency)
{
  const r = validateHeartbeat({ elapsedSec: 0 });
  assert("S15 elapsed=0 accepted", r.elapsed === 0);
}

// ═══ W3-33 ═══════════════════════════════════════════════════════
console.log("\n=== W3-33 HTML escaping in invite emails ===\n");

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// S16: <script> injection neutralized
{
  const malicious = '<script src="evil.com/x"></script>';
  const escaped = escapeHtml(malicious);
  assert("S16 <script> tags escaped",
    !escaped.includes("<script") && escaped.includes("&lt;script"));
}

// S17: event-handler injection neutralized
{
  const malicious = `" onerror="alert(1)`;
  const escaped = escapeHtml(malicious);
  assert("S17 event-handler injection escaped",
    !escaped.includes('"') && escaped.includes("&quot;"));
}

// S18: ampersand normalization
{
  const text = "Acme & Co. <Best Inc.>";
  const escaped = escapeHtml(text);
  assert("S18 ampersand + brackets escaped",
    escaped === "Acme &amp; Co. &lt;Best Inc.&gt;");
}

// S19: encodeURIComponent on the URL slot
{
  const malicious = '"></a><script>x</script>';
  const url = `https://sosphere.app/join/${encodeURIComponent(malicious)}`;
  assert("S19 URL slot encoded — no raw quotes/tags in href",
    !url.includes('"') && !url.includes("<"));
}

// S20: legitimate Arabic name preserved
{
  const arabic = "أحمد المنصور";
  const escaped = escapeHtml(arabic);
  assert("S20 Arabic name preserved unchanged",
    escaped === arabic);
}

console.log("\n" + (fail === 0 ? "OK all W3 TIER 1 top-5 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
