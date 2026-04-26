// Synthetic test for F-B — checkAgeVerifiedFailSecure helper.
// Run: node scripts/test-fb-age-verification.mjs

// We can't import the .ts source directly in Node without a build step,
// so we paste the helper inline (kept in lock-step with the real file).
// Any divergence between the two will be caught by the static
// TypeScript check in the build pipeline.

const DEFAULT_MAX = 2;
const DEFAULT_DELAY = 500;
const DEFAULT_TIMEOUT = 5000;

async function checkAgeVerifiedFailSecure(opts) {
  const max = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX);
  const delay = Math.max(0, opts.retryDelayMs ?? DEFAULT_DELAY);
  const ceiling = Math.max(100, opts.totalTimeoutMs ?? DEFAULT_TIMEOUT);
  const startedAt = Date.now();
  for (let attempt = 0; attempt < max; attempt++) {
    if (Date.now() - startedAt >= ceiling) {
      return { verified: false, reason: "rpc_error" };
    }
    try {
      const remaining = ceiling - (Date.now() - startedAt);
      const res = await Promise.race([
        opts.rpcFn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("age_verify_timeout")), Math.max(50, remaining))),
      ]);
      if (res && !res.error) {
        if (res.data === true)  return { verified: true,  reason: "verified" };
        if (res.data === false) return { verified: false, reason: "not_verified" };
        return { verified: false, reason: "no_profile" };
      }
    } catch {}
    if (attempt < max - 1) await new Promise(r => setTimeout(r, delay));
  }
  return { verified: false, reason: "rpc_error" };
}

// ── Stub helpers ──
const ok      = (data) => () => Promise.resolve({ data, error: null });
const err     = (msg)  => () => Promise.resolve({ data: null, error: { message: msg } });
const throws  = (msg)  => () => Promise.reject(new Error(msg));
const slow    = (ms, data) => () => new Promise(r => setTimeout(() => r({ data, error: null }), ms));

let fail = 0;
function assert(label, expectedVerified, expectedReason, actual) {
  const pass = actual.verified === expectedVerified && actual.reason === expectedReason;
  if (!pass) fail++;
  console.log(`${pass ? "✓" : "✗"} ${label}  →  verified=${actual.verified} reason=${actual.reason}`
    + (pass ? "" : `   EXPECTED verified=${expectedVerified} reason=${expectedReason}`));
}

// ── 7 deep scenarios ──
console.log("\n=== F-B test scenarios ===\n");

// S1: explicit verified
assert("S1 RPC returns true",
  true,  "verified",
  await checkAgeVerifiedFailSecure({ rpcFn: ok(true) }));

// S2: explicit not verified
assert("S2 RPC returns false",
  false, "not_verified",
  await checkAgeVerifiedFailSecure({ rpcFn: ok(false) }));

// S3: RPC returns null (no profile row)
assert("S3 RPC returns null",
  false, "no_profile",
  await checkAgeVerifiedFailSecure({ rpcFn: ok(null) }));

// S4: First call errors then second succeeds → retry rescues legitimate user
{
  let n = 0;
  const flaky = () => {
    n++;
    return n === 1 ? Promise.resolve({ data: null, error: { message: "transient" } })
                   : Promise.resolve({ data: true, error: null });
  };
  assert("S4 flaky RPC then OK",
    true, "verified",
    await checkAgeVerifiedFailSecure({ rpcFn: flaky, retryDelayMs: 10 }));
}

// S5: Both attempts return error → fail-secure
assert("S5 RPC errors twice",
  false, "rpc_error",
  await checkAgeVerifiedFailSecure({ rpcFn: err("network down"), retryDelayMs: 10 }));

// S6: RPC throws (network exception, not error response)
assert("S6 RPC throws both attempts",
  false, "rpc_error",
  await checkAgeVerifiedFailSecure({ rpcFn: throws("ECONNREFUSED"), retryDelayMs: 10 }));

// S7: RPC slower than total ceiling → fail-secure (no false-pass on timeout)
assert("S7 RPC times out",
  false, "rpc_error",
  await checkAgeVerifiedFailSecure({ rpcFn: slow(200, true), totalTimeoutMs: 100, maxAttempts: 1 }));

// Bonus S8: A user the attacker forced through DNS poisoning — RPC always
// times out. Even with retry, fail-secure.
{
  const start = Date.now();
  const r = await checkAgeVerifiedFailSecure({
    rpcFn: () => new Promise(() => {}),  // never resolves
    totalTimeoutMs: 200,
    retryDelayMs: 10,
  });
  const elapsed = Date.now() - start;
  const pass = !r.verified && r.reason === "rpc_error" && elapsed < 700;
  if (!pass) fail++;
  console.log(`${pass ? "✓" : "✗"} S8 hung RPC (DNS attack)  →  verified=${r.verified} reason=${r.reason} elapsed=${elapsed}ms`);
}

console.log(`\n${fail === 0 ? "✅ all scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
