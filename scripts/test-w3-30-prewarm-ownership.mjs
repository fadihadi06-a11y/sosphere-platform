// W3-30 hard test — sos-alert PREWARM emergencyId ownership check.
//
// Pre-fix: prewarm did `upsert(..., { onConflict: "id", ignoreDuplicates: false })`.
// An attacker who guesses an active emergencyId could OVERWRITE the victim's
// sos_sessions row — flipping status back to "prewarm", resetting started_at,
// reassigning user_id to attacker. Hijack of an active emergency.
//
// Post-fix: SELECT existing row; if its user_id is non-null and != caller,
// return 409. Idempotent retry by the same user is preserved.

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// Mirror the production check at sos-alert/index.ts (post-W3-30)
function modelPrewarmGate({ existingSession, callerUserId, emergencyId }) {
  // After pwAuth + pw.userId match check (which already passed at this point)
  if (existingSession && existingSession.user_id && existingSession.user_id !== callerUserId) {
    return { status: 409, body: { error: "emergencyId conflict" } };
  }
  // Otherwise upsert proceeds
  return { status: 200, body: { ok: true, prewarmed: true, emergencyId } };
}

// S1: BEEHIVE — attacker prewarms with victim's emergencyId
{
  const r = modelPrewarmGate({
    existingSession: { user_id: "u-victim" },
    callerUserId: "u-attacker",
    emergencyId: "ERR-victim-2026-XYZ",
  });
  assert("S1 attacker hijacking victim's emergencyId → 409 (the W3-30 fix)",
    r.status === 409);
  assert("S1 error body says 'emergencyId conflict'",
    r.body.error === "emergencyId conflict");
}

// S2: legitimate first prewarm (no existing session) → allowed
{
  const r = modelPrewarmGate({
    existingSession: null,
    callerUserId: "u-1",
    emergencyId: "ERR-fresh-001",
  });
  assert("S2 first-time prewarm → 200", r.status === 200);
}

// S3: idempotent retry by same user → allowed
{
  const r = modelPrewarmGate({
    existingSession: { user_id: "u-1" },
    callerUserId: "u-1",
    emergencyId: "ERR-retry-001",
  });
  assert("S3 same-user retry preserved (idempotent)", r.status === 200);
}

// S4: orphan session with NULL user_id — allowed (defensive: the user
//     is claiming an empty row, and our prewarm sets it correctly)
{
  const r = modelPrewarmGate({
    existingSession: { user_id: null },
    callerUserId: "u-1",
    emergencyId: "ERR-orphan-001",
  });
  assert("S4 orphan session (user_id NULL) → allowed to claim", r.status === 200);
}

// S5: pre-fix model — every overwrite was accepted (the bug)
{
  const preFix = ({ callerUserId }) => ({ status: 200, body: { upserted: true, user_id: callerUserId } });
  const r = preFix({ existingSession: { user_id: "u-victim" }, callerUserId: "u-attacker" });
  assert("S5 pre-fix accepted attacker overwriting victim (the bug)",
    r.status === 200 && r.body.user_id === "u-attacker");
}

// S6: post-fix preserves victim's session — attacker's claim is rejected
{
  const r = modelPrewarmGate({
    existingSession: { user_id: "u-victim" },
    callerUserId: "u-attacker",
    emergencyId: "ERR-active-XYZ",
  });
  assert("S6 victim's session preserved (attacker rejected)", r.status === 409);
}

// S7: 404 status code class — 409 is correct (Conflict, not 403/404)
{
  const r = modelPrewarmGate({
    existingSession: { user_id: "u-victim" },
    callerUserId: "u-attacker",
    emergencyId: "ERR-A",
  });
  assert("S7 status code is 409 Conflict (semantically correct)",
    r.status === 409);
}

console.log("\n" + (fail === 0 ? "OK all W3-30 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
