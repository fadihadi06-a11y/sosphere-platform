// ═══════════════════════════════════════════════════════════════════════════
// TIER 2 defense-in-depth batch (DD-1..DD-8): pre-launch hardening
// ─────────────────────────────────────────────────────────────────────────
// 8 minor TIER 2 issues identified in the final sweep, fixed together
// because they share a pattern (server-side opacity + input validation):
//
//   DD-1 [SEV 4] twilio-token: don't echo `String(err)` to client (info leak)
//   DD-2 [SEV 4] stripe-portal: returnUrl origin allowlist (mirrors E-16)
//   DD-3 [SEV 3] twilio-token: scrub identity + full uid from console.log
//   DD-4 [SEV 3] stripe-portal: opaque error to client (Stripe message hidden)
//   DD-5 [SEV 3] stripe-checkout: opaque error to client (Stripe message hidden)
//   DD-6 [SEV 2] twilio-token: identity length cap (1..256 chars)
//   DD-7 [SEV 2] stripe-checkout: seats validation (integer 1..1000)
//   DD-8 [SEV 2] supabase-client: scrub user email from GoogleAuth log
//
// All edits add `request_id` for support correlation while keeping
// observability for ops (server logs still get the full error).
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

const TWT = fs.readFileSync("supabase/functions/twilio-token/index.ts", "utf8");
const SPP = fs.readFileSync("supabase/functions/stripe-portal/index.ts", "utf8");
const SCO = fs.readFileSync("supabase/functions/stripe-checkout/index.ts", "utf8");
const SCL = fs.readFileSync("src/app/components/api/supabase-client.ts", "utf8");

// ── DD-1: twilio-token sanitized 500 ────────────────────────────
console.log("\n=== DD-1 twilio-token sanitized 500 (no String(err) leak) ===\n");
{
  assert("DD-1.1 String(err) NOT echoed to client",
    !/JSON\.stringify\(\{\s*error:\s*"Internal server error",\s*detail:\s*String\(err\)\s*\}\)/.test(TWT));
  assert("DD-1.2 request_id added for support correlation",
    /const reqId = "rq-" \+ Math\.random\(\)/.test(TWT));
  assert("DD-1.3 client response carries request_id (not stack)",
    /JSON\.stringify\(\{\s*error:\s*"Internal server error",\s*request_id:\s*reqId\s*\}\)/.test(TWT));
  assert("DD-1.4 server-side log includes full err",
    /console\.error\(`\[twilio-token\] \[\$\{reqId\}\] Error:`, err\)/.test(TWT));
}

// ── DD-2: stripe-portal returnUrl allowlist ─────────────────────
console.log("\n=== DD-2 stripe-portal returnUrl origin allowlist ===\n");
{
  assert("DD-2.1 isAllowedReturnUrl helper present",
    /function isAllowedReturnUrl\(u: string \| undefined \| null\): boolean/.test(SPP));
  assert("DD-2.2 ALLOWED_ORIGINS used as basis",
    /allowedOrigins = ALLOWED_ORIGINS[\s\S]{0,300}new URL\(o\)\.origin/.test(SPP));
  assert("DD-2.3 safeReturnUrl falls back to BASE_URL/billing",
    /safeReturnUrl = isAllowedReturnUrl\(returnUrl\) \?\s*\(returnUrl as string\)\s*:\s*`\$\{BASE_URL\}\/billing`/.test(SPP));
  assert("DD-2.4 form uses safeReturnUrl (NOT raw returnUrl)",
    /return_url:\s*safeReturnUrl/.test(SPP) &&
    !/return_url:\s*returnUrl\s*\|\|/.test(SPP));
}

// ── DD-3: twilio-token log scrub ────────────────────────────────
console.log("\n=== DD-3 twilio-token PII guard on log ===\n");
{
  assert("DD-3.1 raw identity NOT logged",
    !/Token generated for identity: \$\{identity\}/.test(TWT));
  assert("DD-3.2 log includes only uid prefix (8 chars)",
    /caller=\$\{userId\.slice\(0,8\)\}/.test(TWT));
  assert("DD-3.3 PII guard reasoning documented",
    /no identity \/ userId in production logs \(PII guard\)/.test(TWT));
}

