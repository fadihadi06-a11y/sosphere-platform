// Synthetic test for F-C — sos-server-trigger retry-on-503 logic.
// Mirrors the production block in src/app/components/sos-server-trigger.ts
// so the behavior can be verified end-to-end before the real bundle ships.

// ── Inline copy of the retry block under test (kept in sync with the
// real file). Tests stub doFetch / parseRateLimit / waitForRetry. ──
async function fetchSOSCore({ doFetch, parseRateLimit, waitForRetry, logRateLimit }) {
  let res = await doFetch();

  if (res.status === 429) {
    const info = parseRateLimit(res);
    logRateLimit?.("sos-alert?action=root", info);
    try { await res.clone().text(); } catch {}
    const ok = await waitForRetry(info);
    if (ok) res = await doFetch();
  } else if (res.status === 503) {
    let body = null;
    try { body = await res.clone().json(); } catch {}
    if (body?.error === "rate_limit_check_failed") {
      const waitMs = Math.min(Math.max((body?.retry_after_sec ?? 1) * 1000, 250), 3000);
      await new Promise(r => setTimeout(r, waitMs));
      res = await doFetch();
    }
  }
  return res;
}

// ── Stub helpers ──
function fakeRes(status, body) {
  const json = JSON.stringify(body ?? {});
  return {
    status,
    clone() { return this; },
    json: async () => body,
    text: async () => json,
  };
}
function makeFlaky(...sequence) {
  let i = 0;
  return async () => {
    const next = sequence[Math.min(i, sequence.length - 1)];
    i++;
    return typeof next === "function" ? next() : next;
  };
}

const parseRateLimit = () => ({ retryAfterMs: 100 });
const waitForRetry = async () => true;

// ── 7 scenarios + edge cases ──
let fail = 0;
function assert(label, expectedStatus, expectedCalls, actual) {
  const pass = actual.res.status === expectedStatus && actual.calls === expectedCalls;
  if (!pass) fail++;
  const tick = pass ? "✓" : "✗";
  const mark = pass ? "" : `  EXPECTED status=${expectedStatus} calls=${expectedCalls}`;
  console.log(`${tick} ${label}  →  status=${actual.res.status} calls=${actual.calls}${mark}`);
}

console.log("\n=== F-C test scenarios ===\n");

// Wrap doFetch so we can count invocations
function instrument(fn) {
  let calls = 0;
  return {
    fn: async () => { calls++; return await fn(); },
    get calls() { return calls; },
  };
}

// S1: 200 OK first try → no retry
{
  const i = instrument(makeFlaky(fakeRes(200, { ok: true })));
  const start = Date.now();
  const res = await fetchSOSCore({ doFetch: i.fn, parseRateLimit, waitForRetry });
  assert("S1 200 ok first try", 200, 1, { res, calls: i.calls });
  if (Date.now() - start > 100) console.log("  (expected fast, took longer)");
}

// S2: 429 once then 200 — existing behavior preserved
{
  const i = instrument(makeFlaky(fakeRes(429, {}), fakeRes(200, { ok: true })));
  const res = await fetchSOSCore({ doFetch: i.fn, parseRateLimit, waitForRetry });
  assert("S2 429 → retry → 200", 200, 2, { res, calls: i.calls });
}

// S3: 503 with rate_limit_check_failed → retry → 200 (NEW behavior)
{
  const i = instrument(makeFlaky(
    fakeRes(503, { error: "rate_limit_check_failed", retry_after_sec: 0.3 }),
    fakeRes(200, { ok: true })
  ));
  const start = Date.now();
  const res = await fetchSOSCore({ doFetch: i.fn, parseRateLimit, waitForRetry });
  const elapsed = Date.now() - start;
  assert("S3 503-rate-limit → retry → 200", 200, 2, { res, calls: i.calls });
  // Confirm the retry waited (>= 250ms floor)
  console.log(`  wait was ${elapsed}ms (must be >= 250ms)`);
  if (elapsed < 250) { fail++; console.log("  ✗ wait too short"); }
}

// S4: 503 rate_limit twice in a row → returns the second 503 (no infinite loop)
{
  const i = instrument(makeFlaky(
    fakeRes(503, { error: "rate_limit_check_failed", retry_after_sec: 0.3 }),
    fakeRes(503, { error: "rate_limit_check_failed", retry_after_sec: 0.3 })
  ));
  const res = await fetchSOSCore({ doFetch: i.fn, parseRateLimit, waitForRetry });
  assert("S4 503-rate-limit twice → return 503 (one retry max)", 503, 2, { res, calls: i.calls });
}

// S5: 503 with internal_error (NOT rate_limit) → no retry
{
  const i = instrument(makeFlaky(fakeRes(503, { error: "internal_error" })));
  const res = await fetchSOSCore({ doFetch: i.fn, parseRateLimit, waitForRetry });
  assert("S5 503-internal-error → no retry", 503, 1, { res, calls: i.calls });
}

// S6: 503 non-JSON body (some HTML error page) → no retry
{
  const malformed = {
    status: 503,
    clone() { return this; },
    json: async () => { throw new Error("not json"); },
    text: async () => "<html>BadGateway</html>",
  };
  const i = instrument(makeFlaky(malformed));
  const res = await fetchSOSCore({ doFetch: i.fn, parseRateLimit, waitForRetry });
  assert("S6 503 non-JSON body → no retry", 503, 1, { res, calls: i.calls });
}

// S7: 503-rate-limit with very large retry_after → cap at 3000ms
{
  const start = Date.now();
  const i = instrument(makeFlaky(
    fakeRes(503, { error: "rate_limit_check_failed", retry_after_sec: 600 }),
    fakeRes(200, { ok: true })
  ));
  const res = await fetchSOSCore({ doFetch: i.fn, parseRateLimit, waitForRetry });
  const elapsed = Date.now() - start;
  assert("S7 huge retry_after capped at 3000ms", 200, 2, { res, calls: i.calls });
  if (elapsed > 3500) { fail++; console.log(`  ✗ wait wasn't capped (${elapsed}ms)`); }
  else console.log(`  wait was ${elapsed}ms (cap is 3000ms)`);
}

// S8: 200 with a body that looks like a rate-limit error — should NOT retry
{
  const i = instrument(makeFlaky(fakeRes(200, { error: "rate_limit_check_failed" })));
  const res = await fetchSOSCore({ doFetch: i.fn, parseRateLimit, waitForRetry });
  assert("S8 200 with rate-limit-shaped body → no retry", 200, 1, { res, calls: i.calls });
}

console.log(`\n${fail === 0 ? "✅ all scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
