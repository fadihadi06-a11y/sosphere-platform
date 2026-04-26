// Synthetic test for B-17 fetchCivilianTier helper. Inline copy of
// the pure decision function — kept in sync with source.

const PRO_TIERS = new Set(["basic", "elite"]);
const COMPANY_TIERS = new Set(["starter", "growth", "business", "enterprise"]);

async function fetchCivilianTier(rpcFn, currentUserPlan = "free") {
  if (currentUserPlan === "employee") {
    return { plan: "employee", rawTier: "employee", reason: "server_unknown_tier" };
  }
  let resp;
  try {
    resp = await rpcFn();
  } catch {
    return { plan: "free", rawTier: "", reason: "rpc_threw" };
  }
  if (resp.error) {
    return { plan: "free", rawTier: "", reason: "rpc_error" };
  }
  if (resp.data === null || resp.data === undefined) {
    return { plan: "free", rawTier: "", reason: "rpc_no_data" };
  }
  const raw = String(resp.data).toLowerCase().trim();
  if (raw === "free" || raw === "") {
    return { plan: "free", rawTier: raw, reason: "server_free" };
  }
  if (PRO_TIERS.has(raw)) {
    return { plan: "pro", rawTier: raw, reason: "server_active_pro" };
  }
  if (COMPANY_TIERS.has(raw)) {
    return { plan: "free", rawTier: raw, reason: "server_unknown_tier" };
  }
  return { plan: "free", rawTier: raw, reason: "server_unknown_tier" };
}

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
}

console.log("\n=== B-17 fetchCivilianTier scenarios ===\n");

// S1: server returns "free" → free
{
  const r = await fetchCivilianTier(async () => ({ data: "free", error: null }));
  assert("S1 server=free → free", r.plan === "free" && r.reason === "server_free");
}

// S2: server returns "basic" → pro
{
  const r = await fetchCivilianTier(async () => ({ data: "basic", error: null }));
  assert("S2 server=basic → pro", r.plan === "pro" && r.reason === "server_active_pro");
}

// S3: server returns "elite" → pro
{
  const r = await fetchCivilianTier(async () => ({ data: "elite", error: null }));
  assert("S3 server=elite → pro", r.plan === "pro" && r.reason === "server_active_pro");
}

// S4: server returns "ELITE" (uppercase) → pro (normalised)
{
  const r = await fetchCivilianTier(async () => ({ data: "ELITE", error: null }));
  assert("S4 server=ELITE → pro (normalised)", r.plan === "pro" && r.rawTier === "elite");
}

// S5: server returns "starter" (company tier on user_id row) → free fail-soft
{
  const r = await fetchCivilianTier(async () => ({ data: "starter", error: null }));
  assert("S5 server=starter → free (company tier on civilian)",
    r.plan === "free" && r.reason === "server_unknown_tier");
}

// S6: server returns null (no row) → free
{
  const r = await fetchCivilianTier(async () => ({ data: null, error: null }));
  assert("S6 server=null → free", r.plan === "free" && r.reason === "rpc_no_data");
}

// S7: server returns undefined (rpc misshape) → free
{
  const r = await fetchCivilianTier(async () => ({ data: undefined, error: null }));
  assert("S7 server=undefined → free", r.plan === "free" && r.reason === "rpc_no_data");
}

// S8: rpc returns error → free fail-secure
{
  const r = await fetchCivilianTier(async () => ({ data: null, error: new Error("permission denied") }));
  assert("S8 rpc error → free fail-secure", r.plan === "free" && r.reason === "rpc_error");
}

// S9: rpc throws (network down) → free fail-secure
{
  const r = await fetchCivilianTier(async () => { throw new Error("ECONNREFUSED"); });
  assert("S9 rpc throws → free fail-secure", r.plan === "free" && r.reason === "rpc_threw");
}

// S10: caller is already 'employee' → never overridden by tier sync
{
  const r = await fetchCivilianTier(
    async () => ({ data: "elite", error: null }),
    "employee",
  );
  assert("S10 employee plan never demoted by sync",
    r.plan === "employee");
}

// S11: caller is already 'pro' but server says 'free' → demote to free (cancellation case)
{
  const r = await fetchCivilianTier(
    async () => ({ data: "free", error: null }),
    "pro",
  );
  assert("S11 pro→free when server says free (cancellation honored)",
    r.plan === "free" && r.reason === "server_free");
}

// S12: server returns garbage tier "premium-2030" → free fail-soft
{
  const r = await fetchCivilianTier(async () => ({ data: "premium-2030", error: null }));
  assert("S12 unknown garbage tier → free",
    r.plan === "free" && r.reason === "server_unknown_tier");
}

// S13: server returns whitespace " elite " → trimmed → pro
{
  const r = await fetchCivilianTier(async () => ({ data: " elite ", error: null }));
  assert("S13 server returns padded ' elite ' → pro (trimmed)",
    r.plan === "pro" && r.rawTier === "elite");
}

// S14: server returns "" → treated like free
{
  const r = await fetchCivilianTier(async () => ({ data: "", error: null }));
  assert("S14 server returns empty string → free",
    r.plan === "free" && r.reason === "server_free");
}

// S15: server returns numeric 0 → coerced to "0" → unknown → free
{
  const r = await fetchCivilianTier(async () => ({ data: 0, error: null }));
  assert("S15 server returns 0 → free fail-soft",
    r.plan === "free" && r.reason === "server_unknown_tier");
}

// S16: rpc returns object instead of string → coerced → unknown → free
{
  const r = await fetchCivilianTier(async () => ({ data: { tier: "elite" }, error: null }));
  assert("S16 rpc returns object → free fail-soft (no implicit unwrap)",
    r.plan === "free");
}

// S17: BEEHIVE — pre-paid local + server says elite → final pro (idempotent restore)
{
  const r = await fetchCivilianTier(
    async () => ({ data: "elite", error: null }),
    "pro",
  );
  assert("S17 pro+server=elite → pro (idempotent)",
    r.plan === "pro" && r.reason === "server_active_pro");
}

console.log(`\n${fail === 0 ? "✅ all scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