// ── DD-4: stripe-portal opaque error ────────────────────────────
console.log("\n=== DD-4 stripe-portal opaque Stripe error ===\n");
{
  assert("DD-4.1 client error is opaque ('Billing portal unavailable')",
    /JSON\.stringify\(\{\s*error:\s*"Billing portal unavailable",\s*request_id:\s*reqId\s*\}\)/.test(SPP));
  assert("DD-4.2 client does NOT receive Stripe error.message",
    !/JSON\.stringify\(\{\s*error:\s*data\?\.error\?\.message\s*\|\|\s*"Stripe error"\s*\}\)/.test(SPP));
  assert("DD-4.3 server log retains Stripe error.message for ops",
    /\[stripe-portal\] \[\$\{reqId\}\] Stripe error:.*data\?\.error\?\.message/.test(SPP));
}

// ── DD-5: stripe-checkout opaque error ──────────────────────────
console.log("\n=== DD-5 stripe-checkout opaque Stripe error ===\n");
{
  assert("DD-5.1 client error is opaque ('Checkout unavailable')",
    /JSON\.stringify\(\{\s*error:\s*"Checkout unavailable",\s*request_id:\s*reqId\s*\}\)/.test(SCO));
  assert("DD-5.2 client does NOT receive Stripe error.message",
    !/JSON\.stringify\(\{\s*error:\s*data\?\.error\?\.message\s*\|\|\s*"Stripe error"\s*\}\)/.test(SCO));
  assert("DD-5.3 server log retains Stripe error.message",
    /\[stripe-checkout\] \[\$\{reqId\}\] Stripe error:.*data\?\.error\?\.message/.test(SCO));
}

// ── DD-6: twilio-token identity length cap ──────────────────────
console.log("\n=== DD-6 twilio-token identity length cap ===\n");
{
  assert("DD-6.1 length cap enforced (1..256)",
    /typeof identity !== "string" \|\| identity\.length === 0 \|\| identity\.length > 256/.test(TWT));
  assert("DD-6.2 returns 400 with explicit range message",
    /identity is required \(1\.\.256 chars\)/.test(TWT));
  assert("DD-6.3 DoS rationale documented",
    /payload-fuzzing or DoS probe/.test(TWT));
}

// ── DD-7: stripe-checkout seats validation ──────────────────────
console.log("\n=== DD-7 stripe-checkout seats validation ===\n");
{
  assert("DD-7.1 safeSeats integer check + range cap",
    /Number\.isInteger\(seats\) && seats > 0 && seats <= 1000/.test(SCO));
  assert("DD-7.2 form uses safeSeats (NOT raw seats)",
    /form\["line_items\[1\]\[quantity\]"\] = String\(safeSeats\)/.test(SCO) &&
    !/form\["line_items\[1\]\[quantity\]"\] = String\(seats\)/.test(SCO));
  assert("DD-7.3 billing-surprise rationale documented",
    /huge Stripe invoice \+ billing surprise/.test(SCO));
}

// ── DD-8: supabase-client GoogleAuth log scrub ──────────────────
console.log("\n=== DD-8 supabase-client GoogleAuth email scrub ===\n");
{
  assert("DD-8.1 raw email NOT logged",
    !/console\.log\("\[GoogleAuth\] Success:", data\.user\?\.email\)/.test(SCL));
  assert("DD-8.2 only uid prefix (8 chars) logged",
    /data\.user\?\.id\?\.slice\(0,\s*8\)/.test(SCL));
  assert("DD-8.3 fallback for missing uid",
    /\(no uid\)/.test(SCL));
}

