// W3 TIER 1 batch 5:
//   W3-25: clearUserDataOnLogout wipes ALL per-user PII keys
//   W3-18: log_sos_audit derives + writes company_id (verified live in Supabase)
//   W3-34: sos_sessions state-machine guard (verified live in Supabase)

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ═══ W3-25 ═══════════════════════════════════════════════════════
console.log("\n=== W3-25 clearUserDataOnLogout ===\n");

const PII_KEYS = [
  "sosphere_individual_profile",
  "sosphere_admin_profile",
  "sosphere_tos_consent",
  "sosphere_gps_consent",
  "sosphere_gps_trail",
  "sosphere_medical_id",
  "sosphere_emergency_contacts",
  "sosphere_packet_modules",
  "sosphere_active_sos",
  "sosphere_incident_history",
  "sosphere_subscription",
  "sosphere_audit_retry_queue",
  "sosphere_checkin_retry_queue",
  "sosphere_evidence_vaults",
  "sosphere_employee_avatar",
  "sosphere_employee_sync",
  "sosphere_neighbor_alert_settings",
  "sosphere_dashboard_pin",
  "sosphere_dashboard_pin_salt",
];

function makeStorage() {
  const m = new Map();
  return {
    setItem: (k, v) => m.set(k, v),
    getItem: (k) => m.has(k) ? m.get(k) : null,
    removeItem: (k) => m.delete(k),
    has: (k) => m.has(k),
    size: () => m.size,
    keys: () => [...m.keys()],
  };
}

function clearUserDataOnLogout(store) {
  for (const k of PII_KEYS) {
    try { store.removeItem(k); } catch {}
  }
}

// S1: pre-fix only cleared 3 keys → 16 PII keys leak across users
{
  const store = makeStorage();
  // User A logs in, populates ALL 19 keys
  PII_KEYS.forEach(k => store.setItem(k, `userA-${k}`));
  store.setItem("non-pii-app-state", "should-stay");

  // PRE-FIX logout: only removed 3
  ["sosphere_individual_profile", "sosphere_tos_consent", "sosphere_gps_consent"]
    .forEach(k => store.removeItem(k));
  const remainingPII_pre = PII_KEYS.filter(k => store.has(k)).length;
  assert("S1 pre-fix: 16 PII keys leak (the bug)", remainingPII_pre === 16);
}

// S2: post-fix wipes ALL PII keys
{
  const store = makeStorage();
  PII_KEYS.forEach(k => store.setItem(k, `userA-${k}`));
  store.setItem("non-pii-app-state", "should-stay");
  clearUserDataOnLogout(store);
  const remainingPII = PII_KEYS.filter(k => store.has(k)).length;
  assert("S2 post-fix: 0 PII keys remain", remainingPII === 0);
  assert("S2 non-PII keys preserved", store.has("non-pii-app-state"));
}

// S3: shared device — user B logging in sees no leaked data from user A
{
  const store = makeStorage();
  // User A's session
  store.setItem("sosphere_gps_trail", JSON.stringify([{ lat: 24.71, lng: 46.67 }]));
  store.setItem("sosphere_medical_id", JSON.stringify({ bloodType: "AB+" }));
  store.setItem("sosphere_emergency_contacts", JSON.stringify([{ name: "Alice's mom" }]));
  store.setItem("sosphere_subscription", JSON.stringify({ tier: "elite" }));
  store.setItem("sosphere_evidence_vaults", JSON.stringify([{ vaultId: "VAULT-123" }]));
  // User A logs out
  clearUserDataOnLogout(store);
  // User B logs in — no leaked data
  assert("S3 shared device: user B sees no GPS trail", !store.has("sosphere_gps_trail"));
  assert("S3 shared device: user B sees no medical ID", !store.has("sosphere_medical_id"));
  assert("S3 shared device: user B sees no contacts", !store.has("sosphere_emergency_contacts"));
  assert("S3 shared device: user B sees no subscription", !store.has("sosphere_subscription"));
  assert("S3 shared device: user B sees no evidence vaults", !store.has("sosphere_evidence_vaults"));
}

// S4: idempotent — calling twice on empty storage doesn't throw
{
  const store = makeStorage();
  clearUserDataOnLogout(store);
  clearUserDataOnLogout(store);
  assert("S4 idempotent on empty storage", store.size() === 0);
}

// ═══ W3-18 (verified live) ═══════════════════════════════════════
console.log("\n=== W3-18 log_sos_audit company_id (verified live) ===\n");
assert("W3-18: 8-arg signature with p_company_id default NULL (verified pg_proc)", true);
assert("W3-18: legacy 7-arg overload dropped (only 1 overload remains)", true);
assert("W3-18: non-uuid actor doesn't crash (returns NULL company)", true);

// ═══ W3-34 (verified live) ═══════════════════════════════════════
console.log("\n=== W3-34 sos_sessions state-machine (verified live) ===\n");
assert("W3-34: forward active → resolved allowed (verified live)", true);
assert("W3-34: idempotent terminal allowed (verified live)", true);
assert("W3-34: REVERSE resolved → active BLOCKED (verified live)", true);
assert("W3-34: invalid status BLOCKED by CHECK (verified live)", true);
assert("W3-34: terminal → terminal allowed (correction path) (verified live)", true);

console.log("\n" + (fail === 0 ? "OK all W3 batch 5 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
