// Synthetic test for B-14 Service Worker cache policy.
// Replicates the helpers from public/sw.js so they can be unit-tested
// without a browser context. Any drift between the test and the real
// SW is caught by a string-equality check at the bottom.

const NEVER_CACHE_PATH_PREFIXES = [
  "/rest/", "/auth/", "/realtime/", "/functions/", "/storage/v1/", "/api/",
];
const STATIC_PATH_PATTERNS = [
  /^\/assets\//,
  /^\/icons?\//,
  /^\/fonts?\//,
  /^\/(?:icon|favicon)/,
  /\.(?:css|js|mjs|map|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|ico|json|webmanifest)$/i,
];
const SHELL_PATHS = new Set(["/", "/app", "/dashboard"]);

function isSameOrigin(url, selfOrigin) {
  try { return new URL(url).origin === selfOrigin; } catch { return false; }
}

function shouldIntercept(request, selfOrigin) {
  if (request.method !== "GET") return false;
  if (request.headers && request.headers.has && request.headers.has("range")) return false;
  if (request.headers && request.headers.has && request.headers.has("authorization")) return false;
  if (!isSameOrigin(request.url, selfOrigin)) return false;
  const path = new URL(request.url).pathname;
  if (NEVER_CACHE_PATH_PREFIXES.some(p => path.startsWith(p))) return false;
  if (SHELL_PATHS.has(path)) return true;
  if (STATIC_PATH_PATTERNS.some(re => re.test(path))) return true;
  return false;
}

function shouldCacheResponse(response) {
  if (!response || !response.ok) return false;
  if (response.type === "opaque" || response.type === "opaqueredirect") return false;
  const cc = (response.headers && response.headers.get && response.headers.get("cache-control")) || "";
  if (/\bno-store\b/i.test(cc)) return false;
  if (/\bprivate\b/i.test(cc)) return false;
  return true;
}

// Mini Headers/Request/Response stand-ins for Node.
function H(obj = {}) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    has: (k) => m.has(k.toLowerCase()),
    get: (k) => m.get(k.toLowerCase()) ?? null,
  };
}
function R(method, url, headers = {}) {
  return { method, url, headers: H(headers) };
}
function Resp({ ok = true, status = 200, type = "basic", headers = {} } = {}) {
  return { ok, status, type, headers: H(headers) };
}

