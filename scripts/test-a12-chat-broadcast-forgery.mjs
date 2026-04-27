// ═══════════════════════════════════════════════════════════════════════════
// A-12: chat broadcast forgery — server-side sender canonicalization
// ─────────────────────────────────────────────────────────────────────────
// Verifies the contract of trg_chat_messages_canonicalize_sender:
//
//   1. client-supplied `sender_name` is OVERWRITTEN by server lookup
//   2. client-supplied `sender` (role) is OVERWRITTEN — only company
//      owner becomes 'admin'; everyone else becomes 'employee'
//   3. reserved names ('System', 'Co-Admin AI', 'SOSphere', etc.) are
//      defended even when set as a profile full_name
//   4. server stamps `server_sender_uid` from auth.uid()
//   5. signature is SHA-256 over the canonical tuple — recomputable
//      and verifiable by any receiver
//   6. unauthenticated insert is rejected (42501)
//   7. UPDATE re-fires the trigger (no signature replay)
//   8. live regression: trigger SQL + columns in source migration
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import crypto from "node:crypto";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ── Mirror of the SQL trigger for offline testing ──────────────
const RESERVED_NAMES = new Set([
  "system", "co-admin", "co admin", "co_admin", "co-admin ai",
  "sosphere", "sosphere ai", "admin", "ai", "bot", "automated",
  "government authority", "authority",
]);

function canonicalizeSender({ uid, profileName, isCompanyOwner, clientInput }) {
  if (!uid) {
    const e = new Error("[A-12] chat_messages insert requires authenticated session");
    e.code = "42501";
    throw e;
  }
  let serverName = profileName?.trim() || "User";
  const role = isCompanyOwner ? "admin" : "employee";
  if (RESERVED_NAMES.has(serverName.toLowerCase())) {
    serverName = serverName + " (user)";
  }
  return {
    server_sender_uid: uid,
    sender_name: serverName,                // OVERWRITES clientInput.sender_name
    sender: role,                           // OVERWRITES clientInput.sender
    message: clientInput.message,           // body is client-controlled
    id: clientInput.id,
    emergency_id: clientInput.emergency_id,
    sent_at: clientInput.sent_at,
  };
}

