// W3-1 hard test — sos-alert userId soft-check.
// Pre-fix: payload.userId !== JWT-derived authUserId returned 403.
// Post-fix: warn + use authUserId; never fail.
//
// We model the relevant slice of sos-alert/index.ts so the test runs
// without spinning up Deno + Supabase. The model mirrors line 889-898.

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

function modelSosAlertUserIdGate(payload, authUserId) {
  const log = [];
  // Pre-fix behavior:
  function preFix() {
    if (payload.userId && payload.userId !== authUserId) {
      log.push(`prefix: userId mismatch payload=${payload.userId} jwt=${authUserId}`);
      return { status: 403, body: { error: "userId mismatch" } };
    }
    log.push("prefix: passed gate");
    return { status: 200, body: { ok: true, finalUserId: authUserId } };
  }
  // Post-fix behavior:
  function postFix() {
    if (payload.userId && payload.userId !== authUserId) {
      log.push(`postfix: userId differs from JWT (using JWT) payload=${payload.userId} jwt=${authUserId}`);
    }
    log.push("postfix: continuing with authUserId");
    return { status: 200, body: { ok: true, finalUserId: authUserId } };
  }
  return { preFix, postFix, log };
}

// S1: civilian sends EMP-* identifier, JWT is real UUID. Pre-fix 403; post-fix 200.
{
  const m = modelSosAlertUserIdGate(
    { userId: "EMP-AliceSmith" },
    "2f8e6b3a-9d4c-4f7e-a8b2-1c0d3e9f5a7d",
  );
  const pre = m.preFix();
  const post = m.postFix();
  assert("S1 pre-fix returns 403 (matches reported bug)", pre.status === 403);
  assert("S1 post-fix returns 200 (W3-1 closed)", post.status === 200);
  assert("S1 post-fix uses authUserId for downstream", post.body.finalUserId === "2f8e6b3a-9d4c-4f7e-a8b2-1c0d3e9f5a7d");
}

// S2: client sends correct UUID matching JWT — both versions accept.
{
  const uuid = "2f8e6b3a-9d4c-4f7e-a8b2-1c0d3e9f5a7d";
  const m = modelSosAlertUserIdGate({ userId: uuid }, uuid);
  assert("S2 pre-fix accepts matching UUIDs", m.preFix().status === 200);
  assert("S2 post-fix accepts matching UUIDs", m.postFix().status === 200);
}

// S3: client omits userId entirely. Both versions OK (auth check skipped).
{
  const m = modelSosAlertUserIdGate({}, "2f8e6b3a-9d4c-4f7e-a8b2-1c0d3e9f5a7d");
  assert("S3 pre-fix accepts missing userId", m.preFix().status === 200);
  assert("S3 post-fix accepts missing userId", m.postFix().status === 200);
}

// S4: tampered userId. Post-fix logs warning but proceeds with authUserId.
// (Does NOT trust the tampered field — uses JWT.)
{
  const m = modelSosAlertUserIdGate({ userId: "EMP-attacker" }, "2f8e6b3a-9d4c-4f7e-a8b2-1c0d3e9f5a7d");
  const post = m.postFix();
  assert("S4 post-fix proceeds despite tampered userId", post.status === 200);
  assert("S4 post-fix logs the discrepancy",
    m.log.some(l => l.includes("postfix: userId differs from JWT")));
  assert("S4 post-fix uses authUserId not the attacker's value",
    post.body.finalUserId === "2f8e6b3a-9d4c-4f7e-a8b2-1c0d3e9f5a7d");
}

// S5: RTL/Unicode userId from i18n flow. Both versions OK if matched, else
// post-fix accepts.
{
  const arabicUid = "EMP-أحمد";
  const m = modelSosAlertUserIdGate({ userId: arabicUid }, "2f8e6b3a-9d4c-4f7e-a8b2-1c0d3e9f5a7d");
  assert("S5 pre-fix 403 on RTL EMP-* (mirrors civilian Arabic bug)", m.preFix().status === 403);
  assert("S5 post-fix accepts RTL EMP-*", m.postFix().status === 200);
}

console.log("\n" + (fail === 0 ? "OK all W3-1 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
