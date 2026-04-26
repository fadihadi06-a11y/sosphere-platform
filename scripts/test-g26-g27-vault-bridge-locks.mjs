// Synthetic test for G-26 (evidence-vault TOCTOU) + G-27 (sos-bridge dup
// dial). Inline copies of the lock primitives — kept in sync with source.

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

console.log("\n=== G-26 evidence-vault write-lock scenarios ===\n");

function makeMutateVaults() {
  let lock = Promise.resolve();
  let store = [];
  const load = () => [...store];
  const save = (arr) => { store = [...arr]; };
  async function mutate(fn) {
    let nextOut = [];
    lock = lock.then(async () => {
      const current = load();
      const next = await fn(current);
      save(next);
      nextOut = next;
    }).catch((err) => {
      console.error("[test mutate] inner error:", err && err.message);
    });
    await lock;
    return nextOut;
  }
  return { mutate, peek: () => [...store], reset: () => { store = []; lock = Promise.resolve(); } };
}

// S1: serial calls preserve all entries
{
  const { mutate, peek, reset } = makeMutateVaults();
  reset();
  await mutate(c => [...c, "a"]);
  await mutate(c => [...c, "b"]);
  await mutate(c => [...c, "c"]);
  assert("S1 serial 3 mutations preserved", peek().length === 3);
}

// S2: CONCURRENT three pushes
{
  const { mutate, peek, reset } = makeMutateVaults();
  reset();
  await Promise.all([
    mutate(c => [...c, "x"]),
    mutate(c => [...c, "y"]),
    mutate(c => [...c, "z"]),
  ]);
  assert("S2 concurrent 3 preserved (got " + peek().length + ")", peek().length === 3);
  assert("S2 entries unique", new Set(peek()).size === 3);
}

// S3: 50 simultaneous mutations
{
  const { mutate, peek, reset } = makeMutateVaults();
  reset();
  await Promise.all(Array.from({ length: 50 }, (_, i) => mutate(c => [...c, i])));
  assert("S3 50 concurrent preserved (got " + peek().length + ")", peek().length === 50);
  assert("S3 all unique values", new Set(peek()).size === 50);
}

// S4: error in one mutation does not poison the chain
{
  const { mutate, peek, reset } = makeMutateVaults();
  reset();
  await mutate(c => [...c, "good1"]);
  await mutate(async () => { throw new Error("boom"); });
  await mutate(c => [...c, "good2"]);
  assert("S4 chain survives error",
    peek().length === 2 && peek().includes("good1") && peek().includes("good2"));
}

// S5: RMW race (the actual G-26 scenario)
{
  const { mutate, peek, reset } = makeMutateVaults();
  reset();
  await Promise.all([
    mutate(c => [...c, { vaultId: "V1" }]),
    mutate(c => [...c, { vaultId: "V2" }]),
    mutate(c => [...c, { vaultId: "V3" }]),
  ]);
  assert("S5 RMW race: 3 vaults captured (got " + peek().length + ")", peek().length === 3);
  const ids = new Set(peek().map(v => v.vaultId));
  assert("S5 V1+V2+V3 all present", ids.has("V1") && ids.has("V2") && ids.has("V3"));
}

// S6: lock held across awaits inside fn
{
  const { mutate, peek, reset } = makeMutateVaults();
  reset();
  let interleaved = false;
  let inFlight = 0;
  await Promise.all([
    mutate(async c => {
      inFlight++;
      if (inFlight > 1) interleaved = true;
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
      return [...c, "A"];
    }),
    mutate(async c => {
      inFlight++;
      if (inFlight > 1) interleaved = true;
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
      return [...c, "B"];
    }),
  ]);
  assert("S6 mutations never interleave", !interleaved);
  assert("S6 both mutations applied", peek().length === 2);
}

console.log("\n=== G-27 bridge-dial atomic claim scenarios ===\n");

function makeBridgeDialFixture() {
  const sessions = new Map();
  const ensure = (id) => { if (!sessions.has(id)) sessions.set(id, { bridge_dialed_at: null }); };
  async function claimBridgeDial(id) {
    ensure(id);
    const row = sessions.get(id);
    if (row.bridge_dialed_at !== null) return false;
    row.bridge_dialed_at = new Date().toISOString();
    return true;
  }
  return { claimBridgeDial, reset: () => sessions.clear(), peek: id => sessions.get(id) };
}

// S7: first call wins
{
  const { claimBridgeDial, reset } = makeBridgeDialFixture();
  reset();
  assert("S7 first call wins", await claimBridgeDial("E1") === true);
}

// S8: retry loses
{
  const { claimBridgeDial, reset } = makeBridgeDialFixture();
  reset();
  await claimBridgeDial("E1");
  assert("S8 retry call loses", await claimBridgeDial("E1") === false);
}

// S9: different ids independent
{
  const { claimBridgeDial, reset } = makeBridgeDialFixture();
  reset();
  assert("S9a E1 wins", await claimBridgeDial("E1") === true);
  assert("S9b E2 wins independently", await claimBridgeDial("E2") === true);
  assert("S9c E1 retry loses", await claimBridgeDial("E1") === false);
  assert("S9d E2 retry loses", await claimBridgeDial("E2") === false);
}

// S10: BEEHIVE — 5 simultaneous Twilio retries
{
  const { claimBridgeDial, reset } = makeBridgeDialFixture();
  reset();
  const results = await Promise.all([
    claimBridgeDial("E1"), claimBridgeDial("E1"), claimBridgeDial("E1"),
    claimBridgeDial("E1"), claimBridgeDial("E1"),
  ]);
  const winners = results.filter(r => r === true).length;
  assert("S10 5 retries -> exactly 1 winner (got " + winners + ")", winners === 1);
  assert("S10 4 losers", results.filter(r => r === false).length === 4);
}

// S11: reset for resolution-then-replay scenario
{
  const { claimBridgeDial, reset, peek } = makeBridgeDialFixture();
  reset();
  await claimBridgeDial("E1");
  peek("E1").bridge_dialed_at = null;
  assert("S11 after reset, new claim wins", await claimBridgeDial("E1") === true);
}

// S12: 100 hostile retries
{
  const { claimBridgeDial, reset } = makeBridgeDialFixture();
  reset();
  const results = await Promise.all(Array.from({ length: 100 }, () => claimBridgeDial("E_BIG")));
  const winners = results.filter(r => r).length;
  assert("S12 100 hostile retries -> exactly 1 winner (got " + winners + ")", winners === 1);
}

console.log("\n" + (fail === 0 ? "OK all G-26 + G-27 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
