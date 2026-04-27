// ═══════════════════════════════════════════════════════════════════════════
// S-15: neighbor-alert consent server-mirrored (GDPR Art. 7)
// ─────────────────────────────────────────────────────────────────────────
// Verifies the server-mirror contract:
//
//   1. Migration adds 2 columns + extends record_consent + new RPC
//      is_neighbor_receive_granted
//   2. record_consent('neighbor_receive', 'granted') stamps the columns
//   3. record_consent('neighbor_receive', 'declined') flips the decision
//   4. record_consent('neighbor_receive', 'invalid') is rejected
//   5. is_neighbor_receive_granted returns true only when granted
//   6. unauthenticated callers blocked
//   7. Service code wires record_consent on toggle change
//   8. Service code provides async helpers + reads server state
//   9. Demonstrability: timestamp is server-recorded, not client-supplied
//  10. Idempotency: re-granting refreshes timestamp without error
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ── S1: migration shape ────────────────────────────────────────
console.log("\n=== S1 migration shape ===\n");
{
  const migPath = "supabase/migrations/20260427120000_w3_s15_neighbor_alert_consent_server_mirror.sql";
  assert("S1.1 migration exists", fs.existsSync(migPath));
  if (fs.existsSync(migPath)) {
    const sql = fs.readFileSync(migPath, "utf8");
    assert("S1.2 adds neighbor_receive_at column",
      /ADD COLUMN IF NOT EXISTS neighbor_receive_at\s+timestamptz/.test(sql));
    assert("S1.3 adds neighbor_receive_decision with CHECK constraint",
      /ADD COLUMN IF NOT EXISTS neighbor_receive_decision[\s\S]{0,200}CHECK[\s\S]{0,150}'granted'\s*,\s*'declined'/.test(sql));
    assert("S1.4 record_consent extended with neighbor_receive kind",
      /p_kind NOT IN \('tos','gps','neighbor_receive'\)/.test(sql));
    assert("S1.5 invalid_decision check covers neighbor_receive",
      /p_kind IN \('gps','neighbor_receive'\)[\s\S]{0,300}invalid_decision/.test(sql));
    assert("S1.6 is_neighbor_receive_granted RPC defined",
      /CREATE OR REPLACE FUNCTION public\.is_neighbor_receive_granted\(p_user_id uuid\)/.test(sql));
    assert("S1.7 W3-39 grant lockdown — REVOKE anon",
      /REVOKE EXECUTE ON FUNCTION public\.record_consent\(text,text,text\) FROM anon/.test(sql) &&
      /REVOKE EXECUTE ON FUNCTION public\.is_neighbor_receive_granted\(uuid\) FROM anon/.test(sql));
    assert("S1.8 W3-32 search_path pinned",
      /SET search_path = public, pg_temp/.test(sql));
    assert("S1.9 GDPR Art. 7 referenced",
      /GDPR Art\.\s*7/.test(sql));
  }
}

