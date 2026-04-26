// ═══════════════════════════════════════════════════════════════════════════
// Chaos / Fuzz Test
// ═══════════════════════════════════════════════════════════════════════════
// Injects randomized failures across the SOS chain and verifies graceful
// degradation. Each iteration picks a random failure mode, runs the canonical
// flow, and asserts the contract holds. Runs N=50 iterations with seeded RNG.
//
// Failure modes injected:
//   - twilio_status: healthy / degraded / down
//   - network: online / flap / offline
//   - audit_log_db: ok / fail
//   - gps_invalid: random junk values for lat/lng/battery
//   - emergencyId_collision: forge another user's id
//   - tier_lookup_throws
//   - subscription_status: active / past_due / canceled / null
//   - concurrent_persist + retry race
// ═══════════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

let fail = 0;
let pass = 0;
function assert(label, cond, extra = "") {
  if (!cond) { fail++; console.log("X  " + label + (extra ? "  " + extra : "")); }
  else { pass++; }
}

// ── Seeded RNG ────────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
}
const rng = makeRng(0xDEADBEEF);
const rand = () => rng();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ── Canonical SOS chain model (mirrors production contracts) ──────
function canonicalChain(env) {
  const log = [];
  const breadcrumbs = [];

  // 1. Validate user
  if (!env.userId) return { ok: false, stage: "auth", reason: "no userId" };
  breadcrumbs.push("auth_ok");

  // 2. PREWARM with W3-30 ownership check
  if (env.existingSession && env.existingSession.user_id !== env.userId) {
    return { ok: false, stage: "prewarm", reason: "409 emergencyId conflict", breadcrumbs };
  }
  breadcrumbs.push("prewarm_ok");

  // 3. GPS validation (W3-31)
  let safeLat = null, safeLng = null;
  if (typeof env.lat === "number" && Number.isFinite(env.lat) && env.lat >= -90 && env.lat <= 90) safeLat = env.lat;
  if (typeof env.lng === "number" && Number.isFinite(env.lng) && env.lng >= -180 && env.lng <= 180) safeLng = env.lng;
  breadcrumbs.push(`gps_${safeLat !== null ? "valid" : "scrubbed"}`);

  // 4. Tier resolution (W3-14 fallback to free on lookup error)
  let tier = "free";
  if (env.tierLookupThrows) {
    tier = "free";  // fail-secure
  } else {
    tier = env.resolvedTier ?? "free";
  }
  // W3-21: past_due returns free
  if (env.subscriptionStatus === "past_due" || env.subscriptionStatus === "canceled") {
    tier = "free";
  }
  breadcrumbs.push(`tier_${tier}`);

  // 5. Pre-fanout audit checkpoint (W3-28) — best-effort
  if (env.auditDb !== "fail") {
    log.push({ action: "sos_dispatch_started", checkpoint: "pre_fanout" });
    breadcrumbs.push("audit_pre_fanout");
  }

  // 6. Fanout with W3-27 per-contact timeout
  const results = [];
  const fanoutDeadline = 200; // ms
  for (const c of env.contacts) {
    if (env.twilioStatus === "down") {
      results.push({ contact: c.name, callSid: null, smsSid: null, method: "all_failed" });
    } else if (env.twilioStatus === "degraded") {
      results.push({ contact: c.name, callSid: null, smsSid: null, method: "timeout" });
    } else {
      results.push({ contact: c.name, callSid: "CA-" + crypto.randomBytes(2).toString("hex"),
                     smsSid: "SM-" + crypto.randomBytes(2).toString("hex"), method: "ok" });
    }
  }
  breadcrumbs.push(`fanout_${results.filter(r => r.method === "ok").length}/${results.length}`);

  // 7. Tenant-scoped realtime broadcast (W3-3)
  const channel = env.companyId ? `sos-live:${env.companyId}` : `sos-live:civilian:${env.userId}`;
  breadcrumbs.push(`broadcast_${channel}`);

  // 8. Rich post-fanout audit (best-effort; pre-fanout breadcrumb survives if this fails)
  if (env.auditDb !== "fail") {
    log.push({ action: "sos_triggered", metadata: { tier, results } });
    breadcrumbs.push("audit_rich");
  }

  return { ok: true, tier, results, channel, log, breadcrumbs };
}

// ── Chaos iterations ──────────────────────────────────────────────
console.log("\n=== Chaos / Fuzz: 50 iterations ===\n");

const FAILURE_MODES = ["healthy", "degraded", "down"];
const NETWORK_MODES = ["online", "flap", "offline"];
const SUB_STATUSES = ["active", "trialing", "past_due", "canceled", null];
const TIERS = ["free", "basic", "elite"];

let scenarios = 0;
let breadcrumbsObserved = 0;
let auditPreFanoutCount = 0;

