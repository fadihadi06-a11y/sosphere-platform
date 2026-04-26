// Synthetic test for G-17 (B-20): sos-bridge-twiml `action=accept` requires
// gtok + server-side userPhone derivation. Inline copy of the gather-token
// HMAC logic + the resolveUserPhone resolver.

import { createHmac } from "node:crypto";

// Mock the b64url encoding + HMAC the same way the Deno helper does.
function b64urlFromBuf(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signGatherTokenSync(callId, secret, ttlSec = 30 * 60, atSec = null) {
  const expiry = (atSec ?? Math.floor(Date.now() / 1000)) + ttlSec;
  const mac = b64urlFromBuf(createHmac("sha256", secret).update(`g:${callId}:${expiry}`).digest());
  return `${expiry}.${mac}`;
}

function verifyGatherTokenSync(token, callId, secret, nowSec = null) {
  if (!token) return { ok: false, reason: "missing_token" };
  if (!callId) return { ok: false, reason: "missing_callId" };
  if (!secret) return { ok: false, reason: "secret_unavailable" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed_token" };
  const expiryStr = token.slice(0, dot);
  const providedMac = token.slice(dot + 1);
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry <= 0) return { ok: false, reason: "malformed_expiry" };
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  if (expiry < now) return { ok: false, reason: "expired" };
  const expectedMac = b64urlFromBuf(createHmac("sha256", secret).update(`g:${callId}:${expiry}`).digest());
  if (expectedMac.length !== providedMac.length) return { ok: false, reason: "mac_length_mismatch" };
  let diff = 0;
  for (let i = 0; i < expectedMac.length; i++) diff |= expectedMac.charCodeAt(i) ^ providedMac.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "mac_mismatch" };
  return { ok: true };
}

// Mock supabase admin for resolveUserPhone
function makeMockAdmin(fixtures) {
  return {
    from(table) {
      let rows = fixtures[table] || [];
      const q = {
        select: () => q,
        eq: (col, val) => { rows = rows.filter(r => r[col] === val); return q; },
        maybeSingle: async () => ({ data: rows[0] ?? null }),
      };
      return q;
    },
  };
}

async function resolveUserPhone(admin, emergencyId) {
  if (!emergencyId || emergencyId === "UNKNOWN") return null;
  const { data: session } = await admin.from("sos_sessions")
    .select("user_id, company_id").eq("id", emergencyId).maybeSingle();
  if (!session) return null;
  const userId = session.user_id;
  if (!userId) return null;
  const { data: profile } = await admin.from("profiles")
    .select("phone").eq("id", userId).maybeSingle();
  if (profile?.phone) return profile.phone;
  const { data: emp } = await admin.from("employees")
    .select("phone").eq("user_id", userId).maybeSingle();
  if (emp?.phone) return emp.phone;
  return null;
}

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
}

console.log("\n=== G-17 sos-bridge-twiml gtok + userPhone scenarios ===\n");

const SECRET = "test-secret-1234567890abcdef";
const EID    = "EID-ALPHA-001";
const NOW    = Math.floor(Date.now() / 1000);

// ── gtok validation ────────────────────────────────────────────────
{
  const tok = signGatherTokenSync(EID, SECRET, 1800, NOW);
  const r = verifyGatherTokenSync(tok, EID, SECRET, NOW);
  assert("S1 fresh token verifies", r.ok === true);
}
{
  const tok = signGatherTokenSync(EID, SECRET, -100, NOW); // already expired
  const r = verifyGatherTokenSync(tok, EID, SECRET, NOW);
  assert("S2 expired token rejected", !r.ok && r.reason === "expired");
}
{
  const tok = signGatherTokenSync(EID, SECRET, 1800, NOW);
  // Tamper with mac
  const tampered = tok.slice(0, -3) + "AAA";
  const r = verifyGatherTokenSync(tampered, EID, SECRET, NOW);
  assert("S3 tampered mac rejected", !r.ok && r.reason === "mac_mismatch");
}
{
  // Token signed for emergencyA used against emergencyB
  const tokA = signGatherTokenSync("EID-A", SECRET, 1800, NOW);
  const r = verifyGatherTokenSync(tokA, "EID-B", SECRET, NOW);
  assert("S4 cross-emergencyId tok rejected", !r.ok && r.reason === "mac_mismatch");
}
{
  const r = verifyGatherTokenSync("", EID, SECRET, NOW);
  assert("S5 missing token rejected", !r.ok && r.reason === "missing_token");
}
{
  const tok = signGatherTokenSync(EID, SECRET, 1800, NOW);
  const r = verifyGatherTokenSync(tok, "", SECRET, NOW);
  assert("S6 missing callId rejected", !r.ok && r.reason === "missing_callId");
}
{
  const r = verifyGatherTokenSync("malformed-no-dot", EID, SECRET, NOW);
  assert("S7 malformed token rejected", !r.ok && r.reason === "malformed_token");
}
{
  const r = verifyGatherTokenSync("garbage.tok", EID, SECRET, NOW);
  assert("S8 non-numeric expiry rejected", !r.ok && r.reason === "malformed_expiry");
}
{
  // Different secret on verify side
  const tok = signGatherTokenSync(EID, SECRET, 1800, NOW);
  const r = verifyGatherTokenSync(tok, EID, "different-secret-abc", NOW);
  assert("S9 wrong secret rejected", !r.ok && r.reason === "mac_mismatch");
}

