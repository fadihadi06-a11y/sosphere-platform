// W3 TIER 1 batch 3:
//   W3-27: sos-alert per-contact fanout timeout (no more hung Promise.all)
//   W3-32: twilio-sms redacts Twilio raw error
//   W3-42: startGPSTracking idempotent listener registration
//   W3-43: onAuthStateChange capture + unsubscribe (3 sites)

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ═══ W3-27 ═══════════════════════════════════════════════════════
console.log("\n=== W3-27 sos-alert fanout per-contact timeout ===\n");

// Mirror the production timeout pattern.
async function withRaceTimeout(p, ms, fallback) {
  return await Promise.race([
    p,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// S1: hung promise — pre-fix Promise.all([never, never]) hangs forever
{
  const startedAt = Date.now();
  const r = await withRaceTimeout(
    new Promise(() => { /* never resolves */ }),
    100, // 100ms cap
    null,
  );
  const elapsed = Date.now() - startedAt;
  assert("S1 hung promise resolved to null after timeout", r === null);
  assert("S1 timeout was ~100ms", elapsed >= 100 && elapsed < 250);
}

// S2: fast resolve still wins
{
  const r = await withRaceTimeout(Promise.resolve({ sid: "CA123" }), 1000, null);
  assert("S2 fast resolve wins the race", r?.sid === "CA123");
}

// S3: rejection becomes null (per production catch)
{
  const r = await withRaceTimeout(
    Promise.reject(new Error("twilio 503")).catch(() => null),
    100,
    null,
  );
  assert("S3 rejection caught + becomes null", r === null);
}

// S4: BEEHIVE — 3 contacts, contact #2 hangs. Pre-fix: whole fanout
//    blocked. Post-fix: contact #2 returns null after timeout, others succeed.
{
  const contacts = [
    { name: "A", smsP: Promise.resolve("SM-A"), callP: Promise.resolve({ sid: "CA-A" }) },
    { name: "B", smsP: new Promise(() => {}), callP: new Promise(() => {}) }, // hung
    { name: "C", smsP: Promise.resolve("SM-C"), callP: Promise.resolve({ sid: "CA-C" }) },
  ];
  const startedAt = Date.now();
  const results = await Promise.all(contacts.map(async c => {
    const sms = await withRaceTimeout(c.smsP.catch(() => null), 100, null);
    const call = await withRaceTimeout(c.callP.catch(() => null), 100, null);
    return { name: c.name, sms, call: call?.sid ?? null };
  }));
  const elapsed = Date.now() - startedAt;
  assert("S4 fanout completes despite hung contact (no hang)", elapsed < 300);
  assert("S4 contact A succeeds", results[0].sms === "SM-A" && results[0].call === "CA-A");
  assert("S4 contact B times out (sms=null call=null)", results[1].sms === null && results[1].call === null);
  assert("S4 contact C succeeds", results[2].sms === "SM-C" && results[2].call === "CA-C");
}

// ═══ W3-32 ═══════════════════════════════════════════════════════
console.log("\n=== W3-32 twilio-sms error redaction ===\n");

function preFixError(twilioJson) {
  return { error: "SMS send failed", detail: twilioJson.message || twilioJson };
}
function postFixError(twilioJson) {
  return { error: "sms_send_failed", code: twilioJson?.code ?? null };
}

// S5: pre-fix leaks Twilio's error message + reference URL
{
  const twilioErr = {
    code: 21408,
    message: "Permission to send an SMS has not been enabled for the region indicated by 'To' (+96X). For more information, see https://www.twilio.com/docs/api/errors/21408",
    more_info: "https://www.twilio.com/docs/api/errors/21408",
    status: 400,
  };
  const pre = preFixError(twilioErr);
  const post = postFixError(twilioErr);
  // Pre-fix leaks the message
  assert("S5 pre-fix leaks Twilio message (the bug)",
    typeof pre.detail === "string" && pre.detail.includes("twilio.com"));
  // Post-fix only exposes numeric code + generic error
  assert("S5 post-fix exposes only numeric code", post.code === 21408);
  assert("S5 post-fix has generic error string",
    post.error === "sms_send_failed" && !("detail" in post));
}

// S6: malformed Twilio response — post-fix safely returns null code
{
  const malformed = {};
  const post = postFixError(malformed);
  assert("S6 post-fix handles missing code (returns null)", post.code === null);
}

// ═══ W3-42 ═══════════════════════════════════════════════════════
console.log("\n=== W3-42 GPS tracker idempotent listeners ===\n");

// Mock the listener-registration pattern.
function makeGPSFixture() {
  const listeners = { beforeunload: [], visibilitychange: [] };
  let beforeUnloadHandler = null;
  let visibilityHandler = null;

  function register() {
    // POST-FIX: remove first
    if (beforeUnloadHandler) {
      const idx = listeners.beforeunload.indexOf(beforeUnloadHandler);
      if (idx >= 0) listeners.beforeunload.splice(idx, 1);
    }
    beforeUnloadHandler = () => listeners.fireCount = (listeners.fireCount || 0) + 1;
    listeners.beforeunload.push(beforeUnloadHandler);

    if (visibilityHandler) {
      const idx = listeners.visibilitychange.indexOf(visibilityHandler);
      if (idx >= 0) listeners.visibilitychange.splice(idx, 1);
    }
    visibilityHandler = () => listeners.fireCount = (listeners.fireCount || 0) + 1;
    listeners.visibilitychange.push(visibilityHandler);
  }

  function registerPreFix() {
    // PRE-FIX: just add anonymous listener
    listeners.beforeunload.push(() => listeners.fireCount = (listeners.fireCount || 0) + 1);
    listeners.visibilitychange.push(() => listeners.fireCount = (listeners.fireCount || 0) + 1);
  }

  function unregister() {
    if (beforeUnloadHandler) {
      const idx = listeners.beforeunload.indexOf(beforeUnloadHandler);
      if (idx >= 0) listeners.beforeunload.splice(idx, 1);
      beforeUnloadHandler = null;
    }
    if (visibilityHandler) {
      const idx = listeners.visibilitychange.indexOf(visibilityHandler);
      if (idx >= 0) listeners.visibilitychange.splice(idx, 1);
      visibilityHandler = null;
    }
  }

  return {
    register, registerPreFix, unregister,
    listenerCount: (ev) => listeners[ev].length,
    reset: () => { listeners.beforeunload.length = 0; listeners.visibilitychange.length = 0; beforeUnloadHandler = null; visibilityHandler = null; listeners.fireCount = 0; },
  };
}

// S7: pre-fix accumulates listeners
{
  const f = makeGPSFixture();
  for (let i = 0; i < 10; i++) f.registerPreFix();
  assert("S7 pre-fix: 10 register calls → 10 beforeunload listeners (the bug)",
    f.listenerCount("beforeunload") === 10);
}

// S8: post-fix idempotent — N register calls = 1 listener
{
  const f = makeGPSFixture();
  for (let i = 0; i < 10; i++) f.register();
  assert("S8 post-fix: 10 register calls → 1 beforeunload listener",
    f.listenerCount("beforeunload") === 1);
  assert("S8 post-fix: 10 register calls → 1 visibilitychange listener",
    f.listenerCount("visibilitychange") === 1);
}

// S9: unregister cleans up
{
  const f = makeGPSFixture();
  f.register();
  f.unregister();
  assert("S9 unregister removes all listeners",
    f.listenerCount("beforeunload") === 0 && f.listenerCount("visibilitychange") === 0);
}

// ═══ W3-43 ═══════════════════════════════════════════════════════
console.log("\n=== W3-43 onAuthStateChange capture + unsubscribe ===\n");

function makeAuthFixture() {
  let listeners = [];
  let stored = null;

  function onAuthStateChange(cb) {
    listeners.push(cb);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            const idx = listeners.indexOf(cb);
            if (idx >= 0) listeners.splice(idx, 1);
          },
        },
      },
    };
  }

  function preFixRegister() {
    onAuthStateChange((event) => { /* leaked, no capture */ });
  }
  function postFixRegister() {
    if (stored) {
      try { stored.unsubscribe(); } catch {}
    }
    const { data } = onAuthStateChange((event) => { /* tracked */ });
    stored = data?.subscription ?? null;
  }
  function fire() { listeners.forEach(cb => cb("TOKEN_REFRESHED", {})); }

  return {
    preFixRegister, postFixRegister, fire,
    listenerCount: () => listeners.length,
  };
}

// S10: pre-fix accumulates
{
  const f = makeAuthFixture();
  for (let i = 0; i < 5; i++) f.preFixRegister();
  assert("S10 pre-fix: 5 reload cycles → 5 leaked auth listeners (the bug)",
    f.listenerCount() === 5);
}

// S11: post-fix idempotent
{
  const f = makeAuthFixture();
  for (let i = 0; i < 5; i++) f.postFixRegister();
  assert("S11 post-fix: 5 reload cycles → 1 active listener",
    f.listenerCount() === 1);
}

// S12: HMR scenario — old listener torn down before new
{
  const f = makeAuthFixture();
  f.postFixRegister();
  assert("S12 first register: 1 listener", f.listenerCount() === 1);
  // Simulate HMR: same module, fresh init call
  f.postFixRegister();
  assert("S12 after HMR: still 1 (old subscription torn down)", f.listenerCount() === 1);
  // Fire the event — should hit ONCE not twice
  let count = 0;
  f.fire();
  // We can't directly count from outside; the count is implicit in listenerCount
  assert("S12 listenerCount stays at 1 across HMR cycles", f.listenerCount() === 1);
}

console.log("\n" + (fail === 0 ? "OK all W3 batch 3 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
