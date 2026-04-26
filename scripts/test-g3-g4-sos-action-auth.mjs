// Synthetic test for G-3 + G-4 (B-20): sos-alert action auth.
// Inline copies of the helper logic — kept in sync with source.

async function authenticate(req, supabase) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: null, error: "Missing Bearer token" };
  }
  const jwt = authHeader.replace("Bearer ", "");
  try {
    const { data: { user }, error } = await supabase.auth.getUser(jwt);
    if (error || !user) return { userId: null, error: error?.message || "Invalid token" };
    return { userId: user.id };
  } catch {
    return { userId: null, error: "Auth check failed" };
  }
}

async function authenticateBodyOrHeader(req, supabase, bodyToken) {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const jwt = authHeader.replace("Bearer ", "");
    try {
      const { data: { user }, error } = await supabase.auth.getUser(jwt);
      if (!error && user) return { userId: user.id };
    } catch {}
  }
  if (typeof bodyToken === "string" && bodyToken.length > 20) {
    try {
      const { data: { user }, error } = await supabase.auth.getUser(bodyToken);
      if (!error && user) return { userId: user.id };
    } catch {}
  }
  return { userId: null, error: "No valid token in header or body" };
}

// ── Mock Supabase auth that returns a user when token starts with "good-" ──
const mockSupabase = {
  auth: {
    async getUser(token) {
      if (typeof token !== "string" || !token.startsWith("good-")) {
        return { data: { user: null }, error: { message: "Invalid token" } };
      }
      return { data: { user: { id: token.replace("good-", "u-") } }, error: null };
    },
  },
};

// Build a minimal Request stand-in (just `headers.get`)
function makeReq(headers = {}) {
  return {
    headers: {
      get: (k) => headers[k.toLowerCase()] ?? headers[k] ?? null,
    },
  };
}

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
}

console.log("\n=== G-3 / G-4 sos-alert action auth scenarios ===\n");

// ── authenticate() — header path ────────────────────────────────────
{
  const r = await authenticate(makeReq({ Authorization: "Bearer good-alice123" }), mockSupabase);
  assert("S1 valid Bearer token → userId resolved", r.userId === "u-alice123");
}
{
  const r = await authenticate(makeReq({}), mockSupabase);
  assert("S2 missing Authorization → reject with error", !r.userId && r.error === "Missing Bearer token");
}
{
  const r = await authenticate(makeReq({ Authorization: "Bearer bad-token" }), mockSupabase);
  assert("S3 invalid Bearer token → reject", !r.userId);
}
{
  const r = await authenticate(makeReq({ Authorization: "Basic abc" }), mockSupabase);
  assert("S4 wrong scheme (Basic instead of Bearer) → reject", !r.userId);
}

// ── authenticateBodyOrHeader() — both paths ─────────────────────────
{
  const r = await authenticateBodyOrHeader(
    makeReq({ Authorization: "Bearer good-alice" }), mockSupabase, undefined,
  );
  assert("S5 header-only token → userId resolved", r.userId === "u-alice");
}
{
  const r = await authenticateBodyOrHeader(makeReq({}), mockSupabase, "good-bob-with-long-token-string");
  assert("S6 body-only token (sendBeacon path) → userId resolved", r.userId === "u-bob-with-long-token-string");
}
{
  // Both present — header wins
  const r = await authenticateBodyOrHeader(
    makeReq({ Authorization: "Bearer good-alice" }), mockSupabase, "good-bob-with-long-token-string",
  );
  assert("S7 both paths present → header wins", r.userId === "u-alice");
}
{
  const r = await authenticateBodyOrHeader(makeReq({}), mockSupabase, undefined);
  assert("S8 neither path present → reject", !r.userId);
}
{
  const r = await authenticateBodyOrHeader(makeReq({}), mockSupabase, "short");
  assert("S9 body token too short (<20 chars) → reject", !r.userId);
}
{
  const r = await authenticateBodyOrHeader(makeReq({}), mockSupabase, "bad-this-is-a-fake-token-of-length");
  assert("S10 body token invalid → reject", !r.userId);
}
{
  // Header invalid, body valid — falls through to body
  const r = await authenticateBodyOrHeader(
    makeReq({ Authorization: "Bearer bad-token" }), mockSupabase, "good-fallback-token-value-here",
  );
  assert("S11 header invalid → falls through to body", r.userId === "u-fallback-token-value-here");
}

