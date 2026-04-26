// W3 TIER 2 batch 14: E-16 stripe-checkout origin allowlist for successUrl/cancelUrl

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// Mirror the production isAllowedRedirect contract.
const ALLOWED_ORIGINS = ["https://sosphere-platform.vercel.app", "https://app.sosphere.co"];
const BASE_URL = "https://sosphere-platform.vercel.app";

function isAllowedRedirect(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const allowedOrigins = ALLOWED_ORIGINS.map((o) => {
      try { return new URL(o).origin; } catch { return null; }
    }).filter(Boolean);
    return allowedOrigins.includes(u.origin);
  } catch { return false; }
}

function resolveSafeUrls(successUrl, cancelUrl) {
  const safeSuccess = isAllowedRedirect(successUrl) ? successUrl : `${BASE_URL}/billing?ok=1`;
  const safeCancel  = isAllowedRedirect(cancelUrl)  ? cancelUrl  : `${BASE_URL}/billing?cancelled=1`;
  return { safeSuccess, safeCancel };
}

// S1: legitimate same-origin success URL passes through
{
  const r = resolveSafeUrls("https://sosphere-platform.vercel.app/billing?ok=1", null);
  assert("S1 same-origin success URL preserved",
    r.safeSuccess === "https://sosphere-platform.vercel.app/billing?ok=1");
}

// S2: BEEHIVE — attacker-controlled origin REJECTED
{
  const r = resolveSafeUrls("https://evil.com/?leak=1", null);
  assert("S2 attacker https://evil.com REJECTED → falls back to default",
    r.safeSuccess === "https://sosphere-platform.vercel.app/billing?ok=1");
}

// S3: alt allowlisted domain accepted
{
  const r = resolveSafeUrls("https://app.sosphere.co/billing?ok=1", null);
  assert("S3 second allowlist origin accepted", r.safeSuccess.includes("app.sosphere.co"));
}

// S4: missing URL → defaults
{
  const r = resolveSafeUrls(undefined, undefined);
  assert("S4 undefined → default success",
    r.safeSuccess === "https://sosphere-platform.vercel.app/billing?ok=1");
  assert("S4 undefined → default cancel",
    r.safeCancel === "https://sosphere-platform.vercel.app/billing?cancelled=1");
}

// S5: malformed URL → default (no crash)
{
  const r = resolveSafeUrls("not-a-url", "javascript:alert(1)");
  assert("S5 malformed success → default", r.safeSuccess.includes("sosphere-platform"));
  assert("S5 javascript: pseudo-protocol → default", r.safeCancel.includes("sosphere-platform"));
}

// S6: origin spoofing via path → REJECTED
{
  // Attacker sends https://evil.com/sosphere-platform.vercel.app/...
  // The URL parser normalizes to evil.com origin, not sosphere.
  const r = resolveSafeUrls("https://evil.com/sosphere-platform.vercel.app/billing", null);
  assert("S6 origin spoofing via path REJECTED",
    !r.safeSuccess.includes("evil.com"));
}

// S7: subdomain not allowlisted → REJECTED
{
  const r = resolveSafeUrls("https://other.sosphere-platform.vercel.app/billing", null);
  assert("S7 non-listed subdomain REJECTED",
    r.safeSuccess === "https://sosphere-platform.vercel.app/billing?ok=1");
}

// S8: cancel URL also validated independently
{
  const r = resolveSafeUrls(
    "https://sosphere-platform.vercel.app/billing?ok=1",
    "https://evil.com/?leak=1");
  assert("S8 success allowed but cancel REJECTED → cancel falls back",
    r.safeCancel === "https://sosphere-platform.vercel.app/billing?cancelled=1");
}

console.log("\n" + (fail === 0 ? "OK all E-16 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
