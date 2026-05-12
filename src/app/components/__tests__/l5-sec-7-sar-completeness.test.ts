// ═══════════════════════════════════════════════════════════════
// L5-SEC-7 (2026-05-12) — SAR PHI completeness contract
// ─────────────────────────────────────────────────────────────
// Pre-launch security review (GDPR Art. 15 compliance):
//   • medical_profiles: spec said column='employee_id' (bigint legacy
//     column), but the actual RLS policy keys on `id = auth.uid()`
//     (uuid). The user-scoped client query returned ZERO rows for the
//     user's own PHI — a GDPR Art. 15 SAR completeness violation.
//   • companies: spec said column='owner_id' (legacy). The canonical
//     column is `owner_user_id`. Both are populated today (parity)
//     but new rows that only have owner_user_id would be dropped.
//
// This suite pins the corrected TABLE_SPECS columns so a future
// refactor can't silently regress to the broken values.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let edgeFnSrc = "";

beforeAll(() => {
  edgeFnSrc = READ("supabase/functions/export-my-data/index.ts");
});

describe("L5-SEC-7: medical_profiles uses `id` column (matches RLS)", () => {
  it("medical_profiles spec uses column: 'id', NOT 'employee_id'", () => {
    // The fixed spec line must use 'id'.
    expect(edgeFnSrc).toMatch(
      /table:\s*['"]medical_profiles['"]\s*,\s*column:\s*['"]id['"]/,
    );
  });

  it("regression guard: NO medical_profiles spec uses 'employee_id' (broken)", () => {
    // Strip line comments + string-literal stripping isn't needed here
    // — we only check that NO executable spec line pairs medical_profiles
    // with employee_id.
    const broken = /table:\s*['"]medical_profiles['"]\s*,\s*column:\s*['"]employee_id['"]/;
    expect(edgeFnSrc).not.toMatch(broken);
  });

  it("L5-SEC-7 marker comment explains the column choice", () => {
    expect(edgeFnSrc).toMatch(/L5-SEC-7[^a-zA-Z]/);
    expect(edgeFnSrc).toMatch(/RLS policy keys[\s\S]{0,30}auth\.uid\(\)/);
  });
});

describe("L5-SEC-7: companies uses canonical owner_user_id column", () => {
  it("companies spec uses column: 'owner_user_id', NOT 'owner_id'", () => {
    expect(edgeFnSrc).toMatch(
      /table:\s*['"]companies['"]\s*,\s*column:\s*['"]owner_user_id['"]/,
    );
  });

  it("regression guard: NO companies spec uses legacy 'owner_id'", () => {
    const legacy = /table:\s*['"]companies['"]\s*,\s*column:\s*['"]owner_id['"]/;
    expect(edgeFnSrc).not.toMatch(legacy);
  });
});

describe("L5-SEC-7: SAR completeness invariants", () => {
  it("medical_profiles is in the spec (defends against accidental removal)", () => {
    expect(edgeFnSrc).toMatch(/table:\s*['"]medical_profiles['"]/);
  });

  it("companies is in the spec (defends against accidental removal)", () => {
    expect(edgeFnSrc).toMatch(/table:\s*['"]companies['"]/);
  });

  it("both stay in their original category groupings (no regression)", () => {
    // medical_profiles → 'identity', companies → 'memberships'
    expect(edgeFnSrc).toMatch(
      /table:\s*['"]medical_profiles['"][\s\S]{0,200}category:\s*['"]identity['"]/,
    );
    expect(edgeFnSrc).toMatch(
      /table:\s*['"]companies['"][\s\S]{0,200}category:\s*['"]memberships['"]/,
    );
  });
});
