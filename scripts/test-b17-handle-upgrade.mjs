// Synthetic test for B-17 handleUpgrade flow. We extract the
// decision tree from subscription-plans.tsx into a pure
// reducer-style function and exercise every branch.
//
// What we are NOT testing here: the React-state side effects.
// What we ARE testing: every observable contract handleUpgrade has
// with (a) Supabase config, (b) Stripe edge function shape, (c) the
// final redirect / error state machine. These are the cases that
// would silently corrupt billing state if regressed.

async function attemptUpgrade(deps, billing) {
  // deps mirrors the closures used inside subscription-plans.tsx.
  if (deps.alreadyUpgrading) {
    return { state: "noop_already_upgrading" };
  }
  if (!deps.supabaseConfigured) {
    return { state: "error", error: "Payments are not configured in this build. Please try again from a release build." };
  }
  let session;
  try {
    session = await deps.getSession();
  } catch (e) {
    return { state: "error", error: e?.message ?? "Unexpected error" };
  }
  if (!session?.user) {
    return { state: "error", error: "Please sign in before upgrading." };
  }
  const cycle = billing === "yearly" ? "annual" : "monthly";
  let resp;
  try {
    resp = await deps.invokeCheckout({
      planId: "elite",
      cycle,
      successUrl: deps.origin + "/billing?ok=1",
      cancelUrl:  deps.origin + "/billing?cancelled=1",
    });
  } catch (e) {
    return { state: "error", error: e?.message ?? "Unexpected error" };
  }
  if (resp.error) {
    return { state: "error", error: `Could not start checkout: ${resp.error.message ?? "unknown error"}` };
  }
  const url = resp.data?.url;
  if (!url) {
    return { state: "error", error: "Checkout URL missing from server response." };
  }
  return { state: "redirect", url, cycle };
}

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
}

console.log("\n=== B-17 handleUpgrade scenarios ===\n");

const FAKE_SESSION = { user: { id: "user-123", email: "x@y.z" } };
const okOrigin = "https://app.sosphere.io";

// S1: happy path monthly
{
  const r = await attemptUpgrade({
    supabaseConfigured: true,
    getSession: async () => FAKE_SESSION,
    invokeCheckout: async (body) => {
      assert("S1.body planId=elite", body.planId === "elite");
      assert("S1.body cycle=monthly", body.cycle === "monthly");
      assert("S1.body successUrl ok=1", body.successUrl === okOrigin + "/billing?ok=1");
      return { data: { url: "https://checkout.stripe.com/c/cs_test_abc" }, error: null };
    },
    origin: okOrigin,
  }, "monthly");
  assert("S1 redirect emitted", r.state === "redirect" && r.url.startsWith("https://checkout.stripe.com/"));
}

// S2: happy path yearly → cycle=annual
{
  const r = await attemptUpgrade({
    supabaseConfigured: true,
    getSession: async () => FAKE_SESSION,
    invokeCheckout: async (body) => {
      return { data: { url: "https://checkout.stripe.com/c/cs_test_xyz" }, error: null };
    },
    origin: okOrigin,
  }, "yearly");
  assert("S2 yearly cycle mapped to 'annual'", r.cycle === "annual");
}

// S3: supabase not configured (dev/CI build)
{
  const r = await attemptUpgrade({
    supabaseConfigured: false,
    getSession: async () => FAKE_SESSION,
    invokeCheckout: async () => { throw new Error("should not be called"); },
    origin: okOrigin,
  }, "monthly");
  assert("S3 unconfigured → friendly error",
    r.state === "error" && /not configured/i.test(r.error));
}

// S4: no session → ask user to sign in (no Stripe call)
{
  let invoked = false;
  const r = await attemptUpgrade({
    supabaseConfigured: true,
    getSession: async () => null,
    invokeCheckout: async () => { invoked = true; return { data: null, error: null }; },
    origin: okOrigin,
  }, "monthly");
  assert("S4 no session → sign-in prompt + no checkout call",
    r.state === "error" && /sign in/i.test(r.error) && invoked === false);
}

