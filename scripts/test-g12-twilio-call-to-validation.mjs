// Synthetic test for G-12 (B-20): twilio-call server-side `to` validation.
// Inline copy of the resolveAllowedToPhones + normalizePhone helpers.

function normalizePhone(p) {
  if (!p) return "";
  const trimmed = String(p).trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

// Mock supabase admin: fixtures simulate the company DB.
function makeMockAdmin(fixtures) {
  return {
    from(table) {
      const rows = fixtures[table] || [];
      let filtered = [...rows];
      const q = {
        select: () => q,
        eq: (col, val) => {
          filtered = filtered.filter(r => r[col] === val);
          return q;
        },
        in: (col, vals) => {
          filtered = filtered.filter(r => vals.includes(r[col]));
          return q;
        },
        maybeSingle: async () => ({ data: filtered[0] ?? null }),
      };
      // Default returns array via thenable
      return Object.assign(q, {
        then: (resolve) => resolve({ data: filtered }),
      });
    },
  };
}

async function resolveAllowedToPhones(admin, callId) {
  const phones = new Set();
  const sessionRes = await admin.from("sos_sessions")
    .select("company_id").eq("id", callId).maybeSingle();
  const companyId = sessionRes?.data?.company_id ?? null;
  if (!companyId) return { companyId: null, phones };

  const profileRows = await admin.from("company_memberships")
    .select("user_id, role, active, profiles:profiles!company_memberships_user_id_fkey(phone)")
    .eq("company_id", companyId).in("role", ["admin","owner"]).eq("active", true);
  for (const r of profileRows.data || []) {
    const ph = normalizePhone(r?.profiles?.phone);
    if (ph) phones.add(ph);
  }

  const empRows = await admin.from("employees")
    .select("phone, role, status").eq("company_id", companyId)
    .in("role", ["admin","owner"]).eq("status", "active");
  for (const r of empRows.data || []) {
    const ph = normalizePhone(r?.phone);
    if (ph) phones.add(ph);
  }
  return { companyId, phones };
}

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
}

console.log("\n=== G-12 twilio-call `to` validation scenarios ===\n");

// ── Phone normalization ─────────────────────────────────────────────
assert("S1 normalize plain", normalizePhone("+966 50 123 4567") === "+966501234567");
assert("S2 normalize no plus", normalizePhone("0501234567") === "0501234567");
assert("S3 normalize spaces+dashes", normalizePhone("+1-415-555-0100") === "+14155550100");
assert("S4 normalize null/empty", normalizePhone(null) === "" && normalizePhone("") === "");
assert("S5 normalize whitespace only", normalizePhone("   ") === "");

// ── Resolver fixtures ────────────────────────────────────────────────
const ADMIN_PROFILE_PHONE = "+966500000001";
const OWNER_EMP_PHONE     = "+966500000002";
const NORMAL_EMP_PHONE    = "+966500000003"; // employee, not admin
const STRANGER_PHONE      = "+19999999999";

const fixtures = {
  sos_sessions: [
    { id: "EID-COMPANY", company_id: "co-1" },
    { id: "EID-CIVILIAN", company_id: null },
  ],
  company_memberships: [
    { company_id: "co-1", user_id: "u-admin", role: "admin", active: true, profiles: { phone: ADMIN_PROFILE_PHONE } },
    { company_id: "co-1", user_id: "u-emp",   role: "employee", active: true, profiles: { phone: NORMAL_EMP_PHONE } },
    { company_id: "co-1", user_id: "u-old",   role: "owner",    active: false, profiles: { phone: "+966999999999" } },  // inactive
    { company_id: "co-2", user_id: "u-other", role: "admin",   active: true, profiles: { phone: STRANGER_PHONE } },     // other tenant
  ],
  employees: [
    { company_id: "co-1", phone: OWNER_EMP_PHONE, role: "owner", status: "active" },
    { company_id: "co-1", phone: NORMAL_EMP_PHONE, role: "employee", status: "active" },
    { company_id: "co-2", phone: STRANGER_PHONE, role: "admin", status: "active" },
  ],
};
const admin = makeMockAdmin(fixtures);

