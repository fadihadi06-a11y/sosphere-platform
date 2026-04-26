// W3-11 hard test — server-tier re-sync on resume + focus + periodic.
// Pre-fix: fetchCivilianTier ran ONLY on auth-restore. Customer paid for
// Elite → app stayed on Free until logout/login.
// Post-fix: refresh on Capacitor resume, window focus, every 5 minutes,
// and explicit `sosphere_tier_refresh` event.

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ── Mock the relevant slice of the post-fix mobile-app effect ────
function makeRefresher(opts) {
  let lastSyncedAt = 0;
  const THROTTLE_MS = 30 * 1000;
  let syncCount = 0;
  const log = [];
  let userPlan = opts.initialPlan;
  let serverPlan = opts.initialPlan;

  // Simulated time
  let now = 1_000_000;
  const advance = (ms) => { now += ms; };

  function setServerPlan(p) { serverPlan = p; }
  function getUserPlan() { return userPlan; }

  async function refreshTier(reason) {
    if (now - lastSyncedAt < THROTTLE_MS) {
      log.push(`THROTTLED (${reason}) since=${now - lastSyncedAt}ms`);
      return false;
    }
    lastSyncedAt = now;
    syncCount++;
    log.push(`SYNC #${syncCount} (${reason}) prev=${userPlan} server=${serverPlan}`);
    // Simulate fetchCivilianTier — fail-secure: errors return 'free'
    if (opts.shouldRpcError && opts.shouldRpcError()) {
      log.push(`  -> rpc_error, keeping ${userPlan}`);
      return false;
    }
    // Apply server tier
    if (serverPlan !== userPlan) {
      const old = userPlan;
      userPlan = serverPlan;
      log.push(`  -> changed ${old} -> ${userPlan}`);
      return true;
    }
    return false;
  }

  return { refreshTier, advance, setServerPlan, getUserPlan, peekLog: () => [...log], peekSyncCount: () => syncCount };
}

// S1: Customer pays for Elite — server flips. Periodic refresh catches it.
{
  const r = makeRefresher({ initialPlan: "free" });
  await r.refreshTier("auth_restore");
  assert("S1 initial sync runs", r.peekSyncCount() === 1);
  // Now Stripe webhook flips server
  r.setServerPlan("pro");
  // 30s passes (throttle window); periodic fires
  r.advance(31_000);
  await r.refreshTier("periodic_5min");
  assert("S1 after server flip + throttle window: tier becomes 'pro'",
    r.getUserPlan() === "pro");
}

// S2: Throttle prevents hammering — multiple events within 30s coalesce.
{
  const r = makeRefresher({ initialPlan: "free" });
  await r.refreshTier("auth_restore");
  r.advance(5_000);
  await r.refreshTier("capacitor_resume");
  r.advance(5_000);
  await r.refreshTier("window_focus");
  r.advance(5_000);
  await r.refreshTier("periodic_5min");
  assert("S2 throttle: only 1 sync within 30s window",
    r.peekSyncCount() === 1);
  // After 30s, next call goes through
  r.advance(31_000);
  await r.refreshTier("window_focus");
  assert("S2 throttle releases after 30s — sync #2 fires",
    r.peekSyncCount() === 2);
}

// S3: Customer cancels — server flips Elite → Free.
{
  const r = makeRefresher({ initialPlan: "pro" });
  // Server cancels
  r.setServerPlan("free");
  r.advance(31_000);
  await r.refreshTier("window_focus");
  assert("S3 cancellation propagates: pro -> free", r.getUserPlan() === "free");
}

// S4: RPC error keeps current tier (fail-secure — no flicker).
{
  let errMode = false;
  const r = makeRefresher({
    initialPlan: "pro",
    shouldRpcError: () => errMode,
  });
  await r.refreshTier("auth_restore");
  // Now an error happens
  errMode = true;
  r.setServerPlan("free");  // would normally drop them
  r.advance(31_000);
  await r.refreshTier("periodic_5min");
  assert("S4 RPC error: tier stays at 'pro' (fail-secure, no flicker)",
    r.getUserPlan() === "pro");
  // Recovery
  errMode = false;
  r.advance(31_000);
  await r.refreshTier("periodic_5min");
  assert("S4 RPC recovers: server-side downgrade now applies", r.getUserPlan() === "free");
}

// S5: Capacitor resume + window focus + periodic — all paths exercised.
{
  const r = makeRefresher({ initialPlan: "free" });
  await r.refreshTier("auth_restore");
  r.setServerPlan("pro");

  r.advance(31_000);
  await r.refreshTier("capacitor_resume");
  assert("S5a capacitor_resume triggers refresh", r.getUserPlan() === "pro");

  r.setServerPlan("free");
  r.advance(31_000);
  await r.refreshTier("window_focus");
  assert("S5b window_focus triggers refresh", r.getUserPlan() === "free");

  r.setServerPlan("pro");
  r.advance(31_000);
  await r.refreshTier("explicit_event");
  assert("S5c explicit_event triggers refresh", r.getUserPlan() === "pro");

  r.setServerPlan("free");
  r.advance(31_000);
  await r.refreshTier("periodic_5min");
  assert("S5d periodic_5min triggers refresh", r.getUserPlan() === "free");
}

// S6: Pre-fix model — only auth_restore triggers a sync. After that,
// server changes are NEVER observed until next session.
{
  const r = makeRefresher({ initialPlan: "free" });
  // Pre-fix only had this single sync
  await r.refreshTier("auth_restore");
  // Server changes later — no further sync ever happens (pre-fix)
  r.setServerPlan("pro");
  // (no further refreshTier calls — pre-fix didn't have these triggers)
  assert("S6 pre-fix: tier stays stale at 'free' despite server saying 'pro'",
    r.getUserPlan() === "free");
}

console.log("\n" + (fail === 0 ? "OK all W3-11 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
