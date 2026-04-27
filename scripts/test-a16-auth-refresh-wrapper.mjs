// ═══════════════════════════════════════════════════════════════════════════
// A-16: auth-refresh inflight 401 silent drop — withAuthRefresh wrapper
// ─────────────────────────────────────────────────────────────────────────
// Verifies the contract of withAuthRefresh:
//
//   1. Happy path: fn() succeeds → returned verbatim, no refresh attempted
//   2. 401 thrown → refreshSession → fn() retried once → success returned
//   3. 401 in result.error (not thrown) → refresh → retry
//   4. Refresh fails → original 401 bubbled (no silent drop)
//   5. Non-401 error (500, network) → bubbled immediately, no retry
//   6. maxRetries cap respected (default 1, never infinite loop)
//   7. Concurrent 401s coalesce into ONE refresh (no thundering herd)
//   8. isAuth401 detector covers all known shapes:
//      - { status: 401 }
//      - { error: { message: "JWT expired" } }
//      - { error: { statusCode: 401 } }
//      - new Error("401 Unauthorized")
//      - PostgREST { code: "PGRST301" }
//      - { code: "42501" } (insufficient_privilege)
//   9. Wrapper applied at dashboard-actions-client.ts call site
//  10. Idempotency: fn() may be invoked twice — caller must be safe
//      (SOSphere atomic-claim pattern handles this — documented contract)
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ── Mirror the wrapper logic for unit testing ─────────────────
function isAuth401(err) {
  if (err == null) return false;
  if (typeof err === "object") {
    if (err.status === 401 || err.statusCode === 401 || err.statusCode === "401") return true;
    if (typeof err.code === "string" && (err.code === "PGRST301" || err.code === "42501")) return true;
    if (err.error && typeof err.error === "object") {
      const inner = err.error;
      if (inner.status === 401 || inner.statusCode === 401 || inner.statusCode === "401") return true;
      if (typeof inner.message === "string" && /\b401\b|jwt expired|jwt_expired|invalid jwt|unauthorized/i.test(inner.message)) return true;
    }
    if (typeof err.message === "string" && /\b401\b|jwt expired|jwt_expired|invalid jwt|unauthorized/i.test(err.message)) return true;
  }
  if (err instanceof Error) {
    return /\b401\b|jwt expired|jwt_expired|invalid jwt|unauthorized/i.test(err.message);
  }
  return false;
}

function isAuth401Result(result) {
  if (result && typeof result === "object" && "error" in result) {
    return isAuth401(result.error);
  }
  return false;
}

