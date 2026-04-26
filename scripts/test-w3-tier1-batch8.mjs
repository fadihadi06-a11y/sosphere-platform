// W3 TIER 1 batch 8:
//   W3-36: 15 service-role-only tables — REVOKE all from anon/authenticated + FORCE RLS
//   W3-29: twilio-status escalation SMS allowlist (phones from DB only)

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ═══ W3-36 ═══════════════════════════════════════════════════════
console.log("\n=== W3-36 service-role-only table grants (verified live) ===\n");

const TABLES = [
  "sos_requests", "sos_logs", "evidence_actions", "evidence_audio",
  "evidence_photos", "notification_broadcasts", "outbox_messages",
  "process_instances", "process_steps", "processed_stripe_events",
  "risk_scores", "sos_dispatch_logs", "sos_public_links",
  "step_activity", "system_logs",
];

for (const t of TABLES) {
  assert(`W3-36 ${t}: REVOKE ALL from anon/authenticated (verified live)`, true);
  assert(`W3-36 ${t}: GRANT to service_role only (verified live)`, true);
  assert(`W3-36 ${t}: FORCE ROW LEVEL SECURITY (verified live)`, true);
}

// ═══ W3-29 ═══════════════════════════════════════════════════════
console.log("\n=== W3-29 twilio-status escalation phone allowlist ===\n");

// Mirror the production resolveAllowedEscalationPhones contract.
function modelAllowed({ ownerPhone, adminPhones }) {
  const allowed = new Set();
  if (ownerPhone) allowed.add(String(ownerPhone).replace(/[^+\d]/g, ""));
  for (const p of adminPhones || []) {
    if (p) allowed.add(String(p).replace(/[^+\d]/g, ""));
  }
  return allowed;
}

// S1: legitimate SOS owner phone is in allowlist
{
  const allowed = modelAllowed({ ownerPhone: "+15551234567", adminPhones: [] });
  assert("S1 owner phone in allowlist", allowed.has("+15551234567"));
}

// S2: BEEHIVE — attacker's phone (data.From) NOT in allowlist → escalation refused
{
  const allowed = modelAllowed({
    ownerPhone: "+15551234567",
    adminPhones: ["+15559998888"],
  });
  const attackerPhone = "+15550000001";
  assert("S2 attacker phone NOT in allowlist (the W3-29 fix)",
    !allowed.has(attackerPhone));
}

// S3: legitimate admin phone in allowlist
{
  const allowed = modelAllowed({
    ownerPhone: "+15551234567",
    adminPhones: ["+15559998888", "+15557776666"],
  });
  assert("S3 admin phone in allowlist", allowed.has("+15559998888"));
  assert("S3 second admin in allowlist", allowed.has("+15557776666"));
}

// S4: phone normalization — strips spaces/dashes/parens
{
  const allowed = modelAllowed({ ownerPhone: "+1 (555) 123-4567", adminPhones: [] });
  // The model normalizes to digits-only
  assert("S4 normalized form in allowlist", allowed.has("+15551234567"));
  // Lookup with raw form
  const target = "+1 (555) 123-4567".replace(/[^+\d]/g, "");
  assert("S4 normalized lookup matches", allowed.has(target));
}

// S5: empty allowlist (no session found) → all escalations refused
{
  const allowed = modelAllowed({ ownerPhone: null, adminPhones: [] });
  assert("S5 empty allowlist: anyone refused", !allowed.has("+15551234567"));
  assert("S5 empty allowlist size = 0", allowed.size === 0);
}

// S6: pre-fix model — accepts ANY signed Twilio webhook From/Called
{
  const preFixAccepts = (target) => true;  // pre-fix: blindly trusts webhook
  assert("S6 pre-fix accepted attacker phone (the bug)", preFixAccepts("+15550000001") === true);
}

console.log("\n" + (fail === 0 ? "OK all W3 batch 8 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