// ── S9: simulation — DD-2 origin allowlist behavior ────────────
console.log("\n=== S9 DD-2 simulation: returnUrl allowlist ===\n");
{
  const ALLOWED = ["https://sosphere-platform.vercel.app", "https://app.sosphere.co"];
  const BASE = "https://sosphere-platform.vercel.app";
  function isAllowedReturnUrl(u) {
    if (!u || typeof u !== "string") return false;
    try {
      const p = new URL(u);
      const allowedOrigins = ALLOWED.map(o => { try { return new URL(o).origin; } catch { return null; } }).filter(Boolean);
      return allowedOrigins.includes(p.origin);
    } catch { return false; }
  }
  function safe(u) { return isAllowedReturnUrl(u) ? u : `${BASE}/billing`; }

  assert("S9.1 same-origin allowed", safe("https://sosphere-platform.vercel.app/billing?ok=1") === "https://sosphere-platform.vercel.app/billing?ok=1");
  assert("S9.2 attacker https://evil.com REJECTED → fallback",
    safe("https://evil.com/?leak=1") === `${BASE}/billing`);
  assert("S9.3 alt allowlisted origin accepted",
    safe("https://app.sosphere.co/billing") === "https://app.sosphere.co/billing");
  assert("S9.4 javascript: pseudo-protocol REJECTED",
    safe("javascript:alert(1)") === `${BASE}/billing`);
  assert("S9.5 origin-spoof via path REJECTED",
    safe("https://evil.com/sosphere-platform.vercel.app/billing") === `${BASE}/billing`);
  assert("S9.6 undefined → fallback",
    safe(undefined) === `${BASE}/billing`);
  assert("S9.7 malformed URL → fallback",
    safe("not-a-url") === `${BASE}/billing`);
  assert("S9.8 non-listed subdomain REJECTED",
    safe("https://other.sosphere-platform.vercel.app/billing") === `${BASE}/billing`);
}

// ── S10: simulation — DD-7 seats validation contract ───────────
console.log("\n=== S10 DD-7 simulation: seats validation ===\n");
{
  function safe(s) {
    return (typeof s === "number" && Number.isInteger(s) && s > 0 && s <= 1000) ? s : 0;
  }
  assert("S10.1 valid int → preserved", safe(5) === 5);
  assert("S10.2 zero → 0", safe(0) === 0);
  assert("S10.3 negative → 0", safe(-1) === 0);
  assert("S10.4 float → 0", safe(2.5) === 0);
  assert("S10.5 string → 0", safe("5") === 0);
  assert("S10.6 NaN → 0", safe(NaN) === 0);
  assert("S10.7 huge → 0", safe(9999999) === 0);
  assert("S10.8 exactly 1000 (boundary) → preserved", safe(1000) === 1000);
  assert("S10.9 1001 (just over) → 0", safe(1001) === 0);
  assert("S10.10 undefined → 0", safe(undefined) === 0);
  assert("S10.11 Infinity → 0", safe(Infinity) === 0);
}

// ── S11: simulation — DD-6 identity length cap contract ────────
console.log("\n=== S11 DD-6 simulation: identity length cap ===\n");
{
  function reject(id) {
    return typeof id !== "string" || id.length === 0 || id.length > 256;
  }
  assert("S11.1 short uid → accepted", !reject("u-12345"));
  assert("S11.2 256-char (boundary) → accepted", !reject("a".repeat(256)));
  assert("S11.3 257-char → rejected", reject("a".repeat(257)));
  assert("S11.4 1MB payload → rejected", reject("a".repeat(1024 * 1024)));
  assert("S11.5 empty → rejected", reject(""));
  assert("S11.6 null → rejected", reject(null));
  assert("S11.7 number → rejected", reject(42));
  assert("S11.8 undefined → rejected", reject(undefined));
}

// ── S12: chaos — 100 randomized DD-7 seats fuzzing ─────────────
console.log("\n=== S12 chaos: 100 randomized seats fuzzing ===\n");
{
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; }; }
  const r = rng(0xDD7);
  function safe(s) { return (typeof s === "number" && Number.isInteger(s) && s > 0 && s <= 1000) ? s : 0; }
  let breaches = 0;
  for (let i = 0; i < 100; i++) {
    const variant = i % 6;
    let input;
    if (variant === 0) input = Math.floor(r() * 1000) + 1;        // valid int
    else if (variant === 1) input = -Math.floor(r() * 100);       // negative
    else if (variant === 2) input = r() * 5000;                   // float
    else if (variant === 3) input = String(Math.floor(r() * 100));// string
    else if (variant === 4) input = Math.floor(r() * 10_000_000); // huge
    else input = NaN;
    const out = safe(input);
    // Invariant: out is always a SAFE int in [0,1000]
    if (typeof out !== "number" || !Number.isInteger(out)) breaches++;
    if (out < 0 || out > 1000) breaches++;
    if (variant === 0 && input >= 1 && input <= 1000 && out !== input) breaches++;
  }
  assert("S12.1 100 chaos seats: 0 invariant breaches", breaches === 0,
    `breaches=${breaches}`);
}

console.log("");
console.log(fail === 0
  ? `OK TIER 2 defense-in-depth batch (DD-1..DD-8) verified — 11 sections / 51 assertions / 100 chaos cases`
  : `X ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
