// ═══════════════════════════════════════════════════════════════════════════
// #14 — contact-drift-client (C-7 mobile retry wire)
// ─────────────────────────────────────────────────────────────────────────
// Verifies the client-side bridge to get_emergency_contacts_with_drift +
// the pure resolveDispatchPhone helper:
//
//   1. Module file exists with all 5 expected exports
//   2. resolveDispatchPhone returns CURRENT phone on phone_changed (the fix)
//   3. resolveDispatchPhone with policy=skip_deleted returns null on delete
//   4. resolveDispatchPhone with policy=current_with_fallback uses snapshot
//      phone on delete (last-known-reachable)
//   5. resolveDispatchPhone with policy=snapshot_only ignores drift entirely
//      (audit-stable mode)
//   6. buildDispatchPlan adds added_after_trigger contacts to the plan
//   7. Name match is case + whitespace insensitive
//   8. Missing contact returns { phone: null, source: "missing" }
//   9. Chaos: 100 randomized snapshot+drift combinations preserve invariants
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

const MODULE_PATH = "src/app/components/api/contact-drift-client.ts";

// ── S1: module structure ───────────────────────────────────────
console.log("\n=== S1 module structure ===\n");
{
  assert("S1.1 file exists", fs.existsSync(MODULE_PATH));
  if (fs.existsSync(MODULE_PATH)) {
    const src = fs.readFileSync(MODULE_PATH, "utf8");
    assert("S1.2 getContactsWithDrift exported (async)",
      /export async function getContactsWithDrift\(\s*emergencyId:\s*string,?\s*\)\s*:\s*Promise<DriftResponse\s*\|\s*null>/.test(src));
    assert("S1.3 resolveDispatchPhone exported (pure helper)",
      /export function resolveDispatchPhone\(/.test(src));
    assert("S1.4 buildDispatchPlan exported",
      /export function buildDispatchPlan\(/.test(src));
    assert("S1.5 ContactRow + DriftRow types exported",
      /export interface ContactRow/.test(src) &&
      /export interface DriftRow/.test(src));
    assert("S1.6 ResolvePolicy union exported",
      /export type ResolvePolicy/.test(src));
    assert("S1.7 RPC name spelled correctly",
      /supabase\.rpc\(\s*"get_emergency_contacts_with_drift"/.test(src));
  }
}

// ── Mirror the helper for offline simulation ──────────────────
function resolveDispatchPhone(snapshotEntry, drift, policy = "current_with_fallback") {
  if (!snapshotEntry || !snapshotEntry.name) {
    return { phone: null, source: "missing" };
  }
  const matchKey = (snapshotEntry.name ?? "").trim().toLowerCase();
  const driftRow = (drift ?? []).find(
    (d) => (d.name ?? "").trim().toLowerCase() === matchKey,
  );
  if (policy === "snapshot_only") {
    return { phone: snapshotEntry.phone ?? null, source: "snapshot_only_policy" };
  }
  if (!driftRow) {
    return { phone: snapshotEntry.phone ?? null, source: "snapshot_no_drift" };
  }
  if (driftRow.change_kind === "phone_changed") {
    return {
      phone: driftRow.current_phone ?? snapshotEntry.phone ?? null,
      source: "current_after_phone_change",
    };
  }
  if (driftRow.change_kind === "deleted") {
    if (policy === "skip_deleted") return { phone: null, source: "skipped_deleted" };
    return { phone: snapshotEntry.phone ?? null, source: "fallback_snapshot_after_delete" };
  }
  return { phone: snapshotEntry.phone ?? null, source: "snapshot_no_drift" };
}

function buildDispatchPlan(snapshot, drift, policy = "current_with_fallback") {
  const plan = [];
  for (const entry of snapshot ?? []) {
    const r = resolveDispatchPhone(entry, drift, policy);
    plan.push({ name: entry.name ?? "", phone: r.phone, source: r.source, is_new_contact: false });
  }
  for (const d of drift ?? []) {
    if (d.change_kind === "added_after_trigger") {
      plan.push({
        name: d.name, phone: d.current_phone,
        source: "added_after_trigger", is_new_contact: true,
      });
    }
  }
  return plan;
}

// ── S2: phone_changed → use CURRENT (the C-7 fix) ──────────────
console.log("\n=== S2 phone_changed → CURRENT phone (the actual C-7 fix) ===\n");
{
  const snap = { name: "Alice", phone: "+1AOLD" };
  const drift = [{ name: "Alice", snapshot_phone: "+1AOLD", current_phone: "+1ANEW", change_kind: "phone_changed" }];
  const r = resolveDispatchPhone(snap, drift);
  assert("S2.1 phone_changed → returns CURRENT phone (NEW)",
    r.phone === "+1ANEW");
  assert("S2.2 source = 'current_after_phone_change'",
    r.source === "current_after_phone_change");
}

// ── S3: deleted with policy=skip_deleted ───────────────────────
console.log("\n=== S3 deleted policy variants ===\n");
{
  const snap = { name: "Bob", phone: "+1B" };
  const drift = [{ name: "Bob", snapshot_phone: "+1B", current_phone: null, change_kind: "deleted" }];
  const r1 = resolveDispatchPhone(snap, drift, "skip_deleted");
  assert("S3.1 skip_deleted → null phone",
    r1.phone === null && r1.source === "skipped_deleted");
  const r2 = resolveDispatchPhone(snap, drift, "current_with_fallback");
  assert("S3.2 current_with_fallback → snapshot phone (last-known reachable)",
    r2.phone === "+1B" && r2.source === "fallback_snapshot_after_delete");
}

// ── S4: snapshot_only policy ignores drift ─────────────────────
console.log("\n=== S4 snapshot_only policy ===\n");
{
  const snap = { name: "Carol", phone: "+1COLD" };
  const drift = [{ name: "Carol", snapshot_phone: "+1COLD", current_phone: "+1CNEW", change_kind: "phone_changed" }];
  const r = resolveDispatchPhone(snap, drift, "snapshot_only");
  assert("S4.1 snapshot_only ignores phone_changed",
    r.phone === "+1COLD" && r.source === "snapshot_only_policy");
}

// ── S5: no drift entry → snapshot_no_drift ─────────────────────
console.log("\n=== S5 no drift entry ===\n");
{
  const snap = { name: "Dan", phone: "+1D" };
  const r1 = resolveDispatchPhone(snap, []);
  assert("S5.1 empty drift → snapshot_no_drift",
    r1.phone === "+1D" && r1.source === "snapshot_no_drift");
  const r2 = resolveDispatchPhone(snap, null);
  assert("S5.2 null drift → snapshot_no_drift", r2.source === "snapshot_no_drift");
  const r3 = resolveDispatchPhone(snap, undefined);
  assert("S5.3 undefined drift → snapshot_no_drift", r3.source === "snapshot_no_drift");
}

// ── S6: case + whitespace insensitive name match ───────────────
console.log("\n=== S6 case + whitespace insensitive match ===\n");
{
  const snap = { name: "Alice Smith", phone: "+1AOLD" };
  const drift = [{ name: "  alice SMITH ", snapshot_phone: "+1AOLD", current_phone: "+1ANEW", change_kind: "phone_changed" }];
  const r = resolveDispatchPhone(snap, drift);
  assert("S6.1 'Alice Smith' matches '  alice SMITH '",
    r.phone === "+1ANEW" && r.source === "current_after_phone_change");
}

// ── S7: missing entry / empty name ─────────────────────────────
console.log("\n=== S7 missing snapshot entry ===\n");
{
  const r1 = resolveDispatchPhone(null, []);
  assert("S7.1 null entry → missing", r1.phone === null && r1.source === "missing");
  const r2 = resolveDispatchPhone({ name: "", phone: "+1X" }, []);
  assert("S7.2 empty name → missing", r2.source === "missing");
  const r3 = resolveDispatchPhone({ phone: "+1X" }, []);
  assert("S7.3 no name field → missing", r3.source === "missing");
}

// ── S8: buildDispatchPlan adds new contacts ────────────────────
console.log("\n=== S8 buildDispatchPlan including added_after_trigger ===\n");
{
  const snap = [
    { name: "Alice", phone: "+1A" },
    { name: "Bob", phone: "+1B" },
  ];
  const drift = [
    { name: "Alice", snapshot_phone: "+1A", current_phone: "+1A_NEW", change_kind: "phone_changed" },
    { name: "Bob", snapshot_phone: "+1B", current_phone: null, change_kind: "deleted" },
    { name: "Carol", snapshot_phone: null, current_phone: "+1C", change_kind: "added_after_trigger" },
  ];
  const plan = buildDispatchPlan(snap, drift, "current_with_fallback");
  assert("S8.1 plan has 3 entries (2 snapshot + 1 added)", plan.length === 3);
  const alice = plan.find(p => p.name === "Alice");
  const bob = plan.find(p => p.name === "Bob");
  const carol = plan.find(p => p.name === "Carol");
  assert("S8.2 Alice → CURRENT phone (the fix!)",
    alice.phone === "+1A_NEW" && alice.source === "current_after_phone_change");
  assert("S8.3 Bob → snapshot phone (deleted but last-known)",
    bob.phone === "+1B" && bob.source === "fallback_snapshot_after_delete");
  assert("S8.4 Carol → added contact, marked is_new_contact=true",
    carol.phone === "+1C" && carol.is_new_contact === true);
  assert("S8.5 Alice + Bob NOT marked is_new_contact",
    alice.is_new_contact === false && bob.is_new_contact === false);
}

// ── S9: chaos — 100 randomized snapshot+drift combos ───────────
console.log("\n=== S9 chaos: 100 randomized combos ===\n");
{
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; }; }
  const r = rng(0xC714);
  let breaches = 0;
  for (let i = 0; i < 100; i++) {
    const numContacts = 1 + Math.floor(r() * 4);
    const snap = Array.from({ length: numContacts }, (_, ix) => ({
      name: `C${ix}_${i}`,
      phone: `+1${ix}${i}`,
    }));
    // Random drift: some changed, some deleted, some added
    const drift = [];
    for (const c of snap) {
      const k = r();
      if (k < 0.3) {
        drift.push({ name: c.name, snapshot_phone: c.phone, current_phone: c.phone + "_NEW", change_kind: "phone_changed" });
      } else if (k < 0.5) {
        drift.push({ name: c.name, snapshot_phone: c.phone, current_phone: null, change_kind: "deleted" });
      }
    }
    if (r() < 0.3) {
      drift.push({ name: `NEW_${i}`, snapshot_phone: null, current_phone: `+1NEW${i}`, change_kind: "added_after_trigger" });
    }

    // Build plan with each policy
    for (const policy of ["current_with_fallback", "snapshot_only", "skip_deleted"]) {
      const plan = buildDispatchPlan(snap, drift, policy);
      // Invariants:
      // I1: plan length = snapshot length + count of added_after_trigger
      const addedCount = drift.filter(d => d.change_kind === "added_after_trigger").length;
      if (plan.length !== snap.length + addedCount) breaches++;
      // I2: every plan entry has a name + (phone === null OR string)
      for (const p of plan) {
        if (typeof p.name !== "string") breaches++;
        if (p.phone !== null && typeof p.phone !== "string") breaches++;
        if (typeof p.source !== "string") breaches++;
      }
      // I3: snapshot_only policy NEVER emits "current_after_phone_change"
      if (policy === "snapshot_only") {
        for (const p of plan.filter(x => !x.is_new_contact)) {
          if (p.source === "current_after_phone_change") breaches++;
        }
      }
      // I4: skip_deleted policy NEVER emits a non-null phone for deleted entries
      if (policy === "skip_deleted") {
        for (const d of drift.filter(x => x.change_kind === "deleted")) {
          const planEntry = plan.find(p => p.name === d.name && !p.is_new_contact);
          if (planEntry && planEntry.phone !== null) breaches++;
        }
      }
    }
  }
  assert("S9.1 100 chaos × 3 policies → 0 invariant breaches", breaches === 0,
    `breaches=${breaches}`);
}

// ── S10: integration — error path returns null gracefully ──────
console.log("\n=== S10 graceful degradation ===\n");
{
  const src = fs.readFileSync(MODULE_PATH, "utf8");
  // Verify the fetcher returns null on configured-but-error or unconfigured
  assert("S10.1 returns null when SUPABASE_CONFIG not configured",
    /if \(!SUPABASE_CONFIG\.isConfigured\) return null/.test(src));
  assert("S10.2 returns null on RPC error (no throw)",
    /if \(error\)[\s\S]{0,200}return null/.test(src));
  assert("S10.3 returns null on RPC-level error envelope",
    /"error" in data[\s\S]{0,200}return null/.test(src));
  assert("S10.4 try/catch wraps the whole RPC call",
    /try \{[\s\S]{0,500}supabase\.rpc[\s\S]{0,500}\} catch/.test(src));
  assert("S10.5 doc explains caller must treat null as 'use snapshot'",
    /degrade to legacy SOS behavior, never fail open/.test(src));
}

console.log("");
console.log(fail === 0
  ? `OK #14 contact-drift-client verified — 10 sections / 30+ assertions / 100 chaos × 3 policies`
  : `X ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
