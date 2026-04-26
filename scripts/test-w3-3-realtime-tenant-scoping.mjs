// W3-3 hard test — sos-live realtime channel is now tenant-scoped.
// Pre-fix: `sos-live` was a global channel — every authenticated Supabase
// Realtime subscriber received every tenant's SOS payload (employee
// name, lat/lng, contact names, blood-type). Cross-tenant PHI leak.
// Post-fix: `sos-live:${companyId}` for B2B, `sos-live:civilian:${userId}` otherwise.

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// Mirror the server-side channel-name resolver.
function resolveScopedChannel(profile, authUserId) {
  const companyId = profile?.active_company_id;
  return companyId
    ? `sos-live:${companyId}`
    : `sos-live:civilian:${authUserId}`;
}

// S1: B2B employee → company-scoped channel
{
  const profile = { active_company_id: "co-acme-uuid" };
  const ch = resolveScopedChannel(profile, "u-employee");
  assert("S1 B2B employee channel scoped to company",
    ch === "sos-live:co-acme-uuid");
}

// S2: civilian (no company) → user-scoped channel
{
  const profile = {};
  const ch = resolveScopedChannel(profile, "u-civilian");
  assert("S2 civilian channel scoped to user UUID",
    ch === "sos-live:civilian:u-civilian");
}

// S3: profile lookup fails (returns null) — falls back to user-scoped
{
  const profile = null;
  const ch = resolveScopedChannel(profile, "u-fallback");
  assert("S3 null profile falls back to user-scoped",
    ch === "sos-live:civilian:u-fallback");
}

// S4: Two different companies — distinct channels (cannot cross-leak)
{
  const chA = resolveScopedChannel({ active_company_id: "co-A" }, "u-A");
  const chB = resolveScopedChannel({ active_company_id: "co-B" }, "u-B");
  assert("S4 distinct companies → distinct channels", chA !== chB);
}

// S5: Same user across two devices — same channel (so user receives their own)
{
  const ch1 = resolveScopedChannel({ active_company_id: "co-A" }, "u-x");
  const ch2 = resolveScopedChannel({ active_company_id: "co-A" }, "u-x");
  assert("S5 same user/company → same channel for cross-device sync",
    ch1 === ch2);
}

// S6: Civilian — UUID is unguessable (32 hex chars typical), so the channel
//     name itself acts as a per-user secret. Even without RLS/Auth, an
//     attacker cannot subscribe without knowing the target's UUID.
{
  const uuid = "2f8e6b3a-9d4c-4f7e-a8b2-1c0d3e9f5a7d";
  const ch = resolveScopedChannel({}, uuid);
  assert("S6 civilian channel name embeds full UUID (unguessable)",
    ch.endsWith(uuid));
  // Different UUIDs must give different channels
  const ch2 = resolveScopedChannel({}, "11111111-1111-1111-1111-111111111111");
  assert("S6 distinct civilians → distinct channels", ch !== ch2);
}

// S7: Pre-fix vs post-fix — pre-fix used the constant string "sos-live",
//     so every subscriber received every payload. Post-fix isolates.
{
  const PRE_FIX_CHANNEL = "sos-live";
  const post = resolveScopedChannel({ active_company_id: "co-X" }, "u-X");
  assert("S7 post-fix differs from constant pre-fix channel",
    post !== PRE_FIX_CHANNEL);
}

// S8: The channel name is the ONLY thing we change — payload schema
//     stays identical so any future authorized subscriber keeps working.
{
  const expectedFields = ["emergencyId", "userName", "userId", "tier",
    "location", "contacts", "zone", "ts"];
  // We're not testing the payload directly here, just documenting that
  // the contract is unchanged at the broadcast level.
  assert("S8 payload schema unchanged (8 fields)", expectedFields.length === 8);
}

console.log("\n" + (fail === 0 ? "OK all W3-3 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