// S5: stripe-checkout returns error (rate limit, env missing, etc.)
{
  const r = await attemptUpgrade({
    supabaseConfigured: true,
    getSession: async () => FAKE_SESSION,
    invokeCheckout: async () => ({ data: null, error: { message: "edge function timeout" } }),
    origin: okOrigin,
  }, "monthly");
  assert("S5 edge-fn error → user-readable error",
    r.state === "error" && /edge function timeout/.test(r.error));
}

// S6: stripe-checkout returns 200 but no url (server bug / unmapped plan)
{
  const r = await attemptUpgrade({
    supabaseConfigured: true,
    getSession: async () => FAKE_SESSION,
    invokeCheckout: async () => ({ data: {}, error: null }),
    origin: okOrigin,
  }, "monthly");
  assert("S6 200 + no url → 'Checkout URL missing' error",
    r.state === "error" && /URL missing/i.test(r.error));
}

// S7: invokeCheckout throws (network down)
{
  const r = await attemptUpgrade({
    supabaseConfigured: true,
    getSession: async () => FAKE_SESSION,
    invokeCheckout: async () => { throw new Error("Failed to fetch"); },
    origin: okOrigin,
  }, "monthly");
  assert("S7 network down → readable error",
    r.state === "error" && /Failed to fetch/.test(r.error));
}

// S8: getSession throws (auth client crashed)
{
  const r = await attemptUpgrade({
    supabaseConfigured: true,
    getSession: async () => { throw new Error("auth client undefined"); },
    invokeCheckout: async () => ({ data: { url: "should-not-reach" }, error: null }),
    origin: okOrigin,
  }, "monthly");
  assert("S8 getSession throws → error short-circuit",
    r.state === "error" && /auth client undefined/.test(r.error));
}

// S9: re-entrancy (button mashing) → second call is a no-op
{
  const r = await attemptUpgrade({
    alreadyUpgrading: true,
    supabaseConfigured: true,
    getSession: async () => FAKE_SESSION,
    invokeCheckout: async () => { throw new Error("should not be called"); },
    origin: okOrigin,
  }, "monthly");
  assert("S9 already upgrading → noop", r.state === "noop_already_upgrading");
}

// S10: BEEHIVE — successUrl/cancelUrl pass through to webhook handlers correctly
{
  let captured;
  await attemptUpgrade({
    supabaseConfigured: true,
    getSession: async () => FAKE_SESSION,
    invokeCheckout: async (body) => { captured = body; return { data: { url: "https://x" }, error: null }; },
    origin: "https://staging.sosphere.io",
  }, "yearly");
  assert("S10 cancelUrl includes cancelled=1",
    captured?.cancelUrl === "https://staging.sosphere.io/billing?cancelled=1");
  assert("S10 successUrl is on the same origin (origin pinning)",
    captured?.successUrl?.startsWith("https://staging.sosphere.io"));
}

// S11: planId is HARD-CODED to "elite" — no client tampering possible in
// this code path (the user picks billing only; tier selection is server-controlled
// for civilian app, single SKU)
{
  let captured;
  await attemptUpgrade({
    supabaseConfigured: true,
    getSession: async () => FAKE_SESSION,
    invokeCheckout: async (body) => { captured = body; return { data: { url: "https://x" }, error: null }; },
    origin: okOrigin,
  }, "monthly");
  assert("S11 planId is hardcoded to 'elite' (no tampering surface)",
    captured?.planId === "elite");
}

// S12: redirect url is what we hand off — no rewriting / appended params
{
  const r = await attemptUpgrade({
    supabaseConfigured: true,
    getSession: async () => FAKE_SESSION,
    invokeCheckout: async () => ({ data: { url: "https://checkout.stripe.com/c/cs_live_abc?session_id=foo" }, error: null }),
    origin: okOrigin,
  }, "monthly");
  assert("S12 final url passes through unmodified",
    r.url === "https://checkout.stripe.com/c/cs_live_abc?session_id=foo");
}

console.log(`\n${fail === 0 ? "✅ all scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
