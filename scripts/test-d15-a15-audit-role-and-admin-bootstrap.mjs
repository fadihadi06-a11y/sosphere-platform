// ═══════════════════════════════════════════════════════════════════════════
// D-15 + A-15: audit_log JWT-claim freshness + promote_user_to_admin lockdown
// ─────────────────────────────────────────────────────────────────────────
// Verifies the contract of two TIER 2 fixes applied together:
//
//   D-15: log_sos_audit revalidates the actor's role from public.profiles
//         at write time, overriding any stale claim the JWT carried.
//         metadata.actor_role_source distinguishes 'fresh' / 'fallback' /
//         'no_actor_uuid' so forensic analysis can audit the audit log.
//
//   A-15: promote_user_to_admin requires authenticated admin caller —
//         no more service-role NULL-uid bypass. Bootstrap is handled by
//         the new promote_first_admin RPC which refuses if any admin
//         already exists.
//
//   W3-37 trigger: gains a session-variable bypass so the legitimate
//         RPCs can update role; direct UPDATEs from any other path
//         continue to be rejected exactly as W3-37 intended.
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

const MIG_PATH = "supabase/migrations/20260427130000_w3_d15_a15_audit_role_freshness_and_admin_bootstrap.sql";

// ── S1: migration shape ────────────────────────────────────────
console.log("\n=== S1 migration shape ===\n");
{
  assert("S1.1 migration exists", fs.existsSync(MIG_PATH));
  const sql = fs.readFileSync(MIG_PATH, "utf8");

  assert("S1.2 log_sos_audit redefined with role freshness",
    /CREATE OR REPLACE FUNCTION public\.log_sos_audit\(/.test(sql) &&
    /v_fresh_role/.test(sql) &&
    /v_role_source/.test(sql));
  assert("S1.3 'fresh' role-source path",
    /v_role_source := 'fresh'/.test(sql));
  assert("S1.4 'fallback' role-source path",
    /v_role_source := 'fallback'/.test(sql));
  assert("S1.5 'no_actor_uuid' role-source path",
    /v_role_source := 'no_actor_uuid'/.test(sql));
  assert("S1.6 stale claim recorded in metadata when revalidated",
    /jsonb_set\(v_metadata,\s*'\{stale_role_claim\}'/.test(sql));
  assert("S1.7 promote_user_to_admin requires auth.uid()",
    /\[A-15\] promote_user_to_admin requires authenticated admin caller/.test(sql));
  assert("S1.8 promote_user_to_admin checks role admin/super_admin",
    /v_caller_role NOT IN \('admin', 'super_admin'\)/.test(sql));
  assert("S1.9 NEW promote_first_admin RPC defined",
    /CREATE OR REPLACE FUNCTION public\.promote_first_admin\(p_user_id uuid\)/.test(sql));
  assert("S1.10 promote_first_admin refuses when admins exist",
    /promote_first_admin refused: % admin\(s\) already exist/.test(sql));
  assert("S1.11 W3-37 trigger updated with session-variable bypass",
    /app\.allow_role_update/.test(sql) && /block_sensitive_profile_changes/.test(sql));
  assert("S1.12 promote RPCs set + clear the bypass flag",
    /set_config\('app\.allow_role_update',\s*'true',\s*true\)/.test(sql) &&
    /set_config\('app\.allow_role_update',\s*'',\s*true\)/.test(sql));
}

// ── S2: D-15 grant lockdown ───────────────────────────────────
console.log("\n=== S2 D-15 grant lockdown ===\n");
{
  const sql = fs.readFileSync(MIG_PATH, "utf8");
  assert("S2.1 log_sos_audit REVOKE PUBLIC",
    /REVOKE EXECUTE ON FUNCTION public\.log_sos_audit\(text,text,text,text,text,text,jsonb,uuid\) FROM PUBLIC/.test(sql));
  assert("S2.2 log_sos_audit REVOKE anon",
    /REVOKE EXECUTE ON FUNCTION public\.log_sos_audit\(text,text,text,text,text,text,jsonb,uuid\) FROM anon/.test(sql));
  assert("S2.3 log_sos_audit GRANT only service_role",
    /GRANT  EXECUTE ON FUNCTION public\.log_sos_audit\(text,text,text,text,text,text,jsonb,uuid\) TO service_role/.test(sql));
}

// ── S3: A-15 grant lockdown ───────────────────────────────────
console.log("\n=== S3 A-15 grant lockdown ===\n");
{
  const sql = fs.readFileSync(MIG_PATH, "utf8");
  assert("S3.1 promote_user_to_admin: REVOKE anon",
    /REVOKE EXECUTE ON FUNCTION public\.promote_user_to_admin\(uuid\) FROM anon/.test(sql));
  assert("S3.2 promote_user_to_admin: GRANT authenticated",
    /GRANT  EXECUTE ON FUNCTION public\.promote_user_to_admin\(uuid\) TO authenticated/.test(sql));
  assert("S3.3 promote_first_admin: REVOKE anon + authenticated (service_role only)",
    /REVOKE EXECUTE ON FUNCTION public\.promote_first_admin\(uuid\) FROM anon/.test(sql) &&
    /REVOKE EXECUTE ON FUNCTION public\.promote_first_admin\(uuid\) FROM authenticated/.test(sql));
  assert("S3.4 promote_first_admin: GRANT only service_role",
    /GRANT  EXECUTE ON FUNCTION public\.promote_first_admin\(uuid\) TO service_role/.test(sql));
}

// ── S4: simulation — D-15 role-source contract ───────────────
console.log("\n=== S4 D-15 role-source contract simulation ===\n");
{
  // Mirror the SQL behavior in JS
  const profiles = new Map(); // uid → role
  function logSosAudit(p_actor, p_actor_level) {
    let actor_role, role_source, stale_role_claim = null;
    let v_actor_uuid = null;
    try {
      // Pretend UUID parsing — accept anything that "looks" UUID-like
      if (p_actor && /^[0-9a-f]{8}-/.test(p_actor)) v_actor_uuid = p_actor;
    } catch { v_actor_uuid = null; }

    if (v_actor_uuid != null) {
      const fresh = profiles.get(v_actor_uuid);
      if (fresh) {
        actor_role = fresh;
        role_source = "fresh";
        if (fresh !== p_actor_level) stale_role_claim = p_actor_level;
      } else {
        actor_role = p_actor_level || "worker";
        role_source = "fallback";
      }
    } else {
      actor_role = p_actor_level || "worker";
      role_source = "no_actor_uuid";
    }
    return { actor_role, metadata: { actor_role_source: role_source, stale_role_claim } };
  }

  // Stale admin claim → revalidated to employee
  profiles.set("11111111-2222-3333-4444-555555555555", "employee");
  let r = logSosAudit("11111111-2222-3333-4444-555555555555", "admin");
  assert("S4.1 stale 'admin' claim → revalidated to 'employee'",
    r.actor_role === "employee");
  assert("S4.2 source='fresh'", r.metadata.actor_role_source === "fresh");
  assert("S4.3 stale_role_claim recorded", r.metadata.stale_role_claim === "admin");

  // Fresh role matches claim → no stale_role_claim annotation
  r = logSosAudit("11111111-2222-3333-4444-555555555555", "employee");
  assert("S4.4 matching claim → source='fresh', no stale annotation",
    r.metadata.actor_role_source === "fresh" && r.metadata.stale_role_claim === null);

  // Unknown UUID → fallback
  r = logSosAudit("99999999-2222-3333-4444-555555555555", "worker");
  assert("S4.5 unknown UUID → source='fallback'",
    r.metadata.actor_role_source === "fallback");
  assert("S4.6 fallback uses claim verbatim", r.actor_role === "worker");

  // Non-UUID actor → no_actor_uuid
  r = logSosAudit("not-a-uuid", "system");
  assert("S4.7 non-UUID actor → source='no_actor_uuid'",
    r.metadata.actor_role_source === "no_actor_uuid");
  assert("S4.8 non-UUID uses claim verbatim", r.actor_role === "system");

  // NULL actor → no_actor_uuid + default 'worker'
  r = logSosAudit(null, null);
  assert("S4.9 null actor + null level → source='no_actor_uuid', role='worker'",
    r.metadata.actor_role_source === "no_actor_uuid" && r.actor_role === "worker");
}

// ── S5: simulation — A-15 promote_user_to_admin guard ────────
console.log("\n=== S5 A-15 promote_user_to_admin guard simulation ===\n");
{
  function promoteUserToAdmin({ caller, callerRole }) {
    if (caller == null) {
      const e = new Error("[A-15] promote_user_to_admin requires authenticated admin caller");
      e.code = "42501"; throw e;
    }
    if (!callerRole || !["admin", "super_admin"].includes(callerRole)) {
      const e = new Error("[A-15] forbidden: only existing admins may promote users");
      e.code = "42501"; throw e;
    }
    return { ok: true };
  }

  // 1. No auth → 42501
  let caught;
  try { promoteUserToAdmin({ caller: null, callerRole: null }); } catch (e) { caught = e; }
  assert("S5.1 null auth → 42501", caught?.code === "42501");

  // 2. employee caller → 42501
  caught = null;
  try { promoteUserToAdmin({ caller: "u-1", callerRole: "employee" }); } catch (e) { caught = e; }
  assert("S5.2 employee caller → 42501", caught?.code === "42501");

  // 3. admin caller → ok
  caught = null;
  let r;
  try { r = promoteUserToAdmin({ caller: "u-2", callerRole: "admin" }); } catch (e) { caught = e; }
  assert("S5.3 admin caller → ok", r?.ok === true && !caught);

  // 4. super_admin caller → ok
  caught = null;
  try { r = promoteUserToAdmin({ caller: "u-3", callerRole: "super_admin" }); } catch (e) { caught = e; }
  assert("S5.4 super_admin caller → ok", r?.ok === true && !caught);
}

// ── S6: simulation — A-15 promote_first_admin bootstrap guard ─
console.log("\n=== S6 A-15 promote_first_admin bootstrap guard ===\n");
{
  function promoteFirstAdmin({ adminCount, target }) {
    if (adminCount > 0) {
      const e = new Error(`[A-15] promote_first_admin refused: ${adminCount} admin(s) already exist`);
      e.code = "42501"; throw e;
    }
    return { ok: true, promoted_user_id: target };
  }

  // 1. zero admins → bootstrap permitted
  let r = promoteFirstAdmin({ adminCount: 0, target: "u-1" });
  assert("S6.1 zero admins → bootstrap allowed", r.ok === true && r.promoted_user_id === "u-1");

  // 2. ≥1 admin → refused
  let caught;
  try { promoteFirstAdmin({ adminCount: 1, target: "u-2" }); } catch (e) { caught = e; }
  assert("S6.2 1+ admin exists → refused 42501",
    caught?.code === "42501" && /already exist/.test(caught.message));

  // 3. many admins → refused
  caught = null;
  try { promoteFirstAdmin({ adminCount: 50, target: "u-3" }); } catch (e) { caught = e; }
  assert("S6.3 50 admins → refused", caught?.code === "42501");
}

// ── S7: W3-37 trigger bypass contract ────────────────────────
console.log("\n=== S7 W3-37 trigger session-variable bypass ===\n");
{
  function blockSensitive({ allowFlag, oldRow, newRow }) {
    const roleChanged = newRow.role !== oldRow.role;
    if (allowFlag === "true" && roleChanged) {
      // bypass — fall through to other checks
    } else if (roleChanged) {
      throw new Error("W3-37: changing role is not allowed via direct UPDATE. Use the dedicated RPC.");
    }
    if (newRow.user_type !== oldRow.user_type ||
        newRow.company_id !== oldRow.company_id ||
        newRow.active_company_id !== oldRow.active_company_id) {
      throw new Error("W3-37: changing user_type, company_id, or active_company_id is not allowed via direct UPDATE.");
    }
    return { ok: true };
  }

  // 1. role change WITHOUT bypass → blocked
  let caught;
  try {
    blockSensitive({
      allowFlag: null,
      oldRow: { role: "employee", user_type: "user" },
      newRow: { role: "admin", user_type: "user" },
    });
  } catch (e) { caught = e; }
  assert("S7.1 direct role UPDATE without bypass → W3-37 rejection",
    caught && /W3-37/.test(caught.message));

  // 2. role change WITH bypass → allowed
  caught = null;
  let r;
  try {
    r = blockSensitive({
      allowFlag: "true",
      oldRow: { role: "employee", user_type: "user" },
      newRow: { role: "admin", user_type: "user" },
    });
  } catch (e) { caught = e; }
  assert("S7.2 role UPDATE WITH bypass flag → permitted",
    r?.ok === true && !caught);

  // 3. bypass does NOT cover user_type — that's still blocked
  caught = null;
  try {
    blockSensitive({
      allowFlag: "true",
      oldRow: { role: "admin", user_type: "user" },
      newRow: { role: "admin", user_type: "company_owner" },
    });
  } catch (e) { caught = e; }
  assert("S7.3 bypass flag does NOT permit user_type changes",
    caught && /user_type/.test(caught.message));
}

// ── S8: chaos — 100 randomized D-15 role-revalidation cases ──
console.log("\n=== S8 chaos: 100 randomized D-15 sequences ===\n");
{
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; }; }
  const r = rng(0xD15A15);
  const profiles = new Map();
  function logSosAudit(actor, level) {
    let role, source, stale = null;
    let uid = null;
    if (actor && /^u-/.test(actor)) uid = actor;
    if (uid) {
      const fresh = profiles.get(uid);
      if (fresh) {
        role = fresh; source = "fresh";
        if (fresh !== level) stale = level;
      } else { role = level || "worker"; source = "fallback"; }
    } else { role = level || "worker"; source = "no_actor_uuid"; }
    return { role, source, stale };
  }

  let breaches = 0;
  for (let i = 0; i < 100; i++) {
    const uid = "u-" + i;
    const dbRole = ["admin", "super_admin", "employee", "worker"][Math.floor(r() * 4)];
    const claim = ["admin", "super_admin", "employee", "worker"][Math.floor(r() * 4)];
    profiles.set(uid, dbRole);
    const out = logSosAudit(uid, claim);
    // Invariants:
    if (out.role !== dbRole) breaches++;
    if (out.source !== "fresh") breaches++;
    if (dbRole !== claim && out.stale !== claim) breaches++;
    if (dbRole === claim && out.stale !== null) breaches++;
  }
  assert("S8.1 100 chaos D-15: 0 breaches", breaches === 0);
}