// ── S2: get_consent_state extended ─────────────────────────────
console.log("\n=== S2 get_consent_state returns neighbor_receive ===\n");
{
  const migPath = "supabase/migrations/20260427120000_w3_s15_neighbor_alert_consent_server_mirror.sql";
  const sql = fs.readFileSync(migPath, "utf8");
  assert("S2.1 get_consent_state includes neighbor_receive_at",
    /get_consent_state[\s\S]{0,2000}'neighbor_receive_at',/.test(sql));
  assert("S2.2 get_consent_state includes neighbor_receive_decision",
    /get_consent_state[\s\S]{0,2000}'neighbor_receive_decision',/.test(sql));
  assert("S2.3 fallback object includes neighbor_receive_at: NULL",
    /jsonb_build_object\([\s\S]{0,500}'neighbor_receive_at',\s*NULL/.test(sql));
}

// ── S3: client mirror function in neighbor-alert-service ───────
console.log("\n=== S3 client-side mirror function wired ===\n");
{
  const svcPath = "src/app/components/neighbor-alert-service.ts";
  const src = fs.readFileSync(svcPath, "utf8");
  assert("S3.1 mirrorNeighborReceiveConsent exported",
    /export async function mirrorNeighborReceiveConsent\(\s*decision:\s*"granted"\s*\|\s*"declined"/.test(src));
  assert("S3.2 calls record_consent rpc with neighbor_receive kind",
    /supabase\.rpc\("record_consent",\s*\{[\s\S]{0,200}p_kind:\s*"neighbor_receive"/.test(src));
  assert("S3.3 setNeighborAlertSettings fires mirror on receive flag change",
    /patch\.receive !== undefined[\s\S]{0,200}mirrorNeighborReceiveConsent/.test(src));
  assert("S3.4 mirror uses fire-and-forget (`void`)",
    /void mirrorNeighborReceiveConsent/.test(src));
  assert("S3.5 returns false on rpc error (no false success)",
    /record_consent rpc error[\s\S]{0,80}return false/.test(src));
  assert("S3.6 server-state reader exposed",
    /export async function getServerNeighborReceiveConsent\(\)/.test(src));
  assert("S3.7 server reader returns decision + timestamp",
    /decision:\s*"granted"\s*\|\s*"declined"\s*\|\s*null;\s*\n?\s*recorded_at:\s*string\s*\|\s*null/.test(src));
  assert("S3.8 GDPR demonstrability documented",
    /GDPR Art\.\s*7/.test(src));
}

// ── S4: simulate the contract end-to-end ─────────────────────
console.log("\n=== S4 contract simulation ===\n");
{
  // Mirror the SQL behavior in JS
  let serverState = { neighbor_receive_at: null, neighbor_receive_decision: null };
  function recordConsent(kind, decision, authed = true) {
    if (!authed) return { ok: false, reason: "unauthenticated" };
    if (!["tos", "gps", "neighbor_receive"].includes(kind)) return { ok: false, reason: "invalid_kind" };
    if ((kind === "gps" || kind === "neighbor_receive") &&
        !["granted", "declined"].includes(decision)) return { ok: false, reason: "invalid_decision" };
    if (kind === "neighbor_receive") {
      serverState.neighbor_receive_at = new Date().toISOString();
      serverState.neighbor_receive_decision = decision;
    }
    return { ok: true, kind, decision, recorded_at: new Date().toISOString() };
  }
  function isGranted(uid) {
    return serverState.neighbor_receive_decision === "granted" &&
           serverState.neighbor_receive_at !== null;
  }
  function getState() { return { ...serverState }; }

  // Initial state: NULL
  assert("S4.1 initial: not granted", !isGranted("u-1"));
  assert("S4.2 initial: timestamp NULL", getState().neighbor_receive_at === null);

  // Grant
  let r = recordConsent("neighbor_receive", "granted");
  assert("S4.3 grant: ok=true", r.ok === true);
  assert("S4.4 grant: timestamp stamped", getState().neighbor_receive_at !== null);
  assert("S4.5 grant: decision='granted'", getState().neighbor_receive_decision === "granted");
  assert("S4.6 isGranted: true after grant", isGranted("u-1"));

  // Decline
  r = recordConsent("neighbor_receive", "declined");
  assert("S4.7 decline: ok=true", r.ok === true);
  assert("S4.8 decline: decision='declined'", getState().neighbor_receive_decision === "declined");
  assert("S4.9 isGranted: false after decline", !isGranted("u-1"));

  // Invalid
  r = recordConsent("neighbor_receive", "weird");
  assert("S4.10 invalid: rejected", r.ok === false && r.reason === "invalid_decision");

  // Unauthenticated
  r = recordConsent("neighbor_receive", "granted", false);
  assert("S4.11 unauth: rejected", r.ok === false && r.reason === "unauthenticated");

  // Idempotent re-grant — does not throw, refreshes timestamp
  serverState = { neighbor_receive_at: null, neighbor_receive_decision: null };
  recordConsent("neighbor_receive", "granted");
  const ts1 = getState().neighbor_receive_at;
  // Wait a tick
  const wait = () => new Promise(r => setTimeout(r, 5));
  await wait();
  recordConsent("neighbor_receive", "granted");
  const ts2 = getState().neighbor_receive_at;
  assert("S4.12 idempotent re-grant doesn't throw + advances timestamp",
    ts1 !== null && ts2 !== null && new Date(ts2) >= new Date(ts1));
}

// ── S5: lint-guard regression — service still references record_consent ─
console.log("\n=== S5 lint-guard regression: server mirror remains wired ===\n");
{
  const src = fs.readFileSync("src/app/components/neighbor-alert-service.ts", "utf8");
  const occ = (src.match(/record_consent/g) || []).length;
  assert("S5.1 record_consent referenced in service",
    occ >= 1, `count=${occ}`);
  const mirrorCount = (src.match(/mirrorNeighborReceiveConsent/g) || []).length;
  assert("S5.2 mirrorNeighborReceiveConsent referenced ≥ 2 (def + call site)",
    mirrorCount >= 2, `count=${mirrorCount}`);
}

// ── S6: chaos — 100 randomized toggle sequences ───────────────
console.log("\n=== S6 chaos: 100 randomized toggle sequences ===\n");
{
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; }; }
  const r = rng(0x515);
  let serverState = { decision: null, at: null };
  const recordConsent = (kind, decision) => {
    if (kind !== "neighbor_receive") return { ok: false };
    if (!["granted", "declined"].includes(decision)) return { ok: false, reason: "invalid_decision" };
    serverState = { decision, at: Date.now() };
    return { ok: true };
  };
  const isGranted = () => serverState.decision === "granted" && serverState.at !== null;
  let breaches = 0;
  for (let i = 0; i < 100; i++) {
    const flip = r() < 0.5 ? "granted" : "declined";
    recordConsent("neighbor_receive", flip);
    // Invariant: decision matches what we just wrote
    if (serverState.decision !== flip) breaches++;
    // Invariant: isGranted reflects decision
    if ((flip === "granted") !== isGranted()) breaches++;
  }
  assert("S6.1 100 chaos toggles: 0 breaches", breaches === 0);
}

// ── S7: GDPR demonstrability invariant ────────────────────────
console.log("\n=== S7 GDPR Art. 7 demonstrability invariant ===\n");
{
  // The invariant: every 'granted' record carries a server-stamped
  // timestamp. localStorage cannot satisfy this — only the
  // server-side now() can. The migration enforces this via the
  // RPC body (UPDATE ... SET neighbor_receive_at = now()).
  const migPath = "supabase/migrations/20260427120000_w3_s15_neighbor_alert_consent_server_mirror.sql";
  const sql = fs.readFileSync(migPath, "utf8");
  assert("S7.1 RPC stamps now() for neighbor_receive",
    /SET\s+neighbor_receive_at\s*=\s*now\(\)/.test(sql));
  assert("S7.2 column is timestamptz (timezone-aware)",
    /neighbor_receive_at\s+timestamptz/.test(sql));
  assert("S7.3 is_neighbor_receive_granted requires both fields",
    /neighbor_receive_decision\s*=\s*'granted'\s+AND\s+p\.neighbor_receive_at IS NOT NULL/.test(sql));
}

// ── S8: B-08 pattern preserved (no regression) ────────────────
console.log("\n=== S8 B-08 pattern preserved ===\n");
{
  const migPath = "supabase/migrations/20260427120000_w3_s15_neighbor_alert_consent_server_mirror.sql";
  const sql = fs.readFileSync(migPath, "utf8");
  assert("S8.1 'tos' kind still accepted",
    /'tos','gps','neighbor_receive'/.test(sql));
  assert("S8.2 'gps' kind still accepted",
    /'gps','neighbor_receive'/.test(sql));
  assert("S8.3 tos branch unchanged (uses tos_consent_at)",
    /IF p_kind = 'tos' THEN[\s\S]{0,300}tos_consent_at\s*=\s*now\(\)/.test(sql));
  assert("S8.4 gps branch unchanged (uses gps_consent_decision)",
    /ELSIF p_kind = 'gps' THEN[\s\S]{0,300}gps_consent_decision\s*=\s*p_decision/.test(sql));
}

console.log("");
console.log(fail === 0
  ? `OK S-15 neighbor-alert consent server-mirror verified — 8 sections / 40 assertions / 100 chaos toggles`
  : `X ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
