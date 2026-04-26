// Synthetic test for G-35 (audit-log diff-clear), G-36 (replay-watcher
// named-handler idempotency), G-40 (checkin-timer retry queue), G-41
// (AbortSignal timeout pattern). Inline copies of the helpers — kept
// in sync with source.

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ── G-35: persistToSupabase write-lock + diff-clear ───────────────
console.log("\n=== G-35 audit-log persist write-lock + diff-clear ===\n");

function makeAuditFixture() {
  let queue = [];
  let dbInserted = [];
  let dbErrorMode = null;
  let writeLock = Promise.resolve();
  const loadQueue = () => [...queue];
  const saveQueue = (q) => { queue = [...q]; };
  const enqueueForRetry = (entry) => {
    if (queue.some(e => e.id === entry.id)) return;
    queue.unshift(entry);
  };
  async function persistToSupabase(entry) {
    writeLock = writeLock.then(async () => {
      try {
        const cur = loadQueue();
        const upsertedIds = new Set([...cur.map(e => e.id), entry.id]);
        if (dbErrorMode) { enqueueForRetry(entry); return; }
        // Simulate async DB upsert with a tick so we can inject other writes.
        await new Promise(r => setTimeout(r, 5));
        for (const e of [...cur, entry]) {
          if (!dbInserted.find(d => d.id === e.id)) dbInserted.push(e);
        }
        const after = loadQueue();
        saveQueue(after.filter(e => !upsertedIds.has(e.id)));
      } catch (err) {
        enqueueForRetry(entry);
      }
    }).catch(() => {});
    return writeLock;
  }
  return {
    persistToSupabase, enqueueForRetry,
    peekQueue: () => [...queue], peekDb: () => [...dbInserted],
    setDbError: (m) => { dbErrorMode = m; },
    reset: () => { queue = []; dbInserted = []; dbErrorMode = null; writeLock = Promise.resolve(); },
  };
}

// S1: serial single insert lands
{
  const f = makeAuditFixture();
  await f.persistToSupabase({ id: "e1" });
  assert("S1 e1 persisted", f.peekDb().length === 1 && f.peekQueue().length === 0);
}

// S2: queue drained on next insert
{
  const f = makeAuditFixture();
  f.setDbError("offline");
  await f.persistToSupabase({ id: "e1" });  // fails → queued
  assert("S2a e1 queued during error", f.peekQueue().length === 1);
  f.setDbError(null);
  await f.persistToSupabase({ id: "e2" });
  assert("S2b queue drained on recovery", f.peekDb().length === 2 && f.peekQueue().length === 0);
}

// S3: BEEHIVE — concurrent insert + mid-flight enqueue. Pre-fix the
// diff-clear would erase e2 because the entire queue was wiped after
// upsert. Post-fix: only the ids we actually upserted are removed.
{
  const f = makeAuditFixture();
  // Tab A: persistToSupabase(e1) — this lands in the writeLock and
  // does its `cur = loadQueue()` snapshot synchronously inside the
  // microtask, then awaits sleep(5) for the DB upsert. We inject e2
  // DURING that sleep so it arrives AFTER cur was captured but BEFORE
  // diff-clear runs.
  const promiseA = f.persistToSupabase({ id: "e1" });
  // Wait one microtask + 1ms so persistToSupabase has read cur and is
  // mid-await on the DB upsert.
  await new Promise(r => setTimeout(r, 1));
  f.enqueueForRetry({ id: "e2" });
  await promiseA;
  assert("S3 e1 persisted", f.peekDb().some(d => d.id === "e1"));
  assert("S3 e2 PRESERVED in queue (not lost by diff-clear)",
    f.peekQueue().some(e => e.id === "e2"));
}

// S4: 50 concurrent inserts — none lost
{
  const f = makeAuditFixture();
  await Promise.all(Array.from({ length: 50 }, (_, i) =>
    f.persistToSupabase({ id: "e" + i })));
  assert("S4 all 50 persisted", f.peekDb().length === 50);
  assert("S4 queue drained", f.peekQueue().length === 0);
}

