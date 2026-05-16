// ═══════════════════════════════════════════════════════════════════════════
// R-24 (2026-05-16) — ORPHANS B-tier cleanup invariants
// ─────────────────────────────────────────────────────────────────────────
// CONTEXT
//   R-21 Layer 2 (ORPHANS.md) surfaced four DB orphans and one inventory
//   typo. R-24 fixed each at the root:
//     1. compliance-dashboard-v2.tsx now wires verify_audit_chain
//     2. migration 20260516220000_r24_orphans_cleanup drops dead RPCs
//        and captures the live trg_notify_emergency trigger in repo
//     3. LAUNCH_INVENTORY.md typo fixed (create_company_v → ..._v2)
//
//   This test locks the contract so future regressions are visible.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let migrationSrc = "";
let complianceSrc = "";
let inventorySrc = "";

beforeAll(() => {
  migrationSrc = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260516220000_r24_orphans_cleanup.sql",
    ),
    "utf8",
  );
  complianceSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/compliance-dashboard-v2.tsx"),
    "utf8",
  );
  inventorySrc = fs.readFileSync(
    path.resolve(process.cwd(), "LAUNCH_INVENTORY.md"),
    "utf8",
  );
});

describe("R-24: dead RPCs are dropped", () => {
  it("drops get_active_emergency(uuid)", () => {
    expect(migrationSrc).toMatch(
      /DROP FUNCTION IF EXISTS public\.get_active_emergency\(uuid\)/,
    );
  });

  it("drops verify_admin_pin(text)", () => {
    expect(migrationSrc).toMatch(
      /DROP FUNCTION IF EXISTS public\.verify_admin_pin\(text\)/,
    );
  });

  it("drops set_admin_pin(text, text)", () => {
    expect(migrationSrc).toMatch(
      /DROP FUNCTION IF EXISTS public\.set_admin_pin\(text, text\)/,
    );
  });
});

describe("R-24: notify_emergency trigger is captured in repo (drift fix)", () => {
  it("DROPs the trigger first for idempotency", () => {
    expect(migrationSrc).toMatch(
      /DROP TRIGGER IF EXISTS trg_notify_emergency ON public\.emergencies/,
    );
  });

  it("CREATEs the trigger with the exact live shape", () => {
    expect(migrationSrc).toMatch(
      /CREATE TRIGGER trg_notify_emergency[\s\S]{0,200}AFTER INSERT ON public\.emergencies[\s\S]{0,200}EXECUTE FUNCTION public\.notify_emergency\(\)/,
    );
  });
});

describe("R-24: compliance dashboard wires verify_audit_chain", () => {
  it("imports the supabase client", () => {
    expect(complianceSrc).toMatch(
      /import\s+\{\s*supabase\s*\}\s+from\s+["']\.\/api\/supabase-client["']/,
    );
  });

  it("invokes verify_audit_chain via supabase.rpc", () => {
    expect(complianceSrc).toMatch(
      /supabase\.rpc\(\s*["']verify_audit_chain["']/,
    );
  });

  it("passes p_company_id from the resolved active membership", () => {
    expect(complianceSrc).toMatch(/p_company_id:\s*companyId/);
    expect(complianceSrc).toMatch(/from\(["']company_memberships["']\)/);
    expect(complianceSrc).toMatch(/in\(["']role["'],\s*\[\s*["']admin["']\s*,\s*["']owner["']\s*\]/);
  });

  it("renders both verified-true and verified-false branches", () => {
    expect(complianceSrc).toMatch(/result\.verified/);
    expect(complianceSrc).toMatch(/Chain integrity verified/);
    expect(complianceSrc).toMatch(/Chain integrity failure/);
  });

  it("surfaces tampered_at_index + tampered_row_id when chain breaks", () => {
    expect(complianceSrc).toMatch(/tampered_at_index/);
    expect(complianceSrc).toMatch(/tampered_row_id/);
  });

  it("renders unauthorized panel when caller lacks admin/owner membership", () => {
    expect(complianceSrc).toMatch(/UnauthorizedPanel/);
  });

  it("does NOT lie about SOC 2 / ISO 27001 certification", () => {
    // R-24 must keep B-18's truthful framing — only chain INTEGRITY, not
    // third-party certification.
    expect(complianceSrc).toMatch(/not third-party SOC 2|no certification|not.{0,30}certification/i);
  });
});

describe("R-24: LAUNCH_INVENTORY typo fixed", () => {
  it("references create_company_v2 (the real RPC name)", () => {
    expect(inventorySrc).toMatch(/create_company_v2/);
  });

  it("no longer references the typo create_company_v (without 2)", () => {
    // Word-boundary so create_company_v2 doesn't accidentally match.
    expect(inventorySrc).not.toMatch(/create_company_v(?!2)\b/);
  });
});