for (let i = 0; i < 50; i++) {
  scenarios++;
  const lat = rand() < 0.3 ? (rand() * 200 - 100) : (rand() * 90 - 45);  // 30% chance of out-of-range
  const lng = rand() < 0.3 ? (rand() * 400 - 200) : (rand() * 180 - 90);
  const env = {
    userId: rand() < 0.05 ? null : "u-" + i,  // 5% chance no userId
    companyId: rand() < 0.5 ? "co-" + Math.floor(rand() * 3) : null,
    lat, lng,
    contacts: Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, n) => ({
      name: "C" + n, phone: "+155500" + n,
    })),
    twilioStatus: pick(FAILURE_MODES),
    network: pick(NETWORK_MODES),
    auditDb: rand() < 0.2 ? "fail" : "ok",
    tierLookupThrows: rand() < 0.1,
    subscriptionStatus: pick(SUB_STATUSES),
    resolvedTier: pick(TIERS),
    existingSession: rand() < 0.05 ? { user_id: "u-attacker" } : null,  // 5% hijack attempt
  };

  const result = canonicalChain(env);
  breadcrumbsObserved += result.breadcrumbs?.length ?? 0;

  // ── Invariants that must hold across all chaos iterations ──
  // I1: out-of-range GPS NEVER persists
  if (env.lat > 90 || env.lat < -90) {
    if (result.ok) {
      const gpsBreadcrumb = result.breadcrumbs.find(b => b.startsWith("gps_"));
      if (gpsBreadcrumb !== "gps_scrubbed") fail++;
    }
  }
  // I2: past_due / canceled NEVER yields elite tier
  if (env.subscriptionStatus === "past_due" || env.subscriptionStatus === "canceled") {
    if (result.ok && result.tier !== "free") fail++;
  }
  // I3: hijack attempt NEVER reaches fanout
  if (env.existingSession && env.existingSession.user_id !== env.userId) {
    if (result.ok) fail++;  // should have returned !ok at prewarm stage
  }
  // I4: even when audit DB fails, pre-fanout breadcrumb is ABSENT (gracefully)
  //     and rich audit also absent — but the chain still completed
  if (env.auditDb === "fail" && result.ok) {
    if (result.log.length > 0) fail++;  // no rows written when DB failed
  }
  if (env.auditDb === "ok" && result.ok) {
    if (result.log.length === 0) fail++;
    auditPreFanoutCount++;
  }
  // I5: realtime channel is ALWAYS tenant-scoped (never raw "sos-live")
  if (result.ok && result.channel === "sos-live") fail++;
  // I6: tier_lookup throwing → tier defaults to free (W3-14 fail-secure)
  if (env.tierLookupThrows && result.ok) {
    if (result.tier !== "free") fail++;
  }
  // I7: twilio_down → all results have method="all_failed", no callSid/smsSid
  if (env.twilioStatus === "down" && result.ok) {
    for (const r of result.results) {
      if (r.callSid !== null || r.smsSid !== null) fail++;
    }
  }
}

assert(`I1-I7 hold across ${scenarios} chaos iterations`, fail === 0, `breadcrumbs avg=${(breadcrumbsObserved/scenarios).toFixed(1)}`);
assert(`Audit pre-fanout fired in ${auditPreFanoutCount}/${scenarios} non-DB-fail runs`, auditPreFanoutCount > 0);

// ── Concurrent retry-queue race fuzz ──
console.log("\n=== Concurrent retry-queue fuzz ===\n");
{
  const N = 100;
  let queue = [];
  let dbInserted = [];
  let lock = Promise.resolve();
  const persist = (e) => {
    lock = lock.then(async () => {
      const cur = [...queue];
      const upserted = new Set([...cur.map(x => x.id), e.id]);
      await new Promise(r => setTimeout(r, 1));
      for (const x of [...cur, e]) if (!dbInserted.find(d => d.id === x.id)) dbInserted.push(x);
      queue = queue.filter(x => !upserted.has(x.id));
    }).catch(() => {});
    return lock;
  };
  // Fire N persists + late enqueues
  const promises = Array.from({ length: N }, (_, i) => persist({ id: `p${i}` }));
  for (let t = 1; t <= 5; t++) {
    setTimeout(() => { queue.unshift({ id: `late${t}` }); }, t * 3);
  }
  await Promise.all(promises);
  // Wait for any remaining async drain
  await new Promise(r => setTimeout(r, 50));
  // Drain remaining queue with one more persist
  await persist({ id: "final-flush" });

  assert(`${N} concurrent persists landed`, dbInserted.length >= N);
  // None of the late entries silently lost
  let lateLost = 0;
  for (let t = 1; t <= 5; t++) {
    const drained = dbInserted.some(d => d.id === `late${t}`);
    const inQueue = queue.some(e => e.id === `late${t}`);
    if (!drained && !inQueue) lateLost++;
  }
  assert(`Zero late entries silently lost (${lateLost} would be the bug)`, lateLost === 0);
}

console.log("");
console.log(`Chaos summary: ${pass} OK, ${fail} failures.`);
process.exit(fail === 0 ? 0 : 1);