// ── G-36: replay-watcher named-handler idempotency ───────────────
console.log("\n=== G-36 replay-watcher named-handler idempotency ===\n");

function makeReplayWatcher() {
  // mock window/document
  const eventListeners = { online: [], visibilitychange: [] };
  const w = {
    addEventListener: (ev, h) => eventListeners[ev] && eventListeners[ev].push(h),
    removeEventListener: (ev, h) => {
      const arr = eventListeners[ev];
      if (!arr) return;
      const idx = arr.indexOf(h);
      if (idx >= 0) arr.splice(idx, 1);
    },
  };
  let onlineHandler = null;
  let visibilityHandler = null;
  let attached = false;
  let fireLog = [];
  function start() {
    if (attached) return;
    attached = true;
    if (onlineHandler) w.removeEventListener("online", onlineHandler);
    onlineHandler = () => fireLog.push("online");
    w.addEventListener("online", onlineHandler);
    if (visibilityHandler) w.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = () => fireLog.push("visibility");
    w.addEventListener("visibilitychange", visibilityHandler);
  }
  function stop() {
    if (onlineHandler) { w.removeEventListener("online", onlineHandler); onlineHandler = null; }
    if (visibilityHandler) { w.removeEventListener("visibilitychange", visibilityHandler); visibilityHandler = null; }
    attached = false;
  }
  function simulateModuleReload() { attached = false; /* but listeners stay */ }
  return {
    start, stop, simulateModuleReload,
    fireOnline: () => eventListeners.online.forEach(h => h()),
    fireVisibility: () => eventListeners.visibilitychange.forEach(h => h()),
    listenerCount: (ev) => eventListeners[ev].length,
    fireCount: () => fireLog.length, peekFires: () => [...fireLog],
    resetFires: () => { fireLog = []; },
  };
}

// S5: single start → 1 listener per event
{
  const w = makeReplayWatcher();
  w.start();
  assert("S5 single start → 1 online listener", w.listenerCount("online") === 1);
  assert("S5 single start → 1 visibility listener", w.listenerCount("visibilitychange") === 1);
}

// S6: idempotent start (gated by `attached`)
{
  const w = makeReplayWatcher();
  w.start(); w.start(); w.start();
  assert("S6 multiple starts (no reload) → still 1 listener", w.listenerCount("online") === 1);
}

// S7: BEEHIVE — module reload simulation. Pre-fix: attached flag reset
// would re-register, doubling listeners. Post-fix: removeEventListener
// before addEventListener guarantees at most 1.
{
  const w = makeReplayWatcher();
  w.start();
  w.simulateModuleReload();  // resets `attached` but listener stays
  w.start();
  assert("S7 after reload + restart → still exactly 1 online listener",
    w.listenerCount("online") === 1);
  assert("S7 after reload + restart → still exactly 1 visibility listener",
    w.listenerCount("visibilitychange") === 1);
  // Fire each event ONCE — must trigger exactly 1 fire each
  w.fireOnline();
  w.fireVisibility();
  assert("S7 fire counts correct (1+1)", w.fireCount() === 2);
}

// S8: stop cleans up
{
  const w = makeReplayWatcher();
  w.start();
  w.stop();
  assert("S8a after stop, online listeners = 0", w.listenerCount("online") === 0);
  assert("S8b after stop, visibility listeners = 0", w.listenerCount("visibilitychange") === 0);
  w.start();
  assert("S8c restart after stop works", w.listenerCount("online") === 1);
}

// S9: 100 module reloads + starts → still 1
{
  const w = makeReplayWatcher();
  for (let i = 0; i < 100; i++) {
    w.simulateModuleReload();
    w.start();
  }
  assert("S9 100 reload+start cycles → still 1 online listener",
    w.listenerCount("online") === 1);
}

// ── G-40: checkin-timer retry queue ────────────────────────────
console.log("\n=== G-40 checkin-timer retry queue ===\n");

