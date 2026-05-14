// ═══════════════════════════════════════════════════════════════
// R-12 (2026-05-14) — security sweep #2 invariants
// ─────────────────────────────────────────────────────────────
// Pre-launch security re-audit on what changed since L5-SEC (2026-05-09):
//   - R-1: geofences + sensor_events tenancy
//   - R-2: get_my_company_id resolver
//   - R-4a: sos_sessions schema reconcile
//   - R-8: backgroundOrAwait helper
//   - R-9: empty-catch promotions
//   - R-10: probe-user split
//
// AUDIT METHOD (executed 2026-05-14)
//   1. Tables without RLS in public schema → 0 found
//   2. SECDEF + PUBLIC EXECUTE functions → 49 total
//      Of those:
//        - 32 are user-callable RPCs with auth.uid() guard ✓
//        - 13 are trigger functions (return type 'trigger') ✓
//        - 1 is rls_auto_enable (event_trigger, not RPC) ✓
//        - 3 were maintenance RPCs with NO guard ✗ — LOCKED in R-12:
//            check_rate_limit          (HIGH — DoS by anon vs any user id)
//            archive_old_emergencies   (LOW-MED — lock contention)
//            cleanup_old_locations     (LOW — aged-out data delete)
//
// THE FIX (20260514230000_r12_secdef_grant_lockdown.sql)
//   REVOKE EXECUTE FROM PUBLIC, anon, authenticated on the 3 functions.
//   GRANT EXECUTE TO service_role only. cron job (postgres) bypasses
//   GRANT checks as superuser, so the scheduled cleanup still works.
//
// LIVE VERIFICATION (executed 2026-05-14)
//   has_function_privilege(...) returned for all three:
//     public=false, anon=false, authenticated=false, service_role=true
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let migrationSql = "";
let lockfile = "";

beforeAll(() => {
  migrationSql = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260514230000_r12_secdef_grant_lockdown.sql"),
    "utf8",
  );
  lockfile = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations.lock.json"),
    "utf8",
  );
});

describe("R-12: migration revokes EXECUTE from PUBLIC + anon + authenticated for 3 functions", () => {
  for (const fn of [
    "check_rate_limit(text, text, integer, integer)",
    "archive_old_emergencies()",
    "cleanup_old_locations()",
  ]) {
    it(`${fn}: REVOKE block present`, () => {
      // Build a pattern that matches `REVOKE ALL ON FUNCTION public.<fn> FROM PUBLIC, anon, authenticated`
      const safeFn = fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(migrationSql).toMatch(
        new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${safeFn}\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`, "i"),
      );
    });
  }
});

describe("R-12: migration grants EXECUTE only to service_role for the same 3 functions", () => {
  for (const fn of [
    "check_rate_limit(text, text, integer, integer)",
    "archive_old_emergencies()",
    "cleanup_old_locations()",
  ]) {
    it(`${fn}: service_role GRANT present`, () => {
      const safeFn = fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(migrationSql).toMatch(
        new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${safeFn}\\s+TO\\s+service_role`, "i"),
      );
    });
  }
});

describe("R-12: each fix is documented with a COMMENT ON FUNCTION", () => {
  it("check_rate_limit has R-12 comment", () => {
    expect(migrationSql).toMatch(/COMMENT\s+ON\s+FUNCTION\s+public\.check_rate_limit[\s\S]{0,500}R-12/);
  });

  it("archive_old_emergencies has R-12 comment", () => {
    expect(migrationSql).toMatch(/COMMENT\s+ON\s+FUNCTION\s+public\.archive_old_emergencies[\s\S]{0,500}R-12/);
  });

  it("cleanup_old_locations has R-12 comment", () => {
    expect(migrationSql).toMatch(/COMMENT\s+ON\s+FUNCTION\s+public\.cleanup_old_locations[\s\S]{0,500}R-12/);
  });
});

describe("R-12: migration is registered in the lockfile", () => {
  it("supabase/migrations.lock.json contains r12_secdef_grant_lockdown", () => {
    expect(lockfile).toMatch(/r12_secdef_grant_lockdown/);
  });
});