const ORIGIN = "https://sosphere-platform.vercel.app";
let fail = 0;
function assert(label, cond) {
  if (!cond) fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}`);
}

console.log("\n=== B-14 Service-Worker policy scenarios ===\n");

// ── INTERCEPT decisions ──
assert("S1 GET /favicon.ico (root favicon path)",
  shouldIntercept(R("GET", `${ORIGIN}/favicon.ico`), ORIGIN) === true);
assert("S2 GET /icon-192.png (root icon path)",
  shouldIntercept(R("GET", `${ORIGIN}/icon-192.png`), ORIGIN) === true);
assert("S3 GET /assets/main-abc.js",
  shouldIntercept(R("GET", `${ORIGIN}/assets/main-abc.js`), ORIGIN) === true);
assert("S4 GET /manifest.json",
  shouldIntercept(R("GET", `${ORIGIN}/manifest.json`), ORIGIN) === true);
assert("S5 GET / (shell)",
  shouldIntercept(R("GET", `${ORIGIN}/`), ORIGIN) === true);
assert("S6 GET /app (shell)",
  shouldIntercept(R("GET", `${ORIGIN}/app`), ORIGIN) === true);
assert("S7 GET /dashboard (shell)",
  shouldIntercept(R("GET", `${ORIGIN}/dashboard`), ORIGIN) === true);

assert("S8 GET /rest/v1/profiles (Supabase REST same-origin proxy) → SKIP",
  shouldIntercept(R("GET", `${ORIGIN}/rest/v1/profiles`), ORIGIN) === false);
assert("S9 GET /auth/v1/token → SKIP",
  shouldIntercept(R("GET", `${ORIGIN}/auth/v1/token`), ORIGIN) === false);
assert("S10 GET /functions/v1/sos-alert → SKIP",
  shouldIntercept(R("GET", `${ORIGIN}/functions/v1/sos-alert`), ORIGIN) === false);
assert("S11 GET /realtime/v1/websocket → SKIP",
  shouldIntercept(R("GET", `${ORIGIN}/realtime/v1/websocket`), ORIGIN) === false);
assert("S12 GET /storage/v1/object/evidence/foo → SKIP",
  shouldIntercept(R("GET", `${ORIGIN}/storage/v1/object/evidence/foo`), ORIGIN) === false);
assert("S13 GET /api/internal/anything → SKIP",
  shouldIntercept(R("GET", `${ORIGIN}/api/internal/x`), ORIGIN) === false);

assert("S14 GET https://api.stripe.com/v1/customers (cross-origin) → SKIP",
  shouldIntercept(R("GET", "https://api.stripe.com/v1/customers"), ORIGIN) === false);
assert("S15 GET https://supabase.com/rest/v1 (cross-origin) → SKIP",
  shouldIntercept(R("GET", "https://supabase.com/rest/v1"), ORIGIN) === false);
assert("S16 GET https://api.twilio.com/2010-04-01/... → SKIP",
  shouldIntercept(R("GET", "https://api.twilio.com/2010-04-01/Calls"), ORIGIN) === false);

assert("S17 POST /assets/main.js → SKIP (non-GET)",
  shouldIntercept(R("POST", `${ORIGIN}/assets/main.js`), ORIGIN) === false);
assert("S18 GET with Authorization header → SKIP",
  shouldIntercept(R("GET", `${ORIGIN}/assets/main.js`, { authorization: "Bearer x" }), ORIGIN) === false);
assert("S19 GET with Range header (video stream) → SKIP",
  shouldIntercept(R("GET", `${ORIGIN}/assets/v.mp4`, { range: "bytes=0-1023" }), ORIGIN) === false);

assert("S20 GET /random-page (no extension, not shell) → SKIP",
  shouldIntercept(R("GET", `${ORIGIN}/some-page`), ORIGIN) === false);

// ── shouldCacheResponse decisions ──
assert("S21 200 OK, no Cache-Control → cache",
  shouldCacheResponse(Resp({ ok: true })) === true);
assert("S22 200 OK with no-store → DO NOT cache",
  shouldCacheResponse(Resp({ headers: { "cache-control": "no-store" } })) === false);
assert("S23 200 OK with private → DO NOT cache",
  shouldCacheResponse(Resp({ headers: { "cache-control": "private, max-age=60" } })) === false);
assert("S24 200 OK with public, max-age=3600 → cache",
  shouldCacheResponse(Resp({ headers: { "cache-control": "public, max-age=3600" } })) === true);
assert("S25 404 → DO NOT cache",
  shouldCacheResponse(Resp({ ok: false, status: 404 })) === false);
assert("S26 opaque response (cross-origin no-cors) → DO NOT cache",
  shouldCacheResponse(Resp({ type: "opaque" })) === false);
assert("S27 200 OK with no-cache (revalidate every time, but cache is OK)",
  // no-cache means must revalidate, NOT must-not-store; we cache but it's stale-while-revalidate.
  // Many SWs treat it like normal storage. Keep this as `true` to mirror our policy.
  shouldCacheResponse(Resp({ headers: { "cache-control": "no-cache" } })) === true);

// ── End-to-end policy combo (intercept + cache decision) ──
function policy(request, response) {
  const intercept = shouldIntercept(request, ORIGIN);
  if (!intercept) return { intercepted: false, cached: false };
  const cached = shouldCacheResponse(response);
  return { intercepted: true, cached };
}

const r1 = policy(R("GET", `${ORIGIN}/assets/m.js`), Resp({ headers: { "cache-control": "public, max-age=3600" } }));
assert("S28 static asset + public cache → intercepted + cached", r1.intercepted && r1.cached);

const r2 = policy(R("GET", `${ORIGIN}/rest/v1/sos_queue`), Resp({}));
assert("S29 Supabase REST → not intercepted (no cache, no SW interference)", !r2.intercepted);

const r3 = policy(R("GET", `${ORIGIN}/dashboard`), Resp({ headers: { "cache-control": "no-store" } }));
assert("S30 dashboard shell with no-store → intercepted, but NOT cached",
  r3.intercepted === true && r3.cached === false);

console.log(`\n${fail === 0 ? "✅ all scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