// ── Resolver behaviour ───────────────────────────────────────────────
{
  const r = await resolveAllowedToPhones(admin, "EID-COMPANY");
  assert("S6 EID-COMPANY → companyId resolved", r.companyId === "co-1");
  assert("S7 admin profile phone present", r.phones.has(ADMIN_PROFILE_PHONE));
  assert("S8 owner employees phone present", r.phones.has(OWNER_EMP_PHONE));
  assert("S9 normal employee phone REJECTED", !r.phones.has(NORMAL_EMP_PHONE));
  assert("S10 inactive owner REJECTED", !r.phones.has("+966999999999"));
  assert("S11 other tenant phone REJECTED", !r.phones.has(STRANGER_PHONE));
}
{
  const r = await resolveAllowedToPhones(admin, "EID-CIVILIAN");
  assert("S12 civilian SOS (null company) → companyId null", r.companyId === null);
  assert("S13 civilian SOS → empty phones set", r.phones.size === 0);
}
{
  const r = await resolveAllowedToPhones(admin, "EID-NOPE");
  assert("S14 nonexistent emergency → companyId null", r.companyId === null);
}

// ── End-to-end policy check (the meat of G-12) ───────────────────────
async function authorizeCallTarget(admin, callId, to) {
  const { companyId, phones } = await resolveAllowedToPhones(admin, callId);
  if (!companyId) return { status: 404, reason: "not_company_scoped" };
  const target = normalizePhone(to);
  if (!target || !phones.has(target)) return { status: 403, reason: "not_authorised" };
  return { status: 200, reason: "ok" };
}

assert("S15 valid admin phone → 200",
  (await authorizeCallTarget(admin, "EID-COMPANY", ADMIN_PROFILE_PHONE)).status === 200);
assert("S16 valid owner phone → 200",
  (await authorizeCallTarget(admin, "EID-COMPANY", OWNER_EMP_PHONE)).status === 200);
// DB has "+966500000001" — re-format with same digits + spaces.
// 9-6-6-5-0-0-0-0-0-0-0-1 → "+966 500 000 001"
assert("S17 admin phone with spaces → still 200 (normalized)",
  (await authorizeCallTarget(admin, "EID-COMPANY", "+966 500 000 001")).status === 200);
assert("S18 normal employee phone → 403",
  (await authorizeCallTarget(admin, "EID-COMPANY", NORMAL_EMP_PHONE)).status === 403);
assert("S19 inactive owner's phone → 403",
  (await authorizeCallTarget(admin, "EID-COMPANY", "+966999999999")).status === 403);
assert("S20 other tenant's admin phone → 403",
  (await authorizeCallTarget(admin, "EID-COMPANY", STRANGER_PHONE)).status === 403);
assert("S21 attacker random phone → 403",
  (await authorizeCallTarget(admin, "EID-COMPANY", "+19001234567")).status === 403);
assert("S22 civilian SOS → 404 (no company scope)",
  (await authorizeCallTarget(admin, "EID-CIVILIAN", ADMIN_PROFILE_PHONE)).status === 404);
assert("S23 unknown emergencyId → 404",
  (await authorizeCallTarget(admin, "EID-NOPE", ADMIN_PROFILE_PHONE)).status === 404);
assert("S24 empty `to` → 403",
  (await authorizeCallTarget(admin, "EID-COMPANY", "")).status === 403);
assert("S25 null `to` → 403",
  (await authorizeCallTarget(admin, "EID-COMPANY", null)).status === 403);

// ── BEEHIVE: cross-tenant attempt (Alice authenticated, calls Bob's company emergency)
// The auth check sits OUTSIDE this helper (in twilio-call's authenticate()), but
// the `to` lookup is keyed by the emergency's company, not the caller's company.
// So even if Alice authenticates as user in tenant A and supplies tenant B's
// emergencyId, the lookup will resolve tenant B's admin phones — the attack
// only works if Alice ALSO supplies a tenant-B admin phone, which is exactly
// what the auth+session check + this validation jointly prevent.
// Sanity-check: tenant-A admin phone against tenant-B emergencyId is 403.
{
  fixtures.sos_sessions.push({ id: "EID-TENANT-B", company_id: "co-2" });
  const adminB = makeMockAdmin(fixtures);
  const r = await authorizeCallTarget(adminB, "EID-TENANT-B", ADMIN_PROFILE_PHONE);
  assert("S26 tenant-A admin phone with tenant-B emergencyId → 403",
    r.status === 403);
}

console.log(`\n${fail === 0 ? "✅ all G-12 scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