// ── resolveUserPhone behaviour ─────────────────────────────────────
const fixtures = {
  sos_sessions: [
    { id: "EID-CIVIL", user_id: "u-civil", company_id: null },
    { id: "EID-CO",    user_id: "u-co", company_id: "co-1" },
    { id: "EID-ORPHAN", user_id: null, company_id: null },
    { id: "EID-EMP", user_id: "u-emp-only", company_id: "co-2" },
  ],
  profiles: [
    { id: "u-civil", phone: "+966500000010" },
    { id: "u-co",    phone: "+966500000020" },
    // u-emp-only has NO profile.phone → fallback to employees.phone
    { id: "u-emp-only", phone: null },
  ],
  employees: [
    { user_id: "u-emp-only", phone: "+966500000030" },
  ],
};
const admin = makeMockAdmin(fixtures);

assert("S10 civilian user phone from profiles",
  await resolveUserPhone(admin, "EID-CIVIL") === "+966500000010");
assert("S11 company user phone from profiles",
  await resolveUserPhone(admin, "EID-CO") === "+966500000020");
assert("S12 fallback to employees.phone when profile.phone NULL",
  await resolveUserPhone(admin, "EID-EMP") === "+966500000030");
assert("S13 orphan session (null user_id) → null",
  (await resolveUserPhone(admin, "EID-ORPHAN")) === null);
assert("S14 unknown emergencyId → null",
  (await resolveUserPhone(admin, "EID-NOPE")) === null);
assert("S15 empty/UNKNOWN emergencyId → null",
  (await resolveUserPhone(admin, "")) === null && (await resolveUserPhone(admin, "UNKNOWN")) === null);

// ── End-to-end policy: accept handler simulation ───────────────────
async function acceptHandler(admin, emergencyId, urlSuppliedPhone, gtok, secret) {
  const tokRes = verifyGatherTokenSync(gtok, emergencyId, secret);
  if (!tokRes.ok) return { status: 403, dialedPhone: null };
  // G-17: ignore url-supplied phone, always use DB
  const dbPhone = await resolveUserPhone(admin, emergencyId);
  return { status: 200, dialedPhone: dbPhone };
}

{
  const tok = signGatherTokenSync("EID-CO", SECRET, 1800);
  // Attacker tries to inject victim phone via URL
  const r = await acceptHandler(admin, "EID-CO", "+1ATTACKER", tok, SECRET);
  assert("S16 valid gtok + attacker URL phone → dial DB phone, not URL phone",
    r.status === 200 && r.dialedPhone === "+966500000020");
}
{
  // No gtok → 403
  const r = await acceptHandler(admin, "EID-CO", "+1ATTACKER", "", SECRET);
  assert("S17 missing gtok → 403, no Twilio dial",
    r.status === 403 && r.dialedPhone === null);
}
{
  // Tampered gtok → 403
  const tok = signGatherTokenSync("EID-CO", SECRET, 1800);
  const tampered = tok.slice(0, -2) + "ZZ";
  const r = await acceptHandler(admin, "EID-CO", "+1ATTACKER", tampered, SECRET);
  assert("S18 tampered gtok → 403", r.status === 403);
}
{
  // gtok signed for a different emergencyId → 403
  const tok = signGatherTokenSync("EID-OTHER", SECRET, 1800);
  const r = await acceptHandler(admin, "EID-CO", "+1ATTACKER", tok, SECRET);
  assert("S19 gtok for different EID → 403", r.status === 403);
}
{
  // Expired gtok → 403
  const tok = signGatherTokenSync("EID-CO", SECRET, -100);
  const r = await acceptHandler(admin, "EID-CO", "+1ATTACKER", tok, SECRET);
  assert("S20 expired gtok → 403", r.status === 403);
}
{
  // Non-existent emergency + valid-shape gtok → 200 but null dial
  // (the gtok would have to match THIS emergency anyway; we mint one for it)
  const tok = signGatherTokenSync("EID-NOPE", SECRET, 1800);
  const r = await acceptHandler(admin, "EID-NOPE", "+1ATTACKER", tok, SECRET);
  assert("S21 valid gtok + nonexistent eid → 200 but no dial (no DB phone)",
    r.status === 200 && r.dialedPhone === null);
}
{
  // BEEHIVE: classic G-17 attack — internet caller with no gtok at all
  const r = await acceptHandler(admin, "EID-CIVIL", "+1victim", null, SECRET);
  assert("S22 attacker with no gtok at all → 403 (toll-fraud blocked)",
    r.status === 403);
}

console.log(`\n${fail === 0 ? "✅ all G-17 scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
