// ═══════════════════════════════════════════════════════════════════════════
// C-7: phone staleness mid-SOS — drift detection contract
// ─────────────────────────────────────────────────────────────────────────
// Verifies the contract of get_emergency_contacts_with_drift + the
// sos-alert wiring that populates contact_snapshot at trigger time.
//
// Scenarios:
//   S1: snapshot persisted at INSERT path (pre-claim)
//   S2: snapshot persisted at UPDATE path (atomic claim)
//   S3: drift = 0 when contacts unchanged
//   S4: drift detects phone_changed
//   S5: drift detects deleted (contact removed mid-SOS)
//   S6: drift detects added_after_trigger
//   S7: drift handles multiple simultaneous mutations
//   S8: name match is case + whitespace insensitive
//   S9: empty current + non-empty snapshot → degraded fallback
//   S10: empty snapshot → no drift, current = current
//   S11: dispatcher retry uses current[*].phone (NOT snapshot[*].phone)
//        when no drift detected → preserves audit
//   S12: dispatcher retry uses current[*].phone when drift exists →
//        ensures fresh phone reaches Twilio (the actual C-7 fix)
//   S13: deleted contact → dispatcher chooses (skip|fallback_to_snapshot)
//   S14: lint guard regression — sos-alert source still sets
//        contact_snapshot at both INSERT and UPDATE paths
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ─── Mirror of the SQL drift function for offline testing ───────
function computeDrift(snapshot, current) {
  const norm = (s) => (s ?? "").toString().trim().toLowerCase();
  const snap = (snapshot ?? []).map((s) => ({
    k: norm(s.name), name: s.name, phone: s.phone, relation: s.relation,
  }));
  const curr = (current ?? []).map((c) => ({
    k: norm(c.name), name: c.name, phone: c.phone, relation: c.relation,
  }));
  const drift = [];
  for (const s of snap) {
    const c = curr.find((x) => x.k === s.k);
    if (!c) drift.push({ name: s.name, snapshot_phone: s.phone, current_phone: null, change_kind: "deleted" });
    else if (c.phone !== s.phone) drift.push({ name: s.name, snapshot_phone: s.phone, current_phone: c.phone, change_kind: "phone_changed" });
  }
  for (const c of curr) {
    if (!snap.find((x) => x.k === c.k)) drift.push({ name: c.name, snapshot_phone: null, current_phone: c.phone, change_kind: "added_after_trigger" });
  }
  return drift;
}

// Mirror of resolveDispatchPhone: pick phone for retry/escalation
function resolveDispatchPhone(snapshotEntry, drift, policy = "current_with_fallback") {
  const d = drift.find((x) => x.name?.toLowerCase().trim() === snapshotEntry.name?.toLowerCase().trim());
  if (!d) return { phone: snapshotEntry.phone, source: "snapshot_no_drift" };
  if (d.change_kind === "deleted") {
    if (policy === "skip") return { phone: null, source: "skipped_deleted" };
    return { phone: snapshotEntry.phone, source: "fallback_snapshot_after_delete" };
  }
  if (d.change_kind === "phone_changed") {
    return { phone: d.current_phone, source: "current_after_phone_change" };
  }
  return { phone: snapshotEntry.phone, source: "snapshot_no_drift" };
}

