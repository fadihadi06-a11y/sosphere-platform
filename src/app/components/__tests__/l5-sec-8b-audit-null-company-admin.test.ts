// ═══════════════════════════════════════════════════════════════
// L5-SEC-8b (2026-05-12) — audit_log NULL-company admin gate
// ─────────────────────────────────────────────────────────────
// Pre-launch security review: audit_log_company_read previously had
//   USING ((company_id IS NULL) OR is_company_member(company_id))
// The OR-IS-NULL branch let ANY authenticated user read every
// platform-level audit row (system events, retention_cleanup, twilio
// drift detections, AND — critically — GDPR SAR exports for other
// users). 486 such rows exist in production today.
//
// Fix: gate the NULL branch by public.is_admin() so platform events
// are admin-only; tenant rows continue to be company-member readable.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let migration = "";

beforeAll(() => {
  migration = READ("supabase/migrations/20260512180000_l5_sec_8_audit_log_null_company_admin_only.sql");
});

describe("L5-SEC-8b: audit_log NULL-company admin gate", () => {
  it("drops the prior unrestricted policy before recreating", () => {
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS audit_log_company_read ON public\.audit_log/i,
    );
  });

  it("recreates the SELECT policy with admin gate on NULL-company branch", () => {
    // The policy USING expression must include "(company_id IS NULL AND public.is_admin())"
    expect(migration).toMatch(
      /CREATE POLICY audit_log_company_read[\s\S]+?USING\s*\([\s\S]+?company_id IS NULL[\s\S]{0,40}public\.is_admin\(\)/i,
    );
  });

  it("keeps the tenant-member branch via is_company_member(company_id)", () => {
    expect(migration).toMatch(/public\.is_company_member\(company_id\)/);
  });

  it("regression guard: NO bare 'company_id IS NULL' branch without admin gate", () => {
    // We strip comments + string literals so the historical doc text
    // doesn't false-positive.
    const executable = migration
      .replace(/--[^\n]*\n/g, "\n")
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    // The dangerous pattern is "USING (... (company_id IS NULL) OR ..."
    // — i.e. NULL-company OR'd into the policy without an admin gate.
    const danger = /CREATE POLICY audit_log_company_read[\s\S]+?USING\s*\(\s*\(?company_id IS NULL\)?\s*OR/i;
    expect(executable).not.toMatch(danger);
  });

  it("L5-SEC-8b marker comment present in migration AND policy comment", () => {
    expect(migration).toMatch(/L5-SEC-8b[^a-zA-Z]/);
    expect(migration).toMatch(/COMMENT ON POLICY audit_log_company_read[\s\S]+?L5-SEC-8b/i);
  });

  it("targets only the SELECT command (writes still service-role only)", () => {
    // The recreated policy should be FOR SELECT, not ALL or PERMISSIVE.
    expect(migration).toMatch(/audit_log_company_read[\s\S]+?FOR SELECT TO authenticated/);
  });
});