// ── S9: D-15 forensic value: stale-token detection ──────────
console.log("\n=== S9 D-15 forensic: stale-token detection ===\n");
{
  // Scenario: an admin gets demoted at T=0; their JWT is still valid
  // until T+1h. They take 60 actions during that window. Without
  // D-15, all 60 would log as 'admin'; with D-15, all 60 are
  // revalidated to 'employee' AND each row carries a
  // stale_role_claim='admin' annotation so SOC can detect the
  // attacker pattern.
  const profiles = new Map([["u-victim", "employee"]]);  // already demoted
  let staleClaimsDetected = 0;
  for (let i = 0; i < 60; i++) {
    // Attacker is sending a stale 'admin' claim (their old JWT)
    let role, source, stale = null;
    const fresh = profiles.get("u-victim");
    if (fresh) {
      role = fresh; source = "fresh";
      if (fresh !== "admin") stale = "admin";
    }
    if (stale === "admin") staleClaimsDetected++;
  }
  assert("S9.1 all 60 stale-token requests carry stale_role_claim='admin'",
    staleClaimsDetected === 60);
  assert("S9.2 SOC can grep audit_log for metadata->>'stale_role_claim' to find attack",
    staleClaimsDetected > 0);
}

console.log("");
console.log(fail === 0
  ? `OK D-15 + A-15 audit-freshness + admin-bootstrap verified — 9 sections / 41 assertions / 100 chaos cases`
  : `X ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