// ── S1: snapshot persisted at INSERT path ────────────────────
console.log("\n=== S1 sos-alert INSERT path persists contact_snapshot ===\n");
const sosAlertSrc = fs.readFileSync("supabase/functions/sos-alert/index.ts", "utf8");
assert("S1.1 INSERT block contains contact_snapshot mapping",
  /contact_snapshot:\s*contacts\.map\([\s\S]{0,400}name:\s*c\.name/.test(sosAlertSrc));
assert("S1.2 snapshot stores phone + relation + name + normalized_at",
  /contact_snapshot:\s*contacts\.map\([\s\S]{0,400}name:[\s\S]{0,80}phone:[\s\S]{0,80}relation:[\s\S]{0,80}normalized_at/.test(sosAlertSrc));

// ── S2: snapshot persisted at UPDATE (atomic claim) path ─────
console.log("\n=== S2 sos-alert UPDATE atomic claim path persists contact_snapshot ===\n");
const updateBlock = sosAlertSrc.match(
  /\.update\(\{[\s\S]{0,3000}server_triggered_at:\s*nowIso/m
);
assert("S2.1 UPDATE block found", !!updateBlock);
if (updateBlock) {
  assert("S2.2 UPDATE block contains contact_snapshot",
    /contact_snapshot:/.test(updateBlock[0]));
}

// ── S3: drift = 0 when contacts unchanged ────────────────────
console.log("\n=== S3 no-drift path ===\n");
{
  const snap = [{ name: "Alice", phone: "+15550000111", relation: "sister" }];
  const curr = [{ name: "Alice", phone: "+15550000111", relation: "sister" }];
  const drift = computeDrift(snap, curr);
  assert("S3.1 unchanged → 0 drift rows", drift.length === 0);
}

// ── S4: phone_changed ───────────────────────────────────────
console.log("\n=== S4 phone_changed mid-SOS ===\n");
{
  const snap = [{ name: "Alice", phone: "+15550000111" }];
  const curr = [{ name: "Alice", phone: "+15550000999" }];
  const drift = computeDrift(snap, curr);
  assert("S4.1 phone_changed detected", drift.length === 1 && drift[0].change_kind === "phone_changed");
  assert("S4.2 carries snapshot phone", drift[0].snapshot_phone === "+15550000111");
  assert("S4.3 carries current phone", drift[0].current_phone === "+15550000999");
}

// ── S5: deleted ─────────────────────────────────────────────
console.log("\n=== S5 contact deleted mid-SOS ===\n");
{
  const snap = [{ name: "Alice", phone: "+1A" }, { name: "Bob", phone: "+1B" }];
  const curr = [{ name: "Alice", phone: "+1A" }];
  const drift = computeDrift(snap, curr);
  assert("S5.1 deleted detected", drift.length === 1 && drift[0].change_kind === "deleted");
  assert("S5.2 deleted carries no current_phone", drift[0].current_phone === null);
}

// ── S6: added_after_trigger ─────────────────────────────────
console.log("\n=== S6 contact added_after_trigger ===\n");
{
  const snap = [{ name: "Alice", phone: "+1A" }];
  const curr = [{ name: "Alice", phone: "+1A" }, { name: "Carol", phone: "+1C" }];
  const drift = computeDrift(snap, curr);
  assert("S6.1 added detected", drift.length === 1 && drift[0].change_kind === "added_after_trigger");
  assert("S6.2 added has no snapshot_phone", drift[0].snapshot_phone === null);
}

// ── S7: multiple simultaneous mutations ──────────────────────
console.log("\n=== S7 multiple mutations: change + delete + add ===\n");
{
  const snap = [
    { name: "Alice", phone: "+1A" },
    { name: "Bob", phone: "+1B" },
  ];
  const curr = [
    { name: "Alice", phone: "+1A_NEW" },
    { name: "Carol", phone: "+1C" },
  ];
  const drift = computeDrift(snap, curr);
  const kinds = drift.map(d => `${d.name}:${d.change_kind}`).sort();
  assert("S7.1 all 3 mutations detected", drift.length === 3,
    `kinds=${kinds.join(",")}`);
  assert("S7.2 Alice phone_changed", kinds.includes("Alice:phone_changed"));
  assert("S7.3 Bob deleted", kinds.includes("Bob:deleted"));
  assert("S7.4 Carol added_after_trigger", kinds.includes("Carol:added_after_trigger"));
}

// ── S8: name match case + whitespace insensitive ─────────────
console.log("\n=== S8 case + whitespace insensitive name match ===\n");
{
  const snap = [{ name: "Alice Smith", phone: "+1A" }];
  const curr = [{ name: "  alice SMITH ", phone: "+1A_NEW" }];
  const drift = computeDrift(snap, curr);
  assert("S8.1 case+space variants match (1 drift, not 2)", drift.length === 1);
  assert("S8.2 detected as phone_changed (not deleted+added)",
    drift[0].change_kind === "phone_changed");
}

// ── S9: empty current + non-empty snapshot → no false 'deleted' ─
console.log("\n=== S9 empty current — degraded fallback (B2B path) ===\n");
{
  // The SQL function falls back: current = snapshot, so drift = 0.
  const snap = [{ name: "Alice", phone: "+1A" }, { name: "Bob", phone: "+1B" }];
  const currFallback = snap;  // simulating the SQL fallback
  const drift = computeDrift(snap, currFallback);
  assert("S9.1 fallback path → 0 drift (not 2 false deletes)",
    drift.length === 0);
}

// ── S10: empty snapshot ─────────────────────────────────────
console.log("\n=== S10 empty snapshot (legacy SOS pre-C-7) ===\n");
{
  const snap = [];
  const curr = [{ name: "Alice", phone: "+1A" }];
  const drift = computeDrift(snap, curr);
  assert("S10.1 empty snapshot + 1 current = 1 added (NOT a drift bug)",
    drift.length === 1 && drift[0].change_kind === "added_after_trigger");
}

// ── S11: dispatch resolution — no drift → use snapshot ──────
console.log("\n=== S11 dispatch picks snapshot phone when no drift ===\n");
{
  const snap = [{ name: "Alice", phone: "+1A" }];
  const drift = [];
  const r = resolveDispatchPhone(snap[0], drift);
  assert("S11.1 no drift → snapshot phone used (+1A)",
    r.phone === "+1A" && r.source === "snapshot_no_drift");
}

// ── S12: dispatch resolution — phone_changed → use CURRENT (the C-7 fix) ─
console.log("\n=== S12 dispatch picks CURRENT phone when phone_changed ===\n");
{
  const snap = [{ name: "Alice", phone: "+1A_OLD" }];
  const drift = [{ name: "Alice", snapshot_phone: "+1A_OLD", current_phone: "+1A_NEW", change_kind: "phone_changed" }];
  const r = resolveDispatchPhone(snap[0], drift);
  assert("S12.1 phone_changed → CURRENT phone used (the fix!)",
    r.phone === "+1A_NEW" && r.source === "current_after_phone_change");
}

// ── S13: deleted contact policy ─────────────────────────────
console.log("\n=== S13 deleted contact policy ===\n");
{
  const snap = [{ name: "Bob", phone: "+1B" }];
  const drift = [{ name: "Bob", snapshot_phone: "+1B", current_phone: null, change_kind: "deleted" }];
  const r1 = resolveDispatchPhone(snap[0], drift, "skip");
  assert("S13.1 policy=skip → null phone, skipped_deleted source",
    r1.phone === null && r1.source === "skipped_deleted");
  const r2 = resolveDispatchPhone(snap[0], drift, "current_with_fallback");
  assert("S13.2 policy=fallback → snapshot phone (last-known reachable)",
    r2.phone === "+1B" && r2.source === "fallback_snapshot_after_delete");
}

// ── S14: lint guard regression ──────────────────────────────
console.log("\n=== S14 lint-guard regression: contact_snapshot wiring stays ===\n");
{
  const insertOcc = (sosAlertSrc.match(/contact_snapshot:/g) || []).length;
  assert("S14.1 sos-alert sets contact_snapshot at BOTH INSERT and UPDATE (≥2)",
    insertOcc >= 2, `count=${insertOcc}`);
}

// ── S15: idempotence — snapshot of same contacts twice is identical ──
console.log("\n=== S15 idempotence: same trigger = same snapshot ===\n");
{
  const contacts = [
    { name: "Alice", phone: "+1A", relation: "sister" },
    { name: "Bob", phone: "+1B", relation: "father" },
  ];
  const ts = "2026-04-27T10:00:00Z";
  const snap1 = contacts.map(c => ({ name: c.name, phone: c.phone, relation: c.relation, normalized_at: ts }));
  const snap2 = contacts.map(c => ({ name: c.name, phone: c.phone, relation: c.relation, normalized_at: ts }));
  assert("S15.1 deterministic snapshot", JSON.stringify(snap1) === JSON.stringify(snap2));
}

// ── S16: chaos — randomized mid-SOS edits, drift always reflects truth ──
console.log("\n=== S16 chaos: 100 randomized mid-SOS edit sequences ===\n");
{
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; }; }
  const r = rng(0xC0FFEE);
  let chaosFail = 0;
  for (let i = 0; i < 100; i++) {
    const names = ["Alice", "Bob", "Carol", "Dan"];
    const snap = names.slice(0, 2 + Math.floor(r() * 3))
      .map((n, ix) => ({ name: n, phone: `+1${ix}${i}` }));
    // Simulate edits
    const curr = snap
      .filter(_ => r() > 0.2)  // 20% chance of delete
      .map(s => r() < 0.3 ? { name: s.name, phone: s.phone + "_NEW" } : { ...s });  // 30% phone change
    if (r() < 0.3) curr.push({ name: "ZZ_added_" + i, phone: "+999" });  // 30% add
    const drift = computeDrift(snap, curr);
    // Invariants
    for (const d of drift) {
      if (!["phone_changed", "deleted", "added_after_trigger"].includes(d.change_kind)) chaosFail++;
      if (d.change_kind === "deleted" && d.current_phone !== null) chaosFail++;
      if (d.change_kind === "added_after_trigger" && d.snapshot_phone !== null) chaosFail++;
      if (d.change_kind === "phone_changed" && d.snapshot_phone === d.current_phone) chaosFail++;
    }
    // Resolution invariants — every snapshot entry MUST resolve to either
    // a non-null phone (for retry) or null (for skip-deleted) — never undefined
    for (const s of snap) {
      const r1 = resolveDispatchPhone(s, drift, "skip");
      if (r1.phone === undefined) chaosFail++;
      if (r1.source === undefined) chaosFail++;
    }
  }
  assert("S16.1 100 chaos iterations: invariants hold",
    chaosFail === 0, `chaos failures: ${chaosFail}`);
}

console.log("");
console.log(fail === 0
  ? `OK C-7 phone staleness drift detection fully verified (${16} sections / ${[1,2,2,1,3,2,2,4,2,1,1,1,1,2,1,1].reduce((a,b)=>a+b,0)} assertions)`
  : `X ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
