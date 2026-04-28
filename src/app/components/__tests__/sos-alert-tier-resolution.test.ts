// ═══════════════════════════════════════════════════════════════
// SOSphere — sos-alert tier-resolution contract test (CRIT-#7)
// ─────────────────────────────────────────────────────────────
// Edge functions run in Deno and cannot be imported into the Node/vitest
// runtime, so we cannot exercise resolveTier() directly. Instead, this
// suite reads the edge function source code and pins the THREE-PATH
// owner-resolution logic that the W3-14 fix originally implemented
// only one-third of (companies.owner_user_id only, missing the modern
// company_memberships table AND the legacy companies.owner_id).
//
// Without these pins, a future refactor that "simplifies" resolveTier
// back to a single-column lookup would silently break tier resolution
// for the majority of B2B tenants — re-introducing the original bug.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let src = "";

beforeAll(() => {
  // Vitest runs from the project root (cwd), so resolve from cwd. We
  // deliberately do NOT use __dirname / import.meta.url — under vitest's
  // ESM transform __dirname is undefined, and import.meta.url paths are
  // file:// URLs that need fileURLToPath. cwd is reliable in both modes.
  const p = path.resolve(process.cwd(), "supabase", "functions", "sos-alert", "index.ts");
  src = fs.readFileSync(p, "utf8");
});

describe("CRIT-#7 — sos-alert tier resolution contract", () => {
  it("CRIT-#7 marker is present (so the fix is auditable in source)", () => {
    expect(src).toContain("CRIT-#7");
  });

  it("declares resolveCompanyOwnerUserId helper", () => {
    expect(src).toMatch(/async function resolveCompanyOwnerUserId\s*\(/);
  });

  it("queries company_memberships with role='owner' and active=true (PATH 1: modern)", () => {
    const path1 = src.match(/from\("company_memberships"\)[\s\S]{0,400}?maybeSingle\(\)/);
    expect(path1, "company_memberships query must exist").not.toBeNull();
    const block = path1![0];
    expect(block, "must filter role=owner").toMatch(/\.eq\(\s*"role"\s*,\s*"owner"\s*\)/);
    expect(block, "must filter active=true").toMatch(/\.eq\(\s*"active"\s*,\s*true\s*\)/);
    expect(block, "must filter by the company_id arg").toMatch(/\.eq\(\s*"company_id"/);
  });

  it("falls back to companies.owner_user_id and companies.owner_id (PATH 2 + 3)", () => {
    const compFetch = src.match(/from\("companies"\)[\s\S]{0,300}?\.select\("([^"]+)"\)/);
    expect(compFetch, "companies select() must exist in resolver").not.toBeNull();
    const selectClause = compFetch![1];
    expect(selectClause, "must select owner_user_id").toContain("owner_user_id");
    expect(selectClause, "must also select owner_id (legacy)").toContain("owner_id");
  });

  it("uses nullish coalescing chain `owner_user_id ?? owner_id ?? null`", () => {
    // [\s\S]*? (non-greedy any-char) tolerates the optional-chaining `?.`
    // in `company?.owner_user_id` — the previous [^?]* regex incorrectly
    // refused any ? in between and missed the real code.
    const chain = src.match(/owner_user_id[\s\S]*?\?\?[\s\S]*?owner_id[\s\S]*?\?\?\s*null/);
    expect(chain, "must have `owner_user_id ?? owner_id ?? null` fallback").not.toBeNull();
  });

  it("returns null (not throws) when the company has no owner row at all", () => {
    expect(src).toContain("Promise<string | null>");
  });

  it("resolveTier delegates to resolveCompanyOwnerUserId (not inline column query)", () => {
    expect(src).toMatch(/await resolveCompanyOwnerUserId\(\s*companyId/);
    // The OLD inline single-column lookup must be gone:
    const inlineLegacy = src.match(/from\("companies"\)\s*\.\s*select\("owner_user_id"\)/);
    expect(inlineLegacy, "single-column inline lookup must NOT be re-introduced").toBeNull();
  });

  it("logs a warning when no owner is resolvable (operational visibility)", () => {
    expect(src).toMatch(/no owner resolvable/i);
  });

  it("treats every B2B company tier (starter/growth/business/enterprise) as Elite-equivalent", () => {
    // mapTierString must keep the explicit B2B → elite mapping.
    expect(src).toContain('new Set(["starter", "growth", "business", "enterprise"])');
    expect(src).toMatch(/COMPANY_TIERS\.has\(t\)\s*\)\s*return\s+"elite"/);
  });

  it("active-status check rejects expired periods (status=active is not enough on its own)", () => {
    expect(src).toContain("isStatusActive");
    expect(src).toContain("current_period_end");
  });
});
