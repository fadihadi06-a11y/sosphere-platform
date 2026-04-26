// Synthetic test for G-29 (B-20): stripe-webhook event dedup.
// Inline copy of the claimStripeEventOnce + handler-with-rollback logic.

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// Mock supabase: in-memory dedup table that mimics ON CONFLICT DO NOTHING
// + .insert().select().maybeSingle() shape.
function makeMockSupabase() {
  const dedupTable = new Map();        // event_id -> { event_type, processed_at }
  const subsTable = [];                // for downstream upsert calls
  let dbErrorMode = null;              // set to error string to simulate DB failure
  return {
    from(tableName) {
      const q = {
        _filters: {},
        _payload: null,
        insert(row) { this._payload = row; return this; },
        update(row) { this._payload = { __update: row }; return this; },
        upsert(row) { this._payload = { __upsert: row }; return this; },
        delete() { this._payload = { __delete: true }; return this; },
        select() { return this; },
        eq(col, val) { this._filters[col] = val; return this; },
        async maybeSingle() {
          if (dbErrorMode) return { data: null, error: { message: dbErrorMode, code: "X1" } };
          if (tableName === "processed_stripe_events" && this._payload && !this._payload.__delete && !this._payload.__update) {
            // INSERT path: emulate ON CONFLICT DO NOTHING then SELECT.
            const evt = this._payload;
            if (dedupTable.has(evt.event_id)) {
              return { data: null, error: { code: "23505", message: "unique violation" } };
            }
            dedupTable.set(evt.event_id, { event_type: evt.event_type, processed_at: Date.now() });
            return { data: { event_id: evt.event_id }, error: null };
          }
          if (tableName === "subscriptions") {
            // For dedup test we just stub
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        // For DELETE on dedup row (rollback)
        async then(resolve) {
          if (this._payload?.__delete && tableName === "processed_stripe_events") {
            dedupTable.delete(this._filters.event_id);
            resolve({ data: null, error: null });
            return;
          }
          resolve({ data: null, error: null });
        },
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
    setDbError(msg) { dbErrorMode = msg; },
    peekDedup() { return [...dedupTable.keys()]; },
    reset() { dedupTable.clear(); subsTable.length = 0; dbErrorMode = null; },
  };
}

// Inline the helper from production source.
async function claimStripeEventOnce(supabase, evtId, evtType) {
  if (!evtId || evtId === "(unknown)") return true;
  try {
    const { data, error } = await supabase
      .from("processed_stripe_events")
      .insert({ event_id: evtId, event_type: evtType })
      .select("event_id")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") return false;
      console.warn("[test] claim DB error (fail-open):", error.message);
      return true;
    }
    return !!data;
  } catch (err) {
    console.warn("[test] claim threw (fail-open):", err);
    return true;
  }
}

console.log("\n=== G-29 stripe-webhook event-id dedup scenarios ===\n");

const supabase = makeMockSupabase();

// S1: first call wins
{
  supabase.reset();
  assert("S1 first call wins claim", await claimStripeEventOnce(supabase, "evt_1", "customer.subscription.created") === true);
}

// S2: duplicate within same instance loses
{
  supabase.reset();
  await claimStripeEventOnce(supabase, "evt_1", "x");
  assert("S2 second call (duplicate) loses claim", await claimStripeEventOnce(supabase, "evt_1", "x") === false);
}

// S3: different ids are independent
{
  supabase.reset();
  assert("S3a evt_1 wins", await claimStripeEventOnce(supabase, "evt_1", "x") === true);
  assert("S3b evt_2 wins (independent)", await claimStripeEventOnce(supabase, "evt_2", "x") === true);
  assert("S3c evt_1 retry loses", await claimStripeEventOnce(supabase, "evt_1", "x") === false);
}

// S4: empty / unknown event_id always returns true (no dedup) — safer to process
{
  supabase.reset();
  assert("S4a missing event_id → true (process anyway)", await claimStripeEventOnce(supabase, "", "x") === true);
  assert("S4b literal '(unknown)' → true", await claimStripeEventOnce(supabase, "(unknown)", "x") === true);
}

// S5: DB error → fail-OPEN (we'd rather process twice than miss a real event)
{
  supabase.reset();
  supabase.setDbError("connection lost");
  assert("S5 DB error → fail-open (true)", await claimStripeEventOnce(supabase, "evt_db_err", "x") === true);
}

// S6: 100 hostile retries within ms — only one wins
{
  supabase.reset();
  const results = await Promise.all(Array.from({ length: 100 }, () => claimStripeEventOnce(supabase, "evt_storm", "customer.subscription.deleted")));
  const winners = results.filter(r => r === true).length;
  assert("S6 100 hostile retries → exactly 1 winner (got " + winners + ")", winners === 1);
}

// S7: BEEHIVE — Stripe at-least-once + retry storm + cancel
// 5 retries of subscription.deleted; only first runs the cancel update.
{
  supabase.reset();
  let cancelCount = 0;
  async function processCancelEvent(evtId) {
    const isFirstSeen = await claimStripeEventOnce(supabase, evtId, "customer.subscription.deleted");
    if (!isFirstSeen) return { ok: true, deduped: true };
    cancelCount++;
    return { ok: true, deduped: false };
  }
  const results = await Promise.all([
    processCancelEvent("evt_cancel_42"),
    processCancelEvent("evt_cancel_42"),
    processCancelEvent("evt_cancel_42"),
    processCancelEvent("evt_cancel_42"),
    processCancelEvent("evt_cancel_42"),
  ]);
  assert("S7 5 retries → cancel ran exactly once (got " + cancelCount + ")", cancelCount === 1);
  const deduped = results.filter(r => r.deduped).length;
  assert("S7 4 retries marked as deduped", deduped === 4);
}

// S8: rollback — when business logic throws an UnmappedPriceError, we
// DELETE the dedup row so Stripe's next retry can try again with a fixed env.
{
  supabase.reset();
  const evt = "evt_rollback_42";
  await claimStripeEventOnce(supabase, evt, "x");
  assert("S8a after claim, dedup contains evt", supabase.peekDedup().includes(evt));
  // Simulate the rollback path
  await supabase.from("processed_stripe_events").delete().eq("event_id", evt);
  assert("S8b after rollback, dedup does NOT contain evt", !supabase.peekDedup().includes(evt));
  // Next retry should win the claim
  assert("S8c after rollback, retry wins claim", await claimStripeEventOnce(supabase, evt, "x") === true);
}

// S9: dedup persists across event types — if Stripe somehow re-sends with
// the same id but different type (impossible, but defensive), dedup wins.
{
  supabase.reset();
  await claimStripeEventOnce(supabase, "evt_xtype", "customer.subscription.updated");
  assert("S9 same id different type still rejected",
    await claimStripeEventOnce(supabase, "evt_xtype", "customer.subscription.deleted") === false);
}

console.log("\n" + (fail === 0 ? "OK all G-29 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
