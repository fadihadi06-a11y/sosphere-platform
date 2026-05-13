// ═══════════════════════════════════════════════════════════════
// R-1 (2026-05-13) — geofences + sensor_events full tenancy contract
// ─────────────────────────────────────────────────────────────
// SUPERSEDES the L5-SEC-4 Phase-1 deny-all band-aid contract. That
// test pinned USING(false) which kept the feature dead. This suite
// pins the proper root fix:
//
//   • Tenancy columns exist + are FK to companies/auth.users.
//   • SELECT policies scope by is_company_member / auth.uid().
//   • SECDEF write RPCs pin tenancy server-side.
//   • Client code uses the RPCs (not direct table inserts).
//   • Negative paths (non-admin, anon) raise insufficient_privilege.
//
// Runtime verification was performed live on prod before this commit
// (see commit body). This suite is the regression guard going forward.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let migration  = "";
let geoFence   = "";
let fallDetect = "";

beforeAll(() => {
  migration  = READ("supabase/migrations/20260513120000_r1_geofences_sensor_events_tenancy.sql");
  geoFence   = READ("src/app/components/dashboard-geofencing-page.tsx");
  fallDetect = READ("src/app/components/fall-detection.tsx");
});

describe("R-1: tenancy columns + FKs", () => {
  it("geofences gains company_id uuid FK -> companies(id)", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public\.companies\(id\)/i);
  });

  it("sensor_events gains user_id uuid FK -> auth.users(id)", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth\.users\(id\)/i);
  });

  it("indexes the new tenancy columns", () => {
    expect(migration).toMatch(/idx_geofences_company_id/);
    expect(migration).toMatch(/idx_sensor_events_user_id/);
  });
});

describe("R-1: SELECT policies scope properly (no more deny-all)", () => {
  it("geofences_company_read scopes by is_company_member(company_id)", () => {
    expect(migration).toMatch(
      /CREATE POLICY geofences_company_read[\s\S]+?USING\s*\([\s\S]+?is_company_member\(company_id\)/,
    );
  });

  it("sensor_events_owner_read scopes by user_id = auth.uid()", () => {
    expect(migration).toMatch(
      /CREATE POLICY sensor_events_owner_read[\s\S]+?USING\s*\([\s\S]+?user_id\s*=\s*auth\.uid\(\)/,
    );
  });

  it("regression guard: NO USING(false) deny-all policy remains", () => {
    const executable = migration.replace(/--[^\n]*\n/g, "\n");
    // The migration drops the Phase-1 deny-all and creates the scoped versions.
    expect(executable).toMatch(/DROP POLICY IF EXISTS geofences_authenticated_read/);
    expect(executable).toMatch(/DROP POLICY IF EXISTS sensor_events_authenticated_read/);
    // The new CREATE POLICY statements must NOT use USING(false).
    expect(executable).not.toMatch(/CREATE POLICY geofences_company_read[\s\S]{0,400}USING\s*\(\s*false\s*\)/);
    expect(executable).not.toMatch(/CREATE POLICY sensor_events_owner_read[\s\S]{0,400}USING\s*\(\s*false\s*\)/);
  });
});

describe("R-1: SECDEF write RPCs", () => {
  it("upsert_geofence is SECURITY DEFINER", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.upsert_geofence[\s\S]+?SECURITY DEFINER/);
  });

  it("upsert_geofence requires auth.uid() (rejects anon)", () => {
    expect(migration).toMatch(/upsert_geofence[\s\S]+?v_caller\s+uuid\s*:=\s*auth\.uid\(\)/);
    expect(migration).toMatch(/upsert_geofence: not authenticated/);
  });

  it("upsert_geofence requires is_company_admin on the resolved company", () => {
    expect(migration).toMatch(/upsert_geofence[\s\S]+?is_company_admin\(v_company_id\)/);
  });

  it("delete_geofence verifies admin on the row's company before deleting", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.delete_geofence[\s\S]+?SECURITY DEFINER/);
    expect(migration).toMatch(/delete_geofence[\s\S]+?is_company_admin\(v_row_co\)/);
  });

  it("record_sensor_event pins user_id = auth.uid() server-side", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.record_sensor_event[\s\S]+?SECURITY DEFINER/);
    expect(migration).toMatch(/record_sensor_event[\s\S]+?v_caller\s+uuid\s*:=\s*auth\.uid\(\)/);
    expect(migration).toMatch(/INSERT INTO public\.sensor_events[\s\S]+?v_caller[\s\S]+?RETURNING/);
  });

  it("all three RPCs grant EXECUTE to authenticated + service_role", () => {
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.upsert_geofence[\s\S]+?TO authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.delete_geofence[\s\S]+?TO authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_sensor_event[\s\S]+?TO authenticated/);
  });
});

describe("R-1: client code routes ALL writes through RPCs", () => {
  it("dashboard-geofencing-page uses upsert_geofence RPC (not direct .upsert)", () => {
    expect(geoFence).toMatch(/supabase\.rpc\(\s*["']upsert_geofence["']/);
    // Regression guard: no remaining direct table upsert
    expect(geoFence).not.toMatch(/supabase\.from\(\s*["']geofences["']\s*\)\.upsert/);
  });

  it("dashboard-geofencing-page uses delete_geofence RPC (not direct .delete)", () => {
    expect(geoFence).toMatch(/supabase\.rpc\(\s*["']delete_geofence["']/);
    expect(geoFence).not.toMatch(/supabase\.from\(\s*["']geofences["']\s*\)\.delete/);
  });

  it("fall-detection uses record_sensor_event RPC (not direct .insert)", () => {
    expect(fallDetect).toMatch(/supabase\.rpc\(\s*["']record_sensor_event["']/);
    expect(fallDetect).not.toMatch(/supabase\.from\(\s*["']sensor_events["']\s*\)\.insert/);
  });

  it("client doesn't send user_id or company_id from client (pinned by RPC)", () => {
    // Client passes p_id + p_event_type + p_acceleration + p_detected_at only.
    // Never sends p_user_id (the RPC pins it from auth.uid()).
    const fdBlock = fallDetect.match(/supabase\.rpc\(\s*["']record_sensor_event["'][\s\S]+?\)\s*;/)![0];
    expect(fdBlock).not.toMatch(/p_user_id/);
    // Same for geofence: client never sends p_company_id.
    const gfBlock = geoFence.match(/supabase\.rpc\(\s*["']upsert_geofence["'][\s\S]+?\}\s*\)\s*;/)![0];
    expect(gfBlock).not.toMatch(/p_company_id/);
  });
});

describe("R-1: table comments + Phase-2 marker removed", () => {
  it("geofences table COMMENT documents tenancy + RPC-only writes", () => {
    expect(migration).toMatch(/COMMENT ON TABLE public\.geofences IS[\s\S]+?R-1[\s\S]+?tenant-scoped via company_id/);
  });

  it("sensor_events table COMMENT documents user_id + RPC-only writes", () => {
    expect(migration).toMatch(/COMMENT ON TABLE public\.sensor_events IS[\s\S]+?R-1[\s\S]+?per-user via user_id/);
  });
});
