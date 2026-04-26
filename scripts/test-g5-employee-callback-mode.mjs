// Synthetic test for G-5 (B-20): twilio-call mode=employee_callback.
// Inline copy of the resolveEmployeeCallbackTarget + callerIsCompanyAdmin
// + per-mode handler logic — kept in sync with edge function source.

function normalizePhone(p) {
  if (!p) return "";
  const trimmed = String(p).trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

function makeMockAdmin(fixtures) {
  return {
    from(table) {
      let rows = [...(fixtures[table] || [])];
      const q = {
        select: () => q,
        eq: (col, val) => { rows = rows.filter(r => r[col] === val); return q; },
        in: (col, vals) => { rows = rows.filter(r => vals.includes(r[col])); return q; },
        maybeSingle: async () => ({ data: rows[0] ?? null }),
      };
      return Object.assign(q, { then: (resolve) => resolve({ data: rows }) });
    },
  };
}

async function resolveEmployeeCallbackTarget(admin, callId) {
  const { data: session } = await admin.from("sos_sessions")
    .select("user_id, company_id").eq("id", callId).maybeSingle();
  if (!session) return { companyId: null, ownerPhone: null };
  const userId = session.user_id;
  const companyId = session.company_id;
  if (!userId) return { companyId, ownerPhone: null };
  const { data: profile } = await admin.from("profiles")
    .select("phone").eq("id", userId).maybeSingle();
  let ph = normalizePhone(profile?.phone);
  if (!ph) {
    const { data: emp } = await admin.from("employees")
      .select("phone").eq("user_id", userId).maybeSingle();
    ph = normalizePhone(emp?.phone);
  }
  return { companyId, ownerPhone: ph || null };
}

async function callerIsCompanyAdmin(admin, userId, companyId) {
  const { data: m } = await admin.from("company_memberships")
    .select("role").eq("company_id", companyId).eq("user_id", userId)
    .eq("active", true).maybeSingle();
  return !!m && ["admin", "owner"].includes(m.role);
}

// End-to-end policy check (the meat of G-5)
async function authorizeEmployeeCallback(admin, callerUserId, callId, urlSuppliedTo) {
  const { companyId, ownerPhone } = await resolveEmployeeCallbackTarget(admin, callId);
  if (!companyId) return { status: 404, reason: "not_company_scoped" };
  const isAdmin = await callerIsCompanyAdmin(admin, callerUserId, companyId);
  if (!isAdmin) return { status: 403, reason: "caller_not_admin" };
  const targetNorm = normalizePhone(urlSuppliedTo);
  if (!targetNorm || !ownerPhone || targetNorm !== ownerPhone) {
    return { status: 403, reason: "to_not_owner" };
  }
  return { status: 200, dialedPhone: ownerPhone };
}

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

console.log("\n=== G-5 employee_callback mode scenarios ===\n");

// Fixtures — two companies, A and B. Alice is admin of A. Bob is employee of A.
// Carol is admin of B. Dave is the SOS owner from a civilian (no-company) emergency.
const ALICE_PHONE = "+966500000001";  // admin of co-A
const BOB_PHONE   = "+966500000002";  // employee of co-A (the SOS owner here)
const CAROL_PHONE = "+966500000003";  // admin of co-B
const DAVE_PHONE  = "+966500000004";  // civilian SOS owner

const fixtures = {
  sos_sessions: [
    // Bob's emergency in co-A
    { id: "EID-BOB",   user_id: "u-bob",   company_id: "co-A" },
    // Civilian SOS by Dave (no company)
    { id: "EID-DAVE",  user_id: "u-dave",  company_id: null },
    // Orphan emergency (no user)
    { id: "EID-ORPH",  user_id: null,      company_id: "co-A" },
  ],
  profiles: [
    { id: "u-alice", phone: ALICE_PHONE },
    { id: "u-bob",   phone: BOB_PHONE },
    { id: "u-carol", phone: CAROL_PHONE },
    { id: "u-dave",  phone: DAVE_PHONE },
    { id: "u-emp",   phone: null },  // profiles row exists but no phone
  ],
  employees: [
    // Fallback employees row for u-emp
    { user_id: "u-emp", phone: "+966500000099" },
  ],
  company_memberships: [
    { company_id: "co-A", user_id: "u-alice", role: "admin",    active: true },
    { company_id: "co-A", user_id: "u-bob",   role: "employee", active: true },
    { company_id: "co-A", user_id: "u-old",   role: "admin",    active: false },
    { company_id: "co-B", user_id: "u-carol", role: "admin",    active: true },
  ],
};
const admin = makeMockAdmin(fixtures);

// ── Resolver behaviour ──────────────────────────────────────────────
{
  const r = await resolveEmployeeCallbackTarget(admin, "EID-BOB");
  assert("S1 Bob's emergency → company=co-A, owner-phone=Bob's", r.companyId === "co-A" && r.ownerPhone === BOB_PHONE);
}
{
  const r = await resolveEmployeeCallbackTarget(admin, "EID-DAVE");
  assert("S2 civilian (no company) → companyId null", r.companyId === null);
}
{
  const r = await resolveEmployeeCallbackTarget(admin, "EID-ORPH");
  assert("S3 orphan (null user_id) → ownerPhone null", r.companyId === "co-A" && r.ownerPhone === null);
}
{
  const r = await resolveEmployeeCallbackTarget(admin, "EID-NOPE");
  assert("S4 unknown emergencyId → both null", r.companyId === null && r.ownerPhone === null);
}

// ── Caller-is-admin check ──────────────────────────────────────────
{
  assert("S5 Alice is admin of co-A", await callerIsCompanyAdmin(admin, "u-alice", "co-A") === true);
  assert("S6 Bob (employee) is NOT admin of co-A", await callerIsCompanyAdmin(admin, "u-bob", "co-A") === false);
  assert("S7 Carol is admin of co-B but NOT co-A", await callerIsCompanyAdmin(admin, "u-carol", "co-A") === false);
  assert("S8 inactive admin not counted",          await callerIsCompanyAdmin(admin, "u-old", "co-A") === false);
  assert("S9 stranger not in any company",         await callerIsCompanyAdmin(admin, "u-stranger", "co-A") === false);
}

// ── End-to-end policy ──────────────────────────────────────────────
{
  // Happy path: Alice (admin co-A) calls back Bob (SOS owner of co-A)
  const r = await authorizeEmployeeCallback(admin, "u-alice", "EID-BOB", BOB_PHONE);
  assert("S10 Alice -> Bob (his emergency) → 200", r.status === 200 && r.dialedPhone === BOB_PHONE);
}
{
  // Bob tries to use admin-callback path (he's not an admin)
  const r = await authorizeEmployeeCallback(admin, "u-bob", "EID-BOB", BOB_PHONE);
  assert("S11 employee tries admin-callback → 403 caller_not_admin",
    r.status === 403 && r.reason === "caller_not_admin");
}
{
  // Carol (admin of co-B) tries to call into co-A's emergency
  const r = await authorizeEmployeeCallback(admin, "u-carol", "EID-BOB", BOB_PHONE);
  assert("S12 cross-tenant admin → 403 caller_not_admin",
    r.status === 403 && r.reason === "caller_not_admin");
}
{
  // Alice tries to use callback to dial Carol's number (not the SOS owner)
  const r = await authorizeEmployeeCallback(admin, "u-alice", "EID-BOB", CAROL_PHONE);
  assert("S13 admin tries arbitrary `to` → 403 to_not_owner",
    r.status === 403 && r.reason === "to_not_owner");
}
{
  // Alice with a hostile attacker phone in `to`
  const r = await authorizeEmployeeCallback(admin, "u-alice", "EID-BOB", "+1900TOLLBURN");
  assert("S14 admin with toll-fraud `to` → 403 to_not_owner",
    r.status === 403 && r.reason === "to_not_owner");
}
{
  // Civilian emergency (no company) — no admin path possible.
  const r = await authorizeEmployeeCallback(admin, "u-alice", "EID-DAVE", DAVE_PHONE);
  assert("S15 civilian SOS via callback → 404 not_company_scoped",
    r.status === 404 && r.reason === "not_company_scoped");
}
{
  // Phone with spaces — should normalise
  const r = await authorizeEmployeeCallback(admin, "u-alice", "EID-BOB", "+966 500 000 002");
  assert("S16 Bob phone with spaces (normalised) → 200",
    r.status === 200 && r.dialedPhone === BOB_PHONE);
}
{
  // Unknown emergencyId → 404 (not because of caller, but because session doesn't exist)
  const r = await authorizeEmployeeCallback(admin, "u-alice", "EID-NOPE", BOB_PHONE);
  assert("S17 unknown emergency → 404", r.status === 404);
}
{
  // Empty `to` → 403
  const r = await authorizeEmployeeCallback(admin, "u-alice", "EID-BOB", "");
  assert("S18 empty `to` → 403 to_not_owner", r.status === 403 && r.reason === "to_not_owner");
}
{
  // BEEHIVE: an attacker who knows the emergencyId but is NOT admin and
  // doesn't even know who the owner is. Should be blocked at caller check.
  const r = await authorizeEmployeeCallback(admin, "u-bob", "EID-BOB", BOB_PHONE);
  assert("S19 Bob calling himself (he's the owner!) — but he's not admin → 403",
    r.status === 403);
}
{
  // Ghost row (orphan emergency) — admin Alice valid, but no owner phone
  const r = await authorizeEmployeeCallback(admin, "u-alice", "EID-ORPH", BOB_PHONE);
  assert("S20 admin + orphan emergency → 403 to_not_owner (no real owner phone)",
    r.status === 403 && r.reason === "to_not_owner");
}

console.log("\n" + (fail === 0 ? "OK all G-5 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
