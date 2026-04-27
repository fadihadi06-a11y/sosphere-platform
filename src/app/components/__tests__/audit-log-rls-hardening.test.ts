// ═══════════════════════════════════════════════════════════════
// SOSphere — audit_log RLS hardening contract test
// (CRIT-#10 / W3-8 pinning, 2026-04-27)
// ─────────────────────────────────────────────────────────────
// Migration 20260426190000_w3_8_audit_log_grants_tighten.sql is the
// only thing standing between an authenticated user and the ability
// to write/delete audit rows. If a future migration drops or alters
// it, the forensic chain becomes attacker-mutable again.
//
// This test reads the migration file and PINS the four guarantees:
//   1. REVOKE INSERT/UPDATE/DELETE/TRUNCATE from anon + authenticated
//   2. Only SELECT survives for authenticated (RLS still scopes it)
//   3. ALTER TABLE ... FORCE ROW LEVEL SECURITY (so even table-owner
//      writes hit RLS — protection against accidental owner context)
//   4. service_role retains full INSERT/UPDATE/DELETE/SELECT (used by
//      edge functions to write audit rows)
//
// We also assert the migration filename is intact and not silently
// renamed/removed (which would slip past Supabase's `db push` if the
// migration history table no longer references it).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/20260426190000_w3_8_audit_log_grants_tighten.sql",
);

let sql = "";

beforeAll(() => {
  sql = fs.readFileSync(MIGRATION_PATH, "utf8");
});

describe("CRIT-#10 / W3-8 — audit_log forensic-chain immutability", () => {
  it("migration file exists at the expected path", () => {
    expect(fs.existsSync(MIGRATION_PATH), `missing: ${MIGRATION_PATH}`).toBe(true);
  });

  it("REVOKEs INSERT/UPDATE/DELETE/TRUNCATE from anon and authenticated on audit_log", () => {
    expect(sql).toMatch(
      /REVOKE\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s*,\s*TRUNCATE\s+ON\s+public\.audit_log\s+FROM\s+anon\s*,\s*authenticated/i,
    );
  });

  it("REVOKEs INSERT/UPDATE/DELETE/TRUNCATE from anon and authenticated on audit_logs (legacy sibling)", () => {
    expect(sql).toMatch(
      /REVOKE\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s*,\s*TRUNCATE\s+ON\s+public\.audit_logs\s+FROM\s+anon\s*,\s*authenticated/i,
    );
  });

  it("REVOKEs ALL from anon (no even read access)", () => {
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+public\.audit_log\s+FROM\s+anon/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+public\.audit_logs\s+FROM\s+anon/i);
  });

  it("GRANTs SELECT (only) to authenticated — RLS will further scope rows", () => {
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+public\.audit_log\s+TO\s+authenticated/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+public\.audit_logs\s+TO\s+authenticated/i);
    // And the GRANT line must NOT include INSERT/UPDATE/DELETE.
    const grantLines = sql.split("\n").filter(l =>
      /GRANT\s+\w+.*\s+ON\s+public\.audit_log[s]?\s+TO\s+authenticated/i.test(l));
    expect(grantLines.length, "expected GRANT ... TO authenticated lines").toBeGreaterThan(0);
    for (const line of grantLines) {
      expect(line, `authenticated must not get write privilege: ${line}`)
        .not.toMatch(/INSERT|UPDATE|DELETE/i);
    }
  });

  it("ALTER TABLE ... FORCE ROW LEVEL SECURITY on both audit tables", () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.audit_log\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.audit_logs\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it("service_role retains full INSERT/UPDATE/DELETE/SELECT", () => {
    expect(sql).toMatch(
      /GRANT\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s*,\s*SELECT\s+ON\s+public\.audit_log\s+TO\s+service_role/i,
    );
    expect(sql).toMatch(
      /GRANT\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s*,\s*SELECT\s+ON\s+public\.audit_logs\s+TO\s+service_role/i,
    );
  });

  it("contains the W3-8 marker comment so a future audit can find the rationale", () => {
    expect(sql).toMatch(/W3-8/);
    expect(sql).toMatch(/FORCE ROW LEVEL/i);
  });
});