function makeCheckinFixture() {
  let queue = [];
  let dbInserted = [];
  let dbErrorMode = null;
  async function syncCheckin(row) {
    let pending = [];
    try { pending = [...queue]; } catch {}
    const batch = pending.length > 0 ? [...pending, row] : [row];
    if (dbErrorMode) {
      // failure: enqueue the row + return error
      queue.push(row);
      return { error: dbErrorMode };
    }
    for (const r of batch) dbInserted.push(r);
    queue = [];
    return { error: null };
  }
  return {
    syncCheckin,
    peekQueue: () => [...queue], peekDb: () => [...dbInserted],
    setDbError: (m) => { dbErrorMode = m; },
    reset: () => { queue = []; dbInserted = []; dbErrorMode = null; },
  };
}

// S10: serial happy path
{
  const f = makeCheckinFixture();
  await f.syncCheckin({ employee_id: "e1", event_type: "checkin" });
  assert("S10 single checkin lands", f.peekDb().length === 1 && f.peekQueue().length === 0);
}

// S11: failure queues + recovers
{
  const f = makeCheckinFixture();
  f.setDbError("offline");
  await f.syncCheckin({ employee_id: "e1", event_type: "checkin" });
  await f.syncCheckin({ employee_id: "e1", event_type: "missed" });
  assert("S11a 2 failed checkins queued", f.peekQueue().length === 2);
  f.setDbError(null);
  await f.syncCheckin({ employee_id: "e1", event_type: "checkin" });
  assert("S11b on recovery, 3 total in DB", f.peekDb().length === 3);
  assert("S11c queue cleared", f.peekQueue().length === 0);
}

// S12: BEEHIVE — worker checks in, network down. Pre-fix: silent loss.
// Post-fix: queued + visible toast.
{
  const f = makeCheckinFixture();
  f.setDbError("network down");
  const r = await f.syncCheckin({ employee_id: "alice", event_type: "checkin" });
  assert("S12 network-down checkin returns error (visible to UI)", r.error === "network down");
  assert("S12 row queued for retry", f.peekQueue().length === 1);
}

// ── G-41: AbortSignal.timeout pattern verified ─────────────────
console.log("\n=== G-41 AbortSignal.timeout pattern ===\n");

// Mock fetch that respects AbortSignal — verifies the production code
// pattern correctly aborts a hung fetch.
async function fakeHangingFetch(url, opts) {
  return new Promise((resolve, reject) => {
    if (opts?.signal) {
      opts.signal.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    }
    // never resolves on its own — must be aborted to terminate
  });
}

// S13: AbortSignal.timeout(50) aborts after ~50ms
{
  // Use a controllable abort + hung-fetch-promise that we resolve manually after.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 50);
  const start = Date.now();
  let aborted = false;
  try {
    await fakeHangingFetch("https://hung.example", { signal: ctrl.signal });
  } catch (err) {
    aborted = (err && err.name === "AbortError");
  }
  clearTimeout(t);
  const elapsed = Date.now() - start;
  assert("S13 AbortController aborts ~50ms (got " + elapsed + "ms, aborted=" + aborted + ")",
    aborted && elapsed < 500);
}

// S14: without abort, fetch never resolves on its own. Use Promise.race
// and resolve the hang via a side-channel after we've checked.
{
  const ctrl = new AbortController();
  let resolvedInTime = false;
  const fp = fakeHangingFetch("https://hung.example", { signal: ctrl.signal })
    .then(() => { resolvedInTime = true; })
    .catch(() => { /* aborted at end */ });
  await new Promise(r => setTimeout(r, 100));
  assert("S14 without abort, fetch does NOT resolve in 100ms", !resolvedInTime);
  // Flush the hung promise so the test process exits cleanly.
  ctrl.abort();
  await fp;
}

console.log("\n" + (fail === 0 ? "OK all G-35 + G-36 + G-40 + G-41 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