// ── Ownership-check semantics (the meat of the fix) ─────────────────
// Simulate the action handlers' new logic: authenticate, then look up
// session.user_id, then compare. The test below verifies the BUSINESS
// logic; the actual SQL query is faked.
async function actionWithOwnership(req, body, sessions, allowAdmin = false, memberships = []) {
  const auth = await authenticate(req, mockSupabase);
  if (!auth.userId) return { status: 401 };
  const session = sessions.find((s) => s.id === body.emergencyId);
  if (!session) return { status: 404 };
  let allowed = session.user_id === auth.userId;
  if (!allowed && allowAdmin && session.company_id) {
    const m = memberships.find((m) => m.company_id === session.company_id && m.user_id === auth.userId);
    if (m && ["admin","owner"].includes(m.role)) allowed = true;
  }
  if (!allowed) return { status: 403 };
  return { status: 200, userId: auth.userId };
}

const sessions = [
  { id: "EID-1", user_id: "u-alice", company_id: null },
  { id: "EID-2", user_id: "u-alice", company_id: "co-1" },
];
const memberships = [
  { company_id: "co-1", user_id: "u-bob",   role: "admin",  active: true },
  { company_id: "co-1", user_id: "u-carol", role: "employee", active: true },
];

// Heartbeat-like (no admin override)
{
  const r = await actionWithOwnership(
    makeReq({ Authorization: "Bearer good-alice" }), { emergencyId: "EID-1" }, sessions, false,
  );
  assert("S12 owner heartbeat OWN session → 200", r.status === 200);
}
{
  const r = await actionWithOwnership(
    makeReq({ Authorization: "Bearer good-eve" }), { emergencyId: "EID-1" }, sessions, false,
  );
  assert("S13 stranger heartbeat someone else → 403", r.status === 403);
}
{
  const r = await actionWithOwnership(
    makeReq({}), { emergencyId: "EID-1" }, sessions, false,
  );
  assert("S14 anon heartbeat → 401", r.status === 401);
}
{
  const r = await actionWithOwnership(
    makeReq({ Authorization: "Bearer good-alice" }), { emergencyId: "EID-NOPE" }, sessions, false,
  );
  assert("S15 heartbeat for nonexistent emergencyId → 404", r.status === 404);
}

// End/Escalate-like (admin override allowed for company sessions)
{
  // Bob is admin of co-1, the company that owns Alice's company-scoped SOS.
  const r = await actionWithOwnership(
    makeReq({ Authorization: "Bearer good-bob" }), { emergencyId: "EID-2" }, sessions, true, memberships,
  );
  assert("S16 company admin can end company-scoped SOS → 200", r.status === 200);
}
{
  // Carol is employee, NOT admin/owner.
  const r = await actionWithOwnership(
    makeReq({ Authorization: "Bearer good-carol" }), { emergencyId: "EID-2" }, sessions, true, memberships,
  );
  assert("S17 company employee CANNOT end someone else's SOS → 403", r.status === 403);
}
{
  // Bob is admin of co-1, but EID-1 has NO company_id — admin override does not apply.
  const r = await actionWithOwnership(
    makeReq({ Authorization: "Bearer good-bob" }), { emergencyId: "EID-1" }, sessions, true, memberships,
  );
  assert("S18 company admin CANNOT end personal (non-company) SOS → 403", r.status === 403);
}

console.log(`\n${fail === 0 ? "✅ all G-3 / G-4 scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
