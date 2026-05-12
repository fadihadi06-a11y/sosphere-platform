// ═══════════════════════════════════════════════════════════════
// L5-SEC-4 (2026-05-12) — geofences + sensor_events deny-all read
// ─────────────────────────────────────────────────────────────
// Pre-launch security review: both tables had
//   CREATE POLICY ... FOR SELECT TO authenticated USING (true)
// from the G-31 migration, and neither table has a tenancy column.
// Any authenticated user could read all rows across tenants.
//
// Phase 1 fix (this commit): USING(true) → USING(false) on both
// tables + W3-8-style grants tightening + FORCE RLS. Practical
// impact today is zero (geofences = 0 rows, sensor_events has no
// reader, fall-detection writes were already RLS-denied).
//
// Phase 2 (post-launch): add proper tenancy columns + SECDEF write
// RPCs + replace USING(false) with USING(<tenant scope>).
//
// This suite pins both the deny-all read policy AND the W3-8-style
// grant tightening so a future migration can't silently re-open
// either layer.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let migration = "";

beforeAll(() => {
  migration = READ("supabase/migrations/20260512170000_l5_sec_4_geofences_sensor_events_rls.sql");
});

describe("L5-SEC-4: deny-all SELECT policies", () => {
  it("geofences SELECT policy USING(false)", () => {
    expect(migration).toMatch(
      /CREATE POLICY geofences_authenticated_read\s+ON public\.geofences FOR SELECT TO authenticated\s+USING \(false\)/,
    );
  });

  it("sensor_events SELECT policy USING(false)", () => {
    expect(migration).toMatch(
      /CREATE POLICY sensor_events_authenticated_read\s+ON public\.sensor_events FOR SELECT TO authenticated\s+USING \(false\)/,
    );
  });

  it("regression guard: no CREATE POLICY uses USING(true) on either table", () => {
    // Strip SQL comments + string literals (where we keep historical
    // USING(true) references for documentation), then assert that no
    // executable CREATE POLICY statement uses USING(true).
    const executable = migration
      .replace(/--[^\n]*\n/g, "\n")          // strip line comments
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");   // strip string literals
    const danger = /CREATE\s+POLICY[\s\S]+?USING\s*\(\s*true\s*\)/i;
    expect(executable).not.toMatch(danger);
  });
});

describe("L5-SEC-4: W3-8-style grant tightening", () => {
  it("REVOKEs write privileges from anon + authenticated on geofences", () => {
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.geofences\s+FROM anon, authenticated/,
    );
  });

  it("REVOKEs write privileges from anon + authenticated on sensor_events", () => {
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.sensor_events FROM anon, authenticated/,
    );
  });

  it("REVOKEs ALL from anon (no read either) on both tables", () => {
    expect(migration).toMatch(/REVOKE ALL\s+ON public\.geofences\s+FROM anon/);
    expect(migration).toMatch(/REVOKE ALL\s+ON public\.sensor_events\s+FROM anon/);
  });

  it("keeps SELECT for authenticated (RLS USING(false) still denies)", () => {
    expect(migration).toMatch(/GRANT\s+SELECT ON public\.geofences\s+TO authenticated/);
    expect(migration).toMatch(/GRANT\s+SELECT ON public\.sensor_events\s+TO authenticated/);
  });

  it("service_role retains full DML on both tables", () => {
    expect(migration).toMatch(
      /GRANT\s+INSERT, UPDATE, DELETE, SELECT ON public\.geofences\s+TO service_role/,
    );
    expect(migration).toMatch(
      /GRANT\s+INSERT, UPDATE, DELETE, SELECT ON public\.sensor_events\s+TO service_role/,
    );
  });
});

describe("L5-SEC-4: FORCE ROW LEVEL SECURITY", () => {
  it("ALTER TABLE ... FORCE RLS applied to both tables", () => {
    expect(migration).toMatch(/ALTER TABLE public\.geofences\s+FORCE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/ALTER TABLE public\.sensor_events FORCE ROW LEVEL SECURITY/);
  });
});

describe("L5-SEC-4: regression guards", () => {
  it("policy comments document Phase 2 deferred work (discoverability)", () => {
    expect(migration).toMatch(/L5-SEC-4.{0,400}Phase 2.{0,200}company_id/);
    expect(migration).toMatch(/L5-SEC-4.{0,400}Phase 2.{0,200}user_id/);
  });

  it("table COMMENT carries the L5-SEC-4 marker (visible in \\d+)", () => {
    expect(migration).toMatch(/COMMENT ON TABLE public\.geofences IS\s+'L5-SEC-4/
);
    expect(migration).toMatch(/COMMENT ON TABLE public\.sensor_events IS\s+'L5-SEC-4/);
  });
});