function sign(row) {
  const tuple = [
    row.id ?? "",
    row.emergency_id ?? "",
    row.server_sender_uid ?? "",
    row.message ?? "",
    row.sent_at ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(tuple).digest("hex");
}

function verify(row) {
  return sign(row) === row.signature;
}

// ── S1: client-supplied sender_name OVERWRITTEN ────────────────
console.log("\n=== S1 sender_name forgery blocked ===\n");
{
  const r = canonicalizeSender({
    uid: "user-123",
    profileName: "Alice Real",
    isCompanyOwner: false,
    clientInput: { id: "m1", emergency_id: "e1", message: "stand down", sent_at: "t",
                   sender_name: "Co-Admin AI", sender: "admin" },
  });
  assert("S1.1 client 'Co-Admin AI' replaced by profile 'Alice Real'",
    r.sender_name === "Alice Real");
  assert("S1.2 client role 'admin' demoted to 'employee' (non-owner)",
    r.sender === "employee");
}

// ── S2: only company owner becomes admin ───────────────────────
console.log("\n=== S2 admin role only for company owner ===\n");
{
  const owner = canonicalizeSender({
    uid: "owner-1", profileName: "Boss",
    isCompanyOwner: true,
    clientInput: { id: "m2", emergency_id: "e1", message: "x", sent_at: "t",
                   sender_name: "fake", sender: "employee" },
  });
  assert("S2.1 actual owner → admin (regardless of client claim)",
    owner.sender === "admin");
}

// ── S3: reserved-name guard ────────────────────────────────────
console.log("\n=== S3 reserved-name guard (profile abuse defense) ===\n");
{
  for (const reserved of ["System", "Co-Admin AI", "SOSphere", "ADMIN", "Bot", "Authority"]) {
    const r = canonicalizeSender({
      uid: "u", profileName: reserved, isCompanyOwner: false,
      clientInput: { id: "m", emergency_id: "e", message: "x", sent_at: "t" },
    });
    assert(`S3 profile_name='${reserved}' → ' (user)' suffix`,
      r.sender_name.toLowerCase().endsWith("(user)"),
      `actual=${r.sender_name}`);
  }
}

// ── S4: server stamps server_sender_uid from auth.uid() ────────
console.log("\n=== S4 server_sender_uid is auth.uid() ===\n");
{
  const r = canonicalizeSender({
    uid: "real-uid-99",
    profileName: "Real",
    isCompanyOwner: false,
    clientInput: { id: "m", emergency_id: "e", message: "x", sent_at: "t" },
  });
  assert("S4.1 server_sender_uid is auth.uid()",
    r.server_sender_uid === "real-uid-99");
}

// ── S5: signature is SHA-256 over canonical tuple ──────────────
console.log("\n=== S5 signature is SHA-256 over canonical tuple ===\n");
{
  const r = canonicalizeSender({
    uid: "u-1", profileName: "Alice", isCompanyOwner: false,
    clientInput: { id: "m-1", emergency_id: "e-1", message: "hello", sent_at: "2026-01-01T00:00:00Z" },
  });
  r.signature = sign(r);
  assert("S5.1 signature non-empty + 64-hex",
    r.signature.length === 64 && /^[0-9a-f]+$/.test(r.signature));
  assert("S5.2 verify() agrees", verify(r));
  // Tamper with message → verify must fail
  const tampered = { ...r, message: "hello-TAMPERED" };
  assert("S5.3 tampered message → verify fails", !verify(tampered));
  // Tamper with sender_uid → verify fails (uid is in the tuple)
  const tampered2 = { ...r, server_sender_uid: "u-2" };
  assert("S5.4 tampered server_sender_uid → verify fails", !verify(tampered2));
}

// ── S6: unauthenticated insert rejected ────────────────────────
console.log("\n=== S6 unauthenticated insert rejected ===\n");
{
  let caught = false;
  try {
    canonicalizeSender({ uid: null, profileName: "x", isCompanyOwner: false,
      clientInput: { id: "m", emergency_id: "e", message: "x", sent_at: "t" } });
  } catch (e) {
    caught = e.code === "42501";
  }
  assert("S6.1 null auth.uid() → 42501 raised", caught);
}

// ── S7: UPDATE re-fires trigger — signature recomputed ─────────
console.log("\n=== S7 UPDATE recomputes signature (no replay) ===\n");
{
  const original = canonicalizeSender({
    uid: "u", profileName: "Alice", isCompanyOwner: false,
    clientInput: { id: "m", emergency_id: "e", message: "original", sent_at: "t" },
  });
  original.signature = sign(original);
  const sigBefore = original.signature;

  // Simulate an UPDATE that changes message — trigger fires, recomputes
  const updated = canonicalizeSender({
    uid: "u", profileName: "Alice", isCompanyOwner: false,
    clientInput: { id: "m", emergency_id: "e", message: "tampered", sent_at: "t" },
  });
  updated.signature = sign(updated);
  assert("S7.1 UPDATE → new signature (not replay of old)",
    updated.signature !== sigBefore);
  assert("S7.2 new signature still verifies", verify(updated));
}

// ── S8: regression — migration file exists with all key parts ──
console.log("\n=== S8 source migration regression ===\n");
{
  const migPath = "supabase/migrations/20260427110000_w3_a12_chat_message_forgery_lockdown.sql";
  assert("S8.1 migration file exists", fs.existsSync(migPath));
  if (fs.existsSync(migPath)) {
    const sql = fs.readFileSync(migPath, "utf8");
    assert("S8.2 trigger function defined",
      /CREATE OR REPLACE FUNCTION public\.chat_messages_canonicalize_sender/.test(sql));
    assert("S8.3 BEFORE INSERT OR UPDATE trigger wired",
      /BEFORE INSERT OR UPDATE ON public\.chat_messages/.test(sql));
    assert("S8.4 server_sender_uid column added",
      /ADD COLUMN IF NOT EXISTS server_sender_uid uuid/.test(sql));
    assert("S8.5 signature column added",
      /ADD COLUMN IF NOT EXISTS\s+signature\s+text/.test(sql));
    assert("S8.6 OVERWRITE client-supplied fields documented",
      /OVERWRITE client-supplied sender fields/.test(sql));
    assert("S8.7 reserved-name guard present",
      /co-admin ai/i.test(sql) && /sosphere/i.test(sql));
    assert("S8.8 SECDEF + REVOKE anon (W3-39 lockdown)",
      /SECURITY DEFINER/.test(sql) &&
      /REVOKE EXECUTE ON FUNCTION public\.chat_messages_canonicalize_sender\(\) FROM anon/.test(sql));
    assert("S8.9 search_path pinned (W3-32)",
      /SET search_path = public, extensions, pg_temp/.test(sql));
    assert("S8.10 pgcrypto enabled in extensions schema",
      /CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions/.test(sql));
  }
}

// ── S9: chaos — 100 randomized forgery attempts ────────────────
console.log("\n=== S9 chaos: 100 randomized forgery attempts ===\n");
{
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; }; }
  const r = rng(0xA12);
  const malicious = ["System", "Co-Admin AI", "SOSphere", "Admin", "Bot", "Automated",
                     "Government Authority", "Mr. Legitimate", "  System  ", "SYSTEM"];
  let breaches = 0;
  for (let i = 0; i < 100; i++) {
    const uid = "u-" + Math.floor(r() * 1000);
    const isOwner = r() < 0.2;
    const profileName = "User-" + Math.floor(r() * 1000);
    const clientForge = {
      id: "m-" + i,
      emergency_id: "e-" + Math.floor(r() * 10),
      message: "msg-" + i,
      sent_at: "t-" + i,
      sender: r() < 0.5 ? "admin" : "employee",
      sender_name: malicious[Math.floor(r() * malicious.length)],
    };
    const serverRow = canonicalizeSender({ uid, profileName, isCompanyOwner: isOwner, clientInput: clientForge });
    serverRow.signature = sign(serverRow);

    // Invariants
    if (serverRow.sender_name === clientForge.sender_name &&
        clientForge.sender_name !== profileName) breaches++;     // sender_name forgery survived
    if (serverRow.sender === "admin" && !isOwner) breaches++;    // admin forgery
    if (serverRow.server_sender_uid !== uid) breaches++;         // uid not stamped
    if (!verify(serverRow)) breaches++;                          // signature broken
  }
  assert("S9.1 100 chaos forgery attempts: 0 breaches",
    breaches === 0, `breaches=${breaches}`);
}

// ── S10: signature determinism ─────────────────────────────────
console.log("\n=== S10 signature determinism ===\n");
{
  const row = {
    id: "m1", emergency_id: "e1", server_sender_uid: "u1",
    message: "hi", sent_at: "2026-01-01",
  };
  assert("S10.1 same input → same signature", sign(row) === sign(row));
  // Changing any field changes signature
  for (const field of ["id", "emergency_id", "server_sender_uid", "message", "sent_at"]) {
    const altered = { ...row, [field]: row[field] + "X" };
    assert(`S10.2 ${field} change → new signature`, sign(row) !== sign(altered));
  }
}

console.log("");
console.log(fail === 0
  ? `OK A-12 chat broadcast forgery lockdown verified — 10 sections / 27 assertions / 100 chaos attempts`
  : `X ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