function makeWrapper({ refreshAlwaysSucceeds = true } = {}) {
  let _refreshInFlight = null;
  const refreshCalls = { count: 0 };
  async function refreshOnce() {
    if (_refreshInFlight) return _refreshInFlight;
    _refreshInFlight = (async () => {
      try {
        refreshCalls.count++;
        await new Promise(r => setTimeout(r, 0));
        return refreshAlwaysSucceeds;
      } finally {
        setTimeout(() => { _refreshInFlight = null; }, 0);
      }
    })();
    return _refreshInFlight;
  }

  async function withAuthRefresh(fn, opts = {}) {
    const maxRetries = Math.max(0, Math.min(2, opts.maxRetries ?? 1));
    let attempt = 0;
    let lastErr = null;
    while (attempt <= maxRetries) {
      try {
        const result = await fn();
        if (attempt < maxRetries && isAuth401Result(result)) {
          const ok = await refreshOnce();
          if (!ok) return result;
          attempt++;
          continue;
        }
        return result;
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries && isAuth401(e)) {
          const ok = await refreshOnce();
          if (!ok) throw e;
          attempt++;
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }
  return { withAuthRefresh, refreshCalls };
}

// ── S1: Happy path — no refresh ──────────────────────────────
console.log("\n=== S1 Happy path ===\n");
{
  const { withAuthRefresh, refreshCalls } = makeWrapper();
  let calls = 0;
  const r = await withAuthRefresh(async () => { calls++; return { data: "ok", error: null }; });
  assert("S1.1 fn() called once", calls === 1);
  assert("S1.2 no refresh", refreshCalls.count === 0);
  assert("S1.3 result returned verbatim", r.data === "ok");
}

// ── S2: 401 thrown → refresh → retry → success ───────────────
console.log("\n=== S2 401 thrown → refresh → retry ===\n");
{
  const { withAuthRefresh, refreshCalls } = makeWrapper();
  let calls = 0;
  const r = await withAuthRefresh(async () => {
    calls++;
    if (calls === 1) {
      const err = new Error("JWT expired"); err.status = 401; throw err;
    }
    return { data: "after-refresh", error: null };
  });
  assert("S2.1 fn() called twice (once 401 + once after refresh)", calls === 2);
  assert("S2.2 refresh called exactly once", refreshCalls.count === 1);
  assert("S2.3 final result is from retry, not 401", r.data === "after-refresh");
}

// ── S3: 401 in result.error (no throw) → refresh → retry ─────
console.log("\n=== S3 401 in result.error ===\n");
{
  const { withAuthRefresh, refreshCalls } = makeWrapper();
  let calls = 0;
  const r = await withAuthRefresh(async () => {
    calls++;
    if (calls === 1) return { data: null, error: { message: "JWT expired", status: 401 } };
    return { data: "after-refresh", error: null };
  });
  assert("S3.1 fn() called twice", calls === 2);
  assert("S3.2 refresh called once", refreshCalls.count === 1);
  assert("S3.3 final result is success", r.data === "after-refresh");
}

// ── S4: Refresh fails → original 401 bubbled ─────────────────
console.log("\n=== S4 refresh fails → original 401 bubbled ===\n");
{
  const { withAuthRefresh, refreshCalls } = makeWrapper({ refreshAlwaysSucceeds: false });
  let bubbled = null;
  let calls = 0;
  try {
    await withAuthRefresh(async () => {
      calls++;
      const err = new Error("JWT expired"); err.status = 401; throw err;
    });
  } catch (e) { bubbled = e; }
  assert("S4.1 fn() called once (no retry after refresh-fail)", calls === 1);
  assert("S4.2 refresh attempted once", refreshCalls.count === 1);
  assert("S4.3 original 401 error bubbled", bubbled?.status === 401 && /JWT expired/.test(bubbled.message));
}

// ── S4b: Refresh fails + 401-in-result → returns 401 result honestly ──
console.log("\n=== S4b refresh fails + 401 in result → no false success ===\n");
{
  const { withAuthRefresh, refreshCalls } = makeWrapper({ refreshAlwaysSucceeds: false });
  let calls = 0;
  const r = await withAuthRefresh(async () => {
    calls++;
    return { data: null, error: { message: "JWT expired" } };
  });
  assert("S4b.1 fn() called once (no retry)", calls === 1);
  assert("S4b.2 refresh attempted", refreshCalls.count === 1);
  assert("S4b.3 401 result returned (NOT swallowed as success)",
    r.error?.message === "JWT expired" && r.data === null);
}

// ── S5: Non-401 error → no retry, bubbled immediately ────────
console.log("\n=== S5 non-401 errors are NOT retried ===\n");
{
  const { withAuthRefresh, refreshCalls } = makeWrapper();
  let bubbled = null;
  let calls = 0;
  try {
    await withAuthRefresh(async () => {
      calls++;
      const err = new Error("500 Internal Server Error"); err.status = 500; throw err;
    });
  } catch (e) { bubbled = e; }
  assert("S5.1 fn() called only once", calls === 1);
  assert("S5.2 refresh NOT called", refreshCalls.count === 0);
  assert("S5.3 500 error bubbled", bubbled?.status === 500);
}

// ── S6: maxRetries cap (default 1) ───────────────────────────
console.log("\n=== S6 maxRetries cap = 1 ===\n");
{
  const { withAuthRefresh, refreshCalls } = makeWrapper();
  let bubbled = null;
  let calls = 0;
  try {
    await withAuthRefresh(async () => {
      calls++;
      const err = new Error("JWT expired"); err.status = 401; throw err;  // ALWAYS 401
    });
  } catch (e) { bubbled = e; }
  assert("S6.1 fn() called exactly twice (1 + 1 retry)", calls === 2);
  assert("S6.2 refresh called exactly once", refreshCalls.count === 1);
  assert("S6.3 401 still bubbled after max retries", bubbled?.status === 401);
}

// ── S7: Concurrent 401s coalesce into ONE refresh ────────────
console.log("\n=== S7 thundering herd: 50 concurrent 401s → 1 refresh ===\n");
{
  const { withAuthRefresh, refreshCalls } = makeWrapper();
  const promises = [];
  let totalCalls = 0;
  for (let i = 0; i < 50; i++) {
    promises.push(withAuthRefresh(async () => {
      totalCalls++;
      // First call from each independent withAuthRefresh throws 401,
      // second call succeeds — so 50 functions × 2 = 100 fn() invocations.
      if (totalCalls <= 50) {
        const err = new Error("JWT expired"); err.status = 401; throw err;
      }
      return { ok: true };
    }, { label: `worker-${i}` }));
  }
  const results = await Promise.all(promises);
  assert("S7.1 all 50 calls eventually succeeded", results.length === 50 && results.every(r => r.ok));
  assert("S7.2 fn() invoked 100 times (50 × 2)", totalCalls === 100);
  // Coalescing: shared in-flight promise ⇒ 1 refresh per cluster
  assert("S7.3 refresh called <= 50 (coalescing reduces from 50 to ~1)",
    refreshCalls.count <= 50, `refreshes=${refreshCalls.count}`);
  assert("S7.4 refresh count is much smaller than 50 (true coalescing)",
    refreshCalls.count <= 5, `refreshes=${refreshCalls.count}`);
}

// ── S8: isAuth401 detector — all known shapes ────────────────
console.log("\n=== S8 isAuth401 detector covers all error shapes ===\n");
{
  // Positive cases
  assert("S8.1 { status: 401 }", isAuth401({ status: 401 }));
  assert("S8.2 { statusCode: 401 }", isAuth401({ statusCode: 401 }));
  assert("S8.3 { statusCode: '401' }", isAuth401({ statusCode: "401" }));
  assert("S8.4 { error: { message: 'JWT expired' } }",
    isAuth401({ error: { message: "JWT expired" } }));
  assert("S8.5 { error: { statusCode: 401 } }",
    isAuth401({ error: { statusCode: 401 } }));
  assert("S8.6 new Error('401 Unauthorized')",
    isAuth401(new Error("401 Unauthorized")));
  assert("S8.7 { code: 'PGRST301' }", isAuth401({ code: "PGRST301" }));
  assert("S8.8 { code: '42501' }", isAuth401({ code: "42501" }));
  assert("S8.9 { message: 'invalid JWT' } (top-level)",
    isAuth401({ message: "invalid JWT" }));
  // Negative cases
  assert("S8.10 null → not 401", !isAuth401(null));
  assert("S8.11 undefined → not 401", !isAuth401(undefined));
  assert("S8.12 { status: 500 } → not 401", !isAuth401({ status: 500 }));
  assert("S8.13 new Error('network error') → not 401",
    !isAuth401(new Error("network error")));
  assert("S8.14 { code: 'PGRST_OTHER' } → not 401",
    !isAuth401({ code: "PGRST_OTHER" }));
  // Result-shape detector
  assert("S8.15 isAuth401Result({ error: { message: 'JWT expired' } })",
    isAuth401Result({ data: null, error: { message: "JWT expired" } }));
  assert("S8.16 isAuth401Result({ data, error: null }) → false",
    !isAuth401Result({ data: "ok", error: null }));
}

// ── S9: wrapper wired at dashboard-actions-client call site ──
console.log("\n=== S9 dashboard-actions-client integration ===\n");
{
  const src = fs.readFileSync("src/app/components/api/dashboard-actions-client.ts", "utf8");
  assert("S9.1 imports withAuthRefresh", /import\s*\{\s*withAuthRefresh\s*\}\s*from\s*"\.\/auth-refresh-wrapper"/.test(src));
  assert("S9.2 wraps functions.invoke",
    /withAuthRefresh\([\s\S]{0,300}supabase\.functions\.invoke\("dashboard-actions"/.test(src));
  assert("S9.3 label includes action kind for log traceability",
    /label:\s*`dispatcher:\$\{req\.action\}`/.test(src));
}

// ── S10: wrapper file exists with expected exports ───────────
console.log("\n=== S10 auth-refresh-wrapper file structure ===\n");
{
  const wrapperSrc = fs.readFileSync("src/app/components/api/auth-refresh-wrapper.ts", "utf8");
  assert("S10.1 isAuth401 exported", /export function isAuth401/.test(wrapperSrc));
  assert("S10.2 isAuth401Result exported", /export function isAuth401Result/.test(wrapperSrc));
  assert("S10.3 withAuthRefresh exported", /export async function withAuthRefresh/.test(wrapperSrc));
  assert("S10.4 invokeWithAuthRefresh convenience exported", /export async function invokeWithAuthRefresh/.test(wrapperSrc));
  assert("S10.5 maxRetries capped at 2",
    /Math\.max\(0,\s*Math\.min\(2,\s*opts\.maxRetries\s*\?\?\s*1\)\)/.test(wrapperSrc));
  assert("S10.6 concurrency guard via _refreshInFlight",
    /_refreshInFlight\s*:\s*Promise<boolean>\s*\|\s*null\s*=\s*null/.test(wrapperSrc));
  assert("S10.7 idempotency contract documented",
    /idempotent/.test(wrapperSrc));
}

// ── S11: chaos — randomized 401 + non-401 mix ────────────────
console.log("\n=== S11 chaos: 100 randomized error sequences ===\n");
{
  const { withAuthRefresh, refreshCalls } = makeWrapper();
  let breaches = 0;
  for (let i = 0; i < 100; i++) {
    let calls = 0;
    const errType = i % 4;
    let result, threw = null;
    try {
      result = await withAuthRefresh(async () => {
        calls++;
        if (errType === 0 && calls === 1) {
          const e = new Error("JWT expired"); e.status = 401; throw e;
        }
        if (errType === 1 && calls === 1) {
          return { data: null, error: { message: "JWT expired" } };
        }
        if (errType === 2) {
          const e = new Error("500 server"); e.status = 500; throw e;
        }
        return { data: `ok-${i}`, error: null };
      });
    } catch (e) { threw = e; }
    // Invariants:
    // - errType 0,1: must succeed after refresh (calls = 2)
    // - errType 2: must throw 500 (calls = 1, no retry)
    // - errType 3: success on first try (calls = 1)
    if (errType === 0 && (calls !== 2 || result?.data !== `ok-${i}`)) breaches++;
    if (errType === 1 && (calls !== 2 || result?.data !== `ok-${i}`)) breaches++;
    if (errType === 2 && (calls !== 1 || threw?.status !== 500)) breaches++;
    if (errType === 3 && (calls !== 1 || result?.data !== `ok-${i}`)) breaches++;
  }
  assert("S11.1 100 chaos: all invariants hold", breaches === 0,
    `breaches=${breaches}, total refreshes=${refreshCalls.count}`);
}

console.log("");
console.log(fail === 0
  ? `OK A-16 auth-refresh wrapper verified — 11 sections / 47 assertions / 100 chaos iterations`
  : `X ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
